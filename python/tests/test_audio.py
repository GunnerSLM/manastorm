import numpy as np
from manastorm.audio.synth import generate_waveform, SOUND_CUES_DEF


def test_generate_waveform():
    # 440 Hz for 0.11 seconds
    pcm = generate_waveform(frequency=440.0, duration=0.11, waveform="triangle", level=0.58)
    assert isinstance(pcm, np.ndarray)
    assert pcm.dtype == np.int16
    assert pcm.shape[1] == 2  # Stereo
    assert len(pcm) > 0


def test_sound_cues_definitions():
    assert "cardPlay" in SOUND_CUES_DEF
    assert "manaTap" in SOUND_CUES_DEF
    assert "impact" in SOUND_CUES_DEF
    assert "victory" in SOUND_CUES_DEF
    assert "defeat" in SOUND_CUES_DEF
