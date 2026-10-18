"""End-to-end API workflow from prompt.md §18 (steps 1-10)."""

from sqlalchemy import func, select

from app.db import SessionLocal
from app.models import LedgerEntry
from tests.conftest import expense_body, item


def setup_group(owner, *names):
    r = owner.post("/groups", {"name": "Goa Trip", "type": "trip", "currency": "INR",
                               "members": [{"display_name": n} for n in names]})
    assert r.status_code == 201, r.text
    g = r.json()
    ids = {m["display_name"]: m["id"] for m in g["members"]}
    return g, ids


def test_full_workflow(make_user):
    you = make_user("You")
    # 1-2. Create a group and add members.
    g, m = setup_group(you, "Rahul")
    r = you.post(f"/groups/{g['id']}/members", {"display_name": "Aman"})
    assert r.status_code == 201
    m["Aman"] = r.json()["id"]
    me = g["my_member_id"]

    # 3-6. Manual itemised expense, dishes, allocation, discount and tax.
    body = expense_body(me, [
        item("i1", "Paneer Butter Masala", 30000, [me, m["Rahul"]], tax_rate_bp=500),
        item("i2", "Chicken Biryani", 25000, [m["Rahul"], m["Aman"]], tax_rate_bp=500),
        item("i3", "Drinks", 10000, [me, m["Rahul"], m["Aman"]], tax_rate_bp=500),
    ], discounts=[{"client_id": "d1", "label": "Discount", "kind": "fixed", "value": 5000}])
    r = you.post(f"/groups/{g['id']}/expenses/preview", body)
    assert r.status_code == 200, r.text
    preview = r.json()
    assert preview["total"] == 63000 and preview["can_finalize"]

    r = you.post(f"/groups/{g['id']}/expenses", body, headers={"Idempotency-Key": "create-1"})
    assert r.status_code == 201, r.text
    draft = r.json()
    assert draft["status"] == "draft"
    # Drafts don't touch balances.
    assert you.get(f"/groups/{g['id']}/balances").json()["balances"] == []

    # 7. Review and finalise (client total compared, not trusted).
    r = you.post(f"/expenses/{draft['id']}/finalize", {"expected_version": draft["version"], "client_total_minor": 63000})
    assert r.status_code == 200, r.text
    fin = r.json()
    assert fin["status"] == "finalized"
    people = {p["member_id"]: p["total"] for p in fin["calculation"]["people"]}
    assert sum(people.values()) == 63000

    # 8. Balances: Rahul and Aman owe me exactly their shares; nets sum to zero.
    bal = you.get(f"/groups/{g['id']}/balances").json()["balances"][0]
    assert bal["total_check_minor"] == 0
    nets = {x["member"]["id"]: x["net_minor"] for x in bal["members"]}
    assert nets[me] == people[m["Rahul"]] + people[m["Aman"]]
    assert nets[m["Rahul"]] == -people[m["Rahul"]]
    rahul_owes = people[m["Rahul"]]

    # 9. Partial repayment. Rahul joins with an invite that claims his placeholder spot.
    rahul = make_user("Rahul")
    code = you.post(f"/groups/{g['id']}/invites", {"member_id": m["Rahul"]}).json()["code"]
    assert rahul.post(f"/invites/{code}/accept", {}).status_code == 200

    r = you.post("/repayments", {"group_id": g["id"], "currency": "INR", "amount_minor": 10000,
                                 "mode": "request", "other_member_id": m["Rahul"]})
    assert r.status_code == 201, r.text
    rep = r.json()
    assert rep["status"] == "REQUESTED"
    r = rahul.post(f"/repayments/{rep['id']}/actions", {"action": "mark_sent", "method": "upi", "reference": "UTR123"})
    assert r.json()["status"] == "MARKED_SENT"
    # Marked sent is not money received: balance unchanged.
    bal = you.get(f"/groups/{g['id']}/balances").json()["balances"][0]
    assert {x["member"]["id"]: x["net_minor"] for x in bal["members"]}[m["Rahul"]] == -rahul_owes

    # 10. Confirm and verify the updated balance.
    r = you.post(f"/repayments/{rep['id']}/actions", {"action": "confirm"})
    assert r.status_code == 200 and r.json()["status"] == "CONFIRMED"
    bal = you.get(f"/groups/{g['id']}/balances").json()["balances"][0]
    assert {x["member"]["id"]: x["net_minor"] for x in bal["members"]}[m["Rahul"]] == -(rahul_owes - 10000)
    assert bal["total_check_minor"] == 0

    # Rahul sees the same truth from his side.
    mine = rahul.get("/me/balances").json()["groups"][0]
    assert mine["net_minor"] == -(rahul_owes - 10000)

    # Activity and notifications were produced.
    assert rahul.get("/notifications").json()["items"]
    assert you.get("/activity").json()["items"]


