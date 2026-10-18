"""API request/response models. Money is always integer minor units + a currency code."""

from __future__ import annotations

import uuid
from datetime import date, datetime
from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, EmailStr, Field, field_validator

MAX_MINOR = 10**13  # far above any real bill, small enough for JS safe integers
Money = Field(ge=0, le=MAX_MINOR)

CATEGORIES = (
    "food", "rent", "groceries", "transport", "fuel", "shopping", "utilities",
    "travel", "entertainment", "tickets", "health", "other",
)
GroupType = Literal["trip", "home", "couple", "friends", "other"]


class Out(BaseModel):
    model_config = ConfigDict(from_attributes=True)


def _clean(v: str) -> str:
    v = " ".join(v.split())
    if not v:
        raise ValueError("can't be empty")
    return v


# ------------------------------------------------------------------ auth & users


class RegisterIn(BaseModel):
    email: EmailStr
    password: str = Field(min_length=8, max_length=128)
    display_name: str = Field(min_length=1, max_length=80)

    _n = field_validator("display_name")(_clean)


class LoginIn(BaseModel):
    email: EmailStr
    password: str = Field(min_length=1, max_length=128)


class GoogleIn(BaseModel):
    id_token: str = Field(min_length=10, max_length=4096)


class RefreshIn(BaseModel):
    refresh_token: str = Field(min_length=10, max_length=200)


class UserOut(Out):
    id: uuid.UUID
    email: str | None
    display_name: str
    avatar_hue: int
    upi_id: str | None
    default_currency: str
    preferences: dict[str, Any]
    has_password: bool = False
    has_google: bool = False
    created_at: datetime


class TokenOut(BaseModel):
    access_token: str
    refresh_token: str
    token_type: str = "bearer"
    expires_in: int
    user: UserOut


class ProfileUpdate(BaseModel):
    display_name: str | None = Field(default=None, min_length=1, max_length=80)
    upi_id: str | None = Field(default=None, max_length=100, pattern=r"^$|^[a-zA-Z0-9.\-_]{2,256}@[a-zA-Z][a-zA-Z0-9]{1,64}$")
    default_currency: str | None = Field(default=None, min_length=3, max_length=3)
    avatar_hue: int | None = Field(default=None, ge=0, le=359)
    preferences: dict[str, bool] | None = None

    _n = field_validator("display_name")(lambda v: _clean(v) if v is not None else v)


class PasswordChange(BaseModel):
    current_password: str | None = Field(default=None, max_length=128)
    new_password: str = Field(min_length=8, max_length=128)


class DeleteAccountIn(BaseModel):
    confirm: Literal["DELETE"]
    password: str | None = Field(default=None, max_length=128)


# ------------------------------------------------------------------ groups


class GroupCreate(BaseModel):
    name: str = Field(min_length=1, max_length=80)
    type: GroupType = "friends"
    emoji: str | None = Field(default=None, max_length=16)
    currency: str = Field(default="INR", min_length=3, max_length=3)
    start_date: date | None = None
    end_date: date | None = None
    members: list[MemberCreate] = Field(default_factory=list, max_length=50)

    _n = field_validator("name")(_clean)


class GroupUpdate(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=80)
    type: GroupType | None = None
    emoji: str | None = Field(default=None, max_length=16)
    currency: str | None = Field(default=None, min_length=3, max_length=3)
    start_date: date | None = None
    end_date: date | None = None
    archived: bool | None = None

    _n = field_validator("name")(lambda v: _clean(v) if v is not None else v)


class MemberCreate(BaseModel):
    display_name: str = Field(min_length=1, max_length=80)
    contact_email: EmailStr | None = None

    _n = field_validator("display_name")(_clean)


class MemberUpdate(BaseModel):
    display_name: str | None = Field(default=None, min_length=1, max_length=80)
    role: Literal["admin", "member"] | None = None


