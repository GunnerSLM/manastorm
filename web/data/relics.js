// MANASTORM — Command Zone Relics (Balatro Jokers) & Synergy Engine

const RELIC_DB = [
  {
    id: "impact_tremors",
    name: "Impact Tremors",
    cost: 6,
    desc: "Whenever a Creature or Token enters your battlefield, gain +2 Resonance and +2 Burn Power.",
    onCreatureEnter(st, { count }) {
      addResonance(2 * count, "Impact Tremors");
      addBurnPower(2 * count, "Impact Tremors");
      spawnFx(`Impact Tremors: +${2 * count} Mult!`, "#ff4757");
    }
  },
  {
    id: "doubling_season",
    name: "Doubling Season",
    cost: 12,
    desc: "Whenever you create Creature Tokens or gain +1/+1 buffs, create TWICE as many!",
    tokenMultiplier: 2
  },
  {
    id: "panharmonicon",
    name: "Panharmonicon",
    cost: 8,
    desc: "All Enter-the-Battlefield (ETB) and Landfall triggers activate an additional time!",
    extraTriggers: 1
  },
  {
    id: "cathars_crusade",
    name: "Cathars' Crusade",
    cost: 10,
    desc: "Whenever a Creature or Token stack enters your battlefield, put +1/+1 on ALL Creatures you control.",
    onCreatureEnter(st, { tokenMult }) {
      const buff = 1 * tokenMult;
      st.playerCreatures.forEach(c => {
        c.power += buff;
        c.toughness += buff;
      });
      spawnFx(`Cathars' Crusade: Board +${buff}/+${buff}!`, "#ffe299");
    }
  },
  {
    id: "sol_ring",
    name: "Sol Ring",
    cost: 11,
    desc: "At the start of every turn, add {C}{C} (2 Colorless Mana) to your mana pool.",
    onTurnStart(st) {
      st.manaPool.C += 2;
    }
  },
  {
    id: "chromatic_lantern",
    name: "Chromatic Lantern",
    cost: 10,
    desc: "Your Lands can tap for ANY color of mana, and you start each turn with +1 Any-Color Treasure Mana!",
    anyColorLands: true,
    onTurnStart(st) {
      st.manaPool.ANY += 1;
    }
  },
  {
    id: "fiery_emancipation",
    name: "Fiery Emancipation",
    cost: 8,
    desc: "Multiplies your total Combat Resonance by ×2 during every attack!",
    onModifyCombatMult(mult) {
      return mult * 2;
    }
  },
  {
    id: "aetherflux_reservoir",
    name: "Aetherflux Reservoir",
    cost: 5,
    desc: "Whenever you cast an Instant or Sorcery, gain +3 Resonance and heal 2 Life.",
    onSpellCast() {
      addResonance(3, "Aetherflux Reservoir");
      gainLife(2, "Aetherflux Reservoir");
      spawnFx("Aetherflux: +2 Mult & +2 Life!", "#59a2ff");
    }
  },
  {
    id: "crucible_of_worlds",
    name: "Crucible of Worlds",
    cost: 10,
    desc: "Graveyard Engine: Whenever a Land, Creature, or Spell enters your Graveyard, gain +1 Resonance and +1 Treasure Mana (up to 2×/turn)!",
    onGraveyardEnter(st) {
      st.turnStats.graveTriggers = (st.turnStats.graveTriggers || 0) + 1;
      if (st.turnStats.graveTriggers <= 2) {
        addResonance(1, "Crucible of Worlds");
        st.manaPool.ANY += 1;
        spawnFx("Crucible: +1 Mult & +1 Treasure!", "#9b59b6");
      }
    }
  },
  {
    id: "nyxbloom_ancient",
    name: "Nyxbloom Ancient",
    cost: 6,
    desc: "Mana Surge: Each untapped Land and unspent Mana in your pool grants +1 Resonance (up to +5) and +2 Power during Combat!",
    manaSurge: true
  },
  {
    id: "heliod_sun_crowned",
    name: "Heliod, Sun-Crowned",
    cost: 5,
    desc: "Radiant Devotion: Whenever you gain Life, put +1/+1 on ALL Creatures you control and gain +2 Resonance!",
    onLifeGain(st) {
      const buff = 1 * getTokenMultiplier();
      st.playerCreatures.forEach(c => {
        c.power += buff;
        c.toughness += buff;
      });
      addResonance(2, "Heliod, Sun-Crowned");
      spawnFx(`Heliod: Board +${buff}/+${buff} & +2 Mult!`, "#ffe299");
    }
  },
  {
    id: "shark_typhoon",
    name: "Shark Typhoon",
    cost: 7,
    desc: "Tempo Skies: Whenever you cast your 2nd+ Instant or Sorcery each turn, create a 2/2 Blue Shark token with Flying & Haste!",
    onSpellCast(st) {
      if (st.turnStats.spells >= 2) {
        spawnTokens("Sky Shark Token", 2, 2, "U", ["Flying", "Haste"], 1);
      }
    }
  },
  {
    id: "goblin_warren",
    name: "Goblin Warren",
    cost: 6,
    desc: "At the start of Turn 1, spawn two 1/1 Haste Goblins. Goblin Horde synergy bonuses are DOUBLED.",
    boosts: { goblin: 2 },
    onTurnStart(st, { isFirstTurn }) {
      if (isFirstTurn) spawnTokens("Goblin Token", 1, 1, "R", ["Haste"], 2);
    }
  },
  {
    id: "ral_storm_conduit",
    name: "Ral, Storm Conduit",
    cost: 5,
    desc: "Whenever you cast an Instant or Sorcery, deal +3 Burn Power. Spellstorm synergy bonuses are DOUBLED.",
    boosts: { storm: 2 },
    onSpellCast() {
      addBurnPower(3, "Ral, Storm Conduit");
      addResonance(1, "Ral, Storm Conduit");
    }
  },
  {
    id: "omnath_locus",
    name: "Omnath, Locus of Rage",
    cost: 6,
    desc: "Start each turn with +2 Resonance per 2 Lands you control. Landfall Surge synergy bonuses are DOUBLED.",
    boosts: { landfall: 2 },
    onTurnStart(st) {
      const bonus = Math.floor(st.playerLands.length / 2);
      if (bonus > 0) addResonance(2 * bonus, "Omnath, Locus of Rage");
    }
  },
  {
    id: "hive_mind",
    name: "Hive Mind",
    cost: 4,
    desc: "Start each turn with +2 Resonance if you control 2+ Creatures. Swarm and Titanfall synergy bonuses are boosted ×1.5.",
    boosts: { swarm: 1.5, titans: 1.5 },
    onTurnStart(st) {
      if (st.playerCreatures.length >= 2) addResonance(2, "Hive Mind");
    }
  },
  {
    id: "prismatic_omen",
    name: "Prismatic Omen",
    cost: 6,
    desc: "Start each turn with +1 Resonance (+1 extra Color toward Prismatic Court). Prismatic Court & Graveborn bonuses are DOUBLED.",
    boosts: { rainbow: 2, grave: 2 },
    rainbowBonus: 1,
    onTurnStart() {
      addResonance(1, "Prismatic Omen");
    }
  },
  {
    id: "exploration",
    name: "Exploration",
    cost: 9,
    desc: "You may play an additional Land during each of your turns (+1 Land Drop/turn).",
    onTurnStart(st) {
      st.maxLandsPerTurn += 1;
    }
  }
];

