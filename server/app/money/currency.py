"""Currency metadata. Amounts are always integers in the currency's minor unit."""

from __future__ import annotations

from dataclasses import dataclass


@dataclass(frozen=True)
class Currency:
    code: str
    exponent: int
    symbol: str

    @property
    def factor(self) -> int:
        return 10**self.exponent


_CURRENCIES = {
    c.code: c
    for c in (
        Currency("INR", 2, "₹"),
        Currency("USD", 2, "$"),
        Currency("EUR", 2, "€"),
        Currency("GBP", 2, "£"),
        Currency("AED", 2, "AED "),
        Currency("SGD", 2, "S$"),
        Currency("AUD", 2, "A$"),
        Currency("CAD", 2, "C$"),
        Currency("NPR", 2, "Rs "),
        Currency("LKR", 2, "Rs "),
        Currency("BDT", 2, "৳"),
        Currency("THB", 2, "฿"),
        Currency("MYR", 2, "RM "),
        Currency("JPY", 0, "¥"),
        Currency("KRW", 0, "₩"),
        Currency("KWD", 3, "KD "),
        Currency("BHD", 3, "BD "),
        Currency("OMR", 3, "OMR "),
    )
}

SUPPORTED_CURRENCIES = tuple(sorted(_CURRENCIES))


class UnknownCurrency(ValueError):
    pass


def get_currency(code: str) -> Currency:
    try:
        return _CURRENCIES[code.upper()]
    except KeyError as exc:
        raise UnknownCurrency(code) from exc


def format_minor(amount: int, code: str) -> str:
    """Plain, locale-neutral rendering used in logs, exports and tests: ₹1,250.50."""
    cur = get_currency(code)
    sign = "-" if amount < 0 else ""
    whole, frac = divmod(abs(amount), cur.factor)
    text = f"{whole:,}"
    if cur.exponent:
        text += "." + str(frac).zfill(cur.exponent)
    return f"{sign}{cur.symbol}{text}"
