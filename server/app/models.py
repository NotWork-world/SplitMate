"""Relational schema. Money columns are BigInteger minor units with an explicit currency."""

from __future__ import annotations

import uuid
from datetime import date, datetime, timezone
from typing import Any

from sqlalchemy import (
    JSON,
    BigInteger,
    Boolean,
    CheckConstraint,
    Date,
    DateTime,
    ForeignKey,
    Index,
    Integer,
    String,
    Text,
    UniqueConstraint,
    Uuid,
)
from sqlalchemy.orm import Mapped, mapped_column, relationship

from .db import Base


def utcnow() -> datetime:
    return datetime.now(timezone.utc)


def new_id() -> uuid.UUID:
    return uuid.uuid4()


class TimestampMixin:
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, nullable=False)


# ------------------------------------------------------------------ users & auth


class User(TimestampMixin, Base):
    __tablename__ = "users"

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=new_id)
    email: Mapped[str | None] = mapped_column(String(320), unique=True)
    display_name: Mapped[str] = mapped_column(String(80), nullable=False)
    # Public handle so friends can add you to a group (lowercase, unique).
    username: Mapped[str | None] = mapped_column(String(20), unique=True)
    password_hash: Mapped[str | None] = mapped_column(String(255))
    google_sub: Mapped[str | None] = mapped_column(String(255), unique=True)
    avatar_hue: Mapped[int] = mapped_column(Integer, default=260, nullable=False)
    upi_id: Mapped[str | None] = mapped_column(String(100))
    # The exact text of the person's own UPI QR (upi://pay?...), so it can be shown unchanged.
    upi_qr: Mapped[str | None] = mapped_column(String(1000))
    # Optional, shown to group members so they can nudge on WhatsApp.
    phone: Mapped[str | None] = mapped_column(String(20))
    default_currency: Mapped[str] = mapped_column(String(3), default="INR", nullable=False)
    preferences: Mapped[dict[str, Any]] = mapped_column(JSON, default=dict, nullable=False)
    deleted_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))


class RefreshToken(TimestampMixin, Base):
    __tablename__ = "refresh_tokens"

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=new_id)
    user_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True, nullable=False)
    family_id: Mapped[uuid.UUID] = mapped_column(Uuid, index=True, nullable=False)
    token_hash: Mapped[str] = mapped_column(String(64), unique=True, nullable=False)
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    revoked_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    used_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))


# ------------------------------------------------------------------ groups


class Group(TimestampMixin, Base):
    __tablename__ = "groups"
    __table_args__ = (
        CheckConstraint("type in ('personal','trip','home','couple','friends','other')", name="type"),
    )

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=new_id)
    name: Mapped[str] = mapped_column(String(80), nullable=False)
    type: Mapped[str] = mapped_column(String(16), default="other", nullable=False)
    emoji: Mapped[str | None] = mapped_column(String(16))
    currency: Mapped[str] = mapped_column(String(3), default="INR", nullable=False)
    start_date: Mapped[date | None] = mapped_column(Date)
    end_date: Mapped[date | None] = mapped_column(Date)
    created_by: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"))
    archived_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))

    members: Mapped[list[GroupMember]] = relationship(back_populates="group", order_by="GroupMember.created_at")


class GroupMember(TimestampMixin, Base):
    """A person in a group. ``user_id`` is empty for friends who aren't on SplitMate yet."""

    __tablename__ = "group_members"
    __table_args__ = (
        UniqueConstraint("group_id", "user_id", name="uq_group_members_group_user"),
        CheckConstraint("role in ('owner','admin','member')", name="role"),
        CheckConstraint("status in ('active','removed')", name="status"),
    )

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=new_id)
    group_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("groups.id", ondelete="CASCADE"), index=True, nullable=False)
    user_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"), index=True)
    display_name: Mapped[str] = mapped_column(String(80), nullable=False)
    contact_email: Mapped[str | None] = mapped_column(String(320))
    role: Mapped[str] = mapped_column(String(8), default="member", nullable=False)
    status: Mapped[str] = mapped_column(String(8), default="active", nullable=False)

    group: Mapped[Group] = relationship(back_populates="members")
    user: Mapped[User | None] = relationship()


class GroupInvite(TimestampMixin, Base):
    __tablename__ = "group_invites"

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=new_id)
    group_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("groups.id", ondelete="CASCADE"), index=True, nullable=False)
    code: Mapped[str] = mapped_column(String(32), unique=True, nullable=False)
    member_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("group_members.id", ondelete="CASCADE"))
    created_by: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"))
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    max_uses: Mapped[int] = mapped_column(Integer, default=20, nullable=False)
    uses: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    revoked_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))


