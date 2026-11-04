// MANASTORM — Core Game State, Turn Loop, Card Effects, Shop & LocalStorage Persistence

const SAVE_KEY = "manastorm_saved_run_v1";

const state = {
  headless: false,
  runOver: false,
  combatLocked: false,

  deckArchetype: STARTER_DECKS[0],
  masterDeck: [],
  library: [],
  hand: [],
  graveyard: [],
  playerLands: [],
  playerCreatures: [],
  enemyCreatures: [],
  relics: [],
  consumables: [],

  encounterIdx: 0,
  enemyLife: 30,
  enemyMaxLife: 30,
  playerLife: START_LIFE,
  gold: 6,

  turn: 1,
  maxTurns: 5,
  landsPlayedThisTurn: 0,
  maxLandsPerTurn: 1,
  mulligansLeft: 1,
  canMulligan: true,

  manaPool: { G: 0, R: 0, B: 0, U: 0, W: 0, C: 0, ANY: 0 },

  turnBurnPower: 0,
  turnResonance: 1,
  resonanceSources: [{ label: "Base Resonance", amount: 1, type: "add" }],
  burnSources: [],

  shopStock: { relics: [], cards: [], upgrades: [] },
  turnStats: { spells: 0, landfalls: 0, graveTriggers: 0 },
  synTiers: {}
};

let uidCounter = 1;
function nextUid() {
  return `uid_${uidCounter++}`;
}

function addResonance(amount, label = "Trigger") {
  if (!amount) return;
  state.turnResonance += amount;
  if (!state.resonanceSources) {
    state.resonanceSources = [{ label: "Base Resonance", amount: 1, type: "add" }];
  }
  const existing = state.resonanceSources.find(s => s.label === label && s.type === "add");
  if (existing) {
    existing.amount += amount;
  } else {
    state.resonanceSources.push({ label, amount, type: "add" });
  }
  if (typeof notifyResonanceTrigger === "function") {
    notifyResonanceTrigger(amount, label, "add");
  }
}

function multiplyTurnResonance(factor, label = "Foil") {
  const before = state.turnResonance;
  state.turnResonance = Math.round(state.turnResonance * factor);
  const delta = state.turnResonance - before;
  if (!state.resonanceSources) {
    state.resonanceSources = [{ label: "Base Resonance", amount: 1, type: "add" }];
  }
  state.resonanceSources.push({ label: `${label} (+${delta})`, amount: factor, type: "mult" });
  if (typeof notifyResonanceTrigger === "function") {
    notifyResonanceTrigger(factor, label, "mult");
  }
}

function addBurnPower(amount, label = "Burn") {
  if (!amount) return;
  state.turnBurnPower += amount;
  if (!state.burnSources) state.burnSources = [];
  state.burnSources.push({ label, amount });
  if (typeof notifyBurnTrigger === "function") {
    notifyBurnTrigger(amount, label);
  }
}

function gainLife(amount, sourceLabel = "Heal") {
  if (amount <= 0) return 0;
  const before = state.playerLife;
  state.playerLife = Math.min(MAX_LIFE, state.playerLife + amount);
  const actual = state.playerLife - before;
  if (actual > 0 && typeof notifyLifeChange === "function") {
    notifyLifeChange(actual, sourceLabel);
  }

  state.playerCreatures.forEach(c => {
    if (c.onLifegain === "pridemate") {
      const stack = c.count || 1;
      const buff = 2 * getTokenMultiplier();
      c.power += buff;
      c.toughness += buff;
      addResonance(1 * stack, `${c.name} (Lifegain)`);
      spawnFx(`${c.name}: +${buff}/+${buff} & +${stack} Mult!`, "#ffe299");
    }
  });

  dispatchRelicEvent("onLifeGain", { amount, actual, sourceLabel });
  return actual;
}

function pushToGraveyard(card) {
  state.graveyard.push(card);
  dispatchRelicEvent("onGraveyardEnter", { card });
}

function cloneCard(cardId) {
  const base = CARD_DB[cardId];
  return {
    ...base,
    uid: nextUid(),
    keywords: [...(base.keywords || [])],
    produces: [...(base.produces || [])],
    foil: null,
    permPowerBonus: 0,
    permToughnessBonus: 0
  };
}

function creatureToCard(creature) {
  const base = CARD_DB[creature.id] || creature;
  return {
    ...base,
    uid: creature.uid || nextUid(),
    id: creature.id,
    name: creature.name,
    type: "Creature",
    subtype: creature.subtype || base.subtype || "Creature",
    color: creature.color,
    manaCost: base.manaCost || "",
    power: base.power !== undefined ? base.power : creature.power,
    toughness: base.toughness !== undefined ? base.toughness : creature.toughness,
    keywords: [...(base.keywords || creature.keywords || [])],
    produces: [],
    foil: creature.foil || null,
    permPowerBonus: creature.permPowerBonus || 0,
    permToughnessBonus: creature.permToughnessBonus || 0
  };
}

function shuffle(arr) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

// === INITIALIZATION & RUN START ===
function startNewRun(deckConfig = STARTER_DECKS[0]) {
  state.runOver = false;
  state.combatLocked = false;
  state.deckArchetype = deckConfig;
  state.masterDeck = deckConfig.cards.map(id => cloneCard(id));
  state.relics = [];
  const startRelic = RELIC_DB.find(r => r.id === deckConfig.startingRelic);
  if (startRelic) state.relics.push({ ...startRelic });
  state.consumables = [{ ...CONSUMABLE_DB[0], uid: nextUid() }];

  state.encounterIdx = 0;
  state.playerLife = START_LIFE;
  state.gold = 6;
  state.synTiers = {};

  beginEncounter();
  saveRunState(false);
}

function getCurrentEncounter() {
  return ENCOUNTERS[state.encounterIdx % ENCOUNTERS.length];
}

function beginEncounter() {
  state.runOver = false;
  state.combatLocked = false;
  const enc = getCurrentEncounter();
  const loopScale = Math.pow(2.5, Math.floor(state.encounterIdx / ENCOUNTERS.length));
  state.enemyMaxLife = Math.round(enc.maxLife * loopScale);
  state.enemyLife = state.enemyMaxLife;

  state.library = shuffle(state.masterDeck.map(c => ({ ...c, keywords: [...c.keywords], produces: [...c.produces] })));
  state.hand = [];
  state.graveyard = [];
  state.playerLands = [];
  state.playerCreatures = [];
  state.enemyCreatures = [];

  state.turn = 1;
  state.maxTurns = 5;
  state.mulligansLeft = 1;
  state.canMulligan = true;

  spawnEnemyWave(enc);
  drawOpeningHand(7);
  startPlayerTurn(true);
}

function drawOpeningHand(handSize = 7) {
  state.hand = [];
  drawCards(handSize);
  const landCount = state.hand.filter(c => c.type === "Land").length;
  if (landCount < 2 && state.library.some(c => c.type === "Land")) {
    const landIdx = state.library.findIndex(c => c.type === "Land");
    const spellIdx = state.hand.findIndex(c => c.type !== "Land");
    if (landIdx !== -1 && spellIdx !== -1) {
      const [land] = state.library.splice(landIdx, 1);
      const [spell] = state.hand.splice(spellIdx, 1, land);
      state.library.push(spell);
      shuffle(state.library);
    }
  }
}

