"""MANASTORM — Procedural Audio Waveform Synthesizer.

Replicates the Web Audio API oscillator synthesis from ui.js using NumPy
and pygame.mixer.Sound. Zero external audio file dependencies.
"""

from __future__ import annotations
import numpy as np
from typing import Dict, List, Any, Optional

SAMPLE_RATE = 44100


def generate_waveform(
    frequency: float,
    duration: float,
    waveform: str = "sine",
    level: float = 0.5,
    sample_rate: int = SAMPLE_RATE
) -> np.ndarray:
    """Generates an 8-bit or 16-bit PCM waveform with an exponential release envelope."""
    num_samples = int(sample_rate * duration)
    if num_samples <= 0:
        return np.zeros(0, dtype=np.int16)

    t = np.linspace(0, duration, num_samples, endpoint=False)

    if waveform == "sine":
        samples = np.sin(2.0 * np.pi * frequency * t)
    elif waveform == "triangle":
        samples = 2.0 * np.abs(2.0 * (t * frequency - np.floor(t * frequency + 0.5))) - 1.0
    elif waveform == "sawtooth":
        samples = 2.0 * (t * frequency - np.floor(t * frequency + 0.5))
    else:  # square fallback
        samples = np.sign(np.sin(2.0 * np.pi * frequency * t))

    # Apply exponential decay envelope to avoid speaker clicks
    envelope = np.exp(-3.0 * t / duration)
    samples = samples * envelope * level

    # Convert to 16-bit signed stereo PCM
    pcm_16 = (samples * 32767.0).astype(np.int16)
    stereo = np.column_stack((pcm_16, pcm_16))
    return np.ascontiguousarray(stereo)


# Replicate exact sound cues from ui.js
SOUND_CUES_DEF: Dict[str, List[Dict[str, Any]]] = {
    "cardPlay": [{"frequency": 440.0, "duration": 0.11, "waveform": "triangle", "level": 0.58}],
    "manaTap": [{"frequency": 660.0, "duration": 0.08, "waveform": "sine", "level": 0.5}],
    "impact": [
        {"frequency": 150.0, "duration": 0.14, "waveform": "sine", "level": 0.62, "offset": 0.0},
        {"frequency": 245.0, "duration": 0.10, "waveform": "triangle", "level": 0.22, "offset": 0.025},
    ],
    "victory": [
        {"frequency": 523.0, "duration": 0.18, "waveform": "sine", "level": 0.48, "offset": 0.0},
        {"frequency": 659.0, "duration": 0.19, "waveform": "sine", "level": 0.48, "offset": 0.12},
        {"frequency": 784.0, "duration": 0.26, "waveform": "triangle", "level": 0.48, "offset": 0.24},
    ],
    "defeat": [
        {"frequency": 392.0, "duration": 0.22, "waveform": "sawtooth", "level": 0.45, "offset": 0.0},
        {"frequency": 311.0, "duration": 0.24, "waveform": "sawtooth", "level": 0.45, "offset": 0.15},
        {"frequency": 220.0, "duration": 0.35, "waveform": "sine", "level": 0.55, "offset": 0.32},
    ],
}


class SoundManager:
    """Manages playback of procedurally synthesized sound effects."""

    def __init__(self, enabled: bool = True):
        self.enabled = enabled
        self._initialized = False
        self._sound_cache: Dict[str, Any] = {}

    def init_audio(self) -> None:
        if self._initialized:
            return
        try:
            import pygame
            if not pygame.mixer.get_init():
                pygame.mixer.init(frequency=SAMPLE_RATE, size=-16, channels=2, buffer=512)
            self._initialized = True
            self._prebake_sounds()
        except Exception:
            # Headless / audio device absent fallback
            self.enabled = False

    def _prebake_sounds(self) -> None:
        import pygame
        for cue_name, cue_list in SOUND_CUES_DEF.items():
            # Calculate total duration
            total_duration = max(c.get("offset", 0.0) + c["duration"] for c in cue_list)
            num_samples = int(SAMPLE_RATE * total_duration)
            combined = np.zeros((num_samples, 2), dtype=np.int16)

            for cue in cue_list:
                offset_samples = int(SAMPLE_RATE * cue.get("offset", 0.0))
                wf = generate_waveform(cue["frequency"], cue["duration"], cue["waveform"], cue["level"])
                end_samples = min(num_samples, offset_samples + len(wf))
                actual_len = end_samples - offset_samples
                if actual_len > 0:
                    combined[offset_samples:end_samples] = np.clip(
                        combined[offset_samples:end_samples].astype(np.int32) + wf[:actual_len].astype(np.int32),
                        -32768, 32767
                    ).astype(np.int16)

            self._sound_cache[cue_name] = pygame.sndarray.make_sound(combined)

    def play(self, cue_name: str) -> None:
        if not self.enabled or not self._initialized:
            return
        sound = self._sound_cache.get(cue_name)
        if sound:
            sound.play()