# ------------------------------------------------------------------ expenses


class Expense(TimestampMixin, Base):
    __tablename__ = "expenses"
    __table_args__ = (
        CheckConstraint("status in ('draft','finalized','cancelled')", name="status"),
        CheckConstraint("version >= 1", name="version"),
        Index("ix_expenses_group_date", "group_id", "expense_date"),
    )

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=new_id)
    group_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("groups.id", ondelete="CASCADE"), index=True, nullable=False)
    created_by: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"))
    status: Mapped[str] = mapped_column(String(10), default="draft", nullable=False)
    # Incremented on every saved change. Finalised versions are kept in expense_versions.
    version: Mapped[int] = mapped_column(Integer, default=1, nullable=False)
    finalized_version: Mapped[int | None] = mapped_column(Integer)
    title: Mapped[str] = mapped_column(String(120), nullable=False)
    category: Mapped[str] = mapped_column(String(20), default="other", nullable=False)
    notes: Mapped[str | None] = mapped_column(Text)
    expense_date: Mapped[date] = mapped_column(Date, nullable=False)
    currency: Mapped[str] = mapped_column(String(3), nullable=False)
    split_kind: Mapped[str] = mapped_column(String(10), default="itemized", nullable=False)
    receipt_total_minor: Mapped[int | None] = mapped_column(BigInteger)
    rounding_mode: Mapped[str] = mapped_column(String(16), default="none", nullable=False)
    rounding_minor: Mapped[int] = mapped_column(BigInteger, default=0, nullable=False)
    total_minor: Mapped[int | None] = mapped_column(BigInteger)  # set when finalised
    engine_version: Mapped[int | None] = mapped_column(Integer)
    receipt_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("receipt_attachments.id", ondelete="SET NULL"))
    finalized_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    cancelled_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, onupdate=utcnow, nullable=False)

    items: Mapped[list[ExpenseItem]] = relationship(
        back_populates="expense", cascade="all, delete-orphan", order_by="ExpenseItem.position"
    )
    discounts: Mapped[list[ExpenseDiscount]] = relationship(
        cascade="all, delete-orphan", order_by="ExpenseDiscount.position"
    )
    charges: Mapped[list[ExpenseCharge]] = relationship(cascade="all, delete-orphan", order_by="ExpenseCharge.position")
    reported_taxes: Mapped[list[ExpenseReportedTax]] = relationship(cascade="all, delete-orphan")
    payers: Mapped[list[ExpensePayer]] = relationship(cascade="all, delete-orphan")
    allocations: Mapped[list[ExpenseAllocation]] = relationship(cascade="all, delete-orphan")
    tax_lines: Mapped[list[ExpenseTaxLine]] = relationship(cascade="all, delete-orphan")


class ExpenseItem(Base):
    __tablename__ = "expense_items"
    __table_args__ = (
        CheckConstraint("quantity_milli > 0", name="quantity"),
        CheckConstraint("unit_price_minor >= 0", name="price"),
        CheckConstraint("tax_rate_bp >= 0 and tax_rate_bp <= 10000", name="tax_rate"),
        UniqueConstraint("expense_id", "client_id", name="uq_expense_items_client"),
    )

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=new_id)
    expense_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("expenses.id", ondelete="CASCADE"), index=True, nullable=False)
    client_id: Mapped[str] = mapped_column(String(40), nullable=False)  # stable id used by the engine and the app
    position: Mapped[int] = mapped_column(Integer, nullable=False)
    name: Mapped[str] = mapped_column(String(120), nullable=False)
    quantity_milli: Mapped[int] = mapped_column(Integer, default=1000, nullable=False)
    unit_price_minor: Mapped[int] = mapped_column(BigInteger, nullable=False)
    discount_kind: Mapped[str | None] = mapped_column(String(8))
    discount_value: Mapped[int | None] = mapped_column(BigInteger)
    tax_rate_bp: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    tax_inclusive: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    tax_scheme: Mapped[str] = mapped_column(String(10), default="gst", nullable=False)
    split_mode: Mapped[str] = mapped_column(String(8), default="equal", nullable=False)
    review_state: Mapped[str] = mapped_column(String(10), default="pending", nullable=False)  # pending|claimed|skipped
    source: Mapped[str] = mapped_column(String(10), default="manual", nullable=False)  # manual|receipt
    ocr_confidence: Mapped[int | None] = mapped_column(Integer)  # 0-100 when from OCR
    # Calculated on finalisation (audit).
    gross_minor: Mapped[int | None] = mapped_column(BigInteger)
    discount_minor: Mapped[int | None] = mapped_column(BigInteger)
    bill_discount_minor: Mapped[int | None] = mapped_column(BigInteger)
    tax_minor: Mapped[int | None] = mapped_column(BigInteger)
    total_minor: Mapped[int | None] = mapped_column(BigInteger)

    expense: Mapped[Expense] = relationship(back_populates="items")
    consumers: Mapped[list[ItemConsumer]] = relationship(cascade="all, delete-orphan")


