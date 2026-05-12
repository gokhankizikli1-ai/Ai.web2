# coding: utf-8
"""
Phase 6d — calculator tool unit tests.

Coverage:
  - Pure arithmetic produces correct results
  - Math functions (sqrt, log, abs, round, min, max) work
  - Constants (pi, e, tau) resolve
  - Empty / oversized input produces _error (not _ok)
  - Hostile inputs (__import__, attribute access, lambda, list comp)
    produce _error (status="error") — never crash, never execute
  - Division by zero produces a clean _error
  - Result envelope shape: tool, status, data, message, provider, timestamp
"""
from __future__ import annotations

import asyncio
import math

import pytest

from backend.services.tools.calculator_tool import CalculatorTool


def _run(query: str = "", **context) -> dict:
    return asyncio.run(CalculatorTool().run(query, context))


# ── Successful evaluations ───────────────────────────────────────────────

def test_simple_addition():
    r = _run(expression="1 + 2")
    assert r["status"] == "available"
    assert r["data"]["result"] == 3
    assert r["data"]["expression"] == "1 + 2"


def test_power_and_floor_div():
    assert _run(expression="2 ** 10")["data"]["result"] == 1024
    assert _run(expression="17 // 5")["data"]["result"] == 3
    assert _run(expression="17 % 5")["data"]["result"] == 2


def test_unary_minus():
    assert _run(expression="-(2 + 3)")["data"]["result"] == -5


def test_functions():
    assert _run(expression="sqrt(144)")["data"]["result"] == 12.0
    assert _run(expression="abs(-7)")["data"]["result"] == 7
    assert _run(expression="round(3.14159, 2)")["data"]["result"] == 3.14
    assert _run(expression="min(1, 2, 3)")["data"]["result"] == 1
    assert _run(expression="max(1, 2, 3)")["data"]["result"] == 3


def test_constants():
    assert abs(_run(expression="pi")["data"]["result"] - math.pi) < 1e-12
    assert abs(_run(expression="log(e)")["data"]["result"] - 1.0) < 1e-12
    assert abs(_run(expression="tau / 2")["data"]["result"] - math.pi) < 1e-12


def test_envelope_shape_on_success():
    r = _run(expression="1 + 1")
    assert set(r.keys()) >= {"tool", "status", "data", "message", "provider", "timestamp"}
    assert r["tool"] == "calculator"
    assert r["provider"] == "builtin"
    assert r["status"] == "available"
    assert r["message"] is None


# ── Error cases that should NOT crash ────────────────────────────────────

def test_empty_expression():
    r = _run(expression="")
    assert r["status"] == "error"
    assert "no expression" in r["message"]


def test_oversized_expression():
    big = "1+" * 200 + "1"
    r = _run(expression=big)
    assert r["status"] == "error"
    assert "too long" in r["message"]


def test_division_by_zero():
    r = _run(expression="1 / 0")
    assert r["status"] == "error"
    assert "division by zero" in r["message"]


def test_syntax_error():
    r = _run(expression="1 + + +")
    assert r["status"] == "error"


# ── Hostile inputs must be REJECTED ──────────────────────────────────────

@pytest.mark.parametrize("expr", [
    "__import__('os').system('echo pwn')",
    "__builtins__",
    "open('/etc/passwd')",
    "exec('print(1)')",
    "eval('1+1')",
    "(1).__class__",
    "().__class__.__bases__",
    "[x for x in range(10)]",
    "lambda x: x",
    "globals()",
])
def test_hostile_inputs_rejected(expr):
    r = _run(expression=expr)
    assert r["status"] == "error", f"expected error for {expr!r}, got {r!r}"
    # Must mention the disallowed/parse problem, never have executed.
    assert "result" not in (r.get("data") or {})


def test_attribute_access_rejected():
    r = _run(expression="math.pi")
    assert r["status"] == "error"


def test_string_literal_rejected():
    r = _run(expression="'hi'")
    assert r["status"] == "error"


# ── Argument plumbing — query vs context.expression ──────────────────────

def test_query_argument_fallback():
    # When `expression` isn't in context, the query positional arg is used.
    r = asyncio.run(CalculatorTool().run("3 * 4", {}))
    assert r["status"] == "available"
    assert r["data"]["result"] == 12


def test_context_overrides_query():
    # Context.expression wins over query if both supplied.
    r = asyncio.run(CalculatorTool().run("999", {"expression": "1 + 1"}))
    assert r["data"]["result"] == 2


# ── DoS guard on exponentiation ──────────────────────────────────────────
# Python int is arbitrary-precision so `9**9**9` doesn't raise
# OverflowError — without a pre-check it allocates a ~370M-digit number,
# blocks the event loop, and the asyncio timeout in dispatch_one can't
# fire. The magnitude guard must refuse these expressions in O(1).

@pytest.mark.parametrize("expr", [
    "9 ** 9 ** 9",            # the canonical Bugbot example
    "2 ** 100000",
    "100 ** 100000",
    "pow(2, 100000)",
    "(2 ** 50) ** 1000",      # nested: outer pow's exp = 1000, base ~50 bits
])
def test_oversized_exponentiation_rejected_in_constant_time(expr):
    r = _run(expression=expr)
    assert r["status"] == "error"
    assert "magnitude" in r["message"] or "exponent" in r["message"]
    # The result key must not exist — proves no huge int was computed.
    assert "result" not in (r.get("data") or {})


def test_reasonable_exponentiation_still_works():
    # 2^64 is a regular 64-bit integer.
    assert _run(expression="2 ** 64")["data"]["result"] == 2 ** 64
    # 1.05**360 (monthly compounding 30y) is everyday finance math.
    r = _run(expression="1.05 ** 360")
    assert r["status"] == "available"
    assert abs(r["data"]["result"] - 1.05 ** 360) < 1e-3
    # pow() function: same guard applies but should accept reasonable args.
    assert _run(expression="pow(2, 32)")["data"]["result"] == 2 ** 32
