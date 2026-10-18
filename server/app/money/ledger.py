"""Pure ledger maths: who owes whom, net balances, settlement suggestions.

Paying the merchant (contribution) and consuming (allocation) are separate
inputs. A member's net for an expense is paid - consumed. Members with a
negative net owe; members with a positive net are owed. A payer's own
consumption never creates an obligation to themselves.
"""

from __future__ import annotations

from collections.abc import Iterable, Mapping
from dataclasses import dataclass

from .allocate import allocate


@dataclass(frozen=True)
class Obligation:
    debtor: str
    creditor: str
    amount: int


class LedgerError(ValueError):
    pass


def expense_nets(paid: Mapping[str, int], consumed: Mapping[str, int]) -> dict[str, int]:
    if any(v < 0 for v in paid.values()) or any(v < 0 for v in consumed.values()):
        raise LedgerError("amounts must be non-negative")
    if sum(paid.values()) != sum(consumed.values()):
        raise LedgerError("payments must equal the expense total")
    members = set(paid) | set(consumed)
    return {m: paid.get(m, 0) - consumed.get(m, 0) for m in members}


def obligations_for_expense(paid: Mapping[str, int], consumed: Mapping[str, int]) -> list[Obligation]:
    """Directed debts created by one expense.

    Creditors are taken in member-id order; each creditor's credit is split
    across debtors in proportion to the debt they still have outstanding
    (largest remainder, ties by member id). Because credit <= remaining debt,
    no share can exceed a debtor's remaining deficit, and the last creditor
    receives exactly what is left. With a single payer this is simply "each
    consumer owes the payer their share".
    """
    nets = expense_nets(paid, consumed)
    creditors = sorted((m, n) for m, n in nets.items() if n > 0)
    debtors = sorted((m, -n) for m, n in nets.items() if n < 0)
    if not creditors:
        return []
    out: dict[tuple[str, str], int] = {}
    remaining_debt = dict(debtors)
    for creditor, credit in creditors:
        shares = allocate(credit, sorted(remaining_debt.items()))
        for debtor, amount in shares.items():
            if amount:
                out[(debtor, creditor)] = out.get((debtor, creditor), 0) + amount
                remaining_debt[debtor] -= amount
    if any(v != 0 for v in remaining_debt.values()):  # pragma: no cover - invariant
        raise LedgerError("obligations do not conserve the expense")
    return [Obligation(d, c, a) for (d, c), a in sorted(out.items())]


def net_balances(entries: Iterable[Obligation]) -> dict[str, int]:
    """Positive = is owed money, negative = owes money. Always sums to zero."""
    nets: dict[str, int] = {}
    for e in entries:
        nets[e.creditor] = nets.get(e.creditor, 0) + e.amount
        nets[e.debtor] = nets.get(e.debtor, 0) - e.amount
    return nets


def pairwise_balances(entries: Iterable[Obligation]) -> dict[tuple[str, str], int]:
    """Net debt per unordered pair, keyed (debtor, creditor) with amount > 0."""
    acc: dict[tuple[str, str], int] = {}
    for e in entries:
        a, b = sorted((e.debtor, e.creditor))
        sign = 1 if (e.debtor, e.creditor) == (a, b) else -1
        acc[(a, b)] = acc.get((a, b), 0) + sign * e.amount
    out: dict[tuple[str, str], int] = {}
    for (a, b), v in acc.items():
        if v > 0:
            out[(a, b)] = v
        elif v < 0:
            out[(b, a)] = -v
    return out


def settlement_suggestions(nets: Mapping[str, int]) -> list[Obligation]:
    """Fewest-practical transfers that clear every net balance.

    Greedy: repeatedly match the largest debtor with the largest creditor
    (ties broken by member id). Read-only advice; it never edits allocations.
    """
    if sum(nets.values()) != 0:
        raise LedgerError("net balances must sum to zero")
    debt = {m: -v for m, v in nets.items() if v < 0}
    cred = {m: v for m, v in nets.items() if v > 0}
    out: list[Obligation] = []
    while debt and cred:
        d = min(debt, key=lambda m: (-debt[m], m))
        c = min(cred, key=lambda m: (-cred[m], m))
        amount = min(debt[d], cred[c])
        out.append(Obligation(d, c, amount))
        debt[d] -= amount
        cred[c] -= amount
        if debt[d] == 0:
            del debt[d]
        if cred[c] == 0:
            del cred[c]
    return out
