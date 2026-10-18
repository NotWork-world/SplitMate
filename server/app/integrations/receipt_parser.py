"""Turn OCR text lines into a structured, reviewable receipt.

The OCR itself is replaceable (``OcrLine`` is all a provider must produce):
today the Android app runs ML Kit on the phone and sends recognised lines with
their positions. This parser never invents values: anything it can't read is
left out, every extracted field keeps the text it came from, and uncertain
items get a low confidence so the review screen highlights them.
"""

from __future__ import annotations

import re
from dataclasses import asdict, dataclass, field
from datetime import date

from ..money.currency import get_currency


@dataclass
class OcrLine:
    text: str
    left: float = 0
    top: float = 0
    width: float = 0
    height: float = 0


@dataclass
class ParsedItem:
    name: str
    quantity_milli: int
    unit_price_minor: int
    amount_minor: int
    confidence: int  # 0-100
    source: str


@dataclass
class ParsedTax:
    component: str  # GST | CGST | SGST | IGST
    rate_bp: int | None
    amount_minor: int
    source: str


@dataclass
class ParsedAmount:
    label: str
    amount_minor: int
    source: str
    rate_bp: int | None = None


@dataclass
class ParsedReceipt:
    merchant: str | None = None
    date: str | None = None
    currency: str = "INR"
    items: list[ParsedItem] = field(default_factory=list)
    taxes: list[ParsedTax] = field(default_factory=list)
    charges: list[ParsedAmount] = field(default_factory=list)
    discounts: list[ParsedAmount] = field(default_factory=list)
    subtotal_minor: int | None = None
    round_off_minor: int | None = None
    total_minor: int | None = None
    warnings: list[str] = field(default_factory=list)
    unparsed_lines: list[str] = field(default_factory=list)

    def to_dict(self) -> dict:
        return asdict(self)


# ------------------------------------------------------------------ helpers

_AMOUNT = r"[-−]?(?:₹|rs\.?|inr)?\s*\d{1,3}(?:[,\s]\d{2,3})*(?:\.\d{1,2})|[-−]?(?:₹|rs\.?|inr)?\s*\d+(?:\.\d{1,2})?"
AMOUNT_RE = re.compile(rf"({_AMOUNT})\s*$", re.I)
PCT_RE = re.compile(r"(\d{1,2}(?:\.\d{1,2})?)\s*%")
DATE_RES = [
    (re.compile(r"\b(\d{1,2})[/\-.](\d{1,2})[/\-.](\d{4})\b"), "dmy"),
    (re.compile(r"\b(\d{4})[/\-.](\d{1,2})[/\-.](\d{1,2})\b"), "ymd"),
    (re.compile(r"\b(\d{1,2})[/\-.](\d{1,2})[/\-.](\d{2})\b"), "dmy2"),
]
TOTAL_WORDS = re.compile(r"\b(grand\s*total|net\s*(amount|payable|total)|total\s*(amount|payable|due)|amount\s*payable|bill\s*amount|total)\b", re.I)
SUBTOTAL_WORDS = re.compile(r"\b(sub\s*-?\s*total|item\s*total|gross\s*(amount|total))\b", re.I)
SKIP_WORDS = re.compile(
    r"\b(gstin|fssai|invoice|bill\s*no|table|cashier|server|steward|phone|ph\.?|tel|mobile|thank|visit|cover|pax|kot|order\s*no|hsn|sac|cin|pan)\b",
    re.I,
)
TAX_RE = re.compile(r"\b(cgst|sgst|utgst|igst|gst|vat)\b", re.I)
CHARGE_WORDS = {
    "service": re.compile(r"service\s*(charge|chg|tax)?", re.I),
    "packaging": re.compile(r"pack(ag)?ing|packing|container", re.I),
    "delivery": re.compile(r"delivery", re.I),
    "tip": re.compile(r"\btip\b|gratuity", re.I),
}
DISCOUNT_WORDS = re.compile(r"\b(discount|disc\.?|offer|promo|coupon|less)\b", re.I)
ROUND_WORDS = re.compile(r"round\s*(off|ing)?|r\.?\s*off", re.I)


def to_minor(text: str, exponent: int) -> int | None:
    t = text.lower().replace("₹", "").replace("rs.", "").replace("rs", "").replace("inr", "").replace("−", "-")
    t = t.replace(" ", "").replace(",", "")
    neg = t.startswith("-")
    t = t.lstrip("-")
    m = re.fullmatch(r"(\d+)(?:\.(\d{1,3}))?", t)
    if not m:
        return None
    whole, frac = m.group(1), (m.group(2) or "")
    if len(frac) > exponent:
        return None
    value = int(whole) * 10**exponent + (int(frac.ljust(exponent, "0")) if exponent else 0)
    return -value if neg else value


def _pct_bp(text: str) -> int | None:
    m = PCT_RE.search(text)
    if not m:
        return None
    whole, _, frac = m.group(1).partition(".")
    return int(whole) * 100 + int((frac + "00")[:2])


def rows_from_lines(lines: list[OcrLine]) -> list[str]:
    """Join text fragments that sit on the same printed row (ML Kit often splits columns)."""
    if not lines:
        return []
    if all(line.height == 0 for line in lines):
        return [line.text.strip() for line in lines if line.text.strip()]
    ordered = sorted(lines, key=lambda line: (line.top + line.height / 2, line.left))
    rows: list[list[OcrLine]] = []
    for line in ordered:
        cy = line.top + line.height / 2
        if rows:
            last = rows[-1]
            ref = sum(item.top + item.height / 2 for item in last) / len(last)
            tol = max(6.0, min(item.height for item in last) * 0.55)
            if abs(cy - ref) <= tol:
                last.append(line)
                continue
        rows.append([line])
    return ["  ".join(p.text.strip() for p in sorted(r, key=lambda x: x.left)).strip() for r in rows]


