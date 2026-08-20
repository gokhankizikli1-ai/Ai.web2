# coding: utf-8
"""Project Intelligence — ENTITY KEYS: how two observations are proved to be
about the SAME real-world thing.

This module is pure text/structure normalization. It answers exactly one
question and holds no state:

    "which stable, project-local identities does this observation touch?"

THREE CLASSES OF KEY, AND WHY THE DISTINCTION IS LOAD-BEARING
--------------------------------------------------------------
LINK keys   A concrete, unambiguous resource identity that different sources
            can independently name: a commit sha, a repo-scoped branch, a
            repo-scoped PR or issue number. Two observations sharing one of
            these ARE about the same work — a Vercel deployment carrying
            `git.commit_sha` and a GitHub commit with that sha are the same
            change, whatever words either of them uses. LINK keys merge with
            each other and with corroborated TOPIC keys.

GROUP keys  A recurring TARGET rather than a piece of work: a deployment
            target, a CI check, a calendar event. These are the right identity
            for supersession ("the latest deploy to production wins" — the
            same rule `project_brain.attention` already uses) but they are the
            WRONG identity for merging: every production deploy for the life of
            the project shares one target key, so allowing a target to merge
            into a topic would drag months of unrelated deploys into it. GROUP
            keys therefore merge ONLY with an identical GROUP key, never with a
            LINK or TOPIC key.

TOPIC keys  A normalized two-word phrase drawn from bounded human text. This is
            the only way a Slack sentence can ever join a GitHub PR, and it is
            also the only place false correlation can be manufactured — so it
            is deliberately the weakest and most heavily guarded class:

              * a topic is a BIGRAM, never a single word. "payment" alone
                cannot merge "payment button colour" into "payment webhook
                failure".
              * at least one of the two words must be DISTINCTIVE (outside
                `GENERIC_TOKENS`), so "production deployment" — two words that
                describe half the events in any project — forms no key at all.
              * the caller (`correlation`) additionally requires the bigram to
                appear from TWO DIFFERENT SOURCES before it may merge anything.

Together those three rules are what make "deploy documentation" and
"production deployment failed" stay apart while "PR: fix payment webhook
retry" and "payment webhook'a bakıyor" come together.

NORMALIZATION
-------------
Text is casefolded, stripped of combining marks (so Turkish `ı ş ğ ç ö ü`
fold onto ASCII and a Turkish sentence tokenizes the same way an English one
does), split on non-word characters (so `webhook'a` → `webhook` + `a`, and
`fix/payment-webhook` → `fix` + `payment` + `webhook`), emptied of stopwords,
and passed through a SMALL EXPLICIT synonym table plus one conservative plural
rule. The table is explicit rather than a real stemmer precisely so a reader
can see every collapse it performs.

COST: pure functions over bounded strings. ZERO I/O, ZERO model tokens.
"""
from __future__ import annotations

import re
import unicodedata
from typing import Any, Dict, Iterable, List, Optional, Sequence, Set, Tuple

# ── Key namespaces ───────────────────────────────────────────────────────────
KEY_TOPIC = "topic"
KEY_COMMIT = "commit"
KEY_BRANCH = "branch"
KEY_PR = "pr"
KEY_ISSUE = "issue"
KEY_DEPLOY = "deploy"
KEY_CI = "ci"
KEY_MEETING = "meeting"

#: Identities that merge with each other and with corroborated topics.
LINK_NAMESPACES = frozenset({KEY_COMMIT, KEY_BRANCH, KEY_PR, KEY_ISSUE})
#: Recurring targets: merge only with an identical key. See the docstring.
GROUP_NAMESPACES = frozenset({KEY_DEPLOY, KEY_CI, KEY_MEETING})

# ── Bounds ───────────────────────────────────────────────────────────────────
#: Characters of human text scanned per observation. Titles and chat lines are
#: far shorter than this; a pasted stack trace is truncated rather than allowed
#: to generate hundreds of bigrams.
MAX_TEXT_CHARS = 400
#: Topic bigrams kept per observation, in first-seen order.
MAX_TOPIC_KEYS = 4
#: Structural keys kept per observation.
MAX_LINK_KEYS = 6

