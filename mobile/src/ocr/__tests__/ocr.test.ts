import JSZip from 'jszip';
import {readFileSync} from 'fs';
import {join} from 'path';

import {base64ToBytes, onnxMetadata, vocabFromOnnx} from '../package';
import {ctcDecode, readingOrder} from '../ctc';
import {connectedComponents, dbBoxes, minAreaRect, rectCorners, unclipRect} from '../dbpostprocess';
import {cropPerspective, resizeImage, rotate180, stripToRecInput, toChwNormalized, type Point, type RgbaImage} from '../imageops';

const BIN = join(__dirname, '../../../android/app/src/main/assets/uniocr_mobile.bin');

/** A tiny RGBA image: a white bar on black, rotated by a shear for geometry tests. */
function syntheticImage(w: number, h: number, paint: (x: number, y: number) => [number, number, number]): RgbaImage {
  const data = new Uint8Array(w * h * 4);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const [r, g, b] = paint(x, y);
      const o = (y * w + x) * 4;
      data[o] = r;
      data[o + 1] = g;
      data[o + 2] = b;
      data[o + 3] = 255;
    }
  }
  return {width: w, height: h, data};
}

describe('base64ToBytes', () => {
  it('decodes standard and url-safe alphabets', () => {
    expect(Buffer.from(base64ToBytes('aGVsbG8=')).toString()).toBe('hello');
    expect(Buffer.from(base64ToBytes('a-G_v8=')).toString()).toBe(Buffer.from(base64ToBytes('a+G/v8=')).toString());
    expect(base64ToBytes('////').length).toBe(3);
  });
});

describe('the real uniocr package', () => {
  it('extracts the 18,708-character vocabulary from the rec model metadata', async () => {
    const zip = await JSZip.loadAsync(new Uint8Array(readFileSync(BIN)));
    const rec = await zip.file('PP-OCRv6_rec_small.onnx')!.async('uint8array');
    const vocab = vocabFromOnnx(rec);
    expect(vocab.length).toBe(18708);
    expect(vocab[0]).toBe('!');
    expect(vocab).toContain('₹');
    expect(vocab).toContain('0');
    expect(vocab).toContain('A');
    // The CTC head adds blank (0) + space (last): classes must be vocab + 2.
    const meta = onnxMetadata(rec);
    expect(meta['character'].length).toBeGreaterThan(18000);
  }, 30000);
});

describe('ctcDecode', () => {
  const vocab = ['a', 'b', 'c'];

  it('collapses repeats and blanks', () => {
    // classes: 0 blank, 1 'a', 2 'b', 3 'c', 4 space
    const C = 5;
    const steps: number[] = [0, 1, 1, 0, 2, 2, 2, 0];
    const out = new Float32Array(steps.length * C);
    steps.forEach((cls, t) => {
      out[t * C + cls] = 0.99;
    });
    expect(ctcDecode(out, steps.length, C, vocab).text).toBe('ab');
  });

  it('keeps double letters across a blank', () => {
    const C = 5;
    const steps = [1, 1, 0, 1, 0];
    const out = new Float32Array(steps.length * C);
    steps.forEach((cls, t) => {
      out[t * C + cls] = 0.99;
    });
    expect(ctcDecode(out, steps.length, C, vocab).text).toBe('aa');
  });

  it('maps the last class to a space and drops low-confidence text', () => {
    const C = 5;
    const steps = [1, 4, 2];
    const out = new Float32Array(steps.length * C);
    steps.forEach((cls, t) => {
      out[t * C + cls] = 0.99;
    });
    expect(ctcDecode(out, steps.length, C, vocab).text).toBe('a b');
    const low = new Float32Array(steps.length * C).fill(0.4);
    expect(ctcDecode(low, steps.length, C, vocab).text).toBe('');
  });
});

