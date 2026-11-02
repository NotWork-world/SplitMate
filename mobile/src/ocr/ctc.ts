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

/** Reading order: rows by vertical overlap, then left to right inside a row. */
export function readingOrder<T extends LineBox>(lines: T[]): T[] {
  const sorted = lines.slice().sort((a, b) => a.top + a.height / 2 - (b.top + b.height / 2));
  const rows: T[][] = [];
  for (const line of sorted) {
    const cy = line.top + line.height / 2;
    const row = rows.find(r => {
      const first = r[0];
      const ref = first.top + first.height / 2;
      const tol = Math.max(6, Math.min(first.height, line.height) * 0.55);
      return Math.abs(cy - ref) <= tol;
    });
    if (row) {
      row.push(line);
    } else {
      rows.push([line]);
    }
  }
  return rows.flatMap(r => r.sort((a, b) => a.left - b.left));
}
