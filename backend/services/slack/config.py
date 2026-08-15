# coding: utf-8
"""Slack connector — runtime configuration (live-read).

MIRRORS THE GMAIL / VERCEL / CALENDAR CONFIG PATTERN
----------------------------------------------------
Env vars are read live on every call so a Railway flag flip is effective without
a restart. The canonical names + defaults are ALSO declared in
`backend.core.config.Config` for discoverability + startup validation, but the
RUNTIME source of truth is here (read dynamically), matching
`vercel.config.is_enabled()` / `google_calendar.config.is_enabled()`.

SCOPES — read-only, minimum, BOT ONLY
-------------------------------------
    channels:read     list public channels (+ their `is_member` flag)
    channels:history  read messages in public channels the bot is IN
    groups:read       list private channels the bot is IN
    groups:history    read messages in those private channels

These four are exactly what the Slack app has configured. No `chat:write`, no
`files:read`, no `users:read`, no `reactions:*`, no `im:*`, no admin scope —
so the connector could not send, edit, delete, react, invite, or read a DM even
if a caller asked it to. `user_scope` is deliberately EMPTY: Korvix stores a bot
token only, never a user token.

WHY NO `conversations.history` WITHOUT MEMBERSHIP
-------------------------------------------------
A Slack bot token can only read the history of a conversation the bot is a
MEMBER of — for public channels too. `channels:read` lets us LIST every public
channel, but `conversations.history` on a channel the bot has not been invited
to answers `not_in_channel`. The picker therefore surfaces Slack's own
`is_member` flag and selection requires it, so Korvix never claims access it
does not have (see `slack.client.get_channel` / the connect/select route).

RATE LIMITS
-----------
Slack's Web API is per-method tiered, and apps created after 2025-05-29 that are
not Slack-Marketplace-approved get a much tighter allowance on
`conversations.history` / `conversations.replies` (roughly one request per
minute, and Slack caps the returned objects regardless of `limit`). The defaults
here are therefore conservative, every bound is clamped, and the sync ABORTS on
the first 429 rather than hammering a limited workspace — a partial read is
reported truthfully and retried on the next explicit sync.

SECRETS — the OAuth client secret and the credential-encryption key are read
here and NEVER logged, returned to the frontend, or placed in an observation.
The encryption key is read through the EXISTING credential authority's env name
(`KORVIX_CREDENTIAL_ENCRYPTION_KEY`), not a Slack-specific key.
"""
from __future__ import annotations

import os
from typing import List

# The minimum BOT scopes this connector requires. READ-ONLY. This tuple is the
# single source of truth for what the authorization URL asks for; it must match
# the scopes configured on the Slack app.
BOT_SCOPES = ("channels:read", "channels:history", "groups:read", "groups:history")

# Slack endpoints (overridable for tests).
_DEFAULT_AUTHORIZE_ENDPOINT = "https://slack.com/oauth/v2/authorize"
_DEFAULT_API_BASE = "https://slack.com/api"


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
    return _env("ENABLE_SLACK_CONNECTOR", "false").lower() == "true"


# ── Slack app OAuth credentials ─────────────────────────────────────────────

def client_id() -> str:
    """The Slack app's OAuth Client ID (api.slack.com → your app → Basic
    Information). Not secret on its own."""
    return _env("SLACK_CLIENT_ID")


def client_secret() -> str:
    """The Slack app's OAuth Client Secret. SECRET — never logged, never
    returned to the frontend. Empty ⇒ the connector fails closed."""
    return _env("SLACK_CLIENT_SECRET")


def redirect_uri() -> str:
    """The EXACT Redirect URL registered on the Slack app.

    Read from env rather than derived from the request Host header on purpose:
    deriving redirect_uri from an attacker-controllable Host is an
    open-redirect / host-injection hazard, and Slack requires an exact match
    against a pre-registered value anyway. Empty ⇒ the connector fails closed.

    The value MUST equal `<backend-public-base>/v2/slack/oauth/callback`.
    """
    return _env("SLACK_OAUTH_REDIRECT_URI")


def scopes() -> List[str]:
    """The minimum BOT scope set requested. Read-only."""
    return list(BOT_SCOPES)


