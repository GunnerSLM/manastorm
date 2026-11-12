"""Core rules, data models, combat calculator, and game engine."""

from manastorm.core.models import Card, LandState, CreatureState, ManaPool, Relic
from manastorm.core.mana import parse_mana_cost, find_mana_payment_plan, can_play_card
from manastorm.core.combat import calculate_combat_projection, BlockerState, CombatProjection
from manastorm.core.engine import create_new_game, GameState

__all__ = [
    "Card",
    "LandState",
    "CreatureState",
    "ManaPool",
    "Relic",
    "parse_mana_cost",
    "find_mana_payment_plan",
    "can_play_card",
    "calculate_combat_projection",
    "BlockerState",
    "CombatProjection",
    "create_new_game",
    "GameState",
]
