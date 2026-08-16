# coding: utf-8
"""Shared connector authority — ONE model for provider authorization + project
binding, used by every connector (Gmail, Google Calendar, GitHub, Vercel, Slack).

WHY THIS PACKAGE EXISTS
-----------------------
Each connector historically owned a `<provider>_connections` table keyed by
`project_id`. That made the OAuth grant itself project-scoped: connecting Gmail
to a second project meant a second full OAuth round-trip, a second stored refresh
token for the same mailbox, and a second thing to revoke. It also made honest
answers to account-level questions ("which tools is my account connected to?",
"which projects use this Slack workspace?") impossible without scanning five
tables.

THE MODEL
---------
Two tables, in the EXISTING `projects.db` (same file as `projects` and
`observations`, so (owner, project) scoping joins stay local):

  connector_authorizations      one provider account authorized ONCE per Korvix
                                owner. Holds the encrypted credentials and the
                                provider account identity.

  connector_project_bindings    which project may use which authorization, and
                                WHICH RESOURCES of it (a GitHub repo, a Vercel
                                project, a set of Slack channels, or the whole
                                authorized mailbox/calendar).

Authorization is account-level. DATA ACCESS stays project-level: a project reads
only the resources its own binding names, and every observation is still
attributed to (owner, project). Authorizing a provider does NOT expose it to any
project — a binding is always an explicit, separate act.

SECRETS
-------
Credentials live ONLY in `connector_authorizations.credentials_json`, as a JSON
object mapping a credential field name to an ENCRYPTED envelope produced by the
existing credential authority (`backend.services.gmail.crypto`, keyed by
`KORVIX_CREDENTIAL_ENCRYPTION_KEY`). The JSON structure is not secret; every
value in it is ciphertext. There is no second cipher, no second key, and no
plaintext fallback anywhere in this package.

Because each credential value keeps its own envelope, migrating a legacy row is
a pure ciphertext COPY: the encryption key is never needed to migrate, and a
plaintext token can never exist even transiently.
"""
from backend.services.connectors import registry, store  # noqa: F401

__all__ = ["registry", "store"]
