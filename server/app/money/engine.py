"""SplitMate bill engine: exact, explainable, integer minor units only.

Order of operations (see PLAN.md §2, mirrored in mobile/src/money/engine.ts):

1. line gross      = round_half_up(quantity_milli * unit_price / 1000)
2. item discount   -> line net (fixed minor amount or basis points of gross)
3. pre-tax bill discounts, in entry order, each on the running amount of its
   eligible items, allocated to those items in proportion to that amount
4. tax per group (rate, scheme, inclusive):
   - inclusive: base = round_half_up(A * 10000 / (10000 + rate)), tax = A - base
   - exclusive: tax = round_half_up(B * rate / 10000)  (gst / igst)
                cgst = sgst = round_half_up(B * rate / 20000)  (cgst_sgst)
   - receipt-reported components replace the computed tax for their group
   group tax is allocated to items/charges in proportion to their base
5. charges: fixed or basis points of the pre-tax subtotal (sum of item bases),
   optional exclusive tax, allocated to people proportionally or equally
6. post-tax discounts on the running total, allocated to people
7. rounding adjustment (explicit or nearest whole unit), allocated to people
8. final payable; a receipt total that differs blocks finalisation

Every split uses ``allocate`` (largest remainder, ties by smaller key), so each
component, and therefore each person's total, sums exactly to the bill.
"""

from __future__ import annotations

from dataclasses import asdict, dataclass, field
from typing import Any

from .allocate import allocate, allocate_equal, div_round_half_up
from .currency import UnknownCurrency, format_minor, get_currency

ENGINE_VERSION = 1
BP = 10_000  # basis points in 100%

SPLIT_MODES = ("equal", "shares", "percent", "exact")
TAX_SCHEMES = ("gst", "cgst_sgst", "igst")
DISCOUNT_KINDS = ("fixed", "percent")
DISCOUNT_STAGES = ("pre_tax", "post_tax")
ALLOCATIONS = ("proportional", "equal")
CHARGE_TYPES = ("service", "packaging", "delivery", "tip", "other", "adjustment")
ROUNDING_MODES = ("none", "explicit", "nearest_unit")
TAX_COMPONENTS = ("GST", "CGST", "SGST", "IGST")


# ---------------------------------------------------------------- inputs


@dataclass
class Discount:
    kind: str
    value: int  # minor units when fixed, basis points when percent


@dataclass
class Consumer:
    member_id: str
    value: int = 1  # shares: weight; percent: basis points; exact: minor units


@dataclass
class Item:
    id: str
    name: str
    quantity_milli: int
    unit_price_minor: int
    discount: Discount | None = None
    tax_rate_bp: int = 0
    tax_inclusive: bool = False
    tax_scheme: str = "gst"
    split_mode: str = "equal"
    consumers: list[Consumer] = field(default_factory=list)


@dataclass
class BillDiscount:
    id: str
    label: str
    kind: str
    value: int
    stage: str = "pre_tax"
    allocation: str = "proportional"  # post_tax only; pre_tax is always proportional
    item_ids: list[str] | None = None  # pre_tax eligibility; None = all items
    is_coupon: bool = False


@dataclass
class Charge:
    id: str
    label: str
    type: str
    kind: str
    value: int
    tax_rate_bp: int = 0
    tax_scheme: str = "gst"
    allocation: str = "proportional"


@dataclass
class ReportedTax:
    component: str  # GST | CGST | SGST | IGST
    rate_bp: int  # the component's own rate as printed (CGST 2.5% -> 250)
    amount_minor: int


@dataclass
class Rounding:
    mode: str = "none"
    amount_minor: int = 0