def test_quick_finalize_equal_rent_and_idempotent_retry(make_user):
    a = make_user("Asha")
    g, m = setup_group(a, "Bina", "Chirag")
    me = g["my_member_id"]
    body = expense_body(me, [item("rent", "Rent", 1000001, [me, m["Bina"], m["Chirag"]])],
                        title="October rent", category="rent", split_kind="equal")
    r1 = a.post(f"/groups/{g['id']}/expenses?finalize=true", body, headers={"Idempotency-Key": "rent-oct"})
    r2 = a.post(f"/groups/{g['id']}/expenses?finalize=true", body, headers={"Idempotency-Key": "rent-oct"})
    assert r1.status_code == r2.status_code == 201
    assert r1.json()["id"] == r2.json()["id"]
    assert r2.headers.get("Idempotent-Replay") == "true"
    with SessionLocal() as db:
        n = db.scalar(select(func.count()).select_from(LedgerEntry))
    assert n == 2  # Bina -> Asha, Chirag -> Asha; not duplicated
    listed = a.get(f"/groups/{g['id']}/expenses").json()["items"]
    assert len(listed) == 1 and listed[0]["total_minor"] == 1000001
    # Reusing the key for a different body is refused.
    other = dict(body, title="Different")
    assert a.post(f"/groups/{g['id']}/expenses", other, headers={"Idempotency-Key": "rent-oct"}).status_code == 422


def test_finalize_blocked_until_items_assigned(make_user):
    a = make_user("Asha")
    g, m = setup_group(a, "Bina")
    me = g["my_member_id"]
    body = expense_body(me, [item("x", "Naan", 6000, [me]), item("y", "Kheer", 9000, [])])
    d = a.post(f"/groups/{g['id']}/expenses", body).json()
    assert not d["calculation"]["can_finalize"]
    r = a.post(f"/expenses/{d['id']}/finalize", {"expected_version": d["version"]})
    assert r.status_code == 422
    assert r.json()["error"]["code"] == "expense_not_ready"
    assert any(x["code"] == "item_unassigned" for x in r.json()["error"]["details"])
    # Fix it, then finalise.
    body["items"][1]["consumers"] = [{"member_id": m["Bina"]}]
    body["expected_version"] = d["version"]
    d2 = a.put(f"/expenses/{d['id']}", body).json()
    assert d2["version"] == d["version"] + 1 and d2["calculation"]["can_finalize"]
    # A stale version is rejected.
    assert a.post(f"/expenses/{d['id']}/finalize", {"expected_version": d["version"]}).status_code == 409
    assert a.post(f"/expenses/{d['id']}/finalize", {"expected_version": d2["version"]}).status_code == 200


def test_client_total_mismatch_is_rejected(make_user):
    a = make_user("Asha")
    g, m = setup_group(a, "Bina")
    me = g["my_member_id"]
    d = a.post(f"/groups/{g['id']}/expenses", expense_body(me, [item("x", "Thali", 25000, [me, m["Bina"]])])).json()
    r = a.post(f"/expenses/{d['id']}/finalize", {"expected_version": d["version"], "client_total_minor": 1})
    assert r.status_code == 409
    assert r.json()["error"]["details"]["server_total_minor"] == 25000