def scope_param() -> str:
    """Comma-delimited scope string for the authorization URL (Slack's v2 OAuth
    uses commas, not spaces)."""
    return ",".join(scopes())


def authorize_endpoint() -> str:
    return _env("SLACK_OAUTH_AUTHORIZE_ENDPOINT",
                _DEFAULT_AUTHORIZE_ENDPOINT) or _DEFAULT_AUTHORIZE_ENDPOINT


def api_base() -> str:
    """Slack Web API base. Overridable for tests."""
    return _env("SLACK_API_BASE", _DEFAULT_API_BASE).rstrip("/") or _DEFAULT_API_BASE


# ── Frontend redirect target (safe, fixed) ──────────────────────────────────

def frontend_result_base() -> str:
    """The SPA origin the callback redirects the browser back to after the
    exchange. FIXED server-side (never taken from a query param) so the callback
    can never be turned into an open redirect. Reuses PUBLIC_APP_URL (the same
    origin Gmail/Vercel/Calendar land on); a Slack-specific override wins."""
    base = _env("SLACK_FRONTEND_RESULT_URL") or _env("PUBLIC_APP_URL", "https://korvixai.com")
    return base.rstrip("/")


def frontend_result_path() -> str:
    """The SPA route (a HashRouter fragment) the browser lands on. The final
    redirect is `<frontend_result_base><path>?slack=authorized|error&...`."""
    return _env("SLACK_FRONTEND_RESULT_PATH", "/#/settings/integrations")


# ── Credential-at-rest encryption ───────────────────────────────────────────

def encryption_configured() -> bool:
    """True iff the EXISTING credential-encryption authority can encrypt right
    now. Delegates to `gmail.crypto` (the single credential authority, keyed by
    KORVIX_CREDENTIAL_ENCRYPTION_KEY) — this connector adds no second key, no
    second cipher, and no plaintext fallback."""
    from backend.services.gmail import crypto as credential_crypto
    return credential_crypto.is_configured()


# ── Bounds ──────────────────────────────────────────────────────────────────

def request_timeout_s() -> float:
    try:
        return float(os.getenv("SLACK_REQUEST_TIMEOUT_S", "10") or 10)
    except (TypeError, ValueError):
        return 10.0


def state_ttl_s() -> int:
    """How long an unconsumed OAuth state stays valid. Short by design — a
    consent round-trip is seconds; 10 minutes leaves headroom for a slow install
    screen without keeping a CSRF token alive indefinitely. Clamped [60, 1800]."""
    return _int_env("SLACK_OAUTH_STATE_TTL_S", 600, lo=60, hi=1800)


def pending_ttl_s() -> int:
    """How long a VERIFIED pending channel set (awaiting the user's choice)
    stays valid. Longer than the state TTL because the user is picking channels
    in the UI. Clamped [60, 3600]."""
    return _int_env("SLACK_PENDING_TTL_S", 900, lo=60, hi=3600)


def max_selected_channels() -> int:
    """HARD cap on how many Slack channels ONE Korvix project may bind.

    10 by default: enough to cover a product team's real working channels, low
    enough that a single explicit sync stays inside Slack's per-method rate
    limits (every selected channel costs at least one `conversations.history`
    request). Clamped [1, 25]."""
    return _int_env("SLACK_MAX_SELECTED_CHANNELS", 10, lo=1, hi=25)


def pending_channels_max() -> int:
    """Hard cap on channels listed for the connect picker (bounded read). A
    large workspace can hold thousands; the picker shows a bounded slice and the
    count is reported truthfully. Clamped [1, 1000]."""
    return _int_env("SLACK_PENDING_CHANNELS_MAX", 200, lo=1, hi=1000)


def channels_page_size() -> int:
    """Channels requested per `conversations.list` page. Slack recommends no
    more than 200 (1000 is the hard maximum and is discouraged).
    Clamped [1, 200]."""
    return _int_env("SLACK_CHANNELS_PAGE_SIZE", 200, lo=1, hi=200)


def channels_max_pages() -> int:
    """Cursor pages followed while listing channels. Clamped [1, 10]."""
    return _int_env("SLACK_CHANNELS_MAX_PAGES", 3, lo=1, hi=10)