class ItemConsumer(Base):
    __tablename__ = "item_consumers"
    __table_args__ = (UniqueConstraint("item_id", "member_id", name="uq_item_consumers_item_member"),)

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=new_id)
    item_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("expense_items.id", ondelete="CASCADE"), index=True, nullable=False)
    member_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("group_members.id", ondelete="CASCADE"), index=True, nullable=False)
    value: Mapped[int] = mapped_column(BigInteger, default=1, nullable=False)
    allocated_minor: Mapped[int | None] = mapped_column(BigInteger)  # set on finalisation


class ExpenseDiscount(Base):
    __tablename__ = "expense_discounts"

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=new_id)
    expense_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("expenses.id", ondelete="CASCADE"), index=True, nullable=False)
    client_id: Mapped[str] = mapped_column(String(40), nullable=False)
    position: Mapped[int] = mapped_column(Integer, nullable=False)
    label: Mapped[str] = mapped_column(String(80), nullable=False)
    kind: Mapped[str] = mapped_column(String(8), nullable=False)
    value: Mapped[int] = mapped_column(BigInteger, nullable=False)
    stage: Mapped[str] = mapped_column(String(8), default="pre_tax", nullable=False)
    allocation: Mapped[str] = mapped_column(String(12), default="proportional", nullable=False)
    item_client_ids: Mapped[list[str] | None] = mapped_column(JSON)
    is_coupon: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    amount_minor: Mapped[int | None] = mapped_column(BigInteger)  # calculated


class ExpenseCharge(Base):
    __tablename__ = "expense_charges"

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=new_id)
    expense_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("expenses.id", ondelete="CASCADE"), index=True, nullable=False)
    client_id: Mapped[str] = mapped_column(String(40), nullable=False)
    position: Mapped[int] = mapped_column(Integer, nullable=False)
    label: Mapped[str] = mapped_column(String(80), nullable=False)
    type: Mapped[str] = mapped_column(String(12), nullable=False)
    kind: Mapped[str] = mapped_column(String(8), nullable=False)
    value: Mapped[int] = mapped_column(BigInteger, nullable=False)
    tax_rate_bp: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    tax_scheme: Mapped[str] = mapped_column(String(10), default="gst", nullable=False)
    allocation: Mapped[str] = mapped_column(String(12), default="proportional", nullable=False)
    amount_minor: Mapped[int | None] = mapped_column(BigInteger)
    tax_minor: Mapped[int | None] = mapped_column(BigInteger)


class ExpenseReportedTax(Base):
    """Tax lines exactly as printed on a receipt (kept distinct from calculated tax)."""

    __tablename__ = "expense_reported_taxes"

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=new_id)
    expense_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("expenses.id", ondelete="CASCADE"), index=True, nullable=False)
    component: Mapped[str] = mapped_column(String(5), nullable=False)
    rate_bp: Mapped[int] = mapped_column(Integer, nullable=False)
    amount_minor: Mapped[int] = mapped_column(BigInteger, nullable=False)


class ExpenseTaxLine(Base):
    """Calculated tax breakdown at finalisation."""

    __tablename__ = "expense_tax_lines"

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=new_id)
    expense_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("expenses.id", ondelete="CASCADE"), index=True, nullable=False)
    component: Mapped[str] = mapped_column(String(5), nullable=False)
    component_rate_bp: Mapped[int] = mapped_column(Integer, nullable=False)
    group_rate_bp: Mapped[int] = mapped_column(Integer, nullable=False)
    scheme: Mapped[str] = mapped_column(String(10), nullable=False)
    inclusive: Mapped[bool] = mapped_column(Boolean, nullable=False)
    taxable_base_minor: Mapped[int] = mapped_column(BigInteger, nullable=False)
    amount_minor: Mapped[int] = mapped_column(BigInteger, nullable=False)
    computed_amount_minor: Mapped[int] = mapped_column(BigInteger, nullable=False)
    source: Mapped[str] = mapped_column(String(10), nullable=False)