function drawCards(count) {
  for (let i = 0; i < count; i++) {
    if (state.library.length === 0) break;
    state.hand.push(state.library.pop());
  }
}

function startPlayerTurn(isFirstTurn = false, prefixLog = "") {
  state.landsPlayedThisTurn = 0;
  state.maxLandsPerTurn = 1;
  state.turnBurnPower = 0;
  state.turnResonance = 1;
  state.resonanceSources = [{ label: "Base Resonance", amount: 1, type: "add" }];
  state.burnSources = [];
  state.turnStats = { spells: 0, landfalls: 0, graveTriggers: 0 };
  if (!isFirstTurn) {
    state.canMulligan = false;
  }

  state.manaPool = { G: 0, R: 0, B: 0, U: 0, W: 0, C: 0, ANY: 0 };
  state.playerLands.forEach(l => { l.tapped = false; });

  state.playerCreatures.forEach(c => {
    c.summoningSick = false;
    c.tempPower = 0;
    c.tempToughness = 0;
    c.tempKeywords = [];
    c.attacking = true;
  });

  state.playerCreatures.forEach(c => {
    const stackCount = c.count || 1;
    if (c.etb === "mana_dork") {
      state.manaPool.G += 1 * stackCount;
    }
    if (c.upkeep === "sentinel") {
      drawCards(1 * stackCount);
      addResonance(1 * stackCount, "Esper Sentinel");
      spawnFx(`Esper Sentinel: +${stackCount} Card & +${stackCount} Mult!`, "#ffe299");
    }
  });
  dispatchRelicEvent("onTurnStart", { isFirstTurn });

  if (!isFirstTurn) {
    drawCards(1);
    setLog(`${prefixLog}Turn ${state.turn}: Untapped ${state.playerLands.length} Lands and drew a card.`);
  } else {
    setLog(`Encounter started vs ${getCurrentEncounter().name}! Play Lands to match colored Mana Pips.`);
  }

  renderAll();
}

// === PLAYING CARDS FROM HAND ===
function playCardFromHand(cardUid) {
  if (state.runOver || state.combatLocked) return;
  const idx = state.hand.findIndex(c => c.uid === cardUid);
  if (idx === -1) return;
  const card = state.hand[idx];

  if (!canPlayCard(card)) {
    if (card.type === "Land") {
      spawnFx(`Land Limit (${state.maxLandsPerTurn}/turn)!`, "#ff6b6b");
    } else {
      spawnFx(`Missing Mana Pips for ${card.manaCost}!`, "#ff6b6b");
    }
    return;
  }

  state.canMulligan = false;
  state.hand.splice(idx, 1);

  if (card.foil === "Etched") {
    addResonance(2, `Etched Foil (${card.name})`);
    spawnFx("Etched Foil: +2 Mult!", "#ff79c6");
  } else if (card.foil === "Halo") {
    multiplyTurnResonance(1.5, `Halo Foil (${card.name})`);
    spawnFx("Halo Foil: ×1.5 Mult!", "#ffd466");
  }

  if (card.type === "Land") {
    state.landsPlayedThisTurn++;
    handleLandPlay(card);
  } else {
    payManaForCard(card);
    if (card.type === "Creature") {
      handleCreatureCast(card);
    } else {
      handleSpellCast(card);
    }
  }

  renderAll();
}

function handleLandPlay(landCard) {
  const triggers = getTriggerMultiplier();

  if (landCard.isFetch) {
    pushToGraveyard(landCard);
    promptFetchBasicLand(2 * triggers, "Evolving Wilds (Double Landfall!)", triggers);
  } else {
    landCard.tapped = false;
    state.playerLands.push(landCard);
    spawnFx(`Played ${landCard.name}`, "#4bf099");
    for (let i = 0; i < triggers; i++) {
      triggerLandfall();
    }
  }
}

function promptFetchBasicLand(landfallTriggersCount, sourceLabel, selfLandfallTriggers = 0) {
  const basicLandsInLib = state.library.filter(c => c.type === "Land" && !c.isFetch && c.produces.length === 1);
  const availableColors = [...new Set(basicLandsInLib.map(l => l.produces[0]))];

  if (availableColors.length === 0) {
    spawnFx("No Basic Lands left in Library!", "#ff6b6b");
    setLog(`${sourceLabel}: No Basic Lands remaining in Library to fetch.`);
    for (let i = 0; i < selfLandfallTriggers; i++) {
      triggerLandfall();
    }
    renderAll();
    return;
  }

  const finishFetch = (chosenColor) => {
    const libIdx = state.library.findIndex(
      c => c.type === "Land" && !c.isFetch && c.produces.length === 1 && c.produces[0] === chosenColor
    );
    if (libIdx === -1) return;
    const [fetchedCard] = state.library.splice(libIdx, 1);
    fetchedCard.tapped = false;
    state.playerLands.push(fetchedCard);
    spawnFx(`Fetched ${fetchedCard.name} ({${chosenColor}})`, "#ffd466");
    setLog(`${sourceLabel}: Pulled ${fetchedCard.name} from Library and triggered Landfall ×${landfallTriggersCount}!`);
    for (let i = 0; i < landfallTriggersCount; i++) {
      triggerLandfall();
    }
    renderAll();
  };

  if (availableColors.length === 1) {
    finishFetch(availableColors[0]);
  } else {
    openColorPickerModal(
      sourceLabel,
      "Choose which Basic Land to search from your Library (thins your deck!):",
      availableColors.map(col => {
        const countInLib = basicLandsInLib.filter(l => l.produces[0] === col).length;
        return {
          label: `Fetch ${COLOR_NAMES[col]} Land (${countInLib} in Library)`,
          colorCode: col,
          onSelect: () => finishFetch(col)
        };
      }),
      false
    );
  }
}

// === DATA-DRIVEN LANDFALL, ETB & SPELL EFFECTS ===
const LANDFALL_EFFECTS = {
  cobra(c, stackCount) {
    state.manaPool.ANY += 1 * stackCount;
    addResonance(1 * stackCount, "Lotus Cobra (Landfall)");
    spawnFx(`Cobra Landfall: +${stackCount} Any-Color Mana & Mult!`, "#2ecc71");
  },
  scute(c) {
    const tokenMult = getTokenMultiplier();
    if (state.playerLands.length >= 4) {
      c.count = (c.count || 1) + (1 * tokenMult);
      spawnFx(`Scute Swarm Cloned (×${c.count})!`, "#2ecc71");
      triggerOnCreatureEnter(1 * tokenMult);
    } else {
      spawnTokens("Insect Token", 1, 1, "G", ["Haste"], 1);
    }
  },
  baloth(c, stackCount) {
    spawnTokens("Beast Token", 4, 4, "G", ["Trample"], 1 * stackCount);
  }
};

function triggerLandfall() {
  state.turnStats.landfalls++;
  const snapshot = [...state.playerCreatures];
  snapshot.forEach(c => {
    const handler = c.landfall && LANDFALL_EFFECTS[c.landfall];
    if (handler) {
      handler(c, c.count || 1);
    }
  });
}

