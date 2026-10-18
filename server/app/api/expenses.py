from __future__ import annotations

import uuid

from fastapi import APIRouter, Depends, Header, Query
from fastapi.responses import Response
from sqlalchemy import or_, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session, selectinload

from ..core.errors import ApiError, conflict
from ..core.ratelimit import write_limit
from ..db import get_db
from ..deps import current_user, get_group, membership
from ..models import Expense, Group, GroupMember, User
from ..schemas import CATEGORIES, CancelIn, ExpenseIn, ExpenseUpdateIn, FinalizeIn
from ..services import expenses as svc
from ..services import idempotency
from .serialize import expense_out, expense_summary

router = APIRouter(tags=["expenses"])


@router.get("/categories")
def categories():
    return {"categories": list(CATEGORIES)}


@router.post("/groups/{group_id}/expenses/preview")
def preview(group_id: uuid.UUID, body: ExpenseIn, user: User = Depends(current_user), db: Session = Depends(get_db)):
    """Calculate a bill without saving it. Same engine as finalisation."""
    membership(db, group_id, user)
    svc._validate_payload(db, group_id, body, strict=False)
    result = svc.calculate(svc.bill_input_from_payload(body)).to_dict()
    try:
        result["resolved_payers"] = svc.resolve_payers(body.payers, result["total"])
    except ApiError as exc:
        result["resolved_payers"] = {}
        result["issues"].append({"code": exc.code, "message": exc.message, "blocking": True, "ref": None})
        result["can_finalize"] = False
    return result


@router.post("/groups/{group_id}/expenses", status_code=201, dependencies=[Depends(write_limit)])
def create_expense(
    group_id: uuid.UUID,
    body: ExpenseIn,
    finalize: bool = False,
    idempotency_key: str | None = Header(default=None),
    user: User = Depends(current_user),
    db: Session = Depends(get_db),
):
    """Create a draft. With ``?finalize=true`` the draft is finalised in the same transaction."""

    def work():
        e = svc.create_draft(db, user, group_id, body)
        if finalize:
            e = svc.finalize(db, user, e.id, e.version, None)
        e, me = svc.load(db, e.id, user)
        return expense_out(db, e, me)

    return idempotency.run(db, user, idempotency_key, f"expense.create:{group_id}:{finalize}", body, work, 201)


@router.get("/groups/{group_id}/expenses")
def list_group_expenses(
    group_id: uuid.UUID,
    status: str | None = Query(None, pattern="^(draft|finalized|cancelled)$"),
    category: str | None = None,
    q: str | None = Query(None, max_length=60),
    offset: int = Query(0, ge=0),
    limit: int = Query(30, ge=1, le=100),
    user: User = Depends(current_user),
    db: Session = Depends(get_db),
):
    g, me = get_group(db, group_id, user)
    return _list(db, [g.id], {g.id: me}, status, category, q, offset, limit)


@router.get("/expenses")
def list_my_expenses(
    status: str | None = Query(None, pattern="^(draft|finalized|cancelled)$"),
    category: str | None = None,
    q: str | None = Query(None, max_length=60),
    offset: int = Query(0, ge=0),
    limit: int = Query(30, ge=1, le=100),
    user: User = Depends(current_user),
    db: Session = Depends(get_db),
):
    rows = db.execute(
        select(GroupMember).where(GroupMember.user_id == user.id, GroupMember.status == "active")
    ).scalars().all()
    return _list(db, [m.group_id for m in rows], {m.group_id: m for m in rows}, status, category, q, offset, limit)


def _list(db, group_ids, my_member, status, category, q, offset, limit):
    query = (
        select(Expense)
        .where(Expense.group_id.in_(group_ids))
        .options(selectinload(Expense.allocations), selectinload(Expense.payers), selectinload(Expense.items))
        .order_by(Expense.expense_date.desc(), Expense.created_at.desc(), Expense.id)
    )
    if status:
        query = query.where(Expense.status == status)
    else:
        # Drafts are listed only for the person who started them.
        mine = [m.user_id for m in my_member.values()][:1]
        query = query.where(or_(Expense.status != "draft", Expense.created_by.in_(mine)))
    if category:
        query = query.where(Expense.category == category)
    if q:
        query = query.where(Expense.title.ilike(f"%{q.replace('%', '').replace('_', '')}%"))
    rows = db.scalars(query.offset(offset).limit(limit + 1)).all()
    groups = {g.id: g for g in db.scalars(select(Group).where(Group.id.in_(group_ids)))}
    members = {m.id: m for m in db.scalars(select(GroupMember).where(GroupMember.group_id.in_(group_ids)))}
    return {
        "items": [expense_summary(e, groups[e.group_id], my_member[e.group_id], members) for e in rows[:limit]],
        "next_offset": offset + limit if len(rows) > limit else None,
    }


@router.get("/expenses/{expense_id}")
def get_expense(expense_id: uuid.UUID, user: User = Depends(current_user), db: Session = Depends(get_db)):
    e, me = svc.load(db, expense_id, user)
    return expense_out(db, e, me)


@router.put("/expenses/{expense_id}", dependencies=[Depends(write_limit)])
def update_expense(
    expense_id: uuid.UUID, body: ExpenseUpdateIn, user: User = Depends(current_user), db: Session = Depends(get_db)
):
    svc.update(db, user, expense_id, body, body.expected_version)
    db.commit()
    e, me = svc.load(db, expense_id, user)
    return expense_out(db, e, me)


@router.post("/expenses/{expense_id}/finalize", dependencies=[Depends(write_limit)])
def finalize_expense(
    expense_id: uuid.UUID,
    body: FinalizeIn,
    idempotency_key: str | None = Header(default=None),
    user: User = Depends(current_user),
    db: Session = Depends(get_db),
):
    def work():
        svc.finalize(db, user, expense_id, body.expected_version, body.client_total_minor)
        e, me = svc.load(db, expense_id, user)
        return expense_out(db, e, me)

    try:
        return idempotency.run(db, user, idempotency_key, f"expense.finalize:{expense_id}", body, work)
    except IntegrityError:
        # A concurrent request finalised this version first (unique version snapshot);
        # our transaction rolled back whole, so report the winner's result.
        db.rollback()
        e, me = svc.load(db, expense_id, user)
        if e.status == "finalized" and e.finalized_version == body.expected_version:
            return expense_out(db, e, me)
        raise conflict("version_conflict", "This expense changed while you were finalising it. Review it again.") from None


@router.post("/expenses/{expense_id}/cancel", dependencies=[Depends(write_limit)])
def cancel_expense(
    expense_id: uuid.UUID, body: CancelIn, user: User = Depends(current_user), db: Session = Depends(get_db)
):
    e = svc.cancel(db, user, expense_id, body.expected_version, body.reason)
    db.commit()
    if e is None:
        return Response(status_code=204)
    e, me = svc.load(db, expense_id, user)
    return expense_out(db, e, me)
