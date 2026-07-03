# coding: utf-8
"""
Game Dev Module Registry — KorvixAI Game Builder knowledge layer.

This is the structured "mechanic module library" + "game UI kit" + "build
quality tiers" the `game_developer` AI mode draws on so it doesn't invent
every mechanic and every screen from scratch. It is NOT executed and it does
NOT touch the editor — it is prompt-side guidance compiled into a compact
reference block that is appended to the mode's system prompt.

Design goals:
  * Real, useful entries (not empty placeholders) — each module states what it
    is for, the files/scripts/classes it needs, its UI dependencies, the
    game-feel touches that make it not-flat, and its security/edge notes.
  * Compact — this becomes part of a system prompt, so every line is a
    menu item + quality standard, not an essay.
  * Two engines only — Roblox Studio (Luau, server-authoritative) and
    Unreal Engine 5 (component-based Blueprint/C++).

The mode SELECTS the relevant modules/templates for a given prompt and builds
with their quality rules. Adding a module here raises generation quality
everywhere without any UI change.
"""
from __future__ import annotations

from typing import Dict, List


# ── Mechanic modules ───────────────────────────────────────────────────────
# Each entry: purpose | files (where the logic lives) | feel (game-feel adds)
# | notes (security / edge / validation). Kept to single lines so the compiled
# block stays prompt-sized.

