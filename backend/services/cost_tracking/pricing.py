# coding: utf-8
"""
Centralized AI pricing table — the SINGLE source of truth for what a
provider call costs (Web Build cost tracking, Phase 14M).

Requirement (task #5): pricing MUST NOT be hardcoded throughout the
codebase. Every module that needs to turn token usage or a paid tool
call into USD imports from here. There is exactly one place to edit
when a provider changes a price.

Design:

  • Token prices are stored PER 1,000,000 TOKENS (the unit every
    provider publishes), split into the dimensions providers actually
    bill separately:
        input          — normal (uncached) input / prompt tokens
        output         — completion tokens (a reasoning model bills its
                          hidden reasoning tokens as output; the provider
                          already folds them into output_tokens, so we do
                          NOT double-count reasoning)
        cached_input   — cache-READ input tokens (billed at a discount)
        cache_write    — cache-CREATION tokens (Anthropic prompt caching)

  • Non-token costs (image generation, web search, embeddings by call,
    third-party APIs, deployment/sandbox seconds) are stored as flat
    per-unit prices in `_TOOL_PRICES`.

  • `compute_call_cost()` is the reconciliation function: given a
    normalized TokenUsage it returns a CostBreakdown with the five
    fields the task asks for (input/output/cache/additional-tool/total).

Honesty contract (task #9): when a provider returns NO usage data the
caller passes `usage_missing=True`; cost is NOT silently estimated as
zero — the breakdown carries `usage_missing` so aggregation can report
it. compute_call_cost never invents token counts.

Prices below are conservative public list prices (USD). They are
intentionally slightly rounded UP where ambiguous — over-estimating
spend is the safe direction for a cost guardrail. Update the tables,
not the call sites.
"""
from __future__ import annotations

from dataclasses import dataclass, field
from typing import Dict, Optional, Tuple


# ─────────────────────────────────────────────────────────────────────────────
# Token pricing model
# ─────────────────────────────────────────────────────────────────────────────
@dataclass(frozen=True)
class ModelPrice:
    """USD per 1,000,000 tokens, per billing dimension.

    `cached_input` defaults to `input` (no cache discount known) and
    `cache_write` defaults to `input` as well — a safe over-estimate
    until a provider-specific number is filled in.
    """
    input:        float
    output:       float
    cached_input: Optional[float] = None   # cache-READ discount rate
    cache_write:  Optional[float] = None   # cache-CREATION rate

    def read_rate(self) -> float:
        return self.cached_input if self.cached_input is not None else self.input

    def write_rate(self) -> float:
        return self.cache_write if self.cache_write is not None else self.input


# Provider families whose provider-reported `input_tokens` field ALREADY
# INCLUDES the cached tokens (so cache-read must be subtracted before
# billing the uncached input). OpenAI + Google report this way. Anthropic
# reports cache-read tokens as a SEPARATE additive field, so its input
# tokens are already the uncached count.
_CACHED_IS_SUBSET_OF_INPUT = {"openai", "google", "azure", "deepseek", ""}


