// MANASTORM — Core Game State, Turn Loop, Card Effects, Shop & LocalStorage Persistence

const SAVE_KEY = "manastorm_saved_run_v1";
const SAVE_BACKUP_STORE_KEY = typeof SAVE_BACKUP_KEY !== "undefined" ? SAVE_BACKUP_KEY : "manastorm_saved_run_backup_v1";
const SAVE_CORRUPT_STORE_KEY = typeof SAVE_CORRUPT_KEY !== "undefined" ? SAVE_CORRUPT_KEY : "manastorm_saved_run_corrupt_v1";
const RUN_HISTORY_KEY = "manastorm_run_history_v1";
const RUN_HISTORY_VERSION = 1;
const MAX_RUN_HISTORY_ENTRIES = 25;
const GAME_PROFILE_KEY = "manastorm_profile_v1";
const GAME_PROFILE_VERSION = 1;
const MAX_PROFILE_RUN_IDS = 100;

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
  playerPermanents: [],
  enemyCreatures: [],
  relics: [],
  consumables: [],

  encounterIdx: 0,
  enemyLife: 30,
  enemyMaxLife: 30,
  playerLife: START_LIFE,
  gold: 6,
  runSeed: null,
  rngState: null,
  runId: null,
  runStartedAt: null,
  runHistoryRecorded: false,
  runTurns: 0,
  runHistoryError: null,
  profileError: null,

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
  challengeId: "standard",
  campaignId: DEFAULT_CAMPAIGN_ID,
  ascensionLevel: 0,
  route: null,
  pendingDraft: null,
  pendingBossRelic: null,
  lastSaveError: null
};

let uidCounter = 1;
function nextUid() {
  return `uid_${uidCounter++}`;
}

function createRunId() {
  return `run-${Date.now().toString(36)}-${nextUid()}`;
}

function normalizeRunHistoryRecord(raw) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  if (
    typeof raw.runId !== "string" ||
    raw.runId.length === 0 ||
    !["victory", "defeat"].includes(raw.outcome) ||
    typeof raw.deckId !== "string" ||
    typeof raw.deckName !== "string" ||
    typeof raw.finalEncounter !== "string" ||
    !Array.isArray(raw.routeNodeIds) ||
    !Array.isArray(raw.relicIds)
  ) {
    return null;
  }

  const completedAt = Number(raw.completedAt);
  const startedAt = Number(raw.startedAt);
  const turns = Number(raw.turns);
  const life = Number(raw.life);
  const gold = Number(raw.gold);
  const loop = Number(raw.loop);
  if (
    !Number.isFinite(completedAt) || completedAt <= 0 ||
    !Number.isFinite(startedAt) || startedAt <= 0 ||
    !Number.isInteger(turns) || turns < 0 ||
    !Number.isFinite(life) || life < 0 ||
    !Number.isFinite(gold) || gold < 0 ||
    !Number.isInteger(loop) || loop < 0
  ) {
    return null;
  }

  const routeNodeIds = raw.routeNodeIds
    .filter(id => typeof id === "string" && id.length > 0 && id.length <= 100)
    .slice(0, 32);
  const relicIds = raw.relicIds
    .filter(id => typeof id === "string" && id.length > 0 && id.length <= 100)
    .slice(0, 20);
  const runSeed = normalizeRunSeed(raw.runSeed);
  return {
    runId: raw.runId.slice(0, 120),
    startedAt,
    completedAt,
    outcome: raw.outcome,
    deckId: raw.deckId.slice(0, 100),
    deckName: raw.deckName.slice(0, 160),
    campaignId: normalizeCampaignId(raw.campaignId),
    challengeId: normalizeRunChallengeId(raw.challengeId),
    runSeed,
    finalEncounter: raw.finalEncounter.slice(0, 160),
    routeNodeIds,
    relicIds,
    turns,
    life,
    gold,
    loop
  };
}

function readRunHistory() {
  const storage = getSafeLocalStorage();
  if (!storage || typeof storage.getItem !== "function") {
    return { ok: false, entries: [], error: "Run history storage is unavailable." };
  }

  let serialized;
  try {
    serialized = storage.getItem(RUN_HISTORY_KEY);
  } catch (error) {
    return { ok: false, entries: [], error: `Unable to read run history: ${error?.message || error}` };
  }
  if (serialized === null || serialized === undefined || serialized === "") {
    return { ok: true, entries: [] };
  }

  let parsed;
  try {
    parsed = JSON.parse(serialized);
  } catch (error) {
    return { ok: false, entries: [], error: `Run history data is corrupt: ${error?.message || error}` };
  }
  if (!parsed || typeof parsed !== "object" || parsed.version !== RUN_HISTORY_VERSION || !Array.isArray(parsed.entries)) {
    return { ok: false, entries: [], error: "Run history has an unsupported or invalid format." };
  }

  const entries = parsed.entries.map(normalizeRunHistoryRecord);
  if (entries.some(entry => !entry)) {
    return { ok: false, entries: [], error: "Run history contains an invalid entry; existing data was left unchanged." };
  }
  return { ok: true, entries: entries.slice(0, MAX_RUN_HISTORY_ENTRIES) };
}

function recordCompletedRun(outcome) {
  if (!["victory", "defeat"].includes(outcome)) {
    return { ok: false, error: `Unknown run outcome "${String(outcome)}".` };
  }
  if (state.runHistoryRecorded) return { ok: true, duplicate: true };
  if (!state.runId) state.runId = createRunId();
  if (!Number.isFinite(Number(state.runStartedAt)) || Number(state.runStartedAt) <= 0) {
    state.runStartedAt = Date.now();
  }

  const currentHistory = readRunHistory();
  if (!currentHistory.ok) {
    state.runHistoryError = currentHistory.error;
    return { ok: false, error: currentHistory.error };
  }
  if (currentHistory.entries.some(entry => entry.runId === state.runId)) {
    state.runHistoryRecorded = true;
    state.runHistoryError = null;
    return { ok: true, duplicate: true };
  }

  const campaign = getActiveCampaign();
  const encounter = getCurrentEncounter();
  const route = ensureRouteState();
  const record = normalizeRunHistoryRecord({
    runId: state.runId,
    startedAt: state.runStartedAt,
    completedAt: Date.now(),
    outcome,
    deckId: state.deckArchetype?.id || STARTER_DECKS[0].id,
    deckName: state.deckArchetype?.name || STARTER_DECKS[0].name,
    campaignId: getActiveCampaignId(),
    challengeId: state.challengeId,
    runSeed: state.runSeed,
    finalEncounter: encounter ? encounter.name : "Unknown Encounter",
    routeNodeIds: route.visitedNodeIds,
    relicIds: state.relics.map(relic => relic.id),
    turns: state.runTurns,
    life: state.playerLife,
    gold: state.gold,
    loop: route.loop || 0,
    campaignName: campaign?.name
  });
  if (!record) {
    state.runHistoryError = "Unable to create a valid run history record.";
    return { ok: false, error: state.runHistoryError };
  }

  const nextHistory = {
    version: RUN_HISTORY_VERSION,
    entries: [record, ...currentHistory.entries].slice(0, MAX_RUN_HISTORY_ENTRIES)
  };
  const storage = getSafeLocalStorage();
  try {
    if (!storage || typeof storage.setItem !== "function") {
      throw new Error("Run history storage is unavailable.");
    }
    storage.setItem(RUN_HISTORY_KEY, JSON.stringify(nextHistory));
  } catch (error) {
    state.runHistoryError = `Unable to save run history: ${error?.message || error}`;
    return { ok: false, error: state.runHistoryError };
  }

  state.runHistoryRecorded = true;
  state.runHistoryError = null;
  return { ok: true, record };
}

function getDefaultGameProfile() {
  return {
    version: GAME_PROFILE_VERSION,
    unlockedStarterDeckIds: [...UNLOCKED_STARTER_DECK_IDS],
    campaignClears: 0,
    processedVictoryRunIds: [],
    deckMastery: {}
  };
}

function normalizeGameProfile(raw) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return { ok: false, error: "Profile data is not an object." };
  }

  let campaignClears;
  let savedDeckIds;
  let processedRunIds;
  let migrated = false;
  if (
    raw.version === 0 &&
    Array.isArray(raw.unlockedDeckIds) &&
    Number.isInteger(Number(raw.campaignWins)) &&
    Number(raw.campaignWins) >= 0
  ) {
    campaignClears = Number(raw.campaignWins);
    savedDeckIds = raw.unlockedDeckIds;
    processedRunIds = [];
    migrated = true;
  } else if (raw.version === GAME_PROFILE_VERSION) {
    campaignClears = Number(raw.campaignClears);
    savedDeckIds = raw.unlockedStarterDeckIds;
    processedRunIds = raw.processedVictoryRunIds;
  } else {
    return { ok: false, error: `Unsupported profile version "${String(raw.version)}".` };
  }

  if (
    !Number.isInteger(campaignClears) ||
    campaignClears < 0 ||
    !Array.isArray(savedDeckIds) ||
    !Array.isArray(processedRunIds)
  ) {
    return { ok: false, error: "Profile data contains invalid unlock progress." };
  }

  const unlocked = new Set(UNLOCKED_STARTER_DECK_IDS);
  for (const id of savedDeckIds) {
    if (typeof id === "string" && STARTER_DECKS.some(deck => deck.id === id)) {
      unlocked.add(id);
    }
  }
  for (const [deckId, requirement] of Object.entries(STARTER_DECK_UNLOCK_REQUIREMENTS)) {
    if (campaignClears < requirement.campaignClears) unlocked.delete(deckId);
    else unlocked.add(deckId);
  }

  const rawMastery = raw.deckMastery && typeof raw.deckMastery === "object" && !Array.isArray(raw.deckMastery)
    ? raw.deckMastery
    : {};
  const deckMastery = {};
  for (const [dId, rank] of Object.entries(rawMastery)) {
    if (STARTER_DECKS.some(d => d.id === dId)) {
      const safeRank = Math.max(0, Math.min(5, Math.floor(Number(rank) || 0)));
      if (safeRank > 0) deckMastery[dId] = safeRank;
    }
  }

  return {
    ok: true,
    migrated,
    profile: {
      version: GAME_PROFILE_VERSION,
      unlockedStarterDeckIds: [...unlocked],
      campaignClears,
      processedVictoryRunIds: processedRunIds
        .filter(runId => typeof runId === "string" && runId.length > 0 && runId.length <= 120)
        .slice(-MAX_PROFILE_RUN_IDS),
      deckMastery
    }
  };
}

function readGameProfile() {
  const storage = getSafeLocalStorage();
  if (!storage || typeof storage.getItem !== "function") {
    return { ok: false, profile: getDefaultGameProfile(), error: "Profile storage is unavailable." };
  }

  let serialized;
  try {
    serialized = storage.getItem(GAME_PROFILE_KEY);
  } catch (error) {
    return { ok: false, profile: getDefaultGameProfile(), error: `Unable to read profile: ${error?.message || error}` };
  }
  if (serialized === null || serialized === undefined || serialized === "") {
    return { ok: true, profile: getDefaultGameProfile(), exists: false };
  }

  let parsed;
  try {
    parsed = JSON.parse(serialized);
  } catch (error) {
    return { ok: false, profile: getDefaultGameProfile(), error: `Profile data is corrupt: ${error?.message || error}` };
  }
  const normalized = normalizeGameProfile(parsed);
  if (!normalized.ok) {
    return { ok: false, profile: getDefaultGameProfile(), error: normalized.error };
  }
  if (normalized.migrated) {
    const saved = writeGameProfile(normalized.profile);
    if (!saved.ok) {
      return { ok: false, profile: normalized.profile, error: saved.error };
    }
  }
  return { ok: true, profile: normalized.profile, exists: true, migrated: normalized.migrated === true };
}

function writeGameProfile(profile) {
  const normalized = normalizeGameProfile(profile);
  if (!normalized.ok) return normalized;
  const storage = getSafeLocalStorage();
  if (!storage || typeof storage.setItem !== "function") {
    return { ok: false, error: "Profile storage is unavailable." };
  }
  try {
    storage.setItem(GAME_PROFILE_KEY, JSON.stringify(normalized.profile));
  } catch (error) {
    return { ok: false, error: `Unable to save profile: ${error?.message || error}` };
  }
  return { ok: true, profile: normalized.profile };
}

function isStarterDeckUnlockedInProfile(deckId) {
  const profile = readGameProfile();
  return profile.ok && profile.profile.unlockedStarterDeckIds.includes(deckId);
}

function getStarterDeckProgressMessage() {
  const result = readGameProfile();
  if (!result.ok) {
    return `Persistent unlocks are unavailable: ${result.error} Locked decks remain unavailable.`;
  }
  if (state.profileError) {
    return `Profile progress could not be saved: ${state.profileError}`;
  }
  const lockedDeck = Object.entries(STARTER_DECK_UNLOCK_REQUIREMENTS)
    .find(([deckId]) => !result.profile.unlockedStarterDeckIds.includes(deckId));
  if (!lockedDeck) {
    return `${result.profile.campaignClears} campaign clear${result.profile.campaignClears === 1 ? "" : "s"} recorded. All starter decks unlocked.`;
  }
  const [deckId, requirement] = lockedDeck;
  const progress = Math.min(result.profile.campaignClears, requirement.campaignClears);
  const deck = STARTER_DECKS.find(item => item.id === deckId);
  return `Campaign clears: ${progress}/${requirement.campaignClears} — ${requirement.description} to unlock ${deck?.name || deckId}.`;
}

function getDeckMasteryRank(deckId) {
  const res = readGameProfile();
  if (!res.ok || !res.profile || !res.profile.deckMastery) return 0;
  return Number(res.profile.deckMastery[deckId]) || 0;
}

function getMaxUnlockedAscension() {
  const res = readGameProfile();
  const clears = res.ok && res.profile ? (res.profile.campaignClears || 0) : 0;
  const maxLvl = typeof ASCENSION_LEVELS !== "undefined" ? ASCENSION_LEVELS.length - 1 : 0;
  return Math.max(0, Math.min(maxLvl, clears));
}

function getCurrentEndlessLoop() {
  const encounters = getActiveCampaignEncounters();
  const count = encounters.length || 6;
  return Math.max(0, Math.floor(state.encounterIdx / count));
}

function getShopRerollCost() {
  let cost = 2;
  const mutators = typeof getActiveEndlessMutators === "function"
    ? getActiveEndlessMutators(getCurrentEndlessLoop())
    : [];
  if (mutators.some(m => m.id === "aether_inflation")) {
    cost += 1;
  }
  if (typeof getRelicShopRerollPenalty === "function") {
    cost += getRelicShopRerollPenalty();
  }
  return cost;
}