ROBLOX_MODULES: Dict[str, Dict[str, str]] = {
    "health-system": {
        "purpose": "Player/NPC HP with damage, regen, death + respawn.",
        "files": "ServerScriptService/HealthService (Script), ReplicatedStorage/Shared/HealthConfig (ModuleScript), StarterGui HealthBar (LocalScript).",
        "feel": "Damage flash, low-HP vignette + heartbeat, hit indicator, smooth bar tween, death screen fade.",
        "notes": "Server owns HP; damage applied server-side only; never trust client damage values; clamp 0..MaxHP.",
    },
    "currency-system": {
        "purpose": "Soft/hard currency earn + spend, leaderstats surface.",
        "files": "ServerScriptService/EconomyService (Script), ReplicatedStorage/Shared/EconomyConfig (ModuleScript), Remotes/RequestSpend (RemoteEvent).",
        "feel": "Coin pickup pop + sound, animated counter roll-up, floating +amount text, insufficient-funds shake.",
        "notes": "All balances live server-side; client only requests; validate cost + affordability on server; no client-set balance.",
    },
    "shop-system": {
        "purpose": "Buy items/upgrades with currency; catalog defined in config.",
        "files": "ServerScriptService/ShopService (Script), ReplicatedStorage/Shared/ShopCatalog (ModuleScript), Remotes/PurchaseItem (RemoteFunction), StarterGui ShopModal (LocalScript).",
        "feel": "Card hover lift, buy button pulse, purchase confirm toast, locked-item greyscale.",
        "notes": "Server re-checks price + ownership + funds before granting; idempotent grants; reject unknown itemId.",
    },
    "inventory-system": {
        "purpose": "Grid inventory: hold/stack/equip/drop items.",
        "files": "ServerScriptService/InventoryService (Script), ReplicatedStorage/Shared/ItemDefs (ModuleScript), Remotes/InventoryAction (RemoteEvent), StarterGui InventoryGrid (LocalScript).",
        "feel": "Drag-drop tween, slot hover highlight, equip glow, stack-count badge, full-inventory warning.",
        "notes": "Server authoritative slots; validate slot bounds + item existence; server confirms equip/drop.",
    },
    "quest-system": {
        "purpose": "Accept/track/complete objectives with rewards.",
        "files": "ServerScriptService/QuestService (Script), ReplicatedStorage/Shared/QuestDefs (ModuleScript), Remotes/QuestUpdate (RemoteEvent), StarterGui QuestTracker (LocalScript).",
        "feel": "New-quest slide-in, progress tick sound, checkmark pop on step, reward burst on complete.",
        "notes": "Server tracks progress + grants rewards; client only displays; guard double-completion.",
    },
    "checkpoint-system": {
        "purpose": "Save progress points; respawn at last checkpoint.",
        "files": "ServerScriptService/CheckpointService (Script), Workspace/Checkpoints (Folder of parts), ReplicatedStorage/Shared/CheckpointConfig (ModuleScript).",
        "feel": "Activation ring + sound, 'Checkpoint reached' toast, subtle glow on active pad.",
        "notes": "Server records reached checkpoint per player; debounce touch; validate order if linear.",
    },
    "data-store-system": {
        "purpose": "Persist player data across sessions.",
        "files": "ServerScriptService/DataService (Script), ReplicatedStorage/Shared/DefaultProfile (ModuleScript).",
        "feel": "Load spinner while fetching, 'saved' micro-toast on autosave, graceful offline banner.",
        "notes": "Wrap ALL DataStore calls in pcall + retry/backoff; session lock; BindToClose flush; versioned schema; never overwrite on failed load.",
    },
    "pet-system": {
        "purpose": "Collectible pets that follow player + grant bonuses.",
        "files": "ServerScriptService/PetService (Script), ReplicatedStorage/Shared/PetDefs (ModuleScript), Remotes/EquipPet (RemoteEvent), StarterGui PetInventory (LocalScript).",
        "feel": "Smooth follow lerp + bobbing, equip sparkle, rarity color glow, hatch reveal animation.",
        "notes": "Server owns owned/equipped pets + bonus math; validate equip count cap; grant only server-side.",
    },
    "tycoon-upgrade-system": {
        "purpose": "Buy droppers/upgrades; passive income; rebirths.",
        "files": "ServerScriptService/TycoonService (Script), ReplicatedStorage/Shared/TycoonConfig (ModuleScript), Remotes/BuyUpgrade (RemoteEvent).",
        "feel": "Buy-pad prompt, unlock build animation, income +tick float, rebirth flash + multiplier bump.",
        "notes": "Server validates funds + upgrade tier order; income accrues server-side; guard rebirth requirements.",
    },
    "enemy-ai-basic": {
        "purpose": "Patrol → detect → chase → attack NPC state machine.",
        "files": "ServerScriptService/EnemyAIService (Script), ReplicatedStorage/Shared/EnemyConfig (ModuleScript), ServerStorage/EnemyModel.",
        "feel": "Aggro sting sound, telegraph windup before attack, stagger on hit, search-then-give-up state.",
        "notes": "Server drives pathfinding + damage; use PathfindingService; rate-limit attacks; leash range.",
    },
    "flashlight-system": {
        "purpose": "Toggleable light with battery drain (horror staple).",
        "files": "StarterPlayer/StarterCharacterScripts/FlashlightClient (LocalScript), ReplicatedStorage/Shared/FlashlightConfig (ModuleScript), StarterGui BatteryHUD (LocalScript).",
        "feel": "F toggles, battery drains over time, low-battery flicker, smooth SpotLight tween, click SFX hook, enemy-reaction hook.",
        "notes": "Local light is cosmetic; if battery affects gameplay/economy, mirror state on server; config drain/flicker thresholds.",
    },
    "objective-tracker": {
        "purpose": "On-screen list of current goals + progress.",
        "files": "StarterGui ObjectiveTracker (LocalScript), ReplicatedStorage/Shared/ObjectiveDefs (ModuleScript), Remotes/ObjectiveUpdate (RemoteEvent).",
        "feel": "Slide-in entries, strthrough + fade on done, subtle pulse on update, waypoint beam optional.",
        "notes": "Server is source of truth for progress; client renders only; avoid layout blocking gameplay view.",
    },
    "round-system": {
        "purpose": "Lobby → intermission → round → results loop.",
        "files": "ServerScriptService/RoundService (Script), ReplicatedStorage/Shared/RoundConfig (ModuleScript), StarterGui RoundHUD (LocalScript).",
        "feel": "Countdown ticks, round-start horn, timer color ramp near end, winner banner.",
        "notes": "Server controls state + timers; teleport/reset server-side; guard against mid-round joins.",
    },
    "wave-system": {
        "purpose": "Escalating enemy waves with scaling difficulty.",
        "files": "ServerScriptService/WaveService (Script), ReplicatedStorage/Shared/WaveConfig (ModuleScript), StarterGui WaveHUD (LocalScript).",
        "feel": "Wave-incoming warning, spawn portal FX, boss-wave music cue, wave-clear reward pop.",
        "notes": "Server spawns + scales; cap concurrent NPCs for perf; validate rewards on clear.",
    },
}

