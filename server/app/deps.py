"""Request dependencies: current user and object-level authorization."""

from __future__ import annotations

import uuid

from fastapi import Depends, Header
from sqlalchemy import select
from sqlalchemy.orm import Session

from .core.errors import ApiError, forbidden, not_found
from .core.security import decode_access_token
from .db import get_db
from .models import Group, GroupMember, User


def current_user(authorization: str | None = Header(default=None), db: Session = Depends(get_db)) -> User:
    if not authorization or not authorization.lower().startswith("bearer "):
        raise ApiError(401, "unauthorized", "Please sign in.")
    decoded = decode_access_token(authorization.split(" ", 1)[1].strip())
    user = db.get(User, decoded[0]) if decoded else None
    if user is None or user.deleted_at is not None:
        raise ApiError(401, "unauthorized", "Your session has expired. Please sign in again.")
    if decoded[1] != user.session_epoch:
        # One account, one device: a newer sign-in retired this token.
        raise ApiError(401, "signed_in_elsewhere", "You were signed in on another device.")
    return user


def membership(db: Session, group_id: uuid.UUID, user: User, *, lock: bool = False) -> GroupMember:
    """The caller's active membership in a group, or 404 (never reveal other groups exist)."""
    q = select(GroupMember).where(
        GroupMember.group_id == group_id,
        GroupMember.user_id == user.id,
        GroupMember.status == "active",
    )
    if lock:
        q = q.with_for_update()
    member = db.scalar(q)
    if member is None:
        raise not_found("Group")
    return member


def require_admin(member: GroupMember) -> None:
    if member.role not in ("owner", "admin"):
        raise forbidden("Only the group's owner or admins can do that.")


def get_group(db: Session, group_id: uuid.UUID, user: User) -> tuple[Group, GroupMember]:
    me = membership(db, group_id, user)
    group = db.get(Group, group_id)
    if group is None:  # pragma: no cover - membership implies the group exists
        raise not_found("Group")
    return group, me


def group_member_ids(db: Session, group_id: uuid.UUID, *, active_only: bool = True) -> set[uuid.UUID]:
    q = select(GroupMember.id).where(GroupMember.group_id == group_id)
    if active_only:
        q = q.where(GroupMember.status == "active")
    return set(db.scalars(q))