function handleCreatureCast(card) {
  const hasHaste = card.keywords.includes("Haste");
  const creatureObj = {
    uid: card.uid,
    id: card.id,
    name: card.name,
    color: card.color,
    subtype: card.subtype || "Creature",
    power: card.power + (card.permPowerBonus || 0),
    toughness: card.toughness + (card.permToughnessBonus || 0),
    permPowerBonus: card.permPowerBonus || 0,
    permToughnessBonus: card.permToughnessBonus || 0,
    tempPower: 0,
    tempToughness: 0,
    keywords: [...card.keywords],
    tempKeywords: [],
    etb: card.etb || null,
    landfall: card.landfall || null,
    upkeep: card.upkeep || null,
    onLifegain: card.onLifegain || null,
    connive: Boolean(card.connive),
    rules: card.rules,
    summoningSick: !hasHaste,
    attacking: hasHaste,
    count: 1,
    foil: card.foil
  };

  addCreatureToBoard(creatureObj);

  const triggers = getTriggerMultiplier();
  for (let i = 0; i < triggers; i++) {
    triggerCreatureETB(creatureObj);
  }
}

function addCreatureToBoard(creatureObj) {
  state.playerCreatures.push(creatureObj);
  triggerOnCreatureEnter(1);
}

function canMergeTokenStack(existing, name, power, toughness, hasHaste, keywords) {
  if (!existing.isToken || existing.name !== name) return false;
  if (existing.summoningSick !== !hasHaste) return false;
  if (existing.power !== power || existing.toughness !== toughness) return false;
  if ((existing.tempPower || 0) !== 0 || (existing.tempToughness || 0) !== 0) return false;
  if (existing.tempKeywords && existing.tempKeywords.length > 0) return false;
  if (existing.keywords.length !== keywords.length) return false;
  return keywords.every(k => existing.keywords.includes(k));
}

function spawnTokens(name, power, toughness, color, keywords, baseCount) {
  const finalCount = baseCount * getTokenMultiplier();
  const hasHaste = keywords.includes("Haste");

  const existing = state.playerCreatures.find(
    c => canMergeTokenStack(c, name, power, toughness, hasHaste, keywords)
  );
  if (existing) {
    existing.count += finalCount;
    existing.rules = `Token Stack (${existing.count}x).`;
  } else {
    state.playerCreatures.push({
      uid: nextUid(),
      name,
      color,
      subtype: name.includes("Goblin") ? "Goblin" : "Token",
      power,
      toughness,
      tempPower: 0,
      tempToughness: 0,
      keywords: [...keywords],
      tempKeywords: [],
      rules: `Token Stack (${finalCount}x).`,
      summoningSick: !hasHaste,
      attacking: hasHaste,
      isToken: true,
      count: finalCount
    });
  }

  spawnFx(`+${finalCount} ${name}!`, "#ffd466");
  triggerOnCreatureEnter(finalCount);
}

function triggerOnCreatureEnter(enteredCount) {
  dispatchRelicEvent("onCreatureEnter", {
    count: enteredCount,
    tokenMult: getTokenMultiplier()
  });
}

const ETB_EFFECTS = {
  rabble() {
    spawnTokens("Goblin Token", 1, 1, "R", ["Haste"], 1);
    const buff = 1 * getTokenMultiplier();
    state.playerCreatures.forEach(c => {
      if (c.subtype === "Goblin") {
        c.power += buff;
        c.toughness += buff;
      }
    });
  },
  terror() {
    addBurnPower(5, "Terror of the Peaks");
    addResonance(2, "Terror of the Peaks");
    spawnFx("Terror of the Peaks: +5 Power, +2 Mult!", "#ff4757");
  },
  archon() {
    if (state.enemyCreatures.length > 0) {
      const strongestIdx = state.enemyCreatures.reduce(
        (bestIdx, creature, idx) => creature.power > state.enemyCreatures[bestIdx].power ? idx : bestIdx,
        0
      );
      const [removed] = state.enemyCreatures.splice(strongestIdx, 1);
      spawnFx(`Archon Exiled ${removed.name}!`, "#9b59b6");
    }
    drawCards(1);
    addResonance(2, "Archon of Cruelty");
  },
  djinn(creature) {
    if (state.enemyCreatures.length > 0) {
      const sorted = [...state.enemyCreatures].sort((a, b) => b.power - a.power);
      const target = sorted[0];
      state.enemyCreatures = state.enemyCreatures.filter(b => b.uid !== target.uid);
      spawnFx(`Tempest Djinn Bounced ${target.name}!`, "#3498db");
    }
    const blueLands = state.playerLands.filter(l => l.produces.includes("U") || l.produces.length > 1).length;
    if (creature && blueLands > 0) {
      creature.tempPower = (creature.tempPower || 0) + blueLands;
    }
    addResonance(2, "Tempest Djinn");
  },
  serra() {
    gainLife(4, "Serra Angel");
    addResonance(2, "Serra Angel");
    spawnFx("Serra Angel: +4 Life & +2 Mult!", "#ffe299");
  },
  sun_titan(creature) {
    addResonance(2, "Sun Titan");
    const gyTargets = state.graveyard.filter(c => c.type === "Creature" || c.type === "Land");
    if (gyTargets.length === 0) {
      spawnFx("Sun Titan: +2 Mult!", "#ffe299");
      return;
    }
    gyTargets.sort((a, b) => {
      const aPow = a.type === "Creature" ? (a.power || 0) + (a.permPowerBonus || 0) : 1;
      const bPow = b.type === "Creature" ? (b.power || 0) + (b.permPowerBonus || 0) : 1;
      return bPow - aPow;
    });

    const resolveReturn = (target) => {
      state.graveyard = state.graveyard.filter(c => c.uid !== target.uid);
      if (target.type === "Land") {
        handleLandPlay(target);
        spawnFx(`Sun Titan returned ${target.name}!`, "#ffe299");
      } else {
        if (!target.keywords.includes("Haste")) target.keywords.push("Haste");
        handleCreatureCast(target);
        spawnFx(`Sun Titan returned ${target.name} with Haste!`, "#ffe299");
      }
      creature.sunTitanResolving = false;
      if (creature.pendingSunTitanTriggers > 0) {
        creature.pendingSunTitanTriggers--;
        triggerCreatureETB(creature);
      }
    };

    if (creature.sunTitanResolving) {
      creature.pendingSunTitanTriggers = (creature.pendingSunTitanTriggers || 0) + 1;
      return;
    }

    creature.sunTitanResolving = true;
    openTargetPickerModal(
      "Sun Titan — Return From Graveyard",
      "Choose a Creature or Land from your Graveyard to return to the battlefield:",
      gyTargets,
      (c, i) => `
        <button type="button" class="hand-card card-color-${c.color} playable" data-target-idx="${i}">
          <div class="card-top-bar">
            <span class="card-title">${c.name}</span>
            ${renderManaCostHtml(c)}
          </div>
          <div class="card-type-line">${c.type}</div>
          <div class="card-rules">${c.rules}</div>
          <div class="card-bottom-bar">
            <span class="status-pill status-ready">${i === 0 ? "★ Recommended" : "Return"}</span>
            ${c.type === "Creature" ? `<span class="pt-box">${(c.power || 0) + (c.permPowerBonus || 0)}/${(c.toughness || 0) + (c.permToughnessBonus || 0)}</span>` : ""}
          </div>
        </button>
      `,
      resolveReturn
    );
  }
};

