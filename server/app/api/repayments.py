from __future__ import annotations

import uuid

from fastapi import APIRouter, Depends, Header, Query
from sqlalchemy import select
from sqlalchemy.orm import Session, selectinload

from ..core.errors import not_found
from ..core.ratelimit import write_limit
from ..db import get_db
from ..deps import current_user
from ..models import GroupMember, Repayment, User
from ..schemas import RepaymentAction, RepaymentCreate, RemindIn
from ..services import idempotency
from ..services import repayments as svc
from .serialize import repayment_out

router = APIRouter(tags=["repayments"])


@router.post("/repayments", status_code=201, dependencies=[Depends(write_limit)])
def create_repayment(
    body: RepaymentCreate,
    idempotency_key: str | None = Header(default=None),
    user: User = Depends(current_user),
    db: Session = Depends(get_db),
):
    def work():
        rep = svc.create(db, user, body)
        rep, me = svc.load(db, rep.id, user)
        return repayment_out(db, rep, me)

    return idempotency.run(db, user, idempotency_key, "repayment.create", body, work, 201)


@router.get("/repayments")
def list_repayments(
    group_id: uuid.UUID | None = None,
    status: str | None = None,
    offset: int = Query(0, ge=0),
    limit: int = Query(30, ge=1, le=100),
    user: User = Depends(current_user),
    db: Session = Depends(get_db),
):
    mine = db.scalars(select(GroupMember).where(GroupMember.user_id == user.id, GroupMember.status == "active")).all()
    by_group = {m.group_id: m for m in mine}
    if group_id is not None and group_id not in by_group:
        raise not_found("Group")
    gids = [group_id] if group_id else list(by_group)
    q = (
        select(Repayment)
        .where(Repayment.group_id.in_(gids))
        .options(selectinload(Repayment.events))
        .order_by(Repayment.updated_at.desc(), Repayment.id)
    )
    if status:
        q = q.where(Repayment.status.in_(status.upper().split(",")))
    rows = db.scalars(q.offset(offset).limit(limit + 1)).all()
    return {
        "items": [repayment_out(db, r, by_group[r.group_id]) for r in rows[:limit]],
        "next_offset": offset + limit if len(rows) > limit else None,
    }


@router.get("/repayments/{repayment_id}")
def get_repayment(repayment_id: uuid.UUID, user: User = Depends(current_user), db: Session = Depends(get_db)):
    rep, me = svc.load(db, repayment_id, user)
    return repayment_out(db, rep, me)


@router.post("/repayments/{repayment_id}/actions", dependencies=[Depends(write_limit)])
def act_on_repayment(
    repayment_id: uuid.UUID,
    body: RepaymentAction,
    idempotency_key: str | None = Header(default=None),
    user: User = Depends(current_user),
    db: Session = Depends(get_db),
):
    def work():
        svc.act(db, user, repayment_id, body)
        rep, me = svc.load(db, repayment_id, user)
        db.refresh(rep)
        return repayment_out(db, rep, me)

    return idempotency.run(db, user, idempotency_key, f"repayment.action:{repayment_id}", body, work)


@router.post("/repayments/remind", dependencies=[Depends(write_limit)])
def remind_about_debt(
    body: RemindIn,
    user: User = Depends(current_user),
    db: Session = Depends(get_db),
):
    """Nudge the other person: an in-app notification with what they owe right now."""
    owed = svc.remind(db, user, body.group_id, body.other_member_id, body.currency)
    db.commit()
    return {"amount_minor": owed, "currency": body.currency.upper()}
