from manastorm.core.combat import calculate_combat_projection, BlockerState


def test_unblocked_attack():
    attackers = [{
        "uid": "c1",
        "name": "Grizzly Bears",
        "power": 2,
        "toughness": 2,
        "attacking": True,
        "summoningSick": False,
        "keywords": [],
    }]
    blockers = []
    proj = calculate_combat_projection(attackers, blockers, base_resonance=2.0)
    assert proj.power == 2
    assert proj.mult == 2.0
    assert proj.total_damage == 4
    assert len(proj.dead_blocker_uids) == 0


def test_trample_over_blocker():
    # Attacker: 5/5 Trample
    # Blocker: 2/2
    # Trample damage over = 5 - 2 = 3
    attackers = [{
        "uid": "c1",
        "name": "Colossal Dreadmaw",
        "power": 5,
        "toughness": 5,
        "attacking": True,
        "summoningSick": False,
        "keywords": ["Trample"],
    }]
    blockers = [BlockerState(uid="b1", name="Wall", power=0, toughness=2)]
    proj = calculate_combat_projection(attackers, blockers, base_resonance=1.0)
    assert proj.total_damage == 3
    assert "b1" in proj.dead_blocker_uids


def test_flying_bypass_ground_blocker():
    # Attacker: 3/3 Flying
    # Blocker: 3/3 Ground (cannot block flying)
    attackers = [{
        "uid": "c1",
        "name": "Air Elemental",
        "power": 3,
        "toughness": 3,
        "attacking": True,
        "summoningSick": False,
        "keywords": ["Flying"],
    }]
    blockers = [BlockerState(uid="b1", name="Grounded Golem", power=3, toughness=3, keywords=[])]
    proj = calculate_combat_projection(attackers, blockers, base_resonance=1.0)
    assert proj.total_damage == 3
    assert "b1" not in proj.dead_blocker_uids


def test_deathtouch_attacker():
    # Attacker: 1/1 Deathtouch
    # Blocker: 10/10
    # Lethal needed is 1, so 10/10 dies!
    attackers = [{
        "uid": "c1",
        "name": "Ambush Viper",
        "power": 1,
        "toughness": 1,
        "attacking": True,
        "summoningSick": False,
        "keywords": ["Deathtouch"],
    }]
    blockers = [BlockerState(uid="b1", name="Darksteel Colossus", power=10, toughness=10)]
    proj = calculate_combat_projection(attackers, blockers, base_resonance=1.0)
    assert "b1" in proj.dead_blocker_uids
    assert proj.dead_attacker_counts_by_uid.get("c1") == 1  # Blocker hits back with 10 power
