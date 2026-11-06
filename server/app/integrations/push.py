"""Phone notifications through Firebase Cloud Messaging (FCM HTTP v1).

Every in-app notification is also pushed to the person's phones. Pushes are queued on
the database session and sent from a background thread only after the commit, so a
rolled-back change never notifies anyone and a slow FCM call never slows a request.
Without SPLITMATE_FIREBASE_CREDENTIALS this module does nothing.
"""

from __future__ import annotations

import base64
import json
import logging
import threading
import uuid
from concurrent.futures import ThreadPoolExecutor
from typing import Any

import requests
from sqlalchemy import delete, event, select
from sqlalchemy.orm import Session

from ..core.config import get_settings

log = logging.getLogger("splitmate.push")
_pool = ThreadPoolExecutor(max_workers=2, thread_name_prefix="push")
_lock = threading.Lock()
_creds: Any = None
_PENDING = "splitmate_push"


def _service_account() -> dict | None:
    raw = get_settings().firebase_credentials.strip()
    if not raw:
        return None
    try:
        return json.loads(raw if raw.startswith("{") else base64.b64decode(raw).decode())
    except (ValueError, UnicodeDecodeError):
        log.error("SPLITMATE_FIREBASE_CREDENTIALS isn't valid JSON (or base64 JSON); phone notifications are off")
        return None


def enabled() -> bool:
    return _service_account() is not None


def queue(db: Session, user_id: uuid.UUID, activity_id: uuid.UUID) -> None:
    if enabled():
        db.info.setdefault(_PENDING, []).append((user_id, activity_id))


@event.listens_for(Session, "after_commit")
def _after_commit(db: Session) -> None:
    pending = db.info.pop(_PENDING, None)
    if pending:
        _pool.submit(_deliver, pending)


@event.listens_for(Session, "after_rollback")
def _after_rollback(db: Session) -> None:
    db.info.pop(_PENDING, None)


def _access_token(info: dict) -> str:
    global _creds
    from google.auth.transport.requests import Request
    from google.oauth2 import service_account

    with _lock:
        if _creds is None:
            _creds = service_account.Credentials.from_service_account_info(
                info, scopes=["https://www.googleapis.com/auth/firebase.messaging"]
            )
        if not _creds.valid:
            _creds.refresh(Request())
        return _creds.token


def _money(minor: Any, currency: Any) -> str:
    if not isinstance(minor, int):
        return ""
    symbol = {"INR": "₹", "USD": "$", "EUR": "€", "GBP": "£"}.get(str(currency), f"{currency} ")
    return f"{symbol}{minor / 100:,.2f}"


def describe(type_: str, actor: str, data: dict, group: str) -> tuple[str, str] | None:
    """Notification title and text for an activity, or None to skip it."""
    amount = _money(data.get("amount_minor", data.get("total_minor")), data.get("currency"))
    title = data.get("title") or "an expense"
    texts = {
        "expense.finalized": f"{actor} added “{title}”" + (f" · {amount}" if amount else ""),
        "expense.updated": f"{actor} changed “{title}”",
        "expense.cancelled": f"{actor} deleted “{title}”",
        "repayment.requested": f"{actor} asked you to pay {amount}",
        "repayment.marked_sent": f"{actor} says they paid you {amount}. Tap to confirm you got it.",
        "repayment.resubmitted": f"{actor} says they paid you {amount}. Tap to check again.",
        "repayment.confirmed": f"{actor} confirmed your payment of {amount}",
        "repayment.rejected": f"{actor} says they didn't receive {amount}",
        "repayment.disputed": f"{actor} says the payment of {amount} isn't right",
        "repayment.cancelled": f"{actor} cancelled the payment of {amount}",
        "member.added": f"{actor} added {data.get('name', 'someone')} to {group}",
        "member.joined": f"{data.get('name', 'Someone')} joined {group}",
        "member.removed": f"{data.get('name', 'Someone')} left {group}",
    }
    text = texts.get(type_)
    return (group or "SplitMate", text) if text else None


