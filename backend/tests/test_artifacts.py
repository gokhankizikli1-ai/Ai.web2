# coding: utf-8
"""EPIC 1 / M2 — artifact engine unit tests.

Pure function (no I/O), so these are fast + deterministic. Covers the
supported artifact types and the "non-empty + previewable" guarantees.
"""
from __future__ import annotations

from backend.services.orchestrator.artifacts import (
    build_artifact, looks_like_html,
    ARTIFACT_HTML, ARTIFACT_MARKDOWN, ARTIFACT_REACT_COMPONENT,
    ARTIFACT_FILE_TREE,
)


def test_html_artifact_is_previewable_and_nonempty():
    reply = (
        "Here is the page:\n\n```html\n"
        "<!DOCTYPE html><html><head><style>body{}</style></head>"
        "<body><h1>Hi</h1></body></html>\n```\nDone."
    )
    art = build_artifact(kind="landing_page_html", title="Landing", text=reply)
    assert art["type"] == ARTIFACT_HTML
    assert art["preview"] == "iframe"
    assert art["content"].lstrip().lower().startswith("<!doctype html")
    assert "<h1>Hi</h1>" in art["content"]
    assert art["download"]["filename"].endswith(".html")
    assert art["download"]["mime"] == "text/html"
    assert len(art["content"]) > 0


def test_bare_html_detected_without_fence():
    reply = "<!DOCTYPE html><html><body><main>App</main></body></html>"
    assert looks_like_html(reply)
    art = build_artifact(kind="app_prototype_html", title="Proto", text=reply)
    assert art["type"] == ARTIFACT_HTML and art["preview"] == "iframe"
    assert "<main>App</main>" in art["content"]


def test_markdown_is_the_default():
    art = build_artifact(kind="app_concept", title="Concept", text="## Concept\nGreat app")
    assert art["type"] == ARTIFACT_MARKDOWN
    assert art["preview"] == "markdown"
    assert art["content"].strip() != ""
    assert art["download"]["filename"].endswith(".md")


def test_react_component_artifact():
    reply = "```tsx\nimport React from 'react';\nexport default function App(){ return <div/>; }\n```"
    art = build_artifact(kind="react_component", title="App", text=reply)
    assert art["type"] == ARTIFACT_REACT_COMPONENT
    assert art["language"] == "tsx"
    assert "export default" in art["content"]
    assert art["download"]["filename"].endswith(".tsx")


def test_file_tree_artifact_parses_files():
    reply = (
        "### src/App.tsx\n```tsx\nexport default function App(){}\n```\n"
        "### index.html\n```html\n<div id=root></div>\n```\n"
    )
    art = build_artifact(kind="file_list", title="Files", text=reply)
    assert art["type"] == ARTIFACT_FILE_TREE
    paths = {f["path"] for f in art["files"]}
    assert {"src/App.tsx", "index.html"} <= paths
    assert art["download"].get("zip_ready_bundle") is True


def test_unparseable_file_list_falls_back_to_markdown():
    reply = "```tsx\nexport default function App(){ return <div/>; }\n```"
    art = build_artifact(kind="file_list", title="Files", text=reply)
    assert art["type"] == ARTIFACT_MARKDOWN
    assert art["preview"] == "markdown"
    assert art["files"] == []


def test_never_empty_even_on_garbage():
    art = build_artifact(kind="", title="", text="   ")
    assert art["type"] == ARTIFACT_MARKDOWN
    assert "filename" in art["download"]