function triggerCreatureETB(creature) {
  const handler = creature.etb && ETB_EFFECTS[creature.etb];
  if (handler) {
    handler(creature);
  }
}

const SPELL_EFFECTS = {
  cultivate() {
    promptFetchBasicLand(getTriggerMultiplier(), "Cultivate Ramp", 0);
  },
  overrun() {
    const buff = 3 * getTokenMultiplier();
    state.playerCreatures.forEach(c => {
      c.tempPower += buff;
      c.tempToughness += buff;
      addTempKeyword(c, "Trample");
    });
    addResonance(2, "Overrun");
    spawnFx(`OVERRUN! All Creatures +${buff}/+${buff} & Trample!`, "#2ecc71");
  },
  bolt() {
    addResonance(1, "Lightning Bolt");
    if (state.enemyCreatures.length > 0) {
      const sortedBlockers = [...state.enemyCreatures].sort((a, b) => b.power - a.power);
      openTargetPickerModal(
        "Lightning Bolt — Choose Target Blocker",
        "Select an Enemy Blocker to destroy (or press Enter for strongest):",
        sortedBlockers,
        (ec, i) => `
          <button type="button" class="board-card card-color-${ec.color}" data-target-idx="${i}">
            <div class="card-top-bar"><span class="card-title">${ec.name}</span></div>
            <div class="card-keywords">${ec.keywords.map(k => `<span class="kw-tag">${k}</span>`).join("")}</div>
            <div class="card-rules">Destroy this ${ec.power}/${ec.toughness} Blocker.</div>
            <div class="card-bottom-bar">
              <span class="status-pill status-attack">${i === 0 ? "★ Recommended" : "Target"}</span>
              <span class="pt-box">${ec.power}/${ec.toughness}</span>
            </div>
          </button>
        `,
        (chosen) => {
          state.enemyCreatures = state.enemyCreatures.filter(b => b.uid !== chosen.uid);
          spawnFx(`Bolted Blocker: ${chosen.name}!`, "#ff4757");
        }
      );
    } else {
      addBurnPower(4, "Lightning Bolt");
      spawnFx("Lightning Bolt: +4 Burn to Boss!", "#ff4757");
    }
  },
  unsummon() {
    drawCards(1);
    addResonance(1, "Vapor Snag");
    if (state.enemyCreatures.length > 0) {
      const sortedBlockers = [...state.enemyCreatures].sort((a, b) => b.power - a.power);
      openTargetPickerModal(
        "Vapor Snag — Bounce Enemy Blocker",
        "Choose an Enemy Blocker to bounce from the battlefield (+1 Card & +1 Resonance):",
        sortedBlockers,
        (ec, i) => `
          <button type="button" class="board-card card-color-${ec.color}" data-target-idx="${i}">
            <div class="card-top-bar"><span class="card-title">${ec.name}</span></div>
            <div class="card-keywords">${ec.keywords.map(k => `<span class="kw-tag">${k}</span>`).join("")}</div>
            <div class="card-rules">Bounce this ${ec.power}/${ec.toughness} Blocker.</div>
            <div class="card-bottom-bar">
              <span class="status-pill status-ready">${i === 0 ? "★ Recommended" : "Bounce"}</span>
              <span class="pt-box">${ec.power}/${ec.toughness}</span>
            </div>
          </button>
        `,
        (chosen) => {
          state.enemyCreatures = state.enemyCreatures.filter(b => b.uid !== chosen.uid);
          spawnFx(`Bounced ${chosen.name} & Drew 1!`, "#3498db");
        }
      );
    } else {
      spawnFx("Vapor Snag: Drew 1 Card & +1 Mult!", "#3498db");
    }
  },
  frost_breath() {
    drawCards(1);
    addResonance(2, "Cryptic Freeze");
    const unfrozen = state.enemyCreatures
      .filter(b => !b.frozen)
      .sort((a, b) => b.power - a.power)
      .slice(0, 2);
    unfrozen.forEach(b => { b.frozen = true; });
    spawnFx(`❄️ Froze ${unfrozen.length} Blocker(s) & Drew 1!`, "#3498db");
  },
  plowshares() {
    gainLife(3, "Swords to Plowshares");
    addResonance(1, "Swords to Plowshares");
    if (state.enemyCreatures.length > 0) {
      const sortedBlockers = [...state.enemyCreatures].sort((a, b) => b.power - a.power);
      openTargetPickerModal(
        "Swords to Plowshares — Exile Blocker",
        "Select an Enemy Blocker to exile (+3 Life & +1 Resonance granted):",
        sortedBlockers,
        (ec, i) => `
          <button type="button" class="board-card card-color-${ec.color}" data-target-idx="${i}">
            <div class="card-top-bar"><span class="card-title">${ec.name}</span></div>
            <div class="card-keywords">${ec.keywords.map(k => `<span class="kw-tag">${k}</span>`).join("")}</div>
            <div class="card-rules">Exile this ${ec.power}/${ec.toughness} Blocker.</div>
            <div class="card-bottom-bar">
              <span class="status-pill status-ready">${i === 0 ? "★ Recommended" : "Exile"}</span>
              <span class="pt-box">${ec.power}/${ec.toughness}</span>
            </div>
          </button>
        `,
        (chosen) => {
          state.enemyCreatures = state.enemyCreatures.filter(b => b.uid !== chosen.uid);
          spawnFx(`Exiled ${chosen.name} & +3 Life!`, "#ffe299");
        }
      );
    } else {
      spawnFx("Swords to Plowshares: +3 Life & +1 Mult!", "#ffe299");
    }
  },
  formation() {
    const buff = 2 * getTokenMultiplier();
    state.playerCreatures.forEach(c => {
      c.power += buff;
      c.toughness += buff;
    });
    gainLife(3, "Unbreakable Formation");
    addResonance(2, "Unbreakable Formation");
    spawnFx(`Unbreakable Formation: Board +${buff}/+${buff} & +3 Life!`, "#ffe299");
  },
  reinforcements() {
    spawnTokens("Soldier Token", 1, 1, "W", ["Haste"], 2);
    const buff = 2 * getTokenMultiplier();
    state.playerCreatures.forEach(c => {
      c.tempPower += buff;
      c.tempToughness += buff;
      addTempKeyword(c, "Haste");
      c.summoningSick = false;
      c.attacking = true;
    });
    addResonance(2, "Heroic Reinforcements");
    spawnFx(`Heroic Reinforcements! All Creatures +${buff}/+${buff} & Haste!`, "#ffe299");
  },
  goblins_2() {
    spawnTokens("Goblin Token", 1, 1, "R", ["Haste"], 2);
  },
  ritual() {
    state.manaPool.R += 4;
    addResonance(2, "Seething Song");
    spawnFx("Seething Song: +{R}{R}{R}{R} & +2 Mult!", "#ff4757");
  },
  dark_ritual() {
    state.manaPool.B += 3;
    addResonance(1, "Dark Ritual");
    spawnFx("Dark Ritual: +{B}{B}{B} & +1 Mult!", "#9b59b6");
  },
  battle_rage() {
    if (state.playerCreatures.length > 0) {
      const sorted = [...state.playerCreatures].sort(
        (a, b) => (b.power + (b.tempPower || 0)) - (a.power + (a.tempPower || 0))
      );
      openTargetPickerModal(
        "Temur Battle Rage — Choose Creature",
        "Select a Creature to gain Double Strike & Trample this turn:",
        sorted,
        (pc, i) => {
          const pow = pc.power + (pc.tempPower || 0);
          const tough = pc.toughness + (pc.tempToughness || 0);
          return `
            <button type="button" class="board-card card-color-${pc.color}" data-target-idx="${i}">
              <div class="card-top-bar">
                <span class="card-title">${pc.name}</span>
                ${pc.count > 1 ? `<span class="stack-count-badge">×${pc.count}</span>` : ""}
              </div>
              <div class="card-rules">Grant Double Strike & Trample this turn.</div>
              <div class="card-bottom-bar">
                <span class="status-pill status-attack">${i === 0 ? "★ Best" : "Buff"}</span>
                <span class="pt-box">${pow}/${tough}</span>
              </div>
            </button>
          `;
        },
        (chosen) => {
          addTempKeyword(chosen, "Double Strike");
          addTempKeyword(chosen, "Trample");
          spawnFx(`${chosen.name} gains DOUBLE STRIKE & TRAMPLE this turn!`, "#ffd466");
        }
      );
    }
  },
  village_rites() {
    if (state.playerCreatures.length > 0) {
      let weakestIdx = 0;
      for (let i = 1; i < state.playerCreatures.length; i++) {
        const cur = state.playerCreatures[i];
        const best = state.playerCreatures[weakestIdx];
        const curPow = cur.power + (cur.tempPower || 0);
        const bestPow = best.power + (best.tempPower || 0);
        const curTough = cur.toughness + (cur.tempToughness || 0);
        const bestTough = best.toughness + (best.tempToughness || 0);
        if (
          curPow < bestPow ||
          (curPow === bestPow && curTough < bestTough) ||
          (curPow === bestPow && curTough === bestTough && cur.isToken && !best.isToken)
        ) {
          weakestIdx = i;
        }
      }
      const weakest = state.playerCreatures[weakestIdx];
      if (weakest.count > 1) {
        weakest.count--;
        if (weakest.isToken) {
          weakest.rules = `Token Stack (${weakest.count}x).`;
        } else {
          pushToGraveyard(creatureToCard(weakest));
        }
      } else {
        const [sac] = state.playerCreatures.splice(weakestIdx, 1);
        if (!sac.isToken) {
          pushToGraveyard(creatureToCard(sac));
        }
      }
    }
    drawCards(2);
    addResonance(2, "Village Rites");
    spawnFx("Village Rites: Drew 2 Cards & +2 Mult!", "#9b59b6");
  },
  reanimate() {
    const gyCreatures = state.graveyard.filter(c => c.type === "Creature");
    if (gyCreatures.length > 0) {
      gyCreatures.sort(
        (a, b) => ((b.power || 0) + (b.permPowerBonus || 0)) - ((a.power || 0) + (a.permPowerBonus || 0))
      );
      openTargetPickerModal(
        "Reanimate — Choose Creature in Graveyard",
        "Select a Creature from your Graveyard to return to the battlefield with Haste:",
        gyCreatures,
        (c, i) => `
          <button type="button" class="hand-card card-color-${c.color} playable" data-target-idx="${i}">
            <div class="card-top-bar">
              <span class="card-title">${c.name}</span>
              ${renderManaCostHtml(c)}
            </div>
            <div class="card-type-line">${c.type} — ${c.subtype || "Creature"}</div>
            <div class="card-rules">${c.rules}</div>
            <div class="card-bottom-bar">
              <span class="status-pill status-attack">${i === 0 ? "★ Best" : "Reanimate"}</span>
              <span class="pt-box">${(c.power || 0) + (c.permPowerBonus || 0)}/${(c.toughness || 0) + (c.permToughnessBonus || 0)}</span>
            </div>
          </button>
        `,
        (target) => {
          state.graveyard = state.graveyard.filter(c => c.uid !== target.uid);
          if (!target.keywords.includes("Haste")) target.keywords.push("Haste");
          handleCreatureCast(target);
          spawnFx(`Reanimated ${target.name} with Haste!`, "#9b59b6");
        }
      );
    } else {
      spawnTokens("Hellion Fiend", 3, 3, "B", ["Haste"], 1);
    }
  },
  draw_2() {
    drawCards(2);
    state.manaPool.ANY += 1;
    addResonance(1, "Expressive Iteration");
    spawnFx("Drew 2 Cards, +1 Treasure & +1 Mult!", "#3498db");
  }
};

