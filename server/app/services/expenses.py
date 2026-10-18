"""Expense workflows. The server always recomputes; client totals are only compared."""

from __future__ import annotations

import uuid
from typing import Any

from sqlalchemy import select
from sqlalchemy.orm import Session, selectinload

from ..core.errors import ApiError, conflict, forbidden, invalid, not_found
from ..deps import group_member_ids, membership
from ..integrations.storage import get_storage
from ..models import (
    Expense,
    ExpenseAllocation,
    ExpenseCharge,
    ExpenseDiscount,
    ExpenseItem,
    ExpensePayer,
    ExpenseReportedTax,
    ExpenseTaxLine,
    ExpenseVersion,
    GroupMember,
    ItemConsumer,
    ReceiptAttachment,
    User,
    utcnow,
)
from ..money import BillInput, BillResult, compute_bill, obligations_for_expense
from ..money.currency import UnknownCurrency, get_currency
from ..schemas import ExpenseIn
from . import activity
from . import ledger as ledger_svc


def load(db: Session, expense_id: uuid.UUID, user: User, *, lock: bool = False) -> tuple[Expense, GroupMember]:
    q = (
        select(Expense)
        .where(Expense.id == expense_id)
        .options(
            selectinload(Expense.items).selectinload(ExpenseItem.consumers),
            selectinload(Expense.discounts),
            selectinload(Expense.charges),
            selectinload(Expense.reported_taxes),
            selectinload(Expense.payers),
            selectinload(Expense.allocations),
            selectinload(Expense.tax_lines),
        )
    )
    if lock:
        q = q.with_for_update(of=Expense)
    expense = db.scalar(q)
    if expense is None:
        raise not_found("Expense")
    try:
        me = membership(db, expense.group_id, user)
    except ApiError:
        raise not_found("Expense") from None
    return expense, me


# ------------------------------------------------------------------ input <-> engine


def bill_input_from_payload(data: ExpenseIn) -> dict[str, Any]:
    """Engine input built straight from a request (used by preview)."""
    return {
        "currency": data.currency,
        "items": [
            {
                "id": it.client_id,
                "name": it.name,
                "quantity_milli": it.quantity_milli,
                "unit_price_minor": it.unit_price_minor,
                "discount": it.discount.model_dump() if it.discount else None,
                "tax_rate_bp": it.tax_rate_bp,
                "tax_inclusive": it.tax_inclusive,
                "tax_scheme": it.tax_scheme,
                "split_mode": it.split_mode,
                "consumers": [{"member_id": str(c.member_id), "value": c.value} for c in it.consumers],
            }
            for it in data.items
        ],
        "discounts": [
            {
                "id": d.client_id, "label": d.label, "kind": d.kind, "value": d.value, "stage": d.stage,
                "allocation": d.allocation, "item_ids": d.item_client_ids, "is_coupon": d.is_coupon,
            }
            for d in data.discounts
        ],
        "charges": [
            {
                "id": c.client_id, "label": c.label, "type": c.type, "kind": c.kind, "value": c.value,
                "tax_rate_bp": c.tax_rate_bp, "tax_scheme": c.tax_scheme, "allocation": c.allocation,
            }
            for c in data.charges
        ],
        "reported_taxes": [t.model_dump() for t in data.reported_taxes],
        "rounding": data.rounding.model_dump(),
        "receipt_total_minor": data.receipt_total_minor,
    }


