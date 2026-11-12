"""MANASTORM — Symplectic Euler Spring Physics Engine.

Replicates the fluid card dragging, velocity lean, and wobble snapbacks from ui.js.
"""

from __future__ import annotations
from dataclasses import dataclass
import math


@dataclass
class SpringState:
    pos: float = 0.0
    vel: float = 0.0


def step_spring(
    state: SpringState,
    target: float,
    dt: float,
    stiffness: float = 260.0,
    damping: float = 22.0
) -> SpringState:
    """Computes one integration step of a damped harmonic oscillator using Symplectic Euler."""
    force = -stiffness * (state.pos - target) - damping * state.vel
    new_vel = state.vel + force * dt
    new_pos = state.pos + new_vel * dt
    return SpringState(pos=new_pos, vel=new_vel)


def calculate_drag_lean(vel_x: float, min_lean: float = -15.0, max_lean: float = 15.0) -> float:
    """Computes natural card lean angle (degrees) based on horizontal drag velocity."""
    raw_lean = vel_x * 0.025
    return max(min_lean, min(max_lean, raw_lean))


def calculate_card_tilt(
    center_x: float,
    center_y: float,
    mouse_x: float,
    mouse_y: float,
    card_width: float,
    card_height: float,
    max_tilt_deg: float = 12.0
) -> tuple[float, float, float, float]:
    """Calculates 3D perspective rotation (rx, ry) and glare coordinates for card hover."""
    dx = (mouse_x - center_x) / (card_width / 2.0)
    dy = (mouse_y - center_y) / (card_height / 2.0)
    dx = max(-1.0, min(1.0, dx))
    dy = max(-1.0, min(1.0, dy))

    rot_x = -dy * max_tilt_deg
    rot_y = dx * max_tilt_deg
    glare_x = (dx + 1.0) * 50.0  # Percentage 0..100
    glare_y = (dy + 1.0) * 50.0
    return rot_x, rot_y, glare_x, glare_y