UE5_MODULES: Dict[str, Dict[str, str]] = {
    "character-controller": {
        "purpose": "Movement, jump, sprint, look for the player pawn.",
        "files": "BP_PlayerCharacter (ACharacter), BP_PlayerController, IMC_Default + IA_Move/Look/Jump/Sprint (Enhanced Input).",
        "feel": "Accel/decel curves, landing dip, sprint FOV push, footstep SFX hook, subtle camera bob.",
        "notes": "Use Enhanced Input (not legacy). Keep input in Controller/Character; expose speeds as config UPROPERTYs.",
    },
    "health-component": {
        "purpose": "Reusable HP/damage/death for any actor.",
        "files": "BPC_HealthComponent (UActorComponent) attached to characters/enemies.",
        "feel": "Hit reaction montage, damage number widget, low-HP post-process vignette, death ragdoll/dissolve.",
        "notes": "Component-owned HP; OnDeath delegate; clamp values; if multiplayer, replicate HP + validate on server.",
    },
    "inventory-component": {
        "purpose": "Hold/add/remove/equip items, reusable across actors.",
        "files": "BPC_InventoryComponent (UActorComponent), item DataAsset/struct, WBP_Inventory.",
        "feel": "Drag-drop, equip highlight, pickup toast, weight/slot-full feedback.",
        "notes": "Data-driven items via DataAsset; expose capacity as config; server-validate in multiplayer.",
    },
    "lock-on-camera": {
        "purpose": "Target-lock camera for melee/action combat.",
        "files": "BPC_TargetingComponent (UActorComponent), SpringArm + Camera on BP_PlayerCharacter.",
        "feel": "Smooth interp to target, lock reticle widget, soft target-swap, break-lock on distance/LOS loss.",
        "notes": "Sphere-trace for candidates; config lock range + interp speed; clear target on death/despawn.",
    },
    "enemy-ai": {
        "purpose": "Perception → chase → attack enemy behaviour.",
        "files": "BP_EnemyCharacter, BP_EnemyAIController, BT_Enemy + BB_Enemy, AIPerception (sight).",
        "feel": "Alert bark + icon, attack telegraph, stagger on hit, lose-interest search state.",
        "notes": "Behavior Tree + Blackboard; NavMesh required; config sight radius/attack range/cooldown; damage via HealthComponent.",
    },
    "objective-system": {
        "purpose": "Track mission objectives + completion.",
        "files": "BPC_ObjectiveComponent or GameState subsystem, WBP_ObjectiveTracker.",
        "feel": "Objective slide-in, tick SFX, complete flourish, optional world waypoint.",
        "notes": "Single source of truth in GameState/subsystem; broadcast via delegates; don't block HUD center.",
    },
    "checkpoint-system": {
        "purpose": "Respawn points + progress restore.",
        "files": "BP_Checkpoint (trigger actor), BPC_CheckpointComponent on player, GameMode respawn logic.",
        "feel": "Activation VFX + Niagara, 'Checkpoint' toast, active-pad glow.",
        "notes": "GameMode owns last checkpoint; debounce overlap; persist with SaveGame if progression matters.",
    },
    "interaction-system": {
        "purpose": "Look-at / proximity 'Press E' interactions.",
        "files": "BPC_InteractionComponent (UActorComponent), IInteractable interface, WBP_InteractionPrompt.",
        "feel": "Prompt fade-in on focus, outline highlight, confirm SFX, hold-to-interact ring.",
        "notes": "Line-trace or overlap detection; interface-driven so any actor can be interactable; config range.",
    },
    "hud-widget": {
        "purpose": "Core in-game HUD (health, ammo, objectives, crosshair).",
        "files": "WBP_HUD (UUserWidget) added by PlayerController/HUD class.",
        "feel": "Smooth bar interps, damage-taken flash, low-resource pulse, non-intrusive layout.",
        "notes": "Bind to components via delegates (avoid Tick polling); anchor for multiple resolutions; keep center clear.",
    },
    "main-menu": {
        "purpose": "Title screen: Play / Settings / Quit.",
        "files": "WBP_MainMenu, a Menu level or MenuGameMode.",
        "feel": "Hover scale + SFX, focus outline (gamepad), fade transition into level.",
        "notes": "Set input mode UI-only on menu; controller/keyboard focus navigation; confirm on Quit.",
    },
    "stamina-system": {
        "purpose": "Stamina for sprint/dodge/actions with regen.",
        "files": "BPC_StaminaComponent (UActorComponent), stamina bar in WBP_HUD.",
        "feel": "Drain-on-use, delayed regen, exhausted desaturate + heavy-breath SFX, bar flash when empty.",
        "notes": "Component-owned; gate sprint/dodge on stamina; config drain/regen/threshold; replicate if multiplayer.",
    },
}