class ExpensePayer(Base):
    """Who paid the merchant (contribution), separate from who consumed."""

    __tablename__ = "expense_payers"
    __table_args__ = (
        UniqueConstraint("expense_id", "member_id", name="uq_expense_payers_expense_member"),
        CheckConstraint("amount_minor >= 0", name="amount"),
    )

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=new_id)
    expense_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("expenses.id", ondelete="CASCADE"), index=True, nullable=False)
    member_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("group_members.id", ondelete="CASCADE"), nullable=False)
    # Null while the draft's total isn't known yet and a single payer pays "the whole bill".
    amount_minor: Mapped[int | None] = mapped_column(BigInteger)


class ExpenseAllocation(Base):
    """Each person's final share of a finalised expense, with its breakdown."""

    __tablename__ = "expense_allocations"
    __table_args__ = (UniqueConstraint("expense_id", "member_id", name="uq_expense_allocations_expense_member"),)

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=new_id)
    expense_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("expenses.id", ondelete="CASCADE"), index=True, nullable=False)
    member_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("group_members.id", ondelete="CASCADE"), index=True, nullable=False)
    amount_minor: Mapped[int] = mapped_column(BigInteger, nullable=False)
    breakdown: Mapped[dict[str, Any]] = mapped_column(JSON, nullable=False)


class ExpenseVersion(TimestampMixin, Base):
    """Immutable snapshot of every finalised version: inputs, full calculation and payers."""

    __tablename__ = "expense_versions"
    __table_args__ = (UniqueConstraint("expense_id", "version", name="uq_expense_versions_expense_version"),)

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=new_id)
    expense_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("expenses.id", ondelete="CASCADE"), index=True, nullable=False)
    version: Mapped[int] = mapped_column(Integer, nullable=False)
    actor_user_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"))
    bill_input: Mapped[dict[str, Any]] = mapped_column(JSON, nullable=False)
    calculation: Mapped[dict[str, Any]] = mapped_column(JSON, nullable=False)
    payers: Mapped[dict[str, Any]] = mapped_column(JSON, nullable=False)
    total_minor: Mapped[int] = mapped_column(BigInteger, nullable=False)


# ------------------------------------------------------------------ ledger & repayments


class LedgerEntry(TimestampMixin, Base):
    """Append-only directed obligation: debtor owes creditor ``amount_minor``.

    Expense edits/cancellations append reversal entries (pair swapped); a
    confirmed repayment appends exactly one entry (unique repayment_id).
    """

    __tablename__ = "ledger_entries"
    __table_args__ = (
        CheckConstraint("amount_minor > 0", name="amount_positive"),
        CheckConstraint("debtor_member_id <> creditor_member_id", name="distinct_parties"),
        CheckConstraint("kind in ('expense','reversal','repayment')", name="kind"),
        UniqueConstraint("repayment_id", name="uq_ledger_entries_repayment"),
        Index("ix_ledger_group_currency", "group_id", "currency"),
    )

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=new_id)
    group_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("groups.id", ondelete="CASCADE"), nullable=False)
    currency: Mapped[str] = mapped_column(String(3), nullable=False)
    debtor_member_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("group_members.id", ondelete="CASCADE"), index=True, nullable=False)
    creditor_member_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("group_members.id", ondelete="CASCADE"), index=True, nullable=False)
    amount_minor: Mapped[int] = mapped_column(BigInteger, nullable=False)
    kind: Mapped[str] = mapped_column(String(10), nullable=False)
    expense_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("expenses.id", ondelete="CASCADE"), index=True)
    expense_version: Mapped[int | None] = mapped_column(Integer)
    repayment_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("repayments.id", ondelete="CASCADE"))


REPAYMENT_STATES = (
    "REQUESTED",
    "MARKED_SENT",
    "AWAITING_CONFIRMATION",
    "CONFIRMED",
    "DISPUTED",
    "CANCELLED",
    "REJECTED",
    "REVERTED",
)


class Repayment(TimestampMixin, Base):
    __tablename__ = "repayments"
    __table_args__ = (
        CheckConstraint("amount_minor > 0", name="amount_positive"),
        CheckConstraint("debtor_member_id <> creditor_member_id", name="distinct_parties"),
        CheckConstraint(
            "status in (" + ",".join(f"'{s}'" for s in REPAYMENT_STATES) + ")",
            name="status",
        ),
        Index("ix_repayments_group_status", "group_id", "status"),
    )

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=new_id)
    group_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("groups.id", ondelete="CASCADE"), nullable=False)
    currency: Mapped[str] = mapped_column(String(3), nullable=False)
    debtor_member_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("group_members.id", ondelete="CASCADE"), index=True, nullable=False)
    creditor_member_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("group_members.id", ondelete="CASCADE"), index=True, nullable=False)
    amount_minor: Mapped[int] = mapped_column(BigInteger, nullable=False)
    status: Mapped[str] = mapped_column(String(24), nullable=False)
    method: Mapped[str] = mapped_column(String(10), default="other", nullable=False)  # cash|upi|bank|other
    note: Mapped[str | None] = mapped_column(String(280))
    reference: Mapped[str | None] = mapped_column(String(80))
    created_by: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"))
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, onupdate=utcnow, nullable=False)
    confirmed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))

    events: Mapped[list[RepaymentEvent]] = relationship(cascade="all, delete-orphan", order_by="RepaymentEvent.created_at")


