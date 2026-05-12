# coding: utf-8
"""
Calculator tool — pure arithmetic evaluation, no I/O, no network.

This is a SAFE tool. It does not call eval(); it walks an `ast` tree
and refuses any node that isn't on a small whitelist. The whitelist
intentionally excludes attribute access, comprehensions, lambda,
imports, name lookups outside a handful of math constants, and any
function not in ALLOWED_FUNCS. Hostile inputs like
`__import__("os").system("rm -rf /")` are rejected as soon as the
parser hits the `Attribute` / unknown `Name` / unknown `Call` node.

Activate: ENABLE_TOOLS=true ENABLE_CALCULATOR=true
"""
from __future__ import annotations

import ast
import math
import operator
from typing import Any, Callable, Dict, Type

from backend.services.tools.base_tool import BaseTool


_MAX_EXPRESSION_CHARS = 256


_ALLOWED_BINOPS: Dict[Type[ast.AST], Callable[[Any, Any], Any]] = {
    ast.Add:      operator.add,
    ast.Sub:      operator.sub,
    ast.Mult:     operator.mul,
    ast.Div:      operator.truediv,
    ast.FloorDiv: operator.floordiv,
    ast.Mod:      operator.mod,
    ast.Pow:      operator.pow,
}

_ALLOWED_UNARYOPS: Dict[Type[ast.AST], Callable[[Any], Any]] = {
    ast.UAdd: operator.pos,
    ast.USub: operator.neg,
}

# Function whitelist — every function here must be pure, total, and have
# no side effects. Adding entries is the only way the surface grows.
_ALLOWED_FUNCS: Dict[str, Callable[..., Any]] = {
    "abs":   abs,
    "round": round,
    "min":   min,
    "max":   max,
    "pow":   pow,
    "sqrt":  math.sqrt,
    "log":   math.log,
    "log10": math.log10,
    "log2":  math.log2,
    "exp":   math.exp,
    "sin":   math.sin,
    "cos":   math.cos,
    "tan":   math.tan,
    "floor": math.floor,
    "ceil":  math.ceil,
}

# Constants the parser may resolve via `ast.Name`. Anything else raises.
_ALLOWED_NAMES: Dict[str, float] = {
    "pi":  math.pi,
    "e":   math.e,
    "tau": math.tau,
}


class _UnsafeExpression(ValueError):
    """Raised when the AST contains a node not on the whitelist."""


def _safe_eval(node: ast.AST) -> Any:
    if isinstance(node, ast.Expression):
        return _safe_eval(node.body)

    if isinstance(node, ast.Constant):
        if not isinstance(node.value, (int, float)):
            raise _UnsafeExpression(
                f"only numeric literals allowed, got {type(node.value).__name__}"
            )
        return node.value

    if isinstance(node, ast.BinOp):
        op = _ALLOWED_BINOPS.get(type(node.op))
        if op is None:
            raise _UnsafeExpression(f"binary operator {type(node.op).__name__} not allowed")
        return op(_safe_eval(node.left), _safe_eval(node.right))

    if isinstance(node, ast.UnaryOp):
        op = _ALLOWED_UNARYOPS.get(type(node.op))
        if op is None:
            raise _UnsafeExpression(f"unary operator {type(node.op).__name__} not allowed")
        return op(_safe_eval(node.operand))

    if isinstance(node, ast.Name):
        if node.id not in _ALLOWED_NAMES:
            raise _UnsafeExpression(f"name {node.id!r} not allowed")
        return _ALLOWED_NAMES[node.id]

    if isinstance(node, ast.Call):
        if not isinstance(node.func, ast.Name) or node.func.id not in _ALLOWED_FUNCS:
            raise _UnsafeExpression("function call not allowed")
        if node.keywords:
            raise _UnsafeExpression("keyword arguments not allowed")
        return _ALLOWED_FUNCS[node.func.id](*[_safe_eval(a) for a in node.args])

    raise _UnsafeExpression(f"AST node {type(node).__name__} not allowed")


class CalculatorTool(BaseTool):
    name = "calculator"
    description = (
        "Evaluate a simple arithmetic expression. Supports + - * / // % ** "
        "and the functions abs round min max pow sqrt log log10 log2 exp "
        "sin cos tan floor ceil, plus constants pi e tau. No variables, "
        "no I/O, no side effects."
    )

    openai_parameters = {
        "type": "object",
        "properties": {
            "expression": {
                "type": "string",
                "description": "Arithmetic expression, e.g. '(1.05 ** 12 - 1) * 100' or 'sqrt(144) + log(e)'.",
            },
        },
        "required": ["expression"],
        "additionalProperties": True,
    }

    async def run(self, query: str = "", context: dict = None) -> dict:
        ctx = context or {}
        expression = (ctx.get("expression") or query or "").strip()
        if not expression:
            return self._error("no expression given")
        if len(expression) > _MAX_EXPRESSION_CHARS:
            return self._error(
                f"expression too long ({len(expression)} chars, max {_MAX_EXPRESSION_CHARS})"
            )

        try:
            tree = ast.parse(expression, mode="eval")
        except SyntaxError as exc:
            return self._error(f"syntax error: {exc.msg}")

        try:
            value = _safe_eval(tree)
        except _UnsafeExpression as exc:
            return self._error(f"disallowed: {exc}")
        except ZeroDivisionError:
            return self._error("division by zero")
        except OverflowError:
            return self._error("result overflow")
        except (ValueError, TypeError) as exc:
            return self._error(f"math error: {exc}")

        return self._ok(
            {
                "expression": expression,
                "result":     value,
            },
            provider="builtin",
        )


__all__ = ["CalculatorTool"]
