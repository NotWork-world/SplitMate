// The on-device OCR engine: uniocr_mobile.bin (PP-OCRv6 det + rec + 180° cls)
// loaded from the app's assets, run through ONNX Runtime — fully offline.
// All maths lives in pure modules (imageops, dbpostprocess, ctc, package);
// this file is the React Native glue: asset loading, batching, progress.

import JSZip from 'jszip';
import RNFS from 'react-native-fs';
import {InferenceSession, Tensor} from 'onnxruntime-react-native';
import {Buffer} from 'buffer';

import {base64ToBytes, bytesToBase64, vocabFromOnnx} from './package';
import {decodeImage} from './decode';
import {cloneImage, cropPerspective, rotate180, rotate90ccw, resizeImage, toChwNormalized, stripToRecInput, type Point, type RgbaImage} from './imageops';
import {dbBoxes, DB_DEFAULTS} from './dbpostprocess';
import {ctcDecode, readingOrder} from './ctc';

const ASSET = 'uniocr_mobile.bin';
const MODEL_DIR = `${RNFS.DocumentDirectoryPath}/uniocr`;
const MARKER = `${MODEL_DIR}/v1.txt`;
const DET_MAX_SIDE = 1600; // manifest: limit_side_len max
const REC_H = 48;
const REC_W = 320;
const REC_BATCH = 8;
const CLS_H = 48;
const CLS_W = 192;
const CLS_FLIP_PROB = 0.9;
const REC_MIN_SCORE = 0.5;

export interface OcrLine {
  text: string;
  left: number;
  top: number;
  width: number;
  height: number;
  score: number;
}

export type Progress = (stage: 'loading' | 'detecting' | 'reading', detail?: string) => void;

interface Engine {
  det: InferenceSession;
  rec: InferenceSession;
  cls: InferenceSession;
  vocab: string[];
}

let enginePromise: Promise<Engine> | null = null;

/** Read every text line of a photo, offline, in reading order. */async function loadEngine(): Promise<Engine> {
  if (typeof (globalThis as any).Buffer === 'undefined') {
    (globalThis as any).Buffer = Buffer; // jpeg-js reads bytes through Node's Buffer
  }
  // First scan ever on this phone: unpack the three models out of the package
  // (a plain zip) into app storage, and pull the vocabulary out of the rec
  // model's metadata. Later launches load straight from the files.
  const have = await RNFS.exists(MARKER).catch(() => false);
  if (!have) {
    const b64 = await RNFS.readFileAssets(ASSET, 'base64');
    const zip = await JSZip.loadAsync(b64, {base64: true});
    await RNFS.mkdir(MODEL_DIR).catch(() => {});
    const files: Array<[string, string]> = [
      ['PP-OCRv6_det_small.onnx', `${MODEL_DIR}/det.onnx`],
      ['PP-OCRv6_rec_small.onnx', `${MODEL_DIR}/rec.onnx`],
      ['ch_ppocr_mobile_v2.0_cls_mobile.onnx', `${MODEL_DIR}/cls.onnx`],
    ];
    let vocab: string[] | null = null;
    for (const [entry, dest] of files) {
      const bytes = await zip.file(entry)!.async('uint8array');
      await RNFS.writeFile(dest, bytes.length ? bytesToBase64(bytes) : '', 'base64');
      if (entry.startsWith('PP-OCRv6_rec')) {
        vocab = vocabFromOnnx(bytes);
      }
    }
    await RNFS.writeFile(`${MODEL_DIR}/vocab.json`, JSON.stringify(vocab ?? []), 'utf8');
    await RNFS.writeFile(MARKER, String(Date.now()), 'utf8');
  }
  const vocab: string[] = JSON.parse(await RNFS.readFile(`${MODEL_DIR}/vocab.json`, 'utf8'));
  if (!vocab.length) {
    throw new Error('the OCR vocabulary is missing');
  }
  const [det, rec, cls] = await Promise.all([
    InferenceSession.create(`${MODEL_DIR}/det.onnx`),
    InferenceSession.create(`${MODEL_DIR}/rec.onnx`),
    InferenceSession.create(`${MODEL_DIR}/cls.onnx`),
  ]);
  return {det, rec, cls, vocab};
}

/** First call loads the models (a few seconds); later calls reuse them. */
export function engine(): Promise<Engine> {
  if (!enginePromise) {
    enginePromise = loadEngine().catch(e => {
      enginePromise = null; // a failed load must not stick
      throw e;
    });
  }
  return enginePromise;
}

/** True once the models are in memory (for "ready" hints). */
export function engineReady(): boolean {
  return enginePromise !== null;
}

/** True once the models are unpacked into app storage: the "one-time setup" is
 * done and only a quick load into memory remains (which the app preloads at
 * open, so scans don't wait). */
export function modelsUnpacked(): Promise<boolean> {
  return RNFS.exists(MARKER).catch(() => false);
}

function tensorData(t: Tensor): Float32Array {
  const d = t.data as Float32Array | number[];
  return d instanceof Float32Array ? d : Float32Array.from(d);
}

async function runDet(e: Engine, img: RgbaImage): Promise<Array<[Point, Point, Point, Point]>> {
  const scale = Math.min(DET_MAX_SIDE / Math.max(img.width, img.height), 1);
  const nw = Math.max(1, Math.round(img.width * scale));
  const nh = Math.max(1, Math.round(img.height * scale));
  const small = scale === 1 ? cloneImage(img) : resizeImage(img, nw, nh);
  const {tensor, width, height} = toChwNormalized(small, 32);
  const feeds = {[e.det.inputNames[0]]: new Tensor('float32', tensor, [1, 3, height, width])};
  const out = await e.det.run(feeds);
  const data = tensorData(out[e.det.outputNames[0]]);
  // The bundled det model emits probabilities directly (verified: range 0..1);
  // if a future model emits logits, fall back to a sigmoid pass.
  const H = out[e.det.outputNames[0]].dims[2] as number;
  const W = out[e.det.outputNames[0]].dims[3] as number;
  const probs = data.length === H * W ? data : sigmoid(data);
  const boxes = dbBoxes(probs, W, H, 1, DB_DEFAULTS); // scale 1: coords match `small`
  return boxes.map(b => b.corners.map(c => ({x: c.x / scale, y: c.y / scale})) as [Point, Point, Point, Point]);
}