describe('geometry', () => {
  it('finds the min-area rect of a rotated bar', () => {
    const pts: Point[] = [];
    // A 100x20 rectangle rotated ~18.4° (dx=4, dy=1 direction, scaled)
    for (let i = 0; i <= 100; i += 4) {
      for (let j = 0; j < 20; j += 4) {
        pts.push({x: i * 4 - j, y: i + j * 4});
      }
    }
    const r = minAreaRect(pts);
    expect(r.width).toBeGreaterThan(380);
    expect(r.width).toBeLessThan(480);
    expect(r.height).toBeGreaterThan(60);
    expect(r.height).toBeLessThan(120);
  });

  it('never transposes an axis-aligned horizontal bar', () => {
    const pts: Point[] = [];
    for (let x = 10; x < 123; x += 2) {
      for (let y = 20; y < 57; y += 2) {
        pts.push({x, y});
      }
    }
    const r = minAreaRect(pts);
    expect(r.width).toBeGreaterThanOrEqual(r.height); // landscape stays landscape
    expect(r.width).toBeGreaterThan(100);
    expect(r.height).toBeLessThan(40);
    const corners = rectCorners(r);
    expect(corners[1].x - corners[0].x).toBeGreaterThan(80); // TL->TR is the long side
    expect(corners[3].y - corners[0].y).toBeLessThan(40); // TL->BL is the short side
  });

  it('unclips a rect outward', () => {
    const r = unclipRect({cx: 50, cy: 50, width: 100, height: 20, angle: 0}, 1.6);
    expect(r.width).toBeGreaterThan(100);
    expect(r.height).toBeGreaterThan(20);
    const areaRatio = (r.width * r.height) / (100 * 20);
    expect(areaRatio).toBeGreaterThan(1.3);
    expect(areaRatio).toBeLessThan(3.5);
  });

  it('orders rect corners TL, TR, BR, BL', () => {
    const corners = rectCorners({cx: 50, cy: 40, width: 60, height: 30, angle: 0});
    expect(corners[0]).toEqual({x: 20, y: 25});
    expect(corners[1].x).toBeGreaterThan(corners[0].x);
    expect(corners[3].y).toBeGreaterThan(corners[0].y);
  });

  it('labels connected components separately', () => {
    const mask = new Uint8Array(10 * 10);
    mask[12] = 1;
    mask[13] = 1;
    mask[70] = 1;
    const ccs = connectedComponents(mask, 10, 10);
    expect(ccs.length).toBe(2);
    expect(ccs[0].pixels.length).toBe(2);
  });

  it('finds one unclipped box around a bright bar in a prob map', () => {
    const W = 200;
    const H = 60;
    const prob = new Float32Array(W * H);
    for (let y = 20; y < 32; y++) {
      for (let x = 10; x < 150; x++) {
        prob[y * W + x] = 0.9;
      }
    }
    const boxes = dbBoxes(prob, W, H, 1);
    expect(boxes.length).toBe(1);
    const xs = boxes[0].corners.map(c => c.x);
    const ys = boxes[0].corners.map(c => c.y);
    expect(Math.min(...xs)).toBeLessThanOrEqual(10);
    expect(Math.max(...xs)).toBeGreaterThanOrEqual(150);
    expect(Math.min(...ys)).toBeLessThanOrEqual(20);
    expect(Math.max(...ys)).toBeGreaterThanOrEqual(32);
  });
});

describe('imageops', () => {
  it('resizes with bilinear sampling', () => {
    const img = syntheticImage(4, 4, () => [255, 0, 0]);
    const out = resizeImage(img, 8, 8);
    expect(out.width).toBe(8);
    expect(out.data[0]).toBeCloseTo(255, 0);
  });

  it('normalizes to [-1,1] and pads to multiples of 32', () => {
    const img = syntheticImage(10, 10, () => [255, 255, 255]);
    const {tensor, width, height} = toChwNormalized(img, 32);
    expect(width).toBe(32);
    expect(height).toBe(32);
    expect(tensor.length).toBe(3 * 32 * 32);
    expect(tensor[0]).toBeCloseTo(1, 5); // white -> +1
    // padded cell (black) -> -1
    expect(tensor[31 * 32 + 20]).toBeCloseTo(-1, 5);
  });

  it('builds rec strips of height 48, width capped at 320', () => {
    const img = syntheticImage(400, 50, () => [0, 0, 0]);
    const {tensor, width} = stripToRecInput(img, 48, 320);
    expect(width).toBe(320); // 400*48/50 = 384 squashes to the training width
    expect(tensor.length).toBe(3 * 48 * 320);
    const wide = syntheticImage(5000, 50, () => [0, 0, 0]);
    expect(stripToRecInput(wide, 48, 320).width).toBe(320); // capped
  });

  it('rotates 180 degrees', () => {
    const img = syntheticImage(2, 2, (x, y) => (x === 0 && y === 0 ? [255, 0, 0] : [0, 0, 0]));
    const out = rotate180(img);
    expect(out.data[(1 * 2 + 1) * 4]).toBe(255);
  });

  it('perspective-crops with the identity mapping', () => {
    const img = syntheticImage(20, 20, (x, y) => [x * 10, y * 10, 0]);
    const corners: [Point, Point, Point, Point] = [
      {x: 0, y: 0},
      {x: 19, y: 0},
      {x: 19, y: 19},
      {x: 0, y: 19},
    ];
    const out = cropPerspective(img, corners, 20, 20);
    expect(out.width).toBe(20);
    expect(out.data[0]).toBe(0);
    expect(out.data[(0 * 20 + 10) * 4]).toBeCloseTo(100, -1);
  });
});

describe('readingOrder', () => {
  it('groups rows and sorts left to right', () => {
    const lines = [
      {text: 'b', left: 100, top: 50, width: 10, height: 10},
      {text: 'c', left: 200, top: 54, width: 10, height: 10},
      {text: 'a', left: 10, top: 52, width: 10, height: 10},
      {text: 'd', left: 10, top: 120, width: 10, height: 10},
    ];
    expect(readingOrder(lines).map(l => l.text)).toEqual(['a', 'b', 'c', 'd']);
  });
});