# ── Game UI kit templates ──────────────────────────────────────────────────
ROBLOX_UI_TEMPLATES: List[str] = [
    "Modern HUD", "Main Menu", "Shop Modal", "Inventory Grid", "Quest Tracker",
    "Notification Toast", "Death Screen", "Level Complete Screen", "Settings Menu",
]

UE5_UI_TEMPLATES: List[str] = [
    "WBP_HUD", "WBP_MainMenu", "WBP_PauseMenu", "WBP_Inventory",
    "WBP_ObjectiveTracker", "WBP_InteractionPrompt", "WBP_DeathScreen", "WBP_SettingsMenu",
]

# Shared UI quality bar applied to every generated screen.
_UI_STANDARDS = (
    "Every generated UI must be: responsive (PC + mobile where relevant), clean/modern/readable, uncluttered, "
    "with hover/press feedback, tween/animation suggestions, readable font sizes, one clear primary action, and a "
    "toast system for errors/success where useful. The HUD must never block the gameplay view (keep the center clear). "
    "Roblox UI must be built from ScreenGui + Frame + TextLabel + TextButton and styled with UIStroke, UICorner, "
    "UIPadding, UIListLayout, UIScale, and animated with TweenService (no hardcoded pixel-only layouts). "
    "UE5 UI must be UMG (UUserWidget) bound to components/controllers via delegates, anchored for multiple resolutions."
)


# ── Build quality tiers ────────────────────────────────────────────────────
# The frontend sends 'Build quality: <label>' inside the request block. These
# define what each tier means so scope scales without extra UI fields.
BUILD_QUALITY_TIERS: Dict[str, Dict[str, str]] = {
    "Fast Prototype": {
        "scope": "Working core mechanics only. Minimal UI. Faster, simpler output — the shortest path to something playable.",
        "emphasis": "Core loop + 1-3 essential mechanics, a bare HUD, and setup steps. Skip deep polish and optional systems.",
    },
    "Polished MVP": {
        "scope": "Core mechanics + clean UI + feedback + save/checkpoint where useful. Setup steps and a manual checklist.",
        "emphasis": "A complete, good-feeling vertical slice: selected mechanic modules, proper HUD/menus, game feel, and QA notes.",
    },
    "Production Style": {
        "scope": "Server validation, anti-exploit notes, config-first architecture, better file structure, safe monetization hooks only if relevant, optional analytics-hook notes, robust edge cases, and a fuller polish pass.",
        "emphasis": "Ship-quality architecture and hardening. Assume this will grow into a real product.",
    },
}


