# coding: utf-8
"""Google Calendar connector — runtime configuration (live-read).

MIRRORS THE GMAIL / VERCEL / GITHUB CONFIG PATTERN
--------------------------------------------------
Env vars are read live on every call so a Railway flag flip is effective without
a restart. The canonical names + defaults are ALSO declared in
`backend.core.config.Config` for discoverability + startup validation, but the
RUNTIME source of truth is here (read dynamically), matching
`gmail.config.is_enabled()` / `vercel.config.is_enabled()`.

SCOPE — read-only, minimum, EXACTLY ONE
---------------------------------------
    https://www.googleapis.com/auth/calendar.events.readonly

That scope permits reading events from the user's calendars and nothing else.
It can never create, edit, move, or delete an event, and it does not grant the
Calendars/CalendarList resources (so this connector reads the account's calendar
label + timezone from the `events.list` response body itself — see
`oauth.fetch_calendar_identity` — rather than requesting a wider scope).

SHARED GOOGLE OAUTH CLIENT — AND WHY THAT IS SAFE
-------------------------------------------------
Calendar reuses the SAME Google OAuth Web client as Gmail by default
(`GMAIL_OAUTH_CLIENT_ID` → `GOOGLE_CLIENT_ID`), because Google Cloud already has
one Web client registered for Korvix and creating a second Google auth system
is exactly what the connector architecture forbids. Isolation is preserved
because:

  * Calendar has its OWN redirect URI (`CALENDAR_OAUTH_REDIRECT_URI`, a distinct
    route), its OWN one-time state table, and its OWN connection table. A Gmail
    callback can never land on the Calendar route and vice versa.
  * Calendar requests ONLY the calendar scope and deliberately does NOT send
    `include_granted_scopes=true` (see `oauth.build_authorization_url`), so the
    Calendar refresh token never silently acquires `gmail.readonly`.
  * Each connector stores its own refresh token in its own row; neither writes
    to the other's table.
  * Remote token revocation is guarded by `backend.services.google_grant`, so
    disconnecting Calendar can never revoke the Gmail grant (Google merges
    consents per client+user into one grant).

An operator MAY set `CALENDAR_OAUTH_CLIENT_ID` / `CALENDAR_OAUTH_CLIENT_SECRET`
to give Calendar a fully separate Google client; everything keeps working and
the revoke guard then knows remote revocation is unconditionally safe.

SECRETS — the OAuth client secret and the credential-encryption key are read
here and NEVER logged, returned to the frontend, or placed in an observation.
"""
from __future__ import annotations

import os
from typing import List

# The single, minimum scope this connector requires. READ-ONLY events access.
CALENDAR_READONLY_SCOPE = "https://www.googleapis.com/auth/calendar.events.readonly"

# Google OAuth 2.0 endpoints (overridable for tests).
_DEFAULT_AUTH_ENDPOINT = "https://accounts.google.com/o/oauth2/v2/auth"
_DEFAULT_TOKEN_ENDPOINT = "https://oauth2.googleapis.com/token"
_DEFAULT_REVOKE_ENDPOINT = "https://oauth2.googleapis.com/revoke"
_DEFAULT_CALENDAR_API_BASE = "https://www.googleapis.com"

# The calendar this connector reads. "primary" is Google's alias for the
# authenticated account's own default calendar — no CalendarList scope needed.
PRIMARY_CALENDAR_ID = "primary"


def _env(name: str, default: str = "") -> str:
    return (os.getenv(name, default) or "").strip()


def _int_env(name: str, default: int, *, lo: int, hi: int) -> int:
    try:
        n = int(os.getenv(name, str(default)) or default)
    except (TypeError, ValueError):
        n = default
    return max(lo, min(n, hi))


# ── Master gate ─────────────────────────────────────────────────────────────

def is_enabled() -> bool:
    """Master kill-switch. Default OFF so merging is behaviourally inert until
    an operator flips it (matches every other connector in core.config)."""
    return _env("ENABLE_CALENDAR_CONNECTOR", "false").lower() == "true"


# ── Google OAuth client credentials ─────────────────────────────────────────

def client_id() -> str:
    """The Google OAuth Web Application client id. Prefers a Calendar-specific
    override, then the Gmail connector's client, then the shared
    GOOGLE_CLIENT_ID used by the Google *login* verifier — so a single Google
    project id is reused rather than a second Google auth system created."""
    return (_env("CALENDAR_OAUTH_CLIENT_ID") or _env("GMAIL_OAUTH_CLIENT_ID")
            or _env("GOOGLE_CLIENT_ID"))


