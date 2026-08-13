# coding: utf-8
"""Credential-at-rest encryption for the Gmail connector.

WHY THIS EXISTS
---------------
Unlike the GitHub connector (which mints short-lived installation tokens on the
fly and persists NOTHING), a Gmail OAuth connection must durably store a
long-lived **refresh token**. That secret must never touch disk in plaintext:
a leaked `projects.db` must not yield a live Google credential.

There is no pre-existing secret-at-rest mechanism in this repo (audited), so
this is the minimum defensible one. It is deliberately small and delegates the
actual authenticated encryption to a vetted primitive rather than rolling its
own.

CONTRACT
--------
* PRIMITIVE — `cryptography.fernet` (AES-128-CBC + HMAC-SHA256, authenticated,
  URL-safe, timestamped). `MultiFernet` is used so keys can be ROTATED: the
  key is `KORVIX_CREDENTIAL_ENCRYPTION_KEY`, optionally comma-separated — the
  FIRST key encrypts, ALL keys are tried on decrypt.
* FAIL CLOSED — if no key is configured, or the key is unparseable, or the
  crypto backend is unavailable, `encrypt`/`decrypt` raise
  `CredentialEncryptionError`. There is NO plaintext fallback, ever.
* ENVELOPE — ciphertext is stored with a `f1:` scheme prefix so a value can be
  recognised as encrypted (and future schemes distinguished). A stored value
  lacking the prefix is refused by `decrypt` rather than returned as-is.
* NO SECRETS LOGGED — the key, plaintext, and ciphertext are never logged.

LAZY IMPORT
-----------
`cryptography` is imported inside the builder (mirroring
`github.auth.mint_app_jwt`) so this module is importable where the native
crypto backend is unavailable. Tests that exercise the connection/token
lifecycle inject a fake cipher via `set_cipher_provider_for_tests` so they
never require the native backend; the real Fernet path is covered by a
backend-gated unit test.
"""
from __future__ import annotations

import logging
from typing import Callable, List, Optional

from backend.services.gmail import config as gm_config
from backend.services.gmail.errors import CredentialEncryptionError

logger = logging.getLogger(__name__)

# Scheme prefix marking a value produced by this module. Bump on a format change.
_SCHEME = "f1:"


class _Cipher:
    """Minimal AEAD interface: bytes -> bytes and back. The production impl
    wraps MultiFernet; tests inject a deterministic reversible fake."""

    def encrypt(self, data: bytes) -> bytes:  # pragma: no cover - interface
        raise NotImplementedError

    def decrypt(self, token: bytes) -> bytes:  # pragma: no cover - interface
        raise NotImplementedError


# Optional test override. None in production. When set, it takes precedence over
# the env-derived Fernet cipher so lifecycle tests never need the native backend.
_CIPHER_OVERRIDE: Optional[_Cipher] = None
_CIPHER_PROVIDER_OVERRIDE: Optional[Callable[[], Optional[_Cipher]]] = None


def _parse_keys(raw: str) -> List[str]:
    """Split the env value into individual key strings (comma-separated for
    rotation). Blank entries are dropped."""
    return [k.strip() for k in (raw or "").split(",") if k.strip()]


class _FernetCipher(_Cipher):
    def __init__(self, multifernet):
        self._mf = multifernet

    def encrypt(self, data: bytes) -> bytes:
        return self._mf.encrypt(data)

    def decrypt(self, token: bytes) -> bytes:
        return self._mf.decrypt(token)


def _build_fernet_cipher() -> _Cipher:
    """Build a MultiFernet cipher from the configured key(s). Raises
    CredentialEncryptionError when unconfigured, unparseable, or when the crypto
    backend is unavailable — always fail closed."""
    keys = _parse_keys(gm_config.encryption_keys_raw())
    if not keys:
        raise CredentialEncryptionError(
            "KORVIX_CREDENTIAL_ENCRYPTION_KEY is not configured — refusing to "
            "handle a refresh token without encryption at rest."
        )
    try:
        from cryptography.fernet import Fernet, MultiFernet  # lazy
        fernets = [Fernet(k.encode("utf-8") if isinstance(k, str) else k) for k in keys]
        return _FernetCipher(MultiFernet(fernets))
    except CredentialEncryptionError:  # pragma: no cover - defensive
        raise
    except Exception as exc:
        # A malformed key or missing native backend is a configuration fault,
        # not a transient one — retrying won't help. Never echo the key/exc
        # detail that could leak key material.
        raise CredentialEncryptionError(
            f"Credential encryption unavailable: {type(exc).__name__}"
        ) from exc