def broadcast_update(version: str) -> None:
    """One 'new version' push to every registered phone. This is how people on
    OLDER app versions hear about an update: their app has no update card of
    its own, but it does get FCM notifications. Fired from app startup when
    the configured app_latest_version is one nobody was told about yet; runs
    on the push pool so boot never waits on FCM."""
    if not enabled():
        return
    _pool.submit(_broadcast_update_sync, version)


def _broadcast_update_sync(version: str) -> None:
    from ..db import SessionLocal
    from ..models import AppMeta, PushToken

    info = _service_account()
    if not info:
        return
    db = SessionLocal()
    try:
        row = db.get(AppMeta, "update_broadcast_version")
        if row is not None and row.value == version:
            return  # already told everyone about this one
        token = _access_token(info)
        url = f"https://fcm.googleapis.com/v1/projects/{info['project_id']}/messages:send"
        dead: list[str] = []
        sent = 0
        for phone in db.scalars(select(PushToken.token)):
            body = {
                "message": {
                    "token": phone,
                    "notification": {
                        "title": "SplitMate update available",
                        "body": f"Version {version} is ready. Open SplitMate and tap Update on the card to get it.",
                    },
                    "data": {"type": "app.update", "version": version},
                    "android": {"priority": "high", "notification": {"channel_id": "splitmate"}},
                }
            }
            r = requests.post(url, json=body, headers={"Authorization": f"Bearer {token}"}, timeout=10)
            if r.status_code in (400, 404) and ("UNREGISTERED" in r.text or "INVALID_ARGUMENT" in r.text):
                dead.append(phone)
            elif r.status_code >= 300:
                log.warning("FCM update broadcast failed: %s %s", r.status_code, r.text[:200])
            else:
                sent += 1
        if dead:
            db.execute(delete(PushToken).where(PushToken.token.in_(dead)))
        if row is None:
            db.add(AppMeta(key="update_broadcast_version", value=version))
        else:
            row.value = version
        db.commit()
        log.info("Update broadcast for %s sent to %d phone(s)", version, sent)
    except Exception:  # a broadcast problem must never keep the server from booting
        log.exception("Update broadcast failed")
    finally:
        db.close()


def _deliver(pending: list[tuple[uuid.UUID, uuid.UUID]]) -> None:
    from ..db import SessionLocal
    from ..models import ActivityEvent, Group, PushToken, User

    info = _service_account()
    if not info:
        return
    db = SessionLocal()
    try:
        token = _access_token(info)
        url = f"https://fcm.googleapis.com/v1/projects/{info['project_id']}/messages:send"
        dead: list[str] = []
        for user_id, activity_id in pending:
            ev = db.get(ActivityEvent, activity_id)
            if ev is None:
                continue
            actor = db.get(User, ev.actor_user_id) if ev.actor_user_id else None
            group = db.get(Group, ev.group_id) if ev.group_id else None
            msg = describe(ev.type, actor.display_name if actor else "Someone", ev.data or {}, group.name if group else "")
            if msg is None:
                continue
            for phone in db.scalars(select(PushToken.token).where(PushToken.user_id == user_id)):
                body = {
                    "message": {
                        "token": phone,
                        "notification": {"title": msg[0], "body": msg[1]},
                        "data": {
                            "type": ev.type,
                            "entity_type": ev.entity_type or "",
                            "entity_id": str(ev.entity_id or ""),
                            "group_id": str(ev.group_id or ""),
                        },
                        "android": {"priority": "high", "notification": {"channel_id": "splitmate"}},
                    }
                }
                r = requests.post(url, json=body, headers={"Authorization": f"Bearer {token}"}, timeout=10)
                if r.status_code in (400, 404) and ("UNREGISTERED" in r.text or "INVALID_ARGUMENT" in r.text):
                    dead.append(phone)  # app uninstalled or token replaced
                elif r.status_code >= 300:
                    log.warning("FCM send failed: %s %s", r.status_code, r.text[:200])
        if dead:
            db.execute(delete(PushToken).where(PushToken.token.in_(dead)))
            db.commit()
    except Exception:  # never let a notification problem surface anywhere else
        log.exception("Sending phone notifications failed")
    finally:
        db.close()
