from manastorm.core.models import ManaPool, LandState, Card
from manastorm.core.mana import parse_mana_cost, find_mana_payment_plan, can_play_card


def test_parse_mana_cost():
    parsed = parse_mana_cost("{2}{G}{G}")
    assert parsed.generic == 2
    assert parsed.pips["G"] == 2
    assert parsed.pips["R"] == 0
    assert parsed.total == 4
    assert parsed.tokens == ["2", "G", "G"]

    empty = parse_mana_cost("")
    assert empty.total == 0
    assert empty.generic == 0


def test_bipartite_dual_land_matching():
    # Player has 1 Forest ({G}) and 1 Taiga ({R, G})
    # Needs to cast {R}{G}
    # Greedy picker might use Taiga for {G}, leaving only Forest which can't pay {R}.
    # Kuhn's algorithm must correctly assign Forest to {G} and Taiga to {R}!
    lands = [
        LandState(uid="land-1", id="forest", name="Forest", produces=["G"]),
        LandState(uid="land-2", id="taiga", name="Taiga", produces=["R", "G"]),
    ]
    pool = ManaPool()
    plan = find_mana_payment_plan("{R}{G}", pool, lands)
    assert plan is not None
    assert set(plan.lands_to_tap) == {"land-1", "land-2"}


def test_dual_land_with_generic():
    # Lands: Island ({U}), Taiga ({R, G})
    # Cost: {1}{U}
    lands = [
        LandState(uid="land-u", id="island", name="Island", produces=["U"]),
        LandState(uid="land-rg", id="taiga", name="Taiga", produces=["R", "G"]),
    ]
    pool = ManaPool()
    plan = find_mana_payment_plan("{1}{U}", pool, lands)
    assert plan is not None
    assert set(plan.lands_to_tap) == {"land-u", "land-rg"}


def test_insufficient_mana():
    lands = [LandState(uid="land-1", id="forest", name="Forest", produces=["G"])]
    pool = ManaPool()
    plan = find_mana_payment_plan("{2}{G}", pool, lands)
    assert plan is None


def test_treasure_mana():
    pool = ManaPool(ANY=2)
    lands = []
    plan = find_mana_payment_plan("{1}{W}", pool, lands)
    assert plan is not None
    assert plan.new_pool.ANY == 0