def _parse_date(text: str) -> str | None:
    for rx, kind in DATE_RES:
        m = rx.search(text)
        if not m:
            continue
        try:
            if kind == "ymd":
                y, mo, d = int(m.group(1)), int(m.group(2)), int(m.group(3))
            else:
                d, mo, y = int(m.group(1)), int(m.group(2)), int(m.group(3))
                if kind == "dmy2":
                    y += 2000
            return date(y, mo, d).isoformat()
        except ValueError:
            continue
    return None


# ------------------------------------------------------------------ parser


def parse_receipt(lines: list[OcrLine], currency: str = "INR") -> ParsedReceipt:
    cur = get_currency(currency)
    exp = cur.exponent
    rows = rows_from_lines(lines)
    out = ParsedReceipt(currency=cur.code)
    seen_total = False

    for idx, row in enumerate(rows):
        low = row.lower()
        row_date = _parse_date(row)
        if row_date or re.search(r"\b\d{1,2}:\d{2}\b", row):
            # Date/time rows carry no money; never let "21:40" become a price.
            out.date = out.date or row_date
            out.unparsed_lines.append(row)
            continue
        if out.merchant is None and idx < 4 and re.search(r"[a-zA-Z]{3,}", row) and not re.search(r"\d{3,}", row) and not SKIP_WORDS.search(row):
            out.merchant = row.strip()[:80]
            continue

        m = AMOUNT_RE.search(row)
        amount = to_minor(m.group(1), exp) if m else None
        label = row[: m.start()].strip(" :.-") if m else row

        if amount is None:
            if row.strip():
                out.unparsed_lines.append(row)
            continue

        if TAX_RE.search(low) and not TOTAL_WORDS.search(low.replace("gst", "")):
            comp = TAX_RE.search(low).group(1).upper()
            comp = {"UTGST": "SGST", "VAT": "GST"}.get(comp, comp)
            # "CGST @ 2.5% on 600.00   15.00": the last number is the tax amount.
            out.taxes.append(ParsedTax(comp, _pct_bp(row), abs(amount), row))
            continue
        if ROUND_WORDS.search(low):
            out.round_off_minor = amount
            continue
        if SUBTOTAL_WORDS.search(low):
            out.subtotal_minor = amount
            continue
        if TOTAL_WORDS.search(low):
            # Prefer the largest/last "total"-like line (grand total comes after total).
            if out.total_minor is None or amount >= out.total_minor or "grand" in low or "payable" in low:
                out.total_minor = amount
            seen_total = True
            continue
        if DISCOUNT_WORDS.search(low):
            out.discounts.append(ParsedAmount(label or "Discount", abs(amount), row, _pct_bp(row)))
            continue
        charge = next((k for k, rx in CHARGE_WORDS.items() if rx.search(low)), None)
        if charge:
            out.charges.append(ParsedAmount(charge, amount, row, _pct_bp(row)))
            continue
        if seen_total or SKIP_WORDS.search(low) or not re.search(r"[a-zA-Z]{2,}", label):
            out.unparsed_lines.append(row)
            continue

        out.items.append(_item_from_row(label, amount, row, exp))

    _check(out)
    return out


def _item_from_row(label: str, amount: int, row: str, exp: int) -> ParsedItem:
    """name [qty] [rate] amount: trust quantity and rate only when they agree with the amount."""
    name = re.sub(r"(?:\s+[x×]?\s*\d[\d,]*(?:\.\d{1,2})?)+\s*$", "", label).strip(" :.-x×") or label
    nums = re.findall(r"\d[\d,]*(?:\.\d{1,2})?", label[len(name):])
    qty_milli, unit, confidence = 1000, amount, 70

    def small_int(t: str) -> int | None:
        return int(t) if t.isdigit() and 0 < int(t) <= 99 else None

    if len(nums) >= 2:
        q, rate = small_int(nums[-2]), to_minor(nums[-1], exp)
        if q and rate is not None and rate * q == amount:
            qty_milli, unit, confidence = q * 1000, rate, 95
        else:
            confidence = 50  # numbers present but they don't multiply out: needs a look
    elif len(nums) == 1:
        q = small_int(nums[0])
        rate = to_minor(nums[0], exp)
        if q and q > 1 and amount % q == 0:
            qty_milli, unit, confidence = q * 1000, amount // q, 75
        elif rate == amount:
            confidence = 90  # "Lassi  80.00  80.00": rate equals amount, quantity 1
    if not re.search(r"[a-zA-Z]{3,}", name):
        confidence = min(confidence, 40)
    return ParsedItem(name=name[:120], quantity_milli=qty_milli, unit_price_minor=unit, amount_minor=amount, confidence=confidence, source=row)

def _check(out: ParsedReceipt) -> None:
    items_total = sum(i.amount_minor for i in out.items)
    if not out.items:
        out.warnings.append("No items could be read. Add them by hand.")
    if out.subtotal_minor is not None and items_total != out.subtotal_minor:
        out.warnings.append("The items read don't add up to the receipt's subtotal. Check for missing or misread lines.")
    if out.total_minor is None:
        out.warnings.append("The receipt total wasn't found. Enter it to let SplitMate check the bill.")
    comps = {t.component for t in out.taxes}
    if ("CGST" in comps) != ("SGST" in comps):
        out.warnings.append("Only one of CGST/SGST was read. Check the tax lines.")
    if any(t.rate_bp is None for t in out.taxes):
        out.warnings.append("A tax line has no rate printed; set the item tax rates yourself.")
    if any(i.confidence < 70 for i in out.items):
        out.warnings.append("Some lines were hard to read and are marked for checking.")
