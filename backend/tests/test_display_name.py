# coding: utf-8
"""
Editable display name - validation + authenticated update route (PATCH /auth/me).

Exercises the real app via TestClient (no network / OpenAI key). Covers Unicode/
Turkish acceptance, trimming, control-char stripping, empty/overlong rejection,
self-only editing (id from the token, never the body), no mass assignment of
email/role, refresh persistence, and double-submit stability.
"""
from __future__ import annotations

import pytest

from backend.services.auth.display_name import normalize_display_name, MAX_DISPLAY_NAME_CHARS


# -- Pure validation ------------------------------------------------------------
def test_normalize_accepts_turkish_and_unicode():
    ok, val = normalize_display_name("İlayda Şöföroğlu")
    assert ok and val == "İlayda Şöföroğlu"
    ok2, val2 = normalize_display_name("日本語 名前")
    assert ok2 and val2 == "日本語 名前"


def test_normalize_trims_and_collapses_whitespace():
    ok, val = normalize_display_name("   Ada   Lovelace   ")
    assert ok and val == "Ada Lovelace"


def test_normalize_strips_control_chars():
    # tab + newline collapse to a single space; NUL + zero-width space are stripped.
    raw = "Ada \tLove\nlace​\x00"
    ok, val = normalize_display_name(raw)
    assert ok and val == "Ada Lovelace"


@pytest.mark.parametrize("bad", ["", "   ", "\t\n", " ", 123, None, {"x": 1}])
def test_normalize_rejects_empty_or_nonstring(bad):
    ok, err = normalize_display_name(bad)
    assert ok is False
    assert err in ("empty", "invalid")


def test_normalize_rejects_overlong():
    ok, err = normalize_display_name("x" * (MAX_DISPLAY_NAME_CHARS + 1))
    assert ok is False and err == "too_long"
    ok2, val2 = normalize_display_name("x" * MAX_DISPLAY_NAME_CHARS)
    assert ok2 and len(val2) == MAX_DISPLAY_NAME_CHARS


# -- Route (authenticated PATCH /auth/me) ---------------------------------------
@pytest.fixture()
def pw_db(tmp_auth_db, monkeypatch):
    from backend.services.auth import passwords
    monkeypatch.setattr(passwords, "_INITIALIZED", False, raising=False)
    yield tmp_auth_db


def _signup(client, email="dn@example.com", pw="supersecret1"):
    r = client.post("/auth/signup", json={"email": email, "password": pw, "display_name": "Original"})
    assert r.status_code == 201, r.text
    return r.json()["access_token"]


def _auth(token):
    return {"Authorization": f"Bearer {token}"}


def test_update_display_name_ok_and_persists(client, pw_db):
    token = _signup(client)
    r = client.patch("/auth/me", headers=_auth(token), json={"display_name": "  Ada Lovelace  "})
    assert r.status_code == 200, r.text
    assert r.json()["user"]["display_name"] == "Ada Lovelace"
    me = client.get("/auth/me", headers=_auth(token))
    assert me.json()["user"]["display_name"] == "Ada Lovelace"


def test_update_accepts_turkish(client, pw_db):
    token = _signup(client)
    name = "Gökhan Çağrı"
    r = client.patch("/auth/me", headers=_auth(token), json={"display_name": name})
    assert r.status_code == 200
    assert r.json()["user"]["display_name"] == name


def test_update_rejects_empty(client, pw_db):
    token = _signup(client)
    r = client.patch("/auth/me", headers=_auth(token), json={"display_name": "   "})
    assert r.status_code == 422
    assert r.json()["detail"]["code"] == "invalid_display_name"
    assert client.get("/auth/me", headers=_auth(token)).json()["user"]["display_name"] == "Original"


def test_update_rejects_overlong(client, pw_db):
    token = _signup(client)
    r = client.patch("/auth/me", headers=_auth(token), json={"display_name": "n" * 200})
    assert r.status_code == 422


def test_unauthenticated_rejected(client, pw_db):
    r = client.patch("/auth/me", json={"display_name": "Whoever"})
    assert r.status_code == 401


def test_cannot_mass_assign_email_or_role(client, pw_db):
    token = _signup(client)
    r = client.patch("/auth/me", headers=_auth(token), json={
        "display_name": "Safe Name", "email": "attacker@evil.com", "role": "admin",
        "is_owner": True, "plan": "enterprise", "id": "someone-else",
    })
    assert r.status_code == 200
    body = r.json()["user"]
    assert body["display_name"] == "Safe Name"
    assert body["email"] == "dn@example.com"
    assert body.get("is_owner") in (False, None)


def test_double_submit_is_stable(client, pw_db):
    token = _signup(client)
    a = client.patch("/auth/me", headers=_auth(token), json={"display_name": "Twice"})
    b = client.patch("/auth/me", headers=_auth(token), json={"display_name": "Twice"})
    assert a.status_code == 200 and b.status_code == 200
    assert b.json()["user"]["display_name"] == "Twice"
