# coding: utf-8
# Phase A.2 — Project template model.
#
# A ProjectTemplate is a declarative DAG of specialist work: which
# agents run, in what dependency order, and what deliverable each one
# is responsible for. The Project Orchestrator (service.py) reads a
# template and instantiates the concrete run: deliverables scaffold,
# task-graph rows, and a workflow of `agent.run` job steps.
#
# Templates name ONLY agent ids that already resolve via
# `backend.services.agent.specs.get_spec` — they never invent new
# specialists (matches the coordinator's honest-routing rule). New
# specs are added per-vertical in later phases, not here.

from __future__ import annotations

from dataclasses import dataclass, field, asdict
from typing import Any, Dict, List, Optional


@dataclass(frozen=True)
class TemplateNode:
    """One node of a project template DAG.

    key               — stable identifier within the template (e.g.
                         "research"). Used as the deliverable's node_id
                         and to wire dependencies.
    agent_id          — must resolve via specs.get_spec(); the
                         orchestrator falls back to "supervisor" if it
                         doesn't (defensive — never blocks a run).
    title             — human-readable label rendered in the FE.
    deliverable_kind  — typed kind tag for the produced artifact (e.g.
                         "research_report"). Opaque beyond the FE
                         renderer that switches on it.
    task_instructions — the task description handed to the agent as its
                         user message.
    depends_on        — keys of OTHER nodes whose deliverables this one
                         consumes. Empty = root node.
    """
    key:               str
    agent_id:          str
    title:             str
    deliverable_kind:  str
    task_instructions: str
    depends_on:        List[str] = field(default_factory=list)

    def to_dict(self) -> Dict[str, Any]:
        return asdict(self)


@dataclass(frozen=True)
class ProjectTemplate:
    """A named, reusable multi-agent project plan."""
    id:          str
    name:        str
    description: str
    nodes:       List[TemplateNode] = field(default_factory=list)
    # Loose tag mapped onto the workflow `type` column. The workflow
    # store normalises unknown values to "research", so any string is
    # safe; we keep it descriptive for observability.
    workflow_type: str = "research"

    # ── Derived helpers ──────────────────────────────────────────────

    @property
    def node_keys(self) -> List[str]:
        return [n.key for n in self.nodes]

    @property
    def lead_agent_id(self) -> str:
        """The root agent of the run — used as the run row's agent_id.
        First dependency-free node, else the first node, else
        supervisor."""
        for n in self.nodes:
            if not n.depends_on:
                return n.agent_id
        return self.nodes[0].agent_id if self.nodes else "supervisor"

    def validate(self) -> None:
        """Raise TemplateError on a malformed template: duplicate keys,
        a dependency on an unknown key, a self-dependency, or a
        dependency cycle. Called by the catalog on registration and by
        the orchestrator before instantiation."""
        keys = self.node_keys
        if len(set(keys)) != len(keys):
            raise TemplateError(f"template {self.id!r} has duplicate node keys")
        known = set(keys)
        for n in self.nodes:
            for d in n.depends_on:
                if d not in known:
                    raise TemplateError(
                        f"template {self.id!r} node {n.key!r} depends on "
                        f"unknown key {d!r}"
                    )
                if d == n.key:
                    raise TemplateError(
                        f"template {self.id!r} node {n.key!r} depends on itself"
                    )
        cyc = _detect_cycle(self.nodes)
        if cyc:
            raise TemplateError(
                f"template {self.id!r} has a dependency cycle involving: "
                f"{', '.join(cyc)}"
            )

    def to_dict(self) -> Dict[str, Any]:
        return {
            "id":          self.id,
            "name":        self.name,
            "description": self.description,
            "workflow_type": self.workflow_type,
            "nodes":       [n.to_dict() for n in self.nodes],
        }


class TemplateError(ValueError):
    """Raised on a malformed template. Carries a stable `code` the
    route layer maps to an envelope error."""
    code = "project_template_invalid"


def _detect_cycle(nodes: List[TemplateNode]) -> Optional[List[str]]:
    """Kahn's algorithm over node keys. Returns the keys involved in a
    cycle, or None when the DAG is acyclic. Mirrors the workflow
    runner's `steps.detect_cycle` so template + workflow validation are
    consistent."""
    if not nodes:
        return None
    in_degree: Dict[str, int] = {n.key: 0 for n in nodes}
    forward: Dict[str, List[str]] = {n.key: [] for n in nodes}
    for n in nodes:
        for dep in n.depends_on:
            if dep in in_degree:
                in_degree[n.key] += 1
                forward[dep].append(n.key)
    ready = [k for k, deg in in_degree.items() if deg == 0]
    visited = 0
    while ready:
        k = ready.pop()
        visited += 1
        for child in forward[k]:
            in_degree[child] -= 1
            if in_degree[child] == 0:
                ready.append(child)
    if visited == len(nodes):
        return None
    return sorted(k for k, deg in in_degree.items() if deg > 0)


__all__ = ["TemplateNode", "ProjectTemplate", "TemplateError"]