# ── Compiler ───────────────────────────────────────────────────────────────
def _format_modules(title: str, modules: Dict[str, Dict[str, str]]) -> str:
    lines = [title]
    for name, spec in modules.items():
        lines.append(
            f"  • {name} — {spec['purpose']}\n"
            f"      files: {spec['files']}\n"
            f"      feel:  {spec['feel']}\n"
            f"      notes: {spec['notes']}"
        )
    return "\n".join(lines)


def _format_quality() -> str:
    lines = ["BUILD QUALITY TIERS (read 'Build quality:' from the request block; default Polished MVP):"]
    for name, spec in BUILD_QUALITY_TIERS.items():
        lines.append(f"  • {name}: {spec['scope']}\n      → {spec['emphasis']}")
    return "\n".join(lines)


def build_game_dev_knowledge_block() -> str:
    """Compile the mechanic library + UI kit + quality tiers into one compact
    reference block for the game_developer system prompt.

    The model treats these modules as a MENU: it selects the ones relevant to
    the prompt and implements them to the stated quality (files, game feel,
    security/edge notes). It is not required to use all of them — only what the
    idea needs — and it may add mechanics not listed here when the idea calls
    for it, holding them to the same bar.
    """
    parts: List[str] = [
        "═══════════════════════════════════════════════════════════════════════════",
        "MECHANIC MODULE LIBRARY + GAME UI KIT (KorvixAI internal standards)",
        "═══════════════════════════════════════════════════════════════════════════",
        "Treat the modules below as a curated MENU. SELECT the ones the prompt needs, implement each to its stated",
        "quality (files, game-feel, security/edge notes), and name the ones you used in the 'Selected Modules' section.",
        "You may add mechanics not listed here when the idea calls for it — hold them to the same bar. Do NOT dump the",
        "whole library; only build what the game needs.",
        "",
        _format_modules("ROBLOX MECHANIC MODULES (Luau, server-authoritative):", ROBLOX_MODULES),
        "",
        _format_modules("UE5 MECHANIC MODULES (component-based Blueprint/C++):", UE5_MODULES),
        "",
        "GAME UI KIT — templates to select and customise for the prompt:",
        "  Roblox: " + ", ".join(ROBLOX_UI_TEMPLATES) + ".",
        "  UE5:    " + ", ".join(UE5_UI_TEMPLATES) + ".",
        _UI_STANDARDS,
        "",
        _format_quality(),
    ]
    return "\n".join(parts)


# ── Adaptive output/token budget ───────────────────────────────────────────
# The game_developer output length varies enormously: a Fast Prototype for a
# tiny idea needs far less room than a Production-Style Roblox tycoon with an
# economy, DataStore, shop, pets, quests and anti-exploit notes. Rather than a
# single fixed max_tokens (which either wastes budget on small builds or
# truncates big ones), we infer a budget from Build Quality + prompt
# complexity. This is applied in ai_service.process_chat for the
# game_developer mode; the user never sees or controls token amounts.
#
# HARD CAP: gpt-4o (MODEL_STRONG) supports up to 16384 output tokens. We keep a
# conservative safe ceiling well under that so a request can never crash the
# provider. If a future provider is smaller, lower _SAFE_MAX_OUTPUT_TOKENS.
_SAFE_MAX_OUTPUT_TOKENS = 12000
_MIN_OUTPUT_TOKENS = 3500

# Budget table: (quality, complexity bucket) → output tokens. Values sit inside
# the ranges from the product spec and stay under the safe ceiling.
_BUDGET_TABLE: Dict[str, Dict[str, int]] = {
    "Fast Prototype": {"simple": 4000, "medium": 5200, "complex": 6500},
    "Polished MVP":   {"simple": 6000, "medium": 7200, "complex": 8800},
    "Production Style": {"simple": 8000, "medium": 9500, "complex": 11500},
}

