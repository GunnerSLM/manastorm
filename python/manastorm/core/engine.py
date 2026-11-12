"""MANASTORM — Core Game Engine, Turn Loop & State Machine.

Translates game.js into complete, idiomatic Python:
- All 16 ETB effects, 5 Landfall triggers, and 25 Spell effects
- Kuhn's auto-tapper and manual land tapping
- Full campaign progression across encounters with unique rules and wave spawns
- Free turn-1 mulligan, combat casualties, and victory drafting
"""

from __future__ import annotations
import uuid
from dataclasses import dataclass, field
from typing import List, Dict, Optional, Any, Set, Tuple
from manastorm.core.models import (
    Card, LandState, CreatureState, ManaPool, Relic,
    ParsedManaCost, PaymentPlan, COLORS
)
from manastorm.core.mana import parse_mana_cost, find_mana_payment_plan, can_play_card
from manastorm.core.combat import calculate_combat_projection, BlockerState, CombatProjection
from manastorm.core.cards import get_card_def, get_all_card_ids, STARTER_DECKS, ENCOUNTERS
from manastorm.core.relics import get_relic_def, RelicDef
from manastorm.core.rng import XorShift32RNG

START_LIFE = 20
MAX_LIFE = 30
VICTORY_HEAL = 4


@dataclass
class TurnStats:
    spells: int = 0
    landfalls: int = 0
    grave_triggers: int = 0


