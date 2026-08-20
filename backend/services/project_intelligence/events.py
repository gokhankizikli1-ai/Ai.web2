# coding: utf-8
"""Project Intelligence — OBSERVATION → SEMANTIC EVENT.

One stored observation in, one normalized event out (or None when the row is
malformed). This is where a provider-shaped fact becomes a source-neutral one:

    vercel.deployment.error   ─┐
    github.deployment_status.failure ─┴─→ DEPLOY_FAILED (facet=deploy, negative)

WHY A SEPARATE VOCABULARY FROM `project_brain.attention`
--------------------------------------------------------
`attention.classify_observation` answers "should a human look at this NOW?" and
deliberately understands only the handful of kinds that can raise an alarm —
Gmail and Slack are excluded from it by design, because chatter must never
outrank a broken deploy. That is the right rule for a notification list and the
wrong one here: a Slack sentence naming the same webhook as a merged PR is
exactly the evidence this layer exists to find.

So the two are complementary, not duplicative, and this module does not
re-implement attention's job: it never assigns severity, never decides what is
urgent, and never orders anything. It assigns three things attention has no
concept of — a FACET (which aspect of the work this speaks to), a POLARITY
(does it push the work toward done or away from it), and the ENTITY KEYS the
event touches. Attention remains the sole authority for "needs attention".

POLARITY IS NOT SEVERITY
------------------------
  negative   the work is demonstrably not finished (a failure, an open issue)
  positive   the work demonstrably progressed (a merge, a green deploy)
  pending    a step is in flight and its outcome is unknown (a PR awaiting)
  neutral    real evidence, but it settles nothing (a commit, a chat line)

Only `negative` and `positive` are DECISIVE — they are what `correlation` reads
to infer state. Everything else is context that can raise confidence and prove
a subject is live, but can never on its own declare something resolved.

COST: pure functions. ZERO I/O, ZERO model tokens, ZERO provider calls.
"""
from __future__ import annotations

import re
from dataclasses import dataclass, field
from datetime import datetime
from typing import Any, Dict, List, Optional

from backend.services.project_brain.attention import parse_iso
from backend.services.project_intelligence import keys as k

# ── Facets: which aspect of the work an event speaks to ──────────────────────
FACET_CODE = "code"
FACET_CI = "ci"
FACET_DEPLOY = "deploy"
FACET_ISSUE = "issue"
FACET_DISCUSSION = "discussion"
FACET_MAIL = "mail"
FACET_MEETING = "meeting"
FACET_OTHER = "other"

#: The facets whose latest event can DECIDE a state. Discussion/mail/meeting
#: are evidence that a subject is live, never proof that it is fixed.
DECISIVE_FACETS = frozenset({FACET_CODE, FACET_CI, FACET_DEPLOY, FACET_ISSUE})

#: The facets that describe the WORK ITSELF rather than people talking about
#: it. `interpretation` reads the latest event per target across exactly these
#: — including the ones that settle nothing (a queued deploy, a bare push) —
#: because "a deploy started and we never heard how it went" is a fact about
#: the project that the decisive-only view cannot express.
TECHNICAL_FACETS = DECISIVE_FACETS

# ── Deployment environments ──────────────────────────────────────────────────
# A deploy target is the difference between "the fix is live" and "the fix
# built once on a preview URL". Both connectors already carry it — Vercel as
# `target`, GitHub as the deployment's `environment` — and BOTH were parsed
# into a key and then thrown away, so nothing downstream could tell production
# from preview. It is kept on the event now, normalized to one vocabulary.
ENV_PRODUCTION = "production"
ENV_PREVIEW = "preview"