def _cipher() -> _Cipher:
    if _CIPHER_OVERRIDE is not None:
        return _CIPHER_OVERRIDE
    if _CIPHER_PROVIDER_OVERRIDE is not None:
        c = _CIPHER_PROVIDER_OVERRIDE()
        if c is not None:
            return c
    return _build_fernet_cipher()


def is_configured() -> bool:
    """True iff credential encryption can be performed right now (a test cipher
    is injected, or at least one env key parses into a usable Fernet). Never
    raises — used by readiness checks / the connect route's fail-closed gate."""
    if _CIPHER_OVERRIDE is not None or _CIPHER_PROVIDER_OVERRIDE is not None:
        return True
    if not _parse_keys(gm_config.encryption_keys_raw()):
        return False
    try:
        _build_fernet_cipher()
        return True
    except CredentialEncryptionError:
        return False


def encrypt(plaintext: str) -> str:
    """Encrypt a secret string for storage. Returns a `f1:`-prefixed envelope.
    Raises CredentialEncryptionError when encryption is unavailable (fail
    closed — a refresh token is NEVER stored in plaintext)."""
    if plaintext is None:
        raise CredentialEncryptionError("cannot encrypt None")
    token = _cipher().encrypt(str(plaintext).encode("utf-8"))
    token_str = token.decode("utf-8") if isinstance(token, (bytes, bytearray)) else str(token)
    return _SCHEME + token_str


def decrypt(envelope: str) -> str:
    """Decrypt a `f1:`-prefixed envelope produced by `encrypt`. Raises
    CredentialEncryptionError on a missing prefix, tamper/auth failure, or when
    the key is unavailable. A value without the scheme prefix is refused rather
    than returned as-is, so a plaintext leak can never be silently 'decrypted'
    into itself."""
    if not envelope or not str(envelope).startswith(_SCHEME):
        raise CredentialEncryptionError("value is not an encrypted credential envelope")
    body = str(envelope)[len(_SCHEME):]
    try:
        plain = _cipher().decrypt(body.encode("utf-8"))
    except CredentialEncryptionError:
        raise
    except Exception as exc:
        raise CredentialEncryptionError(
            f"Credential decryption failed: {type(exc).__name__}"
        ) from exc
    return plain.decode("utf-8") if isinstance(plain, (bytes, bytearray)) else str(plain)


def is_envelope(value: Optional[str]) -> bool:
    """True iff `value` looks like one of our encrypted envelopes."""
    return bool(value) and str(value).startswith(_SCHEME)


# ── test seams ───────────────────────────────────────────────────────────────

def set_cipher_provider_for_tests(provider: Optional[Callable[[], Optional[_Cipher]]]) -> None:
    """Install (or clear with None) a cipher provider for tests, so the token
    lifecycle can be exercised without the native crypto backend. Production
    never calls this."""
    global _CIPHER_PROVIDER_OVERRIDE
    _CIPHER_PROVIDER_OVERRIDE = provider


def set_cipher_for_tests(cipher: Optional[_Cipher]) -> None:
    """Install (or clear with None) a concrete cipher for tests."""
    global _CIPHER_OVERRIDE
    _CIPHER_OVERRIDE = cipher


class _ReversibleTestCipher(_Cipher):
    """A deterministic, authenticated, reversible cipher for tests ONLY — NOT
    secure, never used in production. Base64 body + an HMAC tag so decrypt still
    rejects tampering (proving the store/lifecycle logic treats auth failures
    correctly) without needing the native AES backend."""

    def __init__(self, key: bytes = b"test-key"):
        self._key = key

    def encrypt(self, data: bytes) -> bytes:
        import base64
        import hmac
        import hashlib
        body = base64.urlsafe_b64encode(data)
        tag = hmac.new(self._key, body, hashlib.sha256).hexdigest()[:16].encode("ascii")
        return tag + b"." + body

    def decrypt(self, token: bytes) -> bytes:
        import base64
        import hmac
        import hashlib
        tag, _, body = token.partition(b".")
        expect = hmac.new(self._key, body, hashlib.sha256).hexdigest()[:16].encode("ascii")
        if not hmac.compare_digest(tag, expect):
            raise ValueError("bad tag")
        return base64.urlsafe_b64decode(body)


__all__ = [
    "is_configured", "encrypt", "decrypt", "is_envelope",
    "set_cipher_provider_for_tests", "set_cipher_for_tests",
    "_ReversibleTestCipher",
]