class RepaymentEvent(TimestampMixin, Base):
    __tablename__ = "repayment_events"

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=new_id)
    repayment_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("repayments.id", ondelete="CASCADE"), index=True, nullable=False)
    actor_user_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"))
    action: Mapped[str] = mapped_column(String(16), nullable=False)
    from_status: Mapped[str | None] = mapped_column(String(24))
    to_status: Mapped[str] = mapped_column(String(24), nullable=False)
    note: Mapped[str | None] = mapped_column(String(280))


# ------------------------------------------------------------------ receipts


class ReceiptAttachment(TimestampMixin, Base):
    __tablename__ = "receipt_attachments"

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=new_id)
    group_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("groups.id", ondelete="CASCADE"), index=True, nullable=False)
    uploaded_by: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"))
    storage_key: Mapped[str] = mapped_column(String(200), unique=True, nullable=False)
    content_type: Mapped[str] = mapped_column(String(40), nullable=False)
    size_bytes: Mapped[int] = mapped_column(Integer, nullable=False)
    sha256: Mapped[str] = mapped_column(String(64), nullable=False)
    deleted_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))


class OcrResult(TimestampMixin, Base):
    __tablename__ = "ocr_results"

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=new_id)
    receipt_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("receipt_attachments.id", ondelete="CASCADE"), index=True, nullable=False)
    provider: Mapped[str] = mapped_column(String(30), nullable=False)
    raw_text: Mapped[str] = mapped_column(Text, nullable=False)
    parsed: Mapped[dict[str, Any]] = mapped_column(JSON, nullable=False)


# ------------------------------------------------------------------ activity, audit, idempotency


class ActivityEvent(TimestampMixin, Base):
    __tablename__ = "activity_events"
    __table_args__ = (Index("ix_activity_group_created", "group_id", "created_at"),)

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=new_id)
    group_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("groups.id", ondelete="CASCADE"))
    actor_user_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"))
    type: Mapped[str] = mapped_column(String(40), nullable=False)
    entity_type: Mapped[str] = mapped_column(String(20), nullable=False)
    entity_id: Mapped[uuid.UUID | None] = mapped_column(Uuid)
    data: Mapped[dict[str, Any]] = mapped_column(JSON, default=dict, nullable=False)


class Notification(TimestampMixin, Base):
    __tablename__ = "notifications"
    __table_args__ = (Index("ix_notifications_user_created", "user_id", "created_at"),)

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=new_id)
    user_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
    activity_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("activity_events.id", ondelete="CASCADE"), nullable=False)
    read_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))

    activity: Mapped[ActivityEvent] = relationship()


class AuditEvent(TimestampMixin, Base):
    __tablename__ = "audit_events"

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=new_id)
    actor_user_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"))
    action: Mapped[str] = mapped_column(String(40), nullable=False)
    entity_type: Mapped[str] = mapped_column(String(20), nullable=False)
    entity_id: Mapped[uuid.UUID | None] = mapped_column(Uuid, index=True)
    data: Mapped[dict[str, Any]] = mapped_column(JSON, default=dict, nullable=False)


class IdempotencyKey(TimestampMixin, Base):
    __tablename__ = "idempotency_keys"
    __table_args__ = (UniqueConstraint("user_id", "key", name="uq_idempotency_keys_user_key"),)

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=new_id)
    user_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
    key: Mapped[str] = mapped_column(String(80), nullable=False)
    scope: Mapped[str] = mapped_column(String(60), nullable=False)
    request_hash: Mapped[str] = mapped_column(String(64), nullable=False)
    status_code: Mapped[int] = mapped_column(Integer, nullable=False)
    response: Mapped[dict[str, Any]] = mapped_column(JSON, nullable=False)


class PushToken(TimestampMixin, Base):
    """A phone that should get notifications for this person (Firebase Cloud Messaging token)."""

    __tablename__ = "push_tokens"

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=new_id)
    user_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True, nullable=False)
    token: Mapped[str] = mapped_column(String(512), unique=True, nullable=False)
    platform: Mapped[str] = mapped_column(String(16), default="android", nullable=False)