def bill_input_from_expense(e: Expense) -> dict[str, Any]:
    return {
        "currency": e.currency,
        "items": [
            {
                "id": it.client_id,
                "name": it.name,
                "quantity_milli": it.quantity_milli,
                "unit_price_minor": it.unit_price_minor,
                "discount": {"kind": it.discount_kind, "value": it.discount_value} if it.discount_kind else None,
                "tax_rate_bp": it.tax_rate_bp,
                "tax_inclusive": it.tax_inclusive,
                "tax_scheme": it.tax_scheme,
                "split_mode": it.split_mode,
                "consumers": [
                    {"member_id": str(c.member_id), "value": c.value}
                    for c in sorted(it.consumers, key=lambda c: str(c.member_id))
                ],
            }
            for it in e.items
        ],
        "discounts": [
            {
                "id": d.client_id, "label": d.label, "kind": d.kind, "value": d.value, "stage": d.stage,
                "allocation": d.allocation, "item_ids": d.item_client_ids, "is_coupon": d.is_coupon,
            }
            for d in e.discounts
        ],
        "charges": [
            {
                "id": c.client_id, "label": c.label, "type": c.type, "kind": c.kind, "value": c.value,
                "tax_rate_bp": c.tax_rate_bp, "tax_scheme": c.tax_scheme, "allocation": c.allocation,
            }
            for c in e.charges
        ],
        "reported_taxes": [
            {"component": t.component, "rate_bp": t.rate_bp, "amount_minor": t.amount_minor} for t in e.reported_taxes
        ],
        "rounding": {"mode": e.rounding_mode, "amount_minor": e.rounding_minor},
        "receipt_total_minor": e.receipt_total_minor,
    }


def calculate(bill_input: dict[str, Any]) -> BillResult:
    return compute_bill(BillInput.from_dict(bill_input))


# ------------------------------------------------------------------ validation


def _validate_payload(db: Session, group_id: uuid.UUID, data: ExpenseIn, *, strict: bool) -> None:
    """Checks that don't depend on the calculation. ``strict`` = needed for finalisation."""
    try:
        get_currency(data.currency)
    except UnknownCurrency:
        raise invalid("unknown_currency", f"Currency {data.currency} isn't supported.") from None
    active = group_member_ids(db, group_id)
    known = group_member_ids(db, group_id, active_only=False)
    ids = [it.client_id for it in data.items]
    if len(set(ids)) != len(ids):
        raise invalid("duplicate_item", "Two items share the same id.")
    for it in data.items:
        for c in it.consumers:
            if c.member_id not in known:
                raise invalid("unknown_member", "An item is assigned to someone who isn't in this group.")
            if strict and c.member_id not in active:
                raise invalid("inactive_member", "An item is assigned to someone who has left the group.")
    payer_ids = [p.member_id for p in data.payers]
    if len(set(payer_ids)) != len(payer_ids):
        raise invalid("duplicate_payer", "A payer is listed twice.")
    for p in data.payers:
        if p.member_id not in known:
            raise invalid("unknown_member", "The payer isn't in this group.")
        if strict and p.member_id not in active:
            raise invalid("inactive_member", "The payer has left the group.")
    for d in data.discounts:
        if d.item_client_ids and not set(d.item_client_ids) <= set(ids):
            raise invalid("invalid_discount", f"{d.label}: refers to an item that isn't on the bill.")
    if data.receipt_id is not None:
        receipt = db.get(ReceiptAttachment, data.receipt_id)
        if receipt is None or receipt.group_id != group_id or receipt.deleted_at:
            raise invalid("invalid_receipt", "That receipt isn't available in this group.")


def resolve_payers(payers: list[ExpensePayer] | list, total: int) -> dict[str, int]:
    """Payer amounts for a total. A single payer without an amount pays everything."""
    if not payers:
        raise invalid("no_payer", "Choose who paid.")
    if len(payers) == 1 and payers[0].amount_minor is None:
        return {str(payers[0].member_id): total}
    if any(p.amount_minor is None for p in payers):
        raise invalid("payer_amount_missing", "With more than one payer, enter how much each person paid.")
    amounts = {str(p.member_id): int(p.amount_minor) for p in payers}
    paid = sum(amounts.values())
    if paid != total:
        raise invalid(
            "payers_mismatch",
            "What the payers paid doesn't add up to the bill total.",
            {"paid_minor": paid, "total_minor": total},
        )
    return {k: v for k, v in amounts.items() if v}