function recordCampaignClear(runId = state.runId) {
  const existing = readGameProfile();
  if (!existing.ok) {
    if (state.headless && existing.error === "Profile storage is unavailable.") {
      return { ok: true, skipped: true };
    }
    state.profileError = existing.error;
    return { ok: false, error: existing.error };
  }
  if (runId && existing.profile.processedVictoryRunIds.includes(runId)) {
    state.profileError = null;
    return { ok: true, duplicate: true };
  }

  const deckId = state.deckArchetype?.id;
  const nextMastery = { ...(existing.profile.deckMastery || {}) };
  if (deckId && STARTER_DECKS.some(d => d.id === deckId)) {
    nextMastery[deckId] = Math.min(5, (Number(nextMastery[deckId]) || 0) + 1);
  }

  const nextProfile = {
    ...existing.profile,
    campaignClears: existing.profile.campaignClears + 1,
    processedVictoryRunIds: [
      ...existing.profile.processedVictoryRunIds,
      ...(runId ? [runId] : [])
    ].slice(-MAX_PROFILE_RUN_IDS),
    deckMastery: nextMastery
  };
  let newlyUnlockedDeckId = null;
  for (const [deckId, requirement] of Object.entries(STARTER_DECK_UNLOCK_REQUIREMENTS)) {
    if (
      nextProfile.campaignClears >= requirement.campaignClears &&
      !nextProfile.unlockedStarterDeckIds.includes(deckId)
    ) {
      nextProfile.unlockedStarterDeckIds.push(deckId);
      newlyUnlockedDeckId = newlyUnlockedDeckId || deckId;
    }
  }

  const saved = writeGameProfile(nextProfile);
  if (!saved.ok) {
    state.profileError = saved.error;
    return { ok: false, error: saved.error };
  }
  state.profileError = null;
  return { ok: true, newlyUnlockedDeckId };
}

function recordCombatEvent(type, message, details = {}) {
  if (typeof emitCombatLogEvent === "function") {
    return emitCombatLogEvent(type, message, details);
  }
  return null;
}

