# coding: utf-8
"""
Built-in workspace profiles.

Importing this package registers every built-in profile into the registry.
Adding a NEW workspace = drop a module here that calls register_workspace()
and add it to `_BUILTIN_MODULES`. No other code changes — the classifier,
intent parser, blueprint builder and agent planner all read the registry.
"""
import importlib

# Module names (relative to this package) that register a WorkspaceProfile.
_BUILTIN_MODULES = [
    "website", "startup", "ecommerce", "trading", "research", "game",
    "productivity",
]

_LOADED = False


def load_builtin_workspaces() -> None:
    """Idempotently import every built-in profile module so it self-registers."""
    global _LOADED
    if _LOADED:
        return
    for name in _BUILTIN_MODULES:
        importlib.import_module(f"{__name__}.{name}")
    _LOADED = True


# Load on import so `from ... import workspaces` is enough to populate.
load_builtin_workspaces()

__all__ = ["load_builtin_workspaces"]
