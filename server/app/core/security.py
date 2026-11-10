from __future__ import annotations

import hashlib
import hmac
import secrets
import uuid
from datetime import datetime, timedelta, timezone

import jwt
from argon2 import PasswordHasher
from argon2.exceptions import InvalidHashError, VerificationError

from .config import get_settings

_hasher = PasswordHasher()  # Argon2id with library defaults
# Verifying against this keeps login timing similar whether or not the email exists.
_DUMMY_HASH = _hasher.hash("splitmate-timing-equaliser")


def hash_password(password: str) -> str:
    return _hasher.hash(password)


def verify_password(password: str, password_hash: str | None) -> bool:
    try:
        return _hasher.verify(password_hash or _DUMMY_HASH, password) and password_hash is not None
    except (VerificationError, InvalidHashError):
        return False


def create_access_token(user_id: uuid.UUID, epoch: int = 0) -> tuple[str, int]:
    s = get_settings()
    now = datetime.now(timezone.utc)
    ttl = s.access_token_minutes * 60
    token = jwt.encode(
        {"sub": str(user_id), "ep": epoch, "iat": now, "exp": now + timedelta(seconds=ttl), "typ": "access"},
        s.jwt_secret,
        algorithm="HS256",
    )
    return token, ttl


def decode_access_token(token: str) -> tuple[uuid.UUID, int] | None:
    """Returns (user_id, session_epoch), or None when the token is invalid.
    Tokens issued before session epochs existed decode as epoch 0."""
    try:
        payload = jwt.decode(token, get_settings().jwt_secret, algorithms=["HS256"])
        if payload.get("typ") != "access":
            return None
        return uuid.UUID(payload["sub"]), int(payload.get("ep", 0))
    except (jwt.PyJWTError, KeyError, ValueError, TypeError):
        return None


def new_refresh_token() -> tuple[str, str]:
    raw = secrets.token_urlsafe(48)
    return raw, hash_token(raw)


def hash_token(raw: str) -> str:
    return hashlib.sha256(raw.encode()).hexdigest()


def sign(value: str, expires_at: int) -> str:
    msg = f"{value}:{expires_at}".encode()
    return hmac.new(get_settings().signing_secret.encode(), msg, hashlib.sha256).hexdigest()


def verify_signature(value: str, expires_at: int, signature: str) -> bool:
    if expires_at < int(datetime.now(timezone.utc).timestamp()):
        return False
    return hmac.compare_digest(sign(value, expires_at), signature)
