"""MANASTORM — Exact Colored Mana Solver, Pip Parser & Smart Auto-Tapper.

Uses Kuhn's bipartite augmenting-path matching algorithm for dual lands so greedy color
ordering never creates false payment failures.
"""

from __future__ import annotations
import re
from typing import List, Optional, Set, Sequence
from manastorm.core.models import COLORS, ManaPool, ParsedManaCost, PaymentPlan, LandState, Card


def parse_mana_cost(mana_cost_str: str = "") -> ParsedManaCost:
    """Parses e.g. '{2}{G}{G}' into generic=2, pips={'G': 2, ...}, total=4, tokens=['2', 'G', 'G']."""
    result = ParsedManaCost()
    if not mana_cost_str:
        return result

    matches = re.findall(r"\{([^}]+)\}", mana_cost_str)
    for sym in matches:
        result.tokens.append(sym)
        if sym.isdigit():
            val = int(sym)
            result.generic += val
            result.total += val
        elif sym in result.pips:
            result.pips[sym] += 1
            result.total += 1
    return result


def find_mana_payment_plan(
    mana_cost_str: str,
    mana_pool: ManaPool,
    player_lands: Sequence[LandState],
    has_lantern: bool = False
) -> Optional[PaymentPlan]:
    """Finds an exact assignment of Floating Mana + Untapped Lands that satisfies both

    colored requirements (e.g. {G}{G}, {U}{R}) and generic requirements (e.g. {2}),
    using Kuhn's bipartite matching for dual lands.
    """
    req = parse_mana_cost(mana_cost_str)
    pool = mana_pool.copy()

    # Untapped lands sorted so single-color lands are preferred before dual lands
    untapped_lands: List[LandState] = [
        l for l in player_lands if not l.tapped
    ]
    untapped_lands.sort(key=lambda l: len(l.produces))

    used_land_uids: Set[str] = set()

    # Step 1: Pay exact colored pips ({G}, {R}, {B}, {U}, {W})
    # 1a. Use matching floating colored mana first
    for col in COLORS:
        current_in_pool = getattr(pool, col)
        use_from_pool = min(req.pips[col], current_in_pool)
        req.pips[col] -= use_from_pool
        setattr(pool, col, current_in_pool - use_from_pool)

    # 1b. Use single-color untapped lands that produce the required color (when Chromatic Lantern is inactive)
    if not has_lantern:
        for col in COLORS:
            while req.pips[col] > 0:
                single_land = next(
                    (
                        l for l in untapped_lands
                        if l.uid not in used_land_uids and len(l.produces) == 1 and l.produces[0] == col
                    ),
                    None
                )
                if single_land:
                    used_land_uids.add(single_land.uid)
                    req.pips[col] -= 1
                else:
                    break

    # 1c. Exact bipartite matching (Kuhn's algorithm) for remaining colored pips against remaining untapped lands
    pips_list: List[str] = []
    for col in COLORS:
        pips_list.extend([col] * req.pips[col])

    candidate_lands: List[LandState] = [l for l in untapped_lands if l.uid not in used_land_uids]
    num_candidates = len(candidate_lands)
    land_match_pip_idx: List[int] = [-1] * num_candidates

    def can_assign_pip(pip_idx: int, visited_lands: List[bool]) -> bool:
        col = pips_list[pip_idx]
        for l_idx in range(num_candidates):
            if visited_lands[l_idx]:
                continue
            land = candidate_lands[l_idx]
            if not has_lantern and col not in land.produces:
                continue

            visited_lands[l_idx] = True
            if land_match_pip_idx[l_idx] == -1 or can_assign_pip(land_match_pip_idx[l_idx], visited_lands):
                land_match_pip_idx[l_idx] = pip_idx
                return True
        return False

    matched_pips_count = 0
    for p_idx in range(len(pips_list)):
        visited_lands = [False] * num_candidates
        if can_assign_pip(p_idx, visited_lands):
            matched_pips_count += 1

    for l_idx in range(num_candidates):
        if land_match_pip_idx[l_idx] != -1:
            used_land_uids.add(candidate_lands[l_idx].uid)

    # 1d. Use floating ANY (Treasure) mana for any colored pips not covered by lands
    unmatched_colored_pips = len(pips_list) - matched_pips_count
    if unmatched_colored_pips > pool.ANY:
        return None
    pool.ANY -= unmatched_colored_pips

    # Step 2: Pay Generic Mana ({1}, {2}, {3}...)
    generic_needed = req.generic

    # 2a. Spend Colorless {C} floating mana first
    use_c = min(generic_needed, pool.C)
    generic_needed -= use_c
    pool.C -= use_c

    # 2b. Spend remaining colored floating mana
    for col in COLORS:
        current_in_pool = getattr(pool, col)
        use_col = min(generic_needed, current_in_pool)
        generic_needed -= use_col
        setattr(pool, col, current_in_pool - use_col)

    # 2c. Tap remaining untapped lands (single-color first, duals second)
    for land in untapped_lands:
        if generic_needed <= 0:
            break
        if land.uid not in used_land_uids:
            used_land_uids.add(land.uid)
            generic_needed -= 1

    # 2d. Spend floating ANY (Treasure) mana last
    use_wild = min(generic_needed, pool.ANY)
    generic_needed -= use_wild
    pool.ANY -= use_wild

    if generic_needed > 0:
        return None

    return PaymentPlan(new_pool=pool, lands_to_tap=list(used_land_uids))


def can_play_card(
    card: Card,
    mana_pool: ManaPool,
    player_lands: Sequence[LandState],
    lands_played_this_turn: int,
    max_lands_per_turn: int,
    player_life: int,
    combat_locked: bool = False,
    run_over: bool = False,
    has_lantern: bool = False
) -> bool:
    if run_over or combat_locked:
        return False
    if card.type == "Land":
        return lands_played_this_turn < max_lands_per_turn
    if card.lifeCost > 0 and player_life <= card.lifeCost:
        return False
    return find_mana_payment_plan(card.manaCost, mana_pool, player_lands, has_lantern) is not None
