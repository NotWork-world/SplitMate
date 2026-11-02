// CTC greedy decoding for the recognizer, and reading-order sort for lines.
// Convention verified against the real model (scripts/uniocr_smoke.py):
// classes = [blank, ...vocab(18,708), space]; drop text under 0.5 mean score.

export interface RecResult {
  text: string;
  score: number;
}

export function ctcDecode(
  out: Float32Array,
  steps: number,
  classes: number,
  vocab: string[],
  minScore = 0.5,
): RecResult {
  const chars: string[] = [];
  const kept: number[] = [];
  let prev = 0;
  for (let t = 0; t < steps; t++) {
    const base = t * classes;
    let best = 0;
    let bestIdx = 0;
    for (let c = 0; c < classes; c++) {
      const v = out[base + c];
      if (v > best) {
        best = v;
        bestIdx = c;
      }
    }
    if (bestIdx !== 0 && bestIdx !== prev) {
      if (bestIdx <= vocab.length) {
        chars.push(vocab[bestIdx - 1]);
      } else {
        chars.push(' ');
      }
      kept.push(best);
    }
    prev = bestIdx;
  }
  const text = chars.join('');
  const score = kept.length ? kept.reduce((a, b) => a + b, 0) / kept.length : 0;
  return {text: score >= minScore ? text : '', score};
}

export interface LineBox {
  left: number;
  top: number;
  width: number;
  height: number;
}

function median(nums: number[]): number {
  const s = nums.slice().sort((a, b) => a - b);
  return s.length ? s[Math.floor(s.length / 2)] : 0;
}

/**
 * Dominant slope of the text lines, from box centers. Same-row boxes far apart
 * horizontally all share one slope (one vote each), while noise pairs scatter
 * across slopes — so the busiest 0.02-wide bin is the page skew. Returns 0 for
 * upright pages (the 0.00 bin wins) and gives up when a photo is basically
 * sideways, which is EXIF's job to fix, not this.
 */
function lineSlope(centers: Array<{cx: number; cy: number; h: number}>): number {
  const minDx = Math.max(40, 2.5 * median(centers.map(c => c.h)));
  const bins = new Map<number, number[]>();
  for (let i = 0; i < centers.length; i++) {
    for (let j = i + 1; j < centers.length; j++) {
      const dx = centers[j].cx - centers[i].cx;
      if (Math.abs(dx) < minDx) {
        continue;
      }
      const s = (centers[j].cy - centers[i].cy) / dx;
      if (Math.abs(s) > 0.35) {
        continue; // > ~19°: not a readable tilt
      }
      const key = Math.round(s * 50) / 50;
      const list = bins.get(key);
      if (list) {
        list.push(s);
      } else {
        bins.set(key, [s]);
      }
    }
  }
  let best: number[] = [];
  for (const list of bins.values()) {
    if (list.length > best.length) {
      best = list;
    }
  }
  return best.length >= 5 ? median(best) : 0;
}

/** Reading order: de-skewed rows, then left to right inside a row. */
export function readingOrder<T extends LineBox>(lines: T[]): T[] {
  if (lines.length < 2) {
    return lines.slice();
  }
  const centers = lines.map(l => ({cx: l.left + l.width / 2, cy: l.top + l.height / 2, h: l.height}));
  const slope = lineSlope(centers);
  const keyed = lines
    .map((l, i) => ({line: l, y: centers[i].cy - slope * centers[i].cx, cx: centers[i].cx}))
    .sort((a, b) => a.y - b.y);
  const rows: Array<{ys: number[]; items: typeof keyed}> = [];
  for (const item of keyed) {
    const row = rows[rows.length - 1];
    if (row) {
      const ref = row.ys.reduce((a, b) => a + b, 0) / row.ys.length;
      const tol = Math.max(6, Math.min(item.line.height, median(row.items.map(r => r.line.height))) * 0.6);
      if (Math.abs(item.y - ref) <= tol) {
        row.ys.push(item.y);
        row.items.push(item);
        continue;
      }
    }
    rows.push({ys: [item.y], items: [item]});
  }
  return rows.flatMap(r => r.items.sort((a, b) => a.cx - b.cx).map(i => i.line));
}
