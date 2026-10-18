from __future__ import annotations

import uuid
from collections import defaultdict
from datetime import date, datetime, timezone

from fastapi import APIRouter, Depends, Query
from sqlalchemy import delete, func, select, update
from sqlalchemy.orm import Session, selectinload

from ..core.errors import ApiError, invalid
from ..core.security import hash_password, verify_password
from ..db import get_db
from ..deps import current_user
from ..models import (
    ActivityEvent,
    Expense,
    ExpenseAllocation,
    Group,
    GroupMember,
    Notification,
    Repayment,
    User,
    utcnow,
)
from ..money.currency import SUPPORTED_CURRENCIES
from ..schemas import DeleteAccountIn, PasswordChange, ProfileUpdate, UserOut
from ..services import activity
from ..services import auth as auth_svc
from ..services import ledger as ledger_svc
from ..services import repayments as repayment_svc
from .serialize import expense_summary, member_out, repayment_out

router = APIRouter(tags=["me"])


def my_memberships(db: Session, user: User, *, include_personal: bool = True) -> list[tuple[GroupMember, Group]]:
    q = (
        select(GroupMember, Group)
        .join(Group, Group.id == GroupMember.group_id)
        .where(GroupMember.user_id == user.id, GroupMember.status == "active")
    )
    if not include_personal:
        q = q.where(Group.type != "personal")
    return list(db.execute(q).tuples())


@router.get("/me", response_model=UserOut)
def get_me(user: User = Depends(current_user)):
    return auth_svc.user_out(user)


@router.patch("/me", response_model=UserOut)
def update_me(body: ProfileUpdate, user: User = Depends(current_user), db: Session = Depends(get_db)):
    if body.display_name is not None:
        user.display_name = body.display_name
        # Keep the name shown in groups in step with the profile.
        db.execute(update(GroupMember).where(GroupMember.user_id == user.id).values(display_name=body.display_name))
    if body.upi_id is not None:
        user.upi_id = body.upi_id or None
    if body.default_currency is not None:
        if body.default_currency.upper() not in SUPPORTED_CURRENCIES:
            raise invalid("unknown_currency", "That currency isn't supported.")
        user.default_currency = body.default_currency.upper()
    if body.avatar_hue is not None:
        user.avatar_hue = body.avatar_hue
    if body.preferences is not None:
        allowed = {"notify_expenses", "notify_repayments", "notify_groups", "receipt_processing_consent"}
        user.preferences = {**(user.preferences or {}), **{k: v for k, v in body.preferences.items() if k in allowed}}
    db.commit()
    return auth_svc.user_out(user)


@router.post("/me/password", status_code=204)
def change_password(body: PasswordChange, user: User = Depends(current_user), db: Session = Depends(get_db)):
    if user.password_hash and not verify_password(body.current_password or "", user.password_hash):
        raise ApiError(403, "wrong_password", "Your current password is incorrect.")
    user.password_hash = hash_password(body.new_password)
    auth_svc.revoke_all(db, user)
    activity.audit(db, actor=user, action="user.password_changed", entity_type="user", entity_id=user.id)
    db.commit()


@router.get("/me/summary")
def summary(user: User = Depends(current_user), db: Session = Depends(get_db)):
    """Home dashboard: balances, recent expenses and things waiting for me."""
    rows = my_memberships(db, user)
    my_member = {g.id: m for m, g in rows}
    groups = {g.id: g for _, g in rows}
    nets = ledger_svc.member_nets_for_groups(db, list(groups))
    owed: dict[str, int] = defaultdict(int)
    owe: dict[str, int] = defaultdict(int)
    for (gid, cur), v in nets.items():
        n = v.get(str(my_member[gid].id), 0)
        if n > 0:
            owed[cur] += n
        elif n < 0:
            owe[cur] += -n

    recent = db.scalars(
        select(Expense)
        .where(Expense.group_id.in_(list(groups)), Expense.status == "finalized")
        .options(selectinload(Expense.allocations), selectinload(Expense.payers), selectinload(Expense.items))
        .order_by(Expense.expense_date.desc(), Expense.created_at.desc())
        .limit(8)
    ).all()
    members = {
        m.id: m for m in db.scalars(select(GroupMember).where(GroupMember.group_id.in_(list(groups))))
    }
    member_ids = [m.id for m in my_member.values()]
    open_reps = db.scalars(
        select(Repayment)
        .where(
            Repayment.status.in_(["REQUESTED", "MARKED_SENT", "AWAITING_CONFIRMATION", "DISPUTED"]),
            (Repayment.debtor_member_id.in_(member_ids)) | (Repayment.creditor_member_id.in_(member_ids)),
        )
        .options(selectinload(Repayment.events))
        .order_by(Repayment.updated_at.desc())
    ).all()
    needs_me = [
        repayment_out(db, r, my_member[r.group_id])
        for r in open_reps
        if repayment_svc.allowed_actions(r, my_member[r.group_id])
        and set(repayment_svc.allowed_actions(r, my_member[r.group_id])) - {"cancel"}
    ]
    drafts = db.scalars(
        select(Expense)
        .where(Expense.group_id.in_(list(groups)), Expense.status == "draft", Expense.created_by == user.id)
        .options(selectinload(Expense.allocations), selectinload(Expense.payers), selectinload(Expense.items))
        .order_by(Expense.updated_at.desc())
        .limit(10)
    ).all()
    unread = db.scalar(
        select(func.count()).select_from(Notification).where(Notification.user_id == user.id, Notification.read_at.is_(None))
    )
    personal = next((g.id for g in groups.values() if g.type == "personal"), None)
    return {
        "owed_to_me": [{"currency": c, "amount_minor": a} for c, a in sorted(owed.items())],
        "i_owe": [{"currency": c, "amount_minor": a} for c, a in sorted(owe.items())],
        "recent_expenses": [expense_summary(e, groups[e.group_id], my_member[e.group_id], members) for e in recent],
        "needs_my_action": needs_me,
        "drafts": [expense_summary(e, groups[e.group_id], my_member[e.group_id], members) for e in drafts],
        "unread_notifications": unread or 0,
        "personal_group_id": personal,
        "group_count": sum(1 for g in groups.values() if g.type != "personal"),
    }


