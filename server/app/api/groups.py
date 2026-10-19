from __future__ import annotations

import secrets
import uuid
from datetime import timedelta, timezone

from fastapi import APIRouter, Depends, Query
from sqlalchemy import select
from sqlalchemy.orm import Session, selectinload

from ..core.errors import ApiError, conflict, forbidden, invalid, not_found
from ..core.ratelimit import write_limit
from ..db import get_db
from ..deps import current_user, get_group, require_admin
from ..models import Expense, Group, GroupInvite, GroupMember, LedgerEntry, Repayment, User, utcnow
from ..money.currency import SUPPORTED_CURRENCIES
from ..schemas import (
    GroupCreate,
    GroupOut,
    GroupUpdate,
    InviteAccept,
    InviteOut,
    InvitePreview,
    MemberCreate,
    MemberOut,
    MemberUpdate,
)
from ..core.config import get_settings
from ..services import activity
from ..services import auth as auth_svc
from ..services import ledger as ledger_svc
from .serialize import group_out, member_out

router = APIRouter(tags=["groups"])

OPEN_REPAYMENT = ("REQUESTED", "MARKED_SENT", "AWAITING_CONFIRMATION", "DISPUTED")


def _check_currency(code: str) -> str:
    code = code.upper()
    if code not in SUPPORTED_CURRENCIES:
        raise invalid("unknown_currency", f"Currency {code} isn't supported.")
    return code


def _check_dates(start, end) -> None:
    if start and end and end < start:
        raise invalid("invalid_dates", "The trip can't end before it starts.")


@router.get("/groups", response_model=list[GroupOut])
def list_groups(
    include_personal: bool = False,
    include_archived: bool = True,
    user: User = Depends(current_user),
    db: Session = Depends(get_db),
):
    q = (
        select(GroupMember, Group)
        .join(Group, Group.id == GroupMember.group_id)
        .where(GroupMember.user_id == user.id, GroupMember.status == "active")
        .options(selectinload(Group.members).selectinload(GroupMember.user))
        .order_by(Group.created_at.desc())
    )
    if not include_personal:
        q = q.where(Group.type != "personal")
    if not include_archived:
        q = q.where(Group.archived_at.is_(None))
    rows = db.execute(q).tuples().all()
    nets = ledger_svc.member_nets_for_groups(db, [g.id for _, g in rows])
    return [group_out(db, g, m, nets) for m, g in rows]


@router.post("/groups", response_model=GroupOut, status_code=201, dependencies=[Depends(write_limit)])
def create_group(body: GroupCreate, user: User = Depends(current_user), db: Session = Depends(get_db)):
    _check_dates(body.start_date, body.end_date)
    g = Group(
        name=body.name, type=body.type, emoji=body.emoji, currency=_check_currency(body.currency),
        start_date=body.start_date, end_date=body.end_date, created_by=user.id,
    )
    db.add(g)
    db.flush()
    me = GroupMember(group_id=g.id, user_id=user.id, display_name=user.display_name, role="owner")
    db.add(me)
    seen = {user.id}
    for m in body.members:
        if m.username:
            friend = _user_by_username(db, m.username)
            if friend.id not in seen:  # yourself or a repeat: skip
                seen.add(friend.id)
                db.add(GroupMember(group_id=g.id, user_id=friend.id, display_name=friend.display_name))
        else:
            db.add(GroupMember(group_id=g.id, display_name=m.display_name, contact_email=m.contact_email))
    db.flush()
    activity.record(db, actor=user, type="group.created", entity_type="group", entity_id=g.id, group_id=g.id,
                    data={"name": g.name})
    db.commit()
    db.refresh(g)
    return group_out(db, g, me)


def _user_by_username(db: Session, username: str) -> User:
    friend = db.scalar(
        select(User).where(User.username == auth_svc.normalize_username(username), User.deleted_at.is_(None))
    )
    if friend is None:
        raise ApiError(404, "user_not_found", f"No one on SplitMate has the username @{username.lstrip('@')}.")
    return friend


