# coding: utf-8
"""Project Intelligence — INTERPRETATION: from "one thing" to "what it means".

WHERE THIS SITS, AND THE GAP IT CLOSES
--------------------------------------
`correlation` answers "are these five observations five things or one thing?"
and stops there, deliberately. What it hands on is a subject, a state and an
evidence-derived confidence. That is enough to LIST what is happening and not
enough to EXPLAIN it, which is why every consumer downstream was re-deriving
the same three things from prose, or simply not saying them:

    "which part of the project does this touch?"
    "what does this evidence IMPLY — is the fix actually live?"
    "what do we still not know?"

This module answers exactly those, deterministically, from the STRUCTURAL
reading `correlation` now exports (`state["facets"]` — one row per deploy
target, CI check, PR or issue, carrying facet, polarity and ENVIRONMENT). It
adds no new evidence, reads no store, and calls nothing.

AN IMPLICATION IS NOT AN ACTION — THE LINE THIS MODULE MUST NOT CROSS
---------------------------------------------------------------------
    ALLOWED   "the merged change is not proven live: the production deploy of
               it failed"                            ← a consequence of evidence
    FORBIDDEN "redeploy production"                  ← a proposal of work

Consequences belong here because they are readings of evidence. Proposals
belong to `candidate_synthesis`, ranking to `action_prioritizer`, and the gate
to `execution_policy`. Nothing in this file writes, proposes, orders or
executes; it hands richer structure to the authorities that already do.

STABLE CODES, NEVER PROSE
-------------------------
Every derived concept is a code from a closed vocabulary defined in this file
— areas, change kinds, uncertainty, implications. The frontend renders them
through the shipped locale dictionaries (the rule `attention`'s reason codes
already follow) and `project_brain.client` composes English from them for the
system prompt. The backend ships no user-facing sentence here, so Türkçe and
Deutsch cost nothing and no second translation system is introduced.

STRUCTURE FIRST, TEXT ONLY AS A LABELLED FALLBACK
--------------------------------------------------
An affected area or a change kind is derived from what the connectors actually
recorded — the facet, the polarity, the deploy environment, the semantic type,
the entity type — wherever that is possible. Only when the structure says
nothing does a small explicit keyword table look at text that is already
displayed to the user, and every entry then carries `basis: "textual"` so a
consumer can see it was inferred from wording rather than from a fact. A
shallow keyword classifier presented as knowledge is exactly the kind of
confident-but-wrong output this layer exists to avoid.

HONEST DEGRADATION IS THE POINT
-------------------------------
One source is never corroboration. Stale evidence says so. A green PREVIEW
deploy never resolves PRODUCTION. A merged PR with no production evidence at
all is `production_unverified`, not "resolved". Missing information produces an
uncertainty code, never a guess.

COST: pure functions over the already-bounded state rows. ZERO I/O, ZERO model
tokens, ZERO provider calls, ZERO writes.
"""
from __future__ import annotations

from datetime import datetime, timezone
from typing import Any, Dict, List, Optional, Sequence, Set

from backend.services.project_brain.attention import parse_iso
from backend.services.project_intelligence import correlation as corr
from backend.services.project_intelligence import events as ev
from backend.services.project_intelligence import keys as k

# ── Affected project areas (stable codes) ────────────────────────────────────
AREA_FRONTEND = "frontend"
AREA_BACKEND = "backend"
AREA_DEPLOYMENT = "deployment"
AREA_AUTH = "auth"
AREA_BILLING = "billing"
AREA_DATABASE = "database"
AREA_CONNECTOR = "connector"
AREA_PRODUCT = "product"
AREA_INFRASTRUCTURE = "infrastructure"
AREA_CONTENT = "content"
AREA_UNKNOWN = "unknown"

AREAS = (AREA_FRONTEND, AREA_BACKEND, AREA_DEPLOYMENT, AREA_AUTH, AREA_BILLING,
         AREA_DATABASE, AREA_CONNECTOR, AREA_PRODUCT, AREA_INFRASTRUCTURE,
         AREA_CONTENT, AREA_UNKNOWN)

