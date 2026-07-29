"""Resolve the effective workflow for a project (PRD §12).

A project either has a custom ``Workflow`` (team-authored, strict graph) or falls
back to the built-in default (permissive, from apps.tasks.statuses). Everything
that needs a status's label, category or allowed transitions goes through here so
there is one source of truth.
"""
from __future__ import annotations

from apps.tasks.statuses import (
    DEFAULT_STATUSES,
    DEFAULT_TRANSITIONS,
    INITIAL_STATUS,
    StatusCategory,
)

BUILTIN_STATUSES = [
    {"key": key, "label": label, "category": cat, "order": i, "is_initial": key == INITIAL_STATUS}
    for i, (key, label, cat) in enumerate(DEFAULT_STATUSES)
]


class ResolvedWorkflow:
    def __init__(self, statuses: list[dict], transitions: set | None, initial: str, strict: bool, source: str):
        self.statuses = statuses
        self._by_key = {s["key"]: s for s in statuses}
        self.transitions = transitions
        self.initial = initial
        self.strict = strict
        self.source = source

    def keys(self) -> set[str]:
        return set(self._by_key)

    def label_for(self, key: str) -> str:
        return self._by_key.get(key, {}).get("label", key)

    def category_for(self, key: str) -> str:
        return self._by_key.get(key, {}).get("category", StatusCategory.NOT_STARTED)

    def allowed(self, from_key: str, to_key: str) -> bool:
        """True if the transition is permitted. Permissive workflows allow all."""
        if not self.strict or self.transitions is None:
            return True
        if from_key == to_key:
            return True
        return (from_key, to_key) in self.transitions

    def next_keys(self, from_key: str) -> list[str]:
        if not self.strict or self.transitions is None:
            return [s["key"] for s in self.statuses]
        return [to for (frm, to) in self.transitions if frm == from_key]

    def as_dict(self) -> dict:
        return {
            "source": self.source,
            "strict": self.strict,
            "initial": self.initial,
            "statuses": self.statuses,
            "transitions": [{"from": f, "to": t} for (f, t) in sorted(self.transitions or [])],
        }


def builtin() -> ResolvedWorkflow:
    return ResolvedWorkflow(
        statuses=BUILTIN_STATUSES,
        transitions=set(DEFAULT_TRANSITIONS),
        initial=INITIAL_STATUS,
        strict=False,          # built-in default never rejects a transition
        source="default",
    )


def from_workflow(wf) -> ResolvedWorkflow:
    statuses = [
        {"key": s.key, "label": s.label, "category": s.category, "order": s.order, "is_initial": s.is_initial}
        for s in wf.statuses.all()
    ]
    transitions = {
        (t.from_status.key, t.to_status.key)
        for t in wf.transitions.select_related("from_status", "to_status")
    }
    init = wf.initial_status.key if wf.initial_status else (statuses[0]["key"] if statuses else INITIAL_STATUS)
    return ResolvedWorkflow(statuses=statuses, transitions=transitions, initial=init, strict=True, source="custom")


def resolve(project) -> ResolvedWorkflow:
    wf = getattr(project, "custom_workflow", None)
    return from_workflow(wf) if wf is not None else builtin()


def resolve_cached(project, cache: dict) -> ResolvedWorkflow:
    """Resolve with per-request caching keyed by project id (avoids N+1)."""
    if project.id not in cache:
        cache[project.id] = resolve(project)
    return cache[project.id]
