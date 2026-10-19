"""Phone notifications: token registration, message text, and sending only after commit."""

from app.integrations import push


def test_push_token_register_move_and_remove(make_user):
    a = make_user("Asha")
    b = make_user("Bina")
    tok = {"token": "fcm-token-abcdefghijkl"}
    assert a.post("/me/push-token", tok).status_code == 204
    assert a.post("/me/push-token", tok).status_code == 204  # idempotent
    assert b.post("/me/push-token", tok).status_code == 204  # same phone, new account
    assert a.post("/me/push-token/remove", tok).status_code == 204  # not Asha's any more: no-op
    assert b.post("/me/push-token/remove", tok).status_code == 204
    assert a.post("/me/push-token", {"token": "short"}).status_code == 422


def test_notification_texts():
    d = {"amount_minor": 45230, "currency": "INR"}
    assert push.describe("repayment.marked_sent", "Bina", d, "Goa")[1] == "Bina says they paid you ₹452.30. Tap to confirm you got it."
    assert push.describe("expense.finalized", "Asha", {"title": "Dinner", "total_minor": 63000, "currency": "INR"}, "Goa") == (
        "Goa", "Asha added “Dinner” · ₹630.00")
    assert push.describe("group.created", "Asha", {}, "Goa") is None


def test_pushes_queue_only_when_configured_and_after_commit(make_user, monkeypatch):
    sent = []
    monkeypatch.setattr(push, "_deliver", lambda pending: sent.append(pending))
    monkeypatch.setattr(push._pool, "submit", lambda fn, arg: fn(arg))
    a = make_user("Asha")
    b = make_user("Bina")
    g = a.post("/groups", {"name": "Flat", "type": "home", "currency": "INR", "members": []}).json()
    a.post(f"/groups/{g['id']}/members", {"username": b.user["username"]})
    assert sent == []  # no Firebase credentials: nothing is pushed
    monkeypatch.setattr(push, "enabled", lambda: True)
    a.patch(f"/groups/{g['id']}", {"name": "Flat 4B"})
    c = make_user("Chirag")
    a.post(f"/groups/{g['id']}/members", {"username": c.user["username"]})
    assert len(sent) == 1 and len(sent[0]) == 2  # Bina and Chirag, in one batch after the commit