#: Provider spellings that mean the same target. Anything else is kept as the
#: project's OWN environment name (GitHub environments are user-defined:
#: `staging`, `qa`, `eu-west`), because renaming someone's environment to
#: "other" would lose the only word they use for it.
_ENV_ALIASES = {
    "production": ENV_PRODUCTION, "prod": ENV_PRODUCTION,
    "preview": ENV_PREVIEW, "pr": ENV_PREVIEW,
    "development": ENV_PREVIEW, "dev": ENV_PREVIEW,
}
#: An environment name travels into a system prompt and onto a page. It is
#: user-authored text, so it is reduced to this alphabet — no newlines, no
#: markup, nothing that could restructure a prompt block around it.
_ENV_ALLOWED = re.compile(r"[^a-z0-9 ._/-]+")
_MAX_ENV_CHARS = 40


def normalize_environment(value: Any) -> str:
    """A provider's deploy target → the shared environment vocabulary, or "".

    Never raises, never invents: an unrecognised name is sanitized and kept,
    an empty one stays empty (and every consumer treats "" as "we do not know
    which environment this was", not as production)."""
    text = _s(value, _MAX_ENV_CHARS * 2).strip().lower()
    if not text:
        return ""
    alias = _ENV_ALIASES.get(text)
    if alias:
        return alias
    return _ENV_ALLOWED.sub("", text).strip()[:_MAX_ENV_CHARS]

# ── Polarity ─────────────────────────────────────────────────────────────────
POLARITY_POSITIVE = "positive"
POLARITY_NEGATIVE = "negative"
POLARITY_PENDING = "pending"
POLARITY_NEUTRAL = "neutral"

# ── Semantic types (stable codes; never user-facing prose) ───────────────────
SEM_CHANGE_PROPOSED = "change_proposed"
SEM_CHANGE_LANDED = "change_landed"
SEM_CHANGE_ABANDONED = "change_abandoned"
SEM_CHANGE_PUSHED = "change_pushed"
SEM_CI_FAILED = "ci_failed"
SEM_CI_PASSED = "ci_passed"
SEM_DEPLOY_FAILED = "deploy_failed"
SEM_DEPLOY_SUCCEEDED = "deploy_succeeded"
SEM_DEPLOY_CANCELLED = "deploy_cancelled"
SEM_DEPLOY_STARTED = "deploy_started"
SEM_ISSUE_OPENED = "issue_opened"
SEM_ISSUE_CLOSED = "issue_closed"
SEM_DISCUSSION = "discussion"
SEM_MAIL = "mail"
SEM_MEETING = "meeting"
SEM_ACTIVITY = "activity"

#: semantic type → (facet, polarity). One table, so the meaning of a code is
#: readable in one place and cannot drift between producers.
SEMANTICS: Dict[str, tuple] = {
    SEM_CHANGE_PROPOSED:  (FACET_CODE, POLARITY_PENDING),
    SEM_CHANGE_LANDED:    (FACET_CODE, POLARITY_POSITIVE),
    SEM_CHANGE_ABANDONED: (FACET_CODE, POLARITY_NEUTRAL),
    SEM_CHANGE_PUSHED:    (FACET_CODE, POLARITY_NEUTRAL),
    SEM_CI_FAILED:        (FACET_CI, POLARITY_NEGATIVE),
    SEM_CI_PASSED:        (FACET_CI, POLARITY_POSITIVE),
    SEM_DEPLOY_FAILED:    (FACET_DEPLOY, POLARITY_NEGATIVE),
    SEM_DEPLOY_SUCCEEDED: (FACET_DEPLOY, POLARITY_POSITIVE),
    SEM_DEPLOY_CANCELLED: (FACET_DEPLOY, POLARITY_NEUTRAL),
    SEM_DEPLOY_STARTED:   (FACET_DEPLOY, POLARITY_NEUTRAL),
    SEM_ISSUE_OPENED:     (FACET_ISSUE, POLARITY_NEGATIVE),
    SEM_ISSUE_CLOSED:     (FACET_ISSUE, POLARITY_POSITIVE),
    SEM_DISCUSSION:       (FACET_DISCUSSION, POLARITY_NEUTRAL),
    SEM_MAIL:             (FACET_MAIL, POLARITY_NEUTRAL),
    SEM_MEETING:          (FACET_MEETING, POLARITY_NEUTRAL),
    SEM_ACTIVITY:         (FACET_OTHER, POLARITY_NEUTRAL),
}