_WORD_SPLIT = re.compile(r"[^0-9A-Za-z]+")
_SHA_RE = re.compile(r"\b[0-9a-f]{7,40}\b")
_PR_URL_RE = re.compile(
    r"https?://(?:www\.)?github\.com/([\w.-]+)/([\w.-]+)/pull/(\d+)", re.I)
_ISSUE_URL_RE = re.compile(
    r"https?://(?:www\.)?github\.com/([\w.-]+)/([\w.-]+)/issues/(\d+)", re.I)
_COMMIT_URL_RE = re.compile(
    r"https?://(?:www\.)?github\.com/([\w.-]+)/([\w.-]+)/commit/([0-9a-f]{7,40})", re.I)

#: Words carrying no subject at all. Removed before bigrams are formed, so
#: "webhook'a bakıyor" yields the adjacency `webhook bakiyor`.
_STOPWORDS = frozenset({
    # English
    "a", "an", "and", "are", "as", "at", "be", "been", "but", "by", "can",
    "did", "do", "does", "for", "from", "get", "got", "had", "has", "have",
    "he", "her", "his", "how", "i", "if", "in", "into", "is", "it", "its",
    "just", "me", "my", "no", "not", "of", "on", "one", "or", "our", "out",
    "she", "so", "than", "that", "the", "their", "them", "then", "there",
    "these", "they", "this", "to", "up", "us", "was", "we", "were", "what",
    "when", "which", "who", "why", "will", "with", "would", "you", "your",
    "am", "any", "all", "also", "now", "only", "over", "some", "still",
    "anyone", "someone", "seen", "see", "look", "looking", "please", "thanks",
    # Turkish (the product's second language; same folding path)
    "acaba", "ama", "bana", "ben", "bir", "biz", "bu", "buna", "bunu", "çok",
    "cok", "da", "de", "daha", "diye", "eden", "gibi", "hem", "her", "ile",
    "icin", "için", "ise", "ki", "kim", "mi", "mu", "ne", "niye", "o", "onu",
    "sen", "siz", "su", "şu", "tum", "tüm", "var", "ve", "veya", "ya", "yok",
    "olarak", "sonra", "once", "önce", "kadar", "yine",
})

#: Real words that are far too common inside a software project to identify a
#: subject on their own. A bigram made of two of these forms NO key — that is
#: what stops "production deployment" from becoming an entity that swallows the
#: whole project.
GENERIC_TOKENS = frozenset({
    "alert", "api", "app", "branch", "bug", "build", "call", "change",
    "check", "code", "commit", "deploy", "email", "error", "fail", "feature",
    "fix", "issue", "job", "live", "log", "mail", "main", "meeting", "merge",
    "message", "new", "notification", "page", "payment", "problem", "prod",
    "product", "production", "project", "pull", "release", "report",
    "request", "review", "run", "server", "service", "site", "staging",
    "status", "task", "test", "update", "user", "version", "website", "work",
})

#: Branch names that name a LANE, not a piece of work. Never a link key.
_GENERIC_BRANCHES = frozenset({
    "main", "master", "develop", "development", "dev", "staging", "stage",
    "production", "prod", "release", "trunk", "default", "next", "canary",
})

#: Explicit, inspectable collapses. Deliberately small — a real stemmer would
#: make correlation harder to reason about, and over-stemming manufactures
#: false matches, which is the one failure mode this layer must not have.
_SYNONYMS: Dict[str, str] = {
    "deployment": "deploy", "deployments": "deploy", "deploys": "deploy",
    "deployed": "deploy", "deploying": "deploy",
    "failure": "fail", "failures": "fail", "failed": "fail",
    "failing": "fail", "fails": "fail",
    "errors": "error", "erroring": "error",
    "builds": "build", "building": "build", "built": "build",
    "fixes": "fix", "fixed": "fix", "fixing": "fix",
    "issues": "issue", "bugs": "bug",
    "releases": "release", "released": "release", "releasing": "release",
    "updates": "update", "updated": "update", "updating": "update",
    "webhooks": "webhook", "payments": "payment", "checkouts": "checkout",
    "retries": "retry", "retrying": "retry", "retried": "retry",
    "customers": "customer", "users": "user", "signups": "signup",
    "onboarding": "onboard", "onboarded": "onboard",
    "invoices": "invoice", "subscriptions": "subscription",
    "buttons": "button", "pages": "page", "sites": "site",
    "servers": "server", "services": "service", "tests": "test",
    "reviews": "review", "requests": "request", "reports": "report",
    "merged": "merge", "merges": "merge", "merging": "merge",
    "commits": "commit", "committed": "commit",
    "checks": "check", "checked": "check", "checking": "check",
}

