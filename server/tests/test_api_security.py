"""Authentication, session lifecycle, validation and cross-group isolation."""

from app.integrations.google import GoogleIdentity, set_verifier, verify_with_google
from tests.conftest import expense_body, item


def test_register_login_refresh_logout(client):
    r = client.post("/api/auth/register", json={"email": "Asha@Example.com", "password": "correct-horse-9", "display_name": "Asha"})
    assert r.status_code == 201
    assert r.json()["user"]["email"] == "asha@example.com"
    assert "password" not in r.text.lower().replace("has_password", "")
    assert client.post("/api/auth/register", json={"email": "asha@example.com", "password": "another-pass-1", "display_name": "X"}).status_code == 409

    assert client.post("/api/auth/login", json={"email": "asha@example.com", "password": "wrong-pass"}).status_code == 401
    assert client.post("/api/auth/login", json={"email": "nobody@example.com", "password": "wrong-pass"}).json()["error"]["message"] == "Email or password is incorrect."
    tokens = client.post("/api/auth/login", json={"email": "asha@example.com", "password": "correct-horse-9"}).json()

    old = tokens["refresh_token"]
    # Rotation: the old token is exchanged for a new one.
    lost = client.post("/api/auth/refresh", json={"refresh_token": old})
    assert lost.status_code == 200
    # The reply never reached the phone, so it presents the old token again: it is NOT signed
    # out; it gets a fresh token and the undelivered one stops working.
    again = client.post("/api/auth/refresh", json={"refresh_token": old})
    assert again.status_code == 200
    assert client.post("/api/auth/refresh", json={"refresh_token": lost.json()["refresh_token"]}).status_code == 401
    # The phone uses its new token normally...
    newer = client.post("/api/auth/refresh", json={"refresh_token": again.json()["refresh_token"]})
    assert newer.status_code == 200
    # ...so the old token showing up now means two holders: the whole session is ended (theft).
    assert client.post("/api/auth/refresh", json={"refresh_token": old}).status_code == 401
    assert client.post("/api/auth/refresh", json={"refresh_token": newer.json()["refresh_token"]}).status_code == 401

    t2 = client.post("/api/auth/login", json={"email": "asha@example.com", "password": "correct-horse-9"}).json()
    assert client.post("/api/auth/logout", json={"refresh_token": t2["refresh_token"]}).status_code == 204
    assert client.post("/api/auth/refresh", json={"refresh_token": t2["refresh_token"]}).status_code == 401


def test_requires_auth_and_rejects_bad_tokens(client):
    assert client.get("/api/me").status_code == 401
    assert client.get("/api/me", headers={"Authorization": "Bearer nonsense"}).status_code == 401
    assert client.get("/api/groups", headers={"Authorization": "Basic abc"}).status_code == 401


def test_validation_errors_have_one_shape(make_user, client):
    r = client.post("/api/auth/register", json={"email": "not-an-email", "password": "short", "display_name": ""})
    assert r.status_code == 422
    err = r.json()["error"]
    assert err["code"] == "validation_error" and {d["field"] for d in err["details"]} >= {"email", "password"}
    a = make_user("Asha")
    g = a.post("/groups", {"name": "Flat"}).json()
    bad = expense_body(g["my_member_id"], [item("x", "Milk", -5, [g["my_member_id"]])])
    assert a.post(f"/groups/{g['id']}/expenses", bad).status_code == 422
    bad = expense_body(g["my_member_id"], [item("x", "Milk", 500, [g["my_member_id"]])], category="bitcoin")
    assert a.post(f"/groups/{g['id']}/expenses", bad).status_code == 422