@dataclass
class BillInput:
    currency: str
    items: list[Item]
    discounts: list[BillDiscount] = field(default_factory=list)
    charges: list[Charge] = field(default_factory=list)
    reported_taxes: list[ReportedTax] = field(default_factory=list)
    rounding: Rounding = field(default_factory=Rounding)
    receipt_total_minor: int | None = None

    @staticmethod
    def from_dict(d: dict[str, Any]) -> BillInput:
        def item(x: dict[str, Any]) -> Item:
            disc = x.get("discount")
            return Item(
                id=str(x["id"]),
                name=x.get("name", ""),
                quantity_milli=int(x.get("quantity_milli", 1000)),
                unit_price_minor=int(x["unit_price_minor"]),
                discount=Discount(disc["kind"], int(disc["value"])) if disc else None,
                tax_rate_bp=int(x.get("tax_rate_bp", 0)),
                tax_inclusive=bool(x.get("tax_inclusive", False)),
                tax_scheme=x.get("tax_scheme", "gst"),
                split_mode=x.get("split_mode", "equal"),
                consumers=[Consumer(str(c["member_id"]), int(c.get("value", 1))) for c in x.get("consumers", [])],
            )

        rounding = d.get("rounding") or {}
        return BillInput(
            currency=d["currency"],
            items=[item(x) for x in d.get("items", [])],
            discounts=[
                BillDiscount(
                    id=str(x["id"]),
                    label=x.get("label", ""),
                    kind=x["kind"],
                    value=int(x["value"]),
                    stage=x.get("stage", "pre_tax"),
                    allocation=x.get("allocation", "proportional"),
                    item_ids=[str(i) for i in x["item_ids"]] if x.get("item_ids") is not None else None,
                    is_coupon=bool(x.get("is_coupon", False)),
                )
                for x in d.get("discounts", [])
            ],
            charges=[
                Charge(
                    id=str(x["id"]),
                    label=x.get("label", ""),
                    type=x.get("type", "other"),
                    kind=x.get("kind", "fixed"),
                    value=int(x["value"]),
                    tax_rate_bp=int(x.get("tax_rate_bp", 0)),
                    tax_scheme=x.get("tax_scheme", "gst"),
                    allocation=x.get("allocation", "proportional"),
                )
                for x in d.get("charges", [])
            ],
            reported_taxes=[
                ReportedTax(x["component"], int(x["rate_bp"]), int(x["amount_minor"]))
                for x in d.get("reported_taxes", [])
            ],
            rounding=Rounding(rounding.get("mode", "none"), int(rounding.get("amount_minor", 0))),
            receipt_total_minor=(
                int(d["receipt_total_minor"]) if d.get("receipt_total_minor") is not None else None
            ),
        )


# ---------------------------------------------------------------- outputs


@dataclass
class Issue:
    code: str
    message: str
    blocking: bool = True
    ref: str | None = None


@dataclass
class ItemShare:
    member_id: str
    gross: int
    item_discount: int
    bill_discount: int
    tax: int  # tax portion of this share (added if exclusive, contained if inclusive)
    total: int  # what this person pays for this item before charges/rounding


@dataclass
class ItemResult:
    id: str
    name: str
    gross: int
    item_discount: int
    net: int
    bill_discount: int
    amount_after_discounts: int
    taxable_base: int
    tax: int
    tax_inclusive: bool
    tax_rate_bp: int
    tax_scheme: str
    total: int
    assigned: bool
    shares: list[ItemShare]


@dataclass
class DiscountResult:
    id: str
    label: str
    stage: str
    kind: str
    value: int
    is_coupon: bool
    amount: int  # positive amount actually deducted
    allocation: str
    allocations: dict[str, int]  # item id (pre_tax) or member id (post_tax) -> amount


@dataclass
class ChargeResult:
    id: str
    label: str
    type: str
    kind: str
    value: int
    amount: int
    tax: int
    total: int
    allocation: str
    allocations: dict[str, int]  # member id -> amount incl. tax


@dataclass
class TaxLine:
    component: str
    component_rate_bp: int
    group_rate_bp: int
    scheme: str
    inclusive: bool
    taxable_base: int
    amount: int
    computed_amount: int
    source: str  # "configured" | "receipt"


