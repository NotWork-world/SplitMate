"""Receipt parsing (mocked OCR lines), upload validation, private access and isolation."""

import io
import time

from PIL import Image

from app.core.security import sign
from app.integrations.receipt_parser import OcrLine, parse_receipt, rows_from_lines


def lines(*texts):
    return [OcrLine(t) for t in texts]


SAMPLE = lines(
    "Paradise Biryani",
    "Secunderabad",
    "GSTIN 36AAACP1234Z1Z5",
    "Date: 12/10/2026  Time 21:40",
    "Item  Qty  Rate  Amount",
    "Chicken Biryani  2  320.00  640.00",
    "Paneer Tikka  1  280.00  280.00",
    "Masala Chai  3  40.00  120.00",
    "Sub Total  1,040.00",
    "Discount 10%  104.00",
    "Service Charge 5%  46.80",
    "CGST @ 2.5%  23.40",
    "SGST @ 2.5%  23.40",
    "Round Off  0.40",
    "Grand Total  1,030.00",
    "Thank you, visit again",
)


def test_parses_a_typical_indian_restaurant_bill():
    r = parse_receipt(SAMPLE, "INR")
    assert r.merchant == "Paradise Biryani"
    assert r.date == "2026-10-12"
    assert [(i.name, i.quantity_milli, i.unit_price_minor, i.amount_minor, i.confidence) for i in r.items] == [
        ("Chicken Biryani", 2000, 32000, 64000, 95),
        ("Paneer Tikka", 1000, 28000, 28000, 95),
        ("Masala Chai", 3000, 4000, 12000, 95),
    ]
    assert r.subtotal_minor == 104000
    assert [(d.amount_minor, d.rate_bp) for d in r.discounts] == [(10400, 1000)]
    assert [(c.label, c.amount_minor, c.rate_bp) for c in r.charges] == [("service", 4680, 500)]
    assert [(t.component, t.rate_bp, t.amount_minor) for t in r.taxes] == [("CGST", 250, 2340), ("SGST", 250, 2340)]
    assert r.round_off_minor == 40
    assert r.total_minor == 103000
    assert r.warnings == []
    # Every value keeps the text it came from.
    assert r.items[0].source == "Chicken Biryani  2  320.00  640.00"


def test_never_invents_missing_values():
    r = parse_receipt(lines("Cafe", "Cold Coffee  180.00", "Brownie  2  90.00  200.00"), "INR")
    assert r.total_minor is None
    assert r.taxes == []
    cold, brownie = r.items
    assert (cold.quantity_milli, cold.unit_price_minor, cold.confidence) == (1000, 18000, 70)
    # 2 x 90 != 200: amount is kept as printed, flagged for review, no "corrected" rate.
    assert (brownie.amount_minor, brownie.confidence) == (20000, 50)
    assert any("total wasn't found" in w for w in r.warnings)
    assert any("hard to read" in w for w in r.warnings)


def test_flags_subtotal_mismatch_and_single_tax_component():
    r = parse_receipt(lines("Dhaba", "Dal  150.00", "Sub Total  250.00", "CGST 2.5%  6.25", "Total  256.25"), "INR")
    assert any("don't add up" in w for w in r.warnings)
    assert any("CGST/SGST" in w for w in r.warnings)


def test_rows_are_rebuilt_from_positioned_fragments():
    frags = [
        OcrLine("Veg Thali", left=10, top=100, width=120, height=20),
        OcrLine("250.00", left=300, top=102, width=60, height=20),
        OcrLine("Lassi", left=10, top=140, width=60, height=20),
        OcrLine("80.00", left=300, top=139, width=50, height=20),
    ]
    assert rows_from_lines(frags) == ["Veg Thali  250.00", "Lassi  80.00"]


def test_parse_endpoint_requires_auth_and_works(client, make_user):
    assert client.post("/api/receipts/parse", json={"lines": []}).status_code == 401
    a = make_user("Asha")
    r = a.post("/receipts/parse", {"lines": [{"text": t.text} for t in SAMPLE]})
    assert r.status_code == 200
    assert r.json()["total_minor"] == 103000 and r.json()["provider"] == "mlkit-on-device"


def png_bytes():
    buf = io.BytesIO()
    Image.new("RGB", (40, 60), (255, 255, 255)).save(buf, format="PNG")
    return buf.getvalue()