#: Deterministic presentation order, stated separately from the vocabulary so
#: the two can be reasoned about independently. A bounded list keeps the FIRST
#: entries, so the most specific surfaces come first: "billing" tells a reader
#: something "frontend" does not. NOT a ranking of importance, and never used
#: to decide anything — only to choose which of several true labels survives
#: the cap.
_AREA_PRESENTATION = (
    AREA_AUTH, AREA_BILLING, AREA_DATABASE, AREA_DEPLOYMENT, AREA_BACKEND,
    AREA_FRONTEND, AREA_CONNECTOR, AREA_PRODUCT, AREA_INFRASTRUCTURE,
    AREA_CONTENT, AREA_UNKNOWN,
)
assert set(_AREA_PRESENTATION) == set(AREAS)     # one vocabulary, not two
_AREA_ORDER = {area: index for index, area in enumerate(_AREA_PRESENTATION)}

#: Structural derivation: what the connectors themselves recorded. A deploy
#: event is about deployment because it IS a deployment, not because someone
#: wrote the word.
#:
#: CI is mapped to `deployment` rather than `infrastructure` on purpose: both a
#: red check and a red deploy answer the same user question ("can this ship?"),
#: and splitting them would show two areas for one concern. `infrastructure` is
#: reserved for what only text can reveal (a server, a container, a DNS record).
_AREA_BY_FACET = {
    ev.FACET_DEPLOY: AREA_DEPLOYMENT,
    ev.FACET_CI: AREA_DEPLOYMENT,
}

#: Textual FALLBACK. Distinctive tokens only — every one of these is a word a
#: human chose that names a surface, and none of them is a word that appears in
#: half of a project's events (those live in `keys.GENERIC_TOKENS` and are
#: deliberately absent here, except where the token is unambiguous about WHICH
#: surface is meant, e.g. `payment` → billing).
#:
#: Tokens are compared AFTER `keys.normalize_token`, so they inherit the
#: existing folding: `ödeme` → `odeme`, `webhooks` → `webhook`, and a Turkish
#: sentence tokenizes exactly as an English one does. No new tokenizer.
_AREA_TOKENS: Dict[str, str] = {}


def _register(area: str, *tokens: str) -> None:
    for token in tokens:
        # First registration wins, so the table is order-defined and a token
        # can never mean two areas depending on iteration order.
        _AREA_TOKENS.setdefault(token, area)


_register(AREA_AUTH, "login", "signin", "signup", "oauth", "auth", "session",
          "password", "permission", "sso", "giris", "kimlik", "sifre",
          "unauthorized", "forbidden", "logout")
_register(AREA_BILLING, "billing", "invoice", "subscription", "payment",
          "checkout", "stripe", "refund", "pricing", "coupon", "fatura",
          "odeme", "abonelik", "iade")
_register(AREA_DATABASE, "database", "migration", "sql", "postgres", "sqlite",
          "schema", "veritabani", "seed", "backup")
_register(AREA_FRONTEND, "frontend", "css", "layout", "button", "screen",
          "render", "responsive", "arayuz", "tasarim", "modal", "navbar",
          "sidebar", "scroll", "font")
_register(AREA_BACKEND, "backend", "endpoint", "webhook", "worker", "queue",
          "handler", "sunucu", "cron", "middleware", "rate")
_register(AREA_INFRASTRUCTURE, "infra", "infrastructure", "docker", "railway",
          "kubernetes", "dns", "ssl", "certificate", "nginx", "redis",
          "altyapi")
_register(AREA_DEPLOYMENT, "rollback", "pipeline", "vercel", "yayin")
_register(AREA_CONNECTOR, "connector", "integration", "entegrasyon")
_register(AREA_PRODUCT, "landing", "marketing", "homepage", "waitlist",
          "onboard")
_register(AREA_CONTENT, "content", "blog", "docs", "documentation",
          "translation", "locale", "icerik", "metin", "copy")

# ── Change kinds (stable codes) ──────────────────────────────────────────────
KIND_FEATURE = "feature"
KIND_BUG = "bug"
KIND_REGRESSION = "regression"
KIND_DEPLOYMENT = "deployment"
KIND_CONFIGURATION = "configuration"
KIND_DEPENDENCY = "dependency"
KIND_SECURITY = "security"
KIND_OPERATIONAL = "operational"
KIND_COMMUNICATION = "communication"
KIND_UNKNOWN = "unknown"

CHANGE_KINDS = (KIND_FEATURE, KIND_BUG, KIND_REGRESSION, KIND_DEPLOYMENT,
                KIND_CONFIGURATION, KIND_DEPENDENCY, KIND_SECURITY,
                KIND_OPERATIONAL, KIND_COMMUNICATION, KIND_UNKNOWN)