function addResonance(amount, label = "Trigger") {
  if (!amount) return;
  state.turnResonance += amount;
  recordCombatEvent("trigger", `${label}: +${amount} resonance`, { label, amount, resource: "resonance" });
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
  recordCombatEvent("trigger", `${label}: resonance ×${factor} (${delta >= 0 ? "+" : ""}${delta})`, {
    label,
    factor,
    delta,
    resource: "resonance"
  });
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
  recordCombatEvent("trigger", `${label}: +${amount} burn power`, { label, amount, resource: "burn" });
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
  if (actual > 0) {
    recordCombatEvent("trigger", `${sourceLabel}: restored ${actual} Life`, { sourceLabel, amount: actual, resource: "life" });
  }
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
  if (card && card.type === "Creature" && Array.isArray(state.playerPermanents)) {
    state.playerPermanents.forEach(p => {
      if (p && p.permanentEffect === "altar_of_ash") {
        addResonance(1, "Ashvein Altar");
        addBurnPower(2, "Ashvein Altar");
        spawnFx("Ashvein Altar: +1 Mult & +2 Burn!", "#a4b0be");
      }
    });
  }
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

const GENERATED_CARD_VERSION = 1;
const GENERATED_CARD_KEYWORDS = ["Deathtouch", "Flying", "Haste", "Lifelink", "Trample"];
const GENERATED_CARD_NAMES = ["Ashen", "Dawn", "Ember", "Moss", "Rift", "Storm", "Thorn", "Verdant"];
const GENERATED_CARD_SUBTYPES = ["Beast", "Elemental", "Knight", "Rogue", "Scout", "Warrior"];
const GENERATED_CARD_COLORS = [...COLORS, "C"];

function generatedRandom(seed) {
  let value = seed >>> 0;
  return () => {
    value = (value + 0x6D2B79F5) >>> 0;
    let t = value;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function createGeneratedCreatureCard(seed, deckColors = COLORS) {
  const safeSeed = Number(seed) >>> 0;
  const sourceColors = deckColors instanceof Set ? [...deckColors] : deckColors;
  if (!Array.isArray(sourceColors)) return null;
  const colors = sourceColors.filter(color => GENERATED_CARD_COLORS.includes(color));
  if (!Number.isInteger(Number(seed)) || colors.length === 0) return null;

  const rng = generatedRandom(safeSeed);
  const choose = list => list[Math.floor(rng() * list.length)];
  const color = choose([...new Set(colors)]);
  const manaValue = 1 + Math.floor(rng() * 3);
  const keyword = choose(GENERATED_CARD_KEYWORDS);
  const keywordCost = keyword === "Flying" || keyword === "Deathtouch" || keyword === "Lifelink" ? 1 : 0;
  const totalStats = Math.max(2, manaValue * 2 + 1 - keywordCost);
  const power = 1 + Math.floor(rng() * Math.max(1, totalStats - 1));
  const toughness = Math.max(1, totalStats - power);
  const prefix = choose(GENERATED_CARD_NAMES);
  const subtype = choose(GENERATED_CARD_SUBTYPES);

  return {
    id: `generated_${safeSeed.toString(36)}`,
    name: `${prefix} ${subtype}`,
    type: "Creature",
    subtype,
    color,
    manaCost: manaValue === 1 ? `{${color}}` : `{${manaValue - 1}}{${color}}`,
    power,
    toughness,
    keywords: [keyword],
    rules: `${keyword}.`,
    produces: [],
    generated: true,
    generatedVersion: GENERATED_CARD_VERSION,
    generatedSeed: safeSeed
  };
}

function normalizeGeneratedCardDefinition(raw) {
  if (!raw || typeof raw !== "object" || raw.generated !== true) return null;
  const generated = createGeneratedCreatureCard(raw.generatedSeed, [raw.color]);
  if (!generated || raw.generatedVersion !== GENERATED_CARD_VERSION || raw.id !== generated.id) return null;
  const fields = ["name", "type", "subtype", "color", "manaCost", "power", "toughness", "rules"];
  if (fields.some(field => raw[field] !== generated[field])) return null;
  if (!Array.isArray(raw.keywords) || raw.keywords.length !== 1 || raw.keywords[0] !== generated.keywords[0]) return null;
  return generated;
}

function getGeneratedCardDefinition(card) {
  if (!card || card.generated !== true) return null;
  const definition = createGeneratedCreatureCard(card.generatedSeed, [card.color]);
  return definition && definition.id === card.id ? definition : null;
}

function cloneCard(cardId) {
  const base = typeof cardId === "object" && cardId
    ? normalizeGeneratedCardDefinition(cardId) ||
      (typeof normalizeFusedLandDefinition === "function" ? normalizeFusedLandDefinition(cardId) : null) ||
      CARD_DB[cardId.id]
    : CARD_DB[cardId];
  if (!base) return null;
  return {
    ...base,
    uid: nextUid(),
    keywords: [...(base.keywords || [])],
    produces: [...(base.produces || [])],
    ...(Array.isArray(base.fusedColors) ? { fusedColors: [...base.fusedColors] } : {}),
    foil: null,
    landEnhancement: null,
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

const MAX_RUN_SEED_LENGTH = 64;

function normalizeRunSeed(seed) {
  if (seed === null || seed === undefined) return null;
  const normalized = String(seed).trim();
  return normalized.length > 0 && normalized.length <= MAX_RUN_SEED_LENGTH ? normalized : null;
}

function isValidRunSeedInput(seed) {
  return seed === null || seed === undefined || String(seed).trim().length === 0 ||
    normalizeRunSeed(seed) !== null;
}

function hashRunSeed(seed) {
  const text = String(seed);
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash || 0x6d2b79f5;
}

function normalizeSavedRngState(seed, rngState) {
  const normalizedSeed = normalizeRunSeed(seed);
  if (!normalizedSeed) return null;
  const numericState = Number(rngState);
  return Number.isInteger(numericState) && numericState > 0 && numericState <= 0xffffffff
    ? numericState >>> 0
    : hashRunSeed(normalizedSeed);
}

function getDailyRunSeed(today = new Date()) {
  const date = today instanceof Date ? today : new Date(today);
  if (!Number.isFinite(date.getTime())) return null;
  return `daily-${date.toISOString().slice(0, 10)}`;
}

function gameRandom() {
  if (!state.runSeed) return Math.random();
  let value = normalizeSavedRngState(state.runSeed, state.rngState);
  value ^= value << 13;
  value ^= value >>> 17;
  value ^= value << 5;
  state.rngState = value >>> 0;
  return state.rngState / 0x100000000;
}

function shuffle(arr) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(gameRandom() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

// === INITIALIZATION & RUN START ===
function getActiveCampaignId() {
  return typeof normalizeCampaignId === "function"
    ? normalizeCampaignId(state.campaignId)
    : DEFAULT_CAMPAIGN_ID;
}

function getActiveCampaign() {
  return typeof getCampaignById === "function" ? getCampaignById(getActiveCampaignId()) : null;
}

function getActiveCampaignEncounters() {
  return typeof getCampaignEncounters === "function"
    ? getCampaignEncounters(getActiveCampaignId())
    : ENCOUNTERS;
}

function getActiveCampaignRouteNodes() {
  return typeof getCampaignRouteNodes === "function"
    ? getCampaignRouteNodes(getActiveCampaignId())
    : CAMPAIGN_ROUTE_NODES;
}

function createInitialRouteState(loop = 0, campaignId = getActiveCampaignId()) {
  const routeNodes = typeof getCampaignRouteNodes === "function"
    ? getCampaignRouteNodes(campaignId)
    : CAMPAIGN_ROUTE_NODES;
  const startNode = routeNodes && routeNodes[0]
    ? routeNodes[0]
    : { id: "p1_start" };
  return {
    loop: Math.max(0, Math.floor(Number(loop) || 0)),
    currentNodeId: startNode.id,
    completedNodeIds: [],
    visitedNodeIds: [startNode.id],
    pendingEventId: null,
    pendingSelection: false,
    lastActivitySummary: null
  };
}

function getRouteNodeById(nodeId) {
  const routeNodes = getActiveCampaignRouteNodes();
  if (!nodeId || !Array.isArray(routeNodes)) {
    return null;
  }
  return routeNodes.find(n => n.id === nodeId) || null;
}

function ensureRouteState() {
  if (!state.route || typeof state.route !== "object" || !getRouteNodeById(state.route.currentNodeId)) {
    const encounters = getActiveCampaignEncounters();
    state.route = createInitialRouteState(
      Math.floor((Number(state.encounterIdx) || 0) / encounters.length),
      getActiveCampaignId()
    );
  }
  if (!Array.isArray(state.route.completedNodeIds)) state.route.completedNodeIds = [];
  if (!Array.isArray(state.route.visitedNodeIds)) state.route.visitedNodeIds = [state.route.currentNodeId];
  const currentNode = getRouteNodeById(state.route.currentNodeId);
  if (currentNode && currentNode.type === "event" && !state.route.completedNodeIds.includes(currentNode.id)) {
    state.route.pendingEventId = currentNode.id;
  } else {
    state.route.pendingEventId = null;
  }
  return state.route;
}

function getCurrentRouteNode() {
  const route = ensureRouteState();
  const routeNodes = getActiveCampaignRouteNodes();
  return getRouteNodeById(route.currentNodeId) || (Array.isArray(routeNodes) ? routeNodes[0] : null);
}

function completeCurrentRouteNode() {
  const route = ensureRouteState();
  const current = getCurrentRouteNode();
  if (current && current.type === "event" && route.pendingEventId === current.id) return false;
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
  if (!node || getRouteNodeById(node.id) !== node) {
    return { ok: false, reason: "invalid_node" };
  }
  if (route.completedNodeIds.includes(node.id)) {
    return { ok: false, reason: "already_completed" };
  }
  if (route.currentNodeId !== node.id) {
    return { ok: false, reason: "not_current" };
  }
  if (node.type === "event") {
    return { ok: false, reason: "event_requires_choice" };
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
      const def = CONSUMABLE_DB[Math.floor(gameRandom() * CONSUMABLE_DB.length)];
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
    if (node.type === "rest" && !isHeadlessEnv() && typeof openRestLandWorkshopModal === "function") {
      openRestLandWorkshopModal(node);
    }
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

  const loopOffset = (route.loop || 0) * getActiveCampaignEncounters().length;
  if (typeof node.encounterIdx === "number") {
    state.encounterIdx = loopOffset + node.encounterIdx;
  }

  if (node.type === "fight" || node.type === "elite" || node.type === "boss") {
    route.lastActivitySummary = null;
    beginEncounter();
    saveRunState(false);
    return true;
  }

  if (node.type === "event") {
    route.pendingEventId = node.id;
    route.lastActivitySummary = null;
    saveRunState(false);
    return true;
  }

  resolveNonCombatRouteNode(node);
  return true;
}

function getRouteEventChoiceStatus(choiceId) {
  const route = ensureRouteState();
  const node = getRouteNodeById(route.pendingEventId);
  if (!node || node.type !== "event" || node.id !== route.currentNodeId) {
    return { available: false, reason: "No Planar Event choice is pending.", choice: null };
  }
  if (route.completedNodeIds.includes(node.id)) {
    return { available: false, reason: "This Planar Event has already been resolved.", choice: null };
  }

  const choice = Array.isArray(node.choices) ? node.choices.find(item => item.id === choiceId) : null;
  if (!choice) {
    return { available: false, reason: "That Planar Event choice is unavailable.", choice: null };
  }

  const requirements = choice.requires || {};
  if (typeof requirements.lifeAbove === "number" && state.playerLife <= requirements.lifeAbove) {
    return {
      available: false,
      reason: `Requires more than ${requirements.lifeAbove} Life.`,
      choice
    };
  }
  if (typeof requirements.minGold === "number" && state.gold < requirements.minGold) {
    return {
      available: false,
      reason: `Requires at least $${requirements.minGold} Gold.`,
      choice
    };
  }
  if (requirements.missingLife && state.playerLife >= MAX_LIFE) {
    return { available: false, reason: "Already at maximum Life.", choice };
  }
  return { available: true, reason: null, choice };
}

function resolveRouteEventChoice(eventId, choiceId) {
  const route = ensureRouteState();
  if (route.pendingEventId !== eventId || route.currentNodeId !== eventId) {
    return { ok: false, reason: "event_not_pending" };
  }

  const status = getRouteEventChoiceStatus(choiceId);
  if (!status.available) return { ok: false, reason: status.reason, choice: status.choice };

  const node = getRouteNodeById(eventId);
  const choice = status.choice;
  if (!node || !choice || route.completedNodeIds.includes(node.id)) {
    return { ok: false, reason: "already_resolved" };
  }

  if (choice.effect === "life_for_gold") {
    state.playerLife -= choice.lifeCost;
    state.gold += choice.goldGain;
  } else if (choice.effect === "gold_for_life") {
    state.gold -= choice.goldCost;
    gainLife(choice.healAmount, node.title);
  } else if (choice.effect !== "leave") {
    return { ok: false, reason: "unsupported_effect" };
  }

  route.completedNodeIds.push(node.id);
  route.pendingEventId = null;
  route.pendingSelection = Boolean(node.next && node.next.length > 0);
  const summaryText = choice.effect === "life_for_gold"
    ? `-${choice.lifeCost} Life, +$${choice.goldGain} Gold`
    : (choice.effect === "gold_for_life"
      ? `-$${choice.goldCost} Gold, restored up to +${choice.healAmount} Life`
      : "No reward or cost");
  route.lastActivitySummary = `${node.title} — ${choice.title}: ${summaryText}`;

  saveRunState(false);
  renderAll();
  setLog(`${node.title}: ${choice.title} (${summaryText}). Choose your next stop on the Planar Route.`);
  spawnFx(`${choice.title}: ${summaryText}`, choice.effect === "life_for_gold" ? "#ffbe3b" : "#26d07c");
  return { ok: true, node, choice, summaryText };
}

function advanceToNextLoopRoute() {
  const encounterCount = getActiveCampaignEncounters().length;
  const currentLoop = state.route && typeof state.route.loop === "number"
    ? state.route.loop + 1
    : Math.floor(state.encounterIdx / encounterCount) + 1;
  state.route = createInitialRouteState(currentLoop, getActiveCampaignId());
  state.encounterIdx = currentLoop * encounterCount;
  state.runId = createRunId();
  state.runStartedAt = Date.now();
  state.runHistoryRecorded = false;
  state.runTurns = 0;
  state.runHistoryError = null;
  beginEncounter();
  saveRunState(false);
}

function startNewRun(
  deckConfig = STARTER_DECKS[0],
  challengeId = "standard",
  campaignId = DEFAULT_CAMPAIGN_ID,
  seed = null,
  options = {}
) {
  const knownDeck = STARTER_DECKS.find(deck => deck.id === deckConfig?.id);
  if (!knownDeck) {
    setLog("Unable to start run: unknown starter deck.");
    return false;
  }
  if (!isStarterDeckAvailable(knownDeck.id) && options?.allowLockedDeck !== true) {
    setLog(`Unable to start run: ${knownDeck.name} is locked. ${STARTER_DECK_UNLOCK_REQUIREMENTS[knownDeck.id]?.description || "Unlock it first"}.`);
    return false;
  }
  deckConfig = knownDeck;
  const challenge = RUN_CHALLENGES.find(item => item.id === challengeId);
  if (!challenge) {
    setLog(`Unable to start run: unknown challenge "${String(challengeId)}".`);
    return false;
  }
  const campaign = CAMPAIGN_DEFINITIONS.find(item => item.id === campaignId);
  if (!campaign) {
    setLog(`Unable to start run: unknown campaign "${String(campaignId)}".`);
    return false;
  }
  if (!isValidRunSeedInput(seed)) {
    setLog(`Unable to start run: seed must be at most ${MAX_RUN_SEED_LENGTH} characters.`);
    return false;
  }

  state.runOver = false;
  state.combatLocked = false;
  state.deckArchetype = deckConfig;
  state.challengeId = challenge.id;
  state.campaignId = campaign.id;
  state.ascensionLevel = typeof normalizeAscensionLevel === "function"
    ? normalizeAscensionLevel(options?.ascensionLevel || 0)
    : 0;
  const ascDef = typeof getAscensionDefinition === "function"
    ? getAscensionDefinition(state.ascensionLevel)
    : { startLifeDelta: 0, startingGoldBonus: 0 };
  state.runSeed = normalizeRunSeed(seed);
  state.rngState = state.runSeed ? hashRunSeed(state.runSeed) : null;
  state.runId = createRunId();
  state.runStartedAt = Date.now();
  state.runHistoryRecorded = false;
  state.runTurns = 0;
  state.runHistoryError = null;
  state.profileError = null;
  state.masterDeck = deckConfig.cards.map(id => cloneCard(id));
  state.relics = [];
  const startRelic = RELIC_DB.find(r => r.id === deckConfig.startingRelic);
  if (startRelic) state.relics.push({ ...startRelic });
  state.consumables = [{ ...CONSUMABLE_DB[0], uid: nextUid() }];

  state.encounterIdx = 0;
  state.playerLife = Math.max(1, START_LIFE + (ascDef.startLifeDelta || 0));
  state.gold = 6 + challenge.startingGoldBonus + (ascDef.startingGoldBonus || 0);
  state.synTiers = {};
  state.route = createInitialRouteState(0, campaign.id);
  state.pendingDraft = null;
  state.pendingBossRelic = null;

  beginEncounter();
  saveRunState(false);
  return true;
}

function getCurrentEncounter() {
  const encounters = getActiveCampaignEncounters();
  return encounters[state.encounterIdx % encounters.length];
}

function beginEncounter() {
  state.runOver = false;
  state.combatLocked = false;
  state.pendingDraft = null;
  state.pendingBossRelic = null;
  const enc = getCurrentEncounter();
  const challenge = getRunChallengeById(state.challengeId);
  const encounters = getActiveCampaignEncounters();
  const loopCount = Math.floor(state.encounterIdx / encounters.length);
  const loopScale = Math.pow(2.5, loopCount);
  const ascDef = typeof getAscensionDefinition === "function"
    ? getAscensionDefinition(state.ascensionLevel || 0)
    : { bossHpMult: 1 };
  const ascHpMult = ascDef.bossHpMult || 1;
  state.enemyMaxLife = Math.round(enc.maxLife * loopScale * ascHpMult);
  state.enemyLife = state.enemyMaxLife;

  state.library = shuffle(state.masterDeck.map(c => ({ ...c, keywords: [...c.keywords], produces: [...c.produces] })));
  state.hand = [];
  state.graveyard = [];
  state.playerLands = [];
  state.playerCreatures = [];
  state.playerPermanents = [];
  state.enemyCreatures = [];

  state.turn = 1;
  const activeMutators = typeof getActiveEndlessMutators === "function"
    ? getActiveEndlessMutators(loopCount)
    : [];
  const clockMutatorPenalty = activeMutators.some(m => m.id === "collapsing_clock") ? 1 : 0;
  const relicClockPenalty = typeof getRelicTurnClockPenalty === "function" ? getRelicTurnClockPenalty() : 0;
  state.maxTurns = Math.max(3, challenge.maxTurns - clockMutatorPenalty - relicClockPenalty);
  state.mulligansLeft = 1;
  state.canMulligan = true;

  if (typeof resetCombatLogForEncounter === "function") resetCombatLogForEncounter();
  recordCombatEvent("encounter", `Facing ${enc.name} on Plane ${enc.plane}.`, {
    encounter: enc.name,
    plane: enc.plane,
    campaign: getActiveCampaignId()
  });
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
      addResonance(1 * stackCount, "Aetherbound Warden");
      spawnFx(`Aetherbound Warden: +${stackCount} Card & +${stackCount} Mult!`, "#ffe299");
    }
    if (c.upkeep === "overseer") {
      const buff = 1 * stackCount * getTokenMultiplier();
      state.playerCreatures.forEach(ally => {
        ally.power += buff;
        ally.toughness += buff;
      });
      addResonance(1 * stackCount, "Clockwork Regent");
      spawnFx(`Clockwork Regent: Board +${buff}/+${buff} & +${stackCount} Mult!`, "#a4b0be");
    }
  });
  state.playerPermanents = Array.isArray(state.playerPermanents) ? state.playerPermanents : [];
  state.playerPermanents.forEach(p => {
    if (p.permanentEffect === "glorious_anthem") {
      addResonance(1, "Radiant Anthem");
    } else if (p.permanentEffect === "rhystic_archive") {
      drawCards(1);
      addResonance(1, "Aetherial Archive");
      spawnFx("Aetherial Archive: +1 Card & +1 Mult!", "#59a2ff");
    } else if (p.permanentEffect === "phyrexian_arena") {
      if (state.playerLife > 1) state.playerLife = Math.max(1, state.playerLife - 1);
      drawCards(1);
      addResonance(2, "Obsidian Pact");
      spawnFx("Obsidian Pact: +1 Card & +2 Mult (-1 Life)!", "#9b59b6");
    } else if (p.permanentEffect === "arcane_signet") {
      state.manaPool.ANY += 1;
      addResonance(1, "Aether Signet");
    } else if (p.permanentEffect === "gilded_lotus_relic") {
      state.manaPool.C += 2;
      state.manaPool.ANY += 1;
    }
  });
  dispatchRelicEvent("onTurnStart", { isFirstTurn });

  if (!isFirstTurn) {
    drawCards(1);
    recordCombatEvent("turn", `Turn ${state.turn} begins; drew 1 card and untapped ${state.playerLands.length} Lands.`, {
      turn: state.turn,
      cardsDrawn: 1
    });
    setLog(`${prefixLog}Turn ${state.turn}: Untapped ${state.playerLands.length} Lands and drew a card.`);
  } else {
    recordCombatEvent("turn", `Turn ${state.turn} begins with ${state.hand.length} cards in hand.`, {
      turn: state.turn,
      cardsInHand: state.hand.length
    });
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
    const reason = typeof getCardPlayabilityInfo === "function"
      ? getCardPlayabilityInfo(card).reason.replace(/^Unplayable:\s*/, "")
      : (card.type === "Land" ? `Land Limit (${state.maxLandsPerTurn}/turn)!` : `Missing Mana Pips for ${card.manaCost}!`);
    if (typeof showLocalPlayabilityFeedback === "function") {
      showLocalPlayabilityFeedback(card, reason);
    }
    return;
  }

  if (typeof clearLocalPlayabilityFeedback === "function") clearLocalPlayabilityFeedback();
  if (typeof playSoundCue === "function") playSoundCue("cardPlay");
  recordCombatEvent("play", `${card.type === "Land" ? "Played" : "Cast"} ${card.name}.`, {
    cardId: card.id,
    cardName: card.name,
    cardType: card.type
  });
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
    } else if (card.type === "Enchantment" || card.type === "Artifact") {
      handlePermanentCast(card);
    } else if (card.type === "Curse") {
      spawnFx(`Purged ${card.name}!`, "#9b59b6");
      setLog(`Purged ${card.name} from this encounter.`);
    } else {
      handleSpellCast(card);
    }
  }

  renderAll();
  if (typeof showCardPlayImpact === "function") showCardPlayImpact(card);
}

function handleLandPlay(landCard) {
  const triggers = getTriggerMultiplier();

  if (landCard.isFetch) {
    pushToGraveyard(landCard);
    promptFetchBasicLand(2 * triggers, "Riftway Crossing (Double Landfall!)", triggers);
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
    addResonance(1 * stackCount, "Leyline Viper (Landfall)");
    spawnFx(`Cobra Landfall: +${stackCount} Any-Color Mana & Mult!`, "#2ecc71");
  },
  briarback(c) {
    c.tempPower = (c.tempPower || 0) + 2;
    c.tempToughness = (c.tempToughness || 0) + 2;
    spawnFx("Briarback Colossus Landfall: +2/+2!", "#2ecc71");
  },
  scute(c) {
    const tokenMult = getTokenMultiplier();
    if (state.playerLands.length >= 4) {
      c.count = (c.count || 1) + (1 * tokenMult);
      spawnFx(`Chitin Brood Cloned (×${c.count})!`, "#2ecc71");
      triggerOnCreatureEnter(1 * tokenMult);
    } else {
      spawnTokens("Insect Token", 1, 1, "G", ["Haste"], 1);
    }
  },
  baloth(c, stackCount) {
    spawnTokens("Beast Token", 4, 4, "G", ["Trample"], 1 * stackCount);
  },
  cartographer(c) {
    c.tempPower = (c.tempPower || 0) + 1;
    c.tempToughness = (c.tempToughness || 0) + 1;
    drawCards(1);
    spawnFx("Floodplain Cartographer Landfall: +1/+1 & Drew 1!", "#3498db");
  }
};

function triggerLandfall() {
  state.turnStats.landfalls++;
  recordCombatEvent("trigger", `Landfall trigger ${state.turnStats.landfalls} resolved.`, {
    trigger: "landfall",
    count: state.turnStats.landfalls
  });
  const snapshot = [...state.playerCreatures];
  snapshot.forEach(c => {
    const handler = c.landfall && LANDFALL_EFFECTS[c.landfall];
    if (handler) {
      handler(c, c.count || 1);
    }
  });
  if (Array.isArray(state.playerPermanents)) {
    state.playerPermanents.forEach(p => {
      if (p && p.permanentEffect === "hardened_scales") {
        const buff = 1 * getTokenMultiplier();
        state.playerCreatures.forEach(c => {
          c.power += buff;
          c.toughness += buff;
        });
        addResonance(1, "Primal Leyline");
        spawnFx(`Primal Leyline: Board +${buff}/+${buff} & +1 Mult!`, "#2ecc71");
      }
    });
  }
}

function handlePermanentCast(card) {
  if (!Array.isArray(state.playerPermanents)) state.playerPermanents = [];
  const permanentObj = {
    uid: card.uid,
    id: card.id,
    name: card.name,
    type: card.type,
    subtype: card.subtype || card.type,
    color: card.color,
    manaCost: card.manaCost || "",
    keywords: [...(card.keywords || [])],
    permanentEffect: card.permanentEffect || null,
    rules: card.rules || "",
    foil: card.foil || null
  };
  state.playerPermanents.push(permanentObj);
  recordCombatEvent("trigger", `${card.name} (${card.type}) entered the battlefield.`, {
    cardId: card.id,
    trigger: "permanent_enter"
  });

  // Trigger ETB effects for mana rocks & immediate banners
  const triggers = getTriggerMultiplier();
  for (let i = 0; i < triggers; i++) {
    if (permanentObj.permanentEffect === "arcane_signet") {
      state.manaPool.ANY += 1;
      addResonance(1, "Aether Signet");
      spawnFx("Aether Signet: +1 Wild Mana & +1 Mult!", "#ffd466");
    } else if (permanentObj.permanentEffect === "gilded_lotus_relic") {
      state.manaPool.C += 2;
      state.manaPool.ANY += 1;
      spawnFx("Sunstone Dynamo: +{C}{C} & +1 Wild Mana!", "#ffd466");
    } else if (permanentObj.permanentEffect === "glorious_anthem") {
      addResonance(1, "Radiant Anthem");
      spawnFx("Radiant Anthem: Creatures +2/+2 & +1 Mult!", "#ffe299");
    } else if (permanentObj.permanentEffect === "fervor_banner") {
      state.playerCreatures.forEach(c => {
        if (!c.keywords.includes("Haste")) addTempKeyword(c, "Haste");
        c.summoningSick = false;
      });
      spawnFx("Warcaller's Standard: Creatures gain Haste!", "#ff6b6b");
    } else {
      spawnFx(`Deployed ${card.name}!`, "#b18cff");
    }
  }
}

function handleCreatureCast(card) {
  recordCombatEvent("trigger", `${card.name} entered the battlefield.`, {
    cardId: card.id,
    trigger: "creature_enter"
  });
  const hasFervor = Array.isArray(state.playerPermanents) &&
    state.playerPermanents.some(p => p && p.permanentEffect === "fervor_banner");
  const hasHaste = card.keywords.includes("Haste") || hasFervor;
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
  if (Array.isArray(state.playerPermanents)) {
    state.playerPermanents.forEach(p => {
      if (p && p.permanentEffect === "fervor_banner") {
        addBurnPower(2 * enteredCount, "Warcaller's Standard");
      } else if (p && p.permanentEffect === "altar_of_ash") {
        addResonance(1 * enteredCount, "Ashvein Altar");
        addBurnPower(2 * enteredCount, "Ashvein Altar");
      }
    });
  }
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
    addBurnPower(5, "Cinderpeak Wyrm");
    addResonance(2, "Cinderpeak Wyrm");
    spawnFx("Cinderpeak Wyrm: +5 Power, +2 Mult!", "#ff4757");
  },
  archon() {
    if (state.enemyCreatures.length > 0) {
      const strongestIdx = state.enemyCreatures.reduce(
        (bestIdx, creature, idx) => creature.power > state.enemyCreatures[bestIdx].power ? idx : bestIdx,
        0
      );
      const [removed] = state.enemyCreatures.splice(strongestIdx, 1);
      spawnFx(`Dread Sovereign Exiled ${removed.name}!`, "#9b59b6");
    }
    drawCards(1);
    addResonance(2, "Dread Sovereign");
  },
  djinn(creature) {
    if (state.enemyCreatures.length > 0) {
      const sorted = [...state.enemyCreatures].sort((a, b) => b.power - a.power);
      const target = sorted[0];
      state.enemyCreatures = state.enemyCreatures.filter(b => b.uid !== target.uid);
      spawnFx(`Stormcrest Djinn Bounced ${target.name}!`, "#3498db");
    }
    const blueLands = state.playerLands.filter(l => l.produces.includes("U") || l.produces.length > 1).length;
    if (creature && blueLands > 0) {
      creature.tempPower = (creature.tempPower || 0) + blueLands;
    }
    addResonance(2, "Stormcrest Djinn");
  },
  serra() {
    gainLife(4, "Solstice Seraph");
    addResonance(2, "Solstice Seraph");
    spawnFx("Solstice Seraph: +4 Life & +2 Mult!", "#ffe299");
  },
  sun_titan(creature) {
    addResonance(2, "Solar Colossus");
    const gyTargets = state.graveyard.filter(c => c.type === "Creature" || c.type === "Land");
    if (gyTargets.length === 0) {
      spawnFx("Solar Colossus: +2 Mult!", "#ffe299");
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
        spawnFx(`Solar Colossus returned ${target.name}!`, "#ffe299");
      } else {
        if (!target.keywords.includes("Haste")) target.keywords.push("Haste");
        handleCreatureCast(target);
        spawnFx(`Solar Colossus returned ${target.name} with Haste!`, "#ffe299");
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
      "Solar Colossus — Return From Graveyard",
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
    addResonance(1, "Blight Harvester");
    spawnFx(`Blight Harvester: Milled ${milled} & +1 Mult!`, "#9b59b6");
  },
  wayfinder() {
    const milled = millCards(3);
    addResonance(1, "Grove Pathbreaker");
    const recoveredLand = recoverLandFromGraveyard();
    if (recoveredLand) {
      spawnFx(`Wayfinder: Milled ${milled} & Recovered ${recoveredLand.name}!`, "#2ecc71");
    } else {
      spawnFx(`Grove Pathbreaker: Milled ${milled} & +1 Mult!`, "#2ecc71");
    }
  },
  mosswake() {
    const milled = millCards(2);
    const recoveredLand = recoverLandFromGraveyard();
    addResonance(1, "Mosswake Forager");
    spawnFx(
      recoveredLand
        ? `Mosswake Forager: Milled ${milled}, Recovered ${recoveredLand.name} & +1 Mult!`
        : `Mosswake Forager: Milled ${milled} & +1 Mult!`,
      "#2ecc71"
    );
  },
  tideglass() {
    const strongest = [...state.enemyCreatures].sort((a, b) => b.power - a.power)[0];
    if (strongest) strongest.frozen = true;
    drawCards(1);
    spawnFx(
      strongest
        ? `Tideglass Sentry: Froze ${strongest.name} & Drew 1!`
        : "Tideglass Sentry: No blocker to freeze; Drew 1!",
      "#3498db"
    );
  },
  dawnbell() {
    gainLife(2, "Dawnbell Acolyte");
    addResonance(1, "Dawnbell Acolyte");
    spawnFx("Dawnbell Acolyte: +2 Life & +1 Mult!", "#ffe299");
  },
  fiend_artisan(creature) {
    const gyCreatures = state.graveyard.filter(c => c.type === "Creature").length;
    const bonus = gyCreatures * getTokenMultiplier();
    if (creature && bonus > 0) {
      creature.power += bonus;
      creature.toughness += bonus;
    }
    addResonance(1, "Marrow Sculptor");
    spawnFx(`Marrow Sculptor: +${bonus}/+${bonus} Undergrowth & +1 Mult!`, "#2ecc71");
  },
  overseer() {
    const buff = 1 * getTokenMultiplier();
    state.playerCreatures.forEach(c => {
      c.power += buff;
      c.toughness += buff;
    });
    addResonance(1, "Clockwork Regent");
    spawnFx(`Clockwork Regent: Board +${buff}/+${buff} & +1 Mult!`, "#a4b0be");
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
    addResonance(1, "Aethercore Crusher");
    spawnFx(`Aethercore Crusher: +${bonus}/+${bonus} Modular & +1 Mult!`, "#a4b0be");
  },
  battlesphere() {
    spawnTokens("Shard Construct", 1, 1, "C", ["Haste"], 3);
    addResonance(2, "Aetherium Juggernaut");
    spawnFx("Aetherium Juggernaut: +3 Shard Constructs & +2 Mult!", "#a4b0be");
  },
  skyguard() {
    const strongest = [...state.enemyCreatures].sort((a, b) => b.power - a.power)[0];
    if (strongest) strongest.frozen = true;
    addResonance(1, "Cloudspire Skyguard");
    spawnFx(
      strongest ? `Cloudspire Skyguard: Froze ${strongest.name} & +1 Mult!` : "Cloudspire Skyguard: +1 Mult!",
      "#59a2ff"
    );
  },
  cloudblazer() {
    gainLife(2, "Skyvault Oracle");
    drawCards(2);
    addResonance(2, "Skyvault Oracle");
    spawnFx("Skyvault Oracle: +2 Life, +2 Cards & +2 Mult!", "#59a2ff");
  },
  dimir_informant() {
    const milled = millCards(3);
    drawCards(1);
    addResonance(1, "Gloomtide Whisperer");
    spawnFx(`Gloomtide Whisperer: Milled ${milled}, +1 Card & +1 Mult!`, "#9b59b6");
  },
  nightveil(creature) {
    millCards(2);
    const gyCreatures = Math.min(4, state.graveyard.filter(c => c.type === "Creature").length);
    const bonus = gyCreatures * getTokenMultiplier();
    if (creature && bonus > 0) {
      creature.power += bonus;
      creature.toughness += bonus;
    }
    addResonance(1, "Nightveil Reaper");
    spawnFx(`Nightveil Reaper: +${bonus}/+${bonus} & +1 Mult!`, "#9b59b6");
  },
  celebrant() {
    spawnTokens("Spirit Token", 1, 1, "W", ["Flying", "Haste"], 1);
    gainLife(2, "Duskchoir Celebrant");
    addBurnPower(2, "Duskchoir Celebrant");
    spawnFx("Duskchoir Celebrant: +1 Spirit, +2 Life & +2 Burn!", "#ffe299");
  },
  blood_baron() {
    gainLife(4, "Oathsworn Prelate");
    addBurnPower(4, "Oathsworn Prelate");
    addResonance(2, "Oathsworn Prelate");
    spawnFx("Oathsworn Prelate: +4 Life, +4 Burn & +2 Mult!", "#ffe299");
  },
  conclave_mentor() {
    const buff = 1 * getTokenMultiplier();
    state.playerCreatures.forEach(c => {
      c.power += buff;
      c.toughness += buff;
    });
    gainLife(2, "Grove Mentor");
    spawnFx(`Grove Mentor: Board +${buff}/+${buff} & +2 Life!`, "#2ecc71");
  },
  trostani() {
    spawnTokens("Soldier Token", 2, 2, "W", ["Lifelink", "Haste"], 2);
    gainLife(3, "Verdant Matriarch");
    addResonance(2, "Verdant Matriarch");
    spawnFx("Verdant Matriarch: +2 Soldiers, +3 Life & +2 Mult!", "#2ecc71");
  }
};

function triggerCreatureETB(creature) {
  const handler = creature.etb && ETB_EFFECTS[creature.etb];
  if (handler) {
    handler(creature);
  }
}

function recoverLandFromGraveyard() {
  let landIdx = -1;
  for (let i = state.graveyard.length - 1; i >= 0; i--) {
    if (state.graveyard[i].type === "Land") {
      landIdx = i;
      if (state.graveyard[i].isFetch || (state.graveyard[i].produces && state.graveyard[i].produces.length > 1)) {
        break;
      }
    }
  }
  if (landIdx === -1) return null;
  const [recoveredLand] = state.graveyard.splice(landIdx, 1);
  state.hand.push(recoveredLand);
  return recoveredLand;
}

const SPELL_EFFECTS = {
  cultivate() {
    promptFetchBasicLand(getTriggerMultiplier(), "Leyline Surge Ramp", 0);
  },
  overrun() {
    const buff = 3 * getTokenMultiplier();
    state.playerCreatures.forEach(c => {
      c.tempPower += buff;
      c.tempToughness += buff;
      addTempKeyword(c, "Trample");
    });
    addResonance(2, "Primal Stampede");
    spawnFx(`PRIMAL STAMPEDE! All Creatures +${buff}/+${buff} & Trample!`, "#2ecc71");
  },
  bolt() {
    addResonance(1, "Aether Bolt");
    if (state.enemyCreatures.length > 0) {
      const sortedBlockers = [...state.enemyCreatures].sort((a, b) => b.power - a.power);
      openTargetPickerModal(
        "Aether Bolt — Choose Target Blocker",
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
      addBurnPower(4, "Aether Bolt");
      spawnFx("Aether Bolt: +4 Burn to Boss!", "#ff4757");
    }
  },
  furnace_arc() {
    addBurnPower(3, "Furnace Arc");
    addResonance(1, "Furnace Arc");
    spawnFx("Furnace Arc: +3 Burn & +1 Mult!", "#ff4757");
  },
  ashen_bargain(card) {
    const lifeCost = Math.max(0, Math.floor(Number(card.lifeCost) || 0));
    state.playerLife -= lifeCost;
    recordCombatEvent("trigger", `Ashen Bargain: paid ${lifeCost} Life.`, {
      cardId: card.id,
      amount: lifeCost,
      resource: "life"
    });
    drawCards(2);
    addResonance(1, "Ashen Bargain");
    spawnFx(`Ashen Bargain: Paid ${lifeCost} Life, Drew 2 & +1 Mult!`, "#9b59b6");
  },
  slipstream_reversal() {
    addResonance(2, "Slipstream Reversal");
    if (state.enemyCreatures.length === 0) {
      spawnFx("Slipstream Reversal: No blocker to return; +2 Mult!", "#3498db");
      return;
    }
    const blockers = [...state.enemyCreatures].sort((a, b) => b.power - a.power);
    openTargetPickerModal(
      "Slipstream Reversal — Choose Blocker",
      "Return an Enemy Blocker to its owner's hand and gain +2 Resonance:",
      blockers,
      (blocker, index) => `
        <button type="button" class="board-card card-color-${blocker.color}" data-target-idx="${index}">
          <div class="card-top-bar"><span class="card-title">${blocker.name}</span></div>
          <div class="card-keywords">${blocker.keywords.map(keyword => `<span class="kw-tag">${keyword}</span>`).join("")}</div>
          <div class="card-rules">Return this ${blocker.power}/${blocker.toughness} Blocker to its owner's hand.</div>
          <div class="card-bottom-bar">
            <span class="status-pill status-ready">${index === 0 ? "★ Recommended" : "Return"}</span>
            <span class="pt-box">${blocker.power}/${blocker.toughness}</span>
          </div>
        </button>
      `,
      (chosen) => {
        state.enemyCreatures = state.enemyCreatures.filter(blocker => blocker.uid !== chosen.uid);
        spawnFx(`Slipstream Reversal returned ${chosen.name}!`, "#3498db");
      }
    );
  },
  unsummon() {
    drawCards(1);
    addResonance(1, "Aether Gale");
    if (state.enemyCreatures.length > 0) {
      const sortedBlockers = [...state.enemyCreatures].sort((a, b) => b.power - a.power);
      openTargetPickerModal(
        "Aether Gale — Bounce Enemy Blocker",
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
      spawnFx("Aether Gale: Drew 1 Card & +1 Mult!", "#3498db");
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
    gainLife(3, "Radiant Banish");
    addResonance(1, "Radiant Banish");
    if (state.enemyCreatures.length > 0) {
      const sortedBlockers = [...state.enemyCreatures].sort((a, b) => b.power - a.power);
      openTargetPickerModal(
        "Radiant Banish — Exile Blocker",
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
      spawnFx("Radiant Banish: +3 Life & +1 Mult!", "#ffe299");
    }
  },
  formation() {
    const buff = 2 * getTokenMultiplier();
    state.playerCreatures.forEach(c => {
      c.power += buff;
      c.toughness += buff;
    });
    gainLife(3, "Aegis Phalanx");
    addResonance(2, "Aegis Phalanx");
    spawnFx(`Aegis Phalanx: Board +${buff}/+${buff} & +3 Life!`, "#ffe299");
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
    addResonance(2, "Dawnbreak Charge");
    spawnFx(`Dawnbreak Charge! All Creatures +${buff}/+${buff} & Haste!`, "#ffe299");
  },
  goblins_2() {
    spawnTokens("Goblin Token", 1, 1, "R", ["Haste"], 2);
  },
  sunlit_rally() {
    spawnTokens("Soldier Token", 1, 1, "W", ["Haste"], 2);
    addResonance(1, "Sunlit Rally");
    spawnFx("Sunlit Rally: +2 Soldiers & +1 Mult!", "#ffe299");
  },
  ritual() {
    state.manaPool.R += 4;
    addResonance(2, "Pyre Chant");
    spawnFx("Pyre Chant: +{R}{R}{R}{R} & +2 Mult!", "#ff4757");
  },
  dark_ritual() {
    state.manaPool.B += 3;
    addResonance(1, "Void Offering");
    spawnFx("Void Offering: +{B}{B}{B} & +1 Mult!", "#9b59b6");
  },
  battle_rage() {
    if (state.playerCreatures.length > 0) {
      const sorted = [...state.playerCreatures].sort(
        (a, b) => (b.power + (b.tempPower || 0)) - (a.power + (a.tempPower || 0))
      );
      openTargetPickerModal(
        "Stormfury Cleave — Choose Creature",
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
    addResonance(2, "Grim Tithe");
    spawnFx("Grim Tithe: Drew 2 Cards & +2 Mult!", "#9b59b6");
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
    addResonance(1, "Aether Insight");
    spawnFx("Drew 2 Cards, +1 Treasure & +1 Mult!", "#3498db");
  },
  grisly_salvage() {
    const milled = millCards(3);
    addResonance(2, "Graveyard Plunder");
    const gyCreatures = state.graveyard.filter(c => c.type === "Creature");
    if (gyCreatures.length > 0) {
      gyCreatures.sort(
        (a, b) => ((b.power || 0) + (b.permPowerBonus || 0)) - ((a.power || 0) + (a.permPowerBonus || 0))
      );
      const best = gyCreatures[0];
      state.graveyard = state.graveyard.filter(c => c.uid !== best.uid);
      state.hand.push(best);
      spawnFx(`Graveyard Plunder: Milled ${milled} & Recovered ${best.name}!`, "#2ecc71");
    } else {
      drawCards(1);
      spawnFx(`Graveyard Plunder: Milled ${milled}, Drew 1 & +2 Mult!`, "#2ecc71");
    }
  },
  spider_spawning() {
    const gyCreatures = state.graveyard.filter(c => c.type === "Creature").length;
    const count = Math.min(5, Math.max(2, gyCreatures));
    spawnTokens("Spider Token", 2, 2, "G", ["Haste", "Lifelink"], count);
    addResonance(2, "Brood Awakening");
    spawnFx(`Brood Awakening: +${count * getTokenMultiplier()} Spiders & +2 Mult!`, "#2ecc71");
  },
  thoughtcast() {
    drawCards(2);
    addResonance(1, "Mindstream Surge");
    spawnFx("Mindstream Surge: Drew 2 Cards & +1 Mult!", "#a4b0be");
  },
  thopter_foundry() {
    spawnTokens("Drone Construct", 1, 1, "C", ["Flying", "Haste"], 2);
    gainLife(2, "Skyforge Assembly");
    addResonance(1, "Skyforge Assembly");
    spawnFx("Skyforge Assembly: +2 Thopters, +2 Life & +1 Mult!", "#a4b0be");
  },
  galvanic_blast() {
    addResonance(1, "Arc Discharge");
    if (state.enemyCreatures.length > 0) {
      const sortedBlockers = [...state.enemyCreatures].sort((a, b) => b.power - a.power);
      openTargetPickerModal(
        "Arc Discharge — Choose Target Blocker",
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
          spawnFx(`Arc Discharge Destroyed ${chosen.name}!`, "#ff4757");
        }
      );
    } else {
      addBurnPower(5, "Arc Discharge");
      spawnFx("Arc Discharge: +5 Burn to Boss & +1 Mult!", "#ff4757");
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
    addResonance(2, "Aetherdrive Sovereign");
    spawnFx(`AETHERDRIVE! All Creatures +${buff}/+${buff}, Flying & Haste!`, "#a4b0be");
  },
  ephemerate() {
    drawCards(1);
    addResonance(2, "Aether Blink");
    const etbTargets = state.playerCreatures.filter(c => c.etb && ETB_EFFECTS[c.etb]);
    if (etbTargets.length > 0) {
      const target = [...etbTargets].sort((a, b) => (b.power + (b.tempPower || 0)) - (a.power + (a.tempPower || 0)))[0];
      const triggers = getTriggerMultiplier();
      for (let i = 0; i < triggers; i++) {
        triggerCreatureETB(target);
      }
      spawnFx(`✨ Aether Blink: Re-triggered ${target.name} ETB!`, "#59a2ff");
    } else if (state.playerCreatures.length > 0) {
      const target = [...state.playerCreatures].sort((a, b) => (b.power + (b.tempPower || 0)) - (a.power + (a.tempPower || 0)))[0];
      target.tempPower = (target.tempPower || 0) + 2;
      target.tempToughness = (target.tempToughness || 0) + 2;
      addTempKeyword(target, "Flying");
      spawnFx(`✨ Aether Blink: ${target.name} +2/+2 & Flying!`, "#59a2ff");
    } else {
      spawnFx("✨ Aether Blink: Drew 1 & +2 Mult!", "#59a2ff");
    }
  },
  thought_scour() {
    const milled = millCards(3);
    const strongest = [...state.enemyCreatures].sort((a, b) => b.power - a.power)[0];
    if (strongest) strongest.frozen = true;
    drawCards(1);
    addResonance(1, "Abyssal Scour");
    spawnFx(
      strongest
        ? `Abyssal Scour: Milled ${milled}, Froze ${strongest.name} & Drew 1!`
        : `Abyssal Scour: Milled ${milled} & Drew 1!`,
      "#59a2ff"
    );
  },
  lingering_souls() {
    spawnTokens("Spirit Token", 1, 1, "W", ["Flying", "Haste"], 2);
    gainLife(2, "Vesper Procession");
    addResonance(1, "Vesper Procession");
    spawnFx("Vesper Procession: +2 Flying Spirits & +2 Life!", "#ffe299");
  },
  selesnya_charm() {
    spawnTokens("Knight Token", 2, 2, "G", ["Haste"], 2);
    addResonance(1, "Verdant Call");
    spawnFx("Verdant Call: +2 Haste Knights & +1 Mult!", "#2ecc71");
  }
};

function handleSpellCast(card) {
  state.turnStats.spells++;
  recordCombatEvent("trigger", `${card.name} cast triggers resolved.`, {
    cardId: card.id,
    trigger: "spell_cast",
    spellCount: state.turnStats.spells
  });
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
    spawnFx("Aerial Ward: 1/1 Drake Spawned!", "#3498db");
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

  // 1. Basic lands & uncollectible curse/token cards strictly excluded
  if (card.subtype === "Basic" || card.uncollectible || card.isCurse) return false;

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

function getAvailableCardEvolutionOptions(card) {
  if (!card || card.type !== "Creature" || card.evolutionId) return [];
  const keywords = new Set(Array.isArray(card.keywords) ? card.keywords : []);
  return CARD_EVOLUTION_OPTIONS.filter(option =>
    option.keywords.every(keyword => !keywords.has(keyword))
  );
}

function getAvailableEvolutionTargets() {
  return state.masterDeck.filter(card =>
    card.type === "Creature" && getAvailableCardEvolutionOptions(card).length > 0
  );
}

function applyCardEvolutionToCard(card, evolutionId) {
  const option = getAvailableCardEvolutionOptions(card)
    .find(item => item.id === evolutionId);
  if (!card || !option || !isValidCardEvolution(card, option.id)) return false;

  card.permPowerBonus = (Number(card.permPowerBonus) || 0) + option.powerBonus;
  card.permToughnessBonus = (Number(card.permToughnessBonus) || 0) + option.toughnessBonus;
  card.evolutionId = option.id;
  if (!Array.isArray(card.keywords)) card.keywords = [];
  option.keywords.forEach(keyword => {
    if (!card.keywords.includes(keyword)) card.keywords.push(keyword);
  });
  return true;
}

function completeCardEvolutionPurchase(upgradeIdx, cardUid, evolutionId) {
  const upgrade = state.shopStock.upgrades[upgradeIdx];
  if (
    !upgrade ||
    upgrade.id !== "card_evolution" ||
    upgrade.bought ||
    state.runOver ||
    state.combatLocked ||
    state.gold < upgrade.cost
  ) {
    return false;
  }

  const card = state.masterDeck.find(item => item.uid === cardUid);
  const option = getAvailableCardEvolutionOptions(card)
    .find(item => item.id === evolutionId);
  if (!card || !option || !isValidCardEvolution(card, option.id)) return false;

  state.gold -= upgrade.cost;
  upgrade.bought = true;
  applyCardEvolutionToCard(card, option.id);
  if (typeof markShopRewardHighlight === "function") {
    markShopRewardHighlight(`upgrade_${upgrade.id}`);
  }

  saveRunState(true);
  setLog(`${card.name} evolved: ${option.name}.`);
  spawnFx(`${card.name} Evolved — ${option.name}!`, "#b18cff");
  renderShop();
  if (typeof showShopRewardSummary === "function") {
    showShopRewardSummary(`${card.name} evolved: ${option.name}.`);
  }
  renderAll();
  return true;
}

// === LIVING LANDS: DECK ENHANCEMENT & LAND FUSION ===
function getAvailableLandEnhancementTargets() {
  return state.masterDeck.filter(card =>
    card.type === "Land" && !card.isFetch && !card.landEnhancement
  );
}

function applyLandEnhancementToCard(card, enhancementId) {
  if (!card || card.landEnhancement || !isValidLandEnhancement(card, enhancementId)) return false;
  card.landEnhancement = enhancementId;
  return true;
}

function completeLandEnhancementPurchase(upgradeIdx, cardUid, enhancementId) {
  const upgrade = state.shopStock.upgrades[upgradeIdx];
  if (
    !upgrade ||
    upgrade.id !== "land_enhancement" ||
    upgrade.bought ||
    state.runOver ||
    state.combatLocked ||
    state.gold < upgrade.cost
  ) {
    return false;
  }

  const card = state.masterDeck.find(item => item.uid === cardUid);
  const def = getLandEnhancementDefinition(enhancementId);
  if (!card || !def || !applyLandEnhancementToCard(card, def.id)) return false;

  state.gold -= upgrade.cost;
  upgrade.bought = true;
  if (typeof playSoundCue === "function") playSoundCue("shopBuy");
  if (typeof markShopRewardHighlight === "function") {
    markShopRewardHighlight(`upgrade_${upgrade.id}`);
  }

  saveRunState(true);
  setLog(`${card.name} infused with ${def.icon} ${def.name}!`);
  spawnFx(`${def.icon} ${def.name} ${card.name}!`, "#4bf099");
  renderShop();
  if (typeof showShopRewardSummary === "function") {
    showShopRewardSummary(`${card.name} infused with ${def.icon} ${def.name}.`);
  }
  renderAll();
  return true;
}

function completeRestLandEnhancement(cardUid, enhancementId) {
  if (state.runOver || state.combatLocked) return false;
  const card = state.masterDeck.find(item => item.uid === cardUid);
  const def = getLandEnhancementDefinition(enhancementId);
  if (!card || !def || !applyLandEnhancementToCard(card, def.id)) return false;

  saveRunState(false);
  setLog(`Leyline Infusion: ${card.name} gained ${def.icon} ${def.name}!`);
  spawnFx(`${def.icon} ${def.name} ${card.name}!`, "#4bf099");
  renderAll();
  return true;
}

function getAvailableLandFusionTargets() {
  return state.masterDeck.filter(card =>
    card.type === "Land" &&
    !card.isFetch &&
    card.subtype === "Basic" &&
    Array.isArray(card.produces) &&
    card.produces.length === 1
  );
}

function fuseLandsInDeck(landUidA, landUidB) {
  if (!landUidA || !landUidB || landUidA === landUidB) return { ok: false, reason: "invalid_pair" };
  const idxA = state.masterDeck.findIndex(c => c.uid === landUidA);
  const idxB = state.masterDeck.findIndex(c => c.uid === landUidB);
  if (idxA === -1 || idxB === -1) return { ok: false, reason: "not_found" };

  const landA = state.masterDeck[idxA];
  const landB = state.masterDeck[idxB];
  const isBasic = c =>
    c && c.type === "Land" && !c.isFetch && c.subtype === "Basic" &&
    Array.isArray(c.produces) && c.produces.length === 1;
  if (!isBasic(landA) || !isBasic(landB)) return { ok: false, reason: "not_basic" };

  const fusedDef = createFusedLandDefinition(landA.produces[0], landB.produces[0]);
  if (!fusedDef) return { ok: false, reason: "invalid_colors" };

  const fusedCard = cloneCard(fusedDef);
  if (!fusedCard) return { ok: false, reason: "clone_failed" };
  // Preserve enhancement if either parent Basic Land was already enhanced
  fusedCard.landEnhancement = landA.landEnhancement || landB.landEnhancement || null;

  // Remove higher index first so lower index remains valid
  const hi = Math.max(idxA, idxB);
  const lo = Math.min(idxA, idxB);
  state.masterDeck.splice(hi, 1);
  state.masterDeck.splice(lo, 1);
  state.masterDeck.push(fusedCard);

  return {
    ok: true,
    fusedCard,
    sacrificedNames: [landA.name, landB.name]
  };
}

function completeLandFusionPurchase(upgradeIdx, landUidA, landUidB) {
  const upgrade = state.shopStock.upgrades[upgradeIdx];
  if (
    !upgrade ||
    upgrade.id !== "land_fusion" ||
    upgrade.bought ||
    state.runOver ||
    state.combatLocked ||
    state.gold < upgrade.cost
  ) {
    return false;
  }

  const res = fuseLandsInDeck(landUidA, landUidB);
  if (!res.ok) return false;

  state.gold -= upgrade.cost;
  upgrade.bought = true;
  if (typeof playSoundCue === "function") playSoundCue("shopBuy");
  if (typeof markShopRewardHighlight === "function") {
    markShopRewardHighlight(`upgrade_${upgrade.id}`);
  }

  saveRunState(true);
  setLog(`Fused ${res.sacrificedNames[0]} + ${res.sacrificedNames[1]} into ${res.fusedCard.name}!`);
  spawnFx(`⛰️ Fused: ${res.fusedCard.name}!`, "#ffd466");
  renderShop();
  if (typeof showShopRewardSummary === "function") {
    showShopRewardSummary(`Fused into ${res.fusedCard.name}.`);
  }
  renderAll();
  return true;
}

function completeRestLandFusion(landUidA, landUidB) {
  if (state.runOver || state.combatLocked) return false;
  const res = fuseLandsInDeck(landUidA, landUidB);
  if (!res.ok) return false;

  saveRunState(false);
  setLog(`Leyline Fusion: Merged ${res.sacrificedNames[0]} + ${res.sacrificedNames[1]} into ${res.fusedCard.name}!`);
  spawnFx(`⛰️ Fused: ${res.fusedCard.name}!`, "#ffd466");
  renderAll();
  return true;
}

function canSafelyPurgeCard() {
  const count = state.masterDeck ? state.masterDeck.length : 0;
  const MIN_DECK_SIZE_FOR_PURGE = 30;
  if (count <= MIN_DECK_SIZE_FOR_PURGE) {
    return {
      allowed: false,
      reason: `Deck has ${count} cards (minimum ${MIN_DECK_SIZE_FOR_PURGE} required to purge)`
    };
  }
  return {
    allowed: true,
    reason: `${count} cards in deck (min ${MIN_DECK_SIZE_FOR_PURGE})`
  };
}

function getAvailablePurgeTargets() {
  if (!state.masterDeck || !canSafelyPurgeCard().allowed) return [];
  return state.masterDeck.slice();
}

function completeCardPurgePurchase(upgradeIdx, cardUid) {
  const upgrade = state.shopStock.upgrades[upgradeIdx];
  if (
    !upgrade ||
    upgrade.id !== "card_purge" ||
    upgrade.bought ||
    state.runOver ||
    state.combatLocked ||
    state.gold < upgrade.cost
  ) {
    return false;
  }
  if (!canSafelyPurgeCard().allowed) return false;

  const cardIdx = state.masterDeck.findIndex(item => item.uid === cardUid);
  if (cardIdx === -1) return false;

  const [purgedCard] = state.masterDeck.splice(cardIdx, 1);
  state.gold -= upgrade.cost;
  upgrade.bought = true;

  if (Array.isArray(state.library)) {
    const libIdx = state.library.findIndex(c => c.uid === cardUid);
    if (libIdx !== -1) state.library.splice(libIdx, 1);
  }
  if (Array.isArray(state.hand)) {
    const handIdx = state.hand.findIndex(c => c.uid === cardUid);
    if (handIdx !== -1) state.hand.splice(handIdx, 1);
  }
  if (Array.isArray(state.deck)) {
    const deckIdx = state.deck.findIndex(c => c.uid === cardUid);
    if (deckIdx !== -1) state.deck.splice(deckIdx, 1);
  }

  if (typeof playSoundCue === "function") {
    playSoundCue("cardPurge");
  }
  if (typeof markShopRewardHighlight === "function") {
    markShopRewardHighlight(`upgrade_${upgrade.id}`);
  }

  saveRunState(true);
  setLog(`${purgedCard.name} was permanently exiled from your deck.`);
  spawnFx(`${purgedCard.name} Exiled!`, "#ff6b8b");
  renderShop();
  if (typeof showShopRewardSummary === "function") {
    showShopRewardSummary(`${purgedCard.name} exiled. Your deck now has ${state.masterDeck.length} cards.`);
  }
  renderAll();
  return true;
}

function sampleDraftPool(deckColors, count = 3, rng = gameRandom) {
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
    const rawR = typeof rng === "function" ? rng() : gameRandom();
    const safeR = Number.isFinite(rawR) ? Math.abs(rawR) : 0;
    const idx = Math.floor(safeR * pool.length) % pool.length;
    chosen.push(pool[idx]);
    pool.splice(idx, 1);
  }

  return chosen;
}

function sampleGeneratedCreature(deckColors, seed = Math.floor(gameRandom() * 4294967296)) {
  const card = createGeneratedCreatureCard(seed, deckColors);
  return card && isCardLegalForDeck(card, deckColors) ? card : null;
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

  let targetCard = null;
  if (typeof choiceIdx === "number") {
    if (choiceIdx < 0 || choiceIdx >= choices.length) return false;
    const item = choices[choiceIdx];
    targetCard = typeof item === "string" ? CARD_DB[item] : (item?.generatedDefinition || item);
  } else if (typeof choiceIdx === "string") {
    const found = choices.find(c => (typeof c === "string" ? c : c?.id) === choiceIdx);
    if (!found) return false;
    targetCard = typeof found === "string" ? CARD_DB[found] : (found?.generatedDefinition || found);
  } else if (choiceIdx && typeof choiceIdx === "object" && typeof choiceIdx.id === "string") {
    const found = choices.find(c => (typeof c === "string" ? c : c?.id) === choiceIdx.id);
    if (!found) return false;
    targetCard = typeof found === "string" ? CARD_DB[found] : (found?.generatedDefinition || found);
  }
  if (!targetCard || (!CARD_DB[targetCard.id] && !normalizeGeneratedCardDefinition(targetCard))) return false;

  const draftedCard = cloneCard(targetCard);
  if (!draftedCard) return false;
  state.masterDeck.push(draftedCard);

  state.pendingDraft.resolved = true;
  state.pendingDraft.skipped = false;
  state.pendingDraft.selectedCardId = draftedCard.id;

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
    if (typeof showShopRewardSummary === "function") {
      showShopRewardSummary(`${draftedCard.name} joined your deck. Your deck now has ${state.masterDeck.length} cards.`);
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
    if (typeof showShopRewardSummary === "function") {
      showShopRewardSummary(`Draft skipped: +$2 Gold. You now have $${state.gold}.`);
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
  const route = ensureRouteState();
  if (!completeCurrentRouteNode()) return false;
  if (typeof playSoundCue === "function") playSoundCue("victory");

  const enc = getCurrentEncounter();
  recordCombatEvent("result", `${enc.name} was defeated.`, {
    outcome: "victory",
    encounter: enc.name
  });
  const unusedTurnsBonus = Math.max(0, state.maxTurns - state.turn);
  const interest = Math.min(3, Math.floor(state.gold / 5));
  const earned = enc.reward + unusedTurnsBonus + interest;
  state.gold += earned;

  // Between-encounter victory recovery (Step 1)
  const healed = gainLife(VICTORY_HEAL, "Victory Recovery");

  // Mark current route node as completed and flag pending route choice if branches remain
  const nextNodes = getAvailableNextRouteNodes();
  route.pendingSelection = nextNodes.length > 0;
  route.lastActivitySummary = `Defeated ${enc.name} (+$${earned} Gold${healed > 0 ? `, +${healed} Life` : ""})`;

  generateShopStock(false);

  let profileResult = null;
  const isFinalEncounter = state.encounterIdx % getActiveCampaignEncounters().length === getActiveCampaignEncounters().length - 1;
  const isMidBoss = !isFinalEncounter && enc.tier === "PLANAR OVERLORD";
  if (isMidBoss && typeof getBossRelicPool === "function") {
    const bossPool = getBossRelicPool();
    shuffle(bossPool);
    const bossChoices = bossPool.slice(0, 3).map(r => r.id);
    if (bossChoices.length > 0) {
      state.pendingBossRelic = {
        choices: bossChoices,
        encounterIdx: state.encounterIdx,
        resolved: false,
        skipped: false,
        selectedRelicId: null
      };
    } else {
      state.pendingBossRelic = null;
    }
  } else {
    state.pendingBossRelic = null;
  }

  if (!isFinalEncounter) {
    const deckColors = getDeckColors();
    const draftCards = sampleDraftPool(deckColors, 2);
    const generatedCard = sampleGeneratedCreature(deckColors);
    if (generatedCard) draftCards.push(generatedCard);
    state.pendingDraft = {
      choices: draftCards.map(c => c.generated ? c : c.id),
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
    recordCompletedRun("victory");
    profileResult = recordCampaignClear();
    saveRunState(true);
  }

  renderShop();
  renderAll();

  if (!isHeadlessEnv()) {
    const badgeText = `VICTORY • ${enc.name.toUpperCase()} DEFEATED!`;
    const profileNotice = profileResult?.newlyUnlockedDeckId
      ? ` • New starter deck unlocked: ${STARTER_DECKS.find(deck => deck.id === profileResult.newlyUnlockedDeckId)?.name || profileResult.newlyUnlockedDeckId}`
      : profileResult?.error
        ? ` • Persistent unlock could not be saved: ${profileResult.error}`
        : "";
    const summaryText =
      `Earned $${enc.reward} Ward Bounty + $${unusedTurnsBonus} Unused Turn Bonus + $${interest} Interest ($${earned} Total)${healed > 0 ? ` • Restored +${healed} Life` : ""}${profileNotice}. Sculpt your deck before choosing your next Planar Route stop!`;
    const presentResult = () => {
      if (typeof presentVictoryOrShopModal === "function") {
        presentVictoryOrShopModal(enc, earned, healed, badgeText, summaryText);
      }
    };
    const transitionDelay = typeof getCombatAnimationDelay === "function"
      ? getCombatAnimationDelay(980)
      : 0;
    if (!isHeadlessEnv() && transitionDelay > 0) {
      state.combatLocked = true;
      renderAll();
      setTimeout(() => {
        state.combatLocked = false;
        presentResult();
      }, transitionDelay);
    } else {
      presentResult();
    }
  }
  return true;
}

function handleDefeat() {
  state.runOver = true;
  state.combatLocked = false;
  if (typeof playSoundCue === "function") playSoundCue("defeat");
  const defeatedEncounter = getCurrentEncounter();
  recordCombatEvent("result", `Run ended at ${defeatedEncounter.name}.`, {
    outcome: "defeat",
    encounter: defeatedEncounter.name
  });
  recordCompletedRun("defeat");
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

function selectBossRelic(choiceIdx) {
  if (!state.pendingBossRelic || state.pendingBossRelic.resolved || state.runOver) return false;
  const choices = state.pendingBossRelic.choices;
  if (!Array.isArray(choices) || choices.length === 0) return false;

  let relicId = null;
  if (typeof choiceIdx === "number") {
    if (choiceIdx < 0 || choiceIdx >= choices.length) return false;
    relicId = choices[choiceIdx];
  } else if (typeof choiceIdx === "string" && choices.includes(choiceIdx)) {
    relicId = choiceIdx;
  }
  const def = relicId ? RELIC_DB.find(r => r.id === relicId) : null;
  if (!def || hasRelic(def.id)) return false;

  // Boss Relics grant an extra 6th Command Zone slot if needed
  if (state.relics.length < 6) {
    state.relics.push({ ...def });
  }
  state.pendingBossRelic.resolved = true;
  state.pendingBossRelic.skipped = false;
  state.pendingBossRelic.selectedRelicId = def.id;

  saveRunState(false);

  if (!isHeadlessEnv()) {
    if (typeof playSoundCue === "function") playSoundCue("shopBuy");
    if (typeof spawnFx === "function") spawnFx(`👑 Claimed Boss Relic: ${def.name}!`, "#ffd466");
    if (typeof setLog === "function") setLog(`Claimed Boss Relic: ${def.name}.`);
    if (typeof closeBossRelicModal === "function") closeBossRelicModal();
    if (typeof renderAll === "function") renderAll();
    if (state.pendingDraft && !state.pendingDraft.resolved && typeof openDraftModal === "function") {
      openDraftModal(getCurrentEncounter());
    } else if (typeof safeShowModal === "function") {
      if (typeof renderShop === "function") renderShop();
      safeShowModal("shop-dialog");
    }
  }
  return true;
}

function skipBossRelic() {
  if (!state.pendingBossRelic || state.pendingBossRelic.resolved || state.runOver) return false;
  state.gold += 6;
  state.pendingBossRelic.resolved = true;
  state.pendingBossRelic.skipped = true;
  state.pendingBossRelic.selectedRelicId = null;

  saveRunState(false);

  if (!isHeadlessEnv()) {
    if (typeof spawnFx === "function") spawnFx("Boss Relic Skipped: +$6 Gold!", "#ffd466");
    if (typeof setLog === "function") setLog(`Skipped Boss Relic for +$6 Gold bounty (Gold: $${state.gold}).`);
    if (typeof closeBossRelicModal === "function") closeBossRelicModal();
    if (typeof renderAll === "function") renderAll();
    if (state.pendingDraft && !state.pendingDraft.resolved && typeof openDraftModal === "function") {
      openDraftModal(getCurrentEncounter());
    } else if (typeof safeShowModal === "function") {
      if (typeof renderShop === "function") renderShop();
      safeShowModal("shop-dialog");
    }
  }
  return true;
}

function generateShopStock(preserveUpgrades = false) {
  const unownedRelics = typeof getShopRelicPool === "function"
    ? getShopRelicPool()
    : RELIC_DB.filter(r => !r.bossOnly && !hasRelic(r.id));
  const encPlane = Number(getCurrentEncounter()?.plane) || 1;
  const pickedRelics = [];
  const relicPool = [...unownedRelics];
  const rarityWeight = (r) => {
    const rar = r.rarity || "common";
    if (encPlane >= 2) {
      return rar === "rare" ? 28 : (rar === "uncommon" ? 42 : 30);
    }
    return rar === "rare" ? 15 : (rar === "uncommon" ? 35 : 50);
  };
  for (let i = 0; i < 2 && relicPool.length > 0; i++) {
    const totalW = relicPool.reduce((s, r) => s + rarityWeight(r), 0);
    let roll = gameRandom() * totalW;
    let chosenIdx = relicPool.length - 1;
    for (let j = 0; j < relicPool.length; j++) {
      roll -= rarityWeight(relicPool[j]);
      if (roll <= 0) {
        chosenIdx = j;
        break;
      }
    }
    const [chosen] = relicPool.splice(chosenIdx, 1);
    pickedRelics.push({ ...chosen, bought: false });
  }
  state.shopStock.relics = pickedRelics;

  // Color-weighted draft pool (Step 1: weight toward deck's colors, with occasional off-color splash)
  const deckColors = getDeckColors();
  const hasLantern = hasAnyColorLands();

  const allDraftIds = Object.keys(CARD_DB).filter(id => {
    const c = CARD_DB[id];
    return c.subtype !== "Basic" && !c.uncollectible && !c.isCurse;
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
    let r = gameRandom() * totalW;
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
    const useSplash = slot === 2 && gameRandom() < 0.2 && splashPool.length > 0;
    const id = pickWeighted(useSplash ? splashPool : inColorPool) || pickWeighted(inColorPool) || pickWeighted(splashPool);
    if (id) chosenCards.push(id);
  }

  state.shopStock.cards = chosenCards.map(id => ({
    card: cloneCard(id),
    cost: 3,
    bought: false
  }));

  if (!preserveUpgrades || state.shopStock.upgrades.length === 0) {
    const randomScroll = CONSUMABLE_DB[Math.floor(gameRandom() * CONSUMABLE_DB.length)];
    state.shopStock.upgrades = [
      {
        id: "sanctum_heal",
        name: "Sanctum Healing Draught",
        desc: `Restore +8 Life (up to ${MAX_LIFE} Max Life).`,
        cost: 3,
        bought: false
      },
      {
        id: "card_evolution",
        name: "Creature Evolution",
        desc: "Choose an unevolved Creature, then permanently gain +3/+3 or +1/+1 and Trample.",
        cost: CARD_EVOLUTION_COST,
        bought: false
      },
      {
        id: "land_enhancement",
        name: "Living Land Infusion",
        desc: "Infuse a Land in your deck with Volcanic, Resonant, Blighted, or Prismatic.",
        cost: LAND_ENHANCEMENT_COST,
        bought: false
      },
      {
        id: "land_fusion",
        name: "Leyline Land Fusion",
        desc: "Merge 2 Basic Lands in your deck into a custom Fused Land with a tap passive.",
        cost: LAND_FUSION_COST,
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
        name: "Leyline Pruning (Deck Thin)",
        desc: "Permanently EXILE up to 2 excess Basic Lands without starving Fetch Lands.",
        cost: 3,
        bought: false
      },
      {
        id: "card_purge",
        name: "Planar Purge (Exile Card)",
        desc: "Permanently exile any chosen card from your deck (minimum 30 cards).",
        cost: 4,
        bought: false
      }
    ];
  }
}

function buyRelic(idx) {
  const item = state.shopStock.relics[idx];
  const maxSlots = typeof getRelicMaxSlots === "function" ? getRelicMaxSlots() : 5;
  if (!item || item.bought || state.gold < item.cost || state.relics.length >= maxSlots) return;
  state.gold -= item.cost;
  item.bought = true;
  if (typeof playSoundCue === "function") playSoundCue("shopBuy");
  state.relics.push({ ...item });
  if (typeof markShopRewardHighlight === "function") {
    markShopRewardHighlight(`relic_${item.id}`);
  }
  if (typeof markRelicRewardHighlight === "function") {
    markRelicRewardHighlight(item.id);
  }
  saveRunState(true);
  renderShop();
  if (typeof showShopRewardSummary === "function") {
    showShopRewardSummary(`${item.name} acquired and added to your relics.`);
  }
  renderAll();
}

function buyDraftCard(idx) {
  const item = state.shopStock.cards[idx];
  if (!item || item.bought || state.gold < item.cost) return;
  state.gold -= item.cost;
  item.bought = true;
  if (typeof playSoundCue === "function") playSoundCue("shopBuy");
  state.masterDeck.push(item.card);
  if (typeof markShopRewardHighlight === "function") {
    markShopRewardHighlight(`card_${item.card.id}`);
  }
  saveRunState(true);
  renderShop();
  if (typeof showShopRewardSummary === "function") {
    showShopRewardSummary(`${item.card.name} drafted into your deck.`);
  }
  renderAll();
}

function buyUpgrade(idx) {
  const upg = state.shopStock.upgrades[idx];
  if (!upg || upg.bought || state.gold < upg.cost) return;
  if (upg.isConsumable && state.consumables.length >= 2) return;
  if (upg.id === "sanctum_heal" && state.playerLife >= MAX_LIFE) return;
  if (upg.id === "exile_thin" && !canSafelyThinBasics().allowed) return;
  if (upg.id === "card_purge") {
    if (!canSafelyPurgeCard().allowed) return;
    if (typeof openCardPurgePicker === "function") {
      openCardPurgePicker(idx);
    }
    return;
  }
  if (upg.id === "card_evolution") {
    if (getAvailableEvolutionTargets().length > 0 && typeof openCardEvolutionPicker === "function") {
      openCardEvolutionPicker(idx);
    }
    return;
  }
  if (upg.id === "land_enhancement") {
    if (getAvailableLandEnhancementTargets().length > 0 && typeof openLandEnhancementPicker === "function") {
      openLandEnhancementPicker(idx);
    }
    return;
  }
  if (upg.id === "land_fusion") {
    if (getAvailableLandFusionTargets().length >= 2 && typeof openLandFusionPicker === "function") {
      openLandFusionPicker(idx);
    }
    return;
  }

  state.gold -= upg.cost;
  upg.bought = true;
  if (typeof playSoundCue === "function") playSoundCue("shopBuy");

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
      const target = creatures[Math.floor(gameRandom() * creatures.length)];
      target.foil = target.foil || "Foil";
      target.permPowerBonus = (target.permPowerBonus || 0) + 3;
      target.permToughnessBonus = (target.permToughnessBonus || 0) + 3;
      if (!target.keywords.includes("Haste")) target.keywords.push("Haste");
    }
  } else if (upg.id === "etched_foil") {
    const spells = state.masterDeck.filter(c => c.type !== "Land");
    if (spells.length > 0) {
      const target = spells[Math.floor(gameRandom() * spells.length)];
      target.foil = "Etched";
    }
  } else if (upg.id === "halo_foil") {
    const spells = state.masterDeck.filter(c => c.type !== "Land");
    if (spells.length > 0) {
      const target = spells[Math.floor(gameRandom() * spells.length)];
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
  if (typeof markShopRewardHighlight === "function") {
    markShopRewardHighlight(`upgrade_${upg.id}`);
  }
  renderShop();
  if (typeof showShopRewardSummary === "function") {
    showShopRewardSummary(`${upg.name} applied.`);
  }
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
    addResonance(1, "Aether Bloom");
    spawnFx("🌸 Aether Bloom: +3 Wild Mana & +1 Mult!", "#ffe299");
    setLog("Cracked Aether Bloom for +3 Any-Color Mana and +1 Resonance!");
  } else if (scroll.id === "time_walk") {
    state.maxTurns += 1;
    drawCards(1);
    addResonance(1, "Chrono Rift");
    spawnFx("⏳ Chrono Rift: +1 Extra Turn & Drew 1!", "#3498db");
    setLog(`Cast Chrono Rift! Ward Clock extended to ${state.maxTurns} turns and drew a card.`);
  } else if (scroll.id === "wrath_of_god") {
    const count = state.enemyCreatures.length;
    state.enemyCreatures = [];
    addResonance(2, "Solar Cataclysm");
    spawnFx(`☀️ Solar Cataclysm: Destroyed ${count} Blockers & +2 Mult!`, "#ffe299");
    setLog(`Cast Solar Cataclysm! Cleared ${count} Enemy Blockers and gained +2 Resonance.`);
  } else if (scroll.id === "demonic_tutor") {
    addResonance(1, "Void Codex");
    if (state.library.length === 0) {
      spawnFx("Void Codex: Library Empty (+1 Mult)!", "#9b59b6");
    } else {
      const choices = [...state.library].slice(0, 12);
      openTargetPickerModal(
        "Void Codex — Search Library",
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
            setLog(`Void Codex: Searched ${tutored.name} from Library into Hand!`);
          }
        }
      );
    }
  } else if (scroll.id === "wheel_of_fortune") {
    state.hand.forEach(c => pushToGraveyard(c));
    state.hand = [];
    drawCards(5);
    addResonance(2, "Tempest Cycle");
    spawnFx("🎡 Tempest Cycle: Drew 5 Fresh Cards & +2 Mult!", "#ff4757");
    setLog("Tempest Cycle: Discarded hand, drew 5 fresh cards, and gained +2 Resonance!");
  } else if (scroll.id === "mirror_scroll") {
    addResonance(1, "Rift Mirror");
    if (state.playerCreatures.length > 0) {
      const strongest = [...state.playerCreatures].sort((a, b) => (b.power + (b.tempPower || 0)) - (a.power + (a.tempPower || 0)))[0];
      const cloneObj = {
        ...strongest,
        uid: nextUid(),
        count: 1,
        isToken: true,
        keywords: [...new Set([...(strongest.keywords || []), "Haste"])],
        tempKeywords: [...(strongest.tempKeywords || [])],
        summoningSick: false,
        attacking: true,
        rules: `Mirrored Clone of ${strongest.name}.`
      };
      addCreatureToBoard(cloneObj);
      if (cloneObj.etb && ETB_EFFECTS[cloneObj.etb]) {
        const triggers = getTriggerMultiplier();
        for (let i = 0; i < triggers; i++) triggerCreatureETB(cloneObj);
      }
      spawnFx(`🪞 Rift Mirror: Cloned ${strongest.name} with Haste!`, "#59a2ff");
      setLog(`Rift Mirror cloned ${strongest.name} onto your battlefield with Haste (+1 Resonance)!`);
    } else {
      spawnTokens("Mirror Construct", 3, 3, "C", ["Haste"], 1);
      setLog("Rift Mirror: No Creature to clone, conjured a 3/3 Haste Mirror Construct (+1 Resonance)!");
    }
  } else if (scroll.id === "transmute_relic") {
    const rarePool = RELIC_DB.filter(r => !r.bossOnly && r.rarity === "rare" && !hasRelic(r.id));
    if (state.relics.length > 0 && rarePool.length > 0) {
      const removed = state.relics.pop();
      const replacement = rarePool[Math.floor(gameRandom() * rarePool.length)];
      state.relics.push({ ...replacement });
      state.gold += 4;
      spawnFx(`⚗️ Transmuted ${removed.name} → ${replacement.name} (+$4)!`, "#b18cff");
      setLog(`Alchemist's Sigil transmuted ${removed.name} into Rare Relic ${replacement.name} and granted +$4 Gold!`);
    } else {
      addResonance(3, "Alchemist's Sigil");
      state.gold += 4;
      spawnFx("⚗️ Alchemist's Sigil: +3 Mult & +$4 Gold!", "#b18cff");
      setLog("Alchemist's Sigil granted +3 Resonance and +$4 Gold!");
    }
  } else if (scroll.id === "aether_overdrive") {
    const buff = 2 * getTokenMultiplier();
    state.playerCreatures.forEach(c => {
      c.tempPower = (c.tempPower || 0) + buff;
      c.tempToughness = (c.tempToughness || 0) + buff;
      addTempKeyword(c, "Haste");
      addTempKeyword(c, "Trample");
      c.summoningSick = false;
      c.attacking = true;
    });
    addResonance(2, "Overdrive Scroll");
    spawnFx(`⚡ Overdrive Scroll: All Creatures +${buff}/+${buff}, Haste & Trample!`, "#ffd466");
    setLog(`Overdrive Scroll: All Creatures gained +${buff}/+${buff}, Haste, and Trample (+2 Resonance)!`);
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
    ...(saveObj.challengeId && saveObj.challengeId !== "standard" ? { challengeId: String(saveObj.challengeId) } : {}),
    ...(saveObj.campaignId && saveObj.campaignId !== DEFAULT_CAMPAIGN_ID ? { campaignId: String(saveObj.campaignId) } : {}),
    ...(saveObj.runSeed ? {
      runSeed: String(saveObj.runSeed),
      rngState: Number(saveObj.rngState) || hashRunSeed(saveObj.runSeed)
    } : {}),
    ...(typeof saveObj.runId === "string" && saveObj.runId.length > 0 ? {
      runId: String(saveObj.runId),
      runStartedAt: Number(saveObj.runStartedAt) || 0,
      runHistoryRecorded: Boolean(saveObj.runHistoryRecorded),
      runTurns: Math.max(0, Math.floor(Number(saveObj.runTurns) || 0))
    } : {}),
    playerLife: Number(saveObj.playerLife) || 20,
    gold: Number(saveObj.gold) || 0,
    masterDeck: Array.isArray(saveObj.masterDeck)
      ? saveObj.masterDeck.map(c => ({
          id: c && c.id ? String(c.id) : "",
          ...(c && c.generatedDefinition ? { generatedDefinition: c.generatedDefinition } : {}),
          ...(c && c.fusedDefinition ? { fusedDefinition: c.fusedDefinition } : {}),
          foil: (c && c.foil) || null,
          ...(c && c.landEnhancement ? { landEnhancement: c.landEnhancement } : {}),
          permPowerBonus: Number(c && c.permPowerBonus) || 0,
          permToughnessBonus: Number(c && c.permToughnessBonus) || 0,
          ...(c && c.evolutionId ? { evolutionId: c.evolutionId } : {}),
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

function normalizeRouteState(rawRoute, encounterIdx = 0, inShop = false, campaignId = getActiveCampaignId()) {
  if (typeof normalizeRouteObject === "function") {
    return normalizeRouteObject(rawRoute, encounterIdx, inShop, campaignId);
  }
  const campaignEncounters = typeof getCampaignEncounters === "function"
    ? getCampaignEncounters(campaignId)
    : ENCOUNTERS;
  const encCount =
    Array.isArray(campaignEncounters) && campaignEncounters.length > 0
      ? campaignEncounters.length
      : 6;
  const parsedEncIdx = Number(encounterIdx);
  const safeEncIdx = Number.isFinite(parsedEncIdx) ? Math.max(0, Math.floor(parsedEncIdx)) : 0;
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

  const campaignRouteNodes = typeof getCampaignRouteNodes === "function"
    ? getCampaignRouteNodes(campaignId)
    : CAMPAIGN_ROUTE_NODES;
  const routeNodes = Array.isArray(campaignRouteNodes)
    ? campaignRouteNodes
    : null;
  const nodeById = routeNodes ? new Map(routeNodes.map(node => [node.id, node])) : null;
  const isValidNodeId = (id) => typeof id === "string" && id.length > 0 && (!nodeById || nodeById.has(id));
  const fallbackRoute = () => {
    const completed = inShop ? [...fallbackEntry.prior, fallbackEntry.current] : [...fallbackEntry.prior];
    return {
      loop: defaultLoop,
      currentNodeId: fallbackEntry.current,
      completedNodeIds: completed,
      visitedNodeIds: [...fallbackEntry.prior, fallbackEntry.current],
      pendingEventId: null,
      pendingSelection: Boolean(inShop && encMod < encCount - 1),
      lastActivitySummary: null
    };
  };
  if (!rawRoute || typeof rawRoute !== "object" || Array.isArray(rawRoute)) return fallbackRoute();

  const currentNodeId = rawRoute.currentNodeId;
  if (!isValidNodeId(currentNodeId)) return fallbackRoute();
  const completedNodeIds = Array.isArray(rawRoute.completedNodeIds)
    ? Array.from(new Set(rawRoute.completedNodeIds.filter(isValidNodeId)))
    : [];
  const visitedNodeIds = Array.isArray(rawRoute.visitedNodeIds)
    ? Array.from(new Set(rawRoute.visitedNodeIds.filter(isValidNodeId)))
    : [];
  if (!visitedNodeIds.includes(currentNodeId)) {
    visitedNodeIds.push(currentNodeId);
  }
  if (nodeById) {
    const currentNode = nodeById.get(currentNodeId);
    const visitedSet = new Set(visitedNodeIds);
    const completedSet = new Set(completedNodeIds);
    const validPath = visitedNodeIds[0] === routeNodes[0]?.id &&
      visitedNodeIds[visitedNodeIds.length - 1] === currentNodeId &&
      visitedNodeIds.every((id, idx) =>
        idx === 0 || nodeById.get(visitedNodeIds[idx - 1])?.next?.includes(id)
      ) &&
      completedNodeIds.every(id => visitedSet.has(id)) &&
      visitedNodeIds.slice(0, -1).every(id => completedSet.has(id)) &&
      currentNode?.encounterIdx === encMod;
    if (!validPath) return fallbackRoute();
  }

  return {
    loop: defaultLoop,
    currentNodeId,
    completedNodeIds,
    visitedNodeIds,
    pendingEventId: nodeById?.get(currentNodeId)?.type === "event" && !completedNodeIds.includes(currentNodeId)
      ? currentNodeId
      : null,
    pendingSelection: Boolean(
      rawRoute.pendingSelection &&
      completedNodeIds.includes(currentNodeId) &&
      nodeById?.get(currentNodeId)?.next?.some(id => !completedNodeIds.includes(id))
    ),
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
      const generatedDefinition = item && normalizeGeneratedCardDefinition(item.generatedDefinition || item);
      const fusedDefinition = item && typeof normalizeFusedLandDefinition === "function"
        ? normalizeFusedLandDefinition(item.fusedDefinition || item)
        : null;
      if (
        !id ||
        (typeof CARD_DB !== "undefined" &&
          !CARD_DB[id] &&
          (!generatedDefinition || generatedDefinition.id !== id) &&
          (!fusedDefinition || fusedDefinition.id !== id))
      ) return null;
      const cardDef = generatedDefinition || fusedDefinition || (typeof CARD_DB !== "undefined" ? CARD_DB[id] : null);
      return {
        id: String(id),
        ...(generatedDefinition ? { generatedDefinition } : {}),
        ...(fusedDefinition ? { fusedDefinition } : {}),
        foil: (item && item.foil) || null,
        ...(item && typeof isValidLandEnhancementState === "function" && isValidLandEnhancementState(cardDef, item)
          ? { landEnhancement: item.landEnhancement }
          : {}),
        permPowerBonus: Number(item && item.permPowerBonus) || 0,
        permToughnessBonus: Number(item && item.permToughnessBonus) || 0,
        ...(item && isValidCardEvolutionState(cardDef, item) ? { evolutionId: item.evolutionId } : {}),
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
  const challengeId = normalizeRunChallengeId(working.challengeId);
  const runSeed = normalizeRunSeed(working.runSeed);
  const rngState = normalizeSavedRngState(runSeed, working.rngState);
  const runId = typeof working.runId === "string" && working.runId.length > 0
    ? working.runId.slice(0, 120)
    : null;
  const runStartedAt = Number.isFinite(Number(working.runStartedAt)) && Number(working.runStartedAt) > 0
    ? Number(working.runStartedAt)
    : 0;
  const runTurns = Number.isFinite(Number(working.runTurns)) && Number(working.runTurns) >= 0
    ? Math.floor(Number(working.runTurns))
    : 0;
  const canonicalSave = {
    version: 1,
    savedAt: Number.isFinite(Number(working.savedAt)) && Number(working.savedAt) > 0 ? Number(working.savedAt) : 0,
    inShop,
    archetypeId: matchedArch ? matchedArch.id : String(working.archetypeId || STARTER_DECKS[0].id),
    encounterIdx: safeEncIdx,
    ...(challengeId !== "standard" ? { challengeId } : {}),
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
    ...(normalizeCampaignId(working.campaignId) !== DEFAULT_CAMPAIGN_ID
      ? { campaignId: normalizeCampaignId(working.campaignId) }
      : {}),
    ...(runSeed ? { runSeed, rngState } : {}),
    ...(runId ? {
      runId,
      runStartedAt,
      runHistoryRecorded: Boolean(working.runHistoryRecorded),
      runTurns
    } : {}),
    route: normalizeRouteState(
      working.route,
      safeEncIdx,
      inShop,
      normalizeCampaignId(working.campaignId)
    )
  };

  let pendingDraft = null;
  if (working.pendingDraft && typeof working.pendingDraft === "object") {
    const rawChoices = Array.isArray(working.pendingDraft.choices)
      ? working.pendingDraft.choices
      : (Array.isArray(working.pendingDraft.cards) ? working.pendingDraft.cards : []);
    const validChoices = rawChoices
      .map(item => {
        const id = typeof item === "string" ? item : item?.id;
        const generatedDefinition = item && typeof item === "object"
          ? normalizeGeneratedCardDefinition(item.generatedDefinition || item)
          : null;
        if (typeof id !== "string" || id.length === 0) return null;
        if (typeof CARD_DB === "undefined" || CARD_DB[id]) return id;
        return generatedDefinition && generatedDefinition.id === id ? { id, generatedDefinition } : null;
      })
      .filter(Boolean);
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
  let pendingBossRelic = null;
  if (working.pendingBossRelic && typeof working.pendingBossRelic === "object") {
    const rawRelicChoices = Array.isArray(working.pendingBossRelic.choices)
      ? working.pendingBossRelic.choices.filter(id => typeof id === "string" && (typeof RELIC_DB === "undefined" || RELIC_DB.some(r => r.id === id)))
      : [];
    if (rawRelicChoices.length > 0 || working.pendingBossRelic.resolved) {
      pendingBossRelic = {
        choices: rawRelicChoices,
        encounterIdx: Number.isFinite(Number(working.pendingBossRelic.encounterIdx)) ? Math.floor(Number(working.pendingBossRelic.encounterIdx)) : safeEncIdx,
        resolved: Boolean(working.pendingBossRelic.resolved),
        skipped: Boolean(working.pendingBossRelic.skipped),
        selectedRelicId: typeof working.pendingBossRelic.selectedRelicId === "string" ? working.pendingBossRelic.selectedRelicId : null
      };
    }
  }
  if (pendingBossRelic) {
    canonicalSave.pendingBossRelic = pendingBossRelic;
  }
  const safeAsc = typeof normalizeAscensionLevel === "function"
    ? normalizeAscensionLevel(working.ascensionLevel || 0)
    : 0;
  if (safeAsc > 0) {
    canonicalSave.ascensionLevel = safeAsc;
  }
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
    "playerPermanents",
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
    campaignId: getActiveCampaignId(),
    runSeed: state.runSeed,
    rngState: state.rngState,
    runId: state.runId,
    runStartedAt: state.runStartedAt,
    runHistoryRecorded: state.runHistoryRecorded,
    runTurns: state.runTurns,
    masterDeck: deepCloneSaveData(state.masterDeck),
    relics: deepCloneSaveData(state.relics),
    consumables: deepCloneSaveData(state.consumables),
    encounterIdx: state.encounterIdx,
    challengeId: normalizeRunChallengeId(state.challengeId),
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
  state.campaignId = normalizeCampaignId(fullSnapshot.campaignId);
  state.runSeed = normalizeRunSeed(fullSnapshot.runSeed);
  state.rngState = normalizeSavedRngState(state.runSeed, fullSnapshot.rngState);
  state.runId = typeof fullSnapshot.runId === "string" && fullSnapshot.runId.length > 0
    ? fullSnapshot.runId.slice(0, 120)
    : createRunId();
  state.runStartedAt = Number.isFinite(Number(fullSnapshot.runStartedAt)) && Number(fullSnapshot.runStartedAt) > 0
    ? Number(fullSnapshot.runStartedAt)
    : Date.now();
  state.runHistoryRecorded = Boolean(fullSnapshot.runHistoryRecorded);
  state.runTurns = Math.max(0, Math.floor(Number(fullSnapshot.runTurns) || 0));
  state.challengeId = normalizeRunChallengeId(fullSnapshot.challengeId);
  state.masterDeck = deepCloneSaveData(fullSnapshot.masterDeck || []);
  state.relics = deepCloneSaveData(fullSnapshot.relics || []);
  state.consumables = deepCloneSaveData(fullSnapshot.consumables || []);
  state.encounterIdx = Number(fullSnapshot.encounterIdx) || 0;
  state.playerLife = Number(fullSnapshot.playerLife) || START_LIFE;
  state.gold = Number(fullSnapshot.gold) || 0;
  state.route = normalizeRouteState(fullSnapshot.route, state.encounterIdx, false, state.campaignId);
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
    ...(state.challengeId && state.challengeId !== "standard" ? { challengeId: state.challengeId } : {}),
    ...(getActiveCampaignId() !== DEFAULT_CAMPAIGN_ID ? { campaignId: getActiveCampaignId() } : {}),
    ...(state.ascensionLevel > 0 ? { ascensionLevel: state.ascensionLevel } : {}),
    ...(state.runSeed ? { runSeed: state.runSeed, rngState: state.rngState } : {}),
    ...(state.runId ? {
      runId: state.runId,
      runStartedAt: state.runStartedAt,
      runHistoryRecorded: Boolean(state.runHistoryRecorded),
      runTurns: state.runTurns
    } : {}),
    playerLife: state.playerLife,
    gold: state.gold,
    masterDeck: state.masterDeck.map(c => ({
      id: c.id,
      foil: c.foil || null,
      ...(c.landEnhancement ? { landEnhancement: c.landEnhancement } : {}),
      permPowerBonus: c.permPowerBonus || 0,
      permToughnessBonus: c.permToughnessBonus || 0,
      ...(c.evolutionId ? { evolutionId: c.evolutionId } : {}),
      keywords: [...(c.keywords || [])],
      generatedDefinition: c.generated ? getGeneratedCardDefinition(c) : undefined,
      fusedDefinition: c.fused && typeof normalizeFusedLandDefinition === "function" ? normalizeFusedLandDefinition(c) : undefined
    })),
    relicIds: state.relics.map(r => r.id),
    relics: state.relics.map(r => ({ id: r.id })),
    consumableIds: state.consumables.map(s => s.id),
    encounterState: inShop ? null : createEncounterSaveSnapshot(),
    shopStock: inShop ? deepCloneSaveData(state.shopStock) : null,
    route: deepCloneSaveData(ensureRouteState()),
    pendingDraft: state.pendingDraft ? {
      choices: Array.isArray(state.pendingDraft.choices)
        ? state.pendingDraft.choices.map(item =>
            typeof item === "string" || !item?.generated
              ? item
              : { id: item.id, generatedDefinition: getGeneratedCardDefinition(item) }
          )
        : (Array.isArray(state.pendingDraft.cards) ? state.pendingDraft.cards.map(c => (typeof c === "string" ? c : c?.id)).filter(Boolean) : []),
      encounterIdx: Number(state.pendingDraft.encounterIdx) || state.encounterIdx,
      resolved: Boolean(state.pendingDraft.resolved),
      skipped: Boolean(state.pendingDraft.skipped),
      selectedCardId: state.pendingDraft.selectedCardId || null
    } : null,
    ...(state.pendingBossRelic ? {
      pendingBossRelic: {
        choices: Array.isArray(state.pendingBossRelic.choices) ? [...state.pendingBossRelic.choices] : [],
        encounterIdx: Number(state.pendingBossRelic.encounterIdx) || state.encounterIdx,
        resolved: Boolean(state.pendingBossRelic.resolved),
        skipped: Boolean(state.pendingBossRelic.skipped),
        selectedRelicId: state.pendingBossRelic.selectedRelicId || null
      }
    } : {})
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
  state.campaignId = normalizeCampaignId(saved.campaignId);
  state.runSeed = normalizeRunSeed(saved.runSeed);
  state.rngState = normalizeSavedRngState(state.runSeed, saved.rngState);
  state.runId = typeof saved.runId === "string" && saved.runId.length > 0
    ? saved.runId
    : createRunId();
  state.runStartedAt = Number.isFinite(Number(saved.runStartedAt)) && Number(saved.runStartedAt) > 0
    ? Number(saved.runStartedAt)
    : Date.now();
  state.runHistoryRecorded = Boolean(saved.runHistoryRecorded);
  state.runTurns = Math.max(0, Math.floor(Number(saved.runTurns) || 0));
  state.challengeId = normalizeRunChallengeId(saved.challengeId);
  state.ascensionLevel = typeof normalizeAscensionLevel === "function"
    ? normalizeAscensionLevel(saved.ascensionLevel || 0)
    : 0;
  state.pendingBossRelic = saved.pendingBossRelic && typeof saved.pendingBossRelic === "object"
    ? {
        choices: Array.isArray(saved.pendingBossRelic.choices) ? [...saved.pendingBossRelic.choices] : [],
        encounterIdx: Number(saved.pendingBossRelic.encounterIdx) || state.encounterIdx,
        resolved: Boolean(saved.pendingBossRelic.resolved),
        skipped: Boolean(saved.pendingBossRelic.skipped),
        selectedRelicId: saved.pendingBossRelic.selectedRelicId || null
      }
    : null;
  state.playerPermanents = [];
  state.encounterIdx = Number(saved.encounterIdx) || 0;
  state.playerLife = Math.min(MAX_LIFE, Math.max(1, Number(saved.playerLife) || START_LIFE));
  state.gold = Math.max(0, Number(saved.gold) || 0);
  state.runOver = false;
  state.combatLocked = false;
  state.route = normalizeRouteState(saved.route, state.encounterIdx, saved.inShop, state.campaignId);

  if (saved.pendingDraft && typeof saved.pendingDraft === "object") {
    const rawChoices = Array.isArray(saved.pendingDraft.choices)
      ? saved.pendingDraft.choices
      : (Array.isArray(saved.pendingDraft.cards) ? saved.pendingDraft.cards : []);
    const validChoices = rawChoices
      .map(item => {
        const id = typeof item === "string" ? item : item?.id;
        if (typeof id !== "string" || id.length === 0) return null;
        if (CARD_DB[id]) return id;
        const generatedDefinition = item && normalizeGeneratedCardDefinition(item.generatedDefinition || item);
        return generatedDefinition && generatedDefinition.id === id ? generatedDefinition : null;
      })
      .filter(Boolean);
    state.pendingDraft = {
      choices: validChoices,
      encounterIdx: Number.isFinite(Number(saved.pendingDraft.encounterIdx)) ? Math.floor(Number(saved.pendingDraft.encounterIdx)) : state.encounterIdx,
      resolved: Boolean(saved.pendingDraft.resolved),
      skipped: Boolean(saved.pendingDraft.skipped),
      selectedCardId: typeof saved.pendingDraft.selectedCardId === "string" ? saved.pendingDraft.selectedCardId : null
    };
    Object.defineProperty(state.pendingDraft, "cards", {
      get() {
        return (this.choices || []).map(item =>
          typeof item === "string"
            ? CARD_DB[item]
            : (item.generatedDefinition || item)
        ).filter(Boolean);
      },
      enumerable: false,
      configurable: true
    });
  } else {
    state.pendingDraft = null;
  }

  state.masterDeck = saved.masterDeck
    .filter(sc =>
      CARD_DB[sc.id] ||
      (sc.generatedDefinition && normalizeGeneratedCardDefinition(sc.generatedDefinition)) ||
      (sc.fusedDefinition && typeof normalizeFusedLandDefinition === "function" && normalizeFusedLandDefinition(sc.fusedDefinition))
    )
    .map(sc => {
      const card = cloneCard(sc.generatedDefinition || sc.fusedDefinition || sc.id);
      if (!card) return null;
      card.foil = sc.foil || null;
      card.permPowerBonus = sc.permPowerBonus || 0;
      card.permToughnessBonus = sc.permToughnessBonus || 0;
      if (isValidCardEvolutionState(card, sc)) {
        card.evolutionId = sc.evolutionId;
      }
      if (typeof isValidLandEnhancementState === "function" && isValidLandEnhancementState(card, sc)) {
        card.landEnhancement = sc.landEnhancement;
      }
      if (Array.isArray(sc.keywords)) {
        sc.keywords.forEach(kw => {
          if (!card.keywords.includes(kw)) card.keywords.push(kw);
        });
      }
      return card;
    })
    .filter(Boolean);

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

  if (typeof resetCombatLogForEncounter === "function") resetCombatLogForEncounter();
  recordCombatEvent("encounter", `Resumed ${getCurrentEncounter().name} on Turn ${state.turn}.`, {
    encounter: getCurrentEncounter().name,
    turn: state.turn,
    resumed: true
  });
  const prefix = recoveredFromBackup ? "⚠️ Recovered from backup save: " : "";
  setLog(`${prefix}Restored saved run (${arch.badge}, Encounter ${state.encounterIdx + 1})!`);
  renderAll();
  if (
    !isHeadlessEnv() &&
    state.route &&
    (state.route.pendingSelection || state.route.pendingEventId) &&
    typeof openRouteModal === "function"
  ) {
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
  createGeneratedCreatureCard,
  sampleGeneratedCreature,
  normalizeGeneratedCardDefinition,
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
  globalThis.createGeneratedCreatureCard = createGeneratedCreatureCard;
  globalThis.sampleGeneratedCreature = sampleGeneratedCreature;
  globalThis.normalizeGeneratedCardDefinition = normalizeGeneratedCardDefinition;
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
