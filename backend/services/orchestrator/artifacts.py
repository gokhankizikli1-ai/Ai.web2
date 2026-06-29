# coding: utf-8
# EPIC 1 / M2 — Artifact engine.
#
# Turns a specialist agent's raw text reply into a TYPED, previewable
# artifact stored on the deliverable (`content.artifact`). This is what
# makes project outputs "real": an HTML page renders in an iframe, a
# React component / project file is copy+download-ready, a file list is
# a structured tree, everything else is markdown.
#
# Pure + deterministic (no LLM, no I/O) so it's fully unit-testable. The
# agent.run handler calls build_artifact() after run_agent returns; the
# frontend switches on artifact.type to render Preview / Copy / Download
# / Open.

from __future__ import annotations

import re
from typing import Any, Dict, List, Optional

# ── Supported artifact types (requirement #1) ────────────────────────
ARTIFACT_MARKDOWN        = "markdown"
ARTIFACT_HTML            = "html"
ARTIFACT_REACT_COMPONENT = "react_component"
ARTIFACT_PROJECT_FILE    = "project_file"
ARTIFACT_FILE_TREE       = "file_tree"
ARTIFACT_ZIP_BUNDLE      = "zip_ready_bundle"

ARTIFACT_TYPES = (
    ARTIFACT_MARKDOWN, ARTIFACT_HTML, ARTIFACT_REACT_COMPONENT,
    ARTIFACT_PROJECT_FILE, ARTIFACT_FILE_TREE, ARTIFACT_ZIP_BUNDLE,
)

# How the frontend should render each type.
_PREVIEW_FOR = {
    ARTIFACT_HTML:            "iframe",
    ARTIFACT_REACT_COMPONENT: "code",
    ARTIFACT_PROJECT_FILE:    "code",
    ARTIFACT_FILE_TREE:       "file_tree",
    ARTIFACT_ZIP_BUNDLE:      "file_tree",
    ARTIFACT_MARKDOWN:        "markdown",
}

# Deliverable kinds that should yield an HTML page artifact.
_HTML_KINDS = {"landing_page_html", "app_prototype_html", "html", "web_page"}
# Deliverable kinds that should yield a React component artifact.
_REACT_KINDS = {"react_component", "component"}
# Deliverable kinds that should yield a multi-file tree artifact.
_FILE_TREE_KINDS = {"file_tree", "project_files", "file_list"}

_FENCE_RE = re.compile(r"```([a-zA-Z0-9_+\-]*)\s*\n(.*?)```", re.DOTALL)
# A filename hint that precedes a fenced block, e.g.
#   ### src/App.tsx          ·   **index.html**   ·   `package.json`
_FILE_HEADER_RE = re.compile(
    r"(?:^|\n)\s*(?:#{1,6}\s+|\*\*|`)?\s*"
    r"([A-Za-z0-9_./\-]+\.[A-Za-z0-9]+)\s*(?:\*\*|`)?\s*(?:\n|$)"
)


def _largest_fenced_block(text: str, langs: Optional[set] = None) -> Optional[str]:
    """Return the body of the largest fenced code block (optionally
    filtered to certain languages), or None when there are no fences."""
    blocks = [
        (lang.lower().strip(), body)
        for lang, body in _FENCE_RE.findall(text or "")
    ]
    if langs:
        blocks = [b for b in blocks if b[0] in langs or b[0] == ""]
    if not blocks:
        return None
    return max((b[1] for b in blocks), key=len).strip()


def _strip_html(text: str) -> str:
    """Extract a clean HTML document from the reply: prefer a fenced
    ```html block; else slice from the first <!doctype/<html to the end.
    Falls back to the raw text."""
    fenced = _largest_fenced_block(text, langs={"html", "xml", ""})
    candidate = fenced if (fenced and "<" in fenced) else (text or "")
    m = re.search(r"<!doctype html|<html[\s>]", candidate, re.IGNORECASE)
    if m:
        return candidate[m.start():].strip()
    return candidate.strip()


def looks_like_html(text: str) -> bool:
    head = (text or "").lstrip()[:400].lower()
    return "<!doctype html" in head or "<html" in head or bool(
        re.search(r"<(div|section|main|header|body)[\s>]", head)
    )


def _extract_files(text: str) -> List[Dict[str, str]]:
    """Best-effort parse of a multi-file reply into [{path, content,
    language}]. Pairs each filename header with the fenced block that
    follows it. Returns [] when nothing parseable is found."""
    files: List[Dict[str, str]] = []
    for m in _FENCE_RE.finditer(text or ""):
        lang = (m.group(1) or "").lower().strip()
        body = m.group(2).strip()
        # Look back up to ~120 chars for a filename header.
        prefix = (text[max(0, m.start() - 120):m.start()])
        hdr = None
        for hm in _FILE_HEADER_RE.finditer(prefix):
            hdr = hm.group(1)
        if hdr:
            files.append({"path": hdr, "content": body, "language": lang})
    return files


