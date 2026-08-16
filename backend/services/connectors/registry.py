# coding: utf-8
"""Provider descriptors for the shared connector authority.

Providers are NOT interchangeable. Pretending they are is how a connectors UI
ends up claiming "3 channels selected" for Gmail. This registry states, per
provider, the ONE thing the shared layer needs to know: what a project actually
binds when it uses that provider.

  ACCOUNT      the project uses the whole authorized account. There is no
               resource to pick — binding is a yes/no per project.
               (Gmail: the authorized mailbox.)

  SINGLE       the project binds exactly ONE named resource of the account.
               (GitHub: one repository. Vercel: one Vercel project.
                Google Calendar: one calendar, 'primary' in v1.)

  MULTI        the project binds one or more resources of the account.
               (Slack: channels.)

Nothing here decides policy; it is a lookup table the routes and the UI read so
each provider's real semantics survive the shared model.
"""
from __future__ import annotations

from dataclasses import dataclass
from typing import Dict, Optional, Tuple

# Resource cardinality
RESOURCE_ACCOUNT = "account"
RESOURCE_SINGLE = "single"
RESOURCE_MULTI = "multi"

PROVIDER_GMAIL = "gmail"
PROVIDER_CALENDAR = "calendar"
PROVIDER_GITHUB = "github"
PROVIDER_VERCEL = "vercel"
PROVIDER_SLACK = "slack"


@dataclass(frozen=True)
class ProviderSpec:
    provider: str
    label: str
    #: What a project binds — see the module docstring.
    resource_kind: str
    #: Human word for one resource ("repository", "channel", …). "" for ACCOUNT.
    resource_noun: str
    #: Credential field names stored (encrypted) on the authorization.
    credential_fields: Tuple[str, ...]
    #: True when a project binding must name a resource before it can sync.
    requires_resource_selection: bool
    #: Whether a *remote* revoke on account disconnect is even possible/meaningful.
    supports_remote_revoke: bool


_SPECS: Dict[str, ProviderSpec] = {
    PROVIDER_GMAIL: ProviderSpec(
        provider=PROVIDER_GMAIL, label="Gmail",
        resource_kind=RESOURCE_ACCOUNT, resource_noun="",
        credential_fields=("refresh_token", "access_token"),
        requires_resource_selection=False, supports_remote_revoke=True,
    ),
    PROVIDER_CALENDAR: ProviderSpec(
        provider=PROVIDER_CALENDAR, label="Google Calendar",
        resource_kind=RESOURCE_SINGLE, resource_noun="calendar",
        credential_fields=("refresh_token", "access_token"),
        # v1 always binds the 'primary' calendar, so the UI never asks — but the
        # binding still NAMES it, so a second calendar is a data change, not a
        # schema change.
        requires_resource_selection=False, supports_remote_revoke=True,
    ),
    PROVIDER_GITHUB: ProviderSpec(
        provider=PROVIDER_GITHUB, label="GitHub",
        resource_kind=RESOURCE_SINGLE, resource_noun="repository",
        # The GitHub App mints short-lived installation tokens on demand; there
        # is deliberately NOTHING durable to encrypt.
        credential_fields=(),
        requires_resource_selection=True, supports_remote_revoke=False,
    ),
    PROVIDER_VERCEL: ProviderSpec(
        provider=PROVIDER_VERCEL, label="Vercel",
        resource_kind=RESOURCE_SINGLE, resource_noun="project",
        credential_fields=("access_token",),
        requires_resource_selection=True, supports_remote_revoke=False,
    ),
    PROVIDER_SLACK: ProviderSpec(
        provider=PROVIDER_SLACK, label="Slack",
        resource_kind=RESOURCE_MULTI, resource_noun="channel",
        credential_fields=("bot_token",),
        requires_resource_selection=True, supports_remote_revoke=False,
    ),
}

#: Stable display order for the Connectors page.
PROVIDER_ORDER: Tuple[str, ...] = (
    PROVIDER_GMAIL, PROVIDER_CALENDAR, PROVIDER_GITHUB,
    PROVIDER_VERCEL, PROVIDER_SLACK,
)


def spec(provider: str) -> Optional[ProviderSpec]:
    return _SPECS.get(str(provider or "").strip().lower())


def is_known(provider: str) -> bool:
    return spec(provider) is not None


def all_specs() -> Tuple[ProviderSpec, ...]:
    return tuple(_SPECS[p] for p in PROVIDER_ORDER)


__all__ = [
    "ProviderSpec", "spec", "is_known", "all_specs", "PROVIDER_ORDER",
    "RESOURCE_ACCOUNT", "RESOURCE_SINGLE", "RESOURCE_MULTI",
    "PROVIDER_GMAIL", "PROVIDER_CALENDAR", "PROVIDER_GITHUB",
    "PROVIDER_VERCEL", "PROVIDER_SLACK",
]
