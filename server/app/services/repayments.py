"""Repayment state machine (PLAN.md §4). Only CONFIRMED changes balances, exactly once."""

from __future__ import annotations

import uuid

from sqlalchemy import select
from sqlalchemy.orm import Session

from ..core.errors import ApiError, conflict, forbidden, invalid, not_found
from ..deps import membership
from ..models import GroupMember, LedgerEntry, Repayment, RepaymentEvent, User, utcnow
from ..money.currency import UnknownCurrency, get_currency
from ..schemas import RepaymentAction, RepaymentCreate
from . import activity
from . import ledger as ledger_svc

# (from_status, action) -> (who may act, to_status)
TRANSITIONS: dict[tuple[str, str], tuple[str, str]] = {
    ("REQUESTED", "mark_sent"): ("debtor", "MARKED_SENT"),
    ("REQUESTED", "reject"): ("debtor", "REJECTED"),
    ("REQUESTED", "cancel"): ("creditor", "CANCELLED"),
    ("MARKED_SENT", "confirm"): ("creditor", "CONFIRMED"),
    ("MARKED_SENT", "dispute"): ("creditor", "DISPUTED"),
    ("MARKED_SENT", "reject"): ("creditor", "REJECTED"),
    ("MARKED_SENT", "cancel"): ("debtor", "CANCELLED"),
    ("AWAITING_CONFIRMATION", "confirm"): ("creditor", "CONFIRMED"),
    ("AWAITING_CONFIRMATION", "dispute"): ("creditor", "DISPUTED"),
    ("AWAITING_CONFIRMATION", "reject"): ("creditor", "REJECTED"),
    ("AWAITING_CONFIRMATION", "cancel"): ("debtor", "CANCELLED"),
    ("DISPUTED", "resubmit"): ("debtor", "AWAITING_CONFIRMATION"),
    ("DISPUTED", "cancel"): ("debtor", "CANCELLED"),
}

ACTIVITY_TYPE = {
    "mark_sent": "repayment.marked_sent",
    "confirm": "repayment.confirmed",
    "dispute": "repayment.disputed",
    "reject": "repayment.rejected",
    "cancel": "repayment.cancelled",
    "resubmit": "repayment.resubmitted",
}


def role_of(rep: Repayment, me: GroupMember) -> str:
    if me.id == rep.debtor_member_id:
        return "debtor"
    if me.id == rep.creditor_member_id:
        return "creditor"
    return "other"


def allowed_actions(rep: Repayment, me: GroupMember) -> list[str]:
    role = role_of(rep, me)
    return [action for (state, action), (who, _) in TRANSITIONS.items() if state == rep.status and who == role]


def load(db: Session, repayment_id: uuid.UUID, user: User, *, lock: bool = False) -> tuple[Repayment, GroupMember]:
    q = select(Repayment).where(Repayment.id == repayment_id)
    if lock:
        q = q.with_for_update()
    rep = db.scalar(q)
    if rep is None:
        raise not_found("Repayment")
    try:
        me = membership(db, rep.group_id, user)
    except ApiError:
        raise not_found("Repayment") from None
    return rep, me