@router.get("/me/balances")
def balances(user: User = Depends(current_user), db: Session = Depends(get_db)):
    """Everyone I owe or who owes me, per group and currency."""
    rows = my_memberships(db, user, include_personal=False)
    out = []
    for m, g in rows:
        for cur, data in ledger_svc.group_balances(db, g.id).items():
            mine = data["nets"].get(str(m.id), 0)
            people = []
            for (debtor, creditor), amount in data["pairs"].items():
                if str(m.id) not in (debtor, creditor):
                    continue
                other_id = creditor if debtor == str(m.id) else debtor
                other = db.get(GroupMember, uuid.UUID(other_id))
                people.append({
                    "member": member_out(other, m),
                    "amount_minor": amount if creditor == str(m.id) else -amount,
                })
            if mine or people:
                out.append({
                    "group_id": g.id, "group_name": g.name, "group_emoji": g.emoji, "currency": cur,
                    "my_member_id": m.id, "net_minor": mine,
                    "people": sorted(people, key=lambda p: p["amount_minor"]),
                })
    return {"groups": out}


@router.get("/activity")
def activity_feed(
    group_id: uuid.UUID | None = None,
    offset: int = Query(0, ge=0),
    limit: int = Query(30, ge=1, le=100),
    user: User = Depends(current_user),
    db: Session = Depends(get_db),
):
    gids = [g.id for _, g in my_memberships(db, user)]
    if group_id is not None:
        if group_id not in gids:
            raise ApiError(404, "not_found", "Group wasn't found.")
        gids = [group_id]
    events = db.execute(
        select(ActivityEvent, User.display_name, Group.name)
        .outerjoin(User, User.id == ActivityEvent.actor_user_id)
        .join(Group, Group.id == ActivityEvent.group_id)
        .where(ActivityEvent.group_id.in_(gids))
        .order_by(ActivityEvent.created_at.desc(), ActivityEvent.id)
        .offset(offset)
        .limit(limit + 1)
    ).all()
    items = [_activity_out(ev, actor, gname, user) for ev, actor, gname in events[:limit]]
    return {"items": items, "next_offset": offset + limit if len(events) > limit else None}


def _activity_out(ev: ActivityEvent, actor: str | None, group_name: str, me: User) -> dict:
    return {
        "id": ev.id,
        "type": ev.type,
        "entity_type": ev.entity_type,
        "entity_id": ev.entity_id,
        "group_id": ev.group_id,
        "group_name": group_name,
        "actor": "You" if ev.actor_user_id == me.id else (actor or "Someone"),
        "data": ev.data,
        "created_at": ev.created_at,
    }


@router.get("/notifications")
def notifications(
    offset: int = Query(0, ge=0),
    limit: int = Query(30, ge=1, le=100),
    user: User = Depends(current_user),
    db: Session = Depends(get_db),
):
    rows = db.execute(
        select(Notification, ActivityEvent, User.display_name, Group.name)
        .join(ActivityEvent, ActivityEvent.id == Notification.activity_id)
        .outerjoin(User, User.id == ActivityEvent.actor_user_id)
        .outerjoin(Group, Group.id == ActivityEvent.group_id)
        .where(Notification.user_id == user.id)
        .order_by(Notification.created_at.desc(), Notification.id)
        .offset(offset)
        .limit(limit + 1)
    ).all()
    items = [
        {**_activity_out(ev, actor, gname or "", user), "notification_id": n.id, "read": n.read_at is not None}
        for n, ev, actor, gname in rows[:limit]
    ]
    return {"items": items, "next_offset": offset + limit if len(rows) > limit else None}


