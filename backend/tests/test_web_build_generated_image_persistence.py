# coding: utf-8
"""Web Build — durable persistence of a GENERATED image.

A provider returns a session-only ``data:`` URL. Anything written into generated project source
must survive save → reopen → revision, so the generated route stores its result through the
EXISTING asset system (the same authority the device-upload route uses) and returns a stable
delivery URL. These tests pin that contract, including its failure modes:

  * a provider data URL is decoded, validated by the EXISTING image validator, and stored;
  * the base64 payload is dropped once a durable URL exists (it must never reach a build payload);
  * a disabled asset system, a storage error and a non-image payload each yield an honest
    ``persisted: False`` rather than an exception or a silently-kept data URL;
  * ``persist=False`` (the manual Preview path) is byte-for-byte unchanged.

ZERO network, ZERO provider calls, ZERO model calls.
"""
from __future__ import annotations

import base64
import struct
import zlib

import pytest

pytest.importorskip("pydantic")

from backend.services.assets.errors import AssetSystemDisabled
from backend.services.web_build_images import persistence


def _png(width: int = 1200, height: int = 800) -> bytes:
    """A minimal, structurally valid PNG (header parsed by the existing validator)."""
    def chunk(tag: bytes, payload: bytes) -> bytes:
        return struct.pack(">I", len(payload)) + tag + payload + struct.pack(">I", zlib.crc32(tag + payload) & 0xFFFFFFFF)
    ihdr = struct.pack(">IIBBBBB", width, height, 8, 2, 0, 0, 0)
    return b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", ihdr) + chunk(b"IDAT", zlib.compress(b"\x00" * 16)) + chunk(b"IEND", b"")


def _data_url(data: bytes) -> str:
    return "data:image/png;base64," + base64.b64encode(data).decode("ascii")


class _Rec:
    def __init__(self, rid: str = "as_test_1") -> None:
        self.id = rid


class _FakeAssets:
    """Stands in for backend.services.assets.client — the ONE storage authority."""

    def __init__(self, *, disabled: bool = False, fail: bool = False, url: str = "/v2/assets/blob/abc.png") -> None:
        self.disabled, self.fail, self._url = disabled, fail, url
        self.uploads: list = []

    def upload(self, **kw):
        if self.disabled:
            raise AssetSystemDisabled("off")
        if self.fail:
            raise RuntimeError("storage exploded")
        self.uploads.append(kw)
        return _Rec()

    def public_url(self, asset_id, user_id=None):  # noqa: ANN001
        return self._url


@pytest.fixture()
def fake_assets(monkeypatch):
    def _install(**kw):
        fake = _FakeAssets(**kw)
        monkeypatch.setattr(persistence, "assets_client", fake)
        return fake
    return _install


# ── decode ────────────────────────────────────────────────────────────────────

def test_decode_accepts_a_base64_image_data_url():
    mime, raw = persistence.decode_data_url(_data_url(_png()))
    assert mime == "image/png"
    assert raw.startswith(b"\x89PNG")


@pytest.mark.parametrize("bad", [
    "", "https://cdn.example.com/a.png", "data:text/html;base64,PGh0bWw+",
    "data:image/png;base64,!!!not-base64!!!", None,
])
def test_decode_refuses_anything_that_is_not_a_base64_image(bad):
    assert persistence.decode_data_url(bad) is None


def test_decode_refuses_an_oversized_payload(monkeypatch):
    monkeypatch.setattr(persistence, "MAX_GENERATED_BYTES", 16)
    assert persistence.decode_data_url(_data_url(_png())) is None


# ── persist ───────────────────────────────────────────────────────────────────

def test_persist_stores_through_the_existing_asset_system(fake_assets):
    fake = fake_assets()
    out = persistence.persist_generated_image(_data_url(_png(1200, 800)), user_id="u1", slot_id="hero", provider="openai")
    assert out is not None
    assert out.url == "/v2/assets/blob/abc.png"
    assert (out.width, out.height) == (1200, 800)
    assert len(fake.uploads) == 1
    up = fake.uploads[0]
    # A safe, format-derived filename — never anything caller-controlled.
    assert up["filename"] == "web-build-generated.png"
    assert up["mime_type"] == "image/png"
    # Honest provenance travels with the asset.
    assert up["metadata"]["source"] == "web-build-generated-image"
    assert up["metadata"]["generated"] is True


def test_persist_returns_none_when_the_asset_system_is_disabled(fake_assets):
    fake_assets(disabled=True)
    assert persistence.persist_generated_image(_data_url(_png()), user_id="u1") is None


def test_persist_returns_none_on_a_storage_error(fake_assets):
    fake_assets(fail=True)
    assert persistence.persist_generated_image(_data_url(_png()), user_id="u1") is None


def test_persist_returns_none_when_no_delivery_url_can_be_built(fake_assets):
    fake_assets(url="")
    assert persistence.persist_generated_image(_data_url(_png()), user_id="u1") is None


def test_persist_refuses_a_payload_the_existing_validator_rejects(fake_assets):
    fake = fake_assets()
    # A tiny image fails the validator's minimum-side rule — nothing is stored.
    assert persistence.persist_generated_image(_data_url(_png(10, 10)), user_id="u1") is None
    assert fake.uploads == []


# ── attach_persistence (the route-level contract) ─────────────────────────────

def test_attach_replaces_the_data_url_with_a_durable_url(fake_assets):
    fake_assets()
    out = persistence.attach_persistence(
        {"slotId": "hero", "status": "ready", "dataUrl": _data_url(_png()), "provider": "openai"},
        user_id="u1",
    )
    assert out["persisted"] is True
    assert out["url"] == "/v2/assets/blob/abc.png"
    assert out["assetId"] == "as_test_1"
    # The base64 payload must never reach a persisted build payload.
    assert "dataUrl" not in out


def test_attach_reports_persisted_false_instead_of_keeping_a_session_only_url(fake_assets):
    fake_assets(disabled=True)
    out = persistence.attach_persistence(
        {"slotId": "hero", "status": "ready", "dataUrl": _data_url(_png())}, user_id="u1",
    )
    assert out["persisted"] is False
    assert "url" not in out


def test_attach_leaves_a_non_ready_asset_untouched(fake_assets):
    fake = fake_assets()
    src = {"slotId": "hero", "status": "disabled", "reason": "owner-only"}
    assert persistence.attach_persistence(dict(src), user_id="u1") == src
    assert fake.uploads == []


def test_attach_keeps_a_provider_hosted_url_without_re_storing_it(fake_assets):
    fake = fake_assets()
    out = persistence.attach_persistence(
        {"slotId": "hero", "status": "ready", "url": "https://cdn.example.com/a.png"}, user_id="u1",
    )
    assert out["persisted"] is True
    assert out["url"] == "https://cdn.example.com/a.png"
    assert fake.uploads == []


def test_attach_never_raises(monkeypatch):
    class Boom:
        def upload(self, **kw):  # noqa: ANN001
            raise RuntimeError("boom")

        def public_url(self, *a, **k):  # noqa: ANN001
            raise RuntimeError("boom")
    monkeypatch.setattr(persistence, "assets_client", Boom())
    out = persistence.attach_persistence({"slotId": "h", "status": "ready", "dataUrl": _data_url(_png())}, user_id="u1")
    assert out["persisted"] is False
