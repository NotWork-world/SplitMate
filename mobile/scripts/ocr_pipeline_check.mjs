/**
 * End-to-end check of the TypeScript OCR pipeline against the real bundled
 * models, run in Node with onnxruntime-node (same JS API as the phone).
 * This is the TS port of scripts/uniocr_smoke.py: same constants, same steps.
 *
 * Run:  node scripts/ocr_pipeline_check.mjs <image>
 */

import {readFileSync, writeFileSync} from 'fs';
import {join} from 'path';
import {pathToFileURL} from 'url';
import {execFileSync} from 'child_process';

import {InferenceSession, Tensor} from 'onnxruntime-node';
import JSZip from 'jszip';
import UPNG from 'upng-js';

const ROOT = join(import.meta.dirname, '..');
const BIN = join(ROOT, 'android/app/src/main/assets/uniocr_mobile.bin');
const TMP = join(ROOT, '.ocr-check');

// Compile the pure TS modules once, then import them.
execFileSync(
  process.execPath,
  [
    'node_modules/typescript/bin/tsc',
    'src/ocr/package.ts',
    'src/ocr/utf8.ts',
    'src/ocr/exif.ts',
    'src/ocr/decode.ts',
    'src/types/shims.d.ts',
    'src/ocr/imageops.ts',
    'src/ocr/dbpostprocess.ts',
    'src/ocr/ctc.ts',
    '--outDir',
    '.ocr-check',
    '--module',
    'commonjs',
    '--target',
    'es2020',
    '--moduleResolution',
    'node',
    '--skipLibCheck',
    '--esModuleInterop',
    '--ignoreConfig',
    '--ignoreDeprecations',
    '6.0',
  ],
  {cwd: ROOT, stdio: 'inherit'},
);

const {vocabFromOnnx} = await import(pathToFileURL(join(TMP, 'package.js')).href);
const {decodeImage} = await import(pathToFileURL(join(TMP, 'decode.js')).href);
const {resizeImage, toChwNormalized, cropPerspective, stripToRecInput, rotate180, rotate90ccw} = await import(pathToFileURL(join(TMP, 'imageops.js')).href);
const {dbBoxes, DB_DEFAULTS} = await import(pathToFileURL(join(TMP, 'dbpostprocess.js')).href);
const {ctcDecode, readingOrder} = await import(pathToFileURL(join(TMP, 'ctc.js')).href);

const DET_MAX_SIDE = 1600;
const REC_H = 48;
const REC_W = 320;

const image = process.argv[2] ?? join(ROOT, 'scripts/ocr_test_output/handwritten_bill.png');
console.log('image:', image);

const bytes = new Uint8Array(readFileSync(image));
const img = decodeImage(bytes);
console.log('decoded', img.width, 'x', img.height, '(EXIF applied, capped)');

const zip = await JSZip.loadAsync(new Uint8Array(readFileSync(BIN)));
const detBytes = await zip.file('PP-OCRv6_det_small.onnx').async('uint8array');
const recBytes = await zip.file('PP-OCRv6_rec_small.onnx').async('uint8array');
const clsBytes = await zip.file('ch_ppocr_mobile_v2.0_cls_mobile.onnx').async('uint8array');
const [det, rec, cls] = await Promise.all([
  InferenceSession.create(Buffer.from(detBytes)),
  InferenceSession.create(Buffer.from(recBytes)),
  InferenceSession.create(Buffer.from(clsBytes)),
]);
const vocab = vocabFromOnnx(recBytes);
console.log('vocab', vocab.length, 'chars');

