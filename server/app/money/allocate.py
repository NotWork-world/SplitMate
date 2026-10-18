"""Integer arithmetic primitives that conserve totals exactly."""

from __future__ import annotations

from collections.abc import Sequence


def div_round_half_up(numerator: int, denominator: int) -> int:
    """Round numerator/denominator to the nearest integer, halves away from zero."""
    if denominator <= 0:
        raise ValueError("denominator must be positive")
    if numerator >= 0:
        return (2 * numerator + denominator) // (2 * denominator)
    return -((2 * -numerator + denominator) // (2 * denominator))


def allocate(total: int, weights: Sequence[tuple[str, int]]) -> dict[str, int]:
    """Split ``total`` in proportion to ``weights`` using the largest-remainder rule.

    Everyone first receives floor(total * w / W). The units still left over go,
    one each, to the largest fractional remainders; ties go to the smaller key
    (plain string comparison, identical in the TypeScript port). The result
    always sums to ``total`` exactly. Negative totals are split as their absolute
    value and negated, so the rule is symmetric.
    """
    keys = [k for k, _ in weights]
    if len(set(keys)) != len(keys):
        raise ValueError("duplicate allocation keys")
    if any(w < 0 for _, w in weights):
        raise ValueError("weights must be non-negative")
    if total == 0:
        return {k: 0 for k in keys}
    weight_sum = sum(w for _, w in weights)
    if weight_sum == 0:
        raise ValueError("cannot allocate a non-zero total over zero weights")

    sign = -1 if total < 0 else 1
    remaining = abs(total)
    shares: dict[str, int] = {}
    remainders: list[tuple[int, str]] = []
    for key, w in weights:
        q, r = divmod(remaining * w, weight_sum)
        shares[key] = q
        remainders.append((r, key))
    leftover = remaining - sum(shares.values())
    remainders.sort(key=lambda rk: (-rk[0], rk[1]))
    for _, key in remainders[:leftover]:
        shares[key] += 1
    return {k: sign * v for k, v in shares.items()}


def allocate_equal(total: int, keys: Sequence[str]) -> dict[str, int]:
    return allocate(total, [(k, 1) for k in keys])