@router.post("/groups/with-people", response_model=GroupOut, dependencies=[Depends(write_limit)])
def group_with_people(body: GroupCreate, user: User = Depends(current_user), db: Session = Depends(get_db)):
    """Split with chosen people without managing a group: reuse the open group that has
    exactly you and these SplitMate users, or make one named after them."""
    if not body.members:
        raise invalid("no_people", "Choose at least one person to split with.")
    if all(m.username for m in body.members):
        wanted = {user.id} | {_user_by_username(db, m.username).id for m in body.members}
        mine = db.scalars(
            select(Group).join(GroupMember, GroupMember.group_id == Group.id).where(
                GroupMember.user_id == user.id, GroupMember.status == "active",
                Group.type != "personal", Group.archived_at.is_(None), Group.currency == body.currency.upper(),
            ).order_by(Group.created_at.desc())
        ).all()
        for g in mine:
            active = [m for m in g.members if m.status == "active"]
            if all(m.user_id for m in active) and {m.user_id for m in active} == wanted:
                return group_out(db, g, next(m for m in active if m.user_id == user.id))
    return create_group(body, user, db)


@router.get("/groups/{group_id}", response_model=GroupOut)
def get_group_detail(group_id: uuid.UUID, user: User = Depends(current_user), db: Session = Depends(get_db)):
    g, me = get_group(db, group_id, user)
    return group_out(db, g, me)


@router.patch("/groups/{group_id}", response_model=GroupOut)
def update_group(group_id: uuid.UUID, body: GroupUpdate, user: User = Depends(current_user), db: Session = Depends(get_db)):
    g, me = get_group(db, group_id, user)
    if g.type == "personal":
        raise forbidden("Your personal space can't be changed.")
    require_admin(me)
    fields = body.model_dump(exclude_unset=True)
    if "name" in fields and body.name:
        g.name = body.name
    if "type" in fields and body.type:
        g.type = body.type
    if "emoji" in fields:
        g.emoji = body.emoji
    if "currency" in fields and body.currency:
        g.currency = _check_currency(body.currency)  # default for new expenses; old ones keep theirs
    if "start_date" in fields:
        g.start_date = body.start_date
    if "end_date" in fields:
        g.end_date = body.end_date
    _check_dates(g.start_date, g.end_date)
    if "archived" in fields and body.archived is not None:
        g.archived_at = utcnow() if body.archived else None
    activity.audit(db, actor=user, action="group.updated", entity_type="group", entity_id=g.id, data=fields)
    db.commit()
    return group_out(db, g, me)


# ------------------------------------------------------------------ members


@router.post("/groups/{group_id}/members", response_model=MemberOut, status_code=201)
def add_member(group_id: uuid.UUID, body: MemberCreate, user: User = Depends(current_user), db: Session = Depends(get_db)):
    g, me = get_group(db, group_id, user)
    if g.type == "personal":
        raise forbidden("Create a group to split with others.")
    active = [m for m in g.members if m.status == "active"]
    if len(active) >= 100:
        raise invalid("group_full", "A group can have up to 100 members.")
    if body.username:
        # Someone already on SplitMate: they're in straight away and see the group in their list.
        friend = _user_by_username(db, body.username)
        m = db.scalar(select(GroupMember).where(GroupMember.group_id == g.id, GroupMember.user_id == friend.id))
        if m is not None and m.status == "active":
            raise conflict("already_member", f"{m.display_name} is already in this group.")
        if m is None:
            m = GroupMember(group_id=g.id, user_id=friend.id, display_name=friend.display_name)
            db.add(m)
        else:  # they left before; bring their old spot back
            m.status = "active"
            m.display_name = friend.display_name
    else:
        m = GroupMember(group_id=g.id, display_name=body.display_name, contact_email=body.contact_email)
        db.add(m)
    db.flush()
    activity.record(db, actor=user, type="member.added", entity_type="member", entity_id=m.id, group_id=g.id,
                    data={"name": m.display_name})
    db.commit()
    return member_out(m, me)


@router.patch("/groups/{group_id}/members/{member_id}", response_model=MemberOut)
def update_member(
    group_id: uuid.UUID, member_id: uuid.UUID, body: MemberUpdate,
    user: User = Depends(current_user), db: Session = Depends(get_db),
):
    g, me = get_group(db, group_id, user)
    m = db.get(GroupMember, member_id)
    if m is None or m.group_id != g.id or m.status != "active":
        raise not_found("Member")
    if body.display_name is not None:
        if m.user_id is not None and m.id != me.id:
            raise forbidden("People on SplitMate set their own name.")
        m.display_name = " ".join(body.display_name.split())
    if body.role is not None:
        require_admin(me)
        if m.role == "owner":
            raise forbidden("The owner's role can't be changed.")
        if m.user_id is None:
            raise invalid("not_registered", "Only people on SplitMate can be admins.")
        m.role = body.role
    db.commit()
    return member_out(m, me)


