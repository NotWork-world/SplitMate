"""Persisted ledger: append-only entries, balances derived on read."""

from __future__ import annotations

import uuid
from collections import defaultdict

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from ..models import Expense, LedgerEntry
from ..money import Obligation, net_balances, pairwise_balances, settlement_suggestions


def write_expense_entries(db: Session, expense: Expense, version: int, obligations: list[Obligation]) -> None:
    for o in obligations:
        db.add(
            LedgerEntry(
                group_id=expense.group_id,
                currency=expense.currency,
                debtor_member_id=uuid.UUID(o.debtor),
                creditor_member_id=uuid.UUID(o.creditor),
                amount_minor=o.amount,
                kind="expense",
                expense_id=expense.id,
                expense_version=version,
            )
        )


def reverse_expense_entries(db: Session, expense: Expense) -> None:
    """Cancel the effect of the currently finalised version by appending swapped entries."""
    if expense.finalized_version is None:
        return
    current = db.scalars(
        select(LedgerEntry).where(
            LedgerEntry.expense_id == expense.id,
            LedgerEntry.expense_version == expense.finalized_version,
            LedgerEntry.kind == "expense",
        )
    ).all()
    for e in current:
        db.add(
            LedgerEntry(
                group_id=e.group_id,
                currency=e.currency,
                debtor_member_id=e.creditor_member_id,
                creditor_member_id=e.debtor_member_id,
                amount_minor=e.amount_minor,
                kind="reversal",
                expense_id=e.expense_id,
                expense_version=e.expense_version,
            )
        )


def _entries(db: Session, group_ids: list[uuid.UUID]) -> dict[tuple[uuid.UUID, str], list[Obligation]]:
    """Ledger rows aggregated per (group, currency, debtor, creditor)."""
    if not group_ids:
        return {}
    rows = db.execute(
        select(
            LedgerEntry.group_id,
            LedgerEntry.currency,
            LedgerEntry.debtor_member_id,
            LedgerEntry.creditor_member_id,
            func.sum(LedgerEntry.amount_minor),
        )
        .where(LedgerEntry.group_id.in_(group_ids))
        .group_by(
            LedgerEntry.group_id, LedgerEntry.currency, LedgerEntry.debtor_member_id, LedgerEntry.creditor_member_id
        )
    ).all()
    out: dict[tuple[uuid.UUID, str], list[Obligation]] = defaultdict(list)
    for gid, cur, d, c, amount in rows:
        out[(gid, cur)].append(Obligation(str(d), str(c), int(amount)))
    return out


def group_balances(db: Session, group_id: uuid.UUID) -> dict[str, dict]:
    """Per currency: member nets, pairwise debts and settlement suggestions."""
    result: dict[str, dict] = {}
    for (_, currency), entries in _entries(db, [group_id]).items():
        nets = {m: v for m, v in net_balances(entries).items()}
        result[currency] = {
            "nets": nets,
            "pairs": pairwise_balances(entries),
            "suggestions": settlement_suggestions(nets),
        }
    return result


def member_nets_for_groups(db: Session, group_ids: list[uuid.UUID]) -> dict[tuple[uuid.UUID, str], dict[str, int]]:
    return {k: net_balances(v) for k, v in _entries(db, group_ids).items()}


def pair_outstanding(db: Session, group_id: uuid.UUID, currency: str, debtor: uuid.UUID, creditor: uuid.UUID) -> int:
    """How much ``debtor`` currently owes ``creditor`` (0 if nothing or the other way round)."""
    entries = _entries(db, [group_id]).get((group_id, currency), [])
    return pairwise_balances(entries).get((str(debtor), str(creditor)), 0)
