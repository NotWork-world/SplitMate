"""Turn OCR text lines into a structured, reviewable receipt.

The OCR itself is replaceable (``OcrLine`` is all a provider must produce):
today the Android app runs UniOCR on the phone and sends recognised lines with
their positions. This parser never invents values: anything it can't read is
left out, every extracted field keeps the text it came from, and uncertain
items get a low confidence so the review screen highlights them.
"""

from __future__ import annotations

import re
import statistics
from dataclasses import asdict, dataclass, field
from datetime import date

from ..money.currency import get_currency

# Parser upgrades are exercised by tests/test_receipts.py and the smoke bill in mobile/scripts.


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
    category: str | None = None  # a guess the app can preselect: food | transport | ...
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

_AMOUNT = r"(?<![\d.,])[-−]?(?:₹|rs\.?|inr)?\s*\d{1,3}(?:[,\s]\d{2,3})*(?:\.\d{1,2})|(?<![\d.,])[-−]?(?:₹|rs\.?|inr)?\s*\d+(?:\.\d{1,2})?"
AMOUNT_RE = re.compile(rf"({_AMOUNT})\s*$", re.I)
PCT_RE = re.compile(r"(\d{1,2}(?:\.\d{1,2})?)\s*%")
DATE_RES = [
    (re.compile(r"\b(\d{1,2})[/\-.](\d{1,2})[/\-.](\d{4})\b"), "dmy"),
    (re.compile(r"\b(\d{4})[/\-.](\d{1,2})[/\-.](\d{1,2})\b"), "ymd"),
    (re.compile(r"\b(\d{1,2})[/\-.](\d{1,2})[/\-.](\d{2})\b"), "dmy2"),
]
TOTAL_WORDS = re.compile(
    r"\b(grand\s*total|net\s*(amount|payable|total)|total\s*(amount|payable|due)|amount\s*payable|payable\s*(amount|amt)|bill\s*amount|total)\b",
    re.I,
)
SUBTOTAL_WORDS = re.compile(r"\b(sub\s*-?\s*total|item\s*total|gross\s*(amount|total))\b|^\s*(total\s*)?items?\s*:", re.I)
SKIP_WORDS = re.compile(
    r"\b(gstin|fssai|invoice|bill\s*(no|#)|table|cashier|server|steward|user|phone|ph\.?|tel|mob|mobile|thank|visit|cover|pax|kot|order\s*no|hsn|sac|cin|pan|qty|token\s*(?:no\.?|num\.?|#))\b|^\W*bill\s*:|^\s*items?\b",
    re.I,
)
# "C GST", "S GST" (OCR splits the letter off) are CGST and SGST.
TAX_RE = re.compile(r"\b(c\s?gst|s\s?gst|ut\s?gst|i\s?gst|gst|vat)\b", re.I)
# Printed quantity units after the quantity column ("PANEER DOSA  4  POR  680.00").
UNIT_WORDS = re.compile(r"(?:\s+(?:por|pors|pcs|pc|nos|no|plt|plate|btl|bottle|kg|kgs|gm|gms|ml|ltr|unit|units|each|ea|gls|glass|glasses))\.?\s*$", re.I)
# GST rates in use (and their CGST/SGST halves), to read "2.58" where OCR took % for an 8.
GST_RATES_BP = {10, 25, 50, 75, 125, 150, 250, 300, 500, 600, 900, 1200, 1400, 1800, 2800}
GENERIC_MERCHANT = re.compile(r"^\W*(restaurant|hotel|cafe|dhaba|bar|tax\s*invoice|invoice|bill|receipt|estimate|welcome)\W*$", re.I)
CHARGE_WORDS = {
    "service": re.compile(r"service\s*(charge|chg|tax)?", re.I),
    "packaging": re.compile(r"pack(ag)?ing|packing|container", re.I),
    "delivery": re.compile(r"delivery", re.I),
    "tip": re.compile(r"\btip\b|gratuity", re.I),
}
DISCOUNT_WORDS = re.compile(r"\b(discount|disc\.?|offer|promo|coupon|less)\b", re.I)
ROUND_WORDS = re.compile(r"round\s*(off|ing)?|r\.?\s*off", re.I)
# Any bill, not just food: rides, fuel, utilities, tickets…  Used to name the single
# item a non-itemised bill becomes, and to suggest the app's category chip.
RIDE_WORDS = re.compile(r"\b(auto\s*-?\s*rickshaw|rickshaw|auto|taxi|cab|uber|ola|rapido|rapido\s*bike|fare|trip|ride|journey|driver|drop|pickup)\b", re.I)
CATEGORY_WORDS = [
    ("transport", re.compile(r"\b(uber|ola|rapido|auto\s*-?\s*rickshaw|rickshaw|taxi|cab|metro|railway|train\s*ticket|bus\s*ticket|flight|air\s*india|indigo|irctc)\b", re.I)),
    ("fuel", re.compile(r"\b(petrol|diesel|cng|fuel|hp\s*petrol|bharat\s*petroleum|indian\s*oil|shell)\b", re.I)),
    ("groceries", re.compile(r"\b(super\s*market|supermarket|kirana|grocery|vegetables|big\s*bazaar|dmart|reliance\s*fresh)\b", re.I)),
    ("utilities", re.compile(r"\b(electricity|electric|bescom|mseb|water\s*bill|broadband|airtel|jio\s*fiber|mobile\s*recharge|recharge|electricity\s*bill)\b", re.I)),
    ("entertainment", re.compile(r"\b(cinema|pvr|inox|movie|theatre|netflix|spotify|hotstar)\b", re.I)),
    ("tickets", re.compile(r"\b(ticket|booking|entry\s*fee|pass)\b", re.I)),
    ("health", re.compile(r"\b(hospital|clinic|pharmacy|medical|chemist|doctor)\b", re.I)),
    ("food", re.compile(r"\b(restaurant|hotel|cafe|dhaba|mess|kitchen|biryani|dosa|paneer|roti|naan|pizza|burger|thali|idli|chai|coffee|momos|chicken|veg|sagar)\b", re.I)),
]
# Handwriting: amounts written with letter shapes the reader turned into letters.
DIGIT_FIX = str.maketrans("Oo|lISBZD", "001115820")