const t0 = Date.now();
// det
const scale = Math.min(DET_MAX_SIDE / Math.max(img.width, img.height), 1);
const small = scale === 1 ? img : resizeImage(img, Math.round(img.width * scale), Math.round(img.height * scale));
const {tensor, width, height} = toChwNormalized(small, 32);
const detOut = await det.run({[det.inputNames[0]]: new Tensor('float32', tensor, [1, 3, height, width])});
const outT = detOut[det.outputNames[0]];
const probs = outT.data;
const H = outT.dims[2];
const W = outT.dims[3];
let pmin = 1;
let pmax = 0;
for (let i = 0; i < probs.length; i += 97) {
  if (probs[i] < pmin) pmin = probs[i];
  if (probs[i] > pmax) pmax = probs[i];
}
console.log('det map', W, 'x', H, 'range', pmin.toFixed(3), pmax.toFixed(3));
const boxes = dbBoxes(probs, W, H, 1, DB_DEFAULTS);
console.log('det:', boxes.length, 'boxes in', ((Date.now() - t0) / 1000).toFixed(2) + 's');

const stripSize = c => {
  const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
  return {
    w: Math.max(Math.max(dist(c[0], c[1]), dist(c[3], c[2])), 2),
    h: Math.max(Math.max(dist(c[0], c[3]), dist(c[1], c[2])), 2),
  };
};

const lines = [];
for (const b of boxes) {
  const corners = b.corners.map(p => ({x: p.x / scale, y: p.y / scale}));
  const {w, h} = stripSize(corners);
  let strip = cropPerspective(img, corners, Math.round(w), Math.round(h));
  if (strip.height / strip.width >= 1.5) {
    strip = rotate90ccw(strip); // vertical text line -> horizontal
  }
  // cls (PaddleOCR preprocessing: aspect-preserved height 48, zero-pad right to 192)
  const wNat = Math.min(192, Math.max(16, Math.round((strip.width * 48) / strip.height)));
  const scaled = resizeImage(strip, wNat, 48);
  const clsIn = toChwNormalized(scaled, 1);
  const clsBatch = new Float32Array(3 * 48 * 192).fill(-1);
  for (let c = 0; c < 3; c++) {
    clsBatch.set(clsIn.tensor.subarray(c * 48 * wNat, c * 48 * wNat + 48 * wNat), c * 48 * 192);
  }
  const clsOut = await cls.run({[cls.inputNames[0]]: new Tensor('float32', clsBatch, [1, 3, 48, 192])});
  const flipProb = clsOut[cls.outputNames[0]].data[1];
  if (flipProb > 0.9) {
    strip = rotate180(strip);
    console.log('  (cls flipped a strip, p=' + flipProb.toFixed(2) + ')');
  }
  // rec
  const recIn = stripToRecInput(strip, REC_H, REC_W);
  const recOut = await rec.run({[rec.inputNames[0]]: new Tensor('float32', recIn.tensor, [1, 3, REC_H, recIn.width])});
  const rt = recOut[rec.outputNames[0]];
  const r = ctcDecode(rt.data, rt.dims[1], rt.dims[2], vocab, 0.5);
  if (r.score < 0.5 || !r.text) {
    const fs = await import('fs');
    const n = lines.length;
    fs.writeFileSync(join(ROOT, `.ocr-check/strip_${n}.png`), Buffer.from(UPNG.encode([strip.data], strip.width, strip.height, 0)));
    console.log(`saved strip_${n}.png (${strip.width}x${strip.height}) score ${r.score.toFixed(2)} raw "${r.text}"`);
  }
  const xs = corners.map(p => p.x);
  const ys = corners.map(p => p.y);
  lines.push({
    text: r.text,
    score: r.score,
    left: Math.min(...xs),
    top: Math.min(...ys),
    width: stripSize(corners).w,
    height: stripSize(corners).h,
  });
}

console.log('\n--- reading order ---');
const ordered = readingOrder(lines.filter(l => l.text.trim().length > 0)); // the app sends non-empty only
for (const l of ordered) {
  console.log(`  ${l.score.toFixed(2)}  ${JSON.stringify(l.text)}`);
}
// Same payload the phone sends the server, so the Python parser can be run on it.
writeFileSync(join(ROOT, '.ocr-check', 'lines.json'), JSON.stringify(ordered.map(l => ({
  text: l.text, left: Math.round(l.left), top: Math.round(l.top),
  width: Math.round(l.width), height: Math.round(l.height), score: l.score,
}))));
console.log('total', ((Date.now() - t0) / 1000).toFixed(2) + 's');