#: GitHub deployment_status states that mean the deploy did not land. Mirrors
#: `attention._GH_DEPLOY_FAILURE_STATES` — the same provider truth, and the two
#: must not drift apart.
_GH_DEPLOY_FAILED = frozenset({"failure", "error"})

_MAX_TITLE = 240


def _s(value: Any, limit: int = 200) -> str:
    out = "" if value is None else str(value)
    return out[:limit]


def _payload(obs: Any) -> Dict[str, Any]:
    if not isinstance(obs, dict):
        return {}
    payload = obs.get("payload")
    return payload if isinstance(payload, dict) else {}


@dataclass
class Event:
    """One normalized, source-neutral event.

    `link_keys` / `group_keys` / `topic_keys` are the identities this event
    touches (see `keys`). `facet_ref` is the identity used for SUPERSESSION
    inside its facet — for a deployment that is its target, so a later green
    deploy to production supersedes an earlier red one to production but not a
    red one to preview."""
    observation_id: str
    source: str
    kind: str
    semantic_type: str
    facet: str
    polarity: str
    title: str
    observed_at: str
    when: Optional[datetime]
    facet_ref: str = ""
    #: The deploy target this event speaks about ("production" / "preview" /
    #: the project's own environment name), or "" when the event is not about
    #: a deployment at all. "" NEVER means production.
    environment: str = ""
    link_keys: List[str] = field(default_factory=list)
    group_keys: List[str] = field(default_factory=list)
    topic_keys: List[str] = field(default_factory=list)

    @property
    def is_decisive(self) -> bool:
        return (self.facet in DECISIVE_FACETS
                and self.polarity in (POLARITY_POSITIVE, POLARITY_NEGATIVE))

    def merge_keys(self) -> List[str]:
        """Every key this event can be found under."""
        return list(self.link_keys) + list(self.group_keys) + list(self.topic_keys)


def _semantic_for(source: str, kind: str, payload: Dict[str, Any]) -> str:
    """Provider `kind` → source-neutral semantic type. An unknown source or an
    unrecognised kind resolves to plain ACTIVITY — never an exception, so a
    connector shipped after this module cannot crash the projection."""
    verb = kind.rsplit(".", 1)[-1] if kind else ""

    if source == "github":
        if kind.startswith("github.pull_request."):
            if verb in ("opened", "reopened"):
                return SEM_CHANGE_PROPOSED
            if verb == "merged":
                return SEM_CHANGE_LANDED
            if verb == "closed":
                return SEM_CHANGE_ABANDONED
            return SEM_ACTIVITY
        if kind.startswith("github.issue."):
            if verb in ("opened", "reopened"):
                return SEM_ISSUE_OPENED
            if verb == "closed":
                return SEM_ISSUE_CLOSED
            return SEM_ACTIVITY
        if kind == "github.check.failed":
            return SEM_CI_FAILED
        if kind == "github.check.succeeded":
            return SEM_CI_PASSED
        if kind.startswith("github.deployment_status."):
            state = _s(payload.get("state"), 40).lower() or verb
            if state in _GH_DEPLOY_FAILED:
                return SEM_DEPLOY_FAILED
            if state == "success":
                return SEM_DEPLOY_SUCCEEDED
            return SEM_DEPLOY_STARTED          # pending / in_progress / queued
        if kind == "github.deployment.created":
            return SEM_DEPLOY_STARTED
        if kind == "github.commit.pushed":
            return SEM_CHANGE_PUSHED
        return SEM_ACTIVITY

    if source == "vercel":
        if kind.startswith("vercel.deployment."):
            if verb == "error":
                return SEM_DEPLOY_FAILED
            if verb == "ready":
                return SEM_DEPLOY_SUCCEEDED
            if verb == "canceled":
                return SEM_DEPLOY_CANCELLED
        return SEM_ACTIVITY

    if source == "slack":
        return SEM_DISCUSSION
    if source == "gmail":
        return SEM_MAIL
    if source == "calendar":
        return SEM_MEETING
    return SEM_ACTIVITY


