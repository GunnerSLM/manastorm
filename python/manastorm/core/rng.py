"""MANASTORM — Deterministic 32-bit PRNG & Hashing Engines.

Replicates exact Mulberry32 and XorShift32 algorithms from game.js,
enforcing 32-bit unsigned integer wrapping to match JavaScript V8 bitwise semantics.
"""

from typing import Callable, Optional

MAX_RUN_SEED_LENGTH = 64


def normalize_run_seed(seed: Optional[str]) -> Optional[str]:
    if seed is None:
        return None
    normalized = str(seed).strip()
    return normalized if 0 < len(normalized) <= MAX_RUN_SEED_LENGTH else None


def is_valid_run_seed_input(seed: Optional[str]) -> bool:
    if seed is None or str(seed).strip() == "":
        return True
    return normalize_run_seed(seed) is not None


def hash_run_seed(seed: str) -> int:
    """FNV-1a 32-bit hash identical to hashRunSeed in game.js."""
    text = str(seed)
    h = 0x811C9DC5
    for ch in text:
        h ^= ord(ch)
        # Math.imul(hash, 0x01000193) >>> 0
        h = (h * 0x01000193) & 0xFFFFFFFF
    return h or 0x6D2B79F5


def normalize_saved_rng_state(seed: Optional[str], rng_state: Optional[int]) -> Optional[int]:
    normalized_seed = normalize_run_seed(seed)
    if not normalized_seed:
        return None
    if rng_state is not None:
        try:
            numeric_state = int(rng_state)
            if 0 < numeric_state <= 0xFFFFFFFF:
                return numeric_state & 0xFFFFFFFF
        except (ValueError, TypeError):
            pass
    return hash_run_seed(normalized_seed)


def create_mulberry32(seed: int) -> Callable[[], float]:
    """Mulberry32 generator matching generatedRandom in game.js."""
    state = seed & 0xFFFFFFFF

    def next_random() -> float:
        nonlocal state
        state = (state + 0x6D2B79F5) & 0xFFFFFFFF
        t = state
        # t = Math.imul(t ^ (t >>> 15), t | 1);
        t = (((t ^ (t >> 15)) * (t | 1)) & 0xFFFFFFFF)
        # t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        term = ((t ^ (t >> 7)) * (t | 61)) & 0xFFFFFFFF
        t = (t ^ ((t + term) & 0xFFFFFFFF)) & 0xFFFFFFFF
        # return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
        return ((t ^ (t >> 14)) & 0xFFFFFFFF) / 4294967296.0

    return next_random


class XorShift32RNG:
    """XorShift32 engine matching gameRandom in game.js."""

    def __init__(self, run_seed: Optional[str] = None, initial_state: Optional[int] = None):
        self.run_seed: Optional[str] = normalize_run_seed(run_seed)
        if self.run_seed:
            self.state: Optional[int] = normalize_saved_rng_state(self.run_seed, initial_state)
        else:
            self.state = None

    def random(self) -> float:
        import random
        if not self.run_seed:
            return random.random()

        if self.state is None:
            self.state = hash_run_seed(self.run_seed)

        value = self.state
        value ^= (value << 13) & 0xFFFFFFFF
        value ^= (value >> 17) & 0xFFFFFFFF
        value ^= (value << 5) & 0xFFFFFFFF
        self.state = value & 0xFFFFFFFF
        return self.state / 0x100000000