# Per-1M token prices, keyed by lowercase model id. Longest-prefix match
# wins in `resolve_model_price` so "gpt-4o-mini-2024-07-18" resolves to
# the "gpt-4o-mini" row, not the shorter "gpt-4o" row.
_MODEL_PRICES: Dict[str, ModelPrice] = {
    # ── OpenAI ────────────────────────────────────────────────────────
    "gpt-4o-mini":            ModelPrice(input=0.15,  output=0.60,  cached_input=0.075),
    "gpt-4o":                 ModelPrice(input=5.0,   output=15.0,  cached_input=2.5),
    "gpt-4.1-mini":           ModelPrice(input=0.40,  output=1.60,  cached_input=0.10),
    "gpt-4.1":                ModelPrice(input=2.0,   output=8.0,   cached_input=0.50),
    "gpt-4-turbo":            ModelPrice(input=10.0,  output=30.0),
    "gpt-5.6":                ModelPrice(input=10.0,  output=30.0,  cached_input=1.25),
    "gpt-5":                  ModelPrice(input=10.0,  output=30.0,  cached_input=1.25),
    "o1-mini":                ModelPrice(input=1.10,  output=4.40,  cached_input=0.55),
    "o1":                     ModelPrice(input=15.0,  output=60.0,  cached_input=7.5),
    "o3-mini":                ModelPrice(input=1.10,  output=4.40,  cached_input=0.55),
    # Embeddings (priced per-1M input tokens; no output dimension).
    "text-embedding-3-small": ModelPrice(input=0.02,  output=0.0),
    "text-embedding-3-large": ModelPrice(input=0.13,  output=0.0),
    # ── Anthropic ─────────────────────────────────────────────────────
    # Anthropic reports cache-read + cache-creation as separate fields.
    "claude-3-haiku":         ModelPrice(input=0.25,  output=1.25,  cached_input=0.03,  cache_write=0.30),
    "claude-3-5-haiku":       ModelPrice(input=0.80,  output=4.0,   cached_input=0.08,  cache_write=1.0),
    "claude-3-5-sonnet":      ModelPrice(input=3.0,   output=15.0,  cached_input=0.30,  cache_write=3.75),
    "claude-3-7-sonnet":      ModelPrice(input=3.0,   output=15.0,  cached_input=0.30,  cache_write=3.75),
    "claude-sonnet-4":        ModelPrice(input=3.0,   output=15.0,  cached_input=0.30,  cache_write=3.75),
    "claude-sonnet":          ModelPrice(input=3.0,   output=15.0,  cached_input=0.30,  cache_write=3.75),
    "claude-3-opus":          ModelPrice(input=15.0,  output=75.0,  cached_input=1.50,  cache_write=18.75),
    "claude-opus-4":          ModelPrice(input=15.0,  output=75.0,  cached_input=1.50,  cache_write=18.75),
    "claude-opus":            ModelPrice(input=15.0,  output=75.0,  cached_input=1.50,  cache_write=18.75),
    "claude-haiku":           ModelPrice(input=0.80,  output=4.0,   cached_input=0.08,  cache_write=1.0),
    # ── Google Gemini ─────────────────────────────────────────────────
    "gemini-2.5-pro":         ModelPrice(input=1.25,  output=10.0,  cached_input=0.31),
    "gemini-2.5-flash":       ModelPrice(input=0.30,  output=2.50,  cached_input=0.075),
    "gemini-2.0-flash":       ModelPrice(input=0.10,  output=0.40,  cached_input=0.025),
    "gemini-1.5-pro":         ModelPrice(input=1.25,  output=5.0,   cached_input=0.31),
    "gemini-1.5-flash":       ModelPrice(input=0.075, output=0.30,  cached_input=0.01875),
    "gemini":                 ModelPrice(input=1.25,  output=10.0,  cached_input=0.31),
}

# Used when a model id matches nothing above. Deliberately expensive so
# an unrecognised model over-estimates rather than under-counts spend.
_FALLBACK_MODEL_PRICE = ModelPrice(input=5.0, output=15.0)


# ─────────────────────────────────────────────────────────────────────────────
# Non-token (tool) pricing model
# ─────────────────────────────────────────────────────────────────────────────
# Flat USD per unit. `unit` is documentation only. These cover task #4:
# image generation, web search, embeddings-by-call, third-party APIs,
# deployment/sandbox execution.
@dataclass(frozen=True)
class ToolPrice:
    usd_per_unit: float
    unit:         str = "call"