def _github_keys(kind: str, payload: Dict[str, Any]) -> tuple:
    """(link_keys, group_keys, facet_ref, extra_text, environment) for a GitHub
    event. `environment` is "" for everything that is not a deployment."""
    repo = payload.get("repo")
    link: List[str] = []
    group: List[str] = []
    facet_ref = ""
    environment = ""
    text_parts: List[str] = []

    if kind.startswith("github.pull_request."):
        key = k.pr_key(repo, payload.get("number"))
        if key:
            link.append(key)
            facet_ref = key
        branch = k.branch_key(repo, payload.get("head_ref"))
        if branch:
            link.append(branch)
        text_parts += [payload.get("title"), payload.get("head_ref")]
    elif kind.startswith("github.issue."):
        key = k.issue_key(repo, payload.get("number"))
        if key:
            link.append(key)
            facet_ref = key
        text_parts.append(payload.get("title"))
    elif kind.startswith("github.check."):
        # One CI target per check-run/workflow-run identity — the SAME order of
        # preference `attention` uses, so the two agree on what "the same
        # check" means.
        ident = (payload.get("check_id") or payload.get("run_id")
                 or payload.get("name"))
        key = k.ci_key(repo, ident)
        if key:
            group.append(key)
            facet_ref = key
        branch = k.branch_key(repo, payload.get("branch"))
        if branch:
            link.append(branch)
        text_parts += [payload.get("name"), payload.get("branch")]
    elif kind.startswith("github.deployment"):
        environment = normalize_environment(payload.get("environment"))
        key = k.deploy_key("github", repo, payload.get("environment"))
        if key:
            group.append(key)
            facet_ref = key
        ref = payload.get("ref")
        branch = k.branch_key(repo, ref)
        if branch:
            link.append(branch)
        sha = k.commit_key(ref)
        if sha:
            link.append(sha)
        text_parts += [payload.get("description")]
    elif kind == "github.commit.pushed":
        sha = k.commit_key(payload.get("sha"))
        if sha:
            link.append(sha)
            facet_ref = sha
        text_parts.append(payload.get("message"))

    return link, group, facet_ref, text_parts, environment


def _vercel_keys(payload: Dict[str, Any]) -> tuple:
    git = payload.get("git") if isinstance(payload.get("git"), dict) else {}
    link: List[str] = []
    group: List[str] = []
    # Vercel's own default: a deployment with no explicit target is a PREVIEW
    # (mirrors `vercel.normalize._target_of`). Defaulting the other way would
    # let an unlabelled build claim it proved production.
    environment = normalize_environment(payload.get("target")) or ENV_PREVIEW
    key = k.deploy_key("vercel", payload.get("vercel_project_id"),
                       payload.get("target"))
    if key:
        group.append(key)
    sha = k.commit_key(git.get("commit_sha"))
    if sha:
        link.append(sha)
    branch = k.branch_key(git.get("repo"), git.get("ref"))
    if branch:
        link.append(branch)
    text_parts = [git.get("ref"), git.get("commit_message"),
                  payload.get("error_message")]
    return link, group, (key or ""), text_parts, environment