class MemberOut(Out):
    id: uuid.UUID
    display_name: str
    user_id: uuid.UUID | None
    role: str
    status: str
    is_me: bool = False
    is_registered: bool = False
    avatar_hue: int = 260


class BalanceLine(BaseModel):
    currency: str
    amount_minor: int  # positive = you are owed, negative = you owe


class GroupOut(Out):
    id: uuid.UUID
    name: str
    type: str
    emoji: str | None
    currency: str
    start_date: date | None
    end_date: date | None
    archived: bool
    created_at: datetime
    my_member_id: uuid.UUID
    my_role: str
    members: list[MemberOut]
    my_balances: list[BalanceLine] = []
    expense_count: int = 0


class InviteOut(BaseModel):
    code: str
    expires_at: datetime
    member_id: uuid.UUID | None
    share_text: str


class InvitePreview(BaseModel):
    group_name: str
    group_emoji: str | None
    member_count: int
    claimable_members: list[MemberOut]


class InviteAccept(BaseModel):
    member_id: uuid.UUID | None = None  # claim an existing placeholder, else join as a new member


# ------------------------------------------------------------------ expenses


class DiscountSpecIn(BaseModel):
    kind: Literal["fixed", "percent"]
    value: int = Money


class ConsumerIn(BaseModel):
    member_id: uuid.UUID
    value: int = Field(default=1, ge=0, le=MAX_MINOR)


class ItemIn(BaseModel):
    client_id: str = Field(min_length=1, max_length=40)
    name: str = Field(min_length=1, max_length=120)
    quantity_milli: int = Field(default=1000, gt=0, le=10**7)
    unit_price_minor: int = Money
    discount: DiscountSpecIn | None = None
    tax_rate_bp: int = Field(default=0, ge=0, le=10000)
    tax_inclusive: bool = False
    tax_scheme: Literal["gst", "cgst_sgst", "igst"] = "gst"
    split_mode: Literal["equal", "shares", "percent", "exact"] = "equal"
    consumers: list[ConsumerIn] = Field(default_factory=list, max_length=100)
    review_state: Literal["pending", "claimed", "skipped"] = "pending"
    source: Literal["manual", "receipt"] = "manual"
    ocr_confidence: int | None = Field(default=None, ge=0, le=100)

    _n = field_validator("name")(_clean)


class BillDiscountIn(BaseModel):
    client_id: str = Field(min_length=1, max_length=40)
    label: str = Field(default="Discount", max_length=80)
    kind: Literal["fixed", "percent"]
    value: int = Money
    stage: Literal["pre_tax", "post_tax"] = "pre_tax"
    allocation: Literal["proportional", "equal"] = "proportional"
    item_client_ids: list[str] | None = Field(default=None, max_length=300)
    is_coupon: bool = False


class ChargeIn(BaseModel):
    client_id: str = Field(min_length=1, max_length=40)
    label: str = Field(max_length=80)
    type: Literal["service", "packaging", "delivery", "tip", "other", "adjustment"]
    kind: Literal["fixed", "percent"] = "fixed"
    value: int = Field(ge=-MAX_MINOR, le=MAX_MINOR)
    tax_rate_bp: int = Field(default=0, ge=0, le=10000)
    tax_scheme: Literal["gst", "cgst_sgst", "igst"] = "gst"
    allocation: Literal["proportional", "equal"] = "proportional"


class ReportedTaxIn(BaseModel):
    component: Literal["GST", "CGST", "SGST", "IGST"]
    rate_bp: int = Field(gt=0, le=10000)
    amount_minor: int = Money


class RoundingIn(BaseModel):
    mode: Literal["none", "explicit", "nearest_unit"] = "none"
    amount_minor: int = Field(default=0, ge=-MAX_MINOR, le=MAX_MINOR)


class PayerIn(BaseModel):
    member_id: uuid.UUID
    amount_minor: int | None = Field(default=None, ge=0, le=MAX_MINOR)