@dataclass
class PersonResult:
    member_id: str
    gross: int
    item_discounts: int
    bill_discounts: int
    tax_added: int
    tax_included: int
    charges: int
    post_tax_discounts: int
    rounding: int
    total: int
    items: list[dict[str, Any]]


@dataclass
class BillResult:
    engine_version: int
    currency: str
    item_gross: int
    item_discounts: int
    items_net: int
    pre_tax_discounts: int
    taxable_base: int
    tax_added: int
    tax_included: int
    tax_total: int
    charges: int
    charges_tax: int
    post_tax_discounts: int
    rounding: int
    total: int
    receipt_total: int | None
    receipt_difference: int | None
    allocated_total: int
    unallocated: int
    items: list[ItemResult]
    discounts: list[DiscountResult]
    charge_lines: list[ChargeResult]
    tax_lines: list[TaxLine]
    people: list[PersonResult]
    issues: list[Issue]

    @property
    def can_finalize(self) -> bool:
        return not any(i.blocking for i in self.issues)

    def to_dict(self) -> dict[str, Any]:
        d = asdict(self)
        d["can_finalize"] = self.can_finalize
        return d


# ---------------------------------------------------------------- engine


def _pct(amount: int, bp: int) -> int:
    return div_round_half_up(amount * bp, BP)


class _Ctx:
    def __init__(self) -> None:
        self.issues: list[Issue] = []
        self.currency = "INR"

    def add(self, code: str, message: str, ref: str | None = None, blocking: bool = True) -> None:
        self.issues.append(Issue(code, message, blocking, ref))


def _validate_item(it: Item, ctx: _Ctx) -> None:
    label = it.name or it.id
    if it.quantity_milli <= 0:
        ctx.add("invalid_quantity", f"{label}: quantity must be more than zero.", it.id)
    if it.unit_price_minor < 0:
        ctx.add("invalid_price", f"{label}: price can't be negative.", it.id)
    if not 0 <= it.tax_rate_bp <= BP:
        ctx.add("invalid_tax_rate", f"{label}: tax rate must be between 0% and 100%.", it.id)
    if it.tax_scheme not in TAX_SCHEMES:
        ctx.add("invalid_tax_scheme", f"{label}: unknown tax type '{it.tax_scheme}'.", it.id)
    if it.split_mode not in SPLIT_MODES:
        ctx.add("invalid_split_mode", f"{label}: unknown split '{it.split_mode}'.", it.id)
    ids = [c.member_id for c in it.consumers]
    if len(set(ids)) != len(ids):
        ctx.add("duplicate_consumer", f"{label}: a person is listed twice.", it.id)
    if it.discount:
        if it.discount.kind not in DISCOUNT_KINDS:
            ctx.add("invalid_discount", f"{label}: unknown discount type.", it.id)
        elif it.discount.value < 0:
            ctx.add("invalid_discount", f"{label}: discount can't be negative.", it.id)
        elif it.discount.kind == "percent" and it.discount.value > BP:
            ctx.add("discount_exceeds_amount", f"{label}: discount can't be more than 100%.", it.id)


def _item_weights(it: Item, net: int, ctx: _Ctx) -> list[tuple[str, int]] | None:
    """Return consumer weights, or None if the item has no valid allocation yet."""
    label = it.name or it.id
    if not it.consumers:
        ctx.add("item_unassigned", f"{label} isn't assigned to anyone yet.", it.id)
        return None
    mode = it.split_mode
    if mode == "equal":
        return [(c.member_id, 1) for c in it.consumers]
    if any(c.value < 0 for c in it.consumers):
        ctx.add("invalid_allocation", f"{label}: shares can't be negative.", it.id)
        return None
    total = sum(c.value for c in it.consumers)
    if mode == "shares":
        if any(c.value <= 0 for c in it.consumers):
            ctx.add("invalid_allocation", f"{label}: every share must be more than zero.", it.id)
            return None
    elif mode == "percent":
        if total != BP:
            ctx.add(
                "percent_not_100",
                f"{label}: percentages add up to {total / 100:.2f}%, they must total exactly 100.00%.",
                it.id,
            )
            return None
    elif mode == "exact":
        if total != net:
            ctx.add(
                "exact_mismatch",
                f"{label}: exact amounts add up to {format_minor(total, ctx.currency)} "
                f"but the item is {format_minor(net, ctx.currency)}.",
                it.id,
            )
            return None
    else:
        return None
    if total == 0:
        # A free item (exact amounts of zero): split its zero-sum components equally.
        return [(c.member_id, 1) for c in it.consumers]
    return [(c.member_id, c.value) for c in it.consumers]


