"""Dev-only smoke test for the bundled UniOCR package (uniocr_mobile.bin).

Run before trusting the TypeScript port (mobile/src/ocr). It verifies:
- the zip loads and det / rec / cls all run through ONNX Runtime,
- input and output names and shapes,
- whether the det output is already sigmoid'd or needs sigmoid (printed, so the
  TS port can hard-code the same path),
- the CTC vocab convention read from the rec model's `character` metadata,
- the manifest constants (1600 max side, 0.3 prob, 0.5 box, 1.6 unclip, 48x320 rec),
- that printed and handwriting-style bill images actually read.

Usage:
    .venv py isn't needed; any python with onnxruntime, opencv, numpy, PIL:
    python uniocr_smoke.py [image1 image2 ...]     (writes its own test bills otherwise)
"""

from __future__ import annotations

import json
import sys
import time
import zipfile
from pathlib import Path

import cv2
import numpy as np
import onnxruntime as ort
from PIL import Image, ImageDraw, ImageFont

BIN = Path(__file__).resolve().parents[1] / "android/app/src/main/assets/uniocr_mobile.bin"
FONTS = Path("C:/Windows/Fonts")
MAX_SIDE = 1600
DET_PROB_THRESH = 0.3
DET_BOX_THRESH = 0.5
DET_UNCLIP = 1.6
DET_MIN_SIZE = 3
REC_H, REC_W = 48, 320
CLS_H, CLS_W = 48, 192
CLS_THRESH = 0.9
REC_MIN_SCORE = 0.5


def load_package():
    zf = zipfile.ZipFile(BIN)
    names = zf.namelist()
    manifest = json.loads(zf.read("manifest.json"))
    det = ort.InferenceSession(zf.read("PP-OCRv6_det_small.onnx"))
    rec = ort.InferenceSession(zf.read("PP-OCRv6_rec_small.onnx"))
    cls = ort.InferenceSession(zf.read("ch_ppocr_mobile_v2.0_cls_mobile.onnx"))
    vocab = rec.get_modelmeta().custom_metadata_map["character"].split("\n")
    for s in (det, rec, cls):
        print("model inputs:", [(i.name, i.shape) for i in s.get_inputs()])
        print("model outputs:", [(o.name, o.shape) for o in s.get_outputs()])
    print("vocab chars:", len(vocab), "first5:", [ascii(c) for c in vocab[:5]], "last3:", [ascii(c) for c in vocab[-3:]])
    return det, rec, cls, vocab


def det_preprocess(img):
    h, w = img.shape[:2]
    scale = min(MAX_SIDE / max(h, w), 1.0)
    nh, nw = round(h * scale), round(w * scale)
    resized = cv2.resize(img, (nw, nh))
    ph, pw = (-nh) % 32, (-nw) % 32  # pad to a multiple of 32 (black)
    padded = cv2.copyMakeBorder(resized, 0, ph, 0, pw, cv2.BORDER_CONSTANT, value=(0, 0, 0))
    x = padded.astype(np.float32) / 255.0
    x = (x - 0.5) / 0.5
    x = x.transpose(2, 0, 1)[None]
    return x, scale, nh, nw


def unclip_rect(cx, cy, w, h, angle):
    """Expand a rotated rect outward by area*unclip/perimeter (exact for rectangles)."""
    if w <= 0 or h <= 0:
        return cx, cy, w, h, angle
    d = (w * h * DET_UNCLIP) / (2 * (w + h))
    return cx, cy, w + 2 * d, h + 2 * d, angle


def rect_corners(cx, cy, w, h, angle):
    a = np.deg2rad(angle)
    cos, sin = np.cos(a), np.sin(a)
    dx, dy = w / 2, h / 2
    pts = np.array([[-dx, -dy], [dx, -dy], [dx, dy], [-dx, dy]])
    rot = np.array([[cos, -sin], [sin, cos]])
    return (pts @ rot.T) + [cx, cy]


def run_det(session, img):
    x, scale, nh, nw = det_preprocess(img)
    out = session.run(None, {session.get_inputs()[0].name: x})[0][0, 0]
    print("det out range:", float(out.min()), float(out.max()))
    prob = 1.0 / (1.0 + np.exp(-out)) if out.min() < -0.001 or out.max() > 1.001 else out
    mask = (prob > DET_PROB_THRESH).astype(np.uint8)
    H, W = mask.shape
    boxes = []
    contours, _ = cv2.findContours(mask, cv2.RETR_LIST, cv2.CHAIN_APPROX_SIMPLE)
    for c in contours:
        if cv2.contourArea(c) < DET_MIN_SIZE * DET_MIN_SIZE:
            continue
        (cx, cy), (rw, rh), ang = cv2.minAreaRect(c)
        region = np.zeros_like(mask)
        cv2.drawContours(region, [c], -1, 1, -1)
        score = prob[region > 0].mean()
        if score < DET_BOX_THRESH:
            continue
        cx, cy, rw, rh, ang = unclip_rect(cx, cy, rw, rh, ang)
        if min(rw, rh) < DET_MIN_SIZE + 2:
            continue
        corners = rect_corners(cx, cy, rw, rh, ang)
        corners[:, 0] = np.clip(corners[:, 0] / scale, 0, img.shape[1] - 1)
        corners[:, 1] = np.clip(corners[:, 1] / scale, 0, img.shape[0] - 1)
        boxes.append(corners.astype(np.float32))
    return boxes


def order_corners(pts):
    s = pts.sum(1)
    diff = np.diff(pts, axis=1).ravel()
    return np.array([pts[np.argmin(s)], pts[np.argmin(diff)], pts[np.argmax(s)], pts[np.argmax(diff)]], dtype=np.float32)