def test_multiple_payers_and_payer_who_ate_nothing(make_user):
    a = make_user("Asha")
    g, m = setup_group(a, "Bina", "Chirag")
    me = g["my_member_id"]
    body = expense_body(me, [item("x", "Groceries", 100000, [m["Bina"], m["Chirag"]])],
                        payers=[{"member_id": me, "amount_minor": 70000}, {"member_id": m["Bina"], "amount_minor": 30000}])
    e = a.post(f"/groups/{g['id']}/expenses?finalize=true", body).json()
    assert e["status"] == "finalized"
    bal = a.get(f"/groups/{g['id']}/balances").json()["balances"][0]
    nets = {x["member"]["id"]: x["net_minor"] for x in bal["members"]}
    assert nets == {me: 70000, m["Bina"]: -20000, m["Chirag"]: -50000}
    # Payers that don't add up are refused.
    bad = dict(body, payers=[{"member_id": me, "amount_minor": 70000}, {"member_id": m["Bina"], "amount_minor": 20000}])
    r = a.post(f"/groups/{g['id']}/expenses?finalize=true", bad)
    assert r.status_code == 422 and r.json()["error"]["code"] == "payers_mismatch"


def test_edit_after_repayment_keeps_ledger_consistent(make_user):
    a = make_user("Asha")
    b = make_user("Bina")
    g, _ = setup_group(a)
    code = a.post(f"/groups/{g['id']}/invites").json()["code"]
    gb = b.post(f"/invites/{code}/accept", {}).json()
    me, bina = g["my_member_id"], gb["my_member_id"]
    body = expense_body(me, [item("x", "Cab", 100000, [me, bina])], category="transport")
    e = a.post(f"/groups/{g['id']}/expenses?finalize=true", body).json()
    # Bina owes 500.00, pays 300.00 (confirmed).
    rep = b.post("/repayments", {"group_id": g["id"], "currency": "INR", "amount_minor": 30000,
                                 "mode": "record", "other_member_id": me}).json()
    assert rep["status"] == "MARKED_SENT"
    assert a.post(f"/repayments/{rep['id']}/actions", {"action": "confirm"}).json()["status"] == "CONFIRMED"
    # Repeating confirm does not add a second ledger entry.
    assert a.post(f"/repayments/{rep['id']}/actions", {"action": "confirm"}).status_code == 200
    with SessionLocal() as db:
        assert db.scalar(select(func.count()).select_from(LedgerEntry).where(LedgerEntry.kind == "repayment")) == 1

    # The cab was actually 400.00: edit the finalised expense.
    body["items"][0]["unit_price_minor"] = 40000
    body["expected_version"] = e["version"]
    r = a.put(f"/expenses/{e['id']}", body)
    assert r.status_code == 200, r.text
    edited = r.json()
    assert edited["status"] == "finalized" and edited["calculation"]["total"] == 40000
    assert [v["version"] for v in edited["versions"]] == [e["version"], edited["version"]]
    # Bina's share is now 200.00 and she already paid 300.00: Asha owes Bina 100.00.
    bal = a.get(f"/groups/{g['id']}/balances").json()["balances"][0]
    nets = {x["member"]["id"]: x["net_minor"] for x in bal["members"]}
    assert nets == {me: -10000, bina: 10000}
    assert bal["total_check_minor"] == 0

    # Cancelling reverses the expense; only the repayment remains.
    r = a.post(f"/expenses/{e['id']}/cancel", {"expected_version": edited["version"], "reason": "duplicate"})
    assert r.json()["status"] == "cancelled"
    bal = a.get(f"/groups/{g['id']}/balances").json()["balances"][0]
    assert {x["member"]["id"]: x["net_minor"] for x in bal["members"]} == {me: -30000, bina: 30000}