def create(db: Session, user: User, data: RepaymentCreate) -> Repayment:
    me = membership(db, data.group_id, user)
    try:
        get_currency(data.currency)
    except UnknownCurrency:
        raise invalid("unknown_currency", f"Currency {data.currency} isn't supported.") from None
    other = db.get(GroupMember, data.other_member_id)
    if other is None or other.group_id != data.group_id or other.status != "active":
        raise not_found("Member")
    if other.id == me.id:
        raise invalid("same_member", "You can't repay yourself.")
    if data.mode == "request":
        debtor, creditor, status = other, me, "REQUESTED"
    else:
        debtor, creditor, status = me, other, "MARKED_SENT"
    outstanding = ledger_svc.pair_outstanding(db, data.group_id, data.currency.upper(), debtor.id, creditor.id)
    if outstanding <= 0:
        raise invalid(
            "nothing_owed",
            f"{debtor.display_name} doesn't owe {creditor.display_name} anything in {data.currency.upper()} right now.",
        )
    if data.amount_minor > outstanding:
        raise invalid(
            "amount_exceeds_balance",
            "That's more than what's owed. Enter a smaller amount.",
            {"outstanding_minor": outstanding},
        )
    rep = Repayment(
        group_id=data.group_id,
        currency=data.currency.upper(),
        debtor_member_id=debtor.id,
        creditor_member_id=creditor.id,
        amount_minor=data.amount_minor,
        status=status,
        method=data.method,
        note=data.note,
        reference=data.reference,
        created_by=user.id,
    )
    db.add(rep)
    db.flush()
    db.add(RepaymentEvent(repayment_id=rep.id, actor_user_id=user.id, action=data.mode, from_status=None,
                          to_status=status, note=data.note))
    activity.record(
        db, actor=user,
        type="repayment.requested" if data.mode == "request" else "repayment.marked_sent",
        entity_type="repayment", entity_id=rep.id, group_id=rep.group_id,
        data={"amount_minor": rep.amount_minor, "currency": rep.currency,
              "debtor": debtor.display_name, "creditor": creditor.display_name},
        notify_member_ids={debtor.id, creditor.id},
    )
    activity.audit(db, actor=user, action=f"repayment.{data.mode}", entity_type="repayment", entity_id=rep.id,
                   data={"amount_minor": rep.amount_minor, "currency": rep.currency})
    db.flush()
    return rep


def act(db: Session, user: User, repayment_id: uuid.UUID, data: RepaymentAction) -> Repayment:
    rep, me = load(db, repayment_id, user, lock=True)
    key = (rep.status, data.action)
    if key not in TRANSITIONS:
        if rep.status == "CONFIRMED" and data.action == "confirm":
            return rep  # repeated confirm: same result, no second ledger entry
        raise conflict("invalid_transition", f"You can't {data.action.replace('_', ' ')} a repayment that is {rep.status.replace('_', ' ').lower()}.")
    who, to_status = TRANSITIONS[key]
    if role_of(rep, me) != who:
        raise forbidden(
            "Only the person who received the money can do that."
            if who == "creditor"
            else "Only the person who owes the money can do that."
        )
    from_status = rep.status
    rep.status = to_status
    if data.method:
        rep.method = data.method
    if data.reference:
        rep.reference = data.reference
    if to_status == "CONFIRMED":
        rep.confirmed_at = utcnow()
        # Repayment: the debtor paid, so the creditor now "owes back" this amount,
        # which nets against the debtor's obligation. Unique repayment_id = once only.
        db.add(
            LedgerEntry(
                group_id=rep.group_id,
                currency=rep.currency,
                debtor_member_id=rep.creditor_member_id,
                creditor_member_id=rep.debtor_member_id,
                amount_minor=rep.amount_minor,
                kind="repayment",
                repayment_id=rep.id,
            )
        )
    db.add(RepaymentEvent(repayment_id=rep.id, actor_user_id=user.id, action=data.action,
                          from_status=from_status, to_status=to_status, note=data.note))
    debtor = db.get(GroupMember, rep.debtor_member_id)
    creditor = db.get(GroupMember, rep.creditor_member_id)
    activity.record(
        db, actor=user, type=ACTIVITY_TYPE[data.action], entity_type="repayment", entity_id=rep.id,
        group_id=rep.group_id,
        data={"amount_minor": rep.amount_minor, "currency": rep.currency, "note": data.note,
              "debtor": debtor.display_name if debtor else "", "creditor": creditor.display_name if creditor else ""},
        notify_member_ids={rep.debtor_member_id, rep.creditor_member_id},
    )
    activity.audit(db, actor=user, action=f"repayment.{data.action}", entity_type="repayment", entity_id=rep.id,
                   data={"from": from_status, "to": to_status})
    db.flush()
    return rep