#: Cross-cutting kinds that a strong, distinctive word can establish on its own
#: — checked BEFORE the structural rules, because "security" is a property of a
#: change that its facet cannot express.
_KIND_TOKENS: Dict[str, str] = {}
for _t in ("security", "vulnerability", "cve", "exploit", "breach",
           "unauthorized", "guvenlik", "yetkisiz", "xss", "injection"):
    _KIND_TOKENS.setdefault(_t, KIND_SECURITY)
for _t in ("dependabot", "dependency", "lockfile", "npm", "yarn", "pnpm",
           "bump", "bagimlilik", "vendor"):
    _KIND_TOKENS.setdefault(_t, KIND_DEPENDENCY)
for _t in ("config", "configuration", "settings", "envvar", "ayar",
           "yapilandirma", "toggle"):
    _KIND_TOKENS.setdefault(_t, KIND_CONFIGURATION)

#: Words that make a code change a FIX rather than a new capability. Applied
#: only when a code change already exists structurally.
_BUG_TOKENS = frozenset({
    "fix", "bug", "hata", "crash", "broken", "regression", "hotfix", "patch",
    "revert", "error", "fail", "bozuk", "sorun", "duzelt",
})

# ── Uncertainty codes (stable) ───────────────────────────────────────────────
UNC_CONFLICTING_EVIDENCE = "conflicting_evidence"
UNC_PRODUCTION_UNVERIFIED = "production_unverified"
UNC_DEPLOY_OUTCOME_UNKNOWN = "deploy_outcome_unknown"
UNC_NO_DECISIVE_EVIDENCE = "no_decisive_evidence"
UNC_SINGLE_SOURCE = "single_source"
UNC_THIN_EVIDENCE = "thin_evidence"
UNC_TOPICAL_LINK_ONLY = "topical_link_only"
UNC_STALE_EVIDENCE = "stale_evidence"
UNC_UNDATED_EVIDENCE = "undated_evidence"
UNC_UNKNOWN_AFFECTED_SCOPE = "unknown_affected_scope"

#: Priority order for the bounded uncertainty list — what would most change a
#: reader's confidence comes first. NOT a score.
_UNCERTAINTY_ORDER = (
    UNC_CONFLICTING_EVIDENCE, UNC_PRODUCTION_UNVERIFIED,
    UNC_DEPLOY_OUTCOME_UNKNOWN, UNC_STALE_EVIDENCE, UNC_SINGLE_SOURCE,
    UNC_TOPICAL_LINK_ONLY, UNC_THIN_EVIDENCE, UNC_NO_DECISIVE_EVIDENCE,
    UNC_UNDATED_EVIDENCE, UNC_UNKNOWN_AFFECTED_SCOPE,
)

# ── Implication codes (stable) — CONSEQUENCES, never proposals ───────────────
IMP_PRODUCTION_BROKEN = "production_broken"
IMP_FIX_NOT_PROVEN_LIVE = "fix_not_proven_live"
IMP_PREVIEW_ONLY_VERIFIED = "preview_only_verified"
IMP_VERIFIED_LIVE = "verified_live"
IMP_BLOCKED_BY_CI = "blocked_by_ci"
IMP_ISSUE_OPEN = "issue_open"
IMP_RECURRENCE = "recurrence"
IMP_WORK_IN_FLIGHT = "work_in_flight"
IMP_REPORTED_BUT_UNCONFIRMED = "reported_but_unconfirmed"

_IMPLICATION_ORDER = (
    IMP_PRODUCTION_BROKEN, IMP_RECURRENCE, IMP_FIX_NOT_PROVEN_LIVE,
    IMP_BLOCKED_BY_CI, IMP_ISSUE_OPEN, IMP_PREVIEW_ONLY_VERIFIED,
    IMP_WORK_IN_FLIGHT, IMP_REPORTED_BUT_UNCONFIRMED, IMP_VERIFIED_LIVE,
)

# ── Bounds ───────────────────────────────────────────────────────────────────
MAX_AREAS = 3
MAX_IMPLICATIONS = 4
MAX_UNCERTAINTY = 4
MAX_BLOCKERS = 3
#: Evidence titles scanned by the textual fallback, per subject.
MAX_TEXT_SOURCES = 6


def _s(value: Any, limit: int = 200) -> str:
    out = "" if value is None else str(value)
    return out[:limit]


def _facets(state: Dict[str, Any]) -> List[Dict[str, Any]]:
    rows = state.get("facets")
    return [r for r in rows if isinstance(r, dict)] if isinstance(rows, list) else []


def _confidence(state: Dict[str, Any]) -> Dict[str, Any]:
    value = state.get("confidence")
    return value if isinstance(value, dict) else {}


