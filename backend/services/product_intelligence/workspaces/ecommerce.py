# coding: utf-8
"""Ecommerce Intelligence workspace profile (planning only)."""
from backend.services.product_intelligence.registry import WorkspaceProfile, register_workspace
from backend.services.product_intelligence.types import (
    WorkspaceKind, ProductCategory, GenerationMode, InteractionStyle,
)

PROFILE = WorkspaceProfile(
    kind=WorkspaceKind.ECOMMERCE,
    title="Ecommerce Intelligence",
    keywords={
        "ecommerce": 1.3, "e-commerce": 1.3, "online store": 1.3, "store": 0.7,
        "shop": 0.9, "shopify": 1.1, "products": 0.7, "catalog": 0.9,
        "checkout": 1.1, "cart": 1.0, "dropshipping": 1.1, "sku": 0.9,
        "inventory": 0.9, "merchandising": 1.0, "storefront": 1.1,
        "sell online": 1.2, "product listing": 1.0,
    },
    patterns=[
        (r"\b(sell|selling)\s+(products|online|stuff)", 1.2),
        (r"\b(online|e-?commerce)\s+(store|shop)", 1.3),
    ],
    default_category=ProductCategory.STORE,
    default_renderer="html",
    default_generation_mode=GenerationMode.INTERACTIVE_APP,
    default_interaction=InteractionStyle.INTERACTIVE,
    typical_industry="retail",
    typical_audience="shoppers",
    typical_goal="sell products and maximise conversion",
    base_agents=["researcher", "merchandiser", "copywriter", "frontend_engineer"],
    feature_hints=[
        "Product catalog", "Product detail", "Cart", "Checkout flow",
        "Search & filters", "Promotions",
    ],
    screen_hints=["Home", "Catalog", "Product", "Cart", "Checkout", "Account"],
    information_architecture=[
        "Catalog → product → cart → checkout; account + order history",
    ],
    interaction_model="Browse → add to cart → checkout, with search/filter.",
    data_entities=["Product", "Variant", "Cart", "Order", "Customer"],
    ux_direction="Frictionless browse-to-buy, trust signals at decision points.",
    visual_direction="Product-forward, high-contrast CTAs, clean grids.",
    risks=[
        "Checkout friction reducing conversion",
        "Catalog data quality / SKU consistency",
    ],
    success_metrics=["Conversion rate", "Average order value", "Cart abandonment"],
    deliverables=["Store blueprint", "Catalog & checkout flow", "Merchandising plan"],
    future_expansion=["Payments integration", "Inventory sync", "Email marketing", "Analytics"],
)

register_workspace(PROFILE)