function sigmoid(x: Float32Array): Float32Array {
  const out = new Float32Array(x.length);
  for (let i = 0; i < x.length; i++) {
    out[i] = 1 / (1 + Math.exp(-x[i]));
  }
  return out;
}

function stripSize(corners: [Point, Point, Point, Point]): {w: number; h: number} {
  const dist = (a: Point, b: Point) => Math.hypot(a.x - b.x, a.y - b.y);
  const w = Math.max(dist(corners[0], corners[1]), dist(corners[3], corners[2]));
  const h = Math.max(dist(corners[0], corners[3]), dist(corners[1], corners[2]));
  return {w: Math.max(w, 2), h: Math.max(h, 2)};
}

async function runCls(e: Engine, strips: RgbaImage[]): Promise<RgbaImage[]> {
  if (!strips.length) {
    return [];
  }
  const N = strips.length;
  const batch = new Float32Array(N * 3 * CLS_H * CLS_W).fill(-1); // black padding
  const plane = CLS_H * CLS_W;
  for (let i = 0; i < N; i++) {
    // PaddleOCR cls preprocessing: aspect-preserved height 48, zero-pad right to 192.
    const s = strips[i];
    const wNat = Math.min(CLS_W, Math.max(16, Math.round((s.width * CLS_H) / s.height)));
    const scaled = resizeImage(s, wNat, CLS_H);
    const {tensor} = toChwNormalized(scaled, 1);
    const off = i * 3 * plane;
    for (let c = 0; c < 3; c++) {
      const src = c * CLS_H * wNat;
      batch.set(tensor.subarray(src, src + CLS_H * wNat), off + c * plane);
    }
  }
  const feeds = {[e.cls.inputNames[0]]: new Tensor('float32', batch, [N, 3, CLS_H, CLS_W])};
  const out = await e.cls.run(feeds);
  const data = tensorData(out[e.cls.outputNames[0]]);
  return strips.map((s, i) => (data[i * 2 + 1] > CLS_FLIP_PROB ? rotate180(s) : s));
}

async function runRec(e: Engine, strips: RgbaImage[]): Promise<Array<{text: string; score: number}>> {
  const results: Array<{text: string; score: number}> = new Array(strips.length);
  // Group by target width so a batch shares one tensor shape.
  const byWidth = new Map<number, number[]>();
  strips.forEach((s, i) => {
    const w = Math.max(16, Math.min(REC_W, Math.round((s.width * REC_H) / s.height)));
    const list = byWidth.get(w) ?? [];
    list.push(i);
    byWidth.set(w, list);
  });
  for (const [w, indices] of byWidth) {
    for (let start = 0; start < indices.length; start += REC_BATCH) {
      const batchIdx = indices.slice(start, start + REC_BATCH);
      const N = batchIdx.length;
      const batch = new Float32Array(N * 3 * REC_H * w);
      for (let b = 0; b < N; b++) {
        const {tensor} = stripToRecInput(strips[batchIdx[b]], REC_H, w);
        batch.set(tensor, b * 3 * REC_H * w);
      }
      const feeds = {[e.rec.inputNames[0]]: new Tensor('float32', batch, [N, 3, REC_H, w])};
      const out = await e.rec.run(feeds);
      const data = tensorData(out[e.rec.outputNames[0]]);
      const dims = out[e.rec.outputNames[0]].dims as number[]; // [N, T, C]
      const T = dims[1];
      const C = dims[2];
      for (let b = 0; b < N; b++) {
        const slice = data.subarray(b * T * C, (b + 1) * T * C);
        results[batchIdx[b]] = ctcDecode(slice, T, C, e.vocab, REC_MIN_SCORE);
      }
    }
  }
  return results;
}

/** Read every text line of a photo, offline, in reading order. */
export async function recognize(base64: string, onProgress?: Progress): Promise<OcrLine[]> {
  onProgress?.('loading');
  const e = await engine();
  const bytes = base64ToBytes(base64);
  const img = decodeImage(bytes);
  onProgress?.('detecting');
  const corners = await runDet(e, img);
  const strips = corners.map(c => {
    const {w, h} = stripSize(c);
    let strip = cropPerspective(img, c, Math.round(w), Math.round(h));
    // PaddleOCR's get_rotate_crop_image: a strip much taller than wide is a
    // vertical text line — rotate it so the recognizer sees horizontal text.
    if (strip.height / strip.width >= 1.5) {
      strip = rotate90ccw(strip);
    }
    return strip;
  });
  const oriented = await runCls(e, strips);
  onProgress?.('reading', `${strips.length} lines`);
  const texts = await runRec(e, oriented);
  const lines: OcrLine[] = corners.map((c, i) => {
    const {w, h} = stripSize(c);
    const xs = c.map(p => p.x);
    const ys = c.map(p => p.y);
    return {
      text: texts[i]?.text ?? '',
      left: Math.min(...xs),
      top: Math.min(...ys),
      width: w,
      height: h,
      score: texts[i]?.score ?? 0,
    };
  });
  const good = readingOrder(lines.filter(l => l.text.trim().length > 0));
  return good;
}