def crop_box(img, pts):
    pts = order_corners(pts)
    w = int(max(np.linalg.norm(pts[0] - pts[1]), np.linalg.norm(pts[3] - pts[2])))
    h = int(max(np.linalg.norm(pts[0] - pts[3]), np.linalg.norm(pts[1] - pts[2])))
    dst = np.array([[0, 0], [w - 1, 0], [w - 1, h - 1], [0, h - 1]], dtype=np.float32)
    M = cv2.getPerspectiveTransform(pts, dst)
    return cv2.warpPerspective(img, M, (max(w, 1), max(h, 1)))


def run_cls(session, strip):
    x = cv2.resize(strip, (CLS_W, CLS_H)).astype(np.float32) / 255.0
    x = ((x - 0.5) / 0.5).transpose(2, 0, 1)[None]
    out = session.run(None, {session.get_inputs()[0].name: x})[0][0]
    if out[1] > CLS_THRESH:
        return cv2.rotate(strip, cv2.ROTATE_180)
    return strip


def run_rec(session, vocab, strip):
    h, w = strip.shape[:2]
    nh = REC_H
    nw = max(int(round(w * REC_H / h)), 16)
    if nw > REC_W:
        nw = REC_W  # long line: squeeze into 320
    x = cv2.resize(strip, (nw, nh)).astype(np.float32) / 255.0
    x = ((x - 0.5) / 0.5).transpose(2, 0, 1)[None]
    out = session.run(None, {session.get_inputs()[0].name: x})[0][0]  # [T, C]
    # CTC: index 0 = blank; 1..len(vocab) -> vocab[i-1]; last index = space (PaddleOCR convention).
    idxs = out.argmax(1)
    scores = out.max(1)
    chars, kept, prev = [], [], -1
    for i, s in zip(idxs, scores):
        if i != 0 and i != prev:
            if i <= len(vocab):
                chars.append(vocab[i - 1])
            else:
                chars.append(" ")
            kept.append(float(s))
        prev = i
    text = "".join(chars)
    score = float(np.mean(kept)) if kept else 0.0
    return text, score


def reading_order(boxes):
    def key(b):
        cy = b[:, 1].mean()
        cx = b[:, 0].mean()
        return (round(cy / 12), cx)
    return sorted(range(len(boxes)), key=lambda i: key(boxes[i]))


def main(paths):
    det, rec, cls, vocab = load_package()
    images = [str(p) for p in paths] or []
    if not images:
        images = [make_test_bills()]
    for path in images:
        img = cv2.imread(str(path))
        print("\n=====", path, img.shape)
        t0 = time.time()
        boxes = run_det(det, img)
        print(f"det: {len(boxes)} boxes in {time.time()-t0:.2f}s")
        order = reading_order(boxes)
        for n, i in enumerate(order):
            strip = crop_box(img, boxes[i])
            strip = run_cls(cls, strip)
            t1 = time.time()
            text, score = run_rec(rec, vocab, strip)
            h, w = strip.shape[:2]
            print(f"  [{n}] {w}x{h} {score:.2f} ({time.time()-t1:.2f}s) {text!r}")


def make_test_bills():
    out = Path(__file__).parent / "ocr_test_output"
    out.mkdir(exist_ok=True)
    # 1. Printed restaurant bill
    img = Image.new("RGB", (900, 1300), "white")
    d = ImageDraw.Draw(img)
    arial = ImageFont.truetype(str(FONTS / "arial.ttf"), 34)
    small = ImageFont.truetype(str(FONTS / "arial.ttf"), 26)
    lines = [
        ("SHANTI SAGAR RESTAURANT", arial, 40),
        ("GSTIN 29ABCDE1234F1Z5  FSSAI 21234567890123", small, 90),
        ("Table 12    21-10-2026    21:45", small, 140),
        ("", small, 0),
        ("PANEER BUTTER MASALA      1     320.00", arial, 200),
        ("TANDOORI ROTI             8      96.00", arial, 250),
        ("DAL FRY                   2     240.00", arial, 300),
        ("BUTTER NAAN               2     140.00", arial, 350),
        ("MASALA PAPAD              1      60.00", arial, 400),
        ("COLD COFFEE               2     220.00", arial, 450),
        ("", small, 0),
        ("Sub Total                            1076.00", arial, 520),
        ("CGST @ 2.5%                            26.90", arial, 570),
        ("SGST @ 2.5%                            26.90", arial, 620),
        ("Service Charge (10%)                  107.60", arial, 670),
        ("Round Off                              -1.40", arial, 720),
        ("Total                                 1236.00", arial, 800),
        ("Thank you! Visit again :)", small, 880),
    ]
    for text, font, y in lines:
        if text:
            d.text((60, y), text, fill="black", font=font)
    p1 = out / "printed_bill.png"
    img.save(p1)
    # 2. Handwriting-style dhaba bill (casual font, uneven lines, no symbol)
    img = Image.new("RGB", (760, 760), (252, 248, 236))
    d = ImageDraw.Draw(img)
    hand = ImageFont.truetype(str(FONTS / "comic.ttf"), 44)
    rows = [
        ("Rahul Ka Dhaba", 40),
        ("Paneer Tikka   320", 130),
        ("Dal Fry        80", 190),
        ("Roti  8 x 12   96", 250),
        ("Chai  3 x 15   45", 310),
        ("Rice           120", 380),
        ("Total    661", 470),
    ]
    for text, y in rows:
        d.text((50, y), text, fill=(20, 20, 60), font=hand)
    p2 = out / "handwritten_bill.png"
    img.save(p2)
    print("wrote", p1, "and", p2)
    return p2  # smoke on the handwritten one; pass the other as an arg


if __name__ == "__main__":
    main([Path(a) for a in sys.argv[1:]])
