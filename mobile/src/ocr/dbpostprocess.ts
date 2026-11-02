// DB (Differentiable Binarization) postprocess: turn the detector's probability
// map into rotated text boxes, exactly like RapidOCR / PaddleOCR (constants from
// the package manifest, verified in scripts/uniocr_smoke.py):
//   prob > 0.3 mask -> connected components -> box score >= 0.5 (mean prob)
//   -> min-area rect -> unclip by area*1.6/perimeter -> min size 3.
// Pure TypeScript: no React Native imports, testable in Node.

import {Point} from './imageops';

export interface Box {
  /** Corners in reading order: top-left, top-right, bottom-right, bottom-left. */
  corners: [Point, Point, Point, Point];
  score: number;
}

export interface DbConfig {
  probThresh: number; // 0.3
  boxThresh: number; // 0.5
  unclipRatio: number; // 1.6
  minSize: number; // 3 px
}

export const DB_DEFAULTS: DbConfig = {probThresh: 0.3, boxThresh: 0.5, unclipRatio: 1.6, minSize: 3};

/**
 * Connected components over a boolean mask (4-connectivity, iterative flood
 * fill so there is no recursion limit on big maps). Returns per component the
 * list of pixel indices and the sum of the probability there.
 */
export function connectedComponents(
  mask: Uint8Array,
  width: number,
  height: number,
): Array<{pixels: Int32Array; probSum: number}> {
  const seen = new Uint8Array(width * height);
  const out: Array<{pixels: Int32Array; probSum: number}> = [];
  const stack = new Int32Array(width * height);
  for (let start = 0; start < mask.length; start++) {
    if (!mask[start] || seen[start]) {
      continue;
    }
    let top = 0;
    stack[top++] = start;
    seen[start] = 1;
    const pixels: number[] = [];
    let probSum = 0;
    while (top > 0) {
      const p = stack[--top];
      pixels.push(p);
      probSum += mask[p];
      const x = p % width;
      const y = (p / width) | 0;
      if (x > 0 && mask[p - 1] && !seen[p - 1]) {
        seen[p - 1] = 1;
        stack[top++] = p - 1;
      }
      if (x < width - 1 && mask[p + 1] && !seen[p + 1]) {
        seen[p + 1] = 1;
        stack[top++] = p + 1;
      }
      if (y > 0 && mask[p - width] && !seen[p - width]) {
        seen[p - width] = 1;
        stack[top++] = p - width;
      }
      if (y < height - 1 && mask[p + width] && !seen[p + width]) {
        seen[p + width] = 1;
        stack[top++] = p + width;
      }
    }
    out.push({pixels: Int32Array.from(pixels), probSum});
  }
  return out;
}

// ---------------------------------------------------------------- min-area rect

/** Andrew's monotone chain convex hull. */
export function convexHull(points: Point[]): Point[] {
  if (points.length < 4) {
    return points.slice();
  }
  const pts = points.slice().sort((a, b) => (a.x === b.x ? a.y - b.y : a.x - b.x));
  const cross = (o: Point, a: Point, b: Point) => (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);
  const lower: Point[] = [];
  for (const p of pts) {
    while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], p) <= 0) {
      lower.pop();
    }
    lower.push(p);
  }
  const upper: Point[] = [];
  for (let i = pts.length - 1; i >= 0; i--) {
    const p = pts[i];
    while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], p) <= 0) {
      upper.pop();
    }
    upper.push(p);
  }
  upper.pop();
  lower.pop();
  return lower.concat(upper);
}

export interface Rect {
  cx: number;
  cy: number;
  width: number;
  height: number;
  angle: number; // degrees, OpenCV convention: 0 <= angle < 90
}

/**
 * Minimum-area bounding rectangle of a point set (convex hull + rotating
 * calipers), always parameterised with `width` = the longer side: the rect's
 * corners are centre + R(angle)·(±width/2, ±height/2) and no post-hoc swapping
 * is needed (a swap plus an angle offset would transpose the rect).
 */