def _breakdown(state: Dict[str, Any]) -> Dict[str, Any]:
    value = _confidence(state).get("breakdown")
    return value if isinstance(value, dict) else {}


def _int(value: Any, default: int = 0) -> int:
    try:
        return int(value)
    except (TypeError, ValueError):
        return default


# ── affected areas ───────────────────────────────────────────────────────────

def _subject_tokens(state: Dict[str, Any], facets: Sequence[Dict[str, Any]]) -> Set[str]:
    """The normalized vocabulary this subject was described with.

    Reads the correlated subject label plus a bounded number of evidence
    titles — all of them strings the connector's own normalizer wrote and the
    activity feed already shows, so nothing new is exposed by looking at them.
    Tokenization is `keys.tokenize`, the existing one, so folding/synonyms
    behave identically to correlation."""
    texts: List[str] = [_s(state.get("subject"), 200)]
    for row in facets:
        if len(texts) > MAX_TEXT_SOURCES:
            break
        texts.append(_s(row.get("title"), 200))
    for key in ("supporting", "contradicting", "context"):
        if len(texts) > MAX_TEXT_SOURCES:
            break
        for item in (state.get(key) or []):
            if len(texts) > MAX_TEXT_SOURCES:
                break
            if isinstance(item, dict):
                texts.append(_s(item.get("title"), 200))
    tokens: Set[str] = set()
    for text in texts:
        if text:
            tokens.update(k.tokenize(text))
    return tokens


def _change_tokens(state: Dict[str, Any],
                   facets: Sequence[Dict[str, Any]]) -> Set[str]:
    """The vocabulary that describes THE CHANGE ITSELF — never its outcome.

    AUDIT FINDING, fixed here. `_change_kind` used to read the same wide token
    set `_areas` does, which includes the titles of DEPLOY and CI events. Those
    titles are outcome reports, and they carry outcome words: "Production
    deployment FAILED for korvix" contributes `fail`. So a pull request titled
    "Add team invitations" whose deployment failed was classified as a BUG FIX
    — a textual signal from one facet overwriting the structured identity of
    another, which is precisely the inversion this layer must not make.

    The words that describe a change are the ones attached to the change: the
    correlated subject label (which, for a topic, two different sources had to
    agree on before it existed at all) and the titles of the CODE / ISSUE
    facets. A deploy failing says something about the deployment, not about
    whether the work was a feature or a fix.

    `_areas` deliberately keeps the WIDER set. An area is an additive label —
    several can be true at once, and a deploy title naming a service is real
    evidence about which surface is involved. A change kind is a single
    exclusive verdict, so a wrong word there produces a wrong statement rather
    than an extra true one."""
    texts: List[str] = [_s(state.get("subject"), 200)]
    for row in facets:
        if len(texts) > MAX_TEXT_SOURCES:
            break
        if _s(row.get("facet"), 24) in (ev.FACET_CODE, ev.FACET_ISSUE):
            texts.append(_s(row.get("title"), 200))
    tokens: Set[str] = set()
    for text in texts:
        if text:
            tokens.update(k.tokenize(text))
    return tokens


def _areas(state: Dict[str, Any], facets: Sequence[Dict[str, Any]],
           tokens: Set[str]) -> List[Dict[str, str]]:
    """The project surfaces this subject touches, structural evidence first.

    Returns at least one entry always: `unknown` is a truthful answer and a
    consumer should never have to distinguish "no areas" from "we did not
    look"."""
    structural: Set[str] = set()
    for row in facets:
        area = _AREA_BY_FACET.get(_s(row.get("facet"), 24))
        if area:
            structural.add(area)
    if _s(state.get("entity_type"), 40) in (corr.ENTITY_DEPLOYMENT, corr.ENTITY_CI):
        structural.add(AREA_DEPLOYMENT)

    textual: Set[str] = set()
    for token in tokens:
        area = _AREA_TOKENS.get(token)
        if area and area not in structural:
            textual.add(area)

    out: List[Dict[str, str]] = []
    for area in sorted(structural, key=lambda a: _AREA_ORDER.get(a, 99)):
        out.append({"area": area, "basis": "structural"})
    for area in sorted(textual, key=lambda a: _AREA_ORDER.get(a, 99)):
        out.append({"area": area, "basis": "textual"})
    if not out:
        return [{"area": AREA_UNKNOWN, "basis": "none"}]
    return out[:MAX_AREAS]


# ── change kind ──────────────────────────────────────────────────────────────