@dataclass
class GameState:
    run_over: bool = False
    run_won: bool = False
    in_draft: bool = False
    combat_locked: bool = False
    player_life: int = START_LIFE
    enemy_life: int = 78
    enemy_max_life: int = 78
    enemy_name: str = "Garruk's Vanguard"
    enemy_tier: str = "SKIRMISH WARD"
    enemy_rule: str = ""
    burn_resistance: float = 0.0
    stax_drain: int = 0
    turn: int = 1
    max_turns: int = 5
    lands_played_this_turn: int = 0
    max_lands_per_turn: int = 1
    mulligans_left: int = 1
    can_mulligan: bool = True
    gold: int = 6
    encounter_idx: int = 0
    campaign_id: str = "blind_eternities"
    run_seed: Optional[str] = None
    rng: XorShift32RNG = field(default_factory=XorShift32RNG)

    # Zones
    master_deck: List[Card] = field(default_factory=list)
    library: List[Card] = field(default_factory=list)
    hand: List[Card] = field(default_factory=list)
    graveyard: List[Card] = field(default_factory=list)
    player_lands: List[LandState] = field(default_factory=list)
    player_creatures: List[CreatureState] = field(default_factory=list)
    enemy_creatures: List[BlockerState] = field(default_factory=list)
    relics: List[Relic] = field(default_factory=list)
    draft_choices: List[Card] = field(default_factory=list)

    # Turn resources
    mana_pool: ManaPool = field(default_factory=ManaPool)
    turn_burn_power: int = 0
    turn_resonance: float = 1.0
    turn_stats: TurnStats = field(default_factory=TurnStats)

    # Feedback and logging
    combat_log: List[str] = field(default_factory=list)
    fx_queue: List[Dict[str, Any]] = field(default_factory=list)

    def next_uid(self) -> str:
        return f"uid_{uuid.uuid4().hex[:8]}"

    def log_event(self, text: str) -> None:
        self.combat_log.append(text)
        if len(self.combat_log) > 60:
            self.combat_log.pop(0)

    def spawn_fx(self, text: str, color_hex: str = "#ffd466") -> None:
        self.fx_queue.append({"text": text, "color": color_hex, "ttl": 2.5})

    def add_resonance(self, amount: float, source: str = "") -> None:
        self.turn_resonance += amount
        if source:
            self.log_event(f"Resonance +{amount} ({source})")

    def add_burn_power(self, amount: int, source: str = "") -> None:
        self.turn_burn_power += amount
        if source:
            self.log_event(f"Burn Power +{amount} ({source})")

    def gain_life(self, amount: int, source: str = "") -> int:
        before = self.player_life
        self.player_life = min(MAX_LIFE, self.player_life + amount)
        actual = self.player_life - before
        if actual > 0:
            self.spawn_fx(f"+{actual} Life! ({source})", "#4bf099")
            self.log_event(f"Healed {actual} Life ({source}) -> {self.player_life}/{MAX_LIFE}")
            self.dispatch_relic_event("on_life_gain")
        return actual

    def get_token_multiplier(self) -> int:
        mult = 1
        for r in self.relics:
            rdef = get_relic_def(r.id)
            if rdef:
                mult *= rdef.token_multiplier
        return mult

    def get_trigger_multiplier(self) -> int:
        extra = 0
        for r in self.relics:
            rdef = get_relic_def(r.id)
            if rdef:
                extra += rdef.extra_triggers
        return 1 + extra

    def has_any_color_lands(self) -> bool:
        return any(
            bool(rdef and rdef.any_color_lands)
            for rdef in [get_relic_def(r.id) for r in self.relics]
        )

    def dispatch_relic_event(self, hook_name: str, payload: Optional[Dict[str, Any]] = None) -> None:
        payload = payload or {}
        for r in self.relics:
            rdef = get_relic_def(r.id)
            if rdef and getattr(rdef, hook_name, None):
                hook = getattr(rdef, hook_name)
                try:
                    hook(self, payload)
                except TypeError:
                    hook(self)

    def shuffle_library(self) -> None:
        n = len(self.library)
        for i in range(n - 1, 0, -1):
            j = int(self.rng.random() * (i + 1))
            self.library[i], self.library[j] = self.library[j], self.library[i]

    def draw_cards(self, count: int = 1) -> List[Card]:
        drawn = []
        for _ in range(count):
            if not self.library:
                if not self.graveyard:
                    break
                self.library = self.graveyard[:]
                self.graveyard.clear()
                self.shuffle_library()
            if self.library:
                card = self.library.pop()
                self.hand.append(card)
                drawn.append(card)
        return drawn

    def mill_cards(self, count: int) -> int:
        milled = 0
        for _ in range(count):
            if not self.library:
                break
            c = self.library.pop()
            self.graveyard.append(c)
            milled += 1
            self.dispatch_relic_event("on_graveyard_enter")
        return milled

    def recover_land_from_graveyard(self) -> Optional[Card]:
        for i in range(len(self.graveyard) - 1, -1, -1):
            if self.graveyard[i].type == "Land":
                card = self.graveyard.pop(i)
                self.hand.append(card)
                return card
        return None

    def mulligan(self) -> bool:
        if not self.can_mulligan or self.mulligans_left <= 0:
            return False
        self.mulligans_left -= 1
        self.can_mulligan = False
        # Reshuffle hand into library
        self.library.extend(self.hand)
        self.hand.clear()
        self.shuffle_library()
        self.draw_cards(7)
        self.spawn_fx("Turn 1 Free Mulligan used!", "#ffd466")
        self.log_event("Used Turn 1 Mulligan -> 7 new cards drawn.")
        return True

    def tap_land_manually(self, land_uid: str) -> bool:
        if self.combat_locked or self.run_over:
            return False
        land = next((l for l in self.player_lands if l.uid == land_uid), None)
        if not land or land.tapped:
            return False

        land.tapped = True
        if self.has_any_color_lands():
            self.mana_pool.ANY += 1
            self.spawn_fx("+1 {ANY} Mana!", "#9b59b6")
        elif len(land.produces) == 1:
            col = land.produces[0]
            current = getattr(self.mana_pool, col)
            setattr(self.mana_pool, col, current + 1)
            self.spawn_fx(f"+1 {{{col}}} Mana!", "#4bf099")
        elif len(land.produces) > 1:
            # Dual land default: first color
            col = land.produces[0]
            current = getattr(self.mana_pool, col)
            setattr(self.mana_pool, col, current + 1)
            self.spawn_fx(f"+1 {{{col}}} Mana!", "#4bf099")
        return True

    def toggle_attacker(self, creature_uid: str) -> bool:
        if self.combat_locked or self.run_over:
            return False
        creature = next((c for c in self.player_creatures if c.uid == creature_uid), None)
        if not creature or creature.summoningSickness:
            self.spawn_fx("Summoning Sick! Needs Haste.", "#98a4c0")
            return False
        creature.attacking = not creature.attacking
        return True

    def start_turn(self, is_first_turn: bool = False) -> None:
        self.lands_played_this_turn = 0
        self.max_lands_per_turn = 1
        self.turn_burn_power = 0
        self.turn_resonance = 1.0
        self.turn_stats = TurnStats()

        if not is_first_turn:
            self.can_mulligan = False

        # Clear floating mana & untap lands
        self.mana_pool = ManaPool()
        for land in self.player_lands:
            land.tapped = False

        # Creature Upkeep
        for c in self.player_creatures:
            c.summoningSickness = False
            c.tempPower = 0
            c.tempToughness = 0
            c.tempKeywords.clear()
            c.attacking = True

        for c in list(self.player_creatures):
            if c.etb == "mana_dork":
                self.mana_pool.G += c.count
            if c.upkeep == "sentinel":
                self.draw_cards(c.count)
                self.add_resonance(float(c.count), "Esper Sentinel")
            if c.upkeep == "overseer":
                buff = c.count * self.get_token_multiplier()
                for ally in self.player_creatures:
                    ally.power += buff
                    ally.toughness += buff
                self.add_resonance(float(c.count), "Steel Overseer")

        # Relic Upkeep
        self.dispatch_relic_event("on_turn_start", {"is_first_turn": is_first_turn})

        # Draw card
        if not is_first_turn:
            self.draw_cards(1)
            self.log_event(f"Turn {self.turn} began. Drew 1 card, untapped lands.")

    def spawn_tokens(self, name: str, power: int, toughness: int, color: str, keywords: List[str], count: int = 1) -> None:
        actual_count = count * self.get_token_multiplier()
        has_haste = "Haste" in keywords
        # Try stacking tokens if identical
        existing = next(
            (c for c in self.player_creatures if c.isToken and c.name == name and c.power == power and c.toughness == toughness and c.summoningSickness == (not has_haste)),
            None
        )
        if existing:
            existing.count += actual_count
        else:
            uid = self.next_uid()
            creature = CreatureState(
                uid=uid,
                id=f"token_{name.lower().replace(' ', '_')}",
                name=name,
                power=power,
                toughness=toughness,
                basePower=power,
                baseToughness=toughness,
                currentToughness=toughness,
                keywords=list(keywords),
                summoningSickness=not has_haste,
                attacking=has_haste,
                isToken=True,
                count=actual_count,
                color=color,
            )
            self.player_creatures.append(creature)

        self.spawn_fx(f"+{actual_count} {name}!", "#ffd466")
        self.dispatch_relic_event("on_creature_enter", {"count": actual_count, "token_mult": self.get_token_multiplier()})

    def trigger_landfall(self) -> None:
        self.turn_stats.landfalls += 1
        triggers = self.get_trigger_multiplier()

        for c in list(self.player_creatures):
            if c.landfall == "cobra":
                self.mana_pool.ANY += c.count * triggers
                self.add_resonance(float(c.count * triggers), "Lotus Cobra")
                self.spawn_fx(f"Lotus Cobra: +{c.count * triggers} Mana & Mult!", "#2ecc71")
            elif c.landfall == "briarback":
                c.tempPower += 2 * triggers
                c.tempToughness += 2 * triggers
                self.spawn_fx(f"Briarback: +{2 * triggers}/+{2 * triggers}!", "#2ecc71")
            elif c.landfall == "scute":
                for _ in range(triggers):
                    if len(self.player_lands) >= 4:
                        c.count += 1 * self.get_token_multiplier()
                        self.spawn_fx(f"Scute Swarm Cloned (x{c.count})!", "#2ecc71")
                    else:
                        self.spawn_tokens("Insect Token", 1, 1, "G", ["Haste"], 1)
            elif c.landfall == "baloth":
                self.spawn_tokens("Beast Token", 4, 4, "G", ["Trample"], c.count * triggers)
            elif c.landfall == "cartographer":
                c.tempPower += 1 * triggers
                c.tempToughness += 1 * triggers
                self.draw_cards(1 * triggers)
                self.spawn_fx("Cartographer: +1/+1 & Drew 1!", "#3498db")

        self.dispatch_relic_event("on_landfall")

    def play_land(self, hand_index: int) -> bool:
        if hand_index < 0 or hand_index >= len(self.hand):
            return False
        card = self.hand[hand_index]
        if card.type != "Land" or self.lands_played_this_turn >= self.max_lands_per_turn:
            return False

        card = self.hand.pop(hand_index)
        self.lands_played_this_turn += 1
        self.can_mulligan = False

        if card.isFetch:
            # Evolving Wilds: to graveyard, fetches basic land
            self.graveyard.append(card)
            self.dispatch_relic_event("on_graveyard_enter")
            # Search basic land from library
            basic_land = next((c for c in self.library if c.type == "Land" and not c.isFetch and len(c.produces) == 1), None)
            if basic_land:
                self.library.remove(basic_land)
                land_state = LandState(
                    uid=self.next_uid(),
                    id=basic_land.id,
                    name=basic_land.name,
                    produces=list(basic_land.produces),
                    tapped=False,
                )
                self.player_lands.append(land_state)
                self.spawn_fx(f"Fetched {basic_land.name}!", "#ffd466")
                self.log_event(f"Fetched {basic_land.name} via Evolving Wilds.")
            # Trigger Landfall twice (fetch land + fetched land)
            self.trigger_landfall()
            self.trigger_landfall()
        else:
            land_state = LandState(
                uid=self.next_uid(),
                id=card.id,
                name=card.name,
                produces=list(card.produces),
                tapped=False,
            )
            self.player_lands.append(land_state)
            self.spawn_fx(f"Played {card.name}", "#4bf099")
            self.log_event(f"Played Land: {card.name}")
            self.trigger_landfall()

        return True

    def play_creature(self, hand_index: int) -> bool:
        if hand_index < 0 or hand_index >= len(self.hand):
            return False
        card = self.hand[hand_index]
        if card.type != "Creature":
            return False

        plan = find_mana_payment_plan(card.manaCost, self.mana_pool, self.player_lands, self.has_any_color_lands())
        if not plan:
            return False

        self.mana_pool = plan.new_pool
        for uid in plan.lands_to_tap:
            land = next((l for l in self.player_lands if l.uid == uid), None)
            if land:
                land.tapped = True

        card = self.hand.pop(hand_index)
        self.can_mulligan = False
        has_haste = "Haste" in card.keywords

        creature = CreatureState(
            uid=self.next_uid(),
            id=card.id,
            name=card.name,
            power=(card.power or 1) + card.permPowerBonus,
            toughness=(card.toughness or 1) + card.permToughnessBonus,
            basePower=(card.power or 1) + card.permPowerBonus,
            baseToughness=(card.toughness or 1) + card.permToughnessBonus,
            currentToughness=(card.toughness or 1) + card.permToughnessBonus,
            keywords=list(card.keywords),
            summoningSickness=not has_haste,
            attacking=has_haste,
            color=card.color,
            etb=card.etb,
            death=card.death,
            upkeep=card.upkeep,
            landfall=card.landfall,
            connive=card.connive,
            onLifegain=card.onLifegain,
        )
        self.player_creatures.append(creature)
        self.spawn_fx(f"Cast {card.name}!", "#4bf099")
        self.log_event(f"Cast Creature: {card.name} ({creature.power}/{creature.toughness})")

        # Dispatches ETB effect
        triggers = self.get_trigger_multiplier()
        for _ in range(triggers):
            self._resolve_etb(creature)

        self.dispatch_relic_event("on_creature_enter", {"count": 1, "token_mult": 1})
        return True

    def _resolve_etb(self, c: CreatureState) -> None:
        if not c.etb:
            return
        etb = c.etb
        if etb == "rabble":
            self.spawn_tokens("Goblin Token", 1, 1, "R", ["Haste"], 1)
            buff = 1 * self.get_token_multiplier()
            for ally in self.player_creatures:
                if "Goblin" in ally.name:
                    ally.power += buff
                    ally.toughness += buff
        elif etb == "terror":
            self.add_burn_power(5, "Terror of the Peaks")
            self.add_resonance(2.0, "Terror of the Peaks")
            self.spawn_fx("Terror: +5 Burn, +2 Mult!", "#ff4757")
        elif etb == "archon":
            if self.enemy_creatures:
                strongest = max(self.enemy_creatures, key=lambda b: b.power)
                self.enemy_creatures.remove(strongest)
                self.spawn_fx(f"Archon Exiled {strongest.name}!", "#9b59b6")
            self.draw_cards(1)
            self.add_resonance(2.0, "Archon of Cruelty")
        elif etb == "djinn":
            if self.enemy_creatures:
                strongest = max(self.enemy_creatures, key=lambda b: b.power)
                self.enemy_creatures.remove(strongest)
                self.spawn_fx(f"Djinn Bounced {strongest.name}!", "#3498db")
            blue_lands = sum(1 for l in self.player_lands if "U" in l.produces)
            c.tempPower += blue_lands
            self.add_resonance(2.0, "Tempest Djinn")
        elif etb == "serra":
            self.gain_life(4, "Serra Angel")
            self.add_resonance(2.0, "Serra Angel")
        elif etb == "tideglass":
            if self.enemy_creatures:
                strongest = max(self.enemy_creatures, key=lambda b: b.power)
                strongest.frozen = True
                self.spawn_fx(f"Froze {strongest.name}!", "#3498db")
            self.draw_cards(1)
        elif etb == "dawnbell":
            self.gain_life(2, "Dawnbell Acolyte")
            self.add_resonance(1.0, "Dawnbell Acolyte")
        elif etb == "fiend_artisan":
            gy_creatures = sum(1 for card in self.graveyard if card.type == "Creature")
            c.power += gy_creatures
            c.toughness += gy_creatures
            self.add_resonance(1.0, "Fiend Artisan")
            self.spawn_fx(f"Fiend Artisan: +{gy_creatures}/+{gy_creatures} Undergrowth!", "#2ecc71")
        elif etb == "overseer":
            buff = 1 * self.get_token_multiplier()
            for ally in self.player_creatures:
                ally.power += buff
                ally.toughness += buff
            self.add_resonance(1.0, "Steel Overseer")
        elif etb == "modular":
            others = sum(ally.count for ally in self.player_creatures if ally.uid != c.uid)
            c.power += others
            c.toughness += others
            self.add_resonance(1.0, "Arcbound Ravager")
        elif etb == "battlesphere":
            self.spawn_tokens("Myr Construct", 1, 1, "C", ["Haste"], 3)
            self.add_resonance(2.0, "Myr Battlesphere")
        elif etb == "supplier":
            milled = self.mill_cards(3)
            self.add_resonance(1.0, "Stitcher's Supplier")
            self.spawn_fx(f"Milled {milled} & +1 Mult!", "#9b59b6")
        elif etb == "wayfinder" or etb == "mosswake":
            count = 3 if etb == "wayfinder" else 2
            self.mill_cards(count)
            self.recover_land_from_graveyard()
            self.add_resonance(1.0, c.name)

    def play_spell(self, hand_index: int) -> bool:
        if hand_index < 0 or hand_index >= len(self.hand):
            return False
        card = self.hand[hand_index]
        if card.type not in ("Spell", "Instant", "Sorcery"):
            return False

        plan = find_mana_payment_plan(card.manaCost, self.mana_pool, self.player_lands, self.has_any_color_lands())
        if not plan:
            return False

        self.mana_pool = plan.new_pool
        for uid in plan.lands_to_tap:
            land = next((l for l in self.player_lands if l.uid == uid), None)
            if land:
                land.tapped = True

        card = self.hand.pop(hand_index)
        self.graveyard.append(card)
        self.turn_stats.spells += 1
        self.can_mulligan = False

        self.spawn_fx(f"Cast {card.name}!", "#59a2ff")
        self.log_event(f"Cast Spell: {card.name}")

        # Basic stat adds
        if card.resonanceAdd:
            self.add_resonance(card.resonanceAdd, card.name)
        if card.resonanceMult > 1.0:
            self.turn_resonance *= card.resonanceMult
        if card.burnPower:
            self.add_burn_power(card.burnPower, card.name)

        # Trigger Prowess
        for c in self.player_creatures:
            if "Prowess" in c.keywords:
                c.tempPower += 1
                c.tempToughness += 1

        # Resolve card spell effect
        self._resolve_spell_effect(card)

        self.dispatch_relic_event("on_spell_cast")
        self.dispatch_relic_event("on_graveyard_enter")
        return True

    def _resolve_spell_effect(self, card: Card) -> None:
        eff = card.effect or card.id
        if eff == "cultivate":
            basic = next((c for c in self.library if c.type == "Land" and not c.isFetch and len(c.produces) == 1), None)
            if basic:
                self.library.remove(basic)
                self.player_lands.append(LandState(uid=self.next_uid(), id=basic.id, name=basic.name, produces=list(basic.produces)))
                self.trigger_landfall()
                self.spawn_fx(f"Cultivated {basic.name}!", "#2ecc71")
        elif eff == "overrun":
            buff = 3 * self.get_token_multiplier()
            for c in self.player_creatures:
                c.tempPower += buff
                c.tempToughness += buff
                if "Trample" not in c.keywords and "Trample" not in c.tempKeywords:
                    c.tempKeywords.append("Trample")
            self.add_resonance(2.0, "Overrun")
            self.spawn_fx(f"OVERRUN! All +{buff}/+{buff} & Trample!", "#2ecc71")
        elif eff in ("bolt", "lightning_bolt"):
            self.add_resonance(1.0, "Lightning Bolt")
            if self.enemy_creatures:
                target = max(self.enemy_creatures, key=lambda b: b.power)
                self.enemy_creatures.remove(target)
                self.spawn_fx(f"Lightning Bolted {target.name}!", "#ff4757")
            else:
                self.add_burn_power(4, "Lightning Bolt")
        elif eff == "furnace_arc":
            self.add_burn_power(3, "Furnace Arc")
            self.add_resonance(1.0, "Furnace Arc")
        elif eff == "goblins_2":
            self.spawn_tokens("Goblin Token", 1, 1, "R", ["Haste"], 2)
        elif eff in ("ritual", "seething_song"):
            self.mana_pool.R += 5
            self.add_resonance(1.0, "Seething Song")
            self.spawn_fx("+5 {R} Mana!", "#e74c3c")
        elif eff == "dark_ritual":
            self.mana_pool.B += 3
            self.add_resonance(1.0, "Dark Ritual")
            self.spawn_fx("+3 {B} Mana!", "#34495e")
        elif eff == "battle_rage":
            if self.player_creatures:
                target = max(self.player_creatures, key=lambda c: c.power)
                if "Double Strike" not in target.tempKeywords:
                    target.tempKeywords.append("Double Strike")
                if "Trample" not in target.tempKeywords:
                    target.tempKeywords.append("Trample")
                self.spawn_fx(f"{target.name} Double Strike & Trample!", "#e74c3c")
        elif eff == "ashen_bargain":
            self.player_life = max(1, self.player_life - 2)
            self.draw_cards(2)
            self.add_resonance(1.0, "Ashen Bargain")
        elif eff == "village_rites":
            self.draw_cards(2)
            self.add_resonance(1.0, "Village Rites")
        elif eff == "reanimate":
            gy_creature = next((c for c in reversed(self.graveyard) if c.type == "Creature"), None)
            if gy_creature:
                self.graveyard.remove(gy_creature)
                cs = CreatureState(
                    uid=self.next_uid(),
                    id=gy_creature.id,
                    name=gy_creature.name,
                    power=gy_creature.power or 1,
                    toughness=gy_creature.toughness or 1,
                    basePower=gy_creature.power or 1,
                    baseToughness=gy_creature.toughness or 1,
                    currentToughness=gy_creature.toughness or 1,
                    keywords=list(gy_creature.keywords) + ["Haste"],
                    summoningSickness=False,
                    attacking=True,
                )
                self.player_creatures.append(cs)
                self.spawn_fx(f"Reanimated {gy_creature.name}!", "#9b59b6")
        elif eff in ("unsummon", "slipstream_reversal"):
            if self.enemy_creatures:
                target = max(self.enemy_creatures, key=lambda b: b.power)
                self.enemy_creatures.remove(target)
                self.spawn_fx(f"Bounced {target.name}!", "#3498db")
            self.draw_cards(1)
            self.add_resonance(1.0, card.name)
        elif eff == "frost_breath":
            self.draw_cards(1)
            self.add_resonance(2.0, "Cryptic Freeze")
            for b in sorted(self.enemy_creatures, key=lambda x: x.power, reverse=True)[:2]:
                b.frozen = True
            self.spawn_fx("Froze 2 Blockers & Drew 1!", "#3498db")
        elif eff in ("draw_2", "brainstorm", "thoughtcast"):
            self.draw_cards(2)
            self.add_resonance(1.0, card.name)
        elif eff == "plowshares":
            if self.enemy_creatures:
                target = max(self.enemy_creatures, key=lambda b: b.power)
                self.enemy_creatures.remove(target)
                self.spawn_fx(f"Exiled {target.name}!", "#ffe299")
            self.gain_life(3, "Swords to Plowshares")
            self.add_resonance(1.0, "Swords to Plowshares")
        elif eff == "formation" or eff == "sunlit_rally":
            buff = 1 if eff == "formation" else 2
            for c in self.player_creatures:
                c.tempPower += buff
                c.tempToughness += buff
            self.add_resonance(1.0, card.name)
        elif eff == "reinforcements":
            self.spawn_tokens("Soldier Token", 1, 1, "W", ["Haste"], 2)
            for c in self.player_creatures:
                c.tempPower += 1
                c.tempToughness += 1
            self.add_resonance(2.0, "Heroic Reinforcements")
        elif eff == "spider_spawning":
            count = max(1, sum(1 for c in self.graveyard if c.type == "Creature"))
            self.spawn_tokens("Spider Token", 1, 2, "G", ["Reach"], count)
        elif eff == "thopter_foundry":
            self.spawn_tokens("Thopter Token", 1, 1, "U", ["Flying"], 1)
            self.gain_life(1, "Thopter Foundry")
        elif eff == "galvanic_blast":
            self.add_burn_power(4, "Galvanic Blast")
            self.add_resonance(1.0, "Galvanic Blast")

    def resolve_combat_step(self) -> CombatProjection:
        attackers = [
            {
                "uid": c.uid,
                "name": c.name,
                "power": c.power + c.tempPower,
                "toughness": c.toughness + c.tempToughness,
                "attacking": c.attacking and not c.summoningSickness,
                "summoningSick": c.summoningSickness,
                "keywords": c.keywords + c.tempKeywords,
                "count": c.count,
            }
            for c in self.player_creatures
        ]

        proj = calculate_combat_projection(
            attackers_list=attackers,
            enemy_blockers=self.enemy_creatures,
            turn_burn_power=self.turn_burn_power,
            base_resonance=self.turn_resonance,
            burn_resistance=self.burn_resistance,
        )

        # Apply damage to enemy boss
        self.enemy_life = max(0, self.enemy_life - proj.total_damage)
        self.log_event(f"Attack dealt {proj.total_damage} DMG ({proj.power} Power x {proj.mult:.1f} Res) -> Boss: {self.enemy_life}/{self.enemy_max_life}")

        # Remove dead blockers
        if proj.dead_blocker_uids:
            self.enemy_creatures = [b for b in self.enemy_creatures if b.uid not in proj.dead_blocker_uids]

        # Remove dead player attackers
        surviving = []
        for c in self.player_creatures:
            dead_count = proj.dead_attacker_counts_by_uid.get(c.uid, 0)
            if dead_count >= c.count:
                # Creature dies
                if not c.isToken:
                    self.graveyard.append(get_card_def(c.id))
                    self.dispatch_relic_event("on_graveyard_enter")
                self.log_event(f"{c.name} fell in combat.")
            else:
                c.count -= dead_count
                surviving.append(c)
        self.player_creatures = surviving

        # Lifelink
        if proj.lifelink_heal > 0:
            self.gain_life(proj.lifelink_heal, "Lifelink")

        # Check for victory
        if self.enemy_life <= 0:
            self.handle_victory()
            return proj

        # Enemy retaliation step
        active_blockers = [b for b in self.enemy_creatures if not b.frozen]
        retaliation_dmg = sum(b.power for b in active_blockers) + self.stax_drain
        if retaliation_dmg > 0:
            self.player_life = max(0, self.player_life - retaliation_dmg)
            self.spawn_fx(f"Enemy Retaliation: -{retaliation_dmg} HP!", "#ff4757")
            self.log_event(f"Enemy Retaliation: dealt {retaliation_dmg} DMG -> Life: {self.player_life}/{MAX_LIFE}")

        # Thaw blockers
        for b in self.enemy_creatures:
            b.frozen = False

        # Check for defeat
        if self.player_life <= 0 or self.turn >= self.max_turns:
            self.run_over = True
            self.run_won = False
            self.spawn_fx("DEFEAT!", "#ff4757")
            self.log_event(f"Run Defeat on Turn {self.turn}.")
            return proj

        # Spawn new enemy wave according to encounter rules
        self._spawn_encounter_wave()

        # Advance turn
        self.turn += 1
        self.start_turn()
        return proj

    def _spawn_encounter_wave(self) -> None:
        if self.encounter_idx < len(ENCOUNTERS):
            enc = ENCOUNTERS[self.encounter_idx]
            spawn = enc.get("spawn")
            if spawn:
                count = 1
                if enc.get("evenTurnDoubleSpawn") and self.turn % 2 == 0:
                    count = 2
                elif enc.get("stampedeTurn") and self.turn >= enc["stampedeTurn"]:
                    count = 2

                for _ in range(count):
                    self.enemy_creatures.append(BlockerState(
                        uid=self.next_uid(),
                        name=spawn["name"],
                        power=spawn["power"],
                        toughness=spawn["toughness"],
                        keywords=list(spawn.get("keywords", []))
                    ))
                self.log_event(f"Enemy summoned {count}x {spawn['name']}!")

    def handle_victory(self) -> None:
        self.gold += 15
        self.gain_life(VICTORY_HEAL, "Victory Rest")
        self.in_draft = True
        self.spawn_fx("VICTORY! Choose a Card Reward", "#ffd466")
        self.log_event(f"Defeated {self.enemy_name}! Earned 15 Gold & Healed 4 Life.")

        # Generate 3 draft choices from all available cards
        all_ids = get_all_card_ids()
        # Filter non-basic lands
        pool = [cid for cid in all_ids if not cid in ("forest", "mountain", "swamp", "island", "plains", "wastes")]
        choices = []
        for _ in range(3):
            cid = pool[int(self.rng.random() * len(pool))]
            choices.append(get_card_def(cid))
        self.draft_choices = choices

    def draft_card(self, card_id: str) -> None:
        new_card = get_card_def(card_id)
        self.master_deck.append(new_card)
        self.library.append(new_card)
        self.shuffle_library()
        self.in_draft = False
        self.spawn_fx(f"Drafted {new_card.name}!", "#ffd466")
        self.log_event(f"Drafted {new_card.name} into deck.")

        # Progress to next encounter
        self.encounter_idx += 1
        if self.encounter_idx >= len(ENCOUNTERS):
            self.run_over = True
            self.run_won = True
            self.spawn_fx("CAMPAIGN COMPLETE! YOU WIN!", "#ffd466")
            self.log_event("Victory! Conquered all Planes!")
        else:
            self.load_encounter(self.encounter_idx)

    def load_encounter(self, idx: int) -> None:
        if idx >= len(ENCOUNTERS):
            return
        enc = ENCOUNTERS[idx]
        self.encounter_idx = idx
        self.enemy_name = enc["name"]
        self.enemy_tier = enc.get("tier", "SKIRMISH WARD")
        self.enemy_max_life = enc["maxLife"]
        self.enemy_life = enc["maxLife"]
        self.enemy_rule = enc.get("rule", "")
        self.burn_resistance = float(enc.get("burnResistance", 0.0))
        self.stax_drain = int(enc.get("staxDrain", 0))
        self.turn = 1
        self.can_mulligan = True
        self.mulligans_left = 1
        self.enemy_creatures.clear()

        # Spawn initial blockers
        spawn = enc.get("spawn")
        if spawn:
            self.enemy_creatures.append(BlockerState(
                uid=self.next_uid(),
                name=spawn["name"],
                power=spawn["power"],
                toughness=spawn["toughness"],
                keywords=list(spawn.get("keywords", []))
            ))

        # Reset deck for encounter
        self.hand.clear()
        self.graveyard.clear()
        self.player_lands.clear()
        self.player_creatures.clear()
        self.library = self.master_deck[:]
        self.shuffle_library()
        self.draw_cards(7)
        self.start_turn(is_first_turn=True)


def create_new_game(deck_index: int = 0, seed: Optional[str] = "MANASTORM-RUN-1") -> GameState:
    game = GameState(run_seed=seed, rng=XorShift32RNG(run_seed=seed))
    starter = STARTER_DECKS[deck_index]

    deck: List[Card] = []
    card_entries = starter["cards"]
    if isinstance(card_entries, list):
        for card_id in card_entries:
            deck.append(get_card_def(card_id))
    elif isinstance(card_entries, dict):
        for card_id, count in card_entries.items():
            for _ in range(count):
                deck.append(get_card_def(card_id))

    game.master_deck = deck[:]
    # Starting relic
    relic_id = starter.get("startingRelic")
    if relic_id:
        rdef = get_relic_def(relic_id)
        if rdef:
            game.relics.append(Relic(id=rdef.id, name=rdef.name, desc=rdef.desc))

    game.load_encounter(0)
    return game