export function minAreaRect(points: Point[]): Rect {
  const hull = convexHull(points);
  if (hull.length < 2) {
    const p = hull[0] ?? {x: 0, y: 0};
    return {cx: p.x, cy: p.y, width: 1, height: 1, angle: 0};
  }
  let best: Rect | null = null;
  let bestArea = Infinity;
  for (let i = 0; i < hull.length; i++) {
    const a = hull[i];
    const b = hull[(i + 1) % hull.length];
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const len = Math.hypot(dx, dy);
    if (len < 1e-9) {
      continue;
    }
    const ux = dx / len;
    const uy = dy / len;
    const vx = -uy;
    const vy = ux;
    let minU = Infinity;
    let maxU = -Infinity;
    let minV = Infinity;
    let maxV = -Infinity;
    for (const p of hull) {
      const pu = (p.x - a.x) * ux + (p.y - a.y) * uy;
      const pv = (p.x - a.x) * vx + (p.y - a.y) * vy;
      if (pu < minU) {
        minU = pu;
      }
      if (pu > maxU) {
        maxU = pu;
      }
      if (pv < minV) {
        minV = pv;
      }
      if (pv > maxV) {
        maxV = pv;
      }
    }
    const w = maxU - minU;
    const h = maxV - minV;
    if (w < h) {
      continue; // the perpendicular hull edge covers this parameterisation
    }
    const area = w * h;
    if (area < bestArea) {
      bestArea = area;
      const cx = a.x + ux * (minU + maxU) / 2 + vx * (minV + maxV) / 2;
      const cy = a.y + uy * (minU + maxU) / 2 + vy * (minV + maxV) / 2;
      const angle = (Math.atan2(uy, ux) * 180) / Math.PI;
      best = {cx, cy, width: w, height: h, angle};
    }
  }
  return best ?? {cx: 0, cy: 0, width: 1, height: 1, angle: 0};
}

/** Expand a rotated rect outward by area*unclipRatio/perimeter (exact for rects). */
export function unclipRect(r: Rect, ratio: number): Rect {
  if (r.width <= 0 || r.height <= 0) {
    return r;
  }
  const d = (r.width * r.height * ratio) / (2 * (r.width + r.height));
  return {cx: r.cx, cy: r.cy, width: r.width + 2 * d, height: r.height + 2 * d, angle: r.angle};
}

/** The four corners of a rotated rect, ordered top-left → top-right → bottom-right → bottom-left. */
export function rectCorners(r: Rect): [Point, Point, Point, Point] {
  const a = (r.angle * Math.PI) / 180;
  const cos = Math.cos(a);
  const sin = Math.sin(a);
  const dx = r.width / 2;
  const dy = r.height / 2;
  const local: Point[] = [
    {x: -dx, y: -dy},
    {x: dx, y: -dy},
    {x: dx, y: dy},
    {x: -dx, y: dy},
  ];
  const world = local.map(p => ({x: r.cx + p.x * cos - p.y * sin, y: r.cy + p.x * sin + p.y * cos}));
  // Robust visual ordering (the same trick OpenCV OCR pipelines use):
  // TL = min(x+y), BR = max(x+y), TR = min(y-x), BL = max(y-x). This stays
  // correct whatever angle the rect math produced.
  const at = (i: number) => world[i];
  let tl = 0;
  let br = 0;
  let tr = 0;
  let bl = 0;
  for (let i = 1; i < 4; i++) {
    const s = world[i].x + world[i].y;
    const d = world[i].y - world[i].x;
    if (s < world[tl].x + world[tl].y) {
      tl = i;
    }
    if (s > world[br].x + world[br].y) {
      br = i;
    }
    if (d < world[tr].y - world[tr].x) {
      tr = i;
    }
    if (d > world[bl].y - world[bl].x) {
      bl = i;
    }
  }
  return [at(tl), at(tr), at(br), at(bl)];
}

/**
 * Full DB postprocess. `prob` is the detector's [1,1,H,W] output (already
 * sigmoid'd — the bundled model is), at `scale` of the original image size.
 */
export function dbBoxes(
  prob: Float32Array,
  width: number,
  height: number,
  scale: number,
  cfg: DbConfig = DB_DEFAULTS,
): Box[] {
  const mask = new Uint8Array(width * height);
  for (let i = 0; i < mask.length; i++) {
    mask[i] = prob[i] > cfg.probThresh ? 1 : 0;
  }
  const boxes: Box[] = [];
  for (const cc of connectedComponents(mask, width, height)) {
    if (cc.pixels.length < cfg.minSize * cfg.minSize) {
      continue;
    }
    const score = cc.probSum / cc.pixels.length;
    if (score < cfg.boxThresh) {
      continue;
    }
    const points: Point[] = new Array(cc.pixels.length);
    for (let i = 0; i < cc.pixels.length; i++) {
      const p = cc.pixels[i];
      points[i] = {x: p % width, y: (p / width) | 0};
    }
    let rect = minAreaRect(points);
    rect = unclipRect(rect, cfg.unclipRatio);
    if (Math.min(rect.width, rect.height) < cfg.minSize + 2) {
      continue;
    }
    const corners = rectCorners(rect).map(p => ({x: p.x / scale, y: p.y / scale})) as [Point, Point, Point, Point];
    boxes.push({corners, score});
  }
  return boxes;
}