def _change_kind(state: Dict[str, Any], facets: Sequence[Dict[str, Any]],
                 tokens: Set[str]) -> Dict[str, str]:
    """What KIND of change this subject is. First match wins; the basis says
    whether structure or wording decided it."""
    kinds = {_s(row.get("facet"), 24) for row in facets}
    semantics = {_s(row.get("semantic_type"), 40) for row in facets}

    # A target that was green and went red is a regression however it is
    # worded — that is a fact, not a reading.
    if any(row.get("regressed") is True for row in facets):
        return {"kind": KIND_REGRESSION, "basis": "structural"}

    # Cross-cutting properties a facet cannot express. Resolved in a fixed
    # KIND order rather than by whichever token happens to sort first, so a
    # subject whose words say both "config" and "security" reads as the
    # security concern it is.
    matched = {_KIND_TOKENS[t] for t in tokens if t in _KIND_TOKENS}
    for kind in (KIND_SECURITY, KIND_DEPENDENCY, KIND_CONFIGURATION):
        if kind in matched:
            return {"kind": kind, "basis": "textual"}

    if ev.FACET_ISSUE in kinds or _s(state.get("entity_type"), 40) == corr.ENTITY_ISSUE:
        return {"kind": KIND_BUG, "basis": "structural"}

    if ev.FACET_CODE in kinds:
        if tokens & _BUG_TOKENS:
            return {"kind": KIND_BUG, "basis": "textual"}
        return {"kind": KIND_FEATURE, "basis": "structural"}

    if ev.FACET_DEPLOY in kinds:
        return {"kind": KIND_DEPLOYMENT, "basis": "structural"}
    if ev.FACET_CI in kinds:
        return {"kind": KIND_OPERATIONAL, "basis": "structural"}
    if semantics & {ev.SEM_DISCUSSION, ev.SEM_MAIL, ev.SEM_MEETING}:
        return {"kind": KIND_COMMUNICATION, "basis": "structural"}

    rationale = {_s(r, 40) for r in (state.get("rationale") or [])}
    if rationale & {ev.SEM_DISCUSSION, ev.SEM_MAIL, ev.SEM_MEETING}:
        return {"kind": KIND_COMMUNICATION, "basis": "structural"}
    return {"kind": KIND_UNKNOWN, "basis": "none"}


# ── the deployment reading (the flagship distinction) ────────────────────────

class _Deployment:
    """What the deploy facets actually prove, per environment AND per instant.

    Three distinctions this class exists to keep, each of which was found to be
    collapsible without it:

    ENVIRONMENT. A green PREVIEW is not evidence about PRODUCTION.

    UNKNOWN IS NOT PREVIEW. A deployment whose environment the provider did not
    report (a GitHub deployment with an empty `environment`) proves nothing
    about production — but it is equally not proof of a PREVIEW. It is tracked
    separately so it can support neither claim, rather than being counted as
    non-production and reported as "only a preview succeeded".

    TIME. A production deployment that happened BEFORE the change landed cannot
    have shipped that change. Treating it as proof produced "the change landed
    and a production deployment of it succeeded" for a deploy eight hours older
    than the merge."""

    __slots__ = ("production_ok_at", "production_failed", "known_other_ok",
                 "pending", "any_deploy", "environments")

    def __init__(self, facets: Sequence[Dict[str, Any]]) -> None:
        self.production_ok_at: Optional[datetime] = None
        self.production_failed = False
        self.known_other_ok = False
        self.pending = False
        self.any_deploy = False
        self.environments: List[str] = []
        for row in facets:
            if _s(row.get("facet"), 24) != ev.FACET_DEPLOY:
                continue
            self.any_deploy = True
            environment = _s(row.get("environment"), 40)
            if environment and environment not in self.environments:
                self.environments.append(environment)
            polarity = _s(row.get("polarity"), 16)
            production = environment == ev.ENV_PRODUCTION
            if polarity == ev.POLARITY_POSITIVE:
                if production:
                    when = parse_iso(row.get("observed_at"))
                    if when is not None and (self.production_ok_at is None
                                             or when > self.production_ok_at):
                        self.production_ok_at = when
                    elif when is None and self.production_ok_at is None:
                        # Undated but real. Recorded as production evidence so
                        # `production_unknown` is honest, and it can never
                        # satisfy the ordering test below.
                        self.production_ok_at = _UNDATED
                elif environment:
                    self.known_other_ok = True
                # A success on an UNNAMED environment sets nothing on purpose.
                # It leaves `production_unknown` true (it may have been
                # production) and `known_other_ok` false (it may not have
                # been), so it can support neither claim. `any_deploy` still
                # records that a deployment happened at all.
            elif polarity == ev.POLARITY_NEGATIVE and production:
                self.production_failed = True
                # A FAILED non-production deploy is deliberately not tracked
                # here: it is already reported as a blocker with its own
                # environment, and it proves nothing about production either
                # way — which is the only question this class exists to answer.
            elif _s(row.get("semantic_type"), 40) == ev.SEM_DEPLOY_STARTED:
                self.pending = True

    @property
    def production_ok(self) -> bool:
        return self.production_ok_at is not None

    @property
    def production_unknown(self) -> bool:
        """No production word at all, in either direction."""
        return not (self.production_ok or self.production_failed)

    def proves_live(self, code_landed_at: Optional[datetime]) -> bool:
        """Does the evidence prove THIS change reached production?

        Three conditions, all required: a production deploy succeeded, no
        production deploy reads negative (providers that disagree about
        production prove nothing — they conflict), and the success is not older
        than the change it is supposed to have shipped."""
        if not self.production_ok or self.production_failed:
            return False
        if self.production_ok_at is _UNDATED:
            return False
        if code_landed_at is None:
            return True          # nothing to be older than
        return self.production_ok_at >= code_landed_at


