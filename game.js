// MANASTORM — Core Game State, Turn Loop, Card Effects, Shop & LocalStorage Persistence

const SAVE_KEY = "manastorm_saved_run_v1";
const SAVE_BACKUP_STORE_KEY = typeof SAVE_BACKUP_KEY !== "undefined" ? SAVE_BACKUP_KEY : "manastorm_saved_run_backup_v1";
const SAVE_CORRUPT_STORE_KEY = typeof SAVE_CORRUPT_KEY !== "undefined" ? SAVE_CORRUPT_KEY : "manastorm_saved_run_corrupt_v1";

function getSafeLocalStorage() {
  try {
    if (
      typeof localStorage !== "undefined" &&
      localStorage &&
      (typeof localStorage.getItem === "function" || typeof localStorage.setItem === "function")
    ) {
      return localStorage;
    }
  } catch (_) {}
  return null;
}

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
  synTiers: {},
  route: null,
  pendingDraft: null,
  lastSaveError: null
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

function millCards(count) {
  let milled = 0;
  for (let i = 0; i < count; i++) {
    if (state.library.length === 0) break;
    const card = state.library.pop();
    pushToGraveyard(card);
    milled++;
  }
  return milled;
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
function createInitialRouteState(loop = 0) {
  const startNode = (typeof CAMPAIGN_ROUTE_NODES !== "undefined" && CAMPAIGN_ROUTE_NODES[0])
    ? CAMPAIGN_ROUTE_NODES[0]
    : { id: "p1_start" };
  return {
    loop: Math.max(0, Math.floor(Number(loop) || 0)),
    currentNodeId: startNode.id,
    completedNodeIds: [],
    visitedNodeIds: [startNode.id],
    pendingSelection: false,
    lastActivitySummary: null
  };
}

function getRouteNodeById(nodeId) {
  if (!nodeId || typeof CAMPAIGN_ROUTE_NODES === "undefined" || !Array.isArray(CAMPAIGN_ROUTE_NODES)) {
    return null;
  }
  return CAMPAIGN_ROUTE_NODES.find(n => n.id === nodeId) || null;
}

function ensureRouteState() {
  if (!state.route || typeof state.route !== "object" || !getRouteNodeById(state.route.currentNodeId)) {
    state.route = createInitialRouteState(Math.floor((Number(state.encounterIdx) || 0) / ENCOUNTERS.length));
  }
  if (!Array.isArray(state.route.completedNodeIds)) state.route.completedNodeIds = [];
  if (!Array.isArray(state.route.visitedNodeIds)) state.route.visitedNodeIds = [state.route.currentNodeId];
  return state.route;
}

function getCurrentRouteNode() {
  const route = ensureRouteState();
  return getRouteNodeById(route.currentNodeId) || (typeof CAMPAIGN_ROUTE_NODES !== "undefined" ? CAMPAIGN_ROUTE_NODES[0] : null);
}

function completeCurrentRouteNode() {
  const route = ensureRouteState();
  if (!route.completedNodeIds.includes(route.currentNodeId)) {
    route.completedNodeIds.push(route.currentNodeId);
    return true;
  }
  return false;
}

function getAvailableNextRouteNodes() {
  const route = ensureRouteState();
  const current = getCurrentRouteNode();
  if (!current || !route.completedNodeIds.includes(current.id)) return [];
  return (current.next || [])
    .map(id => getRouteNodeById(id))
    .filter(n => n && !route.completedNodeIds.includes(n.id));
}

function canSelectRouteNode(nodeId) {
  if (!nodeId || state.runOver || state.combatLocked) return false;
  const route = ensureRouteState();
  const current = getCurrentRouteNode();
  if (!current || !route.completedNodeIds.includes(current.id)) return false;
  if (route.completedNodeIds.includes(nodeId)) return false;
  return Array.isArray(current.next) && current.next.includes(nodeId) && Boolean(getRouteNodeById(nodeId));
}

function resolveNonCombatRouteNode(node) {
  const route = ensureRouteState();
  if (route.completedNodeIds.includes(node.id)) {
    return { ok: false, reason: "already_completed" };
  }

  let healed = 0;
  let goldEarned = 0;
  let buffedCardName = null;
  let scrollGrantedName = null;

  if (node.healAmount) {
    healed = gainLife(node.healAmount, node.title);
  }
  if (node.goldBonus) {
    goldEarned = node.goldBonus;
    state.gold += goldEarned;
  }
  if (node.buffBonus) {
    const creatures = state.masterDeck.filter(c => c.type === "Creature");
    if (creatures.length > 0) {
      creatures.sort((a, b) => (b.power + (b.permPowerBonus || 0)) - (a.power + (a.permPowerBonus || 0)));
      const target = creatures[0];
      target.permPowerBonus = (target.permPowerBonus || 0) + node.buffBonus;
      target.permToughnessBonus = (target.permToughnessBonus || 0) + node.buffBonus;
      target.foil = target.foil || "Foil";
      buffedCardName = target.name;
    }
  }
  if (node.grantScroll) {
    if (state.consumables.length < 2 && CONSUMABLE_DB.length > 0) {
      const def = CONSUMABLE_DB[Math.floor(Math.random() * CONSUMABLE_DB.length)];
      state.consumables.push({ ...def, uid: nextUid() });
      scrollGrantedName = def.name;
    } else {
      state.gold += 3;
      goldEarned += 3;
    }
  }

  completeCurrentRouteNode();
  route.pendingSelection = (node.next && node.next.length > 0);

  const summaryParts = [];
  if (healed > 0) summaryParts.push(`+${healed} Life`);
  if (goldEarned > 0) summaryParts.push(`+$${goldEarned} Gold`);
  if (buffedCardName) summaryParts.push(`${buffedCardName} +${node.buffBonus}/+${node.buffBonus} & Foil`);
  if (scrollGrantedName) summaryParts.push(`Scroll: ${scrollGrantedName}`);
  const summaryText = summaryParts.length > 0 ? summaryParts.join(" • ") : node.desc;
  route.lastActivitySummary = `${node.title}: ${summaryText}`;

  if (node.type === "shop") {
    state.enemyLife = 0;
    generateShopStock(false);
    saveRunState(true);
    renderShop();
    renderAll();
    if (!isHeadlessEnv()) {
      setText("shop-plane-badge", `SANCTUM OUTPOST • ${node.title.toUpperCase()}`);
      setText("shop-reward-summary", `${node.desc} (${summaryText})`);
      safeShowModal("shop-dialog");
    }
  } else {
    saveRunState(false);
    renderAll();
    setLog(`Visited ${node.title} (${summaryText})! Choose your next stop on the Planar Route.`);
    spawnFx(`${node.title}: ${summaryText}`, "#26d07c");
  }

  return { ok: true, node, summaryText };
}

function selectRouteNode(nodeId) {
  if (!canSelectRouteNode(nodeId)) return false;
  const route = ensureRouteState();
  const node = getRouteNodeById(nodeId);
  if (!node) return false;

  route.currentNodeId = node.id;
  if (!route.visitedNodeIds.includes(node.id)) {
    route.visitedNodeIds.push(node.id);
  }
  route.pendingSelection = false;

  const loopOffset = (route.loop || 0) * ENCOUNTERS.length;
  if (typeof node.encounterIdx === "number") {
    state.encounterIdx = loopOffset + node.encounterIdx;
  }

  if (node.type === "fight" || node.type === "elite" || node.type === "boss") {
    route.lastActivitySummary = null;
    beginEncounter();
    saveRunState(false);
    return true;
  }

  resolveNonCombatRouteNode(node);
  return true;
}

function advanceToNextLoopRoute() {
  const currentLoop = state.route && typeof state.route.loop === "number"
    ? state.route.loop + 1
    : Math.floor(state.encounterIdx / ENCOUNTERS.length) + 1;
  state.route = createInitialRouteState(currentLoop);
  state.encounterIdx = currentLoop * ENCOUNTERS.length;
  beginEncounter();
  saveRunState(false);
}

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
  state.route = createInitialRouteState(0);
  state.pendingDraft = null;

  beginEncounter();
  saveRunState(false);
}