@router.delete("/groups/{group_id}/members/{member_id}", status_code=204)
def remove_member(group_id: uuid.UUID, member_id: uuid.UUID, user: User = Depends(current_user), db: Session = Depends(get_db)):
    """Remove someone (admins) or leave (yourself). Only when they're settled up."""
    g, me = get_group(db, group_id, user)
    m = db.get(GroupMember, member_id)
    if m is None or m.group_id != g.id or m.status != "active":
        raise not_found("Member")
    if m.id != me.id:
        require_admin(me)
    if m.role == "owner":
        raise forbidden("The owner can't leave or be removed. Make sure someone else can manage the group first.")
    nets = ledger_svc.member_nets_for_groups(db, [g.id])
    unsettled = {cur: v[str(m.id)] for (_, cur), v in nets.items() if v.get(str(m.id), 0) != 0}
    if unsettled:
        raise conflict("member_not_settled", f"{m.display_name} isn't settled up yet.",
                       [{"currency": c, "amount_minor": a} for c, a in unsettled.items()])
    open_rep = db.scalar(
        select(Repayment.id).where(
            Repayment.group_id == g.id, Repayment.status.in_(OPEN_REPAYMENT),
            (Repayment.debtor_member_id == m.id) | (Repayment.creditor_member_id == m.id),
        )
    )
    if open_rep:
        raise conflict("member_has_open_repayments", f"{m.display_name} has repayments in progress.")
    m.status = "removed"
    activity.record(db, actor=user, type="member.removed", entity_type="member", entity_id=m.id, group_id=g.id,
                    data={"name": m.display_name, "left": m.id == me.id})
    db.commit()


# ------------------------------------------------------------------ invites


@router.post("/groups/{group_id}/invites", response_model=InviteOut, status_code=201)
def create_invite(
    group_id: uuid.UUID, body: InviteAccept | None = None,
    user: User = Depends(current_user), db: Session = Depends(get_db),
):
    g, _ = get_group(db, group_id, user)
    if g.type == "personal":
        raise forbidden("Create a group to invite people.")
    member_id = body.member_id if body else None
    if member_id is not None:
        m = db.get(GroupMember, member_id)
        if m is None or m.group_id != g.id or m.user_id is not None or m.status != "active":
            raise invalid("invalid_member", "Invites can only be linked to someone who hasn't joined yet.")
    code = secrets.token_urlsafe(9).replace("-", "a").replace("_", "b")[:12]
    inv = GroupInvite(group_id=g.id, code=code, member_id=member_id, created_by=user.id,
                      expires_at=utcnow() + timedelta(days=14))
    db.add(inv)
    db.commit()
    link = f"{get_settings().public_base_url.rstrip('/')}/i/{code}"
    return InviteOut(
        code=code, expires_at=inv.expires_at, member_id=member_id, link=link,
        share_text=(
            f"Join \"{g.name}\" on SplitMate so we can split expenses. Tap to join: {link}\n"
            f"New to SplitMate? Install it, sign up, then open the link again (or enter code {code})."
        ),
    )


def _valid_invite(db: Session, code: str) -> GroupInvite:
    inv = db.scalar(select(GroupInvite).where(GroupInvite.code == code))
    if inv is None or inv.revoked_at is not None or inv.uses >= inv.max_uses:
        raise not_found("Invite")
    expires = inv.expires_at if inv.expires_at.tzinfo else inv.expires_at.replace(tzinfo=timezone.utc)
    if expires < utcnow():
        raise ApiError(410, "invite_expired", "This invite has expired. Ask for a new one.")
    return inv


@router.get("/invites/{code}", response_model=InvitePreview)
def preview_invite(code: str, user: User = Depends(current_user), db: Session = Depends(get_db)):
    inv = _valid_invite(db, code)
    g = db.get(Group, inv.group_id)
    active = [m for m in g.members if m.status == "active"]
    claimable = [m for m in active if m.user_id is None and (inv.member_id is None or m.id == inv.member_id)]
    return InvitePreview(
        group_name=g.name, group_emoji=g.emoji, member_count=len(active),
        claimable_members=[member_out(m) for m in claimable],
    )


