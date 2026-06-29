# coding: utf-8
# Phase A.2 — Project templates public API.

from backend.services.orchestrator.templates.base import (
    ProjectTemplate, TemplateNode, TemplateError,
)
from backend.services.orchestrator.templates.builtins import (
    BUILTIN_TEMPLATES, GENERIC_RESEARCH, GENERIC_CREATION,
)
from backend.services.orchestrator.templates.catalog import (
    get_template, list_templates, build_adhoc_template, choose_template,
)

__all__ = [
    "ProjectTemplate", "TemplateNode", "TemplateError",
    "BUILTIN_TEMPLATES", "GENERIC_RESEARCH", "GENERIC_CREATION",
    "get_template", "list_templates", "build_adhoc_template", "choose_template",
]
