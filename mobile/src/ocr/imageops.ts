// Pure image maths for the OCR pipeline. No React Native imports: everything
// here runs identically in Jest (Node) and on the phone.

export interface RgbaImage {
  width: number;
  height: number;
  /** RGBA, 4 bytes per pixel, row-major. */
  data: Uint8Array | Uint8ClampedArray;
}

export interface Point {
  x: number;
  y: number;
}

export const makeImage = (width: number, height: number): RgbaImage => ({
  width,
  height,
  data: new Uint8Array(width * height * 4),
});

export function cloneImage(img: RgbaImage): RgbaImage {
  return {width: img.width, height: img.height, data: new Uint8Array(img.data)};
}

/** Bilinear resize of an RGBA image (area-average is unnecessary for OCR input). */
export function resizeImage(img: RgbaImage, w: number, h: number): RgbaImage {
  if (w === img.width && h === img.height) {
    return cloneImage(img);
  }
  const out = new Uint8Array(w * h * 4);
  const sx = img.width / w;
  const sy = img.height / h;
  for (let y = 0; y < h; y++) {
    const fy = Math.min(Math.max((y + 0.5) * sy - 0.5, 0), img.height - 1);
    const y0 = Math.floor(fy);
    const y1 = Math.min(y0 + 1, img.height - 1);
    const wy = fy - y0;
    for (let x = 0; x < w; x++) {
      const fx = Math.min(Math.max((x + 0.5) * sx - 0.5, 0), img.width - 1);
      const x0 = Math.floor(fx);
      const x1 = Math.min(x0 + 1, img.width - 1);
      const wx = fx - x0;
      const i00 = (y0 * img.width + x0) * 4;
      const i10 = (y0 * img.width + x1) * 4;
      const i01 = (y1 * img.width + x0) * 4;
      const i11 = (y1 * img.width + x1) * 4;
      const o = (y * w + x) * 4;
      for (let c = 0; c < 4; c++) {
        const top = img.data[i00 + c] * (1 - wx) + img.data[i10 + c] * wx;
        const bottom = img.data[i01 + c] * (1 - wx) + img.data[i11 + c] * wx;
        out[o + c] = top * (1 - wy) + bottom * wy;
      }
    }
  }
  return {width: w, height: h, data: out};
}

/** 180° rotation (the cls model says when a strip is upside down). */
export function rotate180(img: RgbaImage): RgbaImage {
  const out = new Uint8Array(img.width * img.height * 4);
  const {width, height} = img;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const src = ((height - 1 - y) * width + (width - 1 - x)) * 4;
      const dst = (y * width + x) * 4;
      out[dst] = img.data[src];
      out[dst + 1] = img.data[src + 1];
      out[dst + 2] = img.data[src + 2];
      out[dst + 3] = img.data[src + 3];
    }
  }
  return {width, height, data: out};
}

/** 90° counterclockwise rotation (turns a vertical text line into a horizontal strip). */
export function rotate90ccw(img: RgbaImage): RgbaImage {
  const {width: W, height: H} = img;
  const out = new Uint8Array(W * H * 4);
  for (let ys = 0; ys < H; ys++) {
    for (let xs = 0; xs < W; xs++) {
      const dx = ys; // (xs,ys) -> (ys, W-1-xs)
      const dy = W - 1 - xs;
      const src = (ys * W + xs) * 4;
      const dst = (dy * H + dx) * 4;
      out[dst] = img.data[src];
      out[dst + 1] = img.data[src + 1];
      out[dst + 2] = img.data[src + 2];
      out[dst + 3] = img.data[src + 3];
    }
  }
  return {width: H, height: W, data: out};
}

/** Grayscale (Rec. 601 luma), 0-255. */
export function toGray(img: RgbaImage): Float32Array {
  const out = new Float32Array(img.width * img.height);
  for (let i = 0, p = 0; i < out.length; i++, p += 4) {
    out[i] = 0.299 * img.data[p] + 0.587 * img.data[p + 1] + 0.114 * img.data[p + 2];
  }
  return out;
}

/**
 * RGB, normalized to [-1, 1] as CHW floats, padded (black, i.e. -1) on the
 * bottom/right so both dimensions are multiples of `multiple`.
 */
export function toChwNormalized(
  img: RgbaImage,
  multiple = 32,
): {tensor: Float32Array; width: number; height: number} {
  const w = Math.ceil(img.width / multiple) * multiple;
  const h = Math.ceil(img.height / multiple) * multiple;
  const out = new Float32Array(3 * w * h).fill(-1); // black after normalization
  for (let y = 0; y < img.height; y++) {
    for (let x = 0; x < img.width; x++) {
      const src = (y * img.width + x) * 4;
      const base = y * w + x;
      out[base] = img.data[src] / 127.5 - 1;
      out[w * h + base] = img.data[src + 1] / 127.5 - 1;
      out[2 * w * h + base] = img.data[src + 2] / 127.5 - 1;
    }
  }
  return {tensor: out, width: w, height: h};
}

/**
 * Normalize an RGBA strip to the rec input: height REC_H, width proportional
 * (capped at maxW, squashing longer lines), CHW in [-1, 1].
 */