function handleSpellCast(card) {
  state.turnStats.spells++;
  const enc = getCurrentEncounter();
  if (enc.spellWardTax && state.turnStats.spells === 1 && state.playerLands.length < 4 && state.enemyCreatures.length < 5) {
    state.enemyCreatures.push({
      uid: nextUid(),
      name: "Sky Drake Whelp",
      power: 1,
      toughness: 1,
      color: "U",
      keywords: ["Flying"],
      frozen: false
    });
    spawnFx("Talrand Ward: 1/1 Drake Spawned!", "#3498db");
  }

  state.playerCreatures.forEach(c => {
    const stack = c.count || 1;
    if (getCreatureKeywords(c).includes("Prowess")) {
      const buff = 2 * getTokenMultiplier();
      c.tempPower += buff;
      c.tempToughness += buff;
      addResonance(1 * stack, `${c.name} (Prowess)`);
      spawnFx(`${c.name} Prowess: +${buff}/+${buff} & +${stack} Mult!`, "#ff6b6b");
    }
    if (c.connive && state.turnStats.spells >= 2) {
      const buff = 2 * getTokenMultiplier();
      c.power += buff;
      c.toughness += buff;
      drawCards(1 * stack);
      addResonance(1 * stack, `${c.name} (Connive)`);
      spawnFx(`${c.name} Connive: +${buff}/+${buff} & Drew ${stack}!`, "#3498db");
    }
  });

  dispatchRelicEvent("onSpellCast", { card });

  const effectFn = card.effect && SPELL_EFFECTS[card.effect];
  if (effectFn) {
    effectFn(card);
  }

  pushToGraveyard(card);
}

// === MULLIGAN ===
function useMulligan() {
  if (state.mulligansLeft <= 0 || !state.canMulligan || state.runOver || state.combatLocked) return;
  state.mulligansLeft--;
  state.canMulligan = false;
  const count = state.hand.length;
  state.library.push(...state.hand);
  state.hand = [];
  shuffle(state.library);
  drawOpeningHand(count);
  spawnFx("Mulligan! Redrew Opening Hand", "#59a2ff");
  renderAll();
}

