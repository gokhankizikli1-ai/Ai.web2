# coding: utf-8
"""
Tests — PR #525 §7 config validation strengthening (authored, NOT executed here).

Verifies that selecting Polar as the provider tightens validation WITHOUT touching
the Lemon path, and that an unknown provider / a non-ready Polar production config
fail closed. Uses the same `monkeypatch.setattr(settings, ...)` pattern as the
existing validate_runtime tests (Config fields are class attributes).

Cases:
    1.  BILLING_PROVIDER unset/lemon → no Polar-specific criticals (Lemon untouched)
    2.  BILLING_PROVIDER=polar + ENABLE_BILLING on + no webhook secret → critical
    3.  BILLING_PROVIDER=polar + ENABLE_BILLING off → critical
    4.  BILLING_PROVIDER=polar + ENABLE_BILLING_CHECKOUT off → critical
    5.  BILLING_PROVIDER=unknown → critical (never silent lemon)
    6.  BILLING_PROVIDER=polar + POLAR_SERVER=production + not ready → critical (fail closed)
"""
from __future__ import annotations

import pytest


def _crits(issues):
    return [m for lvl, m in issues if lvl == "critical"]


def test_lemon_path_has_no_polar_criticals(monkeypatch):
    from backend.core.config import settings
    monkeypatch.setattr(settings, "BILLING_PROVIDER", "lemon_squeezy")
    issues = settings.validate_runtime()
    assert not any("polar" in m.lower() for m in _crits(issues))


def test_polar_selected_requires_webhook_secret(monkeypatch):
    from backend.core.config import settings
    monkeypatch.setattr(settings, "BILLING_PROVIDER", "polar")
    monkeypatch.setattr(settings, "ENABLE_BILLING", True)
    monkeypatch.setattr(settings, "POLAR_WEBHOOK_SECRET", "")
    issues = settings.validate_runtime()
    assert any("POLAR_WEBHOOK_SECRET" in m for m in _crits(issues))


def test_polar_selected_requires_billing_enabled(monkeypatch):
    from backend.core.config import settings
    monkeypatch.setattr(settings, "BILLING_PROVIDER", "polar")
    monkeypatch.setattr(settings, "ENABLE_BILLING", False)
    issues = settings.validate_runtime()
    assert any("ENABLE_BILLING is off" in m for m in _crits(issues))


def test_polar_selected_requires_checkout_enabled(monkeypatch):
    from backend.core.config import settings
    monkeypatch.setattr(settings, "BILLING_PROVIDER", "polar")
    monkeypatch.setattr(settings, "ENABLE_BILLING", True)
    monkeypatch.setattr(settings, "ENABLE_BILLING_CHECKOUT", False)
    issues = settings.validate_runtime()
    assert any("ENABLE_BILLING_CHECKOUT is off" in m for m in _crits(issues))


def test_unknown_provider_is_critical(monkeypatch):
    from backend.core.config import settings
    monkeypatch.setattr(settings, "BILLING_PROVIDER", "stripe")
    issues = settings.validate_runtime()
    assert any("unknown value" in m for m in _crits(issues))


def test_polar_production_not_ready_fails_closed(monkeypatch):
    from backend.core.config import settings
    monkeypatch.setattr(settings, "BILLING_PROVIDER", "polar")
    monkeypatch.setattr(settings, "ENABLE_BILLING", True)
    monkeypatch.setattr(settings, "ENABLE_BILLING_CHECKOUT", True)
    monkeypatch.setattr(settings, "POLAR_SERVER", "production")
    # No product mapping / variants configured → readiness gate is not green.
    issues = settings.validate_runtime()
    assert any("readiness gate is NOT green" in m or "LIVE provider" in m for m in _crits(issues))
