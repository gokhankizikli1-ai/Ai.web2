# coding: utf-8
import logging
from backend.tools.base import VeloraTool

logger = logging.getLogger(__name__)

# Tool registry - all disabled until real handlers are implemented
_TOOLS: dict[str, VeloraTool] = {
    "web_search": VeloraTool(
        name="web_search",
        description="Search the web for current information",
        required_inputs=["query"],
        safety_level="safe",
        enabled=False,
    ),
    "crypto_price": VeloraTool(
        name="crypto_price",
        description="Get real-time cryptocurrency price",
        required_inputs=["symbol"],
        safety_level="safe",
        enabled=False,
    ),
    "stock_price": VeloraTool(
        name="stock_price",
        description="Get real-time stock price",
        required_inputs=["symbol"],
        safety_level="safe",
        enabled=False,
    ),
    "market_data": VeloraTool(
        name="market_data",
        description="Get market overview and sentiment data",
        required_inputs=["asset_type"],
        safety_level="safe",
        enabled=False,
    ),
    "product_research": VeloraTool(
        name="product_research",
        description="Research product demand and competition",
        required_inputs=["product_name"],
        safety_level="safe",
        enabled=False,
    ),
    "code_review": VeloraTool(
        name="code_review",
        description="Review and analyze code",
        required_inputs=["code"],
        safety_level="safe",
        enabled=False,
    ),
    "startup_validator": VeloraTool(
        name="startup_validator",
        description="Validate startup idea against market signals",
        required_inputs=["idea"],
        safety_level="safe",
        enabled=False,
    ),
}


def get_tool(name: str) -> VeloraTool | None:
    return _TOOLS.get(name)


def list_enabled_tools() -> list[str]:
    return [t.name for t in _TOOLS.values() if t.enabled]


def list_all_tools() -> list[dict]:
    return [
        {
            "name": t.name,
            "description": t.description,
            "enabled": t.enabled,
            "safety_level": t.safety_level,
        }
        for t in _TOOLS.values()
    ]


async def run_tool(name: str, **kwargs) -> dict:
    tool = get_tool(name)
    if not tool:
        return {"available": False, "message": "Tool not found: " + name}
    return await tool.run(**kwargs)


def select_tools_for_intent(intent: str, mode: str) -> list[str]:
    """
    Returns list of tool names relevant to this intent.
    Currently all disabled - returns empty list.
    When tools are enabled, this logic will activate them.
    """
    mapping = {
        "finance":          ["market_data", "crypto_price", "stock_price"],
        "crypto":           ["crypto_price", "market_data"],
        "stock":            ["stock_price", "market_data"],
        "product_research": ["product_research", "web_search"],
        "ecommerce":        ["product_research", "web_search"],
        "coding":           ["code_review"],
        "startup":          ["startup_validator", "web_search"],
        "general_question": ["web_search"],
    }
    candidates = mapping.get(intent, []) + mapping.get(mode, [])
    enabled = list_enabled_tools()
    return [t for t in candidates if t in enabled]  # only enabled ones
