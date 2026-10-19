"""Usernames: friends can find each other and be added to a group directly."""


def _group(owner):
    r = owner.post("/groups", {"name": "Flat", "type": "home", "currency": "INR", "members": []})
    assert r.status_code == 201, r.text
    return r.json()


def test_new_accounts_get_a_unique_username(make_user):
    a = make_user("Asha Rao")
    b = make_user("Asha Rao")
    assert a.user["username"] == "asha_rao"
    assert b.user["username"].startswith("asha_rao") and b.user["username"] != "asha_rao"


def test_change_username_rules(make_user):
    a = make_user("Asha")
    b = make_user("Bina")
    assert a.patch("/me", {"username": "@Asha.R"}).json()["username"] == "asha.r"
    assert b.patch("/me", {"username": "asha.r"}).status_code == 409
    assert b.patch("/me", {"username": "_bad"}).status_code == 422
    assert b.patch("/me", {"username": "has space"}).status_code == 422


def test_lookup_is_exact_match_only(make_user):
    a = make_user("Asha")
    b = make_user("Bina Shah")
    r = a.get(f"/users/by-username/@{b.user['username'].upper()}")
    assert r.status_code == 200
    assert r.json() == {"username": b.user["username"], "display_name": "Bina Shah", "avatar_hue": b.user["avatar_hue"]}
    assert a.get("/users/by-username/bina").status_code == 404


def test_add_member_by_username_joins_them_directly(make_user):
    a = make_user("Asha")
    b = make_user("Bina")
    g = _group(a)
    r = a.post(f"/groups/{g['id']}/members", {"username": b.user["username"]})
    assert r.status_code == 201, r.text
    m = r.json()
    assert m["is_registered"] and m["display_name"] == "Bina" and m["username"] == b.user["username"]
    # The group now shows up for Bina without any invite.
    assert any(x["id"] == g["id"] for x in b.get("/groups").json())
    assert a.post(f"/groups/{g['id']}/members", {"username": b.user["username"]}).status_code == 409
    assert a.post(f"/groups/{g['id']}/members", {"username": "nobody_here"}).status_code == 404
    assert a.post(f"/groups/{g['id']}/members", {}).status_code == 422


def test_invite_link_and_landing_page(make_user, client):
    a = make_user("Asha")
    g = _group(a)
    inv = a.post(f"/groups/{g['id']}/invites").json()
    assert inv["link"].endswith(f"/i/{inv['code']}") and inv["link"] in inv["share_text"]
    page = client.get(f"/i/{inv['code']}")
    assert page.status_code == 200 and f"splitmate://join/{inv['code']}" in page.text
    assert client.get("/i/<script>").status_code == 404


def test_original_upi_qr_is_kept_and_shared(make_user):
    a = make_user("Asha")
    b = make_user("Bina")
    qr = "upi://pay?pa=asha.rao@okhdfc&pn=Asha%20Rao&mc=0000&mode=02&purpose=00&sign=AbC123"
    me = a.patch("/me", {"upi_id": "asha.rao@okhdfc", "upi_qr": qr}).json()
    assert me["upi_qr"] == qr  # stored exactly, not rebuilt
    g = _group(a)
    a.post(f"/groups/{g['id']}/members", {"username": b.user["username"]})
    seen = {m["display_name"]: m for m in b.get(f"/groups/{g['id']}").json()["members"]}
    assert seen["Asha"]["upi_qr"] == qr and seen["Asha"]["upi_id"] == "asha.rao@okhdfc"
    # Changing the UPI ID drops a QR that pays a different ID.
    assert a.patch("/me", {"upi_id": "asha@ybl"}).json()["upi_qr"] is None
    assert a.patch("/me", {"upi_qr": "https://evil.example"}).status_code == 422


def test_split_with_people_reuses_the_same_group(make_user):
    a = make_user("Asha")
    b = make_user("Bina")
    c = make_user("Chirag")
    body = {"name": "Bina", "type": "friends", "currency": "INR", "members": [{"username": b.user["username"]}]}
    g1 = a.post("/groups/with-people", body)
    assert g1.status_code == 200, g1.text
    names = sorted(m["display_name"] for m in g1.json()["members"])
    assert names == ["Asha", "Bina"] and all(m["is_registered"] for m in g1.json()["members"])
    # Same people again: the same group, so balances between them stay in one place.
    assert a.post("/groups/with-people", body).json()["id"] == g1.json()["id"]
    # Different people: a new group. Bina sees both in her list straight away.
    g2 = a.post("/groups/with-people", dict(body, name="Bina & Chirag",
                members=[{"username": b.user["username"]}, {"username": c.user["username"]}])).json()
    assert g2["id"] != g1.json()["id"]
    assert {g["id"] for g in b.get("/groups").json()} >= {g1.json()["id"], g2["id"]}
    # People you share a group with are offered next time.
    assert [p["username"] for p in a.get("/me/people").json()] == [b.user["username"], c.user["username"]]
    # Names of people not on SplitMate always get a fresh group; unknown usernames are refused.
    assert a.post("/groups/with-people", dict(body, members=[{"display_name": "Ravi"}])).status_code == 200
    assert a.post("/groups/with-people", dict(body, members=[{"username": "nobody_here"}])).status_code == 404
    assert a.post("/groups/with-people", dict(body, members=[])).status_code == 422
