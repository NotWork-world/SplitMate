from __future__ import annotations

import uuid
from typing import Any

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from ..core.errors import ApiError
from ..models import Expense, ExpenseVersion, Group, GroupMember, Repayment, User
from ..schemas import BalanceLine, GroupOut, MemberOut, RepaymentEventOut, RepaymentOut
from ..services import expenses as expense_svc
from ..services import ledger as ledger_svc
from ..services import repayments as repayment_svc


def member_out(m: GroupMember, me: GroupMember | None = None) -> MemberOut:
    user = m.user
    return MemberOut(
        id=m.id,
        display_name=m.display_name,
        user_id=m.user_id,
        role=m.role,
        status=m.status,
        is_me=me is not None and m.id == me.id,
        is_registered=m.user_id is not None,
        avatar_hue=user.avatar_hue if user else (int(m.id.hex[:4], 16) % 360),
        upi_id=user.upi_id if user and m.status == "active" else None,
        username=user.username if user else None,
    )


def group_out(db: Session, g: Group, me: GroupMember, nets: dict | None = None) -> GroupOut:
    if nets is None:
        nets = ledger_svc.member_nets_for_groups(db, [g.id])
    balances = [
        BalanceLine(currency=cur, amount_minor=v.get(str(me.id), 0))
        for (gid, cur), v in sorted(nets.items(), key=lambda kv: kv[0][1])
        if gid == g.id and v.get(str(me.id), 0) != 0
    ]
    count = db.scalar(
        select(func.count()).select_from(Expense).where(Expense.group_id == g.id, Expense.status == "finalized")
    )
    return GroupOut(
        id=g.id,
        name=g.name,
        type=g.type,
        emoji=g.emoji,
        currency=g.currency,
        start_date=g.start_date,
        end_date=g.end_date,
        archived=g.archived_at is not None,
        created_at=g.created_at,
        my_member_id=me.id,
        my_role=me.role,
        members=[member_out(m, me) for m in g.members if m.status == "active"],
        my_balances=balances,
        expense_count=count or 0,
    )


def _items_out(e: Expense) -> list[dict[str, Any]]:
    return [
        {
            "client_id": it.client_id,
            "name": it.name,
            "quantity_milli": it.quantity_milli,
            "unit_price_minor": it.unit_price_minor,
            "discount": {"kind": it.discount_kind, "value": it.discount_value} if it.discount_kind else None,
            "tax_rate_bp": it.tax_rate_bp,
            "tax_inclusive": it.tax_inclusive,
            "tax_scheme": it.tax_scheme,
            "split_mode": it.split_mode,
            "consumers": [{"member_id": str(c.member_id), "value": c.value} for c in it.consumers],
            "review_state": it.review_state,
            "source": it.source,
            "ocr_confidence": it.ocr_confidence,
        }
        for it in e.items
    ]