def _split(total: int, weights: list[tuple[str, int]]) -> dict[str, int]:
    if sum(w for _, w in weights) == 0:
        return allocate_equal(total, [k for k, _ in weights])
    return allocate(total, weights)


def compute_bill(bill: BillInput) -> BillResult:
    ctx = _Ctx()
    try:
        cur = get_currency(bill.currency)
    except UnknownCurrency:
        ctx.add("unknown_currency", f"Currency {bill.currency} isn't supported.")
        cur = get_currency("INR")
    ctx.currency = cur.code

    if not bill.items:
        ctx.add("no_items", "Add at least one item or amount.")
    item_ids = [it.id for it in bill.items]
    if len(set(item_ids)) != len(item_ids):
        ctx.add("duplicate_item", "Two items share the same id.")

    # 1-2. gross and item discounts
    gross: dict[str, int] = {}
    item_disc: dict[str, int] = {}
    running: dict[str, int] = {}
    for it in bill.items:
        _validate_item(it, ctx)
        g = div_round_half_up(max(it.quantity_milli, 0) * max(it.unit_price_minor, 0), 1000)
        d = 0
        if it.discount and it.discount.kind in DISCOUNT_KINDS and it.discount.value >= 0:
            d = it.discount.value if it.discount.kind == "fixed" else _pct(g, min(it.discount.value, BP))
            if d > g:
                ctx.add(
                    "discount_exceeds_amount",
                    f"{it.name or it.id}: discount is more than the item's price.",
                    it.id,
                )
                d = g
        gross[it.id], item_disc[it.id], running[it.id] = g, d, g - d
    net = dict(running)

    # 3. pre-tax bill discounts
    bill_disc = {it.id: 0 for it in bill.items}
    discount_results: list[DiscountResult] = []
    for disc in bill.discounts:
        if disc.stage not in DISCOUNT_STAGES or disc.kind not in DISCOUNT_KINDS or disc.value < 0:
            ctx.add("invalid_discount", f"{disc.label or 'Discount'}: invalid discount settings.", disc.id)
            continue
        if disc.stage != "pre_tax":
            continue
        eligible = [i for i in bill.items if disc.item_ids is None or i.id in disc.item_ids]
        if disc.item_ids is not None and len(eligible) != len(set(disc.item_ids)):
            ctx.add("invalid_discount", f"{disc.label or 'Discount'}: refers to an item that isn't on the bill.", disc.id)
        base = sum(running[i.id] for i in eligible)
        amount = disc.value if disc.kind == "fixed" else _pct(base, min(disc.value, BP))
        if disc.kind == "percent" and disc.value > BP:
            ctx.add("discount_exceeds_amount", f"{disc.label or 'Discount'}: can't be more than 100%.", disc.id)
        if amount > base:
            ctx.add(
                "discount_exceeds_amount",
                f"{disc.label or 'Discount'} is larger than the amount it applies to.",
                disc.id,
            )
            amount = base
        alloc = allocate(amount, [(i.id, running[i.id]) for i in eligible]) if amount else {}
        for k, v in alloc.items():
            running[k] -= v
            bill_disc[k] += v
        discount_results.append(
            DiscountResult(disc.id, disc.label, disc.stage, disc.kind, disc.value, disc.is_coupon, amount, "proportional", alloc)
        )

    # Group items by tax treatment.
    groups: dict[tuple[int, str, bool], list[str]] = {}
    for it in bill.items:
        if it.tax_rate_bp > 0 and it.tax_scheme in TAX_SCHEMES and it.tax_rate_bp <= BP:
            groups.setdefault((it.tax_rate_bp, it.tax_scheme, it.tax_inclusive), []).append(it.id)

    reported = _reported_by_group(bill.reported_taxes, groups, bill.charges, ctx)

    item_tax = {it.id: 0 for it in bill.items}
    item_base = dict(running)
    tax_lines: list[TaxLine] = []

    # 4a. inclusive groups: tax is already inside the price
    for key in sorted(k for k in groups if k[2]):
        rate, scheme, _ = key
        ids = groups[key]
        amt = sum(running[i] for i in ids)
        computed_base = div_round_half_up(amt * BP, BP + rate)
        computed = _components(scheme, rate, amt - computed_base, None)
        rep = reported.get((rate, scheme, True))
        comps = rep if rep is not None else computed
        tax = sum(a for _, _, a in comps)
        if tax > amt:
            ctx.add("tax_exceeds_amount", "Reported tax is larger than the tax-inclusive amount.", f"{rate}:{scheme}")
            comps, tax = computed, amt - computed_base
        base = amt - tax
        alloc = _split(tax, [(i, running[i]) for i in ids]) if tax else {i: 0 for i in ids}
        for i in ids:
            item_tax[i] = alloc[i]
            item_base[i] = running[i] - alloc[i]
        tax_lines += _tax_lines(comps, computed, rate, scheme, True, base, rep is not None)

    # 5a. charge amounts (on the pre-tax subtotal of items)
    pre_tax_subtotal = sum(item_base.values())
    charge_amount: dict[str, int] = {}
    for ch in bill.charges:
        bad = ch.type not in CHARGE_TYPES or ch.kind not in DISCOUNT_KINDS or ch.allocation not in ALLOCATIONS
        if bad or not 0 <= ch.tax_rate_bp <= BP or ch.tax_scheme not in TAX_SCHEMES:
            ctx.add("invalid_charge", f"{ch.label or 'Charge'}: invalid settings.", ch.id)
            continue
        if ch.value < 0 and not (ch.type == "adjustment" and ch.kind == "fixed"):
            ctx.add("invalid_charge", f"{ch.label or 'Charge'} can't be negative.", ch.id)
            continue
        if ch.kind == "percent" and ch.value > BP:
            ctx.add("invalid_charge", f"{ch.label or 'Charge'} can't be more than 100%.", ch.id)
            continue
        charge_amount[ch.id] = ch.value if ch.kind == "fixed" else _pct(pre_tax_subtotal, ch.value)
        if ch.tax_rate_bp and charge_amount[ch.id] < 0:
            ctx.add("invalid_charge", f"{ch.label or 'Charge'}: a negative adjustment can't carry tax.", ch.id)
    valid_charges = [ch for ch in bill.charges if ch.id in charge_amount]

    # 4b. exclusive groups: items and taxable charges sharing a rate
    charge_tax = {ch.id: 0 for ch in valid_charges}
    ex_keys = {k for k in groups if not k[2]}
    for ch in valid_charges:
        if ch.tax_rate_bp > 0 and charge_amount[ch.id] > 0:
            ex_keys.add((ch.tax_rate_bp, ch.tax_scheme, False))
    for key in sorted(ex_keys):
        rate, scheme, _ = key
        members = [("item:" + i, running[i]) for i in groups.get(key, [])]
        members += [
            ("charge:" + ch.id, charge_amount[ch.id])
            for ch in valid_charges
            if (ch.tax_rate_bp, ch.tax_scheme, False) == key and charge_amount[ch.id] > 0
        ]
        base = sum(w for _, w in members)
        computed = _components(scheme, rate, None, base)
        rep = reported.get(key)
        comps = rep if rep is not None else computed
        tax = sum(a for _, _, a in comps)
        if tax and base == 0:
            ctx.add("tax_without_base", "Tax is reported for items that cost nothing.", f"{rate}:{scheme}")
            continue
        alloc = _split(tax, members) if tax else {k: 0 for k, _ in members}
        for k, v in alloc.items():
            kind, ident = k.split(":", 1)
            if kind == "item":
                item_tax[ident] = v
            else:
                charge_tax[ident] = v
        tax_lines += _tax_lines(comps, computed, rate, scheme, False, base, rep is not None)

    # Per-item results and per-person item shares.
    people: dict[str, dict[str, int]] = {}
    person_items: dict[str, list[dict[str, Any]]] = {}

    def person(mid: str) -> dict[str, int]:
        if mid not in people:
            people[mid] = dict(
                gross=0, item_discounts=0, bill_discounts=0, tax_added=0, tax_included=0,
                charges=0, post_tax_discounts=0, rounding=0,
            )
            person_items[mid] = []
        return people[mid]

    item_results: list[ItemResult] = []
    unallocated = 0
    for it in bill.items:
        weights = _item_weights(it, net[it.id], ctx)
        total_i = running[it.id] + (0 if it.tax_inclusive else item_tax[it.id])
        shares: list[ItemShare] = []
        if weights is None:
            unallocated += total_i
        else:
            sg = _split(gross[it.id], weights)
            sd = _split(item_disc[it.id], weights)
            sb = _split(bill_disc[it.id], weights)
            st = _split(item_tax[it.id], weights)
            for mid, _ in weights:
                p = person(mid)
                share_total = sg[mid] - sd[mid] - sb[mid] + (0 if it.tax_inclusive else st[mid])
                p["gross"] += sg[mid]
                p["item_discounts"] += sd[mid]
                p["bill_discounts"] += sb[mid]
                if it.tax_inclusive:
                    p["tax_included"] += st[mid]
                else:
                    p["tax_added"] += st[mid]
                shares.append(ItemShare(mid, sg[mid], sd[mid], sb[mid], st[mid], share_total))
                person_items[mid].append({"item_id": it.id, "name": it.name, "amount": share_total})
        item_results.append(
            ItemResult(
                id=it.id, name=it.name, gross=gross[it.id], item_discount=item_disc[it.id], net=net[it.id],
                bill_discount=bill_disc[it.id], amount_after_discounts=running[it.id],
                taxable_base=item_base[it.id], tax=item_tax[it.id], tax_inclusive=it.tax_inclusive,
                tax_rate_bp=it.tax_rate_bp, tax_scheme=it.tax_scheme, total=total_i,
                assigned=weights is not None, shares=shares,
            )
        )

    member_ids = sorted(people)

    def running_person_totals() -> dict[str, int]:
        return {
            m: p["gross"] - p["item_discounts"] - p["bill_discounts"] + p["tax_added"] + p["charges"]
            - p["post_tax_discounts"] + p["rounding"]
            for m, p in people.items()
        }

    def spread(amount: int, mode: str, weights: dict[str, int]) -> dict[str, int] | None:
        if not member_ids:
            return None
        if mode == "equal" or not any(weights.get(m, 0) > 0 for m in member_ids):
            return allocate_equal(amount, member_ids)
        return allocate(amount, [(m, max(weights.get(m, 0), 0)) for m in member_ids])

    # 5b. charges to people
    pre_charge_weights = {m: p["gross"] - p["item_discounts"] - p["bill_discounts"] for m, p in people.items()}
    charge_results: list[ChargeResult] = []
    for ch in valid_charges:
        amount, tax = charge_amount[ch.id], charge_tax[ch.id]
        alloc = spread(amount + tax, ch.allocation, pre_charge_weights)
        if alloc is None:
            unallocated += amount + tax
            alloc = {}
        for m, v in alloc.items():
            people[m]["charges"] += v
        charge_results.append(
            ChargeResult(ch.id, ch.label, ch.type, ch.kind, ch.value, amount, tax, amount + tax, ch.allocation, alloc)
        )

    items_after = sum(running.values())
    tax_added = sum(item_tax[it.id] for it in bill.items if not it.tax_inclusive)
    tax_included = sum(item_tax[it.id] for it in bill.items if it.tax_inclusive)
    charges_total = sum(c.amount for c in charge_results)
    charges_tax = sum(c.tax for c in charge_results)
    subtotal = items_after + tax_added + charges_total + charges_tax

    # 6. post-tax discounts
    post_total = 0
    for disc in bill.discounts:
        if disc.stage != "post_tax" or disc.kind not in DISCOUNT_KINDS or disc.value < 0:
            continue
        if disc.allocation not in ALLOCATIONS:
            ctx.add("invalid_discount", f"{disc.label or 'Discount'}: unknown allocation.", disc.id)
            continue
        base = subtotal - post_total
        amount = disc.value if disc.kind == "fixed" else _pct(base, min(disc.value, BP))
        if amount > base:
            ctx.add("discount_exceeds_amount", f"{disc.label or 'Discount'} is larger than the bill.", disc.id)
            amount = max(base, 0)
        alloc = spread(amount, disc.allocation, running_person_totals())
        if alloc is None:
            unallocated -= amount
            alloc = {}
        for m, v in alloc.items():
            people[m]["post_tax_discounts"] += v
        post_total += amount
        discount_results.append(
            DiscountResult(disc.id, disc.label, disc.stage, disc.kind, disc.value, disc.is_coupon, amount, disc.allocation, alloc)
        )

    # 7. rounding
    before_rounding = subtotal - post_total
    rounding = 0
    if bill.rounding.mode not in ROUNDING_MODES:
        ctx.add("invalid_rounding", "Unknown rounding rule.")
    elif bill.rounding.mode == "explicit":
        rounding = bill.rounding.amount_minor
        if abs(rounding) >= cur.factor and cur.factor > 1:
            ctx.add(
                "large_rounding",
                "The rounding adjustment is a whole unit or more; check it against the receipt.",
                blocking=False,
            )
    elif bill.rounding.mode == "nearest_unit":
        rounding = div_round_half_up(before_rounding, cur.factor) * cur.factor - before_rounding
    if rounding:
        alloc = spread(rounding, "proportional", running_person_totals())
        if alloc is None:
            unallocated += rounding
        else:
            for m, v in alloc.items():
                people[m]["rounding"] += v

    total = before_rounding + rounding
    if total < 0:
        ctx.add("negative_total", "Discounts make the bill negative.")

    receipt_diff = None
    if bill.receipt_total_minor is not None:
        receipt_diff = total - bill.receipt_total_minor
        if receipt_diff:
            ctx.add(
                "receipt_total_mismatch",
                "The calculated total doesn't match the receipt. Fix the items, or add a labelled adjustment.",
            )

    person_results = []
    for m in member_ids:
        p = people[m]
        t = running_person_totals()[m]
        person_results.append(PersonResult(member_id=m, total=t, items=person_items[m], **p))
    allocated = sum(p.total for p in person_results)
    if allocated + unallocated != total:  # pragma: no cover - conservation invariant
        raise AssertionError("allocation does not conserve the bill total")

    return BillResult(
        engine_version=ENGINE_VERSION,
        currency=cur.code,
        item_gross=sum(gross.values()),
        item_discounts=sum(item_disc.values()),
        items_net=sum(net.values()),
        pre_tax_discounts=sum(bill_disc.values()),
        taxable_base=sum(item_base.values()) + sum(charge_amount[c.id] for c in valid_charges if c.tax_rate_bp),
        tax_added=tax_added,
        tax_included=tax_included,
        tax_total=tax_added + tax_included + charges_tax,
        charges=charges_total,
        charges_tax=charges_tax,
        post_tax_discounts=post_total,
        rounding=rounding,
        total=total,
        receipt_total=bill.receipt_total_minor,
        receipt_difference=receipt_diff,
        allocated_total=allocated,
        unallocated=unallocated,
        items=item_results,
        discounts=discount_results,
        charge_lines=charge_results,
        tax_lines=tax_lines,
        people=person_results,
        issues=ctx.issues,
    )


