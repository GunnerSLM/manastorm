from manastorm.core.engine import create_new_game
from manastorm.core.models import Relic, Card, LandState, CreatureState, ManaPool
from manastorm.core.cards import get_card_def


def test_create_new_game():
    game = create_new_game(deck_index=0, seed="SEED-TEST-001")
    assert game.player_life == 20
    assert len(game.hand) == 7
    assert len(game.master_deck) == 40
    assert len(game.library) == 33
    assert game.turn == 1
    assert game.enemy_life == 78
    assert len(game.enemy_creatures) >= 1


def test_play_land_and_mana():
    game = create_new_game(deck_index=0, seed="SEED-TEST-001")
    land_idx = next((i for i, c in enumerate(game.hand) if c.type == "Land"), None)
    if land_idx is not None:
        assert game.play_land(land_idx) is True
        assert len(game.player_lands) == 1
        assert game.lands_played_this_turn == 1
        second_land_idx = next((i for i, c in enumerate(game.hand) if c.type == "Land"), None)
        if second_land_idx is not None:
            assert game.play_land(second_land_idx) is False


def test_manual_land_tapping():
    game = create_new_game(deck_index=0, seed="SEED-TEST-001")
    game.player_lands = [LandState(uid="l1", id="forest", name="Forest", produces=["G"])]
    assert game.mana_pool.G == 0
    assert game.tap_land_manually("l1") is True
    assert game.mana_pool.G == 1
    # Tapping again fails
    assert game.tap_land_manually("l1") is False


def test_mulligan():
    game = create_new_game(deck_index=0, seed="SEED-TEST-001")
    assert game.can_mulligan is True
    assert game.mulligans_left == 1
    assert game.mulligan() is True
    assert len(game.hand) == 7
    assert game.can_mulligan is False
    assert game.mulligans_left == 0
    # Second mulligan fails
    assert game.mulligan() is False


def test_toggle_attacker():
    game = create_new_game(deck_index=0, seed="SEED-TEST-001")
    game.player_creatures = [
        CreatureState(uid="c1", id="bear", name="Bear", power=2, toughness=2, basePower=2, baseToughness=2, currentToughness=2, summoningSickness=False, attacking=True)
    ]
    assert game.player_creatures[0].attacking is True
    assert game.toggle_attacker("c1") is True
    assert game.player_creatures[0].attacking is False
    assert game.toggle_attacker("c1") is True
    assert game.player_creatures[0].attacking is True


def test_spell_effects_lightning_bolt():
    game = create_new_game(deck_index=0, seed="SEED-TEST-001")
    # Put Mountain on board
    game.player_lands = [LandState(uid="l1", id="mountain", name="Mountain", produces=["R"])]
    # Put Lightning Bolt in hand
    bolt = get_card_def("lightning_bolt")
    game.hand = [bolt]
    initial_blockers = len(game.enemy_creatures)
    assert game.play_spell(0) is True
    assert len(game.enemy_creatures) == initial_blockers - 1
    assert game.turn_resonance > 1.0


def test_spell_effects_cultivate():
    game = create_new_game(deck_index=0, seed="SEED-TEST-001")
    # Give player 3 green mana
    game.mana_pool.G = 3
    cultivate = get_card_def("cultivate")
    game.hand = [cultivate]
    initial_lands = len(game.player_lands)
    assert game.play_spell(0) is True
    assert len(game.player_lands) == initial_lands + 1
    assert game.turn_stats.landfalls >= 1


def test_spell_effects_overrun():
    game = create_new_game(deck_index=0, seed="SEED-TEST-001")
    game.mana_pool.G = 5
    game.player_creatures = [
        CreatureState(uid="c1", id="bear", name="Bear", power=2, toughness=2, basePower=2, baseToughness=2, currentToughness=2, summoningSickness=False)
    ]
    overrun = get_card_def("overrun")
    game.hand = [overrun]
    assert game.play_spell(0) is True
    assert game.player_creatures[0].tempPower == 3
    assert "Trample" in game.player_creatures[0].tempKeywords


def test_landfall_lotus_cobra():
    game = create_new_game(deck_index=0, seed="SEED-TEST-001")
    cobra = CreatureState(
        uid="cob1", id="lotus_cobra", name="Lotus Cobra", power=2, toughness=1, basePower=2, baseToughness=1, currentToughness=1,
        landfall="cobra"
    )
    game.player_creatures.append(cobra)
    initial_any = game.mana_pool.ANY
    # Deck 0 starts with Panharmonicon relic (extraTriggers: 1), so triggers = 2!
    assert game.get_trigger_multiplier() == 2
    game.trigger_landfall()
    assert game.mana_pool.ANY == initial_any + 2