# ------------------------------------------------------------------ persistence


def _apply_payload(db: Session, e: Expense, data: ExpenseIn) -> None:
    if e.id is not None and e in db:
        # Delete old child rows before inserting new ones (client ids are unique per expense).
        e.items, e.discounts, e.charges, e.reported_taxes, e.payers = [], [], [], [], []
        e.allocations, e.tax_lines = [], []
        db.flush()
    e.title, e.category, e.notes = data.title, data.category, data.notes
    e.expense_date, e.currency, e.split_kind = data.expense_date, data.currency, data.split_kind
    e.receipt_total_minor = data.receipt_total_minor
    e.rounding_mode, e.rounding_minor = data.rounding.mode, data.rounding.amount_minor
    e.receipt_id = data.receipt_id
    e.items = [
        ExpenseItem(
            client_id=it.client_id,
            position=n,
            name=it.name,
            quantity_milli=it.quantity_milli,
            unit_price_minor=it.unit_price_minor,
            discount_kind=it.discount.kind if it.discount else None,
            discount_value=it.discount.value if it.discount else None,
            tax_rate_bp=it.tax_rate_bp,
            tax_inclusive=it.tax_inclusive,
            tax_scheme=it.tax_scheme,
            split_mode=it.split_mode,
            review_state=it.review_state,
            source=it.source,
            ocr_confidence=it.ocr_confidence,
            consumers=[ItemConsumer(member_id=c.member_id, value=c.value) for c in it.consumers],
        )
        for n, it in enumerate(data.items)
    ]
    e.discounts = [
        ExpenseDiscount(
            client_id=d.client_id, position=n, label=d.label or "Discount", kind=d.kind, value=d.value,
            stage=d.stage, allocation=d.allocation, item_client_ids=d.item_client_ids, is_coupon=d.is_coupon,
        )
        for n, d in enumerate(data.discounts)
    ]
    e.charges = [
        ExpenseCharge(
            client_id=c.client_id, position=n, label=c.label or c.type.title(), type=c.type, kind=c.kind,
            value=c.value, tax_rate_bp=c.tax_rate_bp, tax_scheme=c.tax_scheme, allocation=c.allocation,
        )
        for n, c in enumerate(data.charges)
    ]
    e.reported_taxes = [
        ExpenseReportedTax(component=t.component, rate_bp=t.rate_bp, amount_minor=t.amount_minor)
        for t in data.reported_taxes
    ]
    e.payers = [ExpensePayer(member_id=p.member_id, amount_minor=p.amount_minor) for p in data.payers]


def create_draft(db: Session, user: User, group_id: uuid.UUID, data: ExpenseIn) -> Expense:
    membership(db, group_id, user)
    _validate_payload(db, group_id, data, strict=False)
    e = Expense(group_id=group_id, created_by=user.id, status="draft", version=1)
    _apply_payload(db, e, data)
    db.add(e)
    db.flush()
    activity.audit(db, actor=user, action="expense.draft_created", entity_type="expense", entity_id=e.id)
    return e


def can_manage(e: Expense, me: GroupMember) -> bool:
    return e.created_by == me.user_id or me.role in ("owner", "admin")


