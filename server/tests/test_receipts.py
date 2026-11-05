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


def test_flags_subtotal_mismatch_and_completes_a_single_tax_half():
    """A lone CGST line gets its SGST twin rebuilt (equal halves of one GST);
    the subtotal mismatch is still flagged for the person to check."""
    r = parse_receipt(lines("Dhaba", "Dal  150.00", "Sub Total  250.00", "CGST 2.5%  6.25", "Total  256.25"), "INR")
    assert {t.component for t in r.taxes} == {"CGST", "SGST"}
    assert all(t.rate_bp == 250 and t.amount_minor == 625 for t in r.taxes)
    assert any("add up to the receipt's subtotal" in w for w in r.warnings)
    assert not any("CGST/SGST" in w for w in r.warnings)


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


def test_real_restaurant_bill_from_phone_ocr():
    """Lines exactly as ML Kit read a real photographed bill (qty/unit columns, two-line
    names, HSN rows, 'C GST 2.58' with % read as 8, rupee sign read as 7)."""
    import json
    from pathlib import Path

    raw = json.loads((Path(__file__).parent / "fixtures" / "ocr_royal_cuisine.json").read_text(encoding="utf-8"))
    r = parse_receipt([OcrLine(**d) for d in raw])
    got = [(i.name, i.quantity_milli // 1000, i.unit_price_minor, i.amount_minor) for i in r.items]
    # The names are repaired against the dish dictionary; the raw row stays in source.
    assert got == [
        ("Paneer Masala Dosa", 4, 17000, 68000),
        ("Paneer Tikka Biryani", 1, 39900, 39900),
        ("Stuffed Paratha", 2, 9000, 18000),
        ("Honey Chilli Potato", 1, 24900, 24900),
        ("Clear Mineral Water", 2, 3000, 6000),
    ]
    assert r.subtotal_minor == 156800 and sum(i.amount_minor for i in r.items) == 156800
    assert [(d.amount_minor, d.rate_bp) for d in r.discounts] == [(15080, 1000)]
    assert [(t.component, t.rate_bp, t.amount_minor) for t in r.taxes] == [("CGST", 250, 3536), ("SGST", 250, 3536)]
    assert r.round_off_minor == -6 and r.total_minor == 148500 and r.date == "2026-10-16"
    assert r.warnings == []


def test_handwritten_dhaba_bill_with_counts_and_rates():
    """No paise anywhere, quantities written like humans do: Roti 8 x 12 96."""
    r = parse_receipt(
        lines("Rahul Ka Dhaba", "Paneer Tikka 320", "Roti 8 x 12 96", "Dal Makhani 245", "Total 661"),
        "INR",
    )
    assert r.merchant == "Rahul Ka Dhaba"
    assert r.category == "food"
    roti = next(i for i in r.items if i.name == "Roti")
    assert (roti.quantity_milli, roti.unit_price_minor, roti.amount_minor, roti.confidence) == (8000, 1200, 9600, 95)
    assert sum(i.amount_minor for i in r.items) == 66100 == r.total_minor


def test_leading_count_without_rate():
    """Handwritten '2 Roti 24': the count comes first, only the total is printed."""
    r = parse_receipt(lines("Sharma Ji Ka Dhaba", "2 Roti 24", "Total 24"), "INR")
    roti = next(i for i in r.items if i.name == "Roti")
    assert (roti.quantity_milli, roti.unit_price_minor) == (2000, 1200)


def test_letter_shaped_digits_are_repaired():
    """UniOCR on handwriting sometimes reads 0 as O and 1 as I/l inside numbers."""
    r = parse_receipt(lines("Canteen", "Samosa 1O0", "Chai l5", "Total 115"), "INR")
    amounts = {i.name: i.amount_minor for i in r.items}
    assert amounts["Samosa"] == 10000
    assert amounts["Chai"] == 1500
    assert r.total_minor == 11500


def test_auto_rickshaw_and_uber_bills_become_one_item():
    """A ride bill has no dishes: one item for the whole fare, so it can still be split."""
    auto = parse_receipt(lines("Auto Rickshaw", "Distance: 3.5 km", "Fare 120", "Total 120"), "INR")
    assert auto.category == "transport"
    assert [i.amount_minor for i in auto.items] == [12000] and auto.total_minor == 12000

    uber = parse_receipt(lines("Uber", "Trip to Indiranagar", "245.67", "Paid to driver"), "INR")
    assert uber.category == "transport"
    assert [(i.name, i.amount_minor, i.confidence) for i in uber.items] == [("The whole bill", 24567, 60)]
    assert uber.total_minor == 24567


def test_real_phone_photo_through_uniocr():
    """The full loop on a real customer photo: a portrait bill saved sideways
    (EXIF 6), tilted, dim, two columns. These are the exact lines UniOCR read
    on-device after the EXIF fix; the parser must build the whole bill."""
    import json
    from pathlib import Path

    raw = json.loads((Path(__file__).parent / "fixtures" / "ocr_royal_cuisine_uniocr.json").read_text(encoding="utf-8"))
    keep = ("text", "left", "top", "width", "height")
    r = parse_receipt([OcrLine(**{k: d[k] for k in keep}) for d in raw])  # the endpoint drops 'score'
    assert r.merchant == "ROYAL CUISINE AND BAKERS"
    assert r.date == "2026-11-02" and r.category == "food"
    got = [(i.name, i.quantity_milli // 1000, i.unit_price_minor, i.amount_minor) for i in r.items]
    assert got == [
        ("Cheese Paneer Dosa", 1, 18000, 18000),
        ("Tandoori Paneer Pizza", 1, 18000, 18000),
        ("Vegetable Pakoda", 1, 15000, 15000),
        ("Butter Roti", 6, 3000, 18000),
        ("Tawa Paneer Masala", 1, 31900, 31900),
        ("Clear Mineral Water", 1, 3000, 3000),
    ]
    assert r.subtotal_minor == 103900 and sum(i.amount_minor for i in r.items) == 103900
    assert [(d.amount_minor, d.rate_bp) for d in r.discounts] == [(10090, 1000)]
    assert [(t.component, t.rate_bp, t.amount_minor) for t in r.taxes] == [("CGST", 250, 2342), ("SGST", 250, 2342)]
    assert r.round_off_minor == 50 and r.total_minor == 98400
    assert r.warnings == []


def test_tilted_photo_rows_stay_together():
    """A page tilted a few degrees must not split each row into its columns."""
    box = lambda text, col, row: OcrLine(
        text=text,
        left=10 + col * 145,
        top=100 + row * 40 - 0.08 * (10 + col * 145),
        width=30,
        height=20,
    )
    grid = [box(f"r{r}c{c}", c, r) for r in range(4) for c in range(3)]
    assert rows_from_lines(grid) == [f"r{r}c0  r{r}c1  r{r}c2" for r in range(4)]


def test_doubled_decimal_point_is_repaired():
    """Glare makes the reader print "983..50": still the total, not a lost one."""
    r = parse_receipt(lines("NET TOTAL 983..50", "Payable Amt. 984.00"))
    assert r.total_minor == 98400


def test_order_codes_are_not_money():
    """"E0008,E0009,E0013" must not become "The whole bill 13.00"."""
    r = parse_receipt(lines("Orders:", "E0008,E0009,E0013"))
    assert r.items == [] and r.total_minor is None
    assert "No items could be read" in " ".join(r.warnings)


def test_dish_name_repair():
    """One letter misread, a split word, doubled letters, a misread V/W, stray
    punctuation -- all real OCR mistakes from photographed bills."""
    from app.integrations.receipt_parser import repair_item_name

    assert repair_item_name("TAWA FANEER MASALA") == "Tawa Paneer Masala"
    assert repair_item_name("PANE ER MASAILA DOSA") == "Paneer Masala Dosa"
    assert repair_item_name("STUEEED PARATHA") == "Stuffed Paratha"
    assert repair_item_name("CLEAR MINERAL VIATER") == "Clear Mineral Water"
    assert repair_item_name("HONEY CHII.IY POTATO") == "Honey Chilli Potato"
    assert repair_item_name("DAL AND FRY") == "Dal and Fry"  # connector stays small


def test_dish_name_repair_keeps_the_unknown_as_printed():
    """Never guess on a word the dictionary doesn't recognise; the person sees
    exactly what was printed and can fix it on the review screen."""
    from app.integrations.receipt_parser import repair_item_name

    assert repair_item_name("XYZQQ Special") == "XYZQQ Special"
    assert repair_item_name("7UP Maggi Masala") == "7UP Maggi Masala"
    assert repair_item_name("Paneer Tikka Biryani") == "Paneer Tikka Biryani"  # already good


def test_token_number_row_is_not_an_item():
    """'TOKEN No.149' is the order token the counter gave, not a dish for Rs 149."""
    r = parse_receipt(
        lines("TUNDAY KABABI", "31/10/2026", "TOKEN No.149", "CHICKEN BIRYANI 2.00/760.00"),
        "INR",
    )
    assert [i.name for i in r.items] == ["Chicken Biryani"]
    b = r.items[0]
    assert (b.quantity_milli, b.unit_price_minor, b.amount_minor) == (2000, 38000, 76000)


def test_decimal_quantity_column_is_the_count():
    """POS bills print the qty with decimals; it must not stay glued to the name."""
    r = parse_receipt(lines("Dhaba", "BUTTER ROTI 8.00 180.00", "PAKODA 2.50 100.00"), "INR")
    roti = next(i for i in r.items if i.name == "Butter Roti")
    assert (roti.quantity_milli, roti.unit_price_minor, roti.amount_minor) == (8000, 2250, 18000)
    pakoda = next(i for i in r.items if i.name == "Pakoda")
    assert (pakoda.quantity_milli, pakoda.unit_price_minor, pakoda.amount_minor) == (2500, 4000, 10000)


def test_zero_taxes_and_huge_round_off_are_not_taken():
    """A 'SGST 0.00' summary row and a misread 'Round Off 798' must not poison the split."""
    r = parse_receipt(lines("Dhaba", "Roti 40", "SGST 2.5% 0.00", "Round Off 798.00"))
    assert r.taxes == []
    assert r.round_off_minor is None
    assert "Round Off 798.00" in r.unparsed_lines
    assert not any("CGST/SGST" in w for w in r.warnings)


def test_round_off_next_to_total_becomes_the_total():
    """"ROUND OFF TOTAL 798.00": hundreds of rupees of 'rounding' is the total."""
    r = parse_receipt(lines("Dhaba", "Roti 40", "ROUND OFF TOTAL 798.00"), "INR")
    assert r.round_off_minor is None and r.total_minor == 79800
    r2 = parse_receipt(lines("Dhaba", "Roti 40", "Round Off 798.00"), "INR")
    assert r2.round_off_minor is None and r2.total_minor is None


def test_missing_cgst_is_recovered_from_sgst():
    """CGST and SGST are equal halves of one GST; if the reader loses one
    line, the other is rebuilt from its twin - the app then auto-applies 5%."""
    r = parse_receipt(lines("Dhaba", "Biryani 800.00", "SGST 2.5% 19.50", "TOTAL 839.00"), "INR")
    assert {t.component for t in r.taxes} == {"CGST", "SGST"}
    assert all(t.rate_bp == 250 and t.amount_minor == 1950 for t in r.taxes)


def test_bare_gst_line_beside_one_half_is_the_missing_half():
    """'GST 2.5% 19.50' next to 'SGST 2.5% 19.50' is CGST with its C lost."""
    r = parse_receipt(lines("Dhaba", "Biryani 800.00", "GST 2.5% 19.50", "SGST 2.5% 19.50", "TOTAL 839.00"), "INR")
    assert {t.component for t in r.taxes} == {"CGST", "SGST"}
    assert all(t.rate_bp == 250 and t.amount_minor == 1950 for t in r.taxes)


def test_tax_halves_verified_against_the_total_gst_line():
    """The bill's 'Total GST (5%)' is the ground truth: 19.50+19.50 = 39.00."""
    r = parse_receipt(lines("Dhaba", "Biryani 800.00", "SGST 2.5% 19.50", "Total GST(5%) 39.00", "TOTAL 839.00"), "INR")
    assert {t.component for t in r.taxes} == {"CGST", "SGST"}
    assert not any("add up" in w for w in r.warnings)
    # A misread half (19.00 where 19.50 was printed) is flagged, not trusted.
    r2 = parse_receipt(lines("Dhaba", "Biryani 800.00", "SGST 2.5% 19.00", "Total GST(5%) 39.00"), "INR")
    assert any("add up" in w for w in r2.warnings)


def test_half_rate_comes_from_total_gst_when_missing():
    """"SGST 19.50" with no rate printed, next to "Total GST(5%)": 2.5% each."""
    r = parse_receipt(lines("Dhaba", "Biryani 800.00", "SGST 19.50", "Total GST(5%) 39.00"), "INR")
    assert {t.component for t in r.taxes} == {"CGST", "SGST"}
    assert all(t.rate_bp == 250 for t in r.taxes)


def test_same_tax_printed_twice_is_not_a_cgst_sgst_pair():
    """A counter bill re-prints the body's GST line in its Tax Summary table.
    Reading the two identical lines as a CGST/SGST pair doubled the GST to
    10%; the bill's own totals (items + tax + round-off = 118.00) say only
    one copy is real. The shop even charged a different GST than it printed
    (2.50, only the ice cream is taxed; the chocolates are MRP-inclusive) --
    so the warning says the tax lines don't fit, and the total is the truth."""
    r = parse_receipt(
        lines(
            "5 STAR OREO  1  45.00  45.00",
            "ICE CREAM CUP  1  50.00  50.00",
            "MUNCH MAX  1  20.00  20.00",
            "ITEMS: 115.00",
            "GST (5%) On 111.90  5.60",
            "NET TOTAL  117.50",
            "(Round off)  0.50",
            "GST 5%  .11.90  5.60",
            "Payable Amt. 118.00",
        ),
        "INR",
    )
    assert [(i.name, i.quantity_milli, i.unit_price_minor, i.amount_minor) for i in r.items] == [
        ("5 Star Oreo", 1000, 4500, 4500),
        ("Ice Cream Cup", 1000, 5000, 5000),
        ("Munch Max", 1000, 2000, 2000),
    ]
    assert [(t.component, t.rate_bp, t.amount_minor) for t in r.taxes] == [("GST", 500, 560)]
    assert r.round_off_minor == 50 and r.total_minor == 11800
    assert any("don't match" in w for w in r.warnings)


def test_identical_gst_pair_is_still_the_halves_when_the_bill_adds_up():
    """The other reading of two identical GST lines: a real CGST/SGST pair
    whose C and S were lost to OCR. There BOTH copies are needed to reach
    the printed total, so the pair is kept (and the app applies 2 x 2.5%)."""
    r = parse_receipt(lines("Biryani  800.00", "GST 2.5%  19.50", "GST 2.5%  19.50", "TOTAL  839.00"), "INR")
    assert [(t.component, t.rate_bp, t.amount_minor) for t in r.taxes] == [
        ("CGST", 250, 1950),
        ("SGST", 250, 1950),
    ]


def test_identical_gst_pair_with_no_total_keeps_the_old_pair_reading():
    """Nothing on the bill can arbitrate: keep the CGST/SGST assumption."""
    r = parse_receipt(lines("Biryani  800.00", "GST 2.5%  19.50", "GST 2.5%  19.50"), "INR")
    assert {t.component for t in r.taxes} == {"CGST", "SGST"}


def test_brand_name_starting_with_a_digit_is_not_a_count():
    """'5 Star' is the chocolate; the printed qty column already says 1,
    so the leading digit must not become the quantity."""
    r = parse_receipt(lines("5 STAR OREO  1  45.00  45.00", "Total  45.00"), "INR")
    assert [(i.name, i.quantity_milli, i.unit_price_minor, i.amount_minor) for i in r.items] == [
        ("5 Star Oreo", 1000, 4500, 4500)
    ]


def test_real_takeaway_bill_tax_summary_reprint_through_uniocr():
    """Second real photo from the same shop, this time the takeaway counter:
    the Tax Summary table re-prints the GST line and the '5%' lost its % to
    OCR ('(58)'). One 5% GST must survive, the three items must read right,
    and the payable 118.00 is the total -- with the warning that the shop's
    own tax lines don't fit that total."""
    import json
    from pathlib import Path

    raw = json.loads((Path(__file__).parent / "fixtures" / "ocr_royal_takeaway_uniocr.json").read_text(encoding="utf-8"))
    keep = ("text", "left", "top", "width", "height")
    r = parse_receipt([OcrLine(**{k: d[k] for k in keep}) for d in raw], "INR")
    assert [(i.name, i.quantity_milli, i.unit_price_minor, i.amount_minor) for i in r.items] == [
        ("5 Star Oreo", 1000, 4500, 4500),
        ("Ice Cream Cup", 1000, 5000, 5000),
        ("Munch Max", 1000, 2000, 2000),
    ]
    assert r.subtotal_minor == 11500
    assert [(t.component, t.rate_bp, t.amount_minor) for t in r.taxes] == [("GST", 500, 560)]
    assert r.round_off_minor == 50 and r.total_minor == 11800
    assert any("don't match" in w for w in r.warnings)