#: Plurals we will not strip: a trailing "s" that is part of the word.
_PLURAL_KEEP_SUFFIXES = ("ss", "us", "is", "as", "os")

# ── Turkish agglutinative suffixes ───────────────────────────────────────────
# Turkish glues case/possessive/plural endings straight onto the noun, and the
# apostrophe that would separate them is only REQUIRED for proper nouns. So a
# developer writes "payment webhook'a bakıyor" one day and "payment webhookta
# hata var" the next, and only the first tokenizes back to `webhook`.
#
# Blind stripping is not an option: "update" ends in -e, "site" in -e, "release"
# in -e. Strip those and English vocabulary dissolves.
#
# So a suffix is only ever removed when the STEM IS INDEPENDENTLY ATTESTED in
# the same project's own text (see `suffix_alias_map`). `webhookta` folds onto
# `webhook` only because some other observation actually said `webhook`. That
# makes over-collapse structurally impossible rather than merely unlikely: a
# fold cannot invent a stem the project never used, so this is a lookup against
# observed vocabulary, not a stemmer.
#
# Longest-first, so `webhooklarda` loses `larda` rather than `da`.
_TR_SUFFIXES = (
    "larinda", "lerinde", "larindan", "lerinden",
    "larda", "lerde", "lardan", "lerden", "larin", "lerin", "lari", "leri",
    "daki", "deki", "taki", "teki",
    "ndan", "nden", "nda", "nde",
    "dan", "den", "tan", "ten",
    "lar", "ler", "nin", "nun",
    "da", "de", "ta", "te", "ya", "ye", "yi", "yu",
    "in", "un", "im", "um",
    "i", "u", "a", "e",
)
#: A stem shorter than this is too small to trust ("site" → "sit" is a mangling,
#: not a fold).
_MIN_STEM_CHARS = 4


def _known_words() -> frozenset:
    """Vocabulary we recognise as words in their own right and therefore never
    treat as a suffixed form ("update", "release", "service", "site")."""
    return frozenset(GENERIC_TOKENS) | frozenset(_SYNONYMS) | frozenset(_SYNONYMS.values())


def suffix_alias_map(tokens: Iterable[str]) -> Dict[str, str]:
    """`{suffixed_variant: stem}` over ONE project's observed vocabulary.

    A variant folds only when every one of these holds:
      * it is not itself a word we recognise (so `update` is never touched);
      * it ends in an explicit Turkish suffix;
      * the remaining stem is at least `_MIN_STEM_CHARS` long;
      * **the stem was independently written by some observation in this same
        batch** — the guard that makes this safe.

    Pure, bounded by the caller's already-capped token set, and deterministic."""
    attested = {str(t) for t in tokens if t}
    known = _known_words()
    alias: Dict[str, str] = {}
    for token in sorted(attested):          # sorted ⇒ deterministic
        if token in known or len(token) <= _MIN_STEM_CHARS:
            continue
        for suffix in _TR_SUFFIXES:
            if not token.endswith(suffix):
                continue
            stem = token[: -len(suffix)]
            if len(stem) < _MIN_STEM_CHARS or stem == token:
                continue
            if stem in attested:
                alias[token] = stem
                break
    return alias


def apply_alias(key: str, alias: Dict[str, str]) -> str:
    """Rewrite a topic key's words through an alias map. Non-topic keys and
    empty maps pass straight through."""
    if not alias or not is_topic_key(key):
        return key
    words = topic_label(key).split()
    folded = [alias.get(w, w) for w in words]
    if folded == words:
        return key
    if len(folded) == 2 and folded[0] == folded[1]:
        return key                      # folding must not create "x x"
    return f"{KEY_TOPIC}:{' '.join(folded)}"


