// MANASTORM — Command Zone Relics, Rarity Tiers, Boss Relics & Synergy Engine

const RELIC_RARITIES = {
  common: { id: "common", label: "Common", weight: 50 },
  uncommon: { id: "uncommon", label: "Uncommon", weight: 35 },
  rare: { id: "rare", label: "Rare", weight: 15 },
  boss: { id: "boss", label: "Boss Relic", weight: 0 }
};

const RELIC_DB = [
  {
    id: "impact_tremors",
    name: "Seismic Echo",
    cost: 6,
    rarity: "common",
    desc: "Whenever a Creature or Token enters your battlefield, gain +2 Resonance and +2 Burn Power.",
    onCreatureEnter(st, { count }) {
      addResonance(2 * count, "Seismic Echo");
      addBurnPower(2 * count, "Seismic Echo");
      spawnFx(`Seismic Echo: +${2 * count} Mult!`, "#ff4757");
    }
  },
  {
    id: "doubling_season",
    name: "Twinborn Leyline",
    cost: 12,
    rarity: "rare",
    desc: "Whenever you create Creature Tokens or gain +1/+1 buffs, create TWICE as many!",
    tokenMultiplier: 2
  },
  {
    id: "panharmonicon",
    name: "Resonance Chamber",
    cost: 8,
    rarity: "uncommon",
    desc: "All Enter-the-Battlefield (ETB) and Landfall triggers activate an additional time!",
    extraTriggers: 1
  },
  {
    id: "cathars_crusade",
    name: "Banner of the Dawn",
    cost: 10,
    rarity: "rare",
    desc: "Whenever a Creature or Token stack enters your battlefield, put +1/+1 on ALL Creatures you control.",
    onCreatureEnter(st, { tokenMult }) {
      const buff = 1 * tokenMult;
      st.playerCreatures.forEach(c => {
        c.power += buff;
        c.toughness += buff;
      });
      spawnFx(`Banner of the Dawn: Board +${buff}/+${buff}!`, "#ffe299");
    }
  },
  {
    id: "sol_ring",
    name: "Solar Conduit",
    cost: 11,
    rarity: "rare",
    desc: "At the start of every turn, add {C}{C} (2 Colorless Mana) to your mana pool.",
    onTurnStart(st) {
      st.manaPool.C += 2;
    }
  },
  {
    id: "chromatic_lantern",
    name: "Prismatic Beacon",
    cost: 10,
    rarity: "rare",
    desc: "Your Lands can tap for ANY color of mana, and you start each turn with +1 Any-Color Treasure Mana!",
    anyColorLands: true,
    onTurnStart(st) {
      st.manaPool.ANY += 1;
    }
  },
  {
    id: "fiery_emancipation",
    name: "Cinder Catalyst",
    cost: 8,
    rarity: "rare",
    desc: "Multiplies your total Combat Resonance by ×2 during every attack!",
    onModifyCombatMult(mult) {
      return mult * 2;
    }
  },
  {
    id: "aetherflux_reservoir",
    name: "Aether Siphon",
    cost: 5,
    rarity: "common",
    desc: "Whenever you cast an Instant or Sorcery, gain +3 Resonance and heal 2 Life.",
    onSpellCast() {
      addResonance(3, "Aether Siphon");
      gainLife(2, "Aether Siphon");
      spawnFx("Aether Siphon: +3 Mult & +2 Life!", "#59a2ff");
    }
  },
  {
    id: "crucible_of_worlds",
    name: "Worldshard Crucible",
    cost: 10,
    rarity: "uncommon",
    desc: "Graveyard Engine: Whenever a Land, Creature, or Spell enters your Graveyard, gain +1 Resonance and +1 Treasure Mana (up to 2×/turn)!",
    onGraveyardEnter(st) {
      st.turnStats.graveTriggers = (st.turnStats.graveTriggers || 0) + 1;
      if (st.turnStats.graveTriggers <= 2) {
        addResonance(1, "Worldshard Crucible");
        st.manaPool.ANY += 1;
        spawnFx("Worldshard Crucible: +1 Mult & +1 Treasure!", "#9b59b6");
      }
    }
  },
  {
    id: "nyxbloom_ancient",
    name: "Leyline Overmind",
    cost: 6,
    rarity: "common",
    desc: "Mana Surge: Each untapped Land and unspent Mana in your pool grants +1 Resonance (up to +5) and +2 Power during Combat!",
    manaSurge: true
  },
  {
    id: "heliod_sun_crowned",
    name: "Crown of the Solstice",
    cost: 5,
    rarity: "common",
    desc: "Radiant Devotion: Whenever you gain Life, put +1/+1 on ALL Creatures you control and gain +2 Resonance!",
    onLifeGain(st) {
      const buff = 1 * getTokenMultiplier();
      st.playerCreatures.forEach(c => {
        c.power += buff;
        c.toughness += buff;
      });
      addResonance(2, "Crown of the Solstice");
      spawnFx(`Solstice Crown: Board +${buff}/+${buff} & +2 Mult!`, "#ffe299");
    }
  },
  {
    id: "shark_typhoon",
    name: "Tempest Leviathan",
    cost: 7,
    rarity: "uncommon",
    desc: "Tempo Skies: Whenever you cast your 2nd+ Instant or Sorcery each turn, create a 2/2 Blue Sky Serpent token with Flying & Haste!",
    onSpellCast(st) {
      if (st.turnStats.spells >= 2) {
        spawnTokens("Sky Serpent Token", 2, 2, "U", ["Flying", "Haste"], 1);
      }
    }
  },
  {
    id: "goblin_warren",
    name: "Ember Warrens",
    cost: 6,
    rarity: "common",
    desc: "At the start of Turn 1, spawn two 1/1 Haste Goblins. Goblin Horde synergy bonuses are DOUBLED.",
    boosts: { goblin: 2 },
    onTurnStart(st, { isFirstTurn }) {
      if (isFirstTurn) spawnTokens("Goblin Token", 1, 1, "R", ["Haste"], 2);
    }
  },
  {
    id: "ral_storm_conduit",
    name: "Stormcaller's Coil",
    cost: 5,
    rarity: "common",
    desc: "Whenever you cast an Instant or Sorcery, deal +3 Burn Power. Spellstorm synergy bonuses are DOUBLED.",
    boosts: { storm: 2 },
    onSpellCast() {
      addBurnPower(3, "Stormcaller's Coil");
      addResonance(1, "Stormcaller's Coil");
    }
  },
  {
    id: "omnath_locus",
    name: "Heart of the Tectonic",
    cost: 6,
    rarity: "uncommon",
    desc: "Start each turn with +2 Resonance per 2 Lands you control. Landfall Surge synergy bonuses are DOUBLED.",
    boosts: { landfall: 2 },
    onTurnStart(st) {
      const bonus = Math.floor(st.playerLands.length / 2);
      if (bonus > 0) addResonance(2 * bonus, "Heart of the Tectonic");
    }
  },
  {
    id: "hive_mind",
    name: "Swarm Nexus",
    cost: 4,
    rarity: "common",
    desc: "Start each turn with +2 Resonance if you control 2+ Creatures. Swarm and Titanfall synergy bonuses are boosted ×1.5.",
    boosts: { swarm: 1.5, titans: 1.5 },
    onTurnStart(st) {
      if (st.playerCreatures.length >= 2) addResonance(2, "Swarm Nexus");
    }
  },
  {
    id: "prismatic_omen",
    name: "Chromatic Alignment",
    cost: 6,
    rarity: "uncommon",
    desc: "Start each turn with +1 Resonance (+1 extra Color toward Prismatic Court). Prismatic Court & Graveborn bonuses are DOUBLED.",
    boosts: { rainbow: 2, grave: 2 },
    rainbowBonus: 1,
    onTurnStart() {
      addResonance(1, "Chromatic Alignment");
    }
  },
  {
    id: "exploration",
    name: "Leyline Compass",
    cost: 9,
    rarity: "uncommon",
    desc: "You may play an additional Land during each of your turns (+1 Land Drop/turn).",
    onTurnStart(st) {
      st.maxLandsPerTurn += 1;
    }
  },

  // === BOSS RELICS (PLANE 1 OVERLORD REWARDS — BIG UPSIDE + TRADEOFF) ===
  {
    id: "boss_tectonic_crown",
    name: "Crown of Shattered Leylines",
    cost: 12,
    rarity: "boss",
    bossOnly: true,
    desc: "BOSS RELIC — Play +1 additional Land each turn and start every turn with +2 Resonance. Tradeoff: Start each encounter losing 4 Life (min 1).",
    onTurnStart(st, { isFirstTurn }) {
      st.maxLandsPerTurn += 1;
      addResonance(2, "Crown of Shattered Leylines");
      if (isFirstTurn && st.playerLife > 1) {
        st.playerLife = Math.max(1, st.playerLife - 4);
        spawnFx("Shattered Leylines: -4 Life, +1 Land Drop & +2 Mult!", "#ff9f43");
      }
    }
  },
  {
    id: "boss_aether_forge",
    name: "Aetherforge Dynamo",
    cost: 12,
    rarity: "boss",
    bossOnly: true,
    turnClockPenalty: 1,
    desc: "BOSS RELIC — Start every turn with +{C}{C} and +1 Wild Mana, and draw 1 extra card on Turn 1. Tradeoff: Turn Clock reduced by 1 (min 3).",
    onTurnStart(st, { isFirstTurn }) {
      st.manaPool.C += 2;
      st.manaPool.ANY += 1;
      if (isFirstTurn && typeof drawCards === "function") {
        drawCards(1);
        spawnFx("Aetherforge Dynamo: +{C}{C}★ & +1 Card!", "#ffd466");
      }
    }
  },
  {
    id: "boss_blood_chalice",
    name: "Chalice of the Crimson Pact",
    cost: 12,
    rarity: "boss",
    bossOnly: true,
    desc: "BOSS RELIC — Multiply total Combat Resonance by ×2 and gain +4 Burn Power each turn. Tradeoff: Lose 2 Life at the start of each turn (min 1).",
    onModifyCombatMult(mult) {
      return mult * 2;
    },
    onTurnStart(st) {
      addBurnPower(4, "Chalice of the Crimson Pact");
      if (st.playerLife > 1) {
        st.playerLife = Math.max(1, st.playerLife - 2);
      }
      spawnFx("Crimson Pact: ×2 Mult & +4 Burn (-2 Life)!", "#ff4757");
    }
  },
  {
    id: "boss_prismatic_nexus",
    name: "Nexus of Five Suns",
    cost: 12,
    rarity: "boss",
    bossOnly: true,
    anyColorLands: true,
    extraTriggers: 1,
    rerollCostPenalty: 2,
    desc: "BOSS RELIC — Lands tap for ANY color, ETB/Landfall triggers fire +1 extra time, and +2 Resonance/turn. Tradeoff: Shop rerolls cost +$2.",
    onTurnStart() {
      addResonance(2, "Nexus of Five Suns");
    }
  },
  {
    id: "boss_void_engine",
    name: "Oblivion Accelerator",
    cost: 12,
    rarity: "boss",
    bossOnly: true,
    desc: "BOSS RELIC — Whenever you cast an Instant or Sorcery, draw 1 card (up to 2×/turn) and gain +2 Resonance. Tradeoff: Mill 4 cards at encounter start.",
    onTurnStart(st, { isFirstTurn }) {
      if (isFirstTurn && typeof millCards === "function") {
        const milled = millCards(4);
        if (milled > 0) spawnFx(`Oblivion Accelerator: Milled ${milled}!`, "#9b59b6");
      }
    },
    onSpellCast(st) {
      st.turnStats.voidDraws = (st.turnStats.voidDraws || 0) + 1;
      if (st.turnStats.voidDraws <= 2 && typeof drawCards === "function") {
        drawCards(1);
      }
      addResonance(2, "Oblivion Accelerator");
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

function getRelicRarityInfo(relicOrId) {
  const def = typeof relicOrId === "string"
    ? RELIC_DB.find(r => r.id === relicOrId)
    : (relicOrId && relicOrId.rarity ? relicOrId : RELIC_DB.find(r => r.id === relicOrId?.id));
  const key = (def && def.rarity && RELIC_RARITIES[def.rarity]) ? def.rarity : "common";
  return RELIC_RARITIES[key];
}

function getShopRelicPool() {
  return RELIC_DB.filter(r => !r.bossOnly && !hasRelic(r.id));
}

function getBossRelicPool() {
  return RELIC_DB.filter(r => r.bossOnly && !hasRelic(r.id));
}

function getRelicMaxSlots() {
  const hasBossRelic = state.relics.some(r => {
    const def = RELIC_DB.find(d => d.id === r.id);
    return Boolean(def && def.bossOnly);
  });
  return hasBossRelic ? 6 : 5;
}

function getRelicTurnClockPenalty() {
  return getRelicDefs().reduce((sum, def) => sum + (def.turnClockPenalty || 0), 0);
}

function getRelicShopRerollPenalty() {
  return getRelicDefs().reduce((sum, def) => sum + (def.rerollCostPenalty || 0), 0);
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
      s.playerLands.forEach(l => {
        if (l.landEnhancement === "prismatic") {
          COLORS.forEach(x => cols.add(x));
        } else {
          (l.produces || []).forEach(x => { if ("GRBUW".includes(x)) cols.add(x); });
        }
      });
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