def event_from_observation(obs: Any) -> Optional[Event]:
    """One stored observation → one `Event`, or None when the row is unusable.

    Never raises: a malformed payload, a missing kind, an unknown source and a
    None row all resolve to None or to a plain ACTIVITY event."""
    if not isinstance(obs, dict):
        return None
    kind = _s(obs.get("kind"), 120)
    source = _s(obs.get("source"), 60).strip().lower()
    if not (kind and source):
        return None

    payload = _payload(obs)
    semantic = _semantic_for(source, kind, payload)
    facet, polarity = SEMANTICS.get(semantic, (FACET_OTHER, POLARITY_NEUTRAL))
    summary = _s(obs.get("summary"), _MAX_TITLE)

    link: List[str] = []
    group: List[str] = []
    facet_ref = ""
    environment = ""
    text_parts: List[Any] = [summary]

    if source == "github":
        link, group, facet_ref, extra, environment = _github_keys(kind, payload)
        text_parts += extra
    elif source == "vercel":
        link, group, facet_ref, extra, environment = _vercel_keys(payload)
        text_parts += extra
    elif source == "slack":
        # The message body only. The channel LABEL is deliberately excluded:
        # it would inject the same words into every message in a channel, so
        # "#payments" would quietly correlate unrelated conversations.
        text_parts = [payload.get("text") or payload.get("parent_text")]
    elif source == "gmail":
        # Subject only. Snippets are marketing prose as often as they are
        # substance, and they generate bigrams nobody wrote deliberately.
        text_parts = [payload.get("subject")]
    elif source == "calendar":
        text_parts = [payload.get("title")]
        key = k.meeting_key(payload.get("event_id"))
        if key:
            group.append(key)
            facet_ref = key

    joined = " ".join(_s(p, k.MAX_TEXT_CHARS) for p in text_parts if p)
    topics = k.topic_keys(joined)
    # A fully-qualified GitHub URL inside human text is the one structural join
    # a chat message or an email can make.
    for ref in k.refs_from_text(joined):
        if ref not in link:
            link.append(ref)

    link = link[:k.MAX_LINK_KEYS]
    return Event(
        observation_id=_s(obs.get("id"), 64),
        source=source,
        kind=kind,
        semantic_type=semantic,
        facet=facet,
        polarity=polarity,
        title=summary,
        observed_at=_s(obs.get("observed_at"), 64),
        when=parse_iso(obs.get("observed_at")),
        facet_ref=facet_ref or f"{source}:{facet}",
        environment=environment,
        link_keys=link,
        group_keys=group[:k.MAX_LINK_KEYS],
        topic_keys=topics,
    )


def events_from_observations(observations: Any, *, limit: int) -> List[Event]:
    """A bounded batch. A malformed row is skipped, never fatal."""
    out: List[Event] = []
    for obs in list(observations or [])[:max(0, int(limit))]:
        try:
            event = event_from_observation(obs)
        except Exception:      # pragma: no cover — defensive; never break a read
            event = None
        if event is not None:
            out.append(event)
    return out


__all__ = [
    "FACET_CODE", "FACET_CI", "FACET_DEPLOY", "FACET_ISSUE",
    "FACET_DISCUSSION", "FACET_MAIL", "FACET_MEETING", "FACET_OTHER",
    "DECISIVE_FACETS",
    "POLARITY_POSITIVE", "POLARITY_NEGATIVE", "POLARITY_PENDING",
    "POLARITY_NEUTRAL",
    "SEM_CHANGE_PROPOSED", "SEM_CHANGE_LANDED", "SEM_CHANGE_ABANDONED",
    "SEM_CHANGE_PUSHED", "SEM_CI_FAILED", "SEM_CI_PASSED",
    "SEM_DEPLOY_FAILED", "SEM_DEPLOY_SUCCEEDED", "SEM_DEPLOY_CANCELLED",
    "SEM_DEPLOY_STARTED", "SEM_ISSUE_OPENED", "SEM_ISSUE_CLOSED",
    "SEM_DISCUSSION", "SEM_MAIL", "SEM_MEETING", "SEM_ACTIVITY",
    "SEMANTICS", "TECHNICAL_FACETS",
    "ENV_PRODUCTION", "ENV_PREVIEW", "normalize_environment",
    "Event", "event_from_observation", "events_from_observations",
]