def client_secret() -> str:
    """The Google OAuth Web Application client secret. SECRET — never logged,
    never returned to the frontend. Empty ⇒ the connector fails closed."""
    return (_env("CALENDAR_OAUTH_CLIENT_SECRET") or _env("GMAIL_OAUTH_CLIENT_SECRET")
            or _env("GOOGLE_CLIENT_SECRET"))


def shares_google_client_with_gmail() -> bool:
    """True when Calendar and Gmail resolve to the SAME Google OAuth client id.

    Read by `backend.services.google_grant` to decide whether a programmatic
    token revocation would also destroy the sibling connector's grant (Google
    merges consents per client+user). Compared case-insensitively; two blank
    ids are NOT treated as "shared" (nothing is configured, so nothing to
    protect)."""
    from backend.services.gmail import config as gm_config
    mine = client_id().lower()
    theirs = gm_config.client_id().lower()
    return bool(mine) and mine == theirs


def redirect_uri() -> str:
    """The EXACT Authorized redirect URI registered in Google Cloud for the
    CALENDAR flow.

    Read from env rather than derived from the request Host header on purpose:
    deriving redirect_uri from an attacker-controllable Host is an
    open-redirect / host-injection hazard, and Google requires an exact match
    against a pre-registered value anyway. Empty ⇒ the connector fails closed.

    The value MUST equal `<backend-public-base>/v2/calendar/oauth/callback`, and
    MUST be distinct from the Gmail redirect URI so the two flows can never be
    confused for one another.
    """
    return _env("CALENDAR_OAUTH_REDIRECT_URI")


def scopes() -> List[str]:
    """The minimum scope set requested. Read-only, single scope."""
    return [CALENDAR_READONLY_SCOPE]


def scope_param() -> str:
    """Space-delimited scope string for the authorization URL."""
    return " ".join(scopes())


# ── Frontend redirect target (safe, fixed) ──────────────────────────────────

def frontend_result_base() -> str:
    """The SPA origin the callback redirects the browser back to after the
    exchange. FIXED server-side (never taken from a query param) so the callback
    can never be turned into an open redirect. Reuses PUBLIC_APP_URL (the same
    origin Gmail/Vercel land on); a Calendar-specific override wins when set."""
    base = _env("CALENDAR_FRONTEND_RESULT_URL") or _env("PUBLIC_APP_URL", "https://korvixai.com")
    return base.rstrip("/")


def frontend_result_path() -> str:
    """The SPA route (a HashRouter fragment) the browser lands on. The final
    redirect is `<frontend_result_base><path>?calendar=connected|error&...`."""
    return _env("CALENDAR_FRONTEND_RESULT_PATH", "/#/settings/integrations")


# ── Credential-at-rest encryption ───────────────────────────────────────────

def credential_encryption_configured() -> bool:
    """True iff credential-at-rest encryption can be performed right now.
    Delegates to `gmail.crypto` — the SINGLE credential authority, keyed by
    KORVIX_CREDENTIAL_ENCRYPTION_KEY. No second key, no second cipher."""
    from backend.services.gmail import crypto as credential_crypto
    return credential_crypto.is_configured()


# ── OAuth / API endpoints (test-overridable) ────────────────────────────────

def auth_endpoint() -> str:
    return _env("CALENDAR_OAUTH_AUTH_ENDPOINT", _DEFAULT_AUTH_ENDPOINT).rstrip("/") or _DEFAULT_AUTH_ENDPOINT


def token_endpoint() -> str:
    return _env("CALENDAR_OAUTH_TOKEN_ENDPOINT", _DEFAULT_TOKEN_ENDPOINT) or _DEFAULT_TOKEN_ENDPOINT


def revoke_endpoint() -> str:
    return _env("CALENDAR_OAUTH_REVOKE_ENDPOINT", _DEFAULT_REVOKE_ENDPOINT) or _DEFAULT_REVOKE_ENDPOINT


def api_base() -> str:
    return _env("CALENDAR_API_BASE", _DEFAULT_CALENDAR_API_BASE).rstrip("/") or _DEFAULT_CALENDAR_API_BASE


# ── Bounds ──────────────────────────────────────────────────────────────────