function getCurrentEncounter() {
  return ENCOUNTERS[state.encounterIdx % ENCOUNTERS.length];
}

function beginEncounter() {
  state.runOver = false;
  state.combatLocked = false;
  state.pendingDraft = null;
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
    if (c.upkeep === "overseer") {
      const buff = 1 * stackCount * getTokenMultiplier();
      state.playerCreatures.forEach(ally => {
        ally.power += buff;
        ally.toughness += buff;
      });
      addResonance(1 * stackCount, "Steel Overseer");
      spawnFx(`Steel Overseer: Board +${buff}/+${buff} & +${stackCount} Mult!`, "#a4b0be");
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
    const tokenSubtype = name.includes("Goblin")
      ? "Goblin"
      : ((color === "C" || name.includes("Construct") || name.includes("Thopter") || name.includes("Myr")) ? "Construct" : "Token");
    state.playerCreatures.push({
      uid: nextUid(),
      name,
      color,
      subtype: tokenSubtype,
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
  },
  supplier() {
    const milled = millCards(3);
    addResonance(1, "Stitcher's Supplier");
    spawnFx(`Stitcher's Supplier: Milled ${milled} & +1 Mult!`, "#9b59b6");
  },
  wayfinder() {
    const milled = millCards(3);
    addResonance(1, "Satyr Wayfinder");
    let landIdx = -1;
    for (let i = state.graveyard.length - 1; i >= 0; i--) {
      if (state.graveyard[i].type === "Land") {
        landIdx = i;
        if (state.graveyard[i].isFetch || (state.graveyard[i].produces && state.graveyard[i].produces.length > 1)) {
          break;
        }
      }
    }
    if (landIdx !== -1) {
      const [recoveredLand] = state.graveyard.splice(landIdx, 1);
      state.hand.push(recoveredLand);
      spawnFx(`Wayfinder: Milled ${milled} & Recovered ${recoveredLand.name}!`, "#2ecc71");
    } else {
      spawnFx(`Satyr Wayfinder: Milled ${milled} & +1 Mult!`, "#2ecc71");
    }
  },
  fiend_artisan(creature) {
    const gyCreatures = state.graveyard.filter(c => c.type === "Creature").length;
    const bonus = gyCreatures * getTokenMultiplier();
    if (creature && bonus > 0) {
      creature.power += bonus;
      creature.toughness += bonus;
    }
    addResonance(1, "Fiend Artisan");
    spawnFx(`Fiend Artisan: +${bonus}/+${bonus} Undergrowth & +1 Mult!`, "#2ecc71");
  },
  overseer() {
    const buff = 1 * getTokenMultiplier();
    state.playerCreatures.forEach(c => {
      c.power += buff;
      c.toughness += buff;
    });
    addResonance(1, "Steel Overseer");
    spawnFx(`Steel Overseer: Board +${buff}/+${buff} & +1 Mult!`, "#a4b0be");
  },
  modular(creature) {
    const otherUnits = state.playerCreatures.reduce((sum, c) => {
      if (creature && c.uid === creature.uid) return sum;
      return sum + (c.count || 1);
    }, 0);
    const bonus = otherUnits * getTokenMultiplier();
    if (creature && bonus > 0) {
      creature.power += bonus;
      creature.toughness += bonus;
    }
    addResonance(1, "Arcbound Ravager");
    spawnFx(`Arcbound Ravager: +${bonus}/+${bonus} Modular & +1 Mult!`, "#a4b0be");
  },
  battlesphere() {
    spawnTokens("Myr Construct", 1, 1, "C", ["Haste"], 3);
    addResonance(2, "Myr Battlesphere");
    spawnFx("Myr Battlesphere: +3 Myr Constructs & +2 Mult!", "#a4b0be");
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
  },
  grisly_salvage() {
    const milled = millCards(3);
    addResonance(2, "Grisly Salvage");
    const gyCreatures = state.graveyard.filter(c => c.type === "Creature");
    if (gyCreatures.length > 0) {
      gyCreatures.sort(
        (a, b) => ((b.power || 0) + (b.permPowerBonus || 0)) - ((a.power || 0) + (a.permPowerBonus || 0))
      );
      const best = gyCreatures[0];
      state.graveyard = state.graveyard.filter(c => c.uid !== best.uid);
      state.hand.push(best);
      spawnFx(`Grisly Salvage: Milled ${milled} & Recovered ${best.name}!`, "#2ecc71");
    } else {
      drawCards(1);
      spawnFx(`Grisly Salvage: Milled ${milled}, Drew 1 & +2 Mult!`, "#2ecc71");
    }
  },
  spider_spawning() {
    const gyCreatures = state.graveyard.filter(c => c.type === "Creature").length;
    const count = Math.min(5, Math.max(2, gyCreatures));
    spawnTokens("Spider Token", 2, 2, "G", ["Haste", "Lifelink"], count);
    addResonance(2, "Spider Spawning");
    spawnFx(`Spider Spawning: +${count * getTokenMultiplier()} Spiders & +2 Mult!`, "#2ecc71");
  },
  thoughtcast() {
    drawCards(2);
    addResonance(1, "Thoughtcast");
    spawnFx("Thoughtcast: Drew 2 Cards & +1 Mult!", "#a4b0be");
  },
  thopter_foundry() {
    spawnTokens("Thopter Construct", 1, 1, "C", ["Flying", "Haste"], 2);
    gainLife(2, "Thopter Foundry");
    addResonance(1, "Thopter Foundry");
    spawnFx("Thopter Foundry: +2 Thopters, +2 Life & +1 Mult!", "#a4b0be");
  },
  galvanic_blast() {
    addResonance(1, "Galvanic Blast");
    if (state.enemyCreatures.length > 0) {
      const sortedBlockers = [...state.enemyCreatures].sort((a, b) => b.power - a.power);
      openTargetPickerModal(
        "Galvanic Blast — Choose Target Blocker",
        "Select an Enemy Blocker to destroy (+1 Resonance granted):",
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
          spawnFx(`Galvanic Blast Destroyed ${chosen.name}!`, "#ff4757");
        }
      );
    } else {
      addBurnPower(5, "Galvanic Blast");
      spawnFx("Galvanic Blast: +5 Burn to Boss & +1 Mult!", "#ff4757");
    }
  },
  cyberdrive() {
    const buff = 3 * getTokenMultiplier();
    state.playerCreatures.forEach(c => {
      c.tempPower += buff;
      c.tempToughness += buff;
      addTempKeyword(c, "Flying");
      addTempKeyword(c, "Haste");
      c.summoningSick = false;
      c.attacking = true;
    });
    addResonance(2, "Cyberdrive Awakener");
    spawnFx(`CYBERDRIVE! All Creatures +${buff}/+${buff}, Flying & Haste!`, "#a4b0be");
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
  (state.masterDeck || []).forEach(c => {
    if (!c) return;
    if (c.type === "Land") {
      (c.produces || []).forEach(col => cols.add(col));
    } else {
      if (COLORS.includes(c.color) || c.color === "C") {
        cols.add(c.color);
      }
      if (c.manaCost && typeof parseManaCost === "function") {
        const parsed = parseManaCost(c.manaCost);
        if (parsed && parsed.pips) {
          COLORS.forEach(col => {
            if ((parsed.pips[col] || 0) > 0) cols.add(col);
          });
        }
      }
    }
  });
  return cols;
}

function isCardLegalForDeck(cardOrId, deckColors) {
  const card = typeof cardOrId === "string" ? (typeof CARD_DB !== "undefined" ? CARD_DB[cardOrId] : null) : cardOrId;
  if (!card || typeof card !== "object") return false;

  // 1. Basic lands strictly excluded
  if (card.subtype === "Basic") return false;

  const colorsSet = deckColors instanceof Set
    ? deckColors
    : new Set(Array.isArray(deckColors) ? deckColors : []);

  // 2. Fetch lands are universal fixers legal for all decks
  if (card.isFetch) return true;

  // 3. Dual lands / non-fetch lands
  if (card.type === "Land") {
    const produces = Array.isArray(card.produces) ? card.produces : [];
    if (produces.length === 0) return true;
    return produces.every(col => colorsSet.has(col));
  }

  // 4. Colorless cards (e.g. Artifact Constructs)
  if (card.color === "C") {
    return colorsSet.has("C");
  }

  // 5. Colored cards: primary color and all colored mana pips must match deckColors
  if (!colorsSet.has(card.color)) {
    return false;
  }

  if (card.manaCost && typeof parseManaCost === "function") {
    const parsed = parseManaCost(card.manaCost);
    if (parsed && parsed.pips) {
      for (const col of COLORS) {
        if ((parsed.pips[col] || 0) > 0 && !colorsSet.has(col)) {
          return false;
        }
      }
    }
  }

  return true;
}

function sampleDraftPool(deckColors, count = 3, rng = Math.random) {
  if (typeof CARD_DB === "undefined") return [];
  const colorsSet = deckColors instanceof Set
    ? deckColors
    : new Set(Array.isArray(deckColors) ? deckColors : []);

  const eligible = Object.values(CARD_DB).filter(c => isCardLegalForDeck(c, colorsSet));
  if (eligible.length === 0) return [];

  const needed = Math.min(count, eligible.length);
  const pool = [...eligible];
  const chosen = [];

  for (let i = 0; i < needed && pool.length > 0; i++) {
    const rawR = typeof rng === "function" ? rng() : Math.random();
    const safeR = Number.isFinite(rawR) ? Math.abs(rawR) : 0;
    const idx = Math.floor(safeR * pool.length) % pool.length;
    chosen.push(pool[idx]);
    pool.splice(idx, 1);
  }

  return chosen;
}

const generateDraftRewardPool = sampleDraftPool;

function selectDraftCard(choiceIdx) {
  if (!state.pendingDraft || state.pendingDraft.resolved || state.runOver) {
    return false;
  }
  const choices = state.pendingDraft.choices;
  if (!Array.isArray(choices) || choices.length === 0) {
    return false;
  }

  let targetId = null;
  if (typeof choiceIdx === "number") {
    if (choiceIdx < 0 || choiceIdx >= choices.length) return false;
    const item = choices[choiceIdx];
    targetId = typeof item === "string" ? item : (item && item.id ? item.id : null);
  } else if (typeof choiceIdx === "string") {
    const found = choices.find(c => (typeof c === "string" ? c : c?.id) === choiceIdx);
    if (!found) return false;
    targetId = choiceIdx;
  }
  if (!targetId || !CARD_DB[targetId]) return false;

  const draftedCard = cloneCard(targetId);
  state.masterDeck.push(draftedCard);

  state.pendingDraft.resolved = true;
  state.pendingDraft.skipped = false;
  state.pendingDraft.selectedCardId = targetId;

  saveRunState(true);

  if (!isHeadlessEnv()) {
    if (typeof spawnFx === "function") {
      spawnFx(`Drafted ${draftedCard.name}!`, "#26d07c");
    }
    if (typeof setLog === "function") {
      setLog(`Post-battle draft: drafted ${draftedCard.name} into master deck (${state.masterDeck.length} cards).`);
    }
    if (typeof closeDraftModal === "function") {
      closeDraftModal();
    }
    if (typeof renderAll === "function") {
      renderAll();
    }
    if (typeof renderShop === "function") {
      renderShop();
    }
    if (typeof safeShowModal === "function") {
      safeShowModal("shop-dialog");
    }
  }
  return true;
}

function skipDraft() {
  if (!state.pendingDraft || state.pendingDraft.resolved || state.runOver) {
    return false;
  }

  state.gold += 2;

  state.pendingDraft.resolved = true;
  state.pendingDraft.skipped = true;
  state.pendingDraft.selectedCardId = null;

  saveRunState(true);

  if (!isHeadlessEnv()) {
    if (typeof spawnFx === "function") {
      spawnFx("Draft Skipped: +$2 Gold!", "#ffd466");
    }
    if (typeof setLog === "function") {
      setLog(`Post-battle draft skipped: received +$2 Gold compensation bounty (Current Gold: $${state.gold}).`);
    }
    if (typeof closeDraftModal === "function") {
      closeDraftModal();
    }
    if (typeof renderAll === "function") {
      renderAll();
    }
    if (typeof renderShop === "function") {
      renderShop();
    }
    if (typeof safeShowModal === "function") {
      safeShowModal("shop-dialog");
    }
  }
  return true;
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

  // Mark current route node as completed and flag pending route choice if branches remain
  const route = ensureRouteState();
  completeCurrentRouteNode();
  const nextNodes = getAvailableNextRouteNodes();
  route.pendingSelection = nextNodes.length > 0;
  route.lastActivitySummary = `Defeated ${enc.name} (+$${earned} Gold${healed > 0 ? `, +${healed} Life` : ""})`;

  generateShopStock(false);

  const isFinalEncounter = state.encounterIdx >= ENCOUNTERS.length - 1;
  if (!isFinalEncounter) {
    const draftCards = sampleDraftPool(getDeckColors(), 3);
    state.pendingDraft = {
      choices: draftCards.map(c => c.id),
      encounterIdx: state.encounterIdx,
      resolved: false,
      skipped: false,
      selectedCardId: null
    };
    Object.defineProperty(state.pendingDraft, "cards", {
      get() {
        return (this.choices || []).map(id => (typeof id === "string" ? CARD_DB[id] : id)).filter(Boolean);
      },
      enumerable: false,
      configurable: true
    });
    saveRunState(false);
  } else {
    state.pendingDraft = null;
    saveRunState(true);
  }

  renderShop();
  renderAll();

  if (!isHeadlessEnv()) {
    const badgeText = `VICTORY • ${enc.name.toUpperCase()} DEFEATED!`;
    const summaryText =
      `Earned $${enc.reward} Ward Bounty + $${unusedTurnsBonus} Unused Turn Bonus + $${interest} Interest ($${earned} Total)${healed > 0 ? ` • Restored +${healed} Life` : ""}. Sculpt your deck before choosing your next Planar Route stop!`;
    if (typeof presentVictoryOrShopModal === "function") {
      presentVictoryOrShopModal(enc, earned, healed, badgeText, summaryText);
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
    } else if (c.type === "Land") {
      const matchCount = (c.produces || []).filter(col => deckColors.has(col)).length;
      if (matchCount >= 2 || (c.produces.length === 1 && matchCount === 1)) {
        inColorPool.push({ id, weight: 6 });
      } else if (matchCount === 1) {
        splashPool.push({ id, weight: 2 });
      }
    } else if (c.color === "C") {
      if (deckColors.has("C")) {
        inColorPool.push({ id, weight: 6 });
      } else {
        splashPool.push({ id, weight: 2 });
      }
    } else {
      const parsed = parseManaCost(c.manaCost);
      const cardCols = COLORS.filter(col => parsed.pips[col] > 0);
      const allMatch = cardCols.length > 0 && cardCols.every(col => deckColors.has(col));
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
  const shopOpen = typeof isShopDialogOpen === "function" ? isShopDialogOpen() : false;
  if (!isHeadlessEnv() && shopOpen) {
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
  if (typeof renderIncremental === "function") {
    renderIncremental(["command"]);
  } else {
    renderAll();
  }
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

// === CANONICAL SAVE SCHEMA, SNAPSHOT OWNERSHIP & RECOVERY (Fixes #1, #2, #7) ===

function fallbackComputeSaveChecksum(saveObj) {
  if (typeof computeSaveChecksum === "function" && computeSaveChecksum !== fallbackComputeSaveChecksum) {
    return computeSaveChecksum(saveObj);
  }
  if (!saveObj || typeof saveObj !== "object") return "fnv1a_00000000";
  const canonicalCore = {
    version: Number(saveObj.version) || 1,
    inShop: Boolean(saveObj.inShop),
    archetypeId: String(saveObj.archetypeId || ""),
    encounterIdx: Number(saveObj.encounterIdx) || 0,
    playerLife: Number(saveObj.playerLife) || 20,
    gold: Number(saveObj.gold) || 0,
    masterDeck: Array.isArray(saveObj.masterDeck)
      ? saveObj.masterDeck.map(c => ({
          id: c && c.id ? String(c.id) : "",
          foil: (c && c.foil) || null,
          permPowerBonus: Number(c && c.permPowerBonus) || 0,
          permToughnessBonus: Number(c && c.permToughnessBonus) || 0,
          keywords: Array.isArray(c && c.keywords) ? [...c.keywords] : []
        }))
      : [],
    relicIds: Array.isArray(saveObj.relicIds)
      ? saveObj.relicIds.map(String)
      : (Array.isArray(saveObj.relics) ? saveObj.relics.map(r => String((r && r.id) || r || "")).filter(Boolean) : []),
    consumableIds: Array.isArray(saveObj.consumableIds)
      ? saveObj.consumableIds.map(String)
      : (Array.isArray(saveObj.consumables) ? saveObj.consumables.map(s => String((s && s.id) || s || "")).filter(Boolean) : [])
  };
  const str = JSON.stringify(canonicalCore);
  let hash = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    hash ^= str.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return `fnv1a_${hash.toString(16).padStart(8, "0")}`;
}

function isValidEncounterSnapshot(snapshot) {
  if (!snapshot || typeof snapshot !== "object") return false;
  if (
    !Array.isArray(snapshot.library) ||
    !Array.isArray(snapshot.hand) ||
    !Array.isArray(snapshot.graveyard) ||
    !Array.isArray(snapshot.playerLands) ||
    !Array.isArray(snapshot.playerCreatures) ||
    !Array.isArray(snapshot.enemyCreatures)
  ) {
    return false;
  }
  if (snapshot.manaPool !== undefined && (!snapshot.manaPool || typeof snapshot.manaPool !== "object")) {
    return false;
  }
  return true;
}

function normalizeRouteState(rawRoute, encounterIdx = 0, inShop = false) {
  if (typeof normalizeRouteObject === "function") {
    return normalizeRouteObject(rawRoute, encounterIdx, inShop);
  }
  const encCount =
    typeof ENCOUNTERS !== "undefined" && Array.isArray(ENCOUNTERS) && ENCOUNTERS.length > 0
      ? ENCOUNTERS.length
      : 6;
  const safeEncIdx = Math.max(0, Math.floor(Number(encounterIdx) || 0));
  const defaultLoop = Math.floor(safeEncIdx / encCount);
  const encMod = safeEncIdx % encCount;

  const fallbackPathByEnc = [
    { current: "p1_start", prior: [] },
    { current: "p1_elite", prior: ["p1_start", "p1_upper_rest"] },
    { current: "p1_boss", prior: ["p1_start", "p1_upper_rest", "p1_elite"] },
    { current: "p2_entry_fight", prior: ["p1_start", "p1_upper_rest", "p1_elite", "p1_boss"] },
    { current: "p2_mid_elite", prior: ["p1_start", "p1_upper_rest", "p1_elite", "p1_boss", "p2_entry_fight"] },
    { current: "p2_boss", prior: ["p1_start", "p1_upper_rest", "p1_elite", "p1_boss", "p2_entry_fight", "p2_mid_elite"] }
  ];
  const fallbackEntry = fallbackPathByEnc[encMod] || fallbackPathByEnc[0];

  const isValidNodeId = (id) => {
    if (typeof id !== "string" || id.length === 0) return false;
    if (typeof CAMPAIGN_ROUTE_NODES !== "undefined" && Array.isArray(CAMPAIGN_ROUTE_NODES)) {
      return CAMPAIGN_ROUTE_NODES.some(n => n.id === id);
    }
    return true;
  };

  if (!rawRoute || typeof rawRoute !== "object" || Array.isArray(rawRoute)) {
    const completed = inShop ? [...fallbackEntry.prior, fallbackEntry.current] : [...fallbackEntry.prior];
    return {
      loop: defaultLoop,
      currentNodeId: fallbackEntry.current,
      completedNodeIds: completed,
      visitedNodeIds: [...fallbackEntry.prior, fallbackEntry.current],
      pendingSelection: Boolean(inShop && encMod < encCount - 1),
      lastActivitySummary: null
    };
  }

  const currentNodeId = isValidNodeId(rawRoute.currentNodeId)
    ? rawRoute.currentNodeId
    : fallbackEntry.current;
  const completedNodeIds = Array.isArray(rawRoute.completedNodeIds)
    ? Array.from(new Set(rawRoute.completedNodeIds.filter(isValidNodeId)))
    : [];
  const visitedNodeIds = Array.isArray(rawRoute.visitedNodeIds)
    ? Array.from(new Set(rawRoute.visitedNodeIds.filter(isValidNodeId)))
    : [];
  if (!visitedNodeIds.includes(currentNodeId)) {
    visitedNodeIds.push(currentNodeId);
  }
  const rawLoop = Number(rawRoute.loop);
  const loop = Number.isFinite(rawLoop) && rawLoop >= 0 ? Math.floor(rawLoop) : defaultLoop;

  return {
    loop,
    currentNodeId,
    completedNodeIds,
    visitedNodeIds,
    pendingSelection: Boolean(rawRoute.pendingSelection),
    lastActivitySummary: typeof rawRoute.lastActivitySummary === "string" ? rawRoute.lastActivitySummary : null
  };
}

function normalizeCanonicalSave(candidate) {
  if (typeof DesktopBridge !== "undefined" && typeof DesktopBridge.normalizeSaveObject === "function") {
    return DesktopBridge.normalizeSaveObject(candidate);
  }
  if (typeof normalizeSaveObject === "function") {
    return normalizeSaveObject(candidate);
  }
  if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) {
    return { valid: false, status: "invalid_type", error: "Save data must be a JSON object." };
  }
  const raw = candidate.format === "manastorm-save-backup" && candidate.save && typeof candidate.save === "object"
    ? candidate.save
    : candidate;
  const working = { ...raw };
  let migrated = false;
  if (working.version === undefined || working.version === 0 || working.version === "1" || working.version === "1.0") {
    working.version = 1;
    if (!Array.isArray(working.masterDeck) && Array.isArray(working.deck)) {
      working.masterDeck = working.deck;
    }
    if (!Array.isArray(working.relicIds) && Array.isArray(working.relics)) {
      working.relicIds = working.relics.map(r => (typeof r === "string" ? r : r?.id)).filter(Boolean);
    }
    if (!Array.isArray(working.consumableIds) && Array.isArray(working.consumables)) {
      working.consumableIds = working.consumables.map(s => (typeof s === "string" ? s : s?.id)).filter(Boolean);
    }
    migrated = true;
  }
  if (working.version !== 1 || !Array.isArray(working.masterDeck) || working.masterDeck.length === 0) {
    return { valid: false, status: "unsupported_version", error: "Invalid MANASTORM v1 save format or empty deck." };
  }
  const normalizedDeck = working.masterDeck
    .map(item => {
      const id = typeof item === "string" ? item : item?.id;
      if (!id || (typeof CARD_DB !== "undefined" && !CARD_DB[id])) return null;
      return {
        id: String(id),
        foil: (item && item.foil) || null,
        permPowerBonus: Number(item && item.permPowerBonus) || 0,
        permToughnessBonus: Number(item && item.permToughnessBonus) || 0,
        keywords: Array.isArray(item && item.keywords) ? [...item.keywords] : []
      };
    })
    .filter(Boolean);
  if (normalizedDeck.length === 0) {
    return { valid: false, status: "unrecognized_cards", error: "Save deck contains no recognized MANASTORM cards." };
  }
  const relicIds = Array.isArray(working.relicIds)
    ? working.relicIds.filter(id => typeof id === "string" && (typeof RELIC_DB === "undefined" || RELIC_DB.some(r => r.id === id)))
    : (Array.isArray(working.relics)
      ? working.relics.map(r => (typeof r === "string" ? r : r?.id)).filter(id => typeof id === "string" && (typeof RELIC_DB === "undefined" || RELIC_DB.some(r => r.id === id)))
      : []);
  const consumableIds = Array.isArray(working.consumableIds)
    ? working.consumableIds.filter(id => typeof id === "string" && (typeof CONSUMABLE_DB === "undefined" || CONSUMABLE_DB.some(s => s.id === id)))
    : (Array.isArray(working.consumables)
      ? working.consumables.map(s => (typeof s === "string" ? s : s?.id)).filter(id => typeof id === "string" && (typeof CONSUMABLE_DB === "undefined" || CONSUMABLE_DB.some(s => s.id === id)))
      : []);
  const matchedArch = STARTER_DECKS.find(d => d.id === working.archetypeId) || STARTER_DECKS[0];
  const inShop = Boolean(working.inShop);
  const safeEncIdx = Math.max(0, Math.floor(Number(working.encounterIdx) || 0));
  const canonicalSave = {
    version: 1,
    savedAt: Number.isFinite(Number(working.savedAt)) && Number(working.savedAt) > 0 ? Number(working.savedAt) : 0,
    inShop,
    archetypeId: matchedArch ? matchedArch.id : String(working.archetypeId || STARTER_DECKS[0].id),
    encounterIdx: safeEncIdx,
    playerLife: Math.min(MAX_LIFE, Math.max(1, Math.round(Number(working.playerLife) || START_LIFE))),
    gold: Math.max(0, Math.floor(Number(working.gold) || 0)),
    masterDeck: normalizedDeck,
    relicIds,
    relics: relicIds.map(id => ({ id })),
    consumableIds,
    encounterState: !inShop && isValidEncounterSnapshot(working.encounterState) ? working.encounterState : null,
    shopStock: inShop && working.shopStock && typeof working.shopStock === "object"
      ? {
          relics: Array.isArray(working.shopStock.relics) ? working.shopStock.relics : [],
          cards: Array.isArray(working.shopStock.cards) ? working.shopStock.cards : [],
          upgrades: Array.isArray(working.shopStock.upgrades) ? working.shopStock.upgrades : []
        }
      : null,
    route: normalizeRouteState(working.route, safeEncIdx, inShop)
  };

  let pendingDraft = null;
  if (working.pendingDraft && typeof working.pendingDraft === "object") {
    const rawChoices = Array.isArray(working.pendingDraft.choices)
      ? working.pendingDraft.choices
      : (Array.isArray(working.pendingDraft.cards) ? working.pendingDraft.cards : []);
    const validChoices = rawChoices
      .map(item => (typeof item === "string" ? item : (item && item.id ? item.id : null)))
      .filter(id => typeof id === "string" && id.length > 0 && (typeof CARD_DB === "undefined" || CARD_DB[id]));
    if (validChoices.length > 0 || working.pendingDraft.resolved) {
      const encIdx = Number(working.pendingDraft.encounterIdx);
      pendingDraft = {
        choices: validChoices,
        encounterIdx: Number.isFinite(encIdx) && encIdx >= 0 ? Math.floor(encIdx) : safeEncIdx,
        resolved: Boolean(working.pendingDraft.resolved),
        skipped: Boolean(working.pendingDraft.skipped),
        selectedCardId: typeof working.pendingDraft.selectedCardId === "string" ? working.pendingDraft.selectedCardId : null
      };
    }
  }
  canonicalSave.pendingDraft = pendingDraft;
  const expectedChecksum = fallbackComputeSaveChecksum(canonicalSave);
  if (typeof working.saveIntegrity === "string" && working.saveIntegrity.length > 0) {
    const rawChecksum = fallbackComputeSaveChecksum(working);
    if (working.saveIntegrity !== expectedChecksum && working.saveIntegrity !== rawChecksum) {
      return {
        valid: false,
        status: "corrupt_checksum",
        error: "Save integrity check failed (corrupted or tampered save payload)."
      };
    }
  }
  canonicalSave.saveIntegrity = expectedChecksum;
  return {
    valid: true,
    status: migrated ? "migrated" : "ok",
    migrated,
    save: canonicalSave,
    summary: {
      archetype: matchedArch ? matchedArch.badge : canonicalSave.archetypeId,
      encounter: canonicalSave.encounterIdx + 1,
      playerLife: canonicalSave.playerLife,
      gold: canonicalSave.gold,
      deckSize: normalizedDeck.length,
      inShop
    }
  };
}

function deepCloneSaveData(val) {
  if (val === null || typeof val !== "object") return val;
  if (Array.isArray(val)) return val.map(deepCloneSaveData);
  const out = {};
  for (const k of Object.keys(val)) {
    out[k] = deepCloneSaveData(val[k]);
  }
  return out;
}

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
  fields.forEach(field => { snapshot[field] = deepCloneSaveData(state[field]); });
  return snapshot;
}

function restoreEncounterSaveSnapshot(snapshot) {
  if (!isValidEncounterSnapshot(snapshot)) {
    return false;
  }
  const cloned = deepCloneSaveData(snapshot);
  Object.keys(cloned).forEach(field => {
    if (field !== "uidCounter" && Object.prototype.hasOwnProperty.call(state, field)) {
      state[field] = cloned[field];
    }
  });
  if (Number.isInteger(cloned.uidCounter) && cloned.uidCounter > 0) {
    uidCounter = cloned.uidCounter;
  }
  state.runOver = false;
  state.combatLocked = false;
  return true;
}

function createFullRunSnapshot() {
  return {
    uidCounter,
    headless: state.headless,
    runOver: state.runOver,
    combatLocked: state.combatLocked,
    deckArchetype: state.deckArchetype,
    masterDeck: deepCloneSaveData(state.masterDeck),
    relics: deepCloneSaveData(state.relics),
    consumables: deepCloneSaveData(state.consumables),
    encounterIdx: state.encounterIdx,
    playerLife: state.playerLife,
    gold: state.gold,
    route: deepCloneSaveData(ensureRouteState()),
    shopStock: deepCloneSaveData(state.shopStock),
    pendingDraft: state.pendingDraft ? deepCloneSaveData(state.pendingDraft) : null,
    encounterState: createEncounterSaveSnapshot()
  };
}

function restoreFullRunSnapshot(fullSnapshot) {
  if (!fullSnapshot || typeof fullSnapshot !== "object") return false;
  state.headless = Boolean(fullSnapshot.headless);
  state.runOver = Boolean(fullSnapshot.runOver);
  state.combatLocked = Boolean(fullSnapshot.combatLocked);
  state.deckArchetype = fullSnapshot.deckArchetype || STARTER_DECKS[0];
  state.masterDeck = deepCloneSaveData(fullSnapshot.masterDeck || []);
  state.relics = deepCloneSaveData(fullSnapshot.relics || []);
  state.consumables = deepCloneSaveData(fullSnapshot.consumables || []);
  state.encounterIdx = Number(fullSnapshot.encounterIdx) || 0;
  state.playerLife = Number(fullSnapshot.playerLife) || START_LIFE;
  state.gold = Number(fullSnapshot.gold) || 0;
  state.route = normalizeRouteState(fullSnapshot.route, state.encounterIdx, false);
  state.shopStock = deepCloneSaveData(fullSnapshot.shopStock || { relics: [], cards: [], upgrades: [] });
  state.pendingDraft = fullSnapshot.pendingDraft ? deepCloneSaveData(fullSnapshot.pendingDraft) : null;
  if (state.pendingDraft && typeof state.pendingDraft === "object") {
    Object.defineProperty(state.pendingDraft, "cards", {
      get() {
        return (this.choices || []).map(id => (typeof id === "string" ? CARD_DB[id] : id)).filter(Boolean);
      },
      enumerable: false,
      configurable: true
    });
  }
  if (fullSnapshot.encounterState) {
    restoreEncounterSaveSnapshot(fullSnapshot.encounterState);
  }
  uidCounter = Number(fullSnapshot.uidCounter) || uidCounter;
  return true;
}

function createCanonicalSavePayload(inShop = false) {
  const rawPayload = {
    version: 1,
    savedAt: Date.now(),
    inShop: Boolean(inShop),
    archetypeId: (state.deckArchetype && state.deckArchetype.id) || STARTER_DECKS[0].id,
    encounterIdx: state.encounterIdx,
    playerLife: state.playerLife,
    gold: state.gold,
    masterDeck: state.masterDeck.map(c => ({
      id: c.id,
      foil: c.foil || null,
      permPowerBonus: c.permPowerBonus || 0,
      permToughnessBonus: c.permToughnessBonus || 0,
      keywords: [...(c.keywords || [])]
    })),
    relicIds: state.relics.map(r => r.id),
    relics: state.relics.map(r => ({ id: r.id })),
    consumableIds: state.consumables.map(s => s.id),
    encounterState: inShop ? null : createEncounterSaveSnapshot(),
    shopStock: inShop ? deepCloneSaveData(state.shopStock) : null,
    route: deepCloneSaveData(ensureRouteState()),
    pendingDraft: state.pendingDraft ? {
      choices: Array.isArray(state.pendingDraft.choices)
        ? [...state.pendingDraft.choices]
        : (Array.isArray(state.pendingDraft.cards) ? state.pendingDraft.cards.map(c => (typeof c === "string" ? c : c?.id)).filter(Boolean) : []),
      encounterIdx: Number(state.pendingDraft.encounterIdx) || state.encounterIdx,
      resolved: Boolean(state.pendingDraft.resolved),
      skipped: Boolean(state.pendingDraft.skipped),
      selectedCardId: state.pendingDraft.selectedCardId || null
    } : null
  };
  const check = normalizeCanonicalSave(rawPayload);
  return check.valid ? check.save : rawPayload;
}

function saveRunState(inShop = false) {
  const storage = getSafeLocalStorage();
  if (isHeadlessEnv() || !storage || typeof storage.setItem !== "function" || state.runOver) return false;
  try {
    // Preserve previous valid save as known-good backup before overwriting
    const existingRaw = typeof storage.getItem === "function" ? storage.getItem(SAVE_KEY) : null;
    if (existingRaw) {
      try {
        const existingCheck = normalizeCanonicalSave(JSON.parse(existingRaw));
        if (existingCheck.valid) {
          storage.setItem(SAVE_BACKUP_STORE_KEY, JSON.stringify(existingCheck.save));
        }
      } catch (_) {}
    }

    const payload = createCanonicalSavePayload(inShop);
    const serialized = JSON.stringify(payload);
    storage.setItem(SAVE_KEY, serialized);
    storage.setItem(SAVE_BACKUP_STORE_KEY, serialized);
    if (typeof DesktopBridge !== "undefined") {
      DesktopBridge.syncSaveToDisk(serialized);
    }
    state.lastSaveError = null;
    return true;
  } catch (error) {
    console.error("Unable to save the current run:", error);
    state.lastSaveError = String(error?.message || error);
    return false;
  }
}

function clearRunState() {
  const storage = getSafeLocalStorage();
  if (isHeadlessEnv() || !storage) return;
  try {
    if (typeof storage.removeItem === "function") {
      storage.removeItem(SAVE_KEY);
      storage.removeItem(SAVE_BACKUP_STORE_KEY);
    }
    if (typeof DesktopBridge !== "undefined") {
      DesktopBridge.clearDiskSave();
    }
  } catch (_) {}
}

function applyCanonicalSaveToState(saved, recoveredFromBackup = false) {
  const arch = STARTER_DECKS.find(d => d.id === saved.archetypeId) || STARTER_DECKS[0];
  state.deckArchetype = arch;
  state.encounterIdx = Number(saved.encounterIdx) || 0;
  state.playerLife = Math.min(MAX_LIFE, Math.max(1, Number(saved.playerLife) || START_LIFE));
  state.gold = Math.max(0, Number(saved.gold) || 0);
  state.runOver = false;
  state.combatLocked = false;
  state.route = normalizeRouteState(saved.route, state.encounterIdx, saved.inShop);

  if (saved.pendingDraft && typeof saved.pendingDraft === "object") {
    const rawChoices = Array.isArray(saved.pendingDraft.choices)
      ? saved.pendingDraft.choices
      : (Array.isArray(saved.pendingDraft.cards) ? saved.pendingDraft.cards : []);
    const validChoices = rawChoices
      .map(item => (typeof item === "string" ? item : (item && item.id ? item.id : null)))
      .filter(id => typeof id === "string" && id.length > 0 && (typeof CARD_DB === "undefined" || CARD_DB[id]));
    state.pendingDraft = {
      choices: validChoices,
      encounterIdx: Number.isFinite(Number(saved.pendingDraft.encounterIdx)) ? Math.floor(Number(saved.pendingDraft.encounterIdx)) : state.encounterIdx,
      resolved: Boolean(saved.pendingDraft.resolved),
      skipped: Boolean(saved.pendingDraft.skipped),
      selectedCardId: typeof saved.pendingDraft.selectedCardId === "string" ? saved.pendingDraft.selectedCardId : null
    };
    Object.defineProperty(state.pendingDraft, "cards", {
      get() {
        return (this.choices || []).map(id => (typeof id === "string" ? CARD_DB[id] : id)).filter(Boolean);
      },
      enumerable: false,
      configurable: true
    });
  } else {
    state.pendingDraft = null;
  }

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

  const relicIdList = Array.isArray(saved.relicIds)
    ? saved.relicIds
    : (Array.isArray(saved.relics) ? saved.relics.map(r => (typeof r === "string" ? r : r?.id)) : []);
  state.relics = relicIdList
    .map(id => RELIC_DB.find(r => r.id === id))
    .filter(Boolean)
    .map(r => ({ ...r }));

  const consumableIdList = Array.isArray(saved.consumableIds)
    ? saved.consumableIds
    : (Array.isArray(saved.consumables) ? saved.consumables.map(s => (typeof s === "string" ? s : s?.id)) : []);
  state.consumables = consumableIdList
    .map(id => CONSUMABLE_DB.find(s => s.id === id))
    .filter(Boolean)
    .map(s => ({ ...s, uid: nextUid() }));

  if (!saved.inShop) {
    if (state.pendingDraft && !state.pendingDraft.resolved) {
      state.enemyLife = 0;
      renderAll();
      if (!isHeadlessEnv() && typeof openDraftModal === "function") {
        openDraftModal(getCurrentEncounter());
      }
      return true;
    }
    if (!restoreEncounterSaveSnapshot(saved.encounterState)) {
      if (saved.encounterState) {
        console.warn("[MANASTORM Save] Encounter snapshot incomplete; restarting encounter with saved deck/relics.");
      }
      beginEncounter();
    }
  } else {
    if (!restoreEncounterSaveSnapshot(saved.encounterState)) {
      beginEncounter();
    }
    state.enemyLife = 0;
    if (saved.shopStock && typeof saved.shopStock === "object") {
      state.shopStock = {
        relics: (saved.shopStock.relics || []).map(r => {
          const def = RELIC_DB.find(d => d.id === r.id) || r;
          return { ...def, bought: Boolean(r.bought) };
        }),
        cards: (saved.shopStock.cards || []).map(it => ({
          card: it && it.card && CARD_DB[it.card.id] ? cloneCard(it.card.id) : cloneCard("evolving_wilds"),
          cost: (it && it.cost) || 3,
          bought: Boolean(it && it.bought)
        })),
        upgrades: Array.isArray(saved.shopStock.upgrades) ? saved.shopStock.upgrades : []
      };
      if (state.shopStock.upgrades.length === 0) {
        generateShopStock(false);
      }
    } else {
      generateShopStock(false);
    }

    const enc = getCurrentEncounter();
    renderShop();
    renderAll();
    if (state.pendingDraft && !state.pendingDraft.resolved) {
      if (typeof openDraftModal === "function") {
        openDraftModal(enc);
      }
    } else if (typeof openRestoredShopModal === "function") {
      openRestoredShopModal(enc);
    }
    saveRunState(true);
    return true;
  }

  const prefix = recoveredFromBackup ? "⚠️ Recovered from backup save: " : "";
  setLog(`${prefix}Restored saved run (${arch.badge}, Encounter ${state.encounterIdx + 1})!`);
  renderAll();
  if (!isHeadlessEnv() && state.route && state.route.pendingSelection && typeof openRouteModal === "function") {
    openRouteModal(true);
  }
  return true;
}

function logSaveWarn(...args) {
  if (typeof console !== "undefined") {
    const fn = console.warn || console.log;
    if (typeof fn === "function") fn.apply(console, args);
  }
}

function logSaveError(...args) {
  if (typeof console !== "undefined") {
    const fn = console.error || console.log;
    if (typeof fn === "function") fn.apply(console, args);
  }
}

function preserveCorruptPrimarySave(storage, rawString, reason) {
  if (!storage || !rawString) return;
  try {
    if (typeof DesktopBridge !== "undefined" && typeof DesktopBridge.preserveCorruptSave === "function") {
      DesktopBridge.preserveCorruptSave(rawString, reason || "localStorage");
    } else {
      storage.setItem(
        SAVE_CORRUPT_STORE_KEY,
        JSON.stringify({
          source: reason || "localStorage",
          preservedAt: new Date().toISOString(),
          raw: String(rawString)
        })
      );
    }
  } catch (_) {}
}

function loadRunState(options = {}) {
  const storage = getSafeLocalStorage();
  if ((isHeadlessEnv() && !options.allowHeadless) || !storage) return false;

  const preRestoreSnapshot = createFullRunSnapshot();

  const tryParseAndValidate = (rawStr) => {
    if (!rawStr || typeof rawStr !== "string") return { valid: false, status: "empty", error: "No save data." };
    try {
      const parsed = JSON.parse(rawStr);
      return normalizeCanonicalSave(parsed);
    } catch (err) {
      return { valid: false, status: "corrupt_json", error: `Corrupt JSON: ${err?.message || err}` };
    }
  };

  try {
    const rawPrimary = storage.getItem(SAVE_KEY);
    const rawBackup = storage.getItem(SAVE_BACKUP_STORE_KEY);

    if (!rawPrimary && !rawBackup) {
      return false;
    }

    if (rawPrimary) {
      const primaryCheck = tryParseAndValidate(rawPrimary);
      if (primaryCheck.valid) {
        const applied = applyCanonicalSaveToState(primaryCheck.save, false);
        if (applied) {
          const normalizedStr = JSON.stringify(primaryCheck.save);
          storage.setItem(SAVE_KEY, normalizedStr);
          storage.setItem(SAVE_BACKUP_STORE_KEY, normalizedStr);
          state.lastSaveError = null;
          return true;
        }
      } else {
        // Primary save failed validation: preserve corrupt payload and DO NOT overwrite backup!
        logSaveWarn(`[MANASTORM Save] Primary save failed validation (${primaryCheck.status}): ${primaryCheck.error}`);
        preserveCorruptPrimarySave(storage, rawPrimary, primaryCheck.status);
        state.lastSaveError = primaryCheck.error;
      }
    }

    // Recovery Path: Attempt to restore from known-good backup save
    if (rawBackup) {
      const backupCheck = tryParseAndValidate(rawBackup);
      if (backupCheck.valid) {
        logSaveWarn("[MANASTORM Save] Recovering run state from last known-good backup save.");
        const applied = applyCanonicalSaveToState(backupCheck.save, true);
        if (applied) {
          const normalizedBackup = JSON.stringify(backupCheck.save);
          storage.setItem(SAVE_KEY, normalizedBackup);
          if (typeof DesktopBridge !== "undefined") {
            DesktopBridge.syncSaveToDisk(normalizedBackup);
          }
          return true;
        }
      } else {
        logSaveError(`[MANASTORM Save] Backup save also failed validation (${backupCheck.status}): ${backupCheck.error}`);
      }
    }

    // UI-safe fallback when restore fails: roll back partial state mutation and notify player
    restoreFullRunSnapshot(preRestoreSnapshot);
    setLog("⚠️ Saved run could not be restored (corrupt data preserved). Starting safe fallback state.");
    return false;
  } catch (error) {
    logSaveError("Unable to restore the saved run:", error);
    restoreFullRunSnapshot(preRestoreSnapshot);
    state.lastSaveError = String(error?.message || error);
    setLog("⚠️ Saved run could not be restored due to an unexpected error.");
    return false;
  }
}

const GameState = {
  getState: () => state,
  ensureRouteState,
  getCurrentRouteNode,
  getAvailableNextRouteNodes,
  canSelectRouteNode,
  selectRouteNode,
  createEncounterSaveSnapshot,
  restoreEncounterSaveSnapshot,
  createFullRunSnapshot,
  restoreFullRunSnapshot,
  createCanonicalSavePayload,
  normalizeCanonicalSave,
  saveRunState,
  loadRunState,
  clearRunState,
  isCardLegalForDeck,
  sampleDraftPool,
  generateDraftRewardPool,
  selectDraftCard,
  skipDraft
};

if (typeof globalThis !== "undefined") {
  globalThis.GameState = GameState;
  globalThis.normalizeCanonicalSave = normalizeCanonicalSave;
  globalThis.createCanonicalSavePayload = createCanonicalSavePayload;
  globalThis.createFullRunSnapshot = createFullRunSnapshot;
  globalThis.restoreFullRunSnapshot = restoreFullRunSnapshot;
  globalThis.isCardLegalForDeck = isCardLegalForDeck;
  globalThis.sampleDraftPool = sampleDraftPool;
  globalThis.generateDraftRewardPool = generateDraftRewardPool;
  globalThis.selectDraftCard = selectDraftCard;
  globalThis.skipDraft = skipDraft;
  if (!globalThis.SAVE_BACKUP_KEY) globalThis.SAVE_BACKUP_KEY = SAVE_BACKUP_STORE_KEY;
  if (!globalThis.SAVE_CORRUPT_KEY) globalThis.SAVE_CORRUPT_KEY = SAVE_CORRUPT_STORE_KEY;
}

async function bootstrapGame() {
  initEvents();
  let restored = false;
  if (typeof DesktopBridge !== "undefined" && typeof DesktopBridge.init === "function") {
    const initRes = await DesktopBridge.init();
    restored = Boolean(initRes && initRes.restoredFromDisk);
  }
  if (!restored) {
    restored = loadRunState();
  }
  if (!restored && (!state.masterDeck || state.masterDeck.length === 0)) {
    startNewRun(STARTER_DECKS[0]);
  } else {
    renderAll();
  }
}

if (typeof window !== "undefined" && typeof window.addEventListener === "function") {
  window.addEventListener("DOMContentLoaded", () => {
    bootstrapGame();
  });
}
