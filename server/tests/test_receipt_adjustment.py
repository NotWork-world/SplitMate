"""A receipt that doesn't add up can still be finalised: the gap is shared by order."""

from tests.conftest import expense_body, item


def _bill(a, g, me, ravi, receipt, **extra):
    body = expense_body(me, [item("a", "Dosa", 68000, [me]), item("b", "Water", 6000, [ravi])],
                        receipt_total_minor=receipt, **extra)
    return a.post(f"/groups/{g['id']}/expenses?finalize=true", body)


def test_gap_to_receipt_is_shared_and_bill_finalises(make_user):
    a = make_user("Asha")
    g = a.post("/groups", {"name": "Dinner", "type": "friends", "currency": "INR",
                           "members": [{"display_name": "Ravi"}]}).json()
    me = g["my_member_id"]
    ravi = next(m["id"] for m in g["members"] if m["display_name"] == "Ravi")
    # Without an adjustment the mismatch blocks finalising...
    assert _bill(a, g, me, ravi, 74578).status_code == 422
    # ...with the app's labelled adjustment it goes through and matches the receipt to the paisa.
    fee = {"client_id": "receipt-adjust", "label": "Receipt difference", "type": "adjustment", "kind": "fixed",
           "value": 578, "tax_rate_bp": 0, "tax_scheme": "gst", "allocation": "proportional"}
    e = _bill(a, g, me, ravi, 74578, charges=[fee])
    assert e.status_code == 201, e.text
    shares = {x["member_id"]: x["total"] for x in e.json()["calculation"]["people"]}
    assert sum(shares.values()) == 74578 and shares[me] > shares[ravi]
    # Receipt lower than the items: a post-tax discount takes it off.
    off = {"client_id": "receipt-adjust", "label": "Receipt difference", "kind": "fixed", "value": 500,
           "stage": "post_tax", "allocation": "proportional", "item_client_ids": None, "is_coupon": False}
    assert _bill(a, g, me, ravi, 73500, discounts=[off]).status_code == 201