def _ext_for(language: str) -> str:
    return {
        "tsx": "tsx", "jsx": "jsx", "ts": "ts", "js": "js",
        "python": "py", "py": "py", "css": "css", "json": "json",
        "html": "html",
    }.get((language or "").lower(), "txt")


def build_artifact(*, kind: str, title: str, text: str) -> Dict[str, Any]:
    """Convert a raw agent reply into a typed artifact dict.

    Returns a dict shaped:
        {
          "type":     <one of ARTIFACT_TYPES>,
          "title":    str,
          "language": str,          # for code artifacts
          "content":  str,          # the artifact body
          "files":    [ {path, content, language} ],  # file_tree only
          "preview":  "iframe" | "code" | "markdown" | "file_tree",
          "download": { "filename": str, "mime": str },
        }
    Never raises; falls back to a markdown artifact for anything
    unrecognised. The raw `text` is always preserved by the caller.
    """
    kind = (kind or "").lower().strip()
    text = text or ""
    safe_title = (title or kind or "artifact")[:120]

    # ── Explicit HTML page kind ──────────────────────────────────────
    if kind in _HTML_KINDS:
        html = _strip_html(text)
        return {
            "type": ARTIFACT_HTML, "title": safe_title, "language": "html",
            "content": html, "files": [],
            "preview": _PREVIEW_FOR[ARTIFACT_HTML],
            "download": {"filename": _slugify(safe_title, "page") + ".html",
                         "mime": "text/html"},
        }

    # ── Multi-file tree (explicit kind — checked BEFORE the generic
    # HTML heuristic so a file list containing HTML snippets isn't
    # mis-typed as a single HTML page) ───────────────────────────────
    if kind in _FILE_TREE_KINDS:
        files = _extract_files(text)
        if files:
            return {
                "type": ARTIFACT_FILE_TREE, "title": safe_title, "language": "",
                "content": text, "files": files,
                "preview": _PREVIEW_FOR[ARTIFACT_FILE_TREE],
                "download": {"filename": _slugify(safe_title, "files") + ".md",
                             "mime": "text/markdown",
                             "zip_ready_bundle": True, "file_count": len(files)},
            }
        # No parseable files → render the list as markdown.

    # ── React component / single project file ────────────────────────
    if kind in _REACT_KINDS or _is_react(text):
        body = _largest_fenced_block(text, langs={"tsx", "jsx", "ts", "js", ""}) or text.strip()
        return {
            "type": ARTIFACT_REACT_COMPONENT, "title": safe_title, "language": "tsx",
            "content": body, "files": [],
            "preview": _PREVIEW_FOR[ARTIFACT_REACT_COMPONENT],
            "download": {"filename": _slugify(safe_title, "Component") + ".tsx",
                         "mime": "text/plain"},
        }
    if kind == ARTIFACT_PROJECT_FILE:
        body = _largest_fenced_block(text) or text.strip()
        return {
            "type": ARTIFACT_PROJECT_FILE, "title": safe_title, "language": "txt",
            "content": body, "files": [],
            "preview": _PREVIEW_FOR[ARTIFACT_PROJECT_FILE],
            "download": {"filename": _slugify(safe_title, "file") + ".txt",
                         "mime": "text/plain"},
        }

    # ── Generic HTML fallback ────────────────────────────────────────
    # No explicit kind matched, but the reply itself looks like an HTML
    # document/markup (e.g. a coordinator ad-hoc node that emitted a
    # page). Render it as a previewable HTML artifact.
    if looks_like_html(text):
        html = _strip_html(text)
        return {
            "type": ARTIFACT_HTML, "title": safe_title, "language": "html",
            "content": html, "files": [],
            "preview": _PREVIEW_FOR[ARTIFACT_HTML],
            "download": {"filename": _slugify(safe_title, "page") + ".html",
                         "mime": "text/html"},
        }

    # ── Default: markdown ────────────────────────────────────────────
    return {
        "type": ARTIFACT_MARKDOWN, "title": safe_title, "language": "markdown",
        "content": text.strip(), "files": [],
        "preview": _PREVIEW_FOR[ARTIFACT_MARKDOWN],
        "download": {"filename": _slugify(safe_title, "notes") + ".md",
                     "mime": "text/markdown"},
    }


def _is_react(text: str) -> bool:
    t = text or ""
    return ("export default" in t and ("=>" in t or "function" in t) and
            ("<" in t)) or "import React" in t


def _slugify(text: str, fallback: str) -> str:
    s = re.sub(r"[^a-zA-Z0-9]+", "-", (text or "").strip()).strip("-").lower()
    return s[:48] or fallback


__all__ = [
    "ARTIFACT_TYPES",
    "ARTIFACT_MARKDOWN", "ARTIFACT_HTML", "ARTIFACT_REACT_COMPONENT",
    "ARTIFACT_PROJECT_FILE", "ARTIFACT_FILE_TREE", "ARTIFACT_ZIP_BUNDLE",
    "build_artifact", "looks_like_html",
]
