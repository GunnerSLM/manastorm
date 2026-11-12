"""MANASTORM — Combat Calculations, Projection, and Damage Resolution.

Implements MTG x Balatro combat math:
- Trample, Flying, Deathtouch, Lifelink, Double Strike
- Blocker pairing and retaliation
- Resonance scaling: Damage = Power x Resonance
"""

from __future__ import annotations
from dataclasses import dataclass, field
from typing import List, Dict, Set, Optional, Any


@dataclass
class ProjectedAttacker:
    source_uid: str
    name: str
    single_strike_power: int
    power: int
    toughness: int
    keywords: List[str]


@dataclass
class BlockerState:
    uid: str
    name: str
    power: int
    toughness: int
    keywords: List[str] = field(default_factory=list)
    frozen: bool = False
    used: bool = False
    dies: bool = False


@dataclass
class BlockerAssignment:
    attacker_uid: str
    attacker_name: str
    dmg_taken: int
    dies: bool
    kills_attacker: bool
    trample_over: int


@dataclass
class CombatProjection:
    power: int
    mult: float
    total_damage: int
    lifelink_heal: int
    attackers_count: int
    dead_blocker_uids: Set[str]
    dead_attacker_counts_by_uid: Dict[str, int]
    blocker_assignments: Dict[str, BlockerAssignment]
    unblocked_creature_power: int
    effective_burn: int


def calculate_combat_projection(
    attackers_list: List[Dict[str, Any]],
    enemy_blockers: List[BlockerState],
    turn_burn_power: int = 0,
    base_resonance: float = 1.0,
    burn_resistance: float = 0.0,
    burn_immune: bool = False,
    relic_mult_multiplier: float = 1.0,
) -> CombatProjection:
    """Calculates combat damage, blocker assignments, trample over, and resonance."""
    # Burn calculation
    effective_burn = turn_burn_power
    if burn_immune:
        effective_burn = 0
    elif burn_resistance > 0:
        effective_burn = int(-(-turn_burn_power * (1.0 - burn_resistance) // 1))  # Math.ceil

    # Expand attackers (accounting for creature count / tokens)
    attackers: List[ProjectedAttacker] = []
    for c in attackers_list:
        if not c.get("attacking") or c.get("summoningSick"):
            continue
        count = c.get("count", 1)
        kws = list(set(c.get("keywords", []) + c.get("tempKeywords", [])))
        unit_pow = max(0, c.get("power", 0) + c.get("tempPower", 0))
        unit_tough = max(1, c.get("toughness", 1) + c.get("tempToughness", 0))
        has_double_strike = "Double Strike" in kws
        strike_mult = 2 if has_double_strike else 1
        for _ in range(count):
            attackers.append(ProjectedAttacker(
                source_uid=c["uid"],
                name=c["name"],
                single_strike_power=unit_pow,
                power=unit_pow * strike_mult,
                toughness=unit_tough,
                keywords=kws,
            ))

    # Sort attackers highest power first
    attackers.sort(key=lambda a: a.power, reverse=True)

    available_blockers = [
        BlockerState(
            uid=b.uid,
            name=b.name,
            power=b.power,
            toughness=b.toughness,
            keywords=list(b.keywords),
            frozen=b.frozen,
            used=False,
            dies=False,
        )
        for b in enemy_blockers
    ]

    dead_blocker_uids: Set[str] = set()
    dead_attacker_counts_by_uid: Dict[str, int] = {}
    blocker_assignments: Dict[str, BlockerAssignment] = {}
    unblocked_creature_power = 0
    lifelink_heal = 0

    for att in attackers:
        is_flying = "Flying" in att.keywords
        has_trample = "Trample" in att.keywords
        has_deathtouch = "Deathtouch" in att.keywords
        has_lifelink = "Lifelink" in att.keywords
        has_double_strike = "Double Strike" in att.keywords

        # Find eligible blocker
        blocker = next(
            (b for b in available_blockers if not b.used and not b.frozen and (not is_flying or "Flying" in b.keywords)),
            None
        )

        dmg_to_boss = 0
        if not blocker:
            dmg_to_boss = att.power
        else:
            blocker.used = True
            lethal_needed = 1 if has_deathtouch else blocker.toughness

            if att.power >= lethal_needed and att.power > 0:
                blocker.dies = True
                dead_blocker_uids.add(blocker.uid)

            killed_on_first_strike = (
                has_double_strike and att.single_strike_power >= lethal_needed and att.single_strike_power > 0
            )

            blocker_has_deathtouch = "Deathtouch" in blocker.keywords
            attacker_lethal = 1 if blocker_has_deathtouch else att.toughness
            attacker_died = False

            if not killed_on_first_strike and blocker.power >= attacker_lethal and blocker.power > 0:
                dead_attacker_counts_by_uid[att.source_uid] = (
                    dead_attacker_counts_by_uid.get(att.source_uid, 0) + 1
                )
                attacker_died = True

            if has_trample:
                dmg_to_boss = max(0, att.power - lethal_needed)

            blocker_assignments[blocker.uid] = BlockerAssignment(
                attacker_uid=att.source_uid,
                attacker_name=att.name,
                dmg_taken=att.power,
                dies=blocker.dies,
                kills_attacker=attacker_died,
                trample_over=dmg_to_boss,
            )

        unblocked_creature_power += dmg_to_boss
        if has_lifelink:
            lifelink_heal += att.power

    total_power = unblocked_creature_power + effective_burn
    final_mult = base_resonance * relic_mult_multiplier
    total_damage = int(total_power * final_mult)

    return CombatProjection(
        power=total_power,
        mult=final_mult,
        total_damage=total_damage,
        lifelink_heal=lifelink_heal,
        attackers_count=len(attackers),
        dead_blocker_uids=dead_blocker_uids,
        dead_attacker_counts_by_uid=dead_attacker_counts_by_uid,
        blocker_assignments=blocker_assignments,
        unblocked_creature_power=unblocked_creature_power,
        effective_burn=effective_burn,
    )