export function stripToRecInput(
  img: RgbaImage,
  recH: number,
  maxW: number,
): {tensor: Float32Array; width: number} {
  const w = Math.max(16, Math.min(maxW, Math.round((img.width * recH) / img.height)));
  const scaled = resizeImage(img, w, recH);
  const out = new Float32Array(3 * recH * w);
  for (let y = 0; y < recH; y++) {
    for (let x = 0; x < w; x++) {
      const src = (y * w + x) * 4;
      const base = y * w + x;
      out[base] = scaled.data[src] / 127.5 - 1;
      out[recH * w + base] = scaled.data[src + 1] / 127.5 - 1;
      out[2 * recH * w + base] = scaled.data[src + 2] / 127.5 - 1;
    }
  }
  return {tensor: out, width: w};
}

// ---------------------------------------------------------------- geometry

/** Solve an 8x8 linear system (homography) by Gauss-Jordan elimination. */
function solve8(a: number[], b: number[]): number[] {
  const n = 8;
  const aug: number[][] = [];
  for (let r = 0; r < n; r++) {
    aug.push([a[r * 8], a[r * 8 + 1], a[r * 8 + 2], a[r * 8 + 3], a[r * 8 + 4], a[r * 8 + 5], a[r * 8 + 6], a[r * 8 + 7], b[r]]);
  }
  for (let col = 0; col < n; col++) {
    let pivot = col;
    for (let r = col + 1; r < n; r++) {
      if (Math.abs(aug[r][col]) > Math.abs(aug[pivot][col])) {
        pivot = r;
      }
    }
    const tmp = aug[col];
    aug[col] = aug[pivot];
    aug[pivot] = tmp;
    const p = aug[col][col];
    if (Math.abs(p) < 1e-12) {
      return new Array(n).fill(0);
    }
    for (let r = 0; r < n; r++) {
      if (r === col) {
        continue;
      }
      const f = aug[r][col] / p;
      for (let c = col; c <= n; c++) {
        aug[r][c] -= f * aug[col][c];
      }
    }
  }
  return aug.map((row, r) => row[n] / row[r]);
}

/**
 * Perspective crop: map the unit square onto the four corners (in order
 * top-left, top-right, bottom-right, bottom-left) and sample the image.
 */
export function cropPerspective(img: RgbaImage, corners: Point[], outW: number, outH: number): RgbaImage {
  const [tl, tr, br, bl] = corners;
  // Homography from the unit square to the quad (h33 = 1, 8 unknowns):
  //   X = (h11*u + h12*v + h13) / (h31*u + h32*v + 1)
  //   Y = (h21*u + h22*v + h23) / (h31*u + h32*v + 1)
  const q = [
    {u: 0, v: 0, p: tl},
    {u: 1, v: 0, p: tr},
    {u: 1, v: 1, p: br},
    {u: 0, v: 1, p: bl},
  ];
  const a: number[] = [];
  const b: number[] = [];
  for (const {u, v, p} of q) {
    a.push(u, v, 1, 0, 0, 0, -u * p.x, -v * p.x);
    b.push(p.x);
  }
  for (const {u, v, p} of q) {
    a.push(0, 0, 0, u, v, 1, -u * p.y, -v * p.y);
    b.push(p.y);
  }
  const h = solve8(a, b);
  const [h11, h12, h13, h21, h22, h23, h31, h32] = h;
  const out = new Uint8Array(outW * outH * 4);
  for (let y = 0; y < outH; y++) {
    const v = y / Math.max(outH - 1, 1);
    for (let x = 0; x < outW; x++) {
      const u = x / Math.max(outW - 1, 1);
      const d = h31 * u + h32 * v + 1;
      const sx = (h11 * u + h12 * v + h13) / d;
      const sy = (h21 * u + h22 * v + h23) / d;
      const o = (y * outW + x) * 4;
      if (sx < -0.5 || sy < -0.5 || sx > img.width - 0.5 || sy > img.height - 0.5) {
        out[o + 3] = 255;
        continue;
      }
      const fx = Math.min(Math.max(sx, 0), img.width - 1);
      const fy = Math.min(Math.max(sy, 0), img.height - 1);
      const x0 = Math.floor(fx);
      const y0 = Math.floor(fy);
      const x1 = Math.min(x0 + 1, img.width - 1);
      const y1 = Math.min(y0 + 1, img.height - 1);
      const wx = fx - x0;
      const wy = fy - y0;
      for (let c = 0; c < 3; c++) {
        const i00 = (y0 * img.width + x0) * 4 + c;
        const i10 = (y0 * img.width + x1) * 4 + c;
        const i01 = (y1 * img.width + x0) * 4 + c;
        const i11 = (y1 * img.width + x1) * 4 + c;
        const top = img.data[i00] * (1 - wx) + img.data[i10] * wx;
        const bottom = img.data[i01] * (1 - wx) + img.data[i11] * wx;
        out[o + c] = top * (1 - wy) + bottom * wy;
      }
      out[o + 3] = 255;
    }
  }
  return {width: outW, height: outH, data: out};
}
