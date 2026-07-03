# coding: utf-8
"""Finance / current-price live-research routing.

Regression guard for the bug where price questions like "NVDA kaç dolar"
(and the typo "ncda kaç dolar") did NOT trigger live web research and the
model answered from memory. Any current price / market / stock / crypto /
FX / commodity query must route to live data (or a corrected-ticker lookup)
— never a guessed number.

Pure-function tests: web_search_intent imports only stdlib, so these run
without the backend app/services booted.
"""
from backend.services.tool_extraction.web_search_intent import (
    detect_web_search_intent,
    detect_finance_intent,
    requires_live_data,
)


# Every one of these MUST route to live data.
FINANCE_MUST_TRIGGER = [
    "NVDA kaç dolar",
    "ncda kaç dolar",          # typo → NVDA
    "NVIDIA hissesi kaç dolar",
    "bitcoin kaç dolar",
    "dolar kaç TL",
    "gram altın kaç TL",
    "TSLA fiyatı ne",
    "ethereum ne kadar",
    "apple market cap",
    "BTC kaç dolar",
]


def test_finance_price_queries_trigger_live_data():
    for q in FINANCE_MUST_TRIGGER:
        intent = detect_web_search_intent(q)
        assert intent.triggered, f"expected live trigger for: {q!r} ({intent.reason})"
        assert requires_live_data(q), f"requires_live_data should be True for: {q!r}"


def test_typo_ticker_is_corrected_in_query():
    finance = detect_finance_intent("ncda kaç dolar", "ncda kaç dolar")
    assert finance is not None
    corrected_query, ticker, _hits = finance
    assert ticker == "NVDA"
    assert "NVDA" in corrected_query          # typo fixed for the live search
    assert "ncda" not in corrected_query


def test_exact_ticker_with_price():
    finance = detect_finance_intent("NVDA kaç dolar", "nvda kaç dolar")
    assert finance is not None
    _q, ticker, _h = finance
    assert ticker == "NVDA"


def test_non_finance_still_routes_correctly():
    # Weather (temporal) still triggers via the general detector.
    assert detect_web_search_intent("bugün istanbulda hava nasıl").triggered
    # Small talk must NOT trigger, and must NOT be finance.
    assert not requires_live_data("merhaba nasılsın")
    assert detect_finance_intent("merhaba nasılsın", "merhaba nasılsın") is None
    # A plain non-price sentence containing an English word isn't finance.
    assert detect_finance_intent("write me a poem about the ocean",
                                 "write me a poem about the ocean") is None
