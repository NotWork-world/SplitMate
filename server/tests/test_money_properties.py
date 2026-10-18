"""Property tests: random bills must always reconcile to the paisa."""

from hypothesis import given, settings
from hypothesis import strategies as st

from app.money import BillInput, allocate, compute_bill
from app.money.allocate import div_round_half_up

MEMBERS = ["m1", "m2", "m3", "m4", "m5"]


@given(
    total=st.integers(-10**9, 10**9),
    weights=st.lists(st.integers(0, 10**6), min_size=1, max_size=8).filter(lambda w: sum(w) > 0),
)
def test_allocate_conserves_and_is_fair(total, weights):
    keyed = [(f"k{i}", w) for i, w in enumerate(weights)]
    out = allocate(total, keyed)
    assert sum(out.values()) == total
    w_sum = sum(weights)
    for k, w in keyed:
        exact = total * w / w_sum
        assert abs(out[k] - exact) < 1  # never more than one unit from the exact share


def test_allocate_tie_break_is_by_key():
    assert allocate(2, [("b", 1), ("c", 1), ("a", 1)]) == {"a": 1, "b": 1, "c": 0}
    assert allocate(-2, [("b", 1), ("c", 1), ("a", 1)]) == {"a": -1, "b": -1, "c": 0}


def test_round_half_up():
    assert div_round_half_up(5, 2) == 3
    assert div_round_half_up(-5, 2) == -3
    assert div_round_half_up(4, 3) == 1
    assert div_round_half_up(0, 7) == 0


consumer_sets = st.lists(st.sampled_from(MEMBERS), min_size=1, max_size=5, unique=True)

item_strategy = st.fixed_dictionaries(
    {
        "unit_price_minor": st.integers(0, 5_000_00),
        "quantity_milli": st.integers(1, 5000),
        "tax_rate_bp": st.sampled_from([0, 0, 500, 1200, 1800, 2800]),
        "tax_inclusive": st.booleans(),
        "tax_scheme": st.sampled_from(["gst", "cgst_sgst", "igst"]),
        "discount_pct": st.integers(0, 10000),
        "consumers": consumer_sets,
        "shares": st.lists(st.integers(1, 5), min_size=5, max_size=5),
        "mode": st.sampled_from(["equal", "shares"]),
    }
)


@settings(max_examples=300, deadline=None)
@given(
    items=st.lists(item_strategy, min_size=1, max_size=8),
    bill_pct=st.integers(0, 5000),
    service_pct=st.integers(0, 2000),
    tip=st.integers(0, 50000),
    post_coupon=st.integers(0, 2000),
    rounding=st.sampled_from(["none", "nearest_unit"]),
    currency=st.sampled_from(["INR", "JPY", "KWD"]),
)
def test_random_bills_reconcile_exactly(items, bill_pct, service_pct, tip, post_coupon, rounding, currency):
    bill = {
        "currency": currency,
        "items": [
            {
                "id": f"i{n}",
                "name": f"Item {n}",
                "unit_price_minor": it["unit_price_minor"],
                "quantity_milli": it["quantity_milli"],
                "tax_rate_bp": it["tax_rate_bp"],
                "tax_inclusive": it["tax_inclusive"],
                "tax_scheme": it["tax_scheme"],
                "discount": {"kind": "percent", "value": it["discount_pct"]},
                "split_mode": it["mode"],
                "consumers": [{"member_id": m, "value": it["shares"][j]} for j, m in enumerate(it["consumers"])],
            }
            for n, it in enumerate(items)
        ],
        "discounts": [{"id": "d1", "label": "Bill", "kind": "percent", "value": bill_pct}],
        "charges": [
            {"id": "c1", "label": "Service", "type": "service", "kind": "percent", "value": service_pct, "tax_rate_bp": 500},
            {"id": "c2", "label": "Tip", "type": "tip", "kind": "fixed", "value": tip, "allocation": "equal"},
        ],
        "rounding": {"mode": rounding},
    }
    if post_coupon:
        bill["discounts"].append(
            {"id": "d2", "label": "Coupon", "kind": "fixed", "value": post_coupon, "stage": "post_tax"}
        )
    r = compute_bill(BillInput.from_dict(bill))
    assert r.unallocated == 0
    assert sum(p.total for p in r.people) == r.total
    assert r.total >= 0 or not r.can_finalize
    # Each item's per-person shares add up to the item.
    for item in r.items:
        assert sum(s.total for s in item.shares) == item.total
        assert item.total >= 0
    # Tax lines add up to the tax that the bill actually carries.
    assert sum(t.amount for t in r.tax_lines) == r.tax_total
    # Totals identity.
    assert r.total == (
        r.items_net - r.pre_tax_discounts + r.tax_added + r.charges + r.charges_tax - r.post_tax_discounts + r.rounding
    )


def test_inclusive_never_adds_tax_twice():
    r = compute_bill(
        BillInput.from_dict(
            {
                "currency": "INR",
                "items": [
                    {"id": "x", "name": "A", "unit_price_minor": 11800, "tax_rate_bp": 1800, "tax_inclusive": True,
                     "consumers": [{"member_id": "a"}]},
                ],
            }
        )
    )
    assert r.total == 11800
    assert r.tax_included == 1800
    assert r.tax_added == 0


def test_payer_flags_unknown_currency():
    r = compute_bill(BillInput.from_dict({"currency": "XYZ", "items": []}))
    assert "unknown_currency" in {i.code for i in r.issues}