// === VICTORY, DEFEAT & COLOR-WEIGHTED SHOP SYSTEM ===
function getDeckColors() {
  const cols = new Set(state.deckArchetype && state.deckArchetype.colors ? state.deckArchetype.colors : []);
  state.masterDeck.forEach(c => {
    if (c.type === "Land") {
      (c.produces || []).forEach(col => cols.add(col));
    } else if (COLORS.includes(c.color)) {
      cols.add(c.color);
    }
  });
  return cols;
}

function canSafelyThinBasics() {
  const basics = state.masterDeck.filter(c => c.type === "Land" && !c.isFetch && c.produces.length === 1);
  const fetchesAndRamp = state.masterDeck.filter(c => c.isFetch || c.id === "cultivate").length;
  const minRequired = Math.max(4, fetchesAndRamp + 2);
  if (basics.length < minRequired) {
    return {
      allowed: false,
      reason: `Guarded: ${basics.length} Basics left for ${fetchesAndRamp} Fetch/Ramp cards`
    };
  }
  return {
    allowed: true,
    reason: `${basics.length} Basics in deck (${fetchesAndRamp} Fetch/Ramp)`
  };
}

function handleEncounterVictory() {
  const enc = getCurrentEncounter();
  const unusedTurnsBonus = Math.max(0, state.maxTurns - state.turn);
  const interest = Math.min(3, Math.floor(state.gold / 5));
  const earned = enc.reward + unusedTurnsBonus + interest;
  state.gold += earned;

  // Between-encounter victory recovery (Step 1)
  const healed = gainLife(VICTORY_HEAL, "Victory Recovery");

  if (!isHeadlessEnv()) {
    document.getElementById("shop-plane-badge").textContent =
      `VICTORY • ${enc.name.toUpperCase()} DEFEATED!`;
    document.getElementById("shop-reward-summary").textContent =
      `Earned $${enc.reward} Ward Bounty + $${unusedTurnsBonus} Unused Turn Bonus + $${interest} Interest ($${earned} Total)${healed > 0 ? ` • Restored +${healed} Life` : ""}. Sculpt your deck before the next encounter!`;
  }

  generateShopStock(false);
  saveRunState(true);
  renderShop();
  renderAll();

  if (!isHeadlessEnv()) {
    // Show Victory Screen when completing Plane 2's Final Boss (Elesh Norn)
    if (state.encounterIdx === ENCOUNTERS.length - 1) {
      openVictoryModal(enc, earned, healed);
    } else {
      document.getElementById("shop-dialog").showModal();
    }
  }
}

function handleDefeat() {
  state.runOver = true;
  state.combatLocked = false;
  clearRunState();
  const enc = getCurrentEncounter();
  setLog(`Defeated by ${enc.name} on Turn ${state.turn}! Choose a deck to start a new run.`);
  spawnFx("WARD HELD — RUN ENDED", "#ff4757");
  renderAll();
  if (!isHeadlessEnv()) {
    setTimeout(() => {
      openNewRunModal(
        true,
        `Defeated by ${enc.name} — Start a New Run`,
        `Your Planeswalker spark faltered on Plane ${enc.plane} (${enc.name}, Turn ${state.turn}/${state.maxTurns}). Choose a 40-card deck to begin a fresh run:`
      );
    }, 650);
  }
}

function generateShopStock(preserveUpgrades = false) {
  const unownedRelics = RELIC_DB.filter(r => !hasRelic(r.id));
  shuffle(unownedRelics);
  state.shopStock.relics = unownedRelics.slice(0, 2).map(r => ({ ...r, bought: false }));

  // Color-weighted draft pool (Step 1: weight toward deck's colors, with occasional off-color splash)
  const deckColors = getDeckColors();
  const hasLantern = hasAnyColorLands();

  const allDraftIds = Object.keys(CARD_DB).filter(id => {
    const c = CARD_DB[id];
    return c.subtype !== "Basic";
  });

  const inColorPool = [];
  const splashPool = [];

  allDraftIds.forEach(id => {
    const c = CARD_DB[id];
    if (c.isFetch) {
      inColorPool.push({ id, weight: 4 });
    } else if (c.type === "Land" && c.produces.length > 1) {
      const matchCount = c.produces.filter(col => deckColors.has(col)).length;
      if (matchCount === 2) {
        inColorPool.push({ id, weight: 6 });
      } else if (matchCount === 1) {
        splashPool.push({ id, weight: 2 });
      }
    } else {
      const parsed = parseManaCost(c.manaCost);
      const cardCols = COLORS.filter(col => parsed.pips[col] > 0);
      const allMatch = cardCols.every(col => deckColors.has(col));
      const someMatch = cardCols.some(col => deckColors.has(col));
      if (allMatch) {
        inColorPool.push({ id, weight: 6 });
      } else if (someMatch || hasLantern) {
        splashPool.push({ id, weight: 2 });
      } else {
        splashPool.push({ id, weight: 1 });
      }
    }
  });

  const pickedIds = new Set();
  const pickWeighted = (pool) => {
    const avail = pool.filter(x => !pickedIds.has(x.id));
    if (avail.length === 0) return null;
    const totalW = avail.reduce((s, x) => s + x.weight, 0);
    let r = Math.random() * totalW;
    for (const item of avail) {
      r -= item.weight;
      if (r <= 0) {
        pickedIds.add(item.id);
        return item.id;
      }
    }
    const last = avail[avail.length - 1];
    pickedIds.add(last.id);
    return last.id;
  };

  const chosenCards = [];
  // Slots 1 & 2 strictly from in-color pool; Slot 3 has a 20% chance of an off-color splash
  for (let slot = 0; slot < 3; slot++) {
    const useSplash = slot === 2 && Math.random() < 0.2 && splashPool.length > 0;
    const id = pickWeighted(useSplash ? splashPool : inColorPool) || pickWeighted(inColorPool) || pickWeighted(splashPool);
    if (id) chosenCards.push(id);
  }

  state.shopStock.cards = chosenCards.map(id => ({
    card: cloneCard(id),
    cost: 3,
    bought: false
  }));

  if (!preserveUpgrades || state.shopStock.upgrades.length === 0) {
    const randomScroll = CONSUMABLE_DB[Math.floor(Math.random() * CONSUMABLE_DB.length)];
    state.shopStock.upgrades = [
      {
        id: "sanctum_heal",
        name: "Sanctum Healing Draught",
        desc: `Restore +8 Life (up to ${MAX_LIFE} Max Life).`,
        cost: 3,
        bought: false
      },
      {
        id: "arcane_scroll",
        isConsumable: true,
        scrollId: randomScroll.id,
        name: `Scroll: ${randomScroll.name}`,
        desc: `${randomScroll.desc} (Consumable — max 2 slots)`,
        cost: randomScroll.cost,
        bought: false
      },
      {
        id: "foil_buff",
        name: "Traditional Foil Treatment",
        desc: "Grant a random Creature in your deck +3/+3 permanently and Haste.",
        cost: 4,
        bought: false
      },
      {
        id: "etched_foil",
        name: "Etched Foil Guildmark",
        desc: "Enchant a random Spell/Creature in your deck with +2 Resonance on cast!",
        cost: 3,
        bought: false
      },
      {
        id: "halo_foil",
        name: "Serialized Halo Foil",
        desc: "Enchant a random Spell/Creature in your deck with ×1.5 Resonance on cast!",
        cost: 5,
        bought: false
      },
      {
        id: "exile_thin",
        name: "Swords to Plowshares (Deck Thin)",
        desc: "Permanently EXILE up to 2 excess Basic Lands without starving Fetch Lands.",
        cost: 3,
        bought: false
      }
    ];
  }
}