def test_upload_private_access_and_isolation(client, make_user):
    a = make_user("Asha")
    eve = make_user("Eve")
    g = a.post("/groups", {"name": "Dinner"}).json()
    up = client.post(f"/api/groups/{g['id']}/receipts", headers=a.h(), files={"file": ("r.png", png_bytes(), "image/png")})
    assert up.status_code == 201, up.text
    rid = up.json()["id"]

    # A text file pretending to be an image is refused.
    bad = client.post(f"/api/groups/{g['id']}/receipts", headers=a.h(), files={"file": ("r.jpg", b"not an image", "image/jpeg")})
    assert bad.status_code == 422 and bad.json()["error"]["code"] == "not_an_image"
    # Outsiders can't upload to, or get links for, someone else's group.
    assert client.post(f"/api/groups/{g['id']}/receipts", headers=eve.h(), files={"file": ("r.png", png_bytes(), "image/png")}).status_code == 404
    assert eve.get(f"/receipts/{rid}/url").status_code == 404

    url = a.get(f"/receipts/{rid}/url").json()["url"]
    path = url.split("://", 1)[1].split("/", 1)[1]
    got = client.get("/" + path)
    assert got.status_code == 200 and got.headers["content-type"] == "image/png"
    # Tampered or expired signatures are refused.
    assert client.get(f"/api/receipts/{rid}/file?exp={int(time.time()) + 300}&sig=deadbeef").status_code == 403
    old = int(time.time()) - 5
    assert client.get(f"/api/receipts/{rid}/file?exp={old}&sig={sign(rid, old)}").status_code == 403

    # Attach to an expense; another group's receipt can't be attached.
    me = g["my_member_id"]
    body = {"title": "Dinner", "category": "food", "expense_date": "2026-10-01", "currency": "INR",
            "items": [{"client_id": "x", "name": "Thali", "unit_price_minor": 20000, "consumers": [{"member_id": me}]}],
            "payers": [{"member_id": me}], "receipt_id": rid}
    assert a.post(f"/groups/{g['id']}/expenses", body).status_code == 201
    eg = eve.post("/groups", {"name": "Eve's"}).json()
    body2 = dict(body, payers=[{"member_id": eg["my_member_id"]}],
                 items=[{"client_id": "x", "name": "Y", "unit_price_minor": 1, "consumers": [{"member_id": eg["my_member_id"]}]}])
    assert eve.post(f"/groups/{eg['id']}/expenses", body2).json()["error"]["code"] == "invalid_receipt"

    assert a.delete(f"/receipts/{rid}").status_code == 204
    assert a.get(f"/receipts/{rid}/url").status_code == 404


def test_photo_is_deleted_once_the_bill_is_final(client, make_user):
    """Bill photos are temporary: finalising deletes the file; the itemised bill stays."""
    a = make_user("Asha")
    g = a.post("/groups", {"name": "Dinner"}).json()
    rid = client.post(f"/api/groups/{g['id']}/receipts", headers=a.h(),
                      files={"file": ("r.png", png_bytes(), "image/png")}).json()["id"]
    me = g["my_member_id"]
    body = {"title": "Dinner", "category": "food", "expense_date": "2026-10-01", "currency": "INR",
            "items": [{"client_id": "x", "name": "Thali", "unit_price_minor": 20000, "consumers": [{"member_id": me}]}],
            "payers": [{"member_id": me}], "receipt_id": rid}
    d = a.post(f"/groups/{g['id']}/expenses", body).json()
    assert a.get(f"/receipts/{rid}/url").status_code == 200  # still there while it's a draft
    f = a.post(f"/expenses/{d['id']}/finalize", {"expected_version": d["version"]})
    assert f.status_code == 200, f.text
    assert a.get(f"/receipts/{rid}/url").status_code == 404
    e = a.get(f"/expenses/{d['id']}").json()
    assert e["status"] == "finalized" and e["items"][0]["name"] == "Thali"

    # Same when the draft is created and finalised in one go.
    rid2 = client.post(f"/api/groups/{g['id']}/receipts", headers=a.h(),
                       files={"file": ("r.png", png_bytes(), "image/png")}).json()["id"]
    assert a.post(f"/groups/{g['id']}/expenses?finalize=true", dict(body, receipt_id=rid2)).status_code == 201
    assert a.get(f"/receipts/{rid2}/url").status_code == 404