#: Letters that NFKD does NOT decompose, so removing combining marks alone
#: would leave them non-ASCII and the word splitter would tear the word in
#: half (`bakıyor` → `bak` + `yor`). Turkish dotless-ı is the one that matters
#: for this product; the rest are the other common no-decomposition Latin
#: letters, folded for the same reason.
_FOLD_MAP = str.maketrans({
    "ı": "i", "ø": "o", "ł": "l", "đ": "d", "ð": "d", "ħ": "h", "ŧ": "t",
    "þ": "th", "æ": "ae", "œ": "oe",
})


def _fold(text: str) -> str:
    """Casefold and drop combining marks, so `İşğüö` and `isguo` tokenize the
    same. NFKD then removing Mn maps most Turkish diacritics onto ASCII;
    `_FOLD_MAP` covers the letters NFKD leaves alone (see above)."""
    decomposed = unicodedata.normalize(
        "NFKD", str(text or "").casefold().translate(_FOLD_MAP))
    return "".join(ch for ch in decomposed if not unicodedata.combining(ch))


def normalize_token(word: str) -> str:
    """One word → its canonical form ("" when it carries no subject)."""
    token = _fold(word).strip()
    if len(token) < 2 or token.isdigit():
        return ""
    if token in _STOPWORDS:
        return ""
    mapped = _SYNONYMS.get(token)
    if mapped:
        return mapped
    if (len(token) >= 5 and token.endswith("s")
            and not token.endswith(_PLURAL_KEEP_SUFFIXES)):
        singular = token[:-1]
        # Re-check the table: "webhooks" is handled above, but a plural we did
        # not enumerate still collapses onto its singular's synonym if it has
        # one ("deployments" → "deployment" → "deploy").
        token = _SYNONYMS.get(singular, singular)
    if token in _STOPWORDS:
        return ""
    return token


def tokenize(text: Any) -> List[str]:
    """Bounded text → the ordered list of significant, canonical tokens."""
    raw = str(text or "")[:MAX_TEXT_CHARS]
    if not raw.strip():
        return []
    # Fold BEFORE splitting. `_WORD_SPLIT` treats every non-ASCII character as
    # a separator, so folding afterwards would be too late: `bakıyor` would
    # already have been torn into `bak` + `yor`, and a Turkish sentence would
    # tokenize into fragments that match nothing.
    out: List[str] = []
    for word in _WORD_SPLIT.split(_fold(raw)):
        if not word:
            continue
        token = normalize_token(word)
        if token:
            out.append(token)
    return out


def topic_keys(text: Any) -> List[str]:
    """Bounded text → its candidate TOPIC keys, in first-seen order.

    A key is a bigram of ADJACENT significant tokens in which at least one
    token is distinctive. Both-generic bigrams ("production deploy") and any
    single word are deliberately not keys — see the module docstring."""
    tokens = tokenize(text)
    seen: Set[str] = set()
    out: List[str] = []
    for left, right in zip(tokens, tokens[1:]):
        if left == right:
            continue
        if left in GENERIC_TOKENS and right in GENERIC_TOKENS:
            continue     # two common words prove nothing
        key = f"{KEY_TOPIC}:{left} {right}"
        if key in seen:
            continue
        seen.add(key)
        out.append(key)
        if len(out) >= MAX_TOPIC_KEYS:
            break
    return out


def topic_label(key: str) -> str:
    """`topic:payment webhook` → `payment webhook` (display-safe by
    construction: it is normalized words from text the connector already
    surfaced to the user)."""
    return key.split(":", 1)[1] if ":" in key else key


def namespace_of(key: str) -> str:
    return key.split(":", 1)[0] if ":" in key else ""


def is_link_key(key: str) -> bool:
    return namespace_of(key) in LINK_NAMESPACES


def is_group_key(key: str) -> bool:
    return namespace_of(key) in GROUP_NAMESPACES


def is_topic_key(key: str) -> bool:
    return namespace_of(key) == KEY_TOPIC


# ── structural key builders ──────────────────────────────────────────────────

def _slug(value: Any, limit: int = 120) -> str:
    return _fold(str(value or "")).strip()[:limit]


def repo_key(repo: Any) -> str:
    """`Acme/Site` → `acme/site`. A repo is a SCOPE, never a key of its own —
    otherwise everything in one repository would be one entity."""
    return _slug(repo, 140)