def expense_out(db: Session, e: Expense, me: GroupMember) -> dict[str, Any]:
    group = db.get(Group, e.group_id)
    if e.status == "draft":
        calc = expense_svc.calculate(expense_svc.bill_input_from_expense(e)).to_dict()
        try:
            paid = expense_svc.resolve_payers(e.payers, calc["total"])
            payer_issue = None
        except ApiError as exc:  # shown to the user as a finalisation blocker
            paid, payer_issue = {}, exc.message
        if payer_issue:
            calc["issues"].append({"code": "payers", "message": payer_issue, "blocking": True, "ref": None})
            calc["can_finalize"] = False
    else:
        snap = db.scalar(
            select(ExpenseVersion).where(
                ExpenseVersion.expense_id == e.id, ExpenseVersion.version == e.finalized_version
            )
        )
        calc = snap.calculation if snap else {}
        paid = snap.payers if snap else {}
    mid = str(me.id)
    share = next((p["total"] for p in calc.get("people", []) if p["member_id"] == mid), 0)
    versions = db.execute(
        select(ExpenseVersion.version, ExpenseVersion.total_minor, ExpenseVersion.created_at, User.display_name)
        .outerjoin(User, User.id == ExpenseVersion.actor_user_id)
        .where(ExpenseVersion.expense_id == e.id)
        .order_by(ExpenseVersion.version)
    ).all()
    can_manage = expense_svc.can_manage(e, me)
    return {
        "id": e.id,
        "group_id": e.group_id,
        "group_name": group.name if group else "",
        "group_type": group.type if group else "",
        "status": e.status,
        "version": e.version,
        "finalized_version": e.finalized_version,
        "title": e.title,
        "category": e.category,
        "notes": e.notes,
        "expense_date": e.expense_date,
        "currency": e.currency,
        "split_kind": e.split_kind,
        "receipt_total_minor": e.receipt_total_minor,
        "rounding": {"mode": e.rounding_mode, "amount_minor": e.rounding_minor},
        "receipt_id": e.receipt_id,
        "created_by": e.created_by,
        "created_at": e.created_at,
        "updated_at": e.updated_at,
        "finalized_at": e.finalized_at,
        "cancelled_at": e.cancelled_at,
        "items": _items_out(e),
        "discounts": [
            {
                "client_id": d.client_id, "label": d.label, "kind": d.kind, "value": d.value, "stage": d.stage,
                "allocation": d.allocation, "item_client_ids": d.item_client_ids, "is_coupon": d.is_coupon,
            }
            for d in e.discounts
        ],
        "charges": [
            {
                "client_id": c.client_id, "label": c.label, "type": c.type, "kind": c.kind, "value": c.value,
                "tax_rate_bp": c.tax_rate_bp, "tax_scheme": c.tax_scheme, "allocation": c.allocation,
            }
            for c in e.charges
        ],
        "reported_taxes": [
            {"component": t.component, "rate_bp": t.rate_bp, "amount_minor": t.amount_minor} for t in e.reported_taxes
        ],
        "payers": [{"member_id": str(p.member_id), "amount_minor": p.amount_minor} for p in e.payers],
        "resolved_payers": paid,
        "calculation": calc,
        "my_member_id": me.id,
        "my_share_minor": share,
        "my_paid_minor": paid.get(mid, 0),
        "can_edit": e.status == "draft" or (e.status == "finalized" and can_manage),
        "can_cancel": e.status != "cancelled" and (can_manage or e.status == "draft"),
        "versions": [
            {"version": v, "total_minor": t, "created_at": c, "actor": n or "Former member"} for v, t, c, n in versions
        ],
    }


def expense_summary(e: Expense, group: Group, me: GroupMember, members: dict[uuid.UUID, GroupMember]) -> dict[str, Any]:
    mid = me.id
    share = next((a.amount_minor for a in e.allocations if a.member_id == mid), None) if e.status == "finalized" else None
    paid_by = [members[p.member_id].display_name for p in e.payers if p.member_id in members]
    my_paid = None
    if e.status == "finalized" and e.total_minor is not None:
        try:
            my_paid = expense_svc.resolve_payers(e.payers, e.total_minor).get(str(mid), 0)
        except ApiError:
            my_paid = None
    return {
        "id": e.id,
        "group_id": e.group_id,
        "group_name": group.name,
        "title": e.title,
        "category": e.category,
        "status": e.status,
        "expense_date": e.expense_date,
        "currency": e.currency,
        "total_minor": e.total_minor,
        "paid_by": paid_by,
        "my_share_minor": share,
        "my_net_minor": (my_paid - (share or 0)) if my_paid is not None else None,
        "item_count": len(e.items),
        "created_at": e.created_at,
    }


def repayment_out(db: Session, rep: Repayment, me: GroupMember) -> RepaymentOut:
    group = db.get(Group, rep.group_id)
    debtor = db.get(GroupMember, rep.debtor_member_id)
    creditor = db.get(GroupMember, rep.creditor_member_id)
    return RepaymentOut(
        id=rep.id,
        group_id=rep.group_id,
        group_name=group.name if group else "",
        currency=rep.currency,
        amount_minor=rep.amount_minor,
        status=rep.status,
        method=rep.method,
        note=rep.note,
        reference=rep.reference,
        debtor=member_out(debtor, me),
        creditor=member_out(creditor, me),
        i_am=repayment_svc.role_of(rep, me),  # type: ignore[arg-type]
        allowed_actions=repayment_svc.allowed_actions(rep, me),
        created_at=rep.created_at,
        updated_at=rep.updated_at,
        confirmed_at=rep.confirmed_at,
        events=[RepaymentEventOut.model_validate(ev) for ev in rep.events],
    )
