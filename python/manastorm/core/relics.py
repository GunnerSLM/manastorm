"""MANASTORM — Command Zone Relics & Synergy Engine.

Replicates the 18 Relics and 8 Synergies from data/relics.js.
"""

from __future__ import annotations
from dataclasses import dataclass, field
from typing import Callable, Dict, List, Optional, Any, Set


@dataclass
class RelicDef:
    id: str
    name: str
    cost: int
    desc: str
    token_multiplier: int = 1
    extra_triggers: int = 0
    any_color_lands: bool = False
    mana_surge: bool = False
    rainbow_bonus: int = 0
    boosts: Dict[str, float] = field(default_factory=dict)
    # Event hooks
    on_creature_enter: Optional[Callable[[Any, Dict[str, Any]], None]] = None
    on_turn_start: Optional[Callable[[Any, Dict[str, Any]], None]] = None
    on_spell_cast: Optional[Callable[[Any], None]] = None
    on_graveyard_enter: Optional[Callable[[Any], None]] = None
    on_life_gain: Optional[Callable[[Any], None]] = None
    on_modify_combat_mult: Optional[Callable[[float, Any], float]] = None


RELIC_DB: List[RelicDef] = [
    RelicDef(
        id="impact_tremors",
        name="Impact Tremors",
        cost=6,
        desc="Whenever a Creature or Token enters your battlefield, gain +2 Resonance and +2 Burn Power.",
        on_creature_enter=lambda st, p: (
            st.add_resonance(2 * p.get("count", 1), "Impact Tremors"),
            st.add_burn_power(2 * p.get("count", 1), "Impact Tremors")
        )
    ),
    RelicDef(
        id="doubling_season",
        name="Doubling Season",
        cost=12,
        desc="Whenever you create Creature Tokens or gain +1/+1 buffs, create TWICE as many!",
        token_multiplier=2
    ),
    RelicDef(
        id="panharmonicon",
        name="Panharmonicon",
        cost=8,
        desc="All Enter-the-Battlefield (ETB) and Landfall triggers activate an additional time!",
        extra_triggers=1
    ),
    RelicDef(
        id="cathars_crusade",
        name="Cathars' Crusade",
        cost=10,
        desc="Whenever a Creature or Token stack enters your battlefield, put +1/+1 on ALL Creatures you control.",
        on_creature_enter=lambda st, p: [
            (setattr(c, "power", c.power + p.get("token_mult", 1)),
             setattr(c, "toughness", c.toughness + p.get("token_mult", 1)))
            for c in st.player_creatures
        ]
    ),
    RelicDef(
        id="sol_ring",
        name="Sol Ring",
        cost=11,
        desc="At the start of every turn, add {C}{C} (2 Colorless Mana) to your mana pool.",
        on_turn_start=lambda st, p: setattr(st.mana_pool, "C", st.mana_pool.C + 2)
    ),
    RelicDef(
        id="chromatic_lantern",
        name="Chromatic Lantern",
        cost=10,
        desc="Your Lands can tap for ANY color of mana, and you start each turn with +1 Any-Color Treasure Mana!",
        any_color_lands=True,
        on_turn_start=lambda st, p: setattr(st.mana_pool, "ANY", st.mana_pool.ANY + 1)
    ),
    RelicDef(
        id="fiery_emancipation",
        name="Fiery Emancipation",
        cost=8,
        desc="Multiplies your total Combat Resonance by ×2 during every attack!",
        on_modify_combat_mult=lambda mult, st: mult * 2.0
    ),
    RelicDef(
        id="aetherflux_reservoir",
        name="Aetherflux Reservoir",
        cost=5,
        desc="Whenever you cast an Instant or Sorcery, gain +3 Resonance and heal 2 Life.",
        on_spell_cast=lambda st: (
            st.add_resonance(3, "Aetherflux Reservoir"),
            st.gain_life(2, "Aetherflux Reservoir")
        )
    ),
    RelicDef(
        id="crucible_of_worlds",
        name="Crucible of Worlds",
        cost=10,
        desc="Graveyard Engine: Whenever a Land, Creature, or Spell enters your Graveyard, gain +1 Resonance and +1 Treasure Mana (up to 2×/turn)!",
        on_graveyard_enter=lambda st: (
            setattr(st.turn_stats, "grave_triggers", getattr(st.turn_stats, "grave_triggers", 0) + 1),
            st.turn_stats.grave_triggers <= 2 and (
                st.add_resonance(1, "Crucible of Worlds"),
                setattr(st.mana_pool, "ANY", st.mana_pool.ANY + 1)
            )
        )
    ),
    RelicDef(
        id="nyxbloom_ancient",
        name="Nyxbloom Ancient",
        cost=6,
        desc="Mana Surge: Each untapped Land and unspent Mana in your pool grants +1 Resonance (up to +5) and +2 Power during Combat!",
        mana_surge=True
    ),
    RelicDef(
        id="heliod_sun_crowned",
        name="Heliod, Sun-Crowned",
        cost=5,
        desc="Radiant Devotion: Whenever you gain Life, put +1/+1 on ALL Creatures you control and gain +2 Resonance!",
        on_life_gain=lambda st: (
            [
                (setattr(c, "power", c.power + st.get_token_multiplier()),
                 setattr(c, "toughness", c.toughness + st.get_token_multiplier()))
                for c in st.player_creatures
            ],
            st.add_resonance(2, "Heliod, Sun-Crowned")
        )
    ),
    RelicDef(
        id="shark_typhoon",
        name="Shark Typhoon",
        cost=7,
        desc="Tempo Skies: Whenever you cast your 2nd+ Instant or Sorcery each turn, create a 2/2 Blue Shark token with Flying & Haste!",
        on_spell_cast=lambda st: (
            st.spawn_tokens("Sky Shark Token", 2, 2, "U", ["Flying", "Haste"], 1)
            if st.turn_stats.spells >= 2 else None
        )
    ),
    RelicDef(
        id="goblin_warren",
        name="Goblin Warren",
        cost=6,
        desc="At the start of Turn 1, spawn two 1/1 Haste Goblins. Goblin Horde synergy bonuses are DOUBLED.",
        boosts={"goblin": 2.0},
        on_turn_start=lambda st, p: (
            st.spawn_tokens("Goblin Token", 1, 1, "R", ["Haste"], 2)
            if p.get("is_first_turn") else None
        )
    ),
    RelicDef(
        id="ral_storm_conduit",
        name="Ral, Storm Conduit",
        cost=5,
        desc="Whenever you cast an Instant or Sorcery, deal +3 Burn Power. Spellstorm synergy bonuses are DOUBLED.",
        boosts={"storm": 2.0},
        on_spell_cast=lambda st: (
            st.add_burn_power(3, "Ral, Storm Conduit"),
            st.add_resonance(1, "Ral, Storm Conduit")
        )
    ),
    RelicDef(
        id="omnath_locus",
        name="Omnath, Locus of Rage",
        cost=6,
        desc="Start each turn with +2 Resonance per 2 Lands you control. Landfall Surge synergy bonuses are DOUBLED.",
        boosts={"landfall": 2.0},
        on_turn_start=lambda st, p: (
            st.add_resonance(2 * (len(st.player_lands) // 2), "Omnath, Locus of Rage")
            if len(st.player_lands) >= 2 else None
        )
    ),
    RelicDef(
        id="hive_mind",
        name="Hive Mind",
        cost=4,
        desc="Start each turn with +2 Resonance if you control 2+ Creatures. Swarm and Titanfall synergy bonuses are boosted ×1.5.",
        boosts={"swarm": 1.5, "titans": 1.5},
        on_turn_start=lambda st, p: (
            st.add_resonance(2, "Hive Mind")
            if len(st.player_creatures) >= 2 else None
        )
    ),
    RelicDef(
        id="prismatic_omen",
        name="Prismatic Omen",
        cost=6,
        desc="Start each turn with +1 Resonance (+1 extra Color toward Prismatic Court). Prismatic Court & Graveborn bonuses are DOUBLED.",
        boosts={"rainbow": 2.0, "grave": 2.0},
        rainbow_bonus=1,
        on_turn_start=lambda st, p: st.add_resonance(1, "Prismatic Omen")
    ),
    RelicDef(
        id="exploration",
        name="Exploration",
        cost=9,
        desc="You may play an additional Land during each of your turns (+1 Land Drop/turn).",
        on_turn_start=lambda st, p: setattr(st, "max_lands_per_turn", st.max_lands_per_turn + 1)
    ),
]

_RELIC_MAP: Dict[str, RelicDef] = {r.id: r for r in RELIC_DB}


def get_relic_def(relic_id: str) -> Optional[RelicDef]:
    return _RELIC_MAP.get(relic_id)