@router.post("/notifications/read", status_code=204)
def mark_read(body: dict, user: User = Depends(current_user), db: Session = Depends(get_db)):
    q = update(Notification).where(Notification.user_id == user.id, Notification.read_at.is_(None))
    ids = body.get("ids")
    if ids:
        try:
            q = q.where(Notification.id.in_([uuid.UUID(str(i)) for i in ids][:200]))
        except ValueError:
            raise invalid("invalid_ids", "Notification ids are invalid.") from None
    db.execute(q.values(read_at=utcnow()))
    db.commit()


@router.get("/me/export")
def export(user: User = Depends(current_user), db: Session = Depends(get_db)):
    """Everything SplitMate holds about the caller, as JSON (Settings → Export my data)."""
    rows = my_memberships(db, user)
    member_ids = [m.id for m, _ in rows]
    groups = [
        {"id": g.id, "name": g.name, "type": g.type, "currency": g.currency, "role": m.role, "member_id": m.id}
        for m, g in rows
    ]
    allocations = db.execute(
        select(ExpenseAllocation, Expense)
        .join(Expense, Expense.id == ExpenseAllocation.expense_id)
        .where(ExpenseAllocation.member_id.in_(member_ids))
    ).all()
    created = db.scalars(select(Expense).where(Expense.created_by == user.id)).all()
    reps = db.scalars(
        select(Repayment).where(
            Repayment.debtor_member_id.in_(member_ids) | Repayment.creditor_member_id.in_(member_ids)
        )
    ).all()
    return {
        "exported_at": datetime.now(timezone.utc),
        "profile": auth_svc.user_out(user).model_dump(),
        "groups": groups,
        "my_shares": [
            {"expense_id": e.id, "title": e.title, "date": e.expense_date, "currency": e.currency,
             "status": e.status, "my_share_minor": a.amount_minor, "breakdown": a.breakdown}
            for a, e in allocations
        ],
        "expenses_i_created": [
            {"id": e.id, "title": e.title, "status": e.status, "date": e.expense_date, "currency": e.currency,
             "total_minor": e.total_minor}
            for e in created
        ],
        "repayments": [
            {"id": r.id, "status": r.status, "currency": r.currency, "amount_minor": r.amount_minor,
             "role": "debtor" if r.debtor_member_id in member_ids else "creditor", "created_at": r.created_at}
            for r in reps
        ],
    }


@router.post("/me/delete", status_code=204)
def delete_account(body: DeleteAccountIn, user: User = Depends(current_user), db: Session = Depends(get_db)):
    """Delete the account. Shared ledgers stay intact for the other members, under "Deleted user"."""
    if user.password_hash and not verify_password(body.password or "", user.password_hash):
        raise ApiError(403, "wrong_password", "Your password is incorrect.")
    activity.audit(db, actor=user, action="user.deleted", entity_type="user", entity_id=user.id)
    for m, g in my_memberships(db, user):
        if g.type == "personal":
            db.execute(delete(Group).where(Group.id == g.id))  # private data only; FKs cascade
            continue
        m.display_name = "Deleted user"
        m.user_id = None
        m.contact_email = None
    auth_svc.revoke_all(db, user)
    user.email = None
    user.google_sub = None
    user.password_hash = None
    user.upi_id = None
    user.display_name = "Deleted user"
    user.preferences = {}
    user.deleted_at = utcnow()
    db.commit()

@router.get("/me/spending")
def spending(
    months: int = Query(6, ge=1, le=12),
    user: User = Depends(current_user),
    db: Session = Depends(get_db),
):
    """Your own share of finalised expenses per month (what you consumed, not what you paid)."""
    today = datetime.now(timezone.utc).date()
    keys = []
    y, mth = today.year, today.month
    for _ in range(months):
        keys.append((y, mth))
        y, mth = (y, mth - 1) if mth > 1 else (y - 1, 12)
    keys.reverse()
    start = date(keys[0][0], keys[0][1], 1)
    member_ids = [m.id for m, _ in my_memberships(db, user)]
    rows = db.execute(
        select(Expense.currency, Expense.expense_date, ExpenseAllocation.amount_minor)
        .join(Expense, Expense.id == ExpenseAllocation.expense_id)
        .where(
            ExpenseAllocation.member_id.in_(member_ids),
            Expense.status == "finalized",
            Expense.expense_date >= start,
        )
    ).all()
    totals: dict[str, dict[tuple[int, int], int]] = defaultdict(lambda: defaultdict(int))
    for cur, d, amount in rows:
        totals[cur][(d.year, d.month)] += amount
    currency = user.default_currency if user.default_currency in totals or not totals else max(
        totals, key=lambda c: sum(totals[c].values())
    )
    return {
        "currency": currency,
        "months": [
            {"month": f"{yy:04d}-{mm:02d}", "amount_minor": totals.get(currency, {}).get((yy, mm), 0)} for yy, mm in keys
        ],
    }
