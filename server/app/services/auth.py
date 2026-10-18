from __future__ import annotations

import random
import re
import uuid
from datetime import datetime, timedelta, timezone

from sqlalchemy import select, update
from sqlalchemy.orm import Session

from ..core.config import get_settings
from ..core.errors import ApiError, conflict
from ..core.security import create_access_token, hash_password, hash_token, new_refresh_token, verify_password
from ..integrations.google import get_verifier, verify_with_google
from ..models import Group, GroupMember, RefreshToken, User, utcnow
from ..schemas import TokenOut, UserOut
from . import activity


USERNAME_RE = re.compile(r"^[a-z0-9](?:[a-z0-9_.]{1,18})[a-z0-9]$")


def normalize_username(raw: str) -> str:
    return raw.strip().lstrip("@").lower()


def assign_username(db: Session, user: User) -> None:
    """Give a new account a handle from its name (asha_rao, asha_rao42 if taken). Users can change it later."""
    if user.username:
        return
    base = re.sub(r"[^a-z0-9]+", "_", user.display_name.lower())[:14].strip("_") or "user"
    if len(base) < 3:
        base = f"{base}_sm"
    candidate = base
    for _ in range(20):
        if not db.scalar(select(User.id).where(User.username == candidate)):
            user.username = candidate
            return
        candidate = f"{base}{random.randrange(10, 10000)}"
    user.username = f"user{uuid.uuid4().hex[:12]}"


def user_out(user: User) -> UserOut:
    out = UserOut.model_validate(user)
    out.has_password = user.password_hash is not None
    out.has_google = user.google_sub is not None
    return out


def _ensure_personal_group(db: Session, user: User) -> None:
    """Every user has a private 'Personal' space for expenses that aren't shared."""
    exists = db.scalar(
        select(GroupMember.id)
        .join(Group, Group.id == GroupMember.group_id)
        .where(GroupMember.user_id == user.id, Group.type == "personal")
    )
    if exists:
        return
    g = Group(name="Personal", type="personal", currency=user.default_currency, created_by=user.id, emoji="👤")
    db.add(g)
    db.flush()
    db.add(GroupMember(group_id=g.id, user_id=user.id, display_name=user.display_name, role="owner"))


def issue_tokens(db: Session, user: User, family_id: uuid.UUID | None = None) -> TokenOut:
    access, ttl = create_access_token(user.id)
    raw, digest = new_refresh_token()
    db.add(
        RefreshToken(
            user_id=user.id,
            family_id=family_id or uuid.uuid4(),
            token_hash=digest,
            expires_at=utcnow() + timedelta(days=get_settings().refresh_token_days),
        )
    )
    db.flush()
    return TokenOut(access_token=access, refresh_token=raw, expires_in=ttl, user=user_out(user))


def register(db: Session, email: str, password: str, display_name: str) -> TokenOut:
    email = email.lower()
    if db.scalar(select(User.id).where(User.email == email)):
        raise conflict("email_taken", "An account with this email already exists. Sign in instead.")
    user = User(email=email, display_name=display_name, password_hash=hash_password(password),
                avatar_hue=random.randrange(0, 360))
    assign_username(db, user)
    db.add(user)
    db.flush()
    _ensure_personal_group(db, user)
    activity.audit(db, actor=user, action="user.registered", entity_type="user", entity_id=user.id)
    return issue_tokens(db, user)


def login(db: Session, email: str, password: str) -> TokenOut:
    user = db.scalar(select(User).where(User.email == email.lower(), User.deleted_at.is_(None)))
    if not verify_password(password, user.password_hash if user else None) or user is None:
        raise ApiError(401, "invalid_credentials", "Email or password is incorrect.")
    return issue_tokens(db, user)


def google_sign_in(db: Session, id_token: str) -> TokenOut:
    if get_verifier() is verify_with_google and not get_settings().google_client_id_list:
        raise ApiError(503, "google_not_configured", "Google sign-in isn't set up on this server yet. Use email instead.")
    ident = get_verifier()(id_token)
    if ident is None:
        raise ApiError(401, "invalid_google_token", "Google sign-in couldn't be verified. Please try again.")
    user = db.scalar(select(User).where(User.google_sub == ident.sub))
    if user is None and ident.email and ident.email_verified:
        # Link to an existing email account only when Google has verified the address.
        user = db.scalar(select(User).where(User.email == ident.email))
        if user is not None:
            user.google_sub = ident.sub
    if user is not None and user.deleted_at is not None:
        raise ApiError(401, "account_deleted", "This account was deleted.")
    if user is None:
        user = User(
            email=ident.email if ident.email_verified else None,
            display_name=(ident.name or (ident.email.split("@")[0] if ident.email else "SplitMate user"))[:80],
            google_sub=ident.sub,
            avatar_hue=random.randrange(0, 360),
        )
        assign_username(db, user)
        db.add(user)
        db.flush()
        _ensure_personal_group(db, user)
        activity.audit(db, actor=user, action="user.registered_google", entity_type="user", entity_id=user.id)
    return issue_tokens(db, user)


def refresh(db: Session, raw: str) -> TokenOut:
    row = db.scalar(select(RefreshToken).where(RefreshToken.token_hash == hash_token(raw)).with_for_update())
    now = datetime.now(timezone.utc)
    if row is None:
        raise ApiError(401, "invalid_refresh", "Your session has expired. Please sign in again.")
    expires = row.expires_at if row.expires_at.tzinfo else row.expires_at.replace(tzinfo=timezone.utc)
    if row.used_at is not None or row.revoked_at is not None:
        # A rotated token was presented again: assume theft and end the whole session family.
        db.execute(
            update(RefreshToken).where(RefreshToken.family_id == row.family_id).values(revoked_at=now)
        )
        db.commit()
        raise ApiError(401, "invalid_refresh", "Your session has expired. Please sign in again.")
    if expires < now:
        raise ApiError(401, "invalid_refresh", "Your session has expired. Please sign in again.")
    user = db.get(User, row.user_id)
    if user is None or user.deleted_at is not None:
        raise ApiError(401, "invalid_refresh", "Your session has expired. Please sign in again.")
    row.used_at = now
    return issue_tokens(db, user, family_id=row.family_id)


def logout(db: Session, raw: str) -> None:
    row = db.scalar(select(RefreshToken).where(RefreshToken.token_hash == hash_token(raw)))
    if row is not None:
        db.execute(
            update(RefreshToken)
            .where(RefreshToken.family_id == row.family_id, RefreshToken.revoked_at.is_(None))
            .values(revoked_at=utcnow())
        )


def revoke_all(db: Session, user: User) -> None:
    db.execute(
        update(RefreshToken)
        .where(RefreshToken.user_id == user.id, RefreshToken.revoked_at.is_(None))
        .values(revoked_at=utcnow())
    )
