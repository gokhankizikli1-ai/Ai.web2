# coding: utf-8
# Phase 2 — Projects service (public API).
#
# A NEW SQLite file (default `projects.db`, override via PROJECTS_DB_PATH).
# Kept separate from sessions.db and memory.db so projects can be enabled
# independently (ENABLE_PROJECTS) and have an isolated rollback (delete
# the file). Schema lives in store.py; all CRUD goes through this module.
#
# This module is import-safe even when the feature flag is off — the
# tables are created lazily on first use, and helpers return graceful
# fallbacks when the store isn't initialized.

from backend.services.projects.store import (
    init,
    # projects
    create_project, get_project, list_projects, update_project, delete_project,
    # memory
    add_memory, list_memory, delete_memory,
    # threads binding
    attach_thread, detach_thread, list_project_threads, get_project_of_thread,
    # agents
    create_agent, list_agents, update_agent, delete_agent,
    # files (placeholder)
    register_file, list_files,
    # stats
    store_stats,
)

from backend.services.projects.context import (
    build_project_context_block,
)

__all__ = [
    "init",
    "create_project", "get_project", "list_projects", "update_project", "delete_project",
    "add_memory", "list_memory", "delete_memory",
    "attach_thread", "detach_thread", "list_project_threads", "get_project_of_thread",
    "create_agent", "list_agents", "update_agent", "delete_agent",
    "register_file", "list_files",
    "store_stats",
    "build_project_context_block",
]