function hasRelic(id) {
  return state.relics.some(r => r.id === id);
}

function getRelicDefs() {
  return state.relics
    .map(r => RELIC_DB.find(def => def.id === r.id))
    .filter(Boolean);
}

function dispatchRelicEvent(hookName, payload = {}) {
  for (const def of getRelicDefs()) {
    if (typeof def[hookName] === "function") {
      def[hookName](state, payload);
    }
  }
}

function getTriggerMultiplier() {
  return getRelicDefs().reduce((mult, def) => mult + (def.extraTriggers || 0), 1);
}

function getTokenMultiplier() {
  return getRelicDefs().reduce((mult, def) => mult * (def.tokenMultiplier || 1), 1);
}

function hasAnyColorLands() {
  return getRelicDefs().some(def => Boolean(def.anyColorLands));
}

function getCombatResonanceMultiplier(baseMult) {
  return getRelicDefs().reduce(
    (mult, def) => (typeof def.onModifyCombatMult === "function" ? def.onModifyCombatMult(mult, state) : mult),
    baseMult
  );
}

// === SYNERGY ENGINE ===
function boardUnits(pred) {
  return state.playerCreatures.reduce((n, c) => (pred(c) ? n + (c.count || 1) : n), 0);
}

const SYNERGIES = [
  { id: "storm", name: "Spellstorm", icon: "🌩️", unit: "spells cast this turn",
    count: s => s.turnStats.spells,
    tiers: [[2, { mult: 1 }], [4, { mult: 3 }], [6, { mult: 6 }]] },
  { id: "landfall", name: "Landfall Surge", icon: "🌋", unit: "landfalls this turn",
    count: s => s.turnStats.landfalls,
    tiers: [[2, { mult: 1 }], [4, { mult: 2, power: 4 }], [7, { mult: 4, power: 10 }]] },
  { id: "goblin", name: "Goblin Horde", icon: "👺", unit: "Goblins",
    count: () => boardUnits(c => c.subtype === "Goblin"),
    tiers: [[3, { power: 3 }], [6, { power: 8, mult: 1 }], [10, { power: 18, mult: 2 }]] },
  { id: "swarm", name: "Swarm", icon: "🐝", unit: "creatures on board",
    count: () => boardUnits(() => true),
    tiers: [[5, { mult: 1 }], [10, { mult: 3 }], [20, { mult: 6 }]] },
  { id: "titans", name: "Titanfall", icon: "🦖", unit: "creatures with 5+ power",
    count: () => boardUnits(c => c.power + (c.tempPower || 0) >= 5),
    tiers: [[1, { power: 3 }], [2, { mult: 2 }], [3, { mult: 4 }]] },
  { id: "skies", name: "Aerial Fleet", icon: "🦅", unit: "Flying creatures",
    count: () => boardUnits(c => getCreatureKeywords(c).includes("Flying")),
    tiers: [[2, { mult: 1, power: 2 }], [4, { mult: 3, power: 5 }], [6, { mult: 5, power: 10 }]] },
  { id: "rainbow", name: "Prismatic Court", icon: "🌈", unit: "colors among creatures & lands",
    count: s => {
      const cols = new Set();
      s.playerCreatures.forEach(c => { if ("GRBUW".includes(c.color || "-")) cols.add(c.color); });
      s.playerLands.forEach(l => (l.produces || []).forEach(x => cols.add(x)));
      const bonus = getRelicDefs().reduce((sum, d) => sum + (d.rainbowBonus || 0), 0);
      return Math.min(5, cols.size + bonus);
    },
    tiers: [[3, { mult: 2 }], [4, { mult: 4 }], [5, { mult: 7 }]] },
  { id: "grave", name: "Graveborn", icon: "🪦", unit: "creatures in Graveyard",
    count: s => s.graveyard.filter(c => c.type === "Creature").length,
    tiers: [[2, { power: 3 }], [4, { mult: 2 }], [6, { mult: 4 }]] }
];

function getSynergyStates() {
  const defs = getRelicDefs();
  return SYNERGIES.map(syn => {
    const count = syn.count(state);
    let tier = -1;
    syn.tiers.forEach(([need], i) => { if (count >= need) tier = i; });
    const boost = defs.reduce((m, d) => m * ((d.boosts && d.boosts[syn.id]) || 1), 1);
    const b = tier >= 0 ? syn.tiers[tier][1] : {};
    const next = syn.tiers[tier + 1] ? syn.tiers[tier + 1][0] : null;
    return { ...syn, count, tier, boost, next, mult: (b.mult || 0) * boost, power: (b.power || 0) * boost };
  });
}
