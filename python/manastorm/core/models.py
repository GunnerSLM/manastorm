"""MANASTORM — Core Data Models & Schemas.

Defines typed dataclasses for Cards, Lands, Creatures, Relics, ManaPool, and Run State.
"""

from __future__ import annotations
from dataclasses import dataclass, field
from typing import Dict, List, Optional, Set, Any

COLORS = ["G", "R", "B", "U", "W"]
COLOR_NAMES = {
    "G": "Green",
    "R": "Red",
    "B": "Black",
    "U": "Blue",
    "W": "White",
    "C": "Colorless",
    "ANY": "Any (Treasure)"
}


@dataclass
class ManaPool:
    G: int = 0
    R: int = 0
    B: int = 0
    U: int = 0
    W: int = 0
    C: int = 0
    ANY: int = 0

    def copy(self) -> ManaPool:
        return ManaPool(
            G=self.G, R=self.R, B=self.B, U=self.U, W=self.W, C=self.C, ANY=self.ANY
        )

    def to_dict(self) -> Dict[str, int]:
        return {
            "G": self.G, "R": self.R, "B": self.B, "U": self.U,
            "W": self.W, "C": self.C, "ANY": self.ANY
        }

    @classmethod
    def from_dict(cls, data: Dict[str, Any]) -> ManaPool:
        return cls(
            G=int(data.get("G", 0)),
            R=int(data.get("R", 0)),
            B=int(data.get("B", 0)),
            U=int(data.get("U", 0)),
            W=int(data.get("W", 0)),
            C=int(data.get("C", 0)),
            ANY=int(data.get("ANY", 0)),
        )


@dataclass
class ParsedManaCost:
    generic: int = 0
    pips: Dict[str, int] = field(default_factory=lambda: {"G": 0, "R": 0, "B": 0, "U": 0, "W": 0})
    total: int = 0
    tokens: List[str] = field(default_factory=list)


@dataclass
class Card:
    id: str
    name: str
    type: str  # "Creature", "Land", "Spell", "Instant", "Sorcery"
    manaCost: str = ""
    power: Optional[int] = None
    toughness: Optional[int] = None
    keywords: List[str] = field(default_factory=list)
    text: str = ""
    produces: List[str] = field(default_factory=list)  # Lands
    isFetch: bool = False
    subtypes: List[str] = field(default_factory=list)
    etb: Optional[str] = None
    death: Optional[str] = None
    upkeep: Optional[str] = None
    landfall: Optional[str] = None
    connive: bool = False
    onLifegain: bool = False
    resonanceAdd: int = 0
    resonanceMult: float = 1.0
    burnPower: int = 0
    artPrompt: str = ""
    foil: Optional[str] = None
    lifeCost: int = 0
    effect: Optional[str] = None
    color: str = ""
    # Sanctum permanent evolution bonuses
    permPowerBonus: int = 0
    permToughnessBonus: int = 0
    evolutionChoice: Optional[str] = None
    # Instance unique ID (assigned when card is in a zone)
    uid: Optional[str] = None


@dataclass
class LandState:
    uid: str
    id: str
    name: str
    produces: List[str]
    tapped: bool = False
    isFetch: bool = False


@dataclass
class CreatureState:
    uid: str
    id: str
    name: str
    power: int
    toughness: int
    basePower: int
    baseToughness: int
    currentToughness: int
    keywords: List[str] = field(default_factory=list)
    tempKeywords: List[str] = field(default_factory=list)
    summoningSickness: bool = True
    attacking: bool = True
    tapped: bool = False
    counters: int = 0  # +1/+1 counters
    tempPower: int = 0
    tempToughness: int = 0
    count: int = 1
    isToken: bool = False
    color: str = ""
    etb: Optional[str] = None
    death: Optional[str] = None
    upkeep: Optional[str] = None
    landfall: Optional[str] = None
    connive: bool = False
    onLifegain: bool = False
    permPowerBonus: int = 0
    permToughnessBonus: int = 0
    evolutionChoice: Optional[str] = None


@dataclass
class Relic:
    id: str
    name: str
    desc: str
    cost: int = 0
    trigger: Optional[str] = None


@dataclass
class PaymentPlan:
    new_pool: ManaPool
    lands_to_tap: List[str]  # Land UIDs
