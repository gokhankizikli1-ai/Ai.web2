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


# ══════════════════════════════════════════════════════════════════════════
# Prose is not a stock question — the false-positive fix
# ══════════════════════════════════════════════════════════════════════════

def test_ordinary_prose_is_never_read_as_a_price_question():
    """Two substring bugs made ordinary sentences look like finance queries:
    the asset list matched INSIDE words ("consequence" and "months" both
    contain "ons"/ounce, "coincide" contains "coin"), and the typo corrector
    turned everyday words into tickers one edit away ("and" → AMD).

    Together they routed an inline project question — "list the changes, each
    with its source and date, and skip any consequence no source records" —
    to a live stock lookup."""
    sentences = (
        "List the changes, each with its source and date, and skip any "
        "consequence no source records.",
        "The last few months of work have been about onboarding.",
        "These two releases coincide with the pricing page rewrite.",
        "Tell me what the shareholders meeting decided.",
    )
    for sentence in sentences:
        lower = sentence.lower()
        assert detect_finance_intent(sentence, lower) is None, sentence
        intent = detect_web_search_intent(sentence)
        assert intent.kind != "finance", (sentence, intent.triggers)


def test_a_real_price_question_still_fires_after_the_fix():
    """The narrowing must not cost a single true positive."""
    for query in ("NVDA kaç dolar", "ncda kaç dolar", "bitcoin ne kadar",
                  "gram altın kaç tl", "what is the price of ETH",
                  "nvidia hissesi kaç dolar", "ons altın fiyatı"):
        assert requires_live_data(query), query
        assert detect_web_search_intent(query).kind == "finance", query


def test_the_typo_corrector_is_confined_to_short_queries():
    """A typo'd ticker query is short by nature. On a long sentence the
    correction can only invent a question the user did not ask, so it does not
    run there."""
    short = detect_finance_intent("ncda kaç dolar", "ncda kaç dolar")
    assert short is not None and short[1] == "NVDA"

    long_sentence = ("I would like a summary of everything that happened this "
                     "week and any consequence of the deployment we shipped")
    assert detect_finance_intent(long_sentence, long_sentence.lower()) is None