class ExpenseIn(BaseModel):
    title: str = Field(min_length=1, max_length=120)
    category: str = "other"
    notes: str | None = Field(default=None, max_length=2000)
    expense_date: date
    currency: str = Field(min_length=3, max_length=3)
    split_kind: Literal["itemized", "equal", "exact", "percent", "shares"] = "itemized"
    items: list[ItemIn] = Field(default_factory=list, max_length=300)
    discounts: list[BillDiscountIn] = Field(default_factory=list, max_length=20)
    charges: list[ChargeIn] = Field(default_factory=list, max_length=20)
    reported_taxes: list[ReportedTaxIn] = Field(default_factory=list, max_length=20)
    rounding: RoundingIn = Field(default_factory=RoundingIn)
    receipt_total_minor: int | None = Field(default=None, ge=0, le=MAX_MINOR)
    payers: list[PayerIn] = Field(default_factory=list, max_length=50)
    receipt_id: uuid.UUID | None = None

    _n = field_validator("title")(_clean)

    @field_validator("category")
    @classmethod
    def _category(cls, v: str) -> str:
        if v not in CATEGORIES:
            raise ValueError(f"must be one of {', '.join(CATEGORIES)}")
        return v

    @field_validator("currency")
    @classmethod
    def _currency(cls, v: str) -> str:
        return v.upper()


class ExpenseUpdateIn(ExpenseIn):
    expected_version: int = Field(ge=1)


class PreviewIn(BaseModel):
    """Stateless calculation for any member of the group (no persistence)."""

    expense: ExpenseIn


class FinalizeIn(BaseModel):
    expected_version: int = Field(ge=1)
    # The total the phone showed. Only compared with the server's own calculation.
    client_total_minor: int | None = None


class CancelIn(BaseModel):
    expected_version: int = Field(ge=1)
    reason: str | None = Field(default=None, max_length=280)


class ExpenseSummaryOut(BaseModel):
    id: uuid.UUID
    group_id: uuid.UUID
    group_name: str
    title: str
    category: str
    status: str
    expense_date: date
    currency: str
    total_minor: int | None
    paid_by: list[str]
    my_share_minor: int | None
    my_net_minor: int | None  # paid - share for the caller
    item_count: int
    created_at: datetime


class Page(BaseModel):
    items: list[Any]
    next_offset: int | None


# ------------------------------------------------------------------ repayments


class RepaymentCreate(BaseModel):
    group_id: uuid.UUID
    currency: str = Field(min_length=3, max_length=3)
    amount_minor: int = Field(gt=0, le=MAX_MINOR)
    # "request": the caller (creditor) asks other_member to pay.
    # "record": the caller (debtor) records that they paid other_member.
    mode: Literal["request", "record"]
    other_member_id: uuid.UUID
    method: Literal["cash", "upi", "bank", "other"] = "other"
    note: str | None = Field(default=None, max_length=280)
    reference: str | None = Field(default=None, max_length=80)


class RepaymentAction(BaseModel):
    action: Literal["mark_sent", "confirm", "dispute", "reject", "cancel", "resubmit"]
    note: str | None = Field(default=None, max_length=280)
    reference: str | None = Field(default=None, max_length=80)
    method: Literal["cash", "upi", "bank", "other"] | None = None


class RepaymentEventOut(Out):
    action: str
    from_status: str | None
    to_status: str
    note: str | None
    actor_user_id: uuid.UUID | None
    created_at: datetime


class RepaymentOut(BaseModel):
    id: uuid.UUID
    group_id: uuid.UUID
    group_name: str
    currency: str
    amount_minor: int
    status: str
    method: str
    note: str | None
    reference: str | None
    debtor: MemberOut
    creditor: MemberOut
    i_am: Literal["debtor", "creditor", "other"]
    allowed_actions: list[str]
    created_at: datetime
    updated_at: datetime
    confirmed_at: datetime | None
    events: list[RepaymentEventOut]


GroupCreate.model_rebuild()
