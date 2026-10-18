"""Google ID-token verification behind a small interface so tests can substitute it."""

from __future__ import annotations

from dataclasses import dataclass
from typing import Protocol

from ..core.config import get_settings


@dataclass
class GoogleIdentity:
    sub: str
    email: str
    email_verified: bool
    name: str | None


class GoogleVerifier(Protocol):
    def __call__(self, token: str) -> GoogleIdentity | None: ...


def verify_with_google(token: str) -> GoogleIdentity | None:
    client_ids = get_settings().google_client_id_list
    if not client_ids:
        return None
    from google.auth.transport import requests as google_requests
    from google.oauth2 import id_token

    try:
        info = id_token.verify_oauth2_token(token, google_requests.Request())
    except ValueError:
        return None
    if info.get("aud") not in client_ids or info.get("iss") not in ("accounts.google.com", "https://accounts.google.com"):
        return None
    return GoogleIdentity(
        sub=info["sub"],
        email=info.get("email", "").lower(),
        email_verified=bool(info.get("email_verified")),
        name=info.get("name"),
    )


_verifier: GoogleVerifier = verify_with_google


def get_verifier() -> GoogleVerifier:
    return _verifier


def set_verifier(v: GoogleVerifier) -> None:
    global _verifier
    _verifier = v