def test_cross_group_isolation(make_user):
    a = make_user("Asha")
    eve = make_user("Eve")
    g = a.post("/groups", {"name": "Flat", "members": [{"display_name": "Bina"}]}).json()
    me = g["my_member_id"]
    bina = next(m["id"] for m in g["members"] if m["display_name"] == "Bina")
    e = a.post(f"/groups/{g['id']}/expenses?finalize=true", expense_body(me, [item("x", "Rent", 50000, [me, bina])])).json()
    rep = a.post("/repayments", {"group_id": g["id"], "currency": "INR", "amount_minor": 100,
                                 "mode": "request", "other_member_id": bina}).json()

    # Eve guesses every identifier: all 404, never 403 (no existence leak).
    for url in (f"/groups/{g['id']}", f"/groups/{g['id']}/balances", f"/groups/{g['id']}/expenses",
                f"/expenses/{e['id']}", f"/repayments/{rep['id']}",
                f"/groups/{g['id']}/members/{bina}/ledger"):
        assert eve.get(url).status_code == 404, url
    assert eve.put(f"/expenses/{e['id']}", {**expense_body(me, []), "expected_version": 1}).status_code == 404
    assert eve.post(f"/expenses/{e['id']}/cancel", {"expected_version": e["version"]}).status_code == 404
    assert eve.post(f"/repayments/{rep['id']}/actions", {"action": "cancel"}).status_code == 404
    assert eve.post(f"/groups/{g['id']}/members", {"display_name": "Mallory"}).status_code == 404
    assert eve.post("/repayments", {"group_id": g["id"], "currency": "INR", "amount_minor": 1,
                                    "mode": "record", "other_member_id": bina}).status_code == 404
    assert eve.get(f"/activity?group_id={g['id']}").status_code == 404

    # Eve can't smuggle Asha's members into her own group's expense.
    eg = eve.post("/groups", {"name": "Eve's"}).json()
    r = eve.post(f"/groups/{eg['id']}/expenses", expense_body(eg["my_member_id"], [item("x", "Y", 100, [bina])]))
    assert r.status_code == 422 and r.json()["error"]["code"] == "unknown_member"
    r = eve.post(f"/groups/{eg['id']}/expenses", expense_body(bina, [item("x", "Y", 100, [eg["my_member_id"]])]))
    assert r.status_code == 422
    # Lists only show Eve's own data.
    assert eve.get("/expenses").json()["items"] == []
    assert all(x["id"] != g["id"] for x in eve.get("/groups").json())


def test_member_permissions(make_user):
    a = make_user("Asha")
    b = make_user("Bina")
    g = a.post("/groups", {"name": "Flat", "members": [{"display_name": "Chirag"}]}).json()
    code = a.post(f"/groups/{g['id']}/invites").json()["code"]
    gb = b.post(f"/invites/{code}/accept", {}).json()
    chirag = next(m["id"] for m in g["members"] if m["display_name"] == "Chirag")
    # A plain member can't remove others or edit the group.
    assert b.delete(f"/groups/{g['id']}/members/{chirag}").status_code == 403
    assert b.patch(f"/groups/{g['id']}", {"name": "Mine"}).status_code == 403
    # Bina's expense can only be edited/cancelled by Bina or an admin.
    e = b.post(f"/groups/{g['id']}/expenses?finalize=true",
               expense_body(gb["my_member_id"], [item("x", "Soap", 10000, [gb["my_member_id"], chirag])])).json()
    c = make_user("Chirag")
    code2 = a.post(f"/groups/{g['id']}/invites", {"member_id": chirag}).json()["code"]
    assert c.post(f"/invites/{code2}/accept", {}).status_code == 200
    assert c.post(f"/expenses/{e['id']}/cancel", {"expected_version": e["version"]}).status_code == 403
    # Chirag owes money, so he can't be removed yet.
    r = a.delete(f"/groups/{g['id']}/members/{chirag}")
    assert r.status_code == 409 and r.json()["error"]["code"] == "member_not_settled"
    # Owner can cancel; then Chirag is settled and can leave.
    assert a.post(f"/expenses/{e['id']}/cancel", {"expected_version": e["version"]}).status_code == 200
    assert c.delete(f"/groups/{g['id']}/members/{chirag}").status_code == 204
    assert c.get(f"/groups/{g['id']}").status_code == 404


def test_google_sign_in_with_mocked_verifier(client):
    assert client.post("/api/auth/google", json={"id_token": "x" * 20}).json()["error"]["code"] == "google_not_configured"

    def fake(token):
        if token == "good-token-123":
            return GoogleIdentity(sub="g-1", email="gg@example.com", email_verified=True, name="Gita")
        return None

    set_verifier(fake)
    try:
        r = client.post("/api/auth/google", json={"id_token": "good-token-123"})
        assert r.status_code == 200 and r.json()["user"]["display_name"] == "Gita"
        assert r.json()["user"]["has_google"] is True
        assert client.post("/api/auth/google", json={"id_token": "forged-token-1"}).status_code == 401
        # Same Google account signs in to the same user.
        again = client.post("/api/auth/google", json={"id_token": "good-token-123"}).json()
        assert again["user"]["id"] == r.json()["user"]["id"]
    finally:
        set_verifier(verify_with_google)


