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

# Result-magnitude guard for exponentiation. Python int is arbitrary-
# precision so `OverflowError` never fires for huge integer powers;
# without a pre-check, expressions like `9**9**9` block the event loop
# computing a 370M-digit number, defeating any asyncio timeout above.
# Bound the estimated result bit-length to a few thousand bits — more
# than enough for any honest financial / scientific math.
_MAX_POW_RESULT_BITS = 10_000      # ~3000 decimal digits
_MAX_POW_EXPONENT    = 10_000


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


def _check_pow_magnitude(base: Any, exp: Any) -> None:
    """Refuse exponentiation whose result would blow up memory / CPU.

    Only `int ** int` is risky: Python ints are arbitrary precision so
    `9 ** 9 ** 9` blocks the event loop computing a 370M-digit number.
    Float-based exponentiation (`float ** X` or `X ** float`) always
    returns a bounded IEEE 754 double in O(1) — either a normal value,
    `+/-inf`, `0.0`, or raises `OverflowError` — so no DoS risk and
    legit math like `0.5 ** 10000`, `0.999 ** 5001`, `2.0 ** 5001`
    must pass through.

    For the int-int case: estimate the result's bit length as
    base_bits * |exp|. Reject when that exceeds _MAX_POW_RESULT_BITS
    or when |exp| exceeds _MAX_POW_EXPONENT regardless of base."""
    # bool is a subclass of int but always tiny — treat conservatively
    # as the int branch so a hypothetical True**huge_int still trips.
    if not (isinstance(base, int) and isinstance(exp, int)):
        return

    abs_exp = abs(exp)
    if abs_exp > _MAX_POW_EXPONENT:
        raise _UnsafeExpression(
            f"exponent magnitude too large (|exp|>{_MAX_POW_EXPONENT})"
        )

    base_bits = base.bit_length() or 1
    if base_bits * abs_exp > _MAX_POW_RESULT_BITS:
        raise _UnsafeExpression(
            f"result magnitude too large (~{int(base_bits * abs_exp)} bits, "
            f"cap {_MAX_POW_RESULT_BITS})"
        )


def _safe_pow(base: Any, exp: Any, mod: Any = None) -> Any:
    """Whitelist-callable pow() with the same magnitude guard as `**`."""
    if mod is not None:
        # Three-arg pow is bounded: result fits in mod's magnitude.
        return pow(base, exp, mod)
    _check_pow_magnitude(base, exp)
    return pow(base, exp)


# Function whitelist — every function here must be pure, total, and have
# no side effects. Adding entries is the only way the surface grows.
_ALLOWED_FUNCS: Dict[str, Callable[..., Any]] = {
    "abs":   abs,
    "round": round,
    "min":   min,
    "max":   max,
    "pow":   _safe_pow,
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
        op_type = type(node.op)
        op = _ALLOWED_BINOPS.get(op_type)
        if op is None:
            raise _UnsafeExpression(f"binary operator {op_type.__name__} not allowed")
        left  = _safe_eval(node.left)
        right = _safe_eval(node.right)
        if op_type is ast.Pow:
            _check_pow_magnitude(left, right)
        return op(left, right)

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