def update(db: Session, user: User, expense_id: uuid.UUID, data: ExpenseIn, expected_version: int) -> Expense:
    """Save a draft, or save-and-recalculate a finalised expense atomically."""
    e, me = load(db, expense_id, user, lock=True)
    if e.status == "cancelled":
        raise conflict("expense_cancelled", "This expense was cancelled and can't be edited.")
    if e.version != expected_version:
        raise conflict("version_conflict", "Someone else changed this expense. Reload to see the latest version.",
                       {"current_version": e.version})
    if e.status == "finalized" and not can_manage(e, me):
        raise forbidden("Only the person who added this expense or a group admin can edit it.")
    _validate_payload(db, e.group_id, data, strict=e.status == "finalized")

    if e.status == "draft":
        _apply_payload(db, e, data)
        e.version += 1
        db.flush()
        return e

    # Editing a finalised expense: validate the new version completely before touching the ledger.
    bill_input = bill_input_from_payload(data)
    result = calculate(bill_input)
    _require_finalizable(result)
    paid = resolve_payers(data.payers, result.total)
    before_total = e.total_minor
    ledger_svc.reverse_expense_entries(db, e)
    _apply_payload(db, e, data)
    e.version += 1
    db.flush()
    _persist_finalization(db, user, e, bill_input, result, paid)
    activity.record(
        db, actor=user, type="expense.updated", entity_type="expense", entity_id=e.id, group_id=e.group_id,
        data={"title": e.title, "total_minor": e.total_minor, "previous_total_minor": before_total,
              "currency": e.currency, "version": e.version},
    )
    activity.audit(db, actor=user, action="expense.edited", entity_type="expense", entity_id=e.id,
                   data={"version": e.version, "previous_total_minor": before_total, "total_minor": e.total_minor})
    return e


def _require_finalizable(result: BillResult) -> None:
    blocking = [i for i in result.issues if i.blocking]
    if blocking:
        raise invalid(
            "expense_not_ready",
            "This bill can't be finalised yet. " + blocking[0].message,
            [{"code": i.code, "message": i.message, "ref": i.ref} for i in blocking],
        )
    if result.total <= 0:
        raise invalid("expense_not_ready", "The bill total must be more than zero.")


def finalize(db: Session, user: User, expense_id: uuid.UUID, expected_version: int, client_total: int | None) -> Expense:
    e, me = load(db, expense_id, user, lock=True)
    if e.status == "finalized" and e.finalized_version == expected_version:
        return e  # already done by an earlier identical request: no second set of entries
    if e.status != "draft":
        raise conflict("not_a_draft", "Only drafts can be finalised.")
    if e.version != expected_version:
        raise conflict("version_conflict", "This draft changed since you reviewed it. Review it again.",
                       {"current_version": e.version})
    bill_input = bill_input_from_expense(e)
    result = calculate(bill_input)
    _require_finalizable(result)
    active = group_member_ids(db, e.group_id)
    if any(uuid.UUID(p.member_id) not in active for p in result.people) or any(
        p.member_id not in active for p in e.payers
    ):
        raise invalid("inactive_member", "Someone on this bill has left the group.")
    if client_total is not None and client_total != result.total:
        raise conflict(
            "total_changed",
            "The total you reviewed doesn't match the server's calculation. Review the bill again.",
            {"server_total_minor": result.total, "client_total_minor": client_total},
        )
    paid = resolve_payers(e.payers, result.total)
    _persist_finalization(db, user, e, bill_input, result, paid)
    activity.record(
        db, actor=user, type="expense.finalized", entity_type="expense", entity_id=e.id, group_id=e.group_id,
        data={"title": e.title, "total_minor": e.total_minor, "currency": e.currency},
    )
    activity.audit(db, actor=user, action="expense.finalized", entity_type="expense", entity_id=e.id,
                   data={"version": e.version, "total_minor": e.total_minor})
    return e


def discard_receipt_image(db: Session, e: Expense) -> None:
    """The bill photo is only needed while splitting. Once the bill is final (or dropped),
    delete the file so storage never grows; the items, prices and tax stay in the database.
    Call after the expense is committed, so a failed save never loses the photo."""
    if e.receipt_id is None or e.status == "draft":
        return
    rec = db.get(ReceiptAttachment, e.receipt_id)
    e.receipt_id = None
    if rec is not None and rec.deleted_at is None:
        try:
            get_storage().delete(rec.storage_key)
        except Exception:  # storage hiccup: the sweep in receipts.upload retries later
            db.commit()
            return
        rec.deleted_at = utcnow()
    db.commit()