@router.post("/invites/{code}/accept", response_model=GroupOut, dependencies=[Depends(write_limit)])
def accept_invite(code: str, body: InviteAccept, user: User = Depends(current_user), db: Session = Depends(get_db)):
    inv = _valid_invite(db, code)
    g = db.get(Group, inv.group_id)
    existing = db.scalar(select(GroupMember).where(GroupMember.group_id == g.id, GroupMember.user_id == user.id))
    if existing and existing.status == "active":
        return group_out(db, g, existing)
    target_id = body.member_id or inv.member_id
    if target_id is not None:
        m = db.get(GroupMember, target_id)
        if (
            m is None or m.group_id != g.id or m.user_id is not None or m.status != "active"
            or (inv.member_id is not None and inv.member_id != m.id)
        ):
            raise invalid("invalid_member", "That spot has already been claimed.")
        if existing:  # previously left; reuse the claimed spot instead
            existing.user_id = None
            db.flush()
        m.user_id = user.id
        m.display_name = user.display_name
    elif existing:
        existing.status = "active"
        m = existing
    else:
        m = GroupMember(group_id=g.id, user_id=user.id, display_name=user.display_name)
        db.add(m)
    inv.uses += 1
    db.flush()
    activity.record(db, actor=user, type="member.joined", entity_type="member", entity_id=m.id, group_id=g.id,
                    data={"name": m.display_name})
    db.commit()
    db.refresh(g)
    return group_out(db, g, m)


# ------------------------------------------------------------------ balances


@router.get("/groups/{group_id}/balances")
def group_balances(group_id: uuid.UUID, user: User = Depends(current_user), db: Session = Depends(get_db)):
    g, me = get_group(db, group_id, user)
    members = {str(m.id): m for m in g.members}
    out = []
    for cur, data in sorted(ledger_svc.group_balances(db, g.id).items()):
        out.append({
            "currency": cur,
            "members": [
                {"member": member_out(members[mid], me), "net_minor": v}
                for mid, v in sorted(data["nets"].items(), key=lambda kv: (-kv[1], members[kv[0]].display_name))
                if mid in members
            ],
            "debts": [
                {"from": member_out(members[d], me), "to": member_out(members[c], me), "amount_minor": a}
                for (d, c), a in sorted(data["pairs"].items(), key=lambda kv: -kv[1])
            ],
            "suggestions": [
                {"from": member_out(members[o.debtor], me), "to": member_out(members[o.creditor], me),
                 "amount_minor": o.amount}
                for o in data["suggestions"]
            ],
            "total_check_minor": sum(data["nets"].values()),  # always 0; shown in the audit view
        })
    return {"group_id": g.id, "balances": out}


@router.get("/groups/{group_id}/members/{member_id}/ledger")
def member_ledger(
    group_id: uuid.UUID, member_id: uuid.UUID,
    offset: int = Query(0, ge=0), limit: int = Query(50, ge=1, le=200),
    user: User = Depends(current_user), db: Session = Depends(get_db),
):
    """Every ledger line between the caller and another member: why the balance is what it is."""
    g, me = get_group(db, group_id, user)
    other = db.get(GroupMember, member_id)
    if other is None or other.group_id != g.id:
        raise not_found("Member")
    rows = db.execute(
        select(LedgerEntry, Expense.title)
        .outerjoin(Expense, Expense.id == LedgerEntry.expense_id)
        .where(
            LedgerEntry.group_id == g.id,
            ((LedgerEntry.debtor_member_id == me.id) & (LedgerEntry.creditor_member_id == other.id))
            | ((LedgerEntry.debtor_member_id == other.id) & (LedgerEntry.creditor_member_id == me.id)),
        )
        .order_by(LedgerEntry.created_at.desc(), LedgerEntry.id)
        .offset(offset)
        .limit(limit + 1)
    ).all()
    return {
        "items": [
            {
                "id": e.id, "kind": e.kind, "currency": e.currency, "created_at": e.created_at,
                "expense_id": e.expense_id, "expense_version": e.expense_version, "expense_title": title,
                "repayment_id": e.repayment_id,
                # Positive: moves the balance in my favour (they owe me more).
                "effect_minor": e.amount_minor if e.creditor_member_id == me.id else -e.amount_minor,
            }
            for e, title in rows[:limit]
        ],
        "next_offset": offset + limit if len(rows) > limit else None,
    }