#: Sentinel for "a real production success we cannot date". It is production
#: evidence (so the state is not "unknown") but it can never satisfy an
#: ordering test, so it can never be mistaken for proof.
_UNDATED = datetime.min.replace(tzinfo=timezone.utc)


# ── implications, uncertainty, blockers ──────────────────────────────────────

def _code_landed_at(facets: Sequence[Dict[str, Any]]) -> "tuple[bool, Optional[datetime]]":
    """`(a change landed, when the newest one landed)`. The timestamp may be
    None for a landed change we cannot date — which makes the ordering test
    below unenforceable, so it is skipped rather than guessed."""
    landed = False
    when: Optional[datetime] = None
    for row in facets:
        if _s(row.get("semantic_type"), 40) != ev.SEM_CHANGE_LANDED:
            continue
        landed = True
        stamp = parse_iso(row.get("observed_at"))
        if stamp is not None and (when is None or stamp > when):
            when = stamp
    return landed, when


def _implications(state: Dict[str, Any], facets: Sequence[Dict[str, Any]],
                  deployment: _Deployment) -> List[Dict[str, Any]]:
    """What the evidence MEANS for the project. Consequences only."""
    found: Dict[str, Dict[str, Any]] = {}

    def add(code: str, **params: Any) -> None:
        found.setdefault(code, {"code": code, **params})

    code_landed, landed_at = _code_landed_at(facets)
    proven_live = deployment.proves_live(landed_at)
    code_pending = any(_s(r.get("facet"), 24) == ev.FACET_CODE
                       and _s(r.get("polarity"), 16) == ev.POLARITY_PENDING
                       for r in facets)
    ci_failed = any(_s(r.get("facet"), 24) == ev.FACET_CI
                    and _s(r.get("polarity"), 16) == ev.POLARITY_NEGATIVE
                    for r in facets)
    issue_open = any(_s(r.get("facet"), 24) == ev.FACET_ISSUE
                     and _s(r.get("polarity"), 16) == ev.POLARITY_NEGATIVE
                     for r in facets)
    decisive = any(_s(r.get("polarity"), 16) in (ev.POLARITY_POSITIVE,
                                                 ev.POLARITY_NEGATIVE)
                   for r in facets)

    if any(r.get("regressed") is True for r in facets):
        add(IMP_RECURRENCE)
    if deployment.production_failed:
        add(IMP_PRODUCTION_BROKEN)
    if code_landed and not proven_live:
        # The change exists. Nothing proves it reached production — because
        # production failed, because production said nothing, because the two
        # providers disagree, or because the success predates the change.
        add(IMP_FIX_NOT_PROVEN_LIVE)
    if code_landed and proven_live:
        add(IMP_VERIFIED_LIVE)
    if deployment.known_other_ok and deployment.production_unknown:
        # Only claimable when a NON-production environment was actually named.
        add(IMP_PREVIEW_ONLY_VERIFIED,
            environments=[e for e in deployment.environments
                          if e != ev.ENV_PRODUCTION][:2])
    if ci_failed:
        add(IMP_BLOCKED_BY_CI)
    if issue_open:
        add(IMP_ISSUE_OPEN)
    if code_pending and not decisive:
        add(IMP_WORK_IN_FLIGHT)
    if not decisive and not code_pending:
        # Somebody said something; no technical evidence backs it either way.
        add(IMP_REPORTED_BUT_UNCONFIRMED)

    ordered = [found[code] for code in _IMPLICATION_ORDER if code in found]
    return ordered[:MAX_IMPLICATIONS]