def test_repayment_state_machine_rules(make_user):
    a = make_user("Asha")
    b = make_user("Bina")
    g, _ = setup_group(a)
    code = a.post(f"/groups/{g['id']}/invites").json()["code"]
    bina = b.post(f"/invites/{code}/accept", {}).json()["my_member_id"]
    me = g["my_member_id"]
    a.post(f"/groups/{g['id']}/expenses?finalize=true", expense_body(me, [item("x", "Pizza", 80000, [bina])]))

    # More than owed is refused; nothing owed the other way.
    r = a.post("/repayments", {"group_id": g["id"], "currency": "INR", "amount_minor": 90000,
                               "mode": "request", "other_member_id": bina})
    assert r.json()["error"]["code"] == "amount_exceeds_balance"
    r = b.post("/repayments", {"group_id": g["id"], "currency": "INR", "amount_minor": 100,
                               "mode": "request", "other_member_id": me})
    assert r.json()["error"]["code"] == "nothing_owed"

    rep = a.post("/repayments", {"group_id": g["id"], "currency": "INR", "amount_minor": 50000,
                                 "mode": "request", "other_member_id": bina}).json()
    # Creditor can't mark sent; debtor can't confirm.
    assert a.post(f"/repayments/{rep['id']}/actions", {"action": "mark_sent"}).status_code == 403
    assert b.post(f"/repayments/{rep['id']}/actions", {"action": "confirm"}).status_code == 409
    assert b.post(f"/repayments/{rep['id']}/actions", {"action": "mark_sent"}).json()["allowed_actions"] == ["cancel"]
    assert b.post(f"/repayments/{rep['id']}/actions", {"action": "confirm"}).status_code == 403
    # Dispute -> resubmit -> awaiting confirmation -> reject: balance untouched throughout.
    assert a.post(f"/repayments/{rep['id']}/actions", {"action": "dispute", "note": "Not in my account"}).json()["status"] == "DISPUTED"
    assert b.post(f"/repayments/{rep['id']}/actions", {"action": "resubmit", "reference": "UTR9"}).json()["status"] == "AWAITING_CONFIRMATION"
    assert a.post(f"/repayments/{rep['id']}/actions", {"action": "reject"}).json()["status"] == "REJECTED"
    assert a.post(f"/repayments/{rep['id']}/actions", {"action": "confirm"}).status_code == 409
    nets = {x["member"]["id"]: x["net_minor"] for x in a.get(f"/groups/{g['id']}/balances").json()["balances"][0]["members"]}
    assert nets[bina] == -80000
    events = a.get(f"/repayments/{rep['id']}").json()["events"]
    assert [e["to_status"] for e in events] == ["REQUESTED", "MARKED_SENT", "DISPUTED", "AWAITING_CONFIRMATION", "REJECTED"]

    # Cancel by the creditor while requested.
    rep2 = a.post("/repayments", {"group_id": g["id"], "currency": "INR", "amount_minor": 100,
                                  "mode": "request", "other_member_id": bina}).json()
    assert a.post(f"/repayments/{rep2['id']}/actions", {"action": "cancel"}).json()["status"] == "CANCELLED"


def test_settlement_suggestions(make_user):
    a = make_user("Asha")
    g, m = setup_group(a, "Bina", "Chirag")
    me = g["my_member_id"]
    a.post(f"/groups/{g['id']}/expenses?finalize=true",
           expense_body(me, [item("x", "Hotel", 90000, [me, m["Bina"], m["Chirag"]])]))
    a.post(f"/groups/{g['id']}/expenses?finalize=true",
           expense_body(m["Bina"], [item("y", "Fuel", 30000, [me, m["Bina"], m["Chirag"]])]))
    bal = a.get(f"/groups/{g['id']}/balances").json()["balances"][0]
    sugg = [(s["from"]["display_name"], s["to"]["display_name"], s["amount_minor"]) for s in bal["suggestions"]]
    # Asha +60000-10000=+50000; Bina -30000+20000=-10000; Chirag -40000
    assert sugg == [("Chirag", "Asha", 40000), ("Bina", "Asha", 10000)]


def test_concurrent_finalize_creates_one_set_of_entries(make_user):
    import threading

    a = make_user("Asha")
    g, m = setup_group(a, "Bina")
    me = g["my_member_id"]
    d = a.post(f"/groups/{g['id']}/expenses", expense_body(me, [item("x", "Dosa", 20000, [me, m["Bina"]])])).json()
    results = []

    def go():
        results.append(a.post(f"/expenses/{d['id']}/finalize", {"expected_version": d["version"]}).status_code)

    threads = [threading.Thread(target=go) for _ in range(4)]
    for t in threads:
        t.start()
    for t in threads:
        t.join()
    assert all(s in (200, 409) for s in results) and 200 in results
    with SessionLocal() as db:
        assert db.scalar(select(func.count()).select_from(LedgerEntry)) == 1
