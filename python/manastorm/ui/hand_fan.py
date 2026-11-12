"""MANASTORM — Fanned Arc Hand Layout Geometry.

Replicates calculateFanLayout from ui.js for natural parabolic arc sag and rotation.
"""

from __future__ import annotations
from dataclasses import dataclass


@dataclass
class FanCardLayout:
    x: float
    y: float
    rot: float
    overlap: float


def calculate_fan_layout(
    idx: int = 0,
    count: int = 1,
    container_width: float = 900.0,
    card_width: float = 148.0
) -> FanCardLayout:
    """Calculates fanned hand position, sagitta drop (y), and rotation angle (deg)."""
    c = max(0, int(count))
    w = max(1.0, float(container_width))
    cw = max(1.0, float(card_width))

    if c <= 1:
        return FanCardLayout(x=0.0, y=0.0, rot=0.0, overlap=0.0)

    i = max(0, min(c - 1, int(idx)))
    pad = 80.0
    avail = max(cw, w - pad)
    step = min(cw, (avail - cw) / (c - 1))
    overlap = max(0.0, cw - step)

    center_idx = (c - 1) / 2.0
    norm = (i - center_idx) / center_idx if center_idx > 0 else 0.0

    max_rot = min(12.0, center_idx * 2.5)
    rot = max(-12.0, min(12.0, norm * max_rot))

    max_drop = min(14.0, center_idx * 2.5)
    y = max(0.0, min(14.0, (norm * norm) * max_drop))

    x = (i - center_idx) * step

    return FanCardLayout(
        x=round(x, 2),
        y=round(y, 2),
        rot=round(rot, 2),
        overlap=round(overlap, 2)
    )
