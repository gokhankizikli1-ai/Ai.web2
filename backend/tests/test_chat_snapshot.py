# coding: utf-8
"""
Phase 8n — quick-quote snapshot detector for trading_analyst.

A bare price ask ("NVDA fiyatı kaç?") should switch the chat to a concise
snapshot; anything asking for analysis/a setup keeps the full operator
report. Pure-function test — no network, no LLM.
"""
from __future__ import annotations

import pytest

from backend.services.ai.snapshot import is_quick_quote_ask as _is_quick_quote_ask


@pytest.mark.parametrize("msg", [
    "NVDA fiyatı kaç?",
    "NVDA price?",
    "what is the price of AAPL",
    "BTC ne kadar",
    "TSLA quote",
    "AAPL değeri nedir",
    "NVDA fiyatı ne?",          # Turkish suffix alone (Bugbot 426cd270)
    "AAPL fiyatını söyle",      # 'fiyatını' — suffixed, no companion kw
    "What is NVDA trading at?", # 'trading at' not blocked by 'trade' (d3e57c72)
])
def test_quick_quote_true(msg):
    assert _is_quick_quote_ask(msg) is True


@pytest.mark.parametrize("msg", [
    "",
    "NVDA analiz",                                  # analysis intent
    "give me a full setup and trade plan for NVDA",  # setup/plan
    "should I buy NVDA now?",                        # should i / buy decision
    "NVDA entry and stop please",                    # entry/stop
    "detaylı analiz ve risk planı istiyorum NVDA",   # analiz/risk/plan
    "tell me about NVDA outlook and forecast",       # outlook/forecast
    "Is NVDA worth buying?",                         # worth + buy → analysis (084f59c6)
    "Is AAPL worth investing in?",                   # worth + invest → analysis
    "x" * 200 + " price",                            # too long to be a quick ask
])
def test_quick_quote_false(msg):
    assert _is_quick_quote_ask(msg) is False
