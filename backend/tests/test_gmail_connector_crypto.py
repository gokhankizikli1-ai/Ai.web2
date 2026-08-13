# coding: utf-8
"""Gmail connector — credential-at-rest encryption.

The native AES backend is unavailable in CI (documented in requirements.txt), so
the round-trip is exercised through the injectable reversible test cipher; the
fail-closed + envelope + tamper-rejection logic is the module's own
responsibility and is what these tests assert.
"""
from __future__ import annotations

import pytest

from backend.services.gmail import crypto as gm_crypto
from backend.services.gmail.errors import CredentialEncryptionError


@pytest.fixture()
def test_cipher(monkeypatch):
    monkeypatch.delenv("KORVIX_CREDENTIAL_ENCRYPTION_KEY", raising=False)
    gm_crypto.set_cipher_for_tests(gm_crypto._ReversibleTestCipher())
    yield
    gm_crypto.set_cipher_for_tests(None)


def test_roundtrip(test_cipher):
    secret = "1//refresh-token-value"
    env = gm_crypto.encrypt(secret)
    assert env.startswith("f1:")
    assert secret not in env  # ciphertext body must not contain the plaintext
    assert gm_crypto.decrypt(env) == secret


def test_is_configured_true_with_injected_cipher(test_cipher):
    assert gm_crypto.is_configured() is True


def test_fail_closed_when_unconfigured(monkeypatch):
    monkeypatch.delenv("KORVIX_CREDENTIAL_ENCRYPTION_KEY", raising=False)
    gm_crypto.set_cipher_for_tests(None)
    gm_crypto.set_cipher_provider_for_tests(None)
    assert gm_crypto.is_configured() is False
    with pytest.raises(CredentialEncryptionError):
        gm_crypto.encrypt("secret")
    with pytest.raises(CredentialEncryptionError):
        gm_crypto.decrypt("f1:whatever")


def test_decrypt_refuses_non_envelope(test_cipher):
    # A plaintext value (no scheme prefix) must be refused, never returned as-is.
    with pytest.raises(CredentialEncryptionError):
        gm_crypto.decrypt("plaintext-refresh-token")


def test_decrypt_rejects_tampered_ciphertext(test_cipher):
    env = gm_crypto.encrypt("secret")
    tampered = env[:-3] + ("aaa" if not env.endswith("aaa") else "bbb")
    with pytest.raises(CredentialEncryptionError):
        gm_crypto.decrypt(tampered)


def test_is_envelope():
    assert gm_crypto.is_envelope("f1:abc") is True
    assert gm_crypto.is_envelope("plain") is False
    assert gm_crypto.is_envelope("") is False
    assert gm_crypto.is_envelope(None) is False