_TOOL_PRICES: Dict[str, ToolPrice] = {
    # ── Image generation (per image; provider list prices) ────────────
    "image.gpt-image-1.low":       ToolPrice(0.011, "image"),
    "image.gpt-image-1.medium":    ToolPrice(0.042, "image"),
    "image.gpt-image-1.high":      ToolPrice(0.167, "image"),
    "image.gpt-image-1":           ToolPrice(0.042, "image"),
    "image.dall-e-3":              ToolPrice(0.040, "image"),
    "image.dall-e-3.hd":           ToolPrice(0.080, "image"),
    "image.stability.core":        ToolPrice(0.030, "image"),
    "image.stability":             ToolPrice(0.030, "image"),
    "image":                       ToolPrice(0.040, "image"),   # generic fallback
    # ── Web search / research (per query) ─────────────────────────────
    "search.tavily":               ToolPrice(0.008, "query"),
    "search.exa":                  ToolPrice(0.005, "query"),
    "search.brave":                ToolPrice(0.003, "query"),
    "search":                      ToolPrice(0.008, "query"),   # generic fallback
    # ── Stock photo lookups (mostly free tiers; nominal) ──────────────
    "stock.pexels":                ToolPrice(0.0, "query"),
    "stock.unsplash":              ToolPrice(0.0, "query"),
    # ── Third-party market data (per call) ────────────────────────────
    "api.finnhub":                 ToolPrice(0.0, "call"),
    "api.twelvedata":              ToolPrice(0.0, "call"),
    # ── Deployment / sandbox execution (per second, measurable) ───────
    "sandbox.execution":           ToolPrice(0.0000463, "second"),   # ~$0.167/hr
    "deploy.build":                ToolPrice(0.0, "build"),
}

_FALLBACK_TOOL_PRICE = ToolPrice(0.0, "call")


# ─────────────────────────────────────────────────────────────────────────────
# Resolution helpers
# ─────────────────────────────────────────────────────────────────────────────
def normalize_model(model: Optional[str]) -> str:
    return (model or "").strip().lower()


def resolve_model_price(model: Optional[str]) -> Tuple[ModelPrice, bool]:
    """Return (price, matched). `matched` is False when we fell back to
    the generic price (surfaced so callers/tests can assert on it)."""
    key = normalize_model(model)
    if not key:
        return _FALLBACK_MODEL_PRICE, False
    exact = _MODEL_PRICES.get(key)
    if exact is not None:
        return exact, True
    # Longest-prefix match so the most specific row wins.
    best_name = ""
    for name in _MODEL_PRICES:
        if key.startswith(name) and len(name) > len(best_name):
            best_name = name
    if best_name:
        return _MODEL_PRICES[best_name], True
    return _FALLBACK_MODEL_PRICE, False


def resolve_tool_price(tool_key: Optional[str]) -> Tuple[ToolPrice, bool]:
    key = (tool_key or "").strip().lower()
    if not key:
        return _FALLBACK_TOOL_PRICE, False
    exact = _TOOL_PRICES.get(key)
    if exact is not None:
        return exact, True
    # Fall back on the coarser namespace prefix (e.g. "image.foo" → "image").
    head = key.split(".", 1)[0]
    coarse = _TOOL_PRICES.get(head)
    if coarse is not None:
        return coarse, True
    return _FALLBACK_TOOL_PRICE, False


def cached_is_subset(provider: Optional[str]) -> bool:
    """Whether cache-read tokens are already counted inside input_tokens
    for this provider (OpenAI/Google) vs reported separately (Anthropic)."""
    return (provider or "").strip().lower() in _CACHED_IS_SUBSET_OF_INPUT


# ─────────────────────────────────────────────────────────────────────────────
# Cost computation
# ─────────────────────────────────────────────────────────────────────────────
@dataclass
class CostBreakdown:
    """The five cost fields task #5 requires, plus provenance."""
    input_cost_usd:            float = 0.0
    output_cost_usd:           float = 0.0
    cache_cost_usd:            float = 0.0
    additional_tool_cost_usd:  float = 0.0
    total_call_cost_usd:       float = 0.0
    usage_missing:             bool = False
    price_matched:             bool = True   # False ⇒ fell back to generic price

    def as_dict(self) -> Dict[str, object]:
        return {
            "input_cost_usd":           round(self.input_cost_usd, 6),
            "output_cost_usd":          round(self.output_cost_usd, 6),
            "cache_cost_usd":           round(self.cache_cost_usd, 6),
            "additional_tool_cost_usd": round(self.additional_tool_cost_usd, 6),
            "total_call_cost_usd":      round(self.total_call_cost_usd, 6),
            "usage_missing":            self.usage_missing,
            "price_matched":            self.price_matched,
        }