# ---------------------------------------------------------------- tax helpers


def _components(scheme: str, rate: int, inclusive_tax: int | None, exclusive_base: int | None) -> list[tuple[str, int, int]]:
    """Return [(component, component_rate_bp, amount)] for a tax group."""
    if inclusive_tax is not None:
        if scheme == "cgst_sgst":
            sgst = inclusive_tax // 2
            # The odd minor unit, if any, goes to CGST.
            return [("CGST", rate // 2, inclusive_tax - sgst), ("SGST", rate - rate // 2, sgst)]
        return [("IGST" if scheme == "igst" else "GST", rate, inclusive_tax)]
    assert exclusive_base is not None
    if scheme == "cgst_sgst":
        half_c = div_round_half_up(exclusive_base * (rate // 2), BP)
        half_s = div_round_half_up(exclusive_base * (rate - rate // 2), BP)
        return [("CGST", rate // 2, half_c), ("SGST", rate - rate // 2, half_s)]
    return [("IGST" if scheme == "igst" else "GST", rate, _pct(exclusive_base, rate))]


def _tax_lines(comps, computed, rate, scheme, inclusive, base, from_receipt) -> list[TaxLine]:
    comp_map = {c: a for c, _, a in computed}
    return [
        TaxLine(c, r, rate, scheme, inclusive, base, a, comp_map.get(c, 0), "receipt" if from_receipt else "configured")
        for c, r, a in comps
    ]


def _reported_by_group(
    reported: list[ReportedTax],
    groups: dict[tuple[int, str, bool], list[str]],
    charges: list[Charge],
    ctx: _Ctx,
) -> dict[tuple[int, str, bool], list[tuple[str, int, int]]]:
    """Match receipt tax lines to tax groups. Ambiguity is reported, never guessed."""
    keys = set(groups)
    for ch in charges:
        if ch.tax_rate_bp > 0:
            keys.add((ch.tax_rate_bp, ch.tax_scheme, False))
    wanted: dict[tuple[int, str], list[tuple[str, int, int]]] = {}
    for r in reported:
        if r.component not in TAX_COMPONENTS or r.amount_minor < 0 or r.rate_bp <= 0:
            ctx.add("invalid_reported_tax", f"Receipt tax line {r.component} {r.rate_bp / 100:.2f}% is invalid.")
            continue
        if r.component in ("CGST", "SGST"):
            gk = (r.rate_bp * 2, "cgst_sgst")
        elif r.component == "IGST":
            gk = (r.rate_bp, "igst")
        else:
            gk = (r.rate_bp, "gst")
        wanted.setdefault(gk, []).append((r.component, r.rate_bp, r.amount_minor))

    out: dict[tuple[int, str, bool], list[tuple[str, int, int]]] = {}
    for (rate, scheme), comps in wanted.items():
        matches = [k for k in keys if k[0] == rate and k[1] == scheme]
        label = f"{scheme.upper().replace('_', '+')} {rate / 100:.2f}%"
        if not matches:
            ctx.add("reported_tax_unmatched", f"The receipt shows {label} but no item uses that rate. Set the item tax rates.")
            continue
        if len(matches) > 1:
            ctx.add(
                "reported_tax_ambiguous",
                f"{label} applies to both tax-inclusive and tax-exclusive items; enter it per item instead.",
            )
            continue
        names = sorted(c for c, _, _ in comps)
        expected = ["CGST", "SGST"] if scheme == "cgst_sgst" else ["IGST" if scheme == "igst" else "GST"]
        if names != expected:
            ctx.add("reported_tax_incomplete", f"{label}: enter each tax line exactly once ({' and '.join(expected)}).")
            continue
        out[matches[0]] = sorted(comps)
    return out