def test_export_and_delete_account(make_user, client):
    a = make_user("Asha")
    b = make_user("Bina")
    g = a.post("/groups", {"name": "Trip"}).json()
    code = a.post(f"/groups/{g['id']}/invites").json()["code"]
    bina = b.post(f"/invites/{code}/accept", {}).json()["my_member_id"]
    a.post(f"/groups/{g['id']}/expenses?finalize=true",
           expense_body(g["my_member_id"], [item("x", "Tickets", 40000, [g["my_member_id"], bina])]))
    data = b.get("/me/export").json()
    assert data["profile"]["email"] == b.email and data["my_shares"][0]["my_share_minor"] == 20000

    assert b.post("/me/delete", {"confirm": "DELETE", "password": "wrong"}).status_code == 403
    assert b.post("/me/delete", {"confirm": "DELETE", "password": "correct-horse-9"}).status_code == 204
    assert b.get("/me").status_code == 401
    assert client.post("/api/auth/login", json={"email": b.email, "password": "correct-horse-9"}).status_code == 401
    # Asha's ledger is intact; Bina now shows as "Deleted user".
    bal = a.get(f"/groups/{g['id']}/balances").json()["balances"][0]
    assert bal["total_check_minor"] == 0
    assert {x["member"]["display_name"]: x["net_minor"] for x in bal["members"]} == {"Asha": 20000, "Deleted user": -20000}


def test_production_refuses_default_secrets(monkeypatch):
    from app.core.config import Settings

    s = Settings(_env_file=None, env="production", database_url="sqlite:///x.db")  # ignore a local .env
    try:
        s.check_production_safety()
        raise AssertionError("should refuse")
    except RuntimeError as exc:
        assert "SPLITMATE_JWT_SECRET" in str(exc)


def test_single_device_login_kicks_the_previous_device(make_user):
    a = make_user("Asha")  # device 1 (signed in at register time)
    # Device 2 signs in with the same account...
    second = a.client.post("/api/auth/login", json={"email": a.email, "password": "correct-horse-9"}).json()
    # ...so device 1's access token dies immediately...
    r = a.client.get("/api/me", headers={"Authorization": f"Bearer {a.token}"})
    assert r.status_code == 401 and r.json()["error"]["code"] == "signed_in_elsewhere"
    # ...and its refresh token can't sign back in.
    assert a.client.post("/api/auth/refresh", json={"refresh_token": a.refresh}).status_code == 401
    # Device 2 works, and refreshing keeps its own session alive (no epoch bump on refresh).
    assert a.client.get("/api/me", headers={"Authorization": f"Bearer {second['access_token']}"}).status_code == 200
    r = a.client.post("/api/auth/refresh", json={"refresh_token": second["refresh_token"]})
    assert r.status_code == 200
    refreshed = {"Authorization": f"Bearer {r.json()['access_token']}"}
    assert a.client.get("/api/me", headers=refreshed).status_code == 200
    # Device 3 signs in: device 2 is kicked the same way.
    third = a.client.post("/api/auth/login", json={"email": a.email, "password": "correct-horse-9"}).json()
    assert a.client.get("/api/me", headers=refreshed).status_code == 401
    assert a.client.get("/api/me", headers={"Authorization": f"Bearer {third['access_token']}"}).status_code == 200


def test_google_sign_in_kicks_the_previous_device(client):
    def fake(token):
        if token == "good-token-123":
            return GoogleIdentity(sub="g-1", email="gg@example.com", email_verified=True, name="Gita")
        return None

    set_verifier(fake)
    try:
        first = client.post("/api/auth/google", json={"id_token": "good-token-123"}).json()
        second = client.post("/api/auth/google", json={"id_token": "good-token-123"}).json()
        assert second["user"]["id"] == first["user"]["id"]
        assert client.get("/api/me", headers={"Authorization": f"Bearer {first['access_token']}"}).status_code == 401
        assert client.post("/api/auth/refresh", json={"refresh_token": first["refresh_token"]}).status_code == 401
        assert client.get("/api/me", headers={"Authorization": f"Bearer {second['access_token']}"}).status_code == 200
    finally:
        set_verifier(verify_with_google)
