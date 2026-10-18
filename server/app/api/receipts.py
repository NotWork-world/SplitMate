from __future__ import annotations

import hashlib
import io
import uuid
from datetime import timedelta

from fastapi import APIRouter, Depends, File, Query, UploadFile
from fastapi.responses import Response
from PIL import Image, UnidentifiedImageError
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.orm import Session

from ..core.config import get_settings
from ..core.errors import ApiError, invalid, not_found
from ..core.ratelimit import write_limit
from ..core.security import verify_signature
from ..db import get_db
from ..deps import current_user, membership
from ..integrations.receipt_parser import OcrLine, parse_receipt
from ..integrations.storage import get_storage
from ..models import Expense, ReceiptAttachment, User, utcnow
from ..money.currency import SUPPORTED_CURRENCIES

router = APIRouter(tags=["receipts"])

ALLOWED = {"JPEG": "image/jpeg", "PNG": "image/png", "WEBP": "image/webp"}


class LineIn(BaseModel):
    text: str = Field(max_length=500)
    left: float = 0
    top: float = 0
    width: float = 0
    height: float = 0


class ParseIn(BaseModel):
    lines: list[LineIn] = Field(max_length=600)
    currency: str = Field(default="INR", min_length=3, max_length=3)
    provider: str = Field(default="mlkit-on-device", max_length=40)


@router.post("/receipts/parse", dependencies=[Depends(write_limit)])
def parse(body: ParseIn, user: User = Depends(current_user)):
    """Structure OCR text into items, taxes and totals for the person to review. Nothing is saved."""
    if body.currency.upper() not in SUPPORTED_CURRENCIES:
        raise invalid("unknown_currency", "That currency isn't supported.")
    lines = [OcrLine(**line.model_dump()) for line in body.lines]
    return {"provider": body.provider, **parse_receipt(lines, body.currency.upper()).to_dict()}


@router.post("/groups/{group_id}/receipts", status_code=201, dependencies=[Depends(write_limit)])
async def upload(group_id: uuid.UUID, file: UploadFile = File(...), user: User = Depends(current_user), db: Session = Depends(get_db)):
    membership(db, group_id, user)
    limit = get_settings().receipt_max_mb * 1024 * 1024
    data = await file.read(limit + 1)
    if len(data) > limit:
        raise ApiError(413, "file_too_large", f"Receipts can be up to {get_settings().receipt_max_mb} MB.")
    try:
        with Image.open(io.BytesIO(data)) as img:
            fmt = img.format
            img.verify()  # rejects truncated/corrupt files and non-images with an image extension
    except (UnidentifiedImageError, Image.DecompressionBombError, OSError, SyntaxError):
        raise invalid("not_an_image", "That file isn't a photo SplitMate can read (JPEG, PNG or WebP).") from None
    if fmt not in ALLOWED:
        raise invalid("not_an_image", "Use a JPEG, PNG or WebP photo.")
    rid = uuid.uuid4()
    key = f"receipts/{group_id}/{rid}.{fmt.lower()}"
    get_storage().put(key, data, ALLOWED[fmt])
    rec = ReceiptAttachment(
        id=rid, group_id=group_id, uploaded_by=user.id, storage_key=key, content_type=ALLOWED[fmt],
        size_bytes=len(data), sha256=hashlib.sha256(data).hexdigest(),
    )
    db.add(rec)
    db.commit()
    _sweep_unused(db, user)
    return {"id": rec.id, "content_type": rec.content_type, "size_bytes": rec.size_bytes}


def _sweep_unused(db: Session, user: User) -> None:
    """Photos are temporary: drop this person's uploads older than two days that no draft uses
    (abandoned scans, or a delete that failed after a bill was finalised)."""
    in_use = select(Expense.receipt_id).where(Expense.status == "draft", Expense.receipt_id.is_not(None))
    stale = db.scalars(
        select(ReceiptAttachment).where(
            ReceiptAttachment.uploaded_by == user.id,
            ReceiptAttachment.deleted_at.is_(None),
            ReceiptAttachment.created_at < utcnow() - timedelta(days=2),
            ReceiptAttachment.id.not_in(in_use),
        ).limit(50)
    ).all()
    for rec in stale:
        try:
            get_storage().delete(rec.storage_key)
        except Exception:
            continue
        rec.deleted_at = utcnow()
    if stale:
        db.commit()


def _receipt(db: Session, receipt_id: uuid.UUID, user: User) -> ReceiptAttachment:
    rec = db.get(ReceiptAttachment, receipt_id)
    if rec is None or rec.deleted_at is not None:
        raise not_found("Receipt")
    try:
        membership(db, rec.group_id, user)
    except ApiError:
        raise not_found("Receipt") from None
    return rec


@router.get("/receipts/{receipt_id}/url")
def signed_url(receipt_id: uuid.UUID, user: User = Depends(current_user), db: Session = Depends(get_db)):
    rec = _receipt(db, receipt_id, user)
    url, exp = get_storage().signed_url(rec.storage_key, str(rec.id), get_settings().signed_url_seconds)
    return {"url": url, "expires_at": exp}


@router.get("/receipts/{receipt_id}/file")
def file(receipt_id: uuid.UUID, exp: int = Query(...), sig: str = Query(..., max_length=128), db: Session = Depends(get_db)):
    """Local-storage download. Authorised by a short-lived signature issued to a group member."""
    if not verify_signature(str(receipt_id), exp, sig):
        raise ApiError(403, "link_expired", "This receipt link has expired. Open it again from the expense.")
    rec = db.get(ReceiptAttachment, receipt_id)
    if rec is None or rec.deleted_at is not None:
        raise not_found("Receipt")
    return Response(
        get_storage().get(rec.storage_key),
        media_type=rec.content_type,
        headers={"Cache-Control": "private, max-age=60", "X-Content-Type-Options": "nosniff"},
    )


@router.delete("/receipts/{receipt_id}", status_code=204)
def delete(receipt_id: uuid.UUID, user: User = Depends(current_user), db: Session = Depends(get_db)):
    rec = _receipt(db, receipt_id, user)
    if rec.uploaded_by != user.id:
        me = membership(db, rec.group_id, user)
        if me.role not in ("owner", "admin"):
            raise ApiError(403, "forbidden", "Only the person who added the receipt or an admin can delete it.")
    get_storage().delete(rec.storage_key)
    rec.deleted_at = utcnow()
    db.commit()
