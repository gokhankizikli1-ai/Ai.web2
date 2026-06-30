# coding: utf-8
"""Game Development workspace profile (planning only — no implementation)."""
from backend.services.product_intelligence.registry import WorkspaceProfile, register_workspace
from backend.services.product_intelligence.types import (
    WorkspaceKind, ProductCategory, GenerationMode, InteractionStyle,
)

PROFILE = WorkspaceProfile(
    kind=WorkspaceKind.GAME,
    title="Game Development",
    keywords={
        "game": 1.3, "gameplay": 1.2, "platformer": 1.2, "rpg": 1.2,
        "puzzle game": 1.2, "shooter": 1.1, "arcade": 1.1, "level": 0.7,
        "player": 0.8, "score": 0.6, "enemy": 0.8, "sprite": 1.0,
        "2d game": 1.2, "3d game": 1.2, "multiplayer": 1.0, "leaderboard": 0.9,
        "game mechanic": 1.2, "physics": 0.7,
    },
    patterns=[
        (r"\b(make|build|create)\s+(a|an)?\s*(game|platformer|rpg)", 1.3),
        (r"\bgame\s+(mechanic|loop|engine)", 1.1),
    ],
    default_category=ProductCategory.GAME,
    default_renderer="simulation",
    default_generation_mode=GenerationMode.SIMULATION,
    default_interaction=InteractionStyle.REALTIME,
    typical_industry="entertainment",
    typical_audience="players",
    typical_goal="deliver an engaging, replayable loop",
    base_agents=["game_designer", "game_developer", "qa_engineer"],
    feature_hints=[
        "Core game loop", "Controls", "Win/lose conditions", "Scoring",
        "Levels/progression", "Audio/feedback",
    ],
    screen_hints=["Main menu", "Game screen", "Pause", "Game over", "Leaderboard"],
    information_architecture=[
        "Menu → game loop → game over → restart; optional leaderboard",
    ],
    interaction_model="Real-time input loop (keyboard/touch) with game state.",
    data_entities=["Player", "Entity", "Level", "Score"],
    ux_direction="Immediate feedback, low input latency, clear objectives.",
    visual_direction="Cohesive art style, readable sprites, juicy feedback.",
    risks=[
        "Unbounded scope (engine vs. prototype)",
        "Performance of the render/update loop",
    ],
    success_metrics=["Session length", "Retention", "Frame stability"],
    deliverables=["Game design blueprint", "Mechanics & loop spec", "Screen/state list"],
    future_expansion=["Asset pipeline", "Multiplayer", "Persistence/leaderboards"],
)

register_workspace(PROFILE)