def request_timeout_s() -> float:
    try:
        return float(os.getenv("CALENDAR_REQUEST_TIMEOUT_S", "10") or 10)
    except (TypeError, ValueError):
        return 10.0


def state_ttl_s() -> int:
    """How long an unconsumed OAuth state stays valid. Short by design — a
    consent round-trip is seconds; 10 minutes leaves headroom for a slow consent
    screen without keeping a CSRF token alive indefinitely. Clamped [60, 1800]."""
    return _int_env("CALENDAR_OAUTH_STATE_TTL_S", 600, lo=60, hi=1800)


def sync_upcoming_days() -> int:
    """How far FORWARD the bounded sync window reaches (timeMax). The product
    signal is "what is coming up for this project", so a month of lookahead is
    the useful default. Clamped [1, 180]."""
    return _int_env("CALENDAR_SYNC_UPCOMING_DAYS", 30, lo=1, hi=180)


def sync_past_days() -> int:
    """How far BACK the bounded sync window reaches (timeMin) — just enough
    recent context to know what already happened / was cancelled. Clamped
    [0, 90]. This is what keeps the connector from crawling calendar history."""
    return _int_env("CALENDAR_SYNC_PAST_DAYS", 7, lo=0, hi=90)


def sync_page_size() -> int:
    """Events requested per page (Google caps `maxResults` at 2500; we cap far
    lower). Clamped [1, 250]."""
    return _int_env("CALENDAR_SYNC_PAGE_SIZE", 50, lo=1, hi=250)


def sync_max_pages() -> int:
    """Pages followed during an INCREMENTAL (already backfilled) sync. 1 by
    default — the newest window is enough once the initial import has run.
    Clamped [1, 5]."""
    return _int_env("CALENDAR_SYNC_MAX_PAGES", 1, lo=1, hi=5)


def sync_initial_max_pages() -> int:
    """Pages followed on the FIRST sync of a connection, so a newly connected
    calendar pulls its whole bounded window in ONE click instead of forcing
    repeated "Sync now" presses — while still enforcing a hard ceiling.
    Clamped [1, 5]; default 3."""
    return _int_env("CALENDAR_SYNC_INITIAL_MAX_PAGES", 3, lo=1, hi=5)


def sync_max_events() -> int:
    """HARD result ceiling for one sync, independent of the page/pages caps —
    the final guard that makes the read BOUNDED no matter how the other knobs
    are set. Clamped [1, 500]."""
    return _int_env("CALENDAR_SYNC_MAX_EVENTS", 200, lo=1, hi=500)


def soon_hours() -> int:
    """An upcoming event starting within this many hours is treated as
    IMMINENT (importance high). Clamped [1, 168]; default 24."""
    return _int_env("CALENDAR_SOON_HOURS", 24, lo=1, hi=168)


def description_max_chars() -> int:
    """Upper bound on the event description copied into an observation payload —
    a bounded context hint, never a full note dump. 0 disables descriptions
    entirely. Clamped [0, 1000]; default 200."""
    return _int_env("CALENDAR_DESCRIPTION_MAX_CHARS", 200, lo=0, hi=1000)


def attendees_max() -> int:
    """Upper bound on the number of attendees whose bounded metadata (email +
    response status) is copied into a payload — never a full attendee dump. The
    total count is always recorded separately. 0 disables the per-attendee list.
    Clamped [0, 20]; default 5."""
    return _int_env("CALENDAR_ATTENDEES_MAX", 5, lo=0, hi=20)


# ── Readiness ───────────────────────────────────────────────────────────────

def oauth_configured() -> bool:
    """True iff the OAuth client credentials + redirect URI are present. Connect
    can only run when this holds."""
    return bool(client_id() and client_secret() and redirect_uri())


__all__ = [
    "CALENDAR_READONLY_SCOPE", "PRIMARY_CALENDAR_ID",
    "is_enabled", "client_id", "client_secret", "shares_google_client_with_gmail",
    "redirect_uri", "scopes", "scope_param", "frontend_result_base",
    "frontend_result_path", "credential_encryption_configured",
    "auth_endpoint", "token_endpoint", "revoke_endpoint", "api_base",
    "request_timeout_s", "state_ttl_s", "sync_upcoming_days", "sync_past_days",
    "sync_page_size", "sync_max_pages", "sync_initial_max_pages",
    "sync_max_events", "soon_hours", "description_max_chars", "attendees_max",
    "oauth_configured",
]