def sync_page_size() -> int:
    """Messages requested per `conversations.history` page. Slack's documented
    maximum is 1000, but recent non-Marketplace apps are capped far lower by the
    provider regardless of what we ask for, so a modest value is both polite and
    realistic. Clamped [1, 200]."""
    return _int_env("SLACK_SYNC_PAGE_SIZE", 50, lo=1, hi=200)


def sync_max_pages() -> int:
    """History pages followed per channel during an INCREMENTAL (already
    backfilled) sync. 1 by default — the newest page is enough once the initial
    import has run. Clamped [1, 5]."""
    return _int_env("SLACK_SYNC_MAX_PAGES", 1, lo=1, hi=5)


def sync_initial_max_pages() -> int:
    """History pages followed per channel on the FIRST sync of a connection, so
    a newly connected channel pulls its bounded window in ONE click instead of
    forcing repeated "Sync now" presses — while still enforcing a hard ceiling.
    Clamped [1, 5]; default 2."""
    return _int_env("SLACK_SYNC_INITIAL_MAX_PAGES", 2, lo=1, hi=5)


def sync_max_messages() -> int:
    """HARD ceiling on messages read across ALL channels in ONE sync,
    independent of the per-channel page caps — the final guard that makes the
    read BOUNDED no matter how the other knobs are set. Clamped [1, 500]."""
    return _int_env("SLACK_SYNC_MAX_MESSAGES", 200, lo=1, hi=500)


def sync_lookback_days() -> int:
    """How far BACK an INCREMENTAL sync reads (`oldest`). Clamped [1, 90].
    This is what keeps the connector from crawling channel history."""
    return _int_env("SLACK_SYNC_LOOKBACK_DAYS", 7, lo=1, hi=90)


def sync_initial_lookback_days() -> int:
    """How far BACK the FIRST sync of a connection reads — a slightly larger,
    still strictly bounded window so a freshly connected channel arrives with
    usable context. Clamped [1, 180]; default 14."""
    return _int_env("SLACK_SYNC_INITIAL_LOOKBACK_DAYS", 14, lo=1, hi=180)


def sync_thread_max_replies() -> int:
    """Upper bound on replies read per thread (`conversations.replies`). 0
    disables thread reads entirely (history-only sync). Clamped [0, 50]."""
    return _int_env("SLACK_SYNC_THREAD_MAX_REPLIES", 5, lo=0, hi=50)


def sync_max_threads_per_channel() -> int:
    """Upper bound on how many threads per channel are expanded at all. Each
    expansion is one extra `conversations.replies` request, so this is the knob
    that keeps a busy channel from multiplying the request count. 0 disables
    thread expansion. Clamped [0, 20]; default 3."""
    return _int_env("SLACK_SYNC_MAX_THREADS_PER_CHANNEL", 3, lo=0, hi=20)


def message_max_chars() -> int:
    """Upper bound on the message text copied into an observation payload — a
    bounded context hint, never a full transcript dump. 0 drops message text
    entirely (metadata-only observations). Clamped [0, 2000]; default 500."""
    return _int_env("SLACK_MESSAGE_MAX_CHARS", 500, lo=0, hi=2000)


# ── Readiness ───────────────────────────────────────────────────────────────

def oauth_configured() -> bool:
    """True iff the OAuth client credentials + redirect URI are present. Connect
    can only run when this holds."""
    return bool(client_id() and client_secret() and redirect_uri())


__all__ = [
    "BOT_SCOPES", "is_enabled", "client_id", "client_secret", "redirect_uri",
    "scopes", "scope_param", "authorize_endpoint", "api_base",
    "frontend_result_base", "frontend_result_path", "encryption_configured",
    "request_timeout_s", "state_ttl_s", "pending_ttl_s",
    "max_selected_channels", "pending_channels_max", "channels_page_size",
    "channels_max_pages", "sync_page_size", "sync_max_pages",
    "sync_initial_max_pages", "sync_max_messages", "sync_lookback_days",
    "sync_initial_lookback_days", "sync_thread_max_replies",
    "sync_max_threads_per_channel", "message_max_chars", "oauth_configured",
]
