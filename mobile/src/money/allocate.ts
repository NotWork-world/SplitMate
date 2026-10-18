// Integer primitives that conserve totals exactly. Mirrors server/app/money/allocate.py.
// Intermediate products use BigInt so amount × weight can never lose precision.

export function divRoundHalfUp(numerator: number, denominator: number): number {
  return Number(divRoundHalfUpBig(BigInt(numerator), BigInt(denominator)));
}

export function divRoundHalfUpBig(n: bigint, d: bigint): bigint {
  if (d <= 0n) {
    throw new Error('denominator must be positive');
  }
  if (n >= 0n) {
    return (2n * n + d) / (2n * d);
  }
  return -((2n * -n + d) / (2n * d));
}

/** a * b / d rounded half up, exact for any safe-integer inputs. */
export function mulDivRoundHalfUp(a: number, b: number, d: number): number {
  return Number(divRoundHalfUpBig(BigInt(a) * BigInt(b), BigInt(d)));
}

/**
 * Split `total` in proportion to `weights` with the largest-remainder rule.
 * Everyone gets floor(total * w / W); leftover units go one each to the largest
 * remainders, ties to the smaller key (plain string order, same as Python).
 */
export function allocate(total: number, weights: Array<[string, number]>): Record<string, number> {
  const keys = weights.map(([k]) => k);
  if (new Set(keys).size !== keys.length) {
    throw new Error('duplicate allocation keys');
  }
  if (weights.some(([, w]) => w < 0)) {
    throw new Error('weights must be non-negative');
  }
  const out: Record<string, number> = {};
  if (total === 0) {
    for (const k of keys) {
      out[k] = 0;
    }
    return out;
  }
  const weightSum = weights.reduce((s, [, w]) => s + BigInt(w), 0n);
  if (weightSum === 0n) {
    throw new Error('cannot allocate a non-zero total over zero weights');
  }
  const sign = total < 0 ? -1 : 1;
  const remaining = BigInt(Math.abs(total));
  const shares: Record<string, bigint> = {};
  const remainders: Array<[bigint, string]> = [];
  let given = 0n;
  for (const [k, w] of weights) {
    const p = remaining * BigInt(w);
    const q = p / weightSum;
    shares[k] = q;
    given += q;
    remainders.push([p % weightSum, k]);
  }
  let leftover = Number(remaining - given);
  remainders.sort((a, b) => (a[0] === b[0] ? cmp(a[1], b[1]) : a[0] > b[0] ? -1 : 1));
  for (const [, k] of remainders) {
    if (leftover <= 0) {
      break;
    }
    shares[k] += 1n;
    leftover -= 1;
  }
  for (const k of keys) {
    out[k] = sign * Number(shares[k]) + 0; // + 0 turns -0 into 0
  }
  return out;
}

export function allocateEqual(total: number, keys: string[]): Record<string, number> {
  return allocate(
    total,
    keys.map(k => [k, 1] as [string, number]),
  );
}

function cmp(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}