function buyRelic(idx) {
  const item = state.shopStock.relics[idx];
  if (!item || item.bought || state.gold < item.cost || state.relics.length >= 5) return;
  state.gold -= item.cost;
  item.bought = true;
  state.relics.push({ ...item });
  saveRunState(true);
  renderShop();
  renderAll();
}

function buyDraftCard(idx) {
  const item = state.shopStock.cards[idx];
  if (!item || item.bought || state.gold < item.cost) return;
  state.gold -= item.cost;
  item.bought = true;
  state.masterDeck.push(item.card);
  saveRunState(true);
  renderShop();
  renderAll();
}

function buyUpgrade(idx) {
  const upg = state.shopStock.upgrades[idx];
  if (!upg || upg.bought || state.gold < upg.cost) return;
  if (upg.isConsumable && state.consumables.length >= 2) return;
  if (upg.id === "sanctum_heal" && state.playerLife >= MAX_LIFE) return;
  if (upg.id === "exile_thin" && !canSafelyThinBasics().allowed) return;

  state.gold -= upg.cost;
  upg.bought = true;

  if (upg.id === "sanctum_heal") {
    const healed = gainLife(8, "Sanctum Healing Draught");
    spawnFx(`+${healed} Life Restored!`, "#26d07c");
  } else if (upg.isConsumable) {
    const def = CONSUMABLE_DB.find(s => s.id === upg.scrollId);
    if (def) {
      state.consumables.push({ ...def, uid: nextUid() });
    }
  } else if (upg.id === "foil_buff") {
    const creatures = state.masterDeck.filter(c => c.type === "Creature");
    if (creatures.length > 0) {
      const target = creatures[Math.floor(Math.random() * creatures.length)];
      target.foil = target.foil || "Foil";
      target.permPowerBonus = (target.permPowerBonus || 0) + 3;
      target.permToughnessBonus = (target.permToughnessBonus || 0) + 3;
      if (!target.keywords.includes("Haste")) target.keywords.push("Haste");
    }
  } else if (upg.id === "etched_foil") {
    const spells = state.masterDeck.filter(c => c.type !== "Land");
    if (spells.length > 0) {
      const target = spells[Math.floor(Math.random() * spells.length)];
      target.foil = "Etched";
    }
  } else if (upg.id === "halo_foil") {
    const spells = state.masterDeck.filter(c => c.type !== "Land");
    if (spells.length > 0) {
      const target = spells[Math.floor(Math.random() * spells.length)];
      target.foil = "Halo";
    }
  } else if (upg.id === "exile_thin") {
    // Exile up to 2 Basic Lands while preserving at least 1 Basic Land of each present color
    for (let i = 0; i < 2; i++) {
      if (!canSafelyThinBasics().allowed) break;
      const countsByCol = {};
      state.masterDeck.forEach(c => {
        if (c.type === "Land" && !c.isFetch && c.produces.length === 1) {
          const col = c.produces[0];
          countsByCol[col] = (countsByCol[col] || 0) + 1;
        }
      });
      // Pick the basic land color with the highest surplus (> 1 copy)
      const bestCol = Object.entries(countsByCol)
        .filter(([, cnt]) => cnt > 1)
        .sort((a, b) => b[1] - a[1])[0];
      if (!bestCol) break;
      const basicIdx = state.masterDeck.findIndex(
        c => c.type === "Land" && !c.isFetch && c.produces.length === 1 && c.produces[0] === bestCol[0]
      );
      if (basicIdx !== -1) state.masterDeck.splice(basicIdx, 1);
    }
  }

  saveRunState(true);
  renderShop();
  renderAll();
}

function sellRelic(id) {
  if (state.runOver || state.combatLocked) return;
  const idx = state.relics.findIndex(r => r.id === id);
  if (idx === -1) return;
  const [r] = state.relics.splice(idx, 1);
  const value = Math.floor((r.cost || 4) / 2);
  state.gold += value;
  spawnFx(`Sold ${r.name} for $${value}`, "#ffbe3b");
  if (!isHeadlessEnv() && document.getElementById("shop-dialog").open) {
    saveRunState(true);
    renderShop();
  }
  renderAll();
}

function moveRelic(idx, dir) {
  if (state.runOver || state.combatLocked) return;
  const targetIdx = idx + dir;
  if (idx < 0 || idx >= state.relics.length || targetIdx < 0 || targetIdx >= state.relics.length) return;
  const [item] = state.relics.splice(idx, 1);
  state.relics.splice(targetIdx, 0, item);
  renderAll();
}

// === CONSUMABLE ARCANE SCROLLS ===
function useConsumable(uid) {
  if (state.runOver || state.combatLocked) return;
  const idx = state.consumables.findIndex(s => s.uid === uid);
  if (idx === -1) return;
  const [scroll] = state.consumables.splice(idx, 1);
  state.canMulligan = false;

  if (scroll.id === "black_lotus") {
    state.manaPool.ANY += 3;
    addResonance(1, "Black Lotus");
    spawnFx("🌸 Black Lotus: +3 Wild Mana & +1 Mult!", "#ffe299");
    setLog("Cracked Black Lotus for +3 Any-Color Mana and +1 Resonance!");
  } else if (scroll.id === "time_walk") {
    state.maxTurns += 1;
    drawCards(1);
    addResonance(1, "Time Walk");
    spawnFx("⏳ Time Walk: +1 Extra Turn & Drew 1!", "#3498db");
    setLog(`Cast Time Walk! Ward Clock extended to ${state.maxTurns} turns and drew a card.`);
  } else if (scroll.id === "wrath_of_god") {
    const count = state.enemyCreatures.length;
    state.enemyCreatures = [];
    addResonance(2, "Wrath of God");
    spawnFx(`☀️ Wrath of God: Destroyed ${count} Blockers & +2 Mult!`, "#ffe299");
    setLog(`Cast Wrath of God! Cleared ${count} Enemy Blockers and gained +2 Resonance.`);
  } else if (scroll.id === "demonic_tutor") {
    addResonance(1, "Demonic Tutor");
    if (state.library.length === 0) {
      spawnFx("Demonic Tutor: Library Empty (+1 Mult)!", "#9b59b6");
    } else {
      const choices = [...state.library].slice(0, 12);
      openTargetPickerModal(
        "Demonic Tutor — Search Library",
        "Choose a card from your Library to put directly into your hand (+1 Resonance granted):",
        choices,
        (c, i) => `
          <button type="button" class="hand-card card-color-${c.color} playable" data-target-idx="${i}">
            <div class="card-top-bar">
              <span class="card-title">${c.name}</span>
              ${renderManaCostHtml(c)}
            </div>
            <div class="card-type-line">${c.type}</div>
            <div class="card-rules">${c.rules}</div>
          </button>
        `,
        (chosen) => {
          const libIdx = state.library.findIndex(c => c.uid === chosen.uid);
          if (libIdx !== -1) {
            const [tutored] = state.library.splice(libIdx, 1);
            state.hand.push(tutored);
            shuffle(state.library);
            spawnFx(`Tutored ${tutored.name} to Hand!`, "#9b59b6");
            setLog(`Demonic Tutor: Searched ${tutored.name} from Library into Hand!`);
          }
        }
      );
    }
  } else if (scroll.id === "wheel_of_fortune") {
    state.hand.forEach(c => pushToGraveyard(c));
    state.hand = [];
    drawCards(5);
    addResonance(2, "Wheel of Fortune");
    spawnFx("🎡 Wheel of Fortune: Drew 5 Fresh Cards & +2 Mult!", "#ff4757");
    setLog("Wheel of Fortune: Discarded hand, drew 5 fresh cards, and gained +2 Resonance!");
  }

  renderAll();
}

