"""Idempotency-Key support for requests that create financial records.

A retried request with the same key and body returns the stored response
instead of running again. The key row is inserted in the same transaction as
the work, so a crash leaves neither; a concurrent duplicate hits the unique
constraint, rolls back, and returns the winner's stored response.
"""

from __future__ import annotations

import hashlib
import json
from collections.abc import Callable
from typing import Any

from fastapi.encoders import jsonable_encoder
from fastapi.responses import JSONResponse
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from ..core.errors import ApiError
from ..models import IdempotencyKey, User


def _hash(payload: Any) -> str:
    return hashlib.sha256(json.dumps(jsonable_encoder(payload), sort_keys=True).encode()).hexdigest()


def run(
    db: Session,
    user: User,
    key: str | None,
    scope: str,
    payload: Any,
    work: Callable[[], Any],
    status_code: int = 200,
) -> Any:
    if not key:
        result = work()
        db.commit()
        return result
    if len(key) > 80:
        raise ApiError(422, "invalid_idempotency_key", "Idempotency-Key is too long.")
    request_hash = _hash({"scope": scope, "payload": payload})

    def replay(row: IdempotencyKey) -> JSONResponse:
        if row.request_hash != request_hash:
            raise ApiError(
                422, "idempotency_key_reused", "This Idempotency-Key was already used for a different request."
            )
        return JSONResponse(row.response, status_code=row.status_code, headers={"Idempotent-Replay": "true"})

    existing = db.scalar(select(IdempotencyKey).where(IdempotencyKey.user_id == user.id, IdempotencyKey.key == key))
    if existing:
        return replay(existing)

    result = work()
    body = jsonable_encoder(result)
    db.add(IdempotencyKey(user_id=user.id, key=key, scope=scope, request_hash=request_hash, status_code=status_code, response=body))
    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        winner = db.scalar(select(IdempotencyKey).where(IdempotencyKey.user_id == user.id, IdempotencyKey.key == key))
        if winner is None:
            raise
        return replay(winner)
    return result