def _uncertainty(state: Dict[str, Any], facets: Sequence[Dict[str, Any]],
                 deployment: _Deployment,
                 areas: Sequence[Dict[str, str]]) -> List[Dict[str, Any]]:
    """What we do NOT know. Never guessed away, never empty when it should not
    be — an empty list means the evidence really is unambiguous."""
    breakdown = _breakdown(state)
    found: Dict[str, Dict[str, Any]] = {}

    def add(code: str, **params: Any) -> None:
        found.setdefault(code, {"code": code, **params})

    if _s(state.get("state"), 40) == corr.STATE_CONFLICTING:
        add(UNC_CONFLICTING_EVIDENCE)

    code_landed, landed_at = _code_landed_at(facets)
    # Not merely "production said nothing": also a production success that
    # cannot have carried this change (it predates it), and one contradicted by
    # a failure. When production is outright RED, `production_broken` already
    # states it and this code — whose phrase is "no production evidence either
    # way" — would be the wrong sentence.
    if (code_landed and not deployment.production_failed
            and not deployment.proves_live(landed_at)):
        add(UNC_PRODUCTION_UNVERIFIED,
            deploy_evidence=bool(deployment.any_deploy))
    if deployment.pending and deployment.production_unknown:
        add(UNC_DEPLOY_OUTCOME_UNKNOWN)

    band = _s(breakdown.get("freshness_band"), 24)
    if band == "stale":
        add(UNC_STALE_EVIDENCE, last_seen=_s(state.get("last_seen"), 64))
    elif band == "unknown":
        add(UNC_UNDATED_EVIDENCE)

    if _int(breakdown.get("distinct_sources"), 0) <= 1:
        sources = [_s(x, 40) for x in (state.get("sources") or [])]
        add(UNC_SINGLE_SOURCE, source=sources[0] if sources else "")
    if _s(breakdown.get("anchor_kind"), 24) == "topical":
        add(UNC_TOPICAL_LINK_ONLY)
    if _int(state.get("evidence_count"), 0) < corr.MIN_CORROBORATED_EVIDENCE:
        add(UNC_THIN_EVIDENCE, evidence_count=_int(state.get("evidence_count"), 0))
    if _int(breakdown.get("decisive_facets"), 0) <= 0:
        add(UNC_NO_DECISIVE_EVIDENCE)
    if all(a.get("area") == AREA_UNKNOWN for a in areas):
        add(UNC_UNKNOWN_AFFECTED_SCOPE)

    ordered = [found[code] for code in _UNCERTAINTY_ORDER if code in found]
    return ordered[:MAX_UNCERTAINTY]


def _blockers(facets: Sequence[Dict[str, Any]]) -> List[Dict[str, Any]]:
    """The concrete negative readings standing between this subject and done.

    Each one is a real stored observation with its provenance — never a
    sentence Korvix made up about the project."""
    out: List[Dict[str, Any]] = []
    for row in facets:
        if _s(row.get("polarity"), 16) != ev.POLARITY_NEGATIVE:
            continue
        out.append({
            "code": _s(row.get("semantic_type"), 40),
            "facet": _s(row.get("facet"), 24),
            "environment": _s(row.get("environment"), 40),
            "source": _s(row.get("source"), 40),
            "title": _s(row.get("title"), 200),
            "observation_id": _s(row.get("observation_id"), 64),
            "observed_at": _s(row.get("observed_at"), 64),
            "regressed": row.get("regressed") is True,
        })
        if len(out) >= MAX_BLOCKERS:
            break
    return out


def _last_meaningful_change(state: Dict[str, Any],
                            facets: Sequence[Dict[str, Any]]) -> Dict[str, Any]:
    """The newest event that actually MOVED this subject.

    A chat line about a thing is not a change to it, so discussion/mail never
    win here — the technical facets do. Falls back to the subject's own
    `last_seen` when nothing datable moved, and to an empty row when even that
    is missing (an undated subject reports nothing rather than "now")."""
    best: Optional[Dict[str, Any]] = None
    best_at: Optional[datetime] = None
    for row in facets:
        if _s(row.get("polarity"), 16) not in (ev.POLARITY_POSITIVE,
                                               ev.POLARITY_NEGATIVE,
                                               ev.POLARITY_PENDING):
            continue
        when = parse_iso(row.get("observed_at"))
        if when is None:
            continue
        if best_at is None or when > best_at:
            best, best_at = row, when
    if best is None:
        return {"at": "", "code": "", "facet": "", "environment": "",
                "source": "", "title": "", "observation_id": ""}
    return {
        "at": _s(best.get("observed_at"), 64),
        "code": _s(best.get("semantic_type"), 40),
        "facet": _s(best.get("facet"), 24),
        "environment": _s(best.get("environment"), 40),
        "source": _s(best.get("source"), 40),
        "title": _s(best.get("title"), 200),
        "observation_id": _s(best.get("observation_id"), 64),
    }