// === LOCALSTORAGE RUN PERSISTENCE (Step 5) ===
function createEncounterSaveSnapshot() {
  const fields = [
    "library",
    "hand",
    "graveyard",
    "playerLands",
    "playerCreatures",
    "enemyCreatures",
    "enemyLife",
    "enemyMaxLife",
    "playerLife",
    "gold",
    "turn",
    "maxTurns",
    "landsPlayedThisTurn",
    "maxLandsPerTurn",
    "mulligansLeft",
    "canMulligan",
    "manaPool",
    "turnBurnPower",
    "turnResonance",
    "resonanceSources",
    "burnSources",
    "turnStats",
    "synTiers",
    "consumables"
  ];
  const snapshot = { uidCounter };
  fields.forEach(field => { snapshot[field] = state[field]; });
  return snapshot;
}

function restoreEncounterSaveSnapshot(snapshot) {
  if (!snapshot || !Array.isArray(snapshot.library) || !Array.isArray(snapshot.hand)
    || !Array.isArray(snapshot.graveyard) || !Array.isArray(snapshot.playerLands)
    || !Array.isArray(snapshot.playerCreatures) || !Array.isArray(snapshot.enemyCreatures)) {
    return false;
  }
  Object.keys(snapshot).forEach(field => {
    if (field !== "uidCounter" && Object.prototype.hasOwnProperty.call(state, field)) {
      state[field] = snapshot[field];
    }
  });
  if (Number.isInteger(snapshot.uidCounter) && snapshot.uidCounter > 0) {
    uidCounter = snapshot.uidCounter;
  }
  state.runOver = false;
  state.combatLocked = false;
  return true;
}

function saveRunState(inShop = false) {
  if (isHeadlessEnv() || typeof localStorage === "undefined" || state.runOver) return;
  try {
    const payload = {
      version: 1,
      inShop: Boolean(inShop),
      archetypeId: state.deckArchetype.id,
      encounterIdx: state.encounterIdx,
      playerLife: state.playerLife,
      gold: state.gold,
      masterDeck: state.masterDeck.map(c => ({
        id: c.id,
        foil: c.foil || null,
        permPowerBonus: c.permPowerBonus || 0,
        permToughnessBonus: c.permToughnessBonus || 0,
        keywords: c.keywords || []
      })),
      relicIds: state.relics.map(r => r.id),
      consumableIds: state.consumables.map(s => s.id),
      encounterState: inShop ? null : createEncounterSaveSnapshot(),
      shopStock: inShop ? state.shopStock : null
    };
    localStorage.setItem(SAVE_KEY, JSON.stringify(payload));
  } catch (error) {
    console.error("Unable to save the current run:", error);
  }
}

function clearRunState() {
  if (isHeadlessEnv() || typeof localStorage === "undefined") return;
  try {
    localStorage.removeItem(SAVE_KEY);
  } catch (_) {}
}

function loadRunState() {
  if (isHeadlessEnv() || typeof localStorage === "undefined") return false;
  try {
    const raw = localStorage.getItem(SAVE_KEY);
    if (!raw) return false;
    const saved = JSON.parse(raw);
    if (!saved || saved.version !== 1 || !Array.isArray(saved.masterDeck)) return false;

    const arch = STARTER_DECKS.find(d => d.id === saved.archetypeId) || STARTER_DECKS[0];
    state.deckArchetype = arch;
    state.encounterIdx = Number(saved.encounterIdx) || 0;
    state.playerLife = Math.min(MAX_LIFE, Math.max(1, Number(saved.playerLife) || START_LIFE));
    state.gold = Math.max(0, Number(saved.gold) || 0);
    state.runOver = false;
    state.combatLocked = false;

    state.masterDeck = saved.masterDeck
      .filter(sc => CARD_DB[sc.id])
      .map(sc => {
        const card = cloneCard(sc.id);
        card.foil = sc.foil || null;
        card.permPowerBonus = sc.permPowerBonus || 0;
        card.permToughnessBonus = sc.permToughnessBonus || 0;
        if (Array.isArray(sc.keywords)) {
          sc.keywords.forEach(kw => {
            if (!card.keywords.includes(kw)) card.keywords.push(kw);
          });
        }
        return card;
      });

    state.relics = (saved.relicIds || [])
      .map(id => RELIC_DB.find(r => r.id === id))
      .filter(Boolean)
      .map(r => ({ ...r }));

    state.consumables = (saved.consumableIds || [])
      .map(id => CONSUMABLE_DB.find(s => s.id === id))
      .filter(Boolean)
      .map(s => ({ ...s, uid: nextUid() }));

    if (!restoreEncounterSaveSnapshot(saved.encounterState)) {
      beginEncounter();
    }

    if (saved.inShop && saved.shopStock) {
      state.enemyLife = 0;
      state.shopStock = {
        relics: (saved.shopStock.relics || []).map(r => {
          const def = RELIC_DB.find(d => d.id === r.id) || r;
          return { ...def, bought: Boolean(r.bought) };
        }),
        cards: (saved.shopStock.cards || []).map(it => ({
          card: it.card && CARD_DB[it.card.id] ? cloneCard(it.card.id) : cloneCard("evolving_wilds"),
          cost: it.cost || 3,
          bought: Boolean(it.bought)
        })),
        upgrades: saved.shopStock.upgrades || []
      };
      const enc = getCurrentEncounter();
      document.getElementById("shop-plane-badge").textContent =
        `SANCTUM RESTORED • ${enc.name.toUpperCase()} DEFEATED!`;
      document.getElementById("shop-reward-summary").textContent =
        "Progress restored from Sanctum memory. Finish shopping before entering the next encounter!";
      renderShop();
      renderAll();
      document.getElementById("shop-dialog").showModal();
      saveRunState(true);
    } else {
      setLog(`Restored saved run (${arch.badge}, Encounter ${state.encounterIdx + 1})!`);
      renderAll();
    }
    return true;
  } catch (error) {
    console.error("Unable to restore the saved run:", error);
    return false;
  }
}

if (typeof window !== "undefined") {
  window.addEventListener("DOMContentLoaded", () => {
    initEvents();
    if (!loadRunState()) {
      startNewRun(STARTER_DECKS[0]);
    }
  });
}