def _persist_finalization(
    db: Session, user: User, e: Expense, bill_input: dict[str, Any], result: BillResult, paid: dict[str, int]
) -> None:
    consumed = {p.member_id: p.total for p in result.people if p.total}
    obligations = obligations_for_expense(paid, consumed)

    by_item = {r.id: r for r in result.items}
    for it in e.items:
        r = by_item[it.client_id]
        it.gross_minor, it.discount_minor, it.bill_discount_minor = r.gross, r.item_discount, r.bill_discount
        it.tax_minor, it.total_minor = r.tax, r.total
        share = {s.member_id: s.total for s in r.shares}
        for c in it.consumers:
            c.allocated_minor = share.get(str(c.member_id), 0)
    disc = {d.id: d for d in result.discounts}
    for d in e.discounts:
        d.amount_minor = disc[d.client_id].amount if d.client_id in disc else 0
    ch = {c.id: c for c in result.charge_lines}
    for c in e.charges:
        c.amount_minor = ch[c.client_id].amount if c.client_id in ch else 0
        c.tax_minor = ch[c.client_id].tax if c.client_id in ch else 0

    e.allocations = [
        ExpenseAllocation(
            member_id=uuid.UUID(p.member_id),
            amount_minor=p.total,
            breakdown={k: getattr(p, k) for k in (
                "gross", "item_discounts", "bill_discounts", "tax_added", "tax_included",
                "charges", "post_tax_discounts", "rounding",
            )} | {"items": p.items},
        )
        for p in result.people
    ]
    e.tax_lines = [
        ExpenseTaxLine(
            component=t.component, component_rate_bp=t.component_rate_bp, group_rate_bp=t.group_rate_bp,
            scheme=t.scheme, inclusive=t.inclusive, taxable_base_minor=t.taxable_base, amount_minor=t.amount,
            computed_amount_minor=t.computed_amount, source=t.source,
        )
        for t in result.tax_lines
    ]
    e.status = "finalized"
    e.total_minor = result.total
    e.engine_version = result.engine_version
    e.finalized_version = e.version
    e.finalized_at = utcnow()
    for it in e.items:
        if it.review_state == "pending" and it.consumers:
            it.review_state = "claimed"
    db.add(
        ExpenseVersion(
            expense_id=e.id, version=e.version, actor_user_id=user.id, bill_input=bill_input,
            calculation=result.to_dict(), payers=paid, total_minor=result.total,
        )
    )
    ledger_svc.write_expense_entries(db, e, e.version, obligations)
    db.flush()


def cancel(db: Session, user: User, expense_id: uuid.UUID, expected_version: int, reason: str | None) -> Expense | None:
    """Cancel a finalised expense (ledger reversed, history kept) or delete a draft."""
    e, me = load(db, expense_id, user, lock=True)
    if e.version != expected_version:
        raise conflict("version_conflict", "This expense changed. Reload and try again.", {"current_version": e.version})
    if e.status == "cancelled":
        return e
    if e.status == "draft":
        if not (can_manage(e, me) or e.created_by is None):
            raise forbidden("Only the person who started this draft or a group admin can delete it.")
        activity.audit(db, actor=user, action="expense.draft_deleted", entity_type="expense", entity_id=e.id)
        db.delete(e)
        db.flush()
        return None
    if not can_manage(e, me):
        raise forbidden("Only the person who added this expense or a group admin can cancel it.")
    ledger_svc.reverse_expense_entries(db, e)
    e.status = "cancelled"
    e.cancelled_at = utcnow()
    e.version += 1
    db.flush()
    activity.record(
        db, actor=user, type="expense.cancelled", entity_type="expense", entity_id=e.id, group_id=e.group_id,
        data={"title": e.title, "total_minor": e.total_minor, "currency": e.currency, "reason": reason},
    )
    activity.audit(db, actor=user, action="expense.cancelled", entity_type="expense", entity_id=e.id,
                   data={"reason": reason})
    return e