def commit_key(sha: Any) -> Optional[str]:
    """Commit shas are compared on their first 12 characters: GitHub, Vercel
    and chat links all abbreviate them differently, and 12 hex characters is
    far past the point of collision inside one project."""
    sha_txt = _slug(sha, 40)
    if len(sha_txt) < 7 or not all(c in "0123456789abcdef" for c in sha_txt):
        return None
    return f"{KEY_COMMIT}:{sha_txt[:12]}"


def branch_key(repo: Any, ref: Any) -> Optional[str]:
    """A repo-scoped branch. Generic lane names (`main`, `production`) are NOT
    keys — every change on a project passes through them."""
    repo_txt = repo_key(repo)
    ref_txt = _slug(ref, 160)
    if not repo_txt or not ref_txt:
        return None
    ref_txt = ref_txt.split("refs/heads/")[-1].strip("/")
    if not ref_txt or ref_txt in _GENERIC_BRANCHES:
        return None
    return f"{KEY_BRANCH}:{repo_txt}:{ref_txt}"


def pr_key(repo: Any, number: Any) -> Optional[str]:
    repo_txt = repo_key(repo)
    num = _slug(number, 12)
    if not repo_txt or not num.isdigit():
        return None
    return f"{KEY_PR}:{repo_txt}#{num}"


def issue_key(repo: Any, number: Any) -> Optional[str]:
    repo_txt = repo_key(repo)
    num = _slug(number, 12)
    if not repo_txt or not num.isdigit():
        return None
    return f"{KEY_ISSUE}:{repo_txt}#{num}"


def deploy_key(provider: Any, resource: Any, target: Any) -> Optional[str]:
    """The recurring deployment TARGET (a GROUP key). Mirrors the subject
    `project_brain.attention` already supersedes on."""
    provider_txt = _slug(provider, 40)
    if not provider_txt:
        return None
    return (f"{KEY_DEPLOY}:{provider_txt}:{_slug(resource, 120)}:"
            f"{_slug(target, 60) or 'default'}")


def ci_key(repo: Any, name: Any) -> Optional[str]:
    repo_txt = repo_key(repo)
    name_txt = _slug(name, 120)
    if not (repo_txt or name_txt):
        return None
    return f"{KEY_CI}:{repo_txt}:{name_txt}"


def meeting_key(event_id: Any) -> Optional[str]:
    ident = _slug(event_id, 160)
    return f"{KEY_MEETING}:{ident}" if ident else None


def refs_from_text(text: Any) -> List[str]:
    """LINK keys named EXPLICITLY inside human text — the only structural join
    a chat message or an email can contribute.

    Only fully-qualified GitHub URLs are read. A bare "#712" is deliberately
    ignored: without a repository it is not an identity, and guessing one is
    exactly the kind of confident-but-wrong merge this layer must not make."""
    raw = str(text or "")[:MAX_TEXT_CHARS]
    if "github.com/" not in raw.lower():
        return []
    out: List[str] = []
    seen: Set[str] = set()
    for regex, builder in ((_PR_URL_RE, pr_key), (_ISSUE_URL_RE, issue_key),
                           (_COMMIT_URL_RE, None)):
        for match in regex.finditer(raw):
            owner, repo, tail = match.group(1), match.group(2), match.group(3)
            key = (commit_key(tail) if builder is None
                   else builder(f"{owner}/{repo}", tail))
            if key and key not in seen:
                seen.add(key)
                out.append(key)
            if len(out) >= MAX_LINK_KEYS:
                return out
    return out


__all__ = [
    "KEY_TOPIC", "KEY_COMMIT", "KEY_BRANCH", "KEY_PR", "KEY_ISSUE",
    "KEY_DEPLOY", "KEY_CI", "KEY_MEETING",
    "LINK_NAMESPACES", "GROUP_NAMESPACES", "GENERIC_TOKENS",
    "MAX_TEXT_CHARS", "MAX_TOPIC_KEYS", "MAX_LINK_KEYS",
    "normalize_token", "tokenize", "topic_keys", "topic_label",
    "suffix_alias_map", "apply_alias",
    "namespace_of", "is_link_key", "is_group_key", "is_topic_key",
    "repo_key", "commit_key", "branch_key", "pr_key", "issue_key",
    "deploy_key", "ci_key", "meeting_key", "refs_from_text",
]