def to_minor(text: str, exponent: int) -> int | None:
    t = text.lower().replace("₹", "").replace("rs.", "").replace("rs", "").replace("inr", "").replace("−", "-")
    t = t.translate(DIGIT_FIX)
    t = t.replace(" ", "").replace(",", "")
    t = re.sub(r"\.{2,}", ".", t)  # "983..50" is 983.50
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
    """Join text fragments that sit on the same printed row (the reader splits columns).

    A photo is rarely perfectly level, so printed rows tilt and the amount
    column slips out of its item's row. First estimate the page skew from the
    box centres (same-row pairs far apart horizontally share one slope, noise
    pairs scatter), then group by the de-skewed centre line."""
    if not lines:
        return []
    if all(line.height == 0 for line in lines):
        return [line.text.strip() for line in lines if line.text.strip()]
    centers = [(line.left + line.width / 2, line.top + line.height / 2, line.height) for line in lines]
    heights = sorted(c[2] for c in centers)
    med_h = heights[len(heights) // 2]
    min_dx = max(40.0, 2.5 * med_h)
    bins: dict[float, list[float]] = {}
    for i in range(len(centers)):
        for j in range(i + 1, len(centers)):
            dx = centers[j][0] - centers[i][0]
            if abs(dx) < min_dx:
                continue
            s = (centers[j][1] - centers[i][1]) / dx
            if abs(s) > 0.35:
                continue  # a sideways photo is EXIF's job, not ours
            bins.setdefault(round(s * 50) / 50, []).append(s)
    best = max(bins.values(), key=len) if bins else []
    slope = statistics.median(best) if len(best) >= 5 else 0.0
    ordered = sorted(
        ((line, cy - slope * cx, cx) for line, (cx, cy, _) in zip(lines, centers)),
        key=lambda t: t[1],
    )
    rows: list[list[tuple[OcrLine, float, float]]] = []
    for line, y, cx in ordered:
        if rows:
            last = rows[-1]
            ref = sum(v[1] for v in last) / len(last)
            row_h = sorted(v[0].height for v in last)[len(last) // 2]
            tol = max(6.0, min(line.height, row_h) * 0.6)
            if abs(y - ref) <= tol:
                last.append((line, y, cx))
                continue
        rows.append([(line, y, cx)])
    return ["  ".join(p[0].text.strip() for p in sorted(r, key=lambda x: x[2])).strip() for r in rows]

def _tax_rate_bp(label: str) -> int | None:
    """Rate on a tax line; also reads "2.58" / "98" as 2.5% / 9% when OCR took the % sign for an 8."""
    bp = _pct_bp(label)
    if bp is not None:
        return bp
    for num in re.findall(r"(?<![\d.])(\d{1,2}(?:\.\d{1,2})?)(?![\d.])", label):
        if num.endswith("8") and len(num) > 1:
            core = num[:-1].rstrip(".")
            whole, _, frac = core.partition(".")
            if whole:
                cand = int(whole) * 100 + int((frac + "00")[:2])
                if cand in GST_RATES_BP:
                    return cand
    return None


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
    # Glare doubles a decimal point ("983..50"): collapse before any amount is read.
    rows = [re.sub(r"\.{2,}", ".", r) for r in rows]
    out = ParsedReceipt(currency=cur.code)
    seen_total = False
    prev_was_item = False  # a words-only row right after an item continues its name
    pending_total = False  # "Payable Amt." printed above its amount
    tax_total: tuple[int, int | None, str] | None = None  # "Total GST(5%) 70.72"

    # When the receipt prints paise ("680.00"), a price without them is a bill/table/phone number.
    amounts = [m.group(1) for r in rows if (m := AMOUNT_RE.search(r))]
    decimals = sum(1 for a in amounts if "." in a)
    need_decimal = exp > 0 and decimals >= 3 and decimals >= 0.6 * len(amounts)

    for idx, row in enumerate(rows):
        low = row.lower()
        row_date = _parse_date(row)
        if row_date or re.search(r"\b\d{1,2}:\d{2}\b", row):
            # Date/time rows carry no money; never let "21:40" become a price.
            out.date = out.date or row_date
            out.unparsed_lines.append(row)
            prev_was_item = False
            continue
        if (
            out.merchant is None and idx < 4 and re.search(r"[a-zA-Z]{3,}", row)
            and not re.search(r"\d{3,}|\d\.\d", row) and not SKIP_WORDS.search(row) and not TAX_RE.search(row)
            and not GENERIC_MERCHANT.match(row) and not AMOUNT_RE.search(row)
        ):
            out.merchant = row.strip()[:80]
            continue

        m = AMOUNT_RE.search(row)
        amt_text = m.group(1) if m else None
        if amt_text is not None and "." not in amt_text:
            # Handwriting: letter-shaped digits ("Samosa 1O0" = 100) cut the match short,
            # leaving a lonely trailing "0" as the price. Take the whole mixed token.
            tail = re.search(r"[\dOoIlSBZD]{2,}$", row[: m.end()])
            if tail and not tail.group(0).isdigit() and any(ch.isdigit() for ch in tail.group(0)):
                amt_text = tail.group(0)
        amount = to_minor(amt_text, exp) if amt_text is not None else None
        label = row[: m.end() - len(amt_text)].strip(" :.-=") if amt_text is not None else row
        # OCR splits words ("NET T OTAL", "DisCOunt"): match keywords on the label without spaces too.
        squashed = re.sub(r"\s+", "", label.lower())

        if amount is None:
            if TOTAL_WORDS.search(low) or TOTAL_WORDS.search(squashed):
                pending_total = True
            elif prev_was_item and out.items and _is_name_part(row):
                out.items[-1].name = f"{out.items[-1].name} {row.strip()}"[:120]
                continue
            if row.strip():
                out.unparsed_lines.append(row)
            if not SKIP_WORDS.search(low):  # an HSN code line doesn't end the dish
                prev_was_item = False
            continue
        prev_was_item = False

        if pending_total and not re.search(r"[a-zA-Z]", label):
            out.total_minor = _final_total(amt_text, amount, out.total_minor, exp, prefer=True)
            pending_total = False
            seen_total = True
            continue
        pending_total = False

        tax = TAX_RE.search(low)
        if tax and "total" in squashed:
            if abs(amount) > 0:
                tax_total = (abs(amount), _tax_rate_bp(label), row)  # used only if no CGST/SGST lines follow
            continue
        if tax:
            comp = re.sub(r"\s", "", tax.group(1)).upper()
            comp = {"UTGST": "SGST", "VAT": "GST"}.get(comp, comp)
            if abs(amount) > 0:
                # "CGST @ 2.5% on 600.00   15.00": the last number is the tax amount.
                out.taxes.append(ParsedTax(comp, _tax_rate_bp(label), abs(amount), row))
            continue
        if ROUND_WORDS.search(low):
            if abs(amount) <= 5 * 10**exp:
                out.round_off_minor = amount
                continue
            if "total" in squashed:
                # "ROUND OFF  TOTAL 798.00": rupees-hundreds of "rounding" is a
                # misread - the number is far more likely the total itself.
                out.total_minor = _final_total(amt_text, amount, out.total_minor, exp, prefer=True)
                seen_total = True
                continue
            out.unparsed_lines.append(row)  # keep it visible, poison nothing
            continue
        if SUBTOTAL_WORDS.search(low) or SUBTOTAL_WORDS.search(squashed):
            out.subtotal_minor = amount
            continue
        if "after" in squashed:
            continue  # "After Discount 1417.20": the taxable value, not money of its own
        if TOTAL_WORDS.search(low) or TOTAL_WORDS.search(squashed):
            out.total_minor = _final_total(amt_text, amount, out.total_minor, exp, prefer="grand" in low or "payable" in low)
            seen_total = True
            continue
        if DISCOUNT_WORDS.search(low) or "discount" in squashed:
            out.discounts.append(ParsedAmount(label or "Discount", abs(amount), row, _pct_bp(row)))
            continue
        charge = next((k for k, rx in CHARGE_WORDS.items() if rx.search(low)), None)
        if charge:
            out.charges.append(ParsedAmount(charge, amount, row, _pct_bp(row)))
            continue
        if (
            seen_total
            or SKIP_WORDS.search(low)
            or not re.search(r"[a-zA-Z]{2,}", label)
            or (need_decimal and amt_text is not None and "." not in amt_text)
            or re.search(r"\d{7,}", row.replace(" ", ""))  # phone and bill numbers
        ):
            out.unparsed_lines.append(row)
            continue

        out.items.append(_item_from_row(label, amount, row, exp))
        prev_was_item = True

    # A bill that isn't itemised (auto ride, Uber screenshot, one-line ticket) still has
    # to become something splittable: one item for the whole bill, named from context.
    if not out.items:
        name = None
        for r in out.unparsed_lines:
            m = RIDE_WORDS.search(r)
            if m:
                word = re.sub(r"\s+", " ", m.group(1).strip().lower())
                name = {
                    "uber": "Uber ride",
                    "ola": "Ola ride",
                    "rapido": "Rapido ride",
                    "auto": "Auto ride",
                    "auto rickshaw": "Auto ride",
                    "rickshaw": "Auto ride",
                    "taxi": "Taxi fare",
                    "cab": "Cab fare",
                }.get(word)
                break
        single = out.total_minor
        if single is None:
            # No "Total" printed: if exactly one amount was seen anywhere, that's the bill.
            money = []
            for r in rows:
                m = AMOUNT_RE.search(r)
                if not m:
                    continue
                v = to_minor(m.group(1), exp)
                if v is None:
                    continue
                if m.start() > 0 and r[m.start() - 1].isalnum():
                    continue  # glued to a code like "E0013": not money
                money.append(abs(v))
            if len(set(money)) == 1:
                single = money[0]
                out.total_minor = single
        if single:
            out.items.append(
                ParsedItem(name=name or "The whole bill", quantity_milli=1000, unit_price_minor=single,
                           amount_minor=single, confidence=60, source="whole bill")
            )
    # Repair OCR spelling in item names ("TAWA FANEER MASALA" -> "Tawa Paneer
    # Masala"); numbers are never touched, and the raw line stays in source.
    # Names SplitMate itself made up ("The whole bill", "Uber ride") are fine.
    for item in out.items:
        if item.source != "whole bill":
            item.name = repair_item_name(item.name)

    # Suggest the app's category chip from whatever words the bill shows.
    if out.category is None:
        haystack = " ".join(filter(None, [out.merchant, *out.unparsed_lines, *(i.name for i in out.items)]))
        for cat, rx in CATEGORY_WORDS:
            if rx.search(haystack):
                out.category = cat
                break

    if tax_total and not out.taxes:
        out.taxes.append(ParsedTax("GST", tax_total[1], tax_total[0], tax_total[2]))
    gst_pair = [t for t in out.taxes if t.component == "GST"]
    if (
        len(gst_pair) == 2
        and gst_pair[0].amount_minor == gst_pair[1].amount_minor
        and gst_pair[0].rate_bp == gst_pair[1].rate_bp
    ):
        # "C GST" / "S GST" with the C or S lost to OCR: two identical GST
        # lines at the same rate are the CGST/SGST pair on an Indian bill.
        gst_pair[0].component = "CGST"
        gst_pair[1].component = "SGST"
    # One half misread: CGST and SGST always share a rate.
    rates = {t.component: t.rate_bp for t in out.taxes if t.rate_bp}
    for t in out.taxes:
        if t.rate_bp is None and t.component in ("CGST", "SGST"):
            t.rate_bp = rates.get("SGST" if t.component == "CGST" else "CGST")
    # CGST and SGST are two halves of one GST: same rate, same amount, always
    # printed together. The reader sometimes loses the C or the S: recover the
    # missing half from the one that was read (its amount equals its twin's).
    comps = {t.component for t in out.taxes}
    if ("CGST" in comps) != ("SGST" in comps):
        have = next(t for t in out.taxes if t.component in ("CGST", "SGST"))
        if have.rate_bp is None and tax_total and tax_total[1]:
            have.rate_bp = tax_total[1] // 2  # "Total GST (5%)": each half is 2.5%
        bare = [
            t
            for t in out.taxes
            if t.component == "GST" and t.rate_bp == have.rate_bp and t.amount_minor == have.amount_minor
        ]
        if bare:
            # a bare "GST" line with the same rate and amount IS the missing half
            bare[0].component = "CGST" if have.component == "SGST" else "SGST"
        else:
            out.taxes.append(
                ParsedTax(
                    "CGST" if have.component == "SGST" else "SGST",
                    have.rate_bp,
                    have.amount_minor,
                    have.source,
                )
            )
    # The bill's own "Total GST (5%)" line is the ground truth for the pair.
    # Bills round each half up (23.42 + 23.42 vs a 46.83 total), so allow the
    # rounding the printer itself introduces - a few paise, never rupees.
    if tax_total:
        pair = [t for t in out.taxes if t.component in ("CGST", "SGST")]
        if len(pair) == 2:
            slack = 2 if exp >= 2 else (1 if exp == 1 else 0)
            if abs(pair[0].amount_minor + pair[1].amount_minor - tax_total[0]) > slack:
                out.warnings.append("The two tax halves don't add up to the bill's Total GST line. Check them.")
    _check(out)
    return out


# ---------------------------------------------------------------- name repair
# Words that really appear on bills (Indian menus, rides, fuel). OCR misreads a
# letter now and then (PANEER -> FANEER, WATER -> VIATER, STUFFED -> STUEEED):
# a name is repaired against this dictionary by edit distance. No word matches:
# it stays exactly as printed, for the person to see on the review screen.
DISH_WORDS = frozenset("""
aalu achar aloo and auto baati basmati bhatura bhindi biryani bisleri
bowl burger butter buttermilk
cab chai cheese chilli chole chowmein chutney coffee cola combo
curd curry clear
dal dosa dosai double egg eggs
fare french fries fry fuel full
gajar ghee gobi golgappa gravy green gulab
handi halwa half honey hot
ice idli idly iced jamun jalebi jeera juice
ka kabab kebab ke kheer kulcha kulfi kofta korma
lassi lemon lentil litre liter litchi
maggi malai makhani manchurian masala medium meals methi milk mineral momo momos
mughlai mutton mutter
naan noodle noodles
ola oil omlette omelette onion
pakoda pakoda pakora paneer papad papadum parantha paratha pasta patty
pickle plain pizza pohe poha poori potato pulao pulav punjabi petrol
raita rabdi rasam rice ride roll rolls roti
sabzi sambar samosa sandwich schezwan shake shikanji shorba singhada soup
special spring stuffed sweet
tandoori tawa taxi thali tikka toast tomato toll train tandoor
uber upma uttapam
vada vadai veg vegetable chicken fish prawn salad
water wheat white with
yogurt
""".split())

_CONNECTORS = frozenset("and or with ka ki ke in no the".split())


def _collapse(word: str) -> str:
    """STUEEED -> stued: runs of a repeated letter become one, because the
    recognizer both drops and doubles letters on low-contrast print."""
    return re.sub(r"(.)\1+", r"\1", word)


# Letter pairs the reader commonly swaps (same shape at bill print sizes).
_CONFUSE_PAIRS = {
    frozenset("vw"), frozenset("uv"), frozenset("un"), frozenset("ou"), frozenset("oa"),
    frozenset("oe"), frozenset("ce"), frozenset("il"), frozenset("it"), frozenset("if"),
    frozenset("mn"), frozenset("hn"), frozenset("bd"), frozenset("bp"), frozenset("pq"),
    frozenset("gq"), frozenset("sz"), frozenset("kx"), frozenset("rn"),
}


def _lev(a: str, b: str, cap: int) -> int:
    """Edit distance with OCR costs: a visually-confused letter swap costs 1,
    any other swap 2, insert/delete 2. Bails out past cap. So VIATER->water
    (v/w swap) beats VIATER->liter."""
    if abs(len(a) - len(b)) * 2 > cap:
        return cap + 1
    prev = list(range(0, len(b) * 2 + 1, 2))
    for i, ca in enumerate(a, 1):
        cur = [i * 2]
        for j, cb in enumerate(b, 1):
            swap = 0 if ca == cb else (1 if frozenset((ca, cb)) in _CONFUSE_PAIRS else 2)
            cur.append(min(prev[j] + 2, cur[j - 1] + 2, prev[j - 1] + swap))
        if min(cur) > cap:
            return cap + 1
        prev = cur
    return prev[-1]


def _repair_word(word: str) -> str | None:
    """The dictionary word this printed word was meant to be, or None to keep
    it as printed. Ambiguous (two candidates tie) also keeps the original."""
    core = word.strip(".,()-'&").lower()
    bare = re.sub(r"[^a-z]", "", core)
    if bare and len(bare) < len(core):
        core = bare  # stray punctuation inside the word ("CHII.IY")
    if not core.isalpha() or len(core) < 3:
        return None
    if core in _CONNECTORS:
        return core
    if core in DISH_WORDS:
        return core
    limit = 2 if len(core) <= 4 else 4
    scored = [(d, c) for c in DISH_WORDS if (d := _lev(core, c, limit)) <= limit]
    if scored:
        scored.sort()
        winners = [c for d, c in scored if d == scored[0][0]]
        if len(winners) == 1:
            return winners[0]
    if len(core) >= 5:
        # doubled/dropped letters: compare with runs collapsed (stueed ~ stuffed)
        col = _collapse(core)
        scored = [(d, c) for c in DISH_WORDS if (d := _lev(col, _collapse(c), 2)) <= 2]
        if scored:
            scored.sort()
            winners = [c for d, c in scored if d == scored[0][0]]
            if len(winners) == 1:
                return winners[0]
    return None


def repair_item_name(name: str) -> str:
    """Fix OCR spelling in a dish name and make it read like a name, not a
    shout. Unknown words stay exactly as printed; numbers are never touched."""
    words = name.split()
    out: list[str] = []
    i = 0
    while i < len(words):
        w = words[i]
        # Two fragments that only make sense glued ("PANE ER" -> Paneer).
        if i + 1 < len(words):
            joined = (w.strip(".,()-") + words[i + 1].strip(".,()-")).lower()
            if joined.isalpha() and joined in DISH_WORDS:
                out.append(joined.capitalize())
                i += 2
                continue
        fixed = _repair_word(w)
        if fixed is not None:
            out.append(fixed if fixed in _CONNECTORS else fixed.capitalize())
        else:
            out.append(w)
        i += 1
    return " ".join(out)


def _is_name_part(row: str) -> bool:
    """A second line of a dish name: words only, no codes or numbers ("BIRYANI", "POTATO")."""
    t = row.strip()
    return bool(re.fullmatch(r"[A-Za-z][A-Za-z .&'/-]{1,40}", t)) and not SKIP_WORDS.search(t) and not TAX_RE.search(t)


def _final_total(text: str, amount: int, current: int | None, exp: int, prefer: bool = False) -> int:
    """The bill total; repairs "71485.00" where OCR read the rupee sign as a 7."""
    digits = text.strip().lstrip("₹").strip()
    if current and digits.startswith("7") and amount > 5 * current:
        fixed = to_minor(digits[1:], exp)
        if fixed is not None and abs(fixed - current) <= 100 * 10**exp:
            amount = fixed
    if current is None or prefer or amount >= current:
        return amount
    return current


def _item_from_row(label: str, amount: int, row: str, exp: int) -> ParsedItem:
    """name [qty] [rate] amount: trust quantity and rate only when they agree with the amount."""
    with_unit = UNIT_WORDS.search(label) is not None
    label = UNIT_WORDS.sub("", label)
    name = re.sub(r"(?:\s+[x×]?\s*\d[\d,]*(?:\.\d{1,2})?\s*[/\-]?\s*)+$", "", label).strip(" :.-x×/") or label
    nums = re.findall(r"\d[\d,]*(?:\.\d{1,2})?", label[len(name):])
    qty_milli, unit, confidence = 1000, amount, 70

    def small_int(t: str) -> int | None:
        return int(t) if t.isdigit() and 0 < int(t) <= 99 else None

    def num_value(t: str) -> float | None:
        """POS bills print the quantity with decimals ("2.00"); read it as a number."""
        try:
            return float(t.replace(",", ""))
        except ValueError:
            return None

    if len(nums) >= 2:
        v_q, rate = num_value(nums[-2]), to_minor(nums[-1], exp)
        q = int(v_q) if v_q is not None and v_q == int(v_q) and 0 < v_q <= 99 else None
        if q and rate is not None and rate * q == amount:
            qty_milli, unit, confidence = q * 1000, rate, 95
        else:
            confidence = 50  # numbers present but they don't multiply out: needs a look
    elif len(nums) == 1:
        v = num_value(nums[0])
        q = int(v) if v is not None and v == int(v) and 0 < v <= 99 else None
        rate = to_minor(nums[0], exp)
        if q and q > 1 and amount % q == 0:
            qty_milli, unit, confidence = q * 1000, amount // q, 90 if with_unit else 75
        elif q == 1 and with_unit:
            confidence = 90  # "PANEER TIKKA  1  POR  399.00": a quantity column
        elif rate == amount:
            confidence = 90  # "Lassi  80.00  80.00": rate equals amount, quantity 1
        elif v is not None and v != int(v) and 0 < v < 24 and (amount * 1000) % round(v * 1000) == 0:
            # a fractional count ("PAKODA 2.50 100.00"): the amount stays king
            qty_milli, unit, confidence = round(v * 1000), amount * 1000 // round(v * 1000), 70
    if not re.search(r"[a-zA-Z]{3,}", name):
        confidence = min(confidence, 40)
    else:
        # Handwritten "2 Roti 24": the count before the name, no rate printed.
        lead = re.match(r"^(\d{1,2})\s+(\D.*)$", name)
        if lead and (q := small_int(lead.group(1))) and 2 <= q <= 20 and amount % q == 0 and amount // q >= 100:
            name = lead.group(2).strip()
            qty_milli, unit, confidence = q * 1000, amount // q, max(confidence, 70)
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