# ── public API ───────────────────────────────────────────────────────────────

def interpret(state: Dict[str, Any]) -> Dict[str, Any]:
    """One correlated state → its structured interpretation.

    PURE and total: a malformed / partial state row yields a fully-shaped
    interpretation with honest `unknown` values rather than raising, because
    every consumer of this renders it and none of them may crash on a row an
    older projection produced."""
    if not isinstance(state, dict):
        state = {}
    facets = _facets(state)
    tokens = _subject_tokens(state, facets)
    areas = _areas(state, facets, tokens)
    deployment = _Deployment(facets)
    return {
        # The canonical identity is the correlation's, never a second one.
        "id": _s(state.get("id"), 64),
        "areas": areas,
        # NOTE the DIFFERENT token set — see `_change_tokens`. An area may be
        # revealed by any evidence title; a change kind may only be decided by
        # the words attached to the change itself.
        "change_kind": _change_kind(state, facets, _change_tokens(state, facets)),
        "environments": deployment.environments[:3],
        "implications": _implications(state, facets, deployment),
        "uncertainty": _uncertainty(state, facets, deployment, areas),
        "blockers": _blockers(facets),
        "last_meaningful_change": _last_meaningful_change(state, facets),
    }


def attach(states: Sequence[Dict[str, Any]]) -> List[Dict[str, Any]]:
    """Add `understanding` to each state row, IN PLACE, and return the list.

    In place on purpose: `correlate_with_membership` hands the SAME row objects
    out through both the state list and the membership index, and a consumer
    that suppressed on one while promoting from the other must be looking at
    one object, not two copies that could drift.

    Fail-soft per row: one unusable row never costs the projection."""
    for state in states or []:
        if not isinstance(state, dict):
            continue
        try:
            state["understanding"] = interpret(state)
        except Exception:      # pragma: no cover — never break a projection
            state["understanding"] = interpret({})
    return list(states or [])


__all__ = [
    "AREAS", "AREA_FRONTEND", "AREA_BACKEND", "AREA_DEPLOYMENT", "AREA_AUTH",
    "AREA_BILLING", "AREA_DATABASE", "AREA_CONNECTOR", "AREA_PRODUCT",
    "AREA_INFRASTRUCTURE", "AREA_CONTENT", "AREA_UNKNOWN",
    "CHANGE_KINDS", "KIND_FEATURE", "KIND_BUG", "KIND_REGRESSION",
    "KIND_DEPLOYMENT", "KIND_CONFIGURATION", "KIND_DEPENDENCY",
    "KIND_SECURITY", "KIND_OPERATIONAL", "KIND_COMMUNICATION", "KIND_UNKNOWN",
    "UNC_CONFLICTING_EVIDENCE", "UNC_PRODUCTION_UNVERIFIED",
    "UNC_DEPLOY_OUTCOME_UNKNOWN", "UNC_NO_DECISIVE_EVIDENCE",
    "UNC_SINGLE_SOURCE", "UNC_THIN_EVIDENCE", "UNC_TOPICAL_LINK_ONLY",
    "UNC_STALE_EVIDENCE", "UNC_UNDATED_EVIDENCE",
    "UNC_UNKNOWN_AFFECTED_SCOPE",
    "IMP_PRODUCTION_BROKEN", "IMP_FIX_NOT_PROVEN_LIVE",
    "IMP_PREVIEW_ONLY_VERIFIED", "IMP_VERIFIED_LIVE", "IMP_BLOCKED_BY_CI",
    "IMP_ISSUE_OPEN", "IMP_RECURRENCE", "IMP_WORK_IN_FLIGHT",
    "IMP_REPORTED_BUT_UNCONFIRMED",
    "MAX_AREAS", "MAX_IMPLICATIONS", "MAX_UNCERTAINTY", "MAX_BLOCKERS",
    "interpret", "attach",
]
