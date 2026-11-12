"""MANASTORM — Card Database and Deck Loader.

Loads static card definitions, starter decks, and encounters from data/cards.json.
"""

from __future__ import annotations
import json
from pathlib import Path
from typing import Dict, List, Any
from manastorm.core.models import Card

DATA_DIR = Path(__file__).resolve().parent.parent / "data"

with open(DATA_DIR / "cards.json", "r", encoding="utf-8") as f:
    _RAW_CARDS = json.load(f)

with open(DATA_DIR / "starter_decks.json", "r", encoding="utf-8") as f:
    STARTER_DECKS: List[Dict[str, Any]] = json.load(f)

with open(DATA_DIR / "encounters.json", "r", encoding="utf-8") as f:
    ENCOUNTERS: List[Dict[str, Any]] = json.load(f)

with open(DATA_DIR / "consumables.json", "r", encoding="utf-8") as f:
    CONSUMABLES: List[Dict[str, Any]] = json.load(f)


def get_card_def(card_id: str) -> Card:
    """Returns a fresh Card instance for the given ID."""
    raw = _RAW_CARDS.get(card_id)
    if not raw:
        raise KeyError(f"Unknown card ID: {card_id}")
    return Card(
        id=raw["id"],
        name=raw["name"],
        type=raw["type"],
        manaCost=raw.get("manaCost", ""),
        power=raw.get("power"),
        toughness=raw.get("toughness"),
        keywords=list(raw.get("keywords", [])),
        text=raw.get("rules", raw.get("text", "")),
        produces=list(raw.get("produces", [])),
        isFetch=bool(raw.get("isFetch", False)),
        subtypes=list(raw.get("subtypes", [raw.get("subtype")]) if raw.get("subtype") else []),
        etb=raw.get("etb"),
        death=raw.get("death"),
        upkeep=raw.get("upkeep"),
        landfall=raw.get("landfall"),
        connive=bool(raw.get("connive", False)),
        onLifegain=bool(raw.get("onLifegain", False)),
        resonanceAdd=raw.get("resonanceAdd", 0),
        resonanceMult=float(raw.get("resonanceMult", 1.0)),
        burnPower=raw.get("burnPower", 0),
        artPrompt=raw.get("artPrompt", ""),
        foil=raw.get("foil"),
        lifeCost=raw.get("lifeCost", 0),
        effect=raw.get("effect"),
        color=raw.get("color", ""),
    )


def get_all_card_ids() -> List[str]:
    return list(_RAW_CARDS.keys())