# Complexity signal words. A hit means the build likely needs more files, more
# code, and more setup/QA detail — i.e. more output room. Kept lightweight and
# lowercase; matched as substrings against the whole request message.
_COMPLEXITY_KEYWORDS = (
    # shared / systems
    "inventory", "shop", "economy", "currency", "save", "datastore", "data store",
    "progression", "quest", "checkpoint", "multiplayer", "enemy", "ai ", " ai", "boss",
    "behavior tree", "behaviour tree", "combat", "melee", "lock-on", "lock on",
    "pet", "tycoon", "rebirth", "wave", "round", "hud", "menu", "mobile",
    "production", "analytics", "monetization", "monetisation", "leaderboard",
    "stamina", "interaction", "objective", "flashlight", "jumpscare", "crafting",
    # roblox-leaning
    "remoteevent", "remotefunction", "server-side", "server side", "gamepass", "game pass",
    "developer product", "marketplaceservice",
    # ue5-leaning
    "third-person", "third person", "first-person", "first person", "component",
    "health component", "savegame", "save game", "widget", "wbp", "c++", "gamemode",
    "playercontroller", "enhanced input", "niagara",
)


def _extract_user_idea(message: str) -> str:
    """Return only the user's idea, stripped of the fixed [GAME BUILD REQUEST]
    wrapper. The wrapper itself mentions words like 'multiplayer', 'save',
    'monetization' and the section list (full of commas), so scoring the whole
    message would flag EVERY request as complex. Scoring only the idea keeps
    the heuristic honest. Falls back to the whole (lowercased) message for
    legacy raw prompts that have no wrapper marker.
    """
    text = (message or "").lower()
    marker = "user idea:"
    if marker in text:
        return text.split(marker, 1)[1].strip()
    return text


def _complexity_bucket(message: str) -> str:
    """Return 'simple' | 'medium' | 'complex' from lightweight heuristics.

    Signals (measured on the USER IDEA only, never the wrapper): distinct
    complexity-keyword hits, comma-separated system count, and idea length.
    No database, no external call — just string scanning.
    """
    idea = _extract_user_idea(message)

    # Distinct keyword hits (count each keyword at most once).
    hits = 0
    for kw in _COMPLEXITY_KEYWORDS:
        if kw in idea:
            hits += 1

    # Comma count roughly tracks "how many systems were listed".
    commas = idea.count(",")

    # Idea length signal.
    words = len(idea.split())

    score = hits + min(commas, 8) + (0 if words < 40 else 2 if words < 110 else 4)

    if score <= 4:
        return "simple"
    if score <= 10:
        return "medium"
    return "complex"


def _detect_build_quality(message: str) -> str:
    """Read 'Build quality: <label>' from the request block. Default Polished MVP."""
    text = (message or "").lower()
    if "production style" in text:
        return "Production Style"
    if "fast prototype" in text:
        return "Fast Prototype"
    return "Polished MVP"


def estimate_game_dev_token_budget(
    message: str,
    hard_cap: int = _SAFE_MAX_OUTPUT_TOKENS,
) -> int:
    """Infer a safe output-token budget for a game_developer request.

    Scales with Build Quality (Fast Prototype < Polished MVP < Production Style)
    and prompt complexity (simple/medium/complex). Always clamped to
    [_MIN_OUTPUT_TOKENS, hard_cap] so it can never exceed the provider's safe
    limit or drop below a usable floor.

    The user never controls this — it is inferred entirely from the request.
    """
    quality = _detect_build_quality(message)
    bucket = _complexity_bucket(message)
    budget = _BUDGET_TABLE.get(quality, _BUDGET_TABLE["Polished MVP"]).get(bucket, 7200)
    safe_ceiling = min(hard_cap, _SAFE_MAX_OUTPUT_TOKENS)
    return max(_MIN_OUTPUT_TOKENS, min(budget, safe_ceiling))


__all__ = [
    "ROBLOX_MODULES",
    "UE5_MODULES",
    "ROBLOX_UI_TEMPLATES",
    "UE5_UI_TEMPLATES",
    "BUILD_QUALITY_TIERS",
    "build_game_dev_knowledge_block",
    "estimate_game_dev_token_budget",
]
