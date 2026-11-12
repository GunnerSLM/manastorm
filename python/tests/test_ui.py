from manastorm.ui.physics import SpringState, step_spring, calculate_drag_lean, calculate_card_tilt
from manastorm.ui.hand_fan import calculate_fan_layout


def test_spring_physics():
    # Spring starts at pos=0, target is 100
    state = SpringState(pos=0.0, vel=0.0)
    dt = 1.0 / 60.0  # 60 FPS
    for _ in range(60):
        state = step_spring(state, target=100.0, dt=dt, stiffness=280.0, damping=28.0)
    # After 1 second, damped spring should have converged very close to 100
    assert abs(state.pos - 100.0) < 5.0


def test_drag_lean():
    lean_left = calculate_drag_lean(-400.0)
    lean_right = calculate_drag_lean(400.0)
    assert lean_left == -10.0
    assert lean_right == 10.0

    # Clamping test
    extreme_lean = calculate_drag_lean(10000.0)
    assert extreme_lean == 15.0


def test_fanned_hand_layout():
    # 5 cards in hand
    count = 5
    center_card = calculate_fan_layout(idx=2, count=count)
    assert center_card.rot == 0.0
    assert center_card.x == 0.0

    left_card = calculate_fan_layout(idx=0, count=count)
    right_card = calculate_fan_layout(idx=4, count=count)
    assert left_card.rot < 0.0
    assert right_card.rot > 0.0
    assert left_card.rot == -right_card.rot
    assert left_card.y == right_card.y