def _m(tokens: float, rate_per_1m: float) -> float:
    return (float(tokens) / 1_000_000.0) * float(rate_per_1m)


def compute_call_cost(
    *,
    provider:              Optional[str],
    model:                 Optional[str],
    input_tokens:          int = 0,
    output_tokens:         int = 0,
    cached_input_tokens:   int = 0,
    cache_creation_tokens: int = 0,
    reasoning_tokens:      int = 0,          # informational; already in output
    additional_tool_cost_usd: float = 0.0,
    usage_missing:         bool = False,
) -> CostBreakdown:
    """Turn a normalized usage record into a CostBreakdown.

    When `usage_missing` is True the token cost is zero but the flag is
    carried through so aggregation never mistakes a missing measurement
    for a genuinely-free call (task #9). Non-token (`additional_tool_cost_usd`)
    is always billed — it is measured independently of provider usage.
    """
    price, matched = resolve_model_price(model)
    add = max(0.0, float(additional_tool_cost_usd or 0.0))

    if usage_missing:
        return CostBreakdown(
            input_cost_usd=0.0, output_cost_usd=0.0, cache_cost_usd=0.0,
            additional_tool_cost_usd=add, total_call_cost_usd=round(add, 6),
            usage_missing=True, price_matched=matched,
        )

    in_t    = max(0, int(input_tokens or 0))
    out_t   = max(0, int(output_tokens or 0))
    cread   = max(0, int(cached_input_tokens or 0))
    cwrite  = max(0, int(cache_creation_tokens or 0))

    # If the provider folds cache-read into input_tokens (OpenAI/Google),
    # bill the uncached remainder at the full rate and the cached subset
    # at the discounted read rate. If reported separately (Anthropic),
    # input_tokens is already the uncached count.
    if cached_is_subset(provider):
        uncached_in = max(0, in_t - cread)
    else:
        uncached_in = in_t

    input_cost  = _m(uncached_in, price.input)
    output_cost = _m(out_t,       price.output)
    cache_cost  = _m(cread, price.read_rate()) + _m(cwrite, price.write_rate())
    total = input_cost + output_cost + cache_cost + add

    return CostBreakdown(
        input_cost_usd=round(input_cost, 6),
        output_cost_usd=round(output_cost, 6),
        cache_cost_usd=round(cache_cost, 6),
        additional_tool_cost_usd=round(add, 6),
        total_call_cost_usd=round(total, 6),
        usage_missing=False,
        price_matched=matched,
    )


def compute_tool_cost(tool_key: str, units: float = 1.0) -> Tuple[float, bool]:
    """USD for a non-token paid tool call (image/search/embedding-by-call/
    third-party/sandbox). Returns (usd, price_matched)."""
    price, matched = resolve_tool_price(tool_key)
    usd = round(max(0.0, float(units)) * price.usd_per_unit, 6)
    return usd, matched


def pricing_snapshot() -> Dict[str, object]:
    """Public-safe dump of the whole table for the admin dashboard and
    for operators to confirm what's configured — no secrets involved."""
    return {
        "unit": "usd_per_1m_tokens",
        "models": {
            name: {
                "input": p.input, "output": p.output,
                "cached_input": p.read_rate(), "cache_write": p.write_rate(),
            }
            for name, p in sorted(_MODEL_PRICES.items())
        },
        "fallback_model": {
            "input": _FALLBACK_MODEL_PRICE.input,
            "output": _FALLBACK_MODEL_PRICE.output,
        },
        "tools": {
            name: {"usd_per_unit": t.usd_per_unit, "unit": t.unit}
            for name, t in sorted(_TOOL_PRICES.items())
        },
    }


__all__ = [
    "ModelPrice", "ToolPrice", "CostBreakdown",
    "resolve_model_price", "resolve_tool_price", "cached_is_subset",
    "compute_call_cost", "compute_tool_cost",
    "pricing_snapshot", "normalize_model",
]
