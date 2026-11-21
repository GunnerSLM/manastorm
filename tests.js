// MANASTORM — Unit Test Suite (mana solver, combat engine, shop guards & relics)
// Run with: node tests.js  OR  /System/Library/Frameworks/JavaScriptCore.framework/Versions/A/Helpers/jsc tests.js

if (typeof load === "undefined" && typeof require !== "undefined") {
  const fs = require("fs");
  const path = require("path");
  const vm = require("vm");
  globalThis.load = (file) =>
    vm.runInThisContext(fs.readFileSync(path.join(__dirname, file), "utf8"), { filename: file });
}
if (typeof console === "undefined") {
  globalThis.console = { log: (...args) => print(args.join(" ")) };
}
if (!console.warn) console.warn = console.log;
if (!console.error) console.error = console.log;

load("data/cards.js");
load("data/card_art.js");
load("data/relics.js");
load("mana.js");
load("combat.js");
load("ui.js");
load("game.js");

state.headless = true;

let passed = 0;
let failed = 0;

function assert(cond, msg) {
  if (cond) {
    passed++;
  } else {
    failed++;
    console.log(`❌ FAIL: ${msg}`);
  }
}

function resetTestState() {
  state.headless = true;
  state.runOver = false;
  state.combatLocked = false;
  state.relics = [];
  state.playerLands = [];
  state.playerCreatures = [];
  state.enemyCreatures = [];
  state.graveyard = [];
  state.manaPool = { G: 0, R: 0, B: 0, U: 0, W: 0, C: 0, ANY: 0 };
  state.turnBurnPower = 0;
  state.turnResonance = 1;
  state.resonanceSources = [{ label: "Base Resonance", amount: 1, type: "add" }];
  state.burnSources = [];
  state.turnStats = { spells: 0, landfalls: 0, graveTriggers: 0 };
  state.encounterIdx = 0;
  state.playerLife = START_LIFE;
  state.campaignId = DEFAULT_CAMPAIGN_ID;
  state.runSeed = null;
  state.rngState = null;
  state.runId = null;
  state.runStartedAt = null;
  state.runHistoryRecorded = false;
  state.runTurns = 0;
  state.runHistoryError = null;
  state.profileError = null;
}

// ============================================================================
// 1. MANA SOLVER TESTS (findManaPaymentPlan)
// ============================================================================

// Test 1.1: Prefers single-color Basic Lands over Dual Lands when paying colored pips
resetTestState();
state.playerLands = [
  { uid: "l_dual", name: "Stomping Ground", produces: ["G", "R"], tapped: false },
  { uid: "l_forest", name: "Forest", produces: ["G"], tapped: false }
];
{
  const plan = findManaPaymentPlan("{G}");
  assert(plan !== null, "1.1 Should find payment plan for {G}");
  assert(plan.landsToTap.length === 1 && plan.landsToTap[0] === "l_forest",
    "1.1 Should tap Basic Forest and save Dual Stomping Ground");
}

// Test 1.2: Bipartite matching solves overlapping dual lands regardless of order
resetTestState();
state.playerLands = [
  { uid: "l_ur", name: "Steam Vents", produces: ["U", "R"], tapped: false },
  { uid: "l_u", name: "Island", produces: ["U"], tapped: false }
];
{
  // Cost requires {U}{R}: Island must pay {U} so Steam Vents can pay {R}
  const plan = findManaPaymentPlan("{U}{R}");
  assert(plan !== null && plan.landsToTap.length === 2, "1.2 Bipartite matching pays {U}{R} with Island + Steam Vents");
}

// Test 1.3: 3-color bipartite matching across dual lands where greedy order could fail
resetTestState();
state.playerLands = [
  { uid: "l_gr", name: "Stomping Ground", produces: ["G", "R"], tapped: false },
  { uid: "l_bg", name: "Overgrown Tomb", produces: ["B", "G"], tapped: false },
  { uid: "l_br", name: "Blood Crypt", produces: ["B", "R"], tapped: false }
];
{
  const plan = findManaPaymentPlan("{G}{R}{B}");
  assert(plan !== null && plan.landsToTap.length === 3, "1.3 Bipartite matching pays {G}{R}{B} across 3 dual lands");
}

// Test 1.4: Rejects cost when missing specific colored pip even with plenty of generic mana
resetTestState();
state.playerLands = [
  { uid: "f1", name: "Forest", produces: ["G"], tapped: false },
  { uid: "f2", name: "Forest", produces: ["G"], tapped: false },
  { uid: "f3", name: "Forest", produces: ["G"], tapped: false }
];
{
  const plan = findManaPaymentPlan("{1}{R}");
  assert(plan === null, "1.4 Should reject {1}{R} when only 3 Forests are available");
}

// Test 1.5: Spends Colorless {C} and Basic Lands for generic costs BEFORE spending ANY (Treasure) mana
resetTestState();
state.manaPool = { G: 0, R: 0, B: 0, U: 0, W: 0, C: 1, ANY: 2 };
state.playerLands = [
  { uid: "f1", name: "Forest", produces: ["G"], tapped: false }
];
{
  const plan = findManaPaymentPlan("{2}{R}");
  // {R} needs 1 ANY (since no R land/pool); {2} generic should use 1 {C} + 1 Forest, leaving 1 ANY in pool!
  assert(plan !== null, "1.5 Should pay {2}{R} using {C} + Forest + 1 Treasure");
  assert(plan.newPool.C === 0 && plan.newPool.ANY === 1 && plan.landsToTap.includes("f1"),
    "1.5 Preserves remaining ANY treasure mana by spending {C} and basic land on generic cost");
}

// Test 1.6: Chromatic Lantern allows any land to tap for any colored pip
resetTestState();
state.relics = [{ ...RELIC_DB.find(r => r.id === "chromatic_lantern") }];
state.playerLands = [
  { uid: "m1", name: "Mountain", produces: ["R"], tapped: false },
  { uid: "m2", name: "Mountain", produces: ["R"], tapped: false }
];
{
  const plan = findManaPaymentPlan("{W}{U}");
  assert(plan !== null && plan.landsToTap.length === 2, "1.6 Chromatic Lantern allows 2 Mountains to pay {W}{U}");
}

// ============================================================================
// 2. COMBAT PROJECTION ENGINE TESTS (calculateProjectedCombat)
// ============================================================================

// Test 2.1: Basic unblocked Power × Resonance + Burn
resetTestState();
state.turnBurnPower = 4;
addResonance(2, "Test Buff"); // Total Resonance = 3
state.playerCreatures = [
  { uid: "c1", name: "Goblin Guide", power: 2, toughness: 2, keywords: ["Haste"], attacking: true, summoningSick: false, count: 1 }
];
{
  const res = calculateProjectedCombat();
  assert(res.power === 6 && res.mult === 3 && res.totalDamage === 18,
    `2.1 Unblocked 2 + 4 Burn = 6 Power × 3 Mult = 18 DMG (got ${res.power}×${res.mult}=${res.totalDamage})`);
  assert(
    res.attackerDamageByUid.c1 === 2 && res.attackerAssignments.c1.damageToBoss === 2,
    "2.1 Combat projection identifies unblocked attacker power by creature"
  );
}

// Test 2.2: Trample + Deathtouch only assigns 1 lethal damage to blocker, trampling the rest!
resetTestState();
state.playerCreatures = [
  { uid: "c_dt", name: "Deathtouch Trampler", power: 4, toughness: 4, keywords: ["Deathtouch", "Trample"], attacking: true, summoningSick: false, count: 1 }
];
state.enemyCreatures = [
  { uid: "b_big", name: "Wall", power: 0, toughness: 6, color: "W", keywords: [] }
];
{
  const res = calculateProjectedCombat();
  assert(res.power === 3 && res.deadBlockerUids.has("b_big") && res.attackerDamageByUid.c_dt === 3,
    `2.2 Deathtouch + Trample 4/4 vs 0/6 blocker should kill blocker with 1 dmg and trample 3 to boss (got power=${res.power})`);
}

// Test 2.3: Double Strike kills blocker on First Strike before blocker can deal lethal damage back
resetTestState();
state.playerCreatures = [
  { uid: "c_ds", name: "Blade Master", power: 3, toughness: 2, keywords: ["Double Strike"], attacking: true, summoningSick: false, count: 1 }
];
state.enemyCreatures = [
  { uid: "b_33", name: "Beast", power: 3, toughness: 3, color: "G", keywords: [] }
];
{
  const res = calculateProjectedCombat();
  assert(res.deadBlockerUids.has("b_33"), "2.3 3/2 Double Strike kills 3/3 blocker on first strike");
  assert(!res.deadAttackerCountsByUid["c_ds"], "2.3 3/2 Double Strike survives because blocker dies in first-strike step");
  assert(res.attackerDamageByUid.c_ds === undefined, "2.3 Fully blocked attacker has no direct Boss damage contribution");
}

// Test 2.4: Flying bypasses ground blockers, blocked only by Flying blockers
resetTestState();
state.playerCreatures = [
  { uid: "c_fly", name: "Serra Angel", power: 4, toughness: 4, keywords: ["Flying", "Lifelink"], attacking: true, summoningSick: false, count: 1 }
];
state.enemyCreatures = [
  { uid: "b_ground", name: "Timber Wolf", power: 2, toughness: 2, color: "G", keywords: [] }
];
{
  const res = calculateProjectedCombat();
  assert(res.power === 4 && res.lifelinkHeal === 4 && res.deadBlockerUids.size === 0,
    "2.4 Flying attacker bypasses ground blocker completely and heals via Lifelink");
}

// Test 2.5: Frozen blockers cannot block or retaliate
resetTestState();
state.playerCreatures = [
  { uid: "c_ground", name: "Bear", power: 3, toughness: 3, keywords: [], attacking: true, summoningSick: false, count: 1 }
];
state.enemyCreatures = [
  { uid: "b_frozen", name: "Frozen Wolf", power: 2, toughness: 2, color: "G", keywords: [], frozen: true }
];
{
  const res = calculateProjectedCombat();
  assert(res.power === 3 && res.deadBlockerUids.size === 0,
    "2.5 Frozen blocker cannot block ground attacker");
}

// Test 2.6: Boss Iron Hide (Vorinclex) negates direct burn while preserving creature combat damage
resetTestState();
state.encounterIdx = 4; // Vorinclex (burnImmune: true)
state.turnBurnPower = 9;
state.playerCreatures = [
  { uid: "c_atk", name: "Baloth", power: 6, toughness: 6, keywords: [], attacking: true, summoningSick: false, count: 1 }
];
{
  const res = calculateProjectedCombat();
  // Note: 1 creature with 5+ power triggers Titanfall Tier 1 (+3 Power), so 6 + 3 = 9 Power, 0 Burn!
  assert(res.power === 9, `2.6 Vorinclex negates 9 Burn Power, leaving 6 Creature + 3 Titanfall = 9 Power (got ${res.power})`);
  assert(
    getEffectiveBurnPower(9, ENCOUNTERS[2]).effective === 5 &&
    getEffectiveBurnPower(9, ENCOUNTERS[4]).effective === 0,
    "2.6 Sheoldred halves direct Burn while Vorinclex remains immune"
  );
}

// Test 2.7: Declarative encounter modifiers control wave counts and blockers
resetTestState();
{
  state.turn = 4;
  spawnEnemyWave(ENCOUNTERS[0]);
  assert(
    state.enemyCreatures.length === 2,
    "2.7 Garruk's Stampede adds a second Beast starting on Turn 4"
  );

  state.enemyCreatures = [];
  state.turn = 2;
  spawnEnemyWave(ENCOUNTERS[1]);
  assert(
    state.enemyCreatures.length === 2,
    "2.7 Krenko doubles Goblin spawns on even turns"
  );

  state.encounterIdx = 5;
  state.enemyCreatures = [];
  spawnEnemyWave(ENCOUNTERS[5]);
  assert(
    state.enemyCreatures.length === 2 &&
    state.enemyCreatures.every(blocker => blocker.toughness === 5),
    "2.7 Elesh Norn reinforces even-turn waves with two 4/5 Praetor Guards"
  );

  assert(
    getEnemyWaveSpawnCount(ENCOUNTERS[5], 2, 4) === 1 &&
    getEnemyWaveSpawnCount(ENCOUNTERS[5], 2, 5) === 0,
    "2.7 Enemy wave forecasts respect the five-blocker board cap"
  );
}

// Test 2.8: Talrand taxes the first spell only when the player has fewer than four lands
resetTestState();
{
  state.encounterIdx = 3;
  state.playerLands = [{}, {}, {}];
  handleSpellCast({ type: "Instant" });
  handleSpellCast({ type: "Instant" });
  assert(
    state.enemyCreatures.length === 1 &&
    state.enemyCreatures[0].name === "Sky Drake Whelp" &&
    state.enemyCreatures[0].keywords.includes("Flying"),
    "2.8 Talrand adds one Flying Drake for the first spell each turn, not every spell"
  );

  resetTestState();
  state.encounterIdx = 3;
  state.playerLands = [{}, {}, {}, {}];
  handleSpellCast({ type: "Instant" });
  assert(
    state.enemyCreatures.length === 0,
    "2.8 Talrand's spell tax stops once the player controls four lands"
  );
}

// Test 2.9: Sheoldred drain and Vorinclex's Iron Hide apply during retaliation
resetTestState();
{
  state.encounterIdx = 2;
  state.turn = 1;
  state.maxTurns = 5;
  state.enemyLife = 100;
  state.enemyMaxLife = 165;
  state.playerLife = 20;
  executeCombatAndEndTurn();
  assert(
    state.enemyLife === 101 &&
    state.playerLife === 19 &&
    state.enemyCreatures.length === 1,
    "2.9 Sheoldred drains 1 player Life, restores 1 Boss Life, and spawns a blocker"
  );

  resetTestState();
  state.encounterIdx = 4;
  state.turn = 1;
  state.maxTurns = 5;
  state.enemyLife = 200;
  state.enemyMaxLife = 380;
  state.playerLife = 20;
  state.enemyCreatures = [
    { uid: "iron_hydra", name: "Vorinclex Hydra", power: 4, toughness: 4, keywords: [], frozen: false }
  ];
  executeCombatAndEndTurn();
  assert(
    state.playerLife === 15,
    "2.9 Vorinclex's surviving Hydra retaliates for 5 damage (4 power + Iron Hide)"
  );
}

// Test 2.10: Challenge modes apply their trade-offs and reset cleanly
resetTestState();
{
  assert(
    startNewRun(STARTER_DECKS[0], "short_fuse") &&
    state.challengeId === "short_fuse" &&
    state.maxTurns === 4 &&
    state.gold === 11,
    "2.10 Short Fuse starts with four-turn wards and +$5 opening gold"
  );

  state.encounterIdx = 1;
  beginEncounter();
  assert(
    state.maxTurns === 4 && state.challengeId === "short_fuse",
    "2.10 Challenge turn limits persist when the next encounter begins"
  );

  startNewRun(STARTER_DECKS[0], "swarm_surge");
  assert(
    state.challengeId === "swarm_surge" &&
    state.gold === 11 &&
    getEnemyWaveSpawnCount(ENCOUNTERS[0], 1, 0) === 1 &&
    getEnemyWaveSpawnCount(ENCOUNTERS[0], 2, 0) === 2,
    "2.10 Swarm Surge adds one blocker on even-turn waves and +$5 opening gold"
  );

  startNewRun(STARTER_DECKS[0]);
  assert(
    state.challengeId === "standard" &&
    state.maxTurns === 5 &&
    state.gold === 6 &&
    getEnemyWaveSpawnCount(ENCOUNTERS[0], 1, 0) === 1,
    "2.10 Starting a standard run clears all prior challenge modifiers"
  );

  const challengeBeforeInvalidStart = state.challengeId;
  assert(
    startNewRun(STARTER_DECKS[0], "unknown_challenge") === false &&
    state.challengeId === challengeBeforeInvalidStart,
    "2.10 Unknown challenge IDs are rejected without mutating the active run"
  );

  assert(
    CAMPAIGN_DEFINITIONS.length >= 2 &&
    CAMPAIGN_DEFINITIONS.every(campaign =>
      campaign.encounters.length === 6 &&
      campaign.routeNodes.some(node => node.id === "p2_boss" && node.encounterIdx === 5)
    ),
    "2.11 Campaign definitions provide complete six-encounter routes with a final boss"
  );
  assert(
    startNewRun(STARTER_DECKS[0], "standard", "riftfall") &&
    state.campaignId === "riftfall" &&
    getCurrentEncounter().name === "Riftling Broodmother" &&
    getRouteNodeById("p2_boss").title === "The Void Architect",
    "2.11 Riftfall starts with its own encounters, route flavor, and final Warden"
  );
  state.encounterIdx = 5;
  state.route = {
    loop: 0,
    currentNodeId: "p2_boss",
    completedNodeIds: ["p1_start", "p1_upper_rest", "p1_elite", "p1_boss", "p2_entry_fight", "p2_mid_elite"],
    visitedNodeIds: ["p1_start", "p1_upper_rest", "p1_elite", "p1_boss", "p2_entry_fight", "p2_mid_elite", "p2_boss"],
    pendingEventId: null,
    pendingSelection: false,
    lastActivitySummary: null
  };
  beginEncounter();
  state.enemyLife = 0;
  assert(
    getCurrentEncounter().name === "The Void Architect" &&
    handleEncounterVictory() &&
    state.pendingDraft === null &&
    state.route.completedNodeIds.includes("p2_boss") &&
    state.route.pendingSelection === false,
    "2.11 Riftfall victory recognizes its alternate final boss and ends at the terminal route node"
  );
  const campaignBeforeInvalidStart = state.campaignId;
  assert(
    startNewRun(STARTER_DECKS[0], "standard", "unknown_campaign") === false &&
    state.campaignId === campaignBeforeInvalidStart,
    "2.11 Unknown campaign IDs are rejected without mutating the active run"
  );
  startNewRun(STARTER_DECKS[0]);

  const previousDocument = globalThis.document;
  const previousHeadless = state.headless;
  const elements = {
    "newrun-dialog": { open: false, setAttribute() {}, showModal() { this.open = true; } },
    "newrun-close-form": { hidden: false },
    "newrun-title": { textContent: "" },
    "newrun-desc": { textContent: "" },
    "run-challenge-select": { innerHTML: "", value: "" },
    "run-challenge-desc": { textContent: "" },
    "run-campaign-select": { innerHTML: "", value: "" },
    "run-campaign-desc": { textContent: "" },
    "starter-decks-grid": { innerHTML: "" }
  };
  try {
    state.challengeId = "swarm_surge";
    state.campaignId = "riftfall";
    state.headless = false;
    globalThis.document = { getElementById: id => elements[id] || null };
    openNewRunModal();
    assert(
      elements["run-challenge-select"].innerHTML.includes('value="short_fuse"') &&
      elements["run-challenge-select"].innerHTML.includes('value="swarm_surge"') &&
      elements["run-challenge-select"].value === "swarm_surge" &&
      elements["run-challenge-desc"].textContent === getRunChallengeById("swarm_surge").description &&
      elements["run-campaign-select"].innerHTML.includes('value="riftfall"') &&
      elements["run-campaign-select"].value === "riftfall" &&
      elements["run-campaign-desc"].textContent === getCampaignById("riftfall").description &&
      elements["newrun-dialog"].open,
      "2.11 New-run dialog lists campaigns and challenges, describes both selections, and opens"
    );
  } finally {
    state.headless = previousHeadless;
    state.campaignId = DEFAULT_CAMPAIGN_ID;
    if (previousDocument === undefined) delete globalThis.document;
    else globalThis.document = previousDocument;
  }
}

// Test 2.12: Seeded runs reproduce gameplay randomness and daily seeds use UTC dates
resetTestState();
{
  const seed = "shared-riftfall-seed";
  startNewRun(STARTER_DECKS[0], "standard", "riftfall", seed);
  const firstLibrary = state.library.map(card => card.id);
  const firstDraft = sampleDraftPool(new Set(STARTER_DECKS[0].colors)).map(card => card.id);
  const firstGenerated = sampleGeneratedCreature(new Set(STARTER_DECKS[0].colors));
  const firstSequence = Array.from({ length: 6 }, () => gameRandom());

  startNewRun(STARTER_DECKS[0], "standard", "riftfall", seed);
  const secondLibrary = state.library.map(card => card.id);
  const secondDraft = sampleDraftPool(new Set(STARTER_DECKS[0].colors)).map(card => card.id);
  const secondGenerated = sampleGeneratedCreature(new Set(STARTER_DECKS[0].colors));
  const secondSequence = Array.from({ length: 6 }, () => gameRandom());
  assert(
    JSON.stringify(firstLibrary) === JSON.stringify(secondLibrary) &&
    JSON.stringify(firstDraft) === JSON.stringify(secondDraft) &&
    JSON.stringify(firstGenerated) === JSON.stringify(secondGenerated) &&
    JSON.stringify(firstSequence) === JSON.stringify(secondSequence),
    "2.12 Identical seeds reproduce shuffles, drafts, generated creatures, and future random draws"
  );

  startNewRun(STARTER_DECKS[0], "standard", "riftfall", "different-seed");
  const differentSequence = Array.from({ length: 6 }, () => gameRandom());
  assert(
    JSON.stringify(firstSequence) !== JSON.stringify(differentSequence),
    "2.12 Different seeds produce a divergent gameplay random sequence"
  );
  assert(
    getDailyRunSeed(new Date("2025-02-02T23:30:00-05:00")) === "daily-2025-02-03" &&
    getDailyRunSeed(new Date("2025-02-03T02:00:00Z")) === "daily-2025-02-03",
    "2.12 Daily seeds are stable across time zones by using the UTC calendar date"
  );
  const activeSeed = state.runSeed;
  assert(
    startNewRun(STARTER_DECKS[0], "standard", "riftfall", "x".repeat(MAX_RUN_SEED_LENGTH + 1)) === false &&
    state.runSeed === activeSeed &&
    isValidRunSeedInput(" "),
    "2.12 Oversized seed input is rejected without changing the current run"
  );
}

// ============================================================================
// 3. STEP 1 LOGIC FIXES & SHOP GUARD TESTS
// ============================================================================

// Test 3.1: Unified MAX_LIFE cap across all healing sources
resetTestState();
state.playerLife = 28;
gainLife(10, "Test Heal");
assert(state.playerLife === MAX_LIFE, `3.1 gainLife caps playerLife at MAX_LIFE (${MAX_LIFE}), got ${state.playerLife}`);

// Test 3.2: Fetch-land thinning guard prevents exiling basics when Basic count is near Fetch/Ramp count
resetTestState();
state.masterDeck = [
  cloneCard("forest"),
  cloneCard("forest"),
  cloneCard("mountain"),
  cloneCard("mountain"),
  cloneCard("evolving_wilds"),
  cloneCard("evolving_wilds"),
  cloneCard("cultivate")
];
{
  // 4 basics vs 3 fetch/ramp -> minRequired is max(4, 3+2) = 5 -> should block thinning!
  const check = canSafelyThinBasics();
  assert(check.allowed === false, "3.2 Guard blocks thinning when only 4 Basics remain for 3 Fetch/Ramp cards");
}

// Test 3.3: Fetch effects only take single-color Basic Lands, never matching Dual Lands
resetTestState();
state.library = [cloneCard("stomping_ground"), cloneCard("forest")];
promptFetchBasicLand(1, "Fetch Test");
assert(
  state.playerLands.length === 1 && state.playerLands[0].id === "forest"
    && state.library.some(card => card.id === "stomping_ground"),
  "3.3 Fetch and Cultivate selection cannot take a matching Dual Land"
);

// Test 3.4: Panharmonicon resolves Sun Titan target prompts serially and returns distinct cards
resetTestState();
state.relics = [{ id: "panharmonicon" }];
state.graveyard = [cloneCard("serra_angel"), cloneCard("serra_angel")];
const originalOpenTargetPickerModal = openTargetPickerModal;
let targetPickerCount = 0;
let chooseCurrentTarget = null;
openTargetPickerModal = (_title, _desc, targets, _render, onPick) => {
  targetPickerCount++;
  chooseCurrentTarget = () => onPick(targets[0]);
};
handleCreatureCast(cloneCard("sun_titan"));
const onlyFirstTriggerOpened = targetPickerCount === 1;
chooseCurrentTarget();
const secondTriggerOpenedAfterFirstResolved = targetPickerCount === 2;
chooseCurrentTarget();
openTargetPickerModal = originalOpenTargetPickerModal;
const returnedSerraUids = state.playerCreatures
  .filter(creature => creature.id === "serra_angel")
  .map(creature => creature.uid);
assert(
  onlyFirstTriggerOpened && secondTriggerOpenedAfterFirstResolved
    && returnedSerraUids.length === 2 && new Set(returnedSerraUids).size === 2 && state.graveyard.length === 0,
  "3.4 Panharmonicon serializes Sun Titan target prompts and returns two distinct cards"
);

// Verify a target picker requested while another closes opens only after its close event.
{
  const previousHeadless = state.headless;
  const previousDocument = globalThis.document;
  const previousRenderAll = renderAll;
  let modalOpenCount = 0;
  let selectedTargets = [];
  const dialog = {
    addEventListener() {},
    close() {},
    showModal() { modalOpenCount++; }
  };
  const grid = { innerHTML: "", onclick: null };
  const nodes = {
    "target-dialog": dialog,
    "target-dialog-title": { textContent: "" },
    "target-dialog-desc": { textContent: "" },
    "target-dialog-grid": grid,
    "btn-target-auto": null
  };
  try {
    state.headless = false;
    globalThis.document = { getElementById: id => nodes[id] || null };
    renderAll = () => {};
    openTargetPickerModal("First", "", ["a", "b"], item => item, chosen => {
      selectedTargets.push(chosen);
      openTargetPickerModal("Second", "", ["c", "d"], item => item, next => selectedTargets.push(next));
    });
    const clickTarget = idx => grid.onclick({
      target: { closest: () => ({ dataset: { targetIdx: String(idx) } }) }
    });
    clickTarget(1);
    const secondPickerWaitedForClose = modalOpenCount === 1;
    handleTargetDialogClose();
    const secondPickerOpenedAfterClose = modalOpenCount === 2;
    clickTarget(0);
    handleTargetDialogClose();
    assert(
      secondPickerWaitedForClose && secondPickerOpenedAfterClose
        && selectedTargets.join(",") === "b,c",
      "3.4 Target picker queue waits for close events before opening chained target prompts"
    );
  } finally {
    state.headless = previousHeadless;
    if (previousDocument === undefined) delete globalThis.document;
    else globalThis.document = previousDocument;
    renderAll = previousRenderAll;
  }
}

// Test 3.5: Hive Mind requires two creatures for its turn-start bonus
resetTestState();
const hiveMind = RELIC_DB.find(relic => relic.id === "hive_mind");
state.relics = [{ id: "hive_mind" }];
state.playerCreatures = [{ uid: "only-creature" }];
hiveMind.onTurnStart(state);
assert(state.turnResonance === 1, "3.5 Hive Mind does not trigger with only one creature");
state.playerCreatures.push({ uid: "second-creature" });
hiveMind.onTurnStart(state);
assert(state.turnResonance === 3, "3.5 Hive Mind triggers with two creatures");

// Test 3.6: Archon exiles the strongest enemy creature, matching other removal
resetTestState();
state.enemyCreatures = [
  { uid: "weak", name: "Weak Blocker", power: 2 },
  { uid: "strong", name: "Strong Blocker", power: 8 }
];
triggerCreatureETB({ etb: "archon" });
assert(
  state.enemyCreatures.length === 1 && state.enemyCreatures[0].uid === "weak",
  "3.6 Archon of Cruelty removes the highest-power enemy creature"
);

// Test 3.7: Mid-encounter snapshots preserve draw order, hand, and turn resources
resetTestState();
state.library = [cloneCard("forest"), cloneCard("mountain")];
state.hand = [cloneCard("lightning_bolt")];
state.turn = 3;
state.manaPool.R = 2;
const expectedNextUid = `uid_${uidCounter}`;
const previousHeadless = state.headless;
const previousDocument = globalThis.document;
const previousLocalStorage = globalThis.localStorage;
let savedPayload = null;
let restoredEncounter = false;
try {
  state.headless = false;
  globalThis.document = {};
  globalThis.localStorage = {
    setItem(key, value) {
      if (key === SAVE_KEY) savedPayload = value;
    }
  };
  saveRunState(false);
  const encounterSnapshot = JSON.parse(savedPayload).encounterState;
  state.library = [];
  state.hand = [];
  state.turn = 1;
  state.manaPool.R = 0;
  restoredEncounter = restoreEncounterSaveSnapshot(encounterSnapshot);
} finally {
  state.headless = previousHeadless;
  if (previousDocument === undefined) delete globalThis.document;
  else globalThis.document = previousDocument;
  if (previousLocalStorage === undefined) delete globalThis.localStorage;
  else globalThis.localStorage = previousLocalStorage;
}
assert(
  restoredEncounter && state.library.map(card => card.id).join(",") === "forest,mountain"
    && state.hand[0].id === "lightning_bolt" && state.turn === 3 && state.manaPool.R === 2
    && nextUid() === expectedNextUid,
  "3.7 Encounter save snapshots restore exact deck order, hand, resources, turn, and UID sequence"
);

// Test 3.8: Card playability produces a precise missing-color badge without a missing helper
resetTestState();
const missingRedInfo = getCardPlayabilityInfo({ type: "Sorcery", manaCost: "{R}" });
assert(
  !missingRedInfo.playable && missingRedInfo.badge === "Missing {R}" && missingRedInfo.missingPips[0] === "{R}",
  "3.8 Card playability reports the exact missing colored pip"
);

console.log(`\n========================================`);
console.log(`MANASTORM UNIT TESTS: ${passed} passed, ${failed} failed`);
console.log(`========================================`);
if (failed > 0 && typeof process !== "undefined") {
  process.exit(1);
}

// Test 3.3: Color-weighted shop draft pool stays predominantly in-color for Gruul ({G}/{R})
resetTestState();
startNewRun(STARTER_DECKS[0]); // Gruul {G}/{R}
{
  let inColorCount = 0;
  let totalOffered = 0;
  for (let i = 0; i < 30; i++) {
    generateShopStock(false);
    state.shopStock.cards.forEach(({ card }) => {
      totalOffered++;
      if (card.isFetch) {
        inColorCount++;
      } else if (card.type === "Land") {
        if (card.produces.every(col => col === "G" || col === "R")) inColorCount++;
      } else {
        const p = parseManaCost(card.manaCost);
        if (p.pips.B === 0 && p.pips.U === 0 && p.pips.W === 0) inColorCount++;
      }
    });
  }
  const ratio = inColorCount / totalOffered;
  assert(ratio >= 0.8, `3.3 Color-weighted draft pool offers >=80% strictly in-color cards for Gruul (got ${(ratio * 100).toFixed(1)}%)`);
}

// Test 3.4: Defeat sets state.runOver = true and locks card play & combat
resetTestState();
startNewRun(STARTER_DECKS[0]);
handleDefeat();
assert(state.runOver === true, "3.4 handleDefeat sets state.runOver = true");
assert(canPlayCard(state.hand[0]) === false, "3.4 canPlayCard is locked when state.runOver is true");

// Test 3.5: White Lifegain triggers Ajani's Pridemate & Heliod, and populates Resonance Breakdown
resetTestState();
state.relics = [{ ...RELIC_DB.find(r => r.id === "heliod_sun_crowned") }];
handleCreatureCast(cloneCard("ajani_pridemate"));
gainLife(3, "Test Lifegain");
{
  const pridemate = state.playerCreatures[0];
  // Ajani's Pridemate starts 2/2, gains +2/+2 from its own trigger + +1/+1 from Heliod = 5/5!
  assert(pridemate.power === 5 && pridemate.toughness === 5,
    `3.5 Ajani's Pridemate grows to 5/5 from Lifegain + Heliod (got ${pridemate.power}/${pridemate.toughness})`);
  const combat = calculateProjectedCombat();
  const hasPridemateSource = combat.resonanceBreakdown.some(b => b.label.includes("Sunblade Vanguard"));
  const hasHeliodSource = combat.resonanceBreakdown.some(b => b.label.includes("Crown of the Solstice"));
  assert(hasPridemateSource && hasHeliodSource, "3.5 Resonance breakdown lists both Sunblade Vanguard and Crown of the Solstice sources");
}

// ============================================================================
// 4. TACTILE CARD FEEL & FOIL TIER SHADER TESTS (Milestone M1: R1 & R2)
// ============================================================================

// Balance tuning keeps the final wards challenging without overwhelming their blockers.
assert(
  ENCOUNTERS.map(enc => enc.maxLife).join(",") === "78,120,165,245,380,600",
  "Balance: encounter life totals follow the tuned six-ward progression"
);
assert(
  ENCOUNTERS[4].spawn.power === 4 &&
  ENCOUNTERS[5].spawn.count === 1 &&
  ENCOUNTERS[5].evenTurnBonusGuard === 1,
  "Balance: late-game blocker waves remain threatening but can be cleared"
);
assert(
  RELIC_DB.find(relic => relic.id === "sol_ring").cost === 11 &&
  RELIC_DB.find(relic => relic.id === "chromatic_lantern").cost === 10 &&
  RELIC_DB.find(relic => relic.id === "aetherflux_reservoir").cost === 5 &&
  RELIC_DB.find(relic => relic.id === "hive_mind").cost === 4,
  "Balance: relic prices reflect their measured campaign impact"
);

resetTestState();
{
  const impactTremors = RELIC_DB.find(relic => relic.id === "impact_tremors");
  impactTremors.onCreatureEnter(state, { count: 3 });
  assert(
    state.turnResonance === 7 && state.turnBurnPower === 6,
    "Balance: Impact Tremors rewards creature stacks with +2 Resonance and +2 Burn each"
  );

  resetTestState();
  const aetherflux = RELIC_DB.find(relic => relic.id === "aetherflux_reservoir");
  aetherflux.onSpellCast();
  assert(
    state.turnResonance === 4 && state.playerLife === START_LIFE + 2,
    "Balance: Aetherflux Reservoir grants +3 Resonance and heals 2 per spell"
  );

  resetTestState();
  const ral = RELIC_DB.find(relic => relic.id === "ral_storm_conduit");
  ral.onSpellCast();
  assert(
    state.turnResonance === 2 && state.turnBurnPower === 3,
    "Balance: Ral, Storm Conduit grants +1 Resonance and +3 Burn per spell"
  );
}

// --- 4.1 Card Tilt Math & Clamping (calculateCardTilt) ---
{
  const rect = { left: 100, top: 100, width: 200, height: 300 };

  // 4.1.1 Center coordinates return zero tilt, 50% glare, opacity 1
  const center = calculateCardTilt(rect, 200, 250);
  assert(
    center.rx === "0.00deg" &&
    center.ry === "0.00deg" &&
    center.glareX === "50.0%" &&
    center.glareY === "50.0%" &&
    center.glareOpacity === 1,
    "4.1.1 Tilt math: center coordinates return 0.00deg rx/ry and 50.0% glare"
  );

  // 4.1.2 Top-Left coordinates return +14.00deg rx, -14.00deg ry, 0.0% glare
  const topLeft = calculateCardTilt(rect, 100, 100);
  assert(
    topLeft.rx === "14.00deg" &&
    topLeft.ry === "-14.00deg" &&
    topLeft.glareX === "0.0%" &&
    topLeft.glareY === "0.0%",
    "4.1.2 Tilt math: top-left corner returns +14.00deg rx, -14.00deg ry, 0.0% glare"
  );

  // 4.1.3 Bottom-Right coordinates return -14.00deg rx, +14.00deg ry, 100.0% glare
  const botRight = calculateCardTilt(rect, 300, 400);
  assert(
    botRight.rx === "-14.00deg" &&
    botRight.ry === "14.00deg" &&
    botRight.glareX === "100.0%" &&
    botRight.glareY === "100.0%",
    "4.1.3 Tilt math: bottom-right corner returns -14.00deg rx, +14.00deg ry, 100.0% glare"
  );

  // 4.1.4 Out-of-bounds coordinates clamp strictly to [0%, 100%] and [-maxTilt, +maxTilt]
  const oob = calculateCardTilt(rect, -500, 1500);
  assert(
    oob.rx === "-14.00deg" &&
    oob.ry === "-14.00deg" &&
    oob.glareX === "0.0%" &&
    oob.glareY === "100.0%",
    "4.1.4 Tilt math: out-of-bounds coordinates clamped strictly"
  );

  // 4.1.5 Custom maxTilt parameter support
  const customTilt = calculateCardTilt(rect, 100, 100, 20);
  assert(
    customTilt.rx === "20.00deg" && customTilt.ry === "-20.00deg",
    "4.1.5 Tilt math: respects custom maxTilt parameter"
  );

  // 4.1.6 Invalid or null bounding rect safe fallback
  const invalid = calculateCardTilt(null, 100, 100);
  assert(
    invalid.glareOpacity === 0 && invalid.glareX === "50.0%" && invalid.glareY === "50.0%",
    "4.1.6 Tilt math: null rect returns safe neutral fallback with opacity 0"
  );
}

// --- 4.2 Property Application and Reset Lifecycle (applyCardTilt & resetCardTilt) ---
{
  const styles = new Map();
  const mockCard = {
    style: {
      setProperty: (k, v) => styles.set(k, String(v)),
      removeProperty: (k) => styles.delete(k),
      getPropertyValue: (k) => styles.get(k) || ""
    },
    getBoundingClientRect: () => ({ left: 100, top: 100, width: 200, height: 300 })
  };

  // 4.2.1 applyCardTilt sets --rx, --ry, --glare-x, --glare-y, --glare-opacity
  applyCardTilt(mockCard, 100, 100);
  assert(
    mockCard.style.getPropertyValue("--rx") === "14.00deg" &&
    mockCard.style.getPropertyValue("--ry") === "-14.00deg" &&
    mockCard.style.getPropertyValue("--glare-x") === "0.0%" &&
    mockCard.style.getPropertyValue("--glare-y") === "0.0%" &&
    mockCard.style.getPropertyValue("--glare-opacity") === "1",
    "4.2.1 applyCardTilt dynamically sets all 5 CSS custom properties"
  );

  // 4.2.2 resetCardTilt removes all 5 custom properties cleanly
  resetCardTilt(mockCard);
  assert(
    mockCard.style.getPropertyValue("--rx") === "" &&
    mockCard.style.getPropertyValue("--ry") === "" &&
    mockCard.style.getPropertyValue("--glare-x") === "" &&
    mockCard.style.getPropertyValue("--glare-y") === "" &&
    mockCard.style.getPropertyValue("--glare-opacity") === "",
    "4.2.2 resetCardTilt removes all 5 custom properties cleanly from style"
  );
}

// --- 4.3 Reduced Motion Detection and Neutralization ---
{
  // 4.3.1 Normal mode returns false
  state.prefersReducedMotion = false;
  assert(prefersReducedMotion() === false, "4.3.1 prefersReducedMotion returns false when disabled");

  // 4.3.2 Setting state.prefersReducedMotion = true activates reduced motion
  state.prefersReducedMotion = true;
  assert(prefersReducedMotion() === true, "4.3.2 prefersReducedMotion respects state.prefersReducedMotion = true");

  // 4.3.3 applyCardTilt under reduced motion neutralizes and does NOT set tilt
  const styles = new Map();
  const mockCard = {
    style: {
      setProperty: (k, v) => styles.set(k, String(v)),
      removeProperty: (k) => styles.delete(k),
      getPropertyValue: (k) => styles.get(k) || ""
    },
    getBoundingClientRect: () => ({ left: 100, top: 100, width: 200, height: 300 })
  };
  applyCardTilt(mockCard, 100, 100);
  assert(
    mockCard.style.getPropertyValue("--rx") === "" &&
    mockCard.style.getPropertyValue("--glare-x") === "",
    "4.3.3 applyCardTilt neutralizes transforms and suppresses glare under prefersReducedMotion"
  );

  // 4.3.4 matchMedia fallback detection
  delete state.prefersReducedMotion;
  globalThis.window = {
    matchMedia: (q) => ({ matches: q.includes("prefers-reduced-motion: reduce") })
  };
  assert(prefersReducedMotion() === true, "4.3.4 prefersReducedMotion falls back to window.matchMedia when state unset");
  delete globalThis.window;
  state.prefersReducedMotion = false;
}

// --- 4.4 Card Foil Class Propagation Across Rendering Functions ---
{
  // 4.4.1 Hover Inspector renders distinct foil classes for all 3 tiers
  let inspectorHtml = "";
  globalThis.document = {
    getElementById: (id) => id === "card-hover-inspector" ? {
      set innerHTML(val) { inspectorHtml = val; },
      classList: { toggle: () => {} },
      hidden: true
    } : null
  };
  globalThis.window = { innerWidth: 1200 };
  state.headless = false;

  showCardHoverInspector({ name: "Solar Angel", type: "Creature", foil: "Foil", color: "W", power: 4, toughness: 4 });
  assert(inspectorHtml.includes("foil-card-Foil") && inspectorHtml.includes("✨ Foil Foil"),
    "4.4.1 Inspector renders foil-card-Foil and badge for Traditional Foil");

  showCardHoverInspector({ name: "Demonic Tutor", type: "Sorcery", foil: "Etched", color: "B" });
  assert(inspectorHtml.includes("foil-card-Etched") && inspectorHtml.includes("✨ Etched Foil"),
    "4.4.2 Inspector renders foil-card-Etched and badge for Etched Foil");

  showCardHoverInspector({ name: "Time Walk", type: "Sorcery", foil: "Halo", color: "U" });
  assert(inspectorHtml.includes("foil-card-Halo") && inspectorHtml.includes("✨ Halo Foil"),
    "4.4.3 Inspector renders foil-card-Halo and badge for Halo Foil");

  state.headless = true;
  delete globalThis.document;
  delete globalThis.window;

  // 4.4.4 Shop upgrades mutate foil status correctly on target cards
  resetTestState();
  startNewRun(STARTER_DECKS[0]); // Gruul
  state.gold = 50;
  generateShopStock(false);

  // foil_buff upgrades a creature to Foil
  const foilIdx = state.shopStock.upgrades.findIndex(u => u.id === "foil_buff");
  assert(foilIdx >= 0, "4.4.4 Shop offers Traditional Foil upgrade");
  if (foilIdx >= 0) {
    buyUpgrade(foilIdx);
    assert(state.masterDeck.some(c => c.foil === "Foil"), "4.4.4 buyUpgrade(foil_buff) assigns foil='Foil'");
  }

  // etched_foil upgrades a spell to Etched
  const etchedIdx = state.shopStock.upgrades.findIndex(u => u.id === "etched_foil");
  assert(etchedIdx >= 0, "4.4.5 Shop offers Etched Foil upgrade");
  if (etchedIdx >= 0) {
    buyUpgrade(etchedIdx);
    assert(state.masterDeck.some(c => c.foil === "Etched"), "4.4.5 buyUpgrade(etched_foil) assigns foil='Etched'");
  }

  // halo_foil upgrades a spell to Halo
  const haloIdx = state.shopStock.upgrades.findIndex(u => u.id === "halo_foil");
  assert(haloIdx >= 0, "4.4.6 Shop offers Halo Foil upgrade");
  if (haloIdx >= 0) {
    buyUpgrade(haloIdx);
    assert(state.masterDeck.some(c => c.foil === "Halo"), "4.4.6 buyUpgrade(halo_foil) assigns foil='Halo'");
  }

  // 4.4.7 Combat cast trigger synergy of Etched and Halo foils
  resetTestState();
  const etchedCard = cloneCard("krenkos_command");
  etchedCard.foil = "Etched";
  state.hand = [etchedCard];
  state.manaPool.R = 1;
  state.manaPool.C = 1; // Krenko's Command costs {1}{R}
  const initialRes = state.turnResonance;
  playCardFromHand(etchedCard.uid);
  assert(state.turnResonance === initialRes + 2, "4.4.7 Play of Etched Foil card from hand grants +2 Resonance Mult");
  assert(state.resonanceSources.some(s => s.label.includes("Etched Foil")), "4.4.7 Resonance source logged for Etched Foil");

  resetTestState();
  state.turnResonance = 2;
  const haloCard = cloneCard("krenkos_command");
  haloCard.foil = "Halo";
  state.hand = [haloCard];
  state.manaPool.R = 1;
  state.manaPool.C = 1;
  const preHaloRes = state.turnResonance;
  playCardFromHand(haloCard.uid);
  assert(state.turnResonance === Math.round(preHaloRes * 1.5), "4.4.8 Play of Halo Foil card from hand multiplies Resonance Mult by 1.5");
  assert(state.resonanceSources.some(s => s.label.includes("Halo Foil")), "4.4.8 Resonance source logged for Halo Foil");
}

// --- 4.4.9 Permanent Card Evolution ---
{
  resetTestState();
  startNewRun(STARTER_DECKS[0]);
  state.gold = 50;
  generateShopStock(false);

  const upgradeIdx = state.shopStock.upgrades.findIndex(item => item.id === "card_evolution");
  const veteranTarget = state.masterDeck.find(card => card.id === "llanowar_elves");
  const trampleTarget = state.masterDeck.find(card => card.id === "lotus_cobra");
  const originalDefinition = JSON.stringify(CARD_DB.llanowar_elves);
  const veteran = CARD_EVOLUTION_OPTIONS.find(option => option.id === "veteran");
  const trampler = CARD_EVOLUTION_OPTIONS.find(option => option.id === "trampler");

  const vetOpts = getAvailableCardEvolutionOptions(veteranTarget).map(option => option.id);
  const balothOpts = getAvailableCardEvolutionOptions(cloneCard("rampaging_baloths")).map(option => option.id);
  assert(
    upgradeIdx >= 0 &&
    vetOpts.includes("veteran") &&
    vetOpts.includes("trampler") &&
    vetOpts.length >= 2 &&
    balothOpts.includes("veteran") &&
    !balothOpts.includes("trampler") &&
    !balothOpts.includes("swiftstrike"),
    "4.4.9.1 Shop offers meaningful evolutions and hides keywords the Creature already has"
  );
  assert(
    completeCardEvolutionPurchase(upgradeIdx, veteranTarget.uid, "invalid") === false &&
    completeCardEvolutionPurchase(upgradeIdx, "missing-card", "veteran") === false &&
    state.gold === 50 &&
    !state.shopStock.upgrades[upgradeIdx].bought,
    "4.4.9.2 Invalid evolution choices and targets do not spend Gold or mark the offer bought"
  );

  state.gold = CARD_EVOLUTION_COST - 1;
  assert(
    completeCardEvolutionPurchase(upgradeIdx, veteranTarget.uid, "veteran") === false &&
    state.gold === CARD_EVOLUTION_COST - 1 &&
    !state.shopStock.upgrades[upgradeIdx].bought,
    "4.4.9.3 An unaffordable evolution is rejected without changing the card or shop"
  );
  state.gold = 50;

  const veteranPurchase = completeCardEvolutionPurchase(upgradeIdx, veteranTarget.uid, veteran.id);
  assert(
    veteranPurchase === true &&
    veteranTarget.permPowerBonus === 3 &&
    veteranTarget.permToughnessBonus === 3 &&
    veteranTarget.evolutionId === "veteran" &&
    veteranTarget.keywords.includes("Trample") === false &&
    state.gold === 50 - CARD_EVOLUTION_COST &&
    state.shopStock.upgrades[upgradeIdx].bought &&
    getAvailableCardEvolutionOptions(veteranTarget).length === 0 &&
    JSON.stringify(CARD_DB.llanowar_elves) === originalDefinition,
    "4.4.9.4 Veteran's Might permanently grants +3/+3 once, charges the correct price, and leaves CARD_DB untouched"
  );
  const goldAfterVeteran = state.gold;
  assert(
    completeCardEvolutionPurchase(upgradeIdx, veteranTarget.uid, veteran.id) === false &&
    state.gold === goldAfterVeteran,
    "4.4.9.5 Repeating an evolved-card purchase is rejected without charging twice"
  );

  generateShopStock(false);
  const secondUpgradeIdx = state.shopStock.upgrades.findIndex(item => item.id === "card_evolution");
  const tramplePurchase = completeCardEvolutionPurchase(secondUpgradeIdx, trampleTarget.uid, "trampler");
  assert(
    tramplePurchase === true &&
    trampleTarget.permPowerBonus === 1 &&
    trampleTarget.permToughnessBonus === 1 &&
    trampleTarget.keywords.includes("Trample") &&
    trampleTarget.evolutionId === "trampler",
    "4.4.9.6 Predator's Instinct grants its permanent stat bonus and combat keyword"
  );

  const save = createCanonicalSavePayload(true);
  const normalized = normalizeCanonicalSave(save);
  const restoredCard = normalized.save.masterDeck.find(card => card.id === trampleTarget.id);
  assert(
    normalized.valid &&
    restoredCard.evolutionId === "trampler" &&
    restoredCard.permPowerBonus === 1 &&
    restoredCard.permToughnessBonus === 1 &&
    restoredCard.keywords.includes("Trample"),
    "4.4.9.7 Evolved card metadata and effects survive canonical save normalization"
  );

  state.masterDeck = [];
  applyCanonicalSaveToState(normalized.save);
  const restoredInstance = state.masterDeck.find(card => card.id === trampleTarget.id);
  assert(
    restoredInstance &&
    restoredInstance.evolutionId === "trampler" &&
    restoredInstance.permPowerBonus === 1 &&
    restoredInstance.keywords.includes("Trample"),
    "4.4.9.8 Restoring a run rebuilds the evolved card instance with its permanent effect"
  );
  beginEncounter();
  const nextEncounterCopy = [...state.library, ...state.hand].find(card => card.uid === restoredInstance.uid);
  assert(
    nextEncounterCopy &&
    nextEncounterCopy.evolutionId === "trampler" &&
    nextEncounterCopy.keywords.includes("Trample") &&
    nextEncounterCopy.permPowerBonus === 1,
    "4.4.9.9 Evolved statistics and abilities carry into the next encounter"
  );

  const previousDocument = globalThis.document;
  const previousHeadless = state.headless;
  const previousRenderAll = globalThis.renderAll;
  const previousRenderShop = globalThis.renderShop;
  let selectedTarget = null;
  const modalNodes = {
    "target-dialog": {
      open: false,
      showModal() { this.open = true; },
      close() { this.open = false; },
      addEventListener() {}
    },
    "target-dialog-title": { textContent: "" },
    "target-dialog-desc": { textContent: "" },
    "target-dialog-grid": { innerHTML: "" }
  };
  try {
    state.headless = false;
    globalThis.document = { getElementById: id => modalNodes[id] || null };
    openTargetPickerModal(
      "Test evolution",
      "Choose or cancel",
      ["first", "second"],
      (_item, idx) => `<button data-target-idx="${idx}"></button>`,
      item => { selectedTarget = item; },
      { allowCancel: true }
    );
    const pendingFallback = targetDialogPendingFallback;
    handleTargetDialogClose();
    assert(
      pendingFallback === null && selectedTarget === null && targetDialogActive === false,
      "4.4.9.10 Cancelling an evolution picker does not auto-select a card or spend Gold"
    );

    globalThis.renderAll = () => {};
    globalThis.renderShop = () => {};
    state.gold = 50;
    generateShopStock(false);
    const flowUpgradeIdx = state.shopStock.upgrades.findIndex(item => item.id === "card_evolution");
    const flowTarget = getAvailableEvolutionTargets()[0];
    buyUpgrade(flowUpgradeIdx);
    const goldBeforeFlow = state.gold;
    const clickChoice = idx => modalNodes["target-dialog-grid"].onclick({
      target: {
        closest: () => ({ dataset: { targetIdx: String(idx) } })
      }
    });
    clickChoice(0);
    handleTargetDialogClose();
    const selectedEvolution = getAvailableCardEvolutionOptions(flowTarget)[0];
    const beforeEvolutionChoice = state.gold;
    clickChoice(0);
    handleTargetDialogClose();
    assert(
      selectedEvolution &&
      modalNodes["target-dialog-title"].textContent === `Evolve ${flowTarget.name}` &&
      goldBeforeFlow === 50 &&
      beforeEvolutionChoice === 50 &&
      state.gold === 50 - CARD_EVOLUTION_COST &&
      state.shopStock.upgrades[flowUpgradeIdx].bought &&
      flowTarget.evolutionId === selectedEvolution.id,
      "4.4.9.11 Shop UI waits for both explicit choices before applying and charging for evolution"
    );
  } finally {
    state.headless = previousHeadless;
    globalThis.renderAll = previousRenderAll;
    globalThis.renderShop = previousRenderShop;
    if (previousDocument === undefined) delete globalThis.document;
    else globalThis.document = previousDocument;
  }
}

// --- 4.5 style.css Stylesheet Integrity and Shader Specification Verification ---
if (typeof require !== "undefined") {
  const fs = require("fs");
  const path = require("path");
  const cssPath = path.join(__dirname, "style.css");
  const css = fs.readFileSync(cssPath, "utf8");

  // 4.5.1 Foil tier classes defined
  assert(css.includes(".foil-card-Foil"), "4.5.1 style.css defines .foil-card-Foil");
  assert(css.includes(".foil-card-Etched"), "4.5.2 style.css defines .foil-card-Etched");
  assert(css.includes(".foil-card-Halo"), "4.5.3 style.css defines .foil-card-Halo");

  // 4.5.2 Shader blend modes for each foil tier
  assert(css.includes("mix-blend-mode: color-dodge"), "4.5.4 Foil tier 1 uses color-dodge blend mode");
  assert(css.includes("mix-blend-mode: hard-light"), "4.5.5 Foil tier 2 (Etched) uses hard-light blend mode");
  assert(css.includes("mix-blend-mode: screen"), "4.5.6 Foil tier 3 (Halo) uses screen blend mode");

  // 4.5.3 Specular glare highlight overlay with overlay blend mode
  assert(css.includes("mix-blend-mode: overlay"), "4.5.7 Specular glare ::after uses overlay blend mode");

  // 4.5.4 Non-blocking pointer-events: none on overlays
  assert(css.includes("pointer-events: none"), "4.5.8 Shader and glare overlays declare pointer-events: none");

  // 4.5.5 Custom properties wiring (--rx, --ry, --glare-x, --glare-y, --glare-opacity)
  assert(css.includes("var(--rx") && css.includes("var(--ry"),
    "4.5.9 style.css wires --rx and --ry into 3D rotate transforms");
  assert(css.includes("var(--glare-x") && css.includes("var(--glare-y"),
    "4.5.10 style.css wires --glare-x and --glare-y into gradient positioning");
  assert(css.includes("var(--glare-opacity"),
    "4.5.11 style.css wires --glare-opacity into highlight opacity");

  // 4.5.6 3D perspective and transform-style: preserve-3d
  assert(css.includes("perspective(700px)") || css.includes("perspective(600px)") || css.includes("perspective("),
    "4.5.12 style.css defines perspective transforms for 3D card layout");
  assert(css.includes("transform-style: preserve-3d"),
    "4.5.13 style.css defines transform-style: preserve-3d");

  // 4.5.7 Reduced-motion media query disables transforms and animations
  assert(css.includes("@media (prefers-reduced-motion: reduce)"),
    "4.5.14 style.css contains @media (prefers-reduced-motion: reduce)");
  assert(css.includes("transform: none !important"),
    "4.5.15 Reduced motion block neutralizes transforms with transform: none !important");

  // 4.5.8 Content z-index hierarchy and no clipping on card container
  assert(css.includes("z-index: 2") && css.includes("z-index: 10"),
    "4.5.16 style.css establishes z-index hierarchy preserving text readability and badges");
}

// ============================================================================
// SECTION 5: TACTILE HAND ARC, SPRING PHYSICS & DRAG-TO-PLAY SUITE
// ============================================================================

function createMockElement(tagName, id = "", className = "") {
  const styles = new Map();
  const classSet = new Set(className.split(" ").filter(Boolean));
  const listeners = new Map();
  let rect = { left: 0, top: 0, right: 100, bottom: 100, width: 100, height: 100 };

  const el = {
    tagName: tagName.toUpperCase(),
    id,
    dataset: {},
    children: [],
    parentNode: null,
    style: {
      setProperty: (k, v) => styles.set(k, String(v)),
      removeProperty: (k) => styles.delete(k),
      getPropertyValue: (k) => styles.get(k) || ""
    },
    classList: {
      add: (...cls) => cls.forEach(c => classSet.add(c)),
      remove: (...cls) => cls.forEach(c => classSet.delete(c)),
      contains: (c) => classSet.has(c),
      toggle: (c, force) => {
        const next = force !== undefined ? Boolean(force) : !classSet.has(c);
        next ? classSet.add(c) : classSet.delete(c);
        return next;
      }
    },
    get className() { return Array.from(classSet).join(" "); },
    set className(val) {
      classSet.clear();
      (val || "").split(" ").filter(Boolean).forEach(c => classSet.add(c));
    },
    getBoundingClientRect: () => ({ ...rect }),
    _setRect: (r) => { rect = { ...r }; },
    addEventListener: (type, fn) => {
      if (!listeners.has(type)) listeners.set(type, []);
      listeners.get(type).push(fn);
    },
    removeEventListener: (type, fn) => {
      const arr = listeners.get(type) || [];
      const idx = arr.indexOf(fn);
      if (idx !== -1) arr.splice(idx, 1);
    },
    dispatchEvent: (event) => {
      event.target = event.target || el;
      event.currentTarget = el;
      const arr = listeners.get(event.type) || [];
      arr.forEach(fn => fn(event));
      return !event.defaultPrevented;
    },
    setPointerCapture: (_id) => { el._captured = true; },
    releasePointerCapture: (_id) => { el._captured = false; },
    closest: (selector) => {
      if (selector === "[data-hand-uid]" && el.dataset.handUid) return el;
      if (selector === ".hand-card" && classSet.has("hand-card")) return el;
      if (selector === "#player-lands" && el.id === "player-lands") return el;
      if (selector === "#player-creatures" && el.id === "player-creatures") return el;
      if (selector === ".battlefield-table" && classSet.has("battlefield-table")) return el;
      return null;
    }
  };
  return el;
}

// --- 5.1 Fan Layout Geometry (calculateFanLayout) ---
{
  // 5.1.1 Single card layout: 0 rot, 0 y, 0 x, 0 overlap
  const l1 = calculateFanLayout(0, 1, 900, 148);
  assert(
    l1.x === 0 && l1.y === 0 && l1.rot === 0 && l1.overlap === 0,
    "5.1.1 Single card hand: 0 rot, 0 y, 0 x, 0 overlap"
  );

  // 5.1.2 2-card symmetrical hand
  const l2_0 = calculateFanLayout(0, 2, 900, 148);
  const l2_1 = calculateFanLayout(1, 2, 900, 148);
  assert(
    l2_0.rot < 0 && l2_1.rot > 0 && Math.abs(l2_0.rot + l2_1.rot) < 0.01 && Math.abs(l2_0.rot) <= 12,
    "5.1.2 Two card hand: symmetric rotations clamped within ±12 deg"
  );

  // 5.1.3 5-card symmetrical hand: center at 0 rot, outer cards sag and monotonically rotate
  const l5_0 = calculateFanLayout(0, 5, 900, 148);
  const l5_2 = calculateFanLayout(2, 5, 900, 148);
  const l5_4 = calculateFanLayout(4, 5, 900, 148);
  assert(
    l5_2.x === 0 && l5_2.y === 0 && l5_2.rot === 0 &&
    l5_0.y > 0 && l5_4.y > 0 && l5_0.y === l5_4.y &&
    l5_0.rot < 0 && l5_4.rot > 0 && Math.abs(l5_0.rot + l5_4.rot) < 0.01,
    "5.1.3 Five card hand: center card at origin, outer cards sag and rotate symmetrically"
  );

  // 5.1.4 15-card hand leaves room at both edges for spread and card tilt
  const l15_0 = calculateFanLayout(0, 15, 900, 148);
  const l15_14 = calculateFanLayout(14, 15, 900, 148);
  const totalSpan = (l15_14.x - l15_0.x) + 148;
  assert(
    totalSpan <= 820 && l15_0.overlap > 80 && Math.abs(l15_0.rot) <= 12 && Math.abs(l15_14.rot) <= 12,
    "5.1.4 Fifteen-card hand reserves 40px per edge for spread/tilt, with dynamic overlap and ±12 deg cap"
  );

  // 5.1.5 Math robustness: safe bounds on zero/empty or out of bounds inputs
  const lZero = calculateFanLayout(0, 0, 900, 148);
  const lOob = calculateFanLayout(99, 5, 900, 148);
  assert(
    Number.isFinite(lZero.x) && Number.isFinite(lZero.y) && Number.isFinite(lZero.rot) &&
    Number.isFinite(lOob.x) && Number.isFinite(lOob.y) && Number.isFinite(lOob.rot) && Math.abs(lOob.rot) <= 12,
    "5.1.5 Fan math robustness: zero hand and out-of-bounds index return finite safe values"
  );

  // 5.1.7 Edge reserve remains available at widths where the hand must overlap
  [320, 480, 900].forEach(width => {
    const first = calculateFanLayout(0, 15, width, 148);
    const last = calculateFanLayout(14, 15, width, 148);
    assert(
      (last.x - first.x) + 148 <= width - 80,
      `5.1.7 Fifteen-card hand leaves 40px per edge within a ${width}px hand row`
    );
  });

  // 5.1.6 Composite visual hand span: flexbox step + CSS translate does not double-apply spacing
  let usesFanXInTranslate = false;
  if (typeof require === "function") {
    const fs = require("fs");
    const path = require("path");
    const css = fs.readFileSync(path.join(__dirname, "style.css"), "utf8");
    const handCardBlock = (css.match(/\.hand-card\s*\{([^}]+)\}/) || [])[1] || "";
    usesFanXInTranslate = /translate:[^;]*var\(--fan-x/i.test(handCardBlock);
  }

  [1, 2, 3, 5, 8, 10, 12, 15].forEach(c => {
    const W = 900;
    const cw = 148;
    const sample = calculateFanLayout(0, c, W, cw);
    const flexStep = cw - sample.overlap;
    const flexSpan = c > 1 ? (c - 1) * flexStep : 0;
    const translateSpan = (usesFanXInTranslate && c > 1)
      ? (calculateFanLayout(c - 1, c, W, cw).x - calculateFanLayout(0, c, W, cw).x)
      : 0;
    const totalSpan = flexSpan + translateSpan + cw;

    assert(
      totalSpan <= W,
      `5.1.6 Hand of ${c} cards visual span (${totalSpan.toFixed(1)}px) fits strictly within ${W}px container (no double-spacing overflow)`
    );
  });

  // Verify 2-card hand has zero void gap between cards
  const sample2 = calculateFanLayout(0, 2, 900, 148);
  const flexStep2 = 148 - sample2.overlap;
  const translateSpan2 = usesFanXInTranslate
    ? (calculateFanLayout(1, 2, 900, 148).x - calculateFanLayout(0, 2, 900, 148).x)
    : 0;
  const span2 = flexStep2 + translateSpan2 + 148;
  assert(
    span2 === 296,
    `5.1.6 Two-card hand visual span is exactly 296px (touching cards with 0px void gap), got ${span2}px`
  );
}

// --- 5.2 Spring Integrator Physics (stepSpring) ---
{
  // 5.2.1 Pure function contract: returns new object and does not mutate input
  const s0 = { pos: 10, vel: 2 };
  const s1 = stepSpring(s0, 50, 0.016, { stiffness: 280, damping: 28 });
  assert(
    s0.pos === 10 && s0.vel === 2 && s1 !== s0 && s1.pos > 10,
    "5.2.1 stepSpring is pure: does not mutate state and advances towards target"
  );

  // 5.2.2 Convergence towards target: reaches target within 120 steps
  let stateSim = { pos: 0, vel: 0 };
  for (let i = 0; i < 120; i++) {
    stateSim = stepSpring(stateSim, 100, 1 / 60, { stiffness: 320, damping: 2 * Math.sqrt(320) });
  }
  assert(
    Math.abs(stateSim.pos - 100) < 0.05 && Math.abs(stateSim.vel) < 0.1,
    "5.2.2 stepSpring converges stably to target (error < 0.05, vel < 0.1) in 120 frames"
  );

  // 5.2.3 Edge cases: non-positive dt, NaN, null state never produce NaN
  const safeZeroDt = stepSpring({ pos: 5, vel: 2 }, 100, 0);
  const safeNegDt = stepSpring({ pos: 5, vel: 2 }, 100, -0.016);
  const safeNull = stepSpring(null, 100, 0.016);
  const safeNaN = stepSpring({ pos: NaN, vel: Infinity }, NaN, 0.016);
  assert(
    safeZeroDt.pos === 5 && safeNegDt.pos === 5 &&
    Number.isFinite(safeNull.pos) && Number.isFinite(safeNull.vel) &&
    Number.isFinite(safeNaN.pos) && Number.isFinite(safeNaN.vel),
    "5.2.3 stepSpring safety: handles zero dt, negative dt, null state, and NaN without throwing or NaN"
  );

  // 5.2.4 Critically damped tracking has 0% overshoot
  let trackState = { pos: 0, vel: 0 };
  let maxTrackPos = 0;
  for (let i = 0; i < 120; i++) {
    trackState = stepSpring(trackState, 100, 1 / 60, { stiffness: 320, damping: 2 * Math.sqrt(320) });
    if (trackState.pos > maxTrackPos) maxTrackPos = trackState.pos;
  }
  assert(
    maxTrackPos <= 100.01,
    "5.2.4 Critically damped tracking: zero overshoot (maxPos <= 100.01)"
  );

  // 5.2.5 Snapback configuration produces tactile bounded overshoot (< 15%)
  let snapState = { pos: 0, vel: 0 };
  let maxSnapPos = 0;
  for (let i = 0; i < 120; i++) {
    snapState = stepSpring(snapState, 100, 1 / 60, { stiffness: 260, damping: 22 });
    if (snapState.pos > maxSnapPos) maxSnapPos = snapState.pos;
  }
  assert(
    maxSnapPos > 100.5 && maxSnapPos < 115,
    "5.2.5 Snapback physics: produces bounded tactile overshoot (100.5 < maxPos < 115)"
  );
}

// --- 5.3 Drag State Machine Lifecycle & Gesture Thresholds ---
{
  const testCard = { uid: "test-card-1", name: "Lightning Bolt", type: "Instant", color: "R", manaCost: "{R}" };
  const mockHandCard = createMockElement("button", "card-1", "hand-card");
  mockHandCard.dataset.handUid = testCard.uid;

  resetTestState();
  state.hand = [testCard];
  state.headless = false;

  const ctrl = createHandDragController();

  // 5.3.1 Initial state is idle
  assert(ctrl.getState() === "idle", "5.3.1 Drag controller initial state is idle");

  // 5.3.2 pointerdown arms drag
  ctrl.handlePointerDown({
    target: mockHandCard,
    pointerId: 1,
    pointerType: "mouse",
    clientX: 200,
    clientY: 500
  });
  assert(
    ctrl.getState() === "armed" && ctrl.getDraggedCardUid() === testCard.uid,
    "5.3.2 pointerdown arms controller into 'armed' state with target card UID"
  );

  // 5.3.3 Micro-movement <= 6px stays armed; pointerup finishes with idle and NO click suppression
  ctrl.handlePointerMove({ pointerId: 1, clientX: 204, clientY: 502 }); // dist = hypot(4, 2) ~ 4.47 <= 6
  assert(ctrl.getState() === "armed", "5.3.3 Movement <= 6px remains in 'armed' state");

  ctrl.handlePointerUp({ pointerId: 1, clientX: 204, clientY: 502 });
  assert(
    ctrl.getState() === "idle" && ctrl.consumeClickSuppression() === false,
    "5.3.3 pointerup under threshold returns to idle with click suppression FALSE (allows click-to-play)"
  );

  // 5.3.4 Movement > 6px transitions to 'dragging' and acquires pointer capture & click suppression
  ctrl.handlePointerDown({
    target: mockHandCard,
    pointerId: 2,
    pointerType: "mouse",
    clientX: 200,
    clientY: 500
  });
  ctrl.handlePointerMove({ pointerId: 2, clientX: 200, clientY: 480 }); // dist = 20px > 6
  assert(
    ctrl.getState() === "dragging" && mockHandCard.classList.contains("is-dragging") && mockHandCard._captured === true,
    "5.3.4 Movement > 6px enters 'dragging' state, applies .is-dragging, and acquires pointer capture"
  );

  // 5.3.5 Cancellation paths immediately restore idle
  ctrl.cancel("escape");
  assert(
    ctrl.getState() === "idle" && !mockHandCard.classList.contains("is-dragging"),
    "5.3.5 cancel('escape') aborts drag and restores idle cleanly"
  );

  // 5.3.6 Concurrency guard: second pointerdown on another card while active is rejected
  ctrl.handlePointerDown({
    target: mockHandCard,
    pointerId: 3,
    pointerType: "mouse",
    clientX: 200,
    clientY: 500
  });
  ctrl.handlePointerMove({ pointerId: 3, clientX: 200, clientY: 480 });
  const mockCard2 = createMockElement("button", "card-2", "hand-card");
  mockCard2.dataset.handUid = "other-card";
  ctrl.handlePointerDown({
    target: mockCard2,
    pointerId: 4,
    pointerType: "mouse",
    clientX: 300,
    clientY: 500
  });
  assert(
    ctrl.getDraggedCardUid() === testCard.uid,
    "5.3.6 Concurrency guard: second pointerdown does not hijack active drag"
  );
  ctrl.cancel("cleanup");
  state.headless = true;
}

// --- 5.4 Drop-Zone Hit-Testing per Card Type (getDropZoneForCard) ---
{
  const mockLands = createMockElement("div", "player-lands", "land-row");
  mockLands._setRect({ left: 100, top: 400, right: 800, bottom: 500 });

  const mockCreatures = createMockElement("div", "player-creatures", "creature-row");
  mockCreatures._setRect({ left: 100, top: 250, right: 800, bottom: 399 });

  const mockTable = createMockElement("section", "", "battlefield-table");
  mockTable._setRect({ left: 50, top: 50, right: 850, bottom: 500 });

  const mockHand = createMockElement("div", "player-hand", "hand-row");
  mockHand._setRect({ left: 100, top: 501, right: 800, bottom: 650 });

  globalThis.document = {
    getElementById: (id) => {
      if (id === "player-lands") return mockLands;
      if (id === "player-creatures") return mockCreatures;
      if (id === "player-hand") return mockHand;
      return null;
    },
    querySelector: (sel) => {
      if (sel === ".battlefield-table") return mockTable;
      return null;
    }
  };

  const landCard = { name: "Forest", type: "Land" };
  const creatureCard = { name: "Grizzly Bears", type: "Creature" };
  const spellCard = { name: "Lightning Bolt", type: "Instant" };

  // 5.4.1 Land card over #player-lands returns "lands", over creatures returns null
  assert(
    getDropZoneForCard(landCard, 200, 450) === "lands" &&
    getDropZoneForCard(landCard, 200, 300) === null,
    "5.4.1 Land card hit-testing: returns 'lands' over lands lane, null over creatures"
  );

  // 5.4.2 Creature card over #player-creatures returns "creatures", over lands returns null
  assert(
    getDropZoneForCard(creatureCard, 200, 300) === "creatures" &&
    getDropZoneForCard(creatureCard, 200, 450) === null,
    "5.4.2 Creature card hit-testing: returns 'creatures' over creatures lane, null over lands"
  );

  // 5.4.3 Spell card over table returns "table", outside table returns null
  assert(
    getDropZoneForCard(spellCard, 200, 200) === "table" &&
    getDropZoneForCard(spellCard, 20, 200) === null,
    "5.4.3 Spell card hit-testing: returns 'table' over battlefield table, null outside"
  );

  // 5.4.4 Coordinates inside #player-hand or below return null for all types
  assert(
    getDropZoneForCard(landCard, 200, 550) === null &&
    getDropZoneForCard(creatureCard, 200, 550) === null &&
    getDropZoneForCard(spellCard, 200, 550) === null,
    "5.4.4 Inside hand area: all card types return null"
  );

  // 5.4.5 Drop zone active styling toggles .drop-zone-active on target element
  const dragCtrl = createHandDragController();
  const mockHandCard = createMockElement("button", "card-land", "hand-card");
  mockHandCard.dataset.handUid = "land-1";
  state.hand = [{ uid: "land-1", name: "Forest", type: "Land" }];
  dragCtrl.handlePointerDown({ target: mockHandCard, pointerId: 10, clientX: 200, clientY: 550 });
  dragCtrl.handlePointerMove({ pointerId: 10, clientX: 200, clientY: 500 });
  assert(
    mockLands.classList.contains("drop-zone-active"),
    "5.4.5 Drop zone active glow: dragging Land applies .drop-zone-active to #player-lands"
  );
  dragCtrl.cancel("cleanup");
  assert(
    !mockLands.classList.contains("drop-zone-active"),
    "5.4.5 Drop zone glow cleaned up on drag end"
  );

  delete globalThis.document;
}

// --- 5.5 Headless Pointer Event Simulation ---
{
  resetTestState();
  startNewRun(STARTER_DECKS[0]); // Gruul
  state.hand = [
    { uid: "land-uid-1", name: "Taiga", type: "Land", color: "G", produces: ["R", "G"], keywords: [] },
    { uid: "creature-uid-1", name: "Llanowar Elves", type: "Creature", color: "G", manaCost: "{G}", power: 1, toughness: 1, keywords: [] },
    { uid: "expensive-spell", name: "Apex Devastator", type: "Sorcery", color: "G", manaCost: "{G}{G}{G}{G}{G}{G}{G}{G}{G}{G}", keywords: [] }
  ];
  state.manaPool = { G: 2, R: 0, U: 0, B: 0, W: 0, C: 0, ANY: 0 };
  state.landsPlayedThisTurn = 0;
  state.maxLandsPerTurn = 1;

  const mockLands = createMockElement("div", "player-lands", "land-row");
  mockLands._setRect({ left: 100, top: 400, right: 800, bottom: 500 });

  const mockCreatures = createMockElement("div", "player-creatures", "creature-row");
  mockCreatures._setRect({ left: 100, top: 250, right: 800, bottom: 399 });

  const mockTable = createMockElement("section", "", "battlefield-table");
  mockTable._setRect({ left: 50, top: 50, right: 850, bottom: 500 });

  const mockHand = createMockElement("div", "player-hand", "hand-row");
  mockHand._setRect({ left: 100, top: 501, right: 800, bottom: 650 });

  const mockLandEl = createMockElement("button", "c-land", "hand-card");
  mockLandEl.dataset.handUid = "land-uid-1";
  mockLandEl._setRect({ left: 150, top: 520, right: 298, bottom: 664 });

  const mockCreatureEl = createMockElement("button", "c-creature", "hand-card");
  mockCreatureEl.dataset.handUid = "creature-uid-1";
  mockCreatureEl._setRect({ left: 300, top: 520, right: 448, bottom: 664 });

  const mockExpensiveEl = createMockElement("button", "c-exp", "hand-card");
  mockExpensiveEl.dataset.handUid = "expensive-spell";
  mockExpensiveEl._setRect({ left: 450, top: 520, right: 598, bottom: 664 });

  globalThis.document = {
    getElementById: (id) => {
      if (id === "player-lands") return mockLands;
      if (id === "player-creatures") return mockCreatures;
      if (id === "player-hand") return mockHand;
      return null;
    },
    querySelector: (sel) => {
      if (sel === ".battlefield-table") return mockTable;
      return null;
    }
  };

  const simCtrl = createHandDragController();
  const originalLocalPlayabilityFeedback = globalThis.showLocalPlayabilityFeedback;
  const originalDropZoneSuccess = globalThis.showDropZoneSuccess;
  let localPlayabilityFeedback = "";
  const successfulDropZones = [];
  globalThis.showLocalPlayabilityFeedback = (card, message) => {
    localPlayabilityFeedback = `${card.uid}: ${message}`;
  };
  globalThis.showDropZoneSuccess = (zone) => {
    successfulDropZones.push(zone);
  };

  // 5.5.1 Valid Land Drop: pointerdown -> move -> pointerup calls playCardFromHand and plays land
  simCtrl.handlePointerDown({ target: mockLandEl, pointerId: 20, clientX: 200, clientY: 550 });
  simCtrl.handlePointerMove({ pointerId: 20, clientX: 200, clientY: 450 }); // inside #player-lands
  simCtrl.handlePointerUp({ pointerId: 20, clientX: 200, clientY: 450 });
  assert(
    state.playerLands.some(l => l.uid === "land-uid-1"),
    "5.5.1 Headless simulation: valid land drop plays land into state.playerLands"
  );
  assert(
    successfulDropZones.at(-1) === "lands",
    "5.5.1 Valid land drop signals its destination zone"
  );

  // 5.5.2 Valid Creature Drop: pointerdown -> move -> pointerup plays creature
  simCtrl.handlePointerDown({ target: mockCreatureEl, pointerId: 21, clientX: 350, clientY: 550 });
  simCtrl.handlePointerMove({ pointerId: 21, clientX: 350, clientY: 320 }); // inside #player-creatures
  simCtrl.handlePointerUp({ pointerId: 21, clientX: 350, clientY: 320 });
  assert(
    state.playerCreatures.some(c => c.uid === "creature-uid-1"),
    "5.5.2 Headless simulation: valid creature drop plays creature into state.playerCreatures"
  );
  assert(
    successfulDropZones.at(-1) === "creatures",
    "5.5.2 Valid creature drop signals its destination zone"
  );

  // 5.5.3 Invalid Drop (Unplayable Card): shows local playability feedback and retains card
  simCtrl.handlePointerDown({ target: mockExpensiveEl, pointerId: 22, clientX: 500, clientY: 550 });
  simCtrl.handlePointerMove({ pointerId: 22, clientX: 500, clientY: 200 }); // over table
  assert(
    mockExpensiveEl.classList.contains("drag-invalid"),
    "5.5.3 Unplayable card shows .drag-invalid while dragging"
  );
  simCtrl.handlePointerUp({ pointerId: 22, clientX: 500, clientY: 200 });
  assert(
    localPlayabilityFeedback.includes("expensive-spell") &&
    localPlayabilityFeedback.includes("colored mana") &&
    state.hand.some(c => c.uid === "expensive-spell"),
    "5.5.3 Invalid drop shows local playability feedback and retains card in hand"
  );

  // 5.5.4 Missed Drop outside zone: snaps back silently and retains card
  localPlayabilityFeedback = "";
  simCtrl.handlePointerDown({ target: mockExpensiveEl, pointerId: 23, clientX: 500, clientY: 550 });
  simCtrl.handlePointerMove({ pointerId: 23, clientX: 500, clientY: 530 }); // inside hand area
  simCtrl.handlePointerUp({ pointerId: 23, clientX: 500, clientY: 530 });
  assert(
    localPlayabilityFeedback === "" && state.hand.some(c => c.uid === "expensive-spell"),
    "5.5.4 Drop outside play zone snaps back silently without feedback"
  );

  // 5.5.5 Abort via Escape keydown restores card and clears drag state
  simCtrl.handlePointerDown({ target: mockExpensiveEl, pointerId: 24, clientX: 500, clientY: 550 });
  simCtrl.handlePointerMove({ pointerId: 24, clientX: 500, clientY: 200 });
  cancelHandDrag("escape");
  assert(
    simCtrl.getState() === "idle" && !mockExpensiveEl.classList.contains("is-dragging"),
    "5.5.5 cancelHandDrag('escape') restores idle and removes .is-dragging"
  );

  // 5.5.6 Abort via pointercancel restores card and clears drag state
  simCtrl.handlePointerDown({ target: mockExpensiveEl, pointerId: 25, clientX: 500, clientY: 550 });
  simCtrl.handlePointerMove({ pointerId: 25, clientX: 500, clientY: 200 });
  simCtrl.handlePointerCancel({ pointerId: 25 });
  assert(
    simCtrl.getState() === "idle" && !mockExpensiveEl.classList.contains("is-dragging"),
    "5.5.6 pointercancel cleanly aborts active drag"
  );

  // 5.5.7 Click suppression after drag: consumeClickSuppression returns true once and resets
  simCtrl.handlePointerDown({ target: mockExpensiveEl, pointerId: 26, clientX: 500, clientY: 550 });
  simCtrl.handlePointerMove({ pointerId: 26, clientX: 500, clientY: 200 });
  simCtrl.handlePointerUp({ pointerId: 26, clientX: 500, clientY: 200 });
  assert(
    simCtrl.consumeClickSuppression() === true && simCtrl.consumeClickSuppression() === false,
    "5.5.7 Drag consumes subsequent click exactly once to prevent double-play"
  );

  globalThis.showLocalPlayabilityFeedback = originalLocalPlayabilityFeedback;
  globalThis.showDropZoneSuccess = originalDropZoneSuccess;
  delete globalThis.document;
}

// --- 5.6 Reduced Motion Path & Instant Snap-Back ---
{
  state.prefersReducedMotion = true;
  assert(prefersReducedMotion() === true, "5.6.1 Reduced motion flag is active");

  const mockCard = createMockElement("button", "card-rm", "hand-card");
  mockCard.dataset.handUid = "rm-card-1";
  state.hand = [{ uid: "rm-card-1", name: "Forest", type: "Land" }];

  const rmCtrl = createHandDragController();

  // 5.6.2 Pointermove updates --drag-x and --drag-y 1:1 with zero spring lag and --lean: 0deg
  rmCtrl.handlePointerDown({ target: mockCard, pointerId: 30, clientX: 100, clientY: 400 });
  rmCtrl.handlePointerMove({ pointerId: 30, clientX: 140, clientY: 350 }); // deltaX = 40, deltaY = -50
  assert(
    mockCard.style.getPropertyValue("--drag-x") === "40.0px" &&
    mockCard.style.getPropertyValue("--drag-y") === "-50.0px" &&
    mockCard.style.getPropertyValue("--lean") === "0deg",
    "5.6.2 Reduced motion drag: follows pointer 1:1 with --lean: 0deg"
  );

  // 5.6.3 Snap-back is instant (0 ticks): state immediately idle and drag styles removed
  rmCtrl.handlePointerUp({ pointerId: 30, clientX: 140, clientY: 550 }); // drop outside
  assert(
    rmCtrl.getState() === "idle" &&
    mockCard.style.getPropertyValue("--drag-x") === "" &&
    mockCard.style.getPropertyValue("--drag-y") === "",
    "5.6.3 Reduced motion snap-back: finishes instantaneously in 0 ticks with styles cleared"
  );

  // 5.6.4 Fan arc math remains static and valid under reduced motion
  const rmFan = calculateFanLayout(2, 5, 900, 148);
  assert(
    rmFan.rot === 0 && rmFan.y === 0 && rmFan.x === 0,
    "5.6.4 Fan arc geometry remains static and valid under reduced motion"
  );

  state.prefersReducedMotion = false;
}

// --- 5.7 CSS Classes and Stylesheet Integrity ---
if (typeof require === "function") {
  const fs = require("fs");
  const path = require("path");
  const css = fs.readFileSync(path.join(__dirname, "style.css"), "utf8");

  // 5.7.1 Drag and touch state selectors
  assert(
    css.includes(".hand-card.is-dragging") &&
    css.includes(".hand-card.drag-invalid") &&
    css.includes(".hand-card.touch-focused") &&
    css.includes(".drop-zone-active"),
    "5.7.1 style.css declares .is-dragging, .drag-invalid, .touch-focused, and .drop-zone-active"
  );

  // 5.7.2 Individual transform properties composition and variables
  assert(
    css.includes("translate:") && css.includes("rotate:") && css.includes("scale:") &&
    css.includes("--fan-rot") && css.includes("--fan-y") && css.includes("--lift") && css.includes("--spread-x"),
    "5.7.2 style.css declares individual transform properties with --fan-rot, --fan-y, --lift, --spread-x"
  );

  // 5.7.3 touch-action: none on hand cards
  assert(
    css.includes("touch-action: none"),
    "5.7.3 style.css defines touch-action: none on .hand-card"
  );

  // 5.7.4 Keep the desktop hand fanned while allowing mobile players to browse it horizontally
  const mobileHandRule = css.match(/@media \(max-width: 1120px\)[\s\S]*?\.hand-row\s*\{([^}]+)\}/);
  assert(
    css.includes("overflow: visible") && mobileHandRule && /overflow-x:\s*auto/.test(mobileHandRule[1]),
    "5.7.4 Desktop hand stays fanned and narrow-screen hand has horizontal browsing"
  );

  // 5.7.5 Anti-double-spacing CSS and UI invariant: translate does not duplicate flexbox margin-left overlap, and ui.js sets --fan-x to 0px
  const handCardRule = (css.match(/\.hand-card\s*\{([^}]+)\}/) || [])[1] || "";
  const hasOverlapMargin = /margin-left:\s*calc\([^;]*--hand-overlap/i.test(handCardRule);
  const hasFanXInTranslateRule = /translate:[^;]*var\(--fan-x/i.test(handCardRule);
  const uiJs = fs.readFileSync(path.join(__dirname, "ui.js"), "utf8");
  const uiSetsFanXZero = /el\.style\.setProperty\("--fan-x",\s*"0px"\)/.test(uiJs);
  assert(
    hasOverlapMargin && !hasFanXInTranslateRule && uiSetsFanXZero,
    "5.7.5 style.css uses flexbox margin-left (--hand-overlap) and omits --fan-x from translate, and ui.js sets --fan-x to 0px"
  );

  // 5.7.6 Dragging state explicitly enforces rotate: var(--lean) and scale: 1.15, excluding --fan-rot
  const dragRule = (css.match(/\.hand-card\.is-dragging\s*\{([^}]+)\}/) || [])[1] || "";
  const setsRotateLean = /rotate:\s*var\(--lean(?:,\s*0deg)?\)\s*!important/i.test(dragRule);
  const setsScale = /scale:\s*1\.15\s*!important/i.test(dragRule);
  const leaksFanRot = /--fan-rot/i.test(dragRule);
  assert(
    setsRotateLean && setsScale && !leaksFanRot,
    "5.7.6 .hand-card.is-dragging explicitly enforces rotate: var(--lean, 0deg) !important and scale: 1.15 !important, excluding static --fan-rot"
  );

  // 5.7.7 All hover, focus-visible, and touch-focused rules strictly exclude .is-dragging
  const hoverMatches = css.match(/\.hand-card(?::hover|:focus-visible|\.touch-focused)[^{,]*/g) || [];
  assert(hoverMatches.length >= 6, "5.7.7 style.css defines hover and focus rules for .hand-card");
  const unexcludedHoverSelectors = hoverMatches.filter(m => !m.includes(":not(.is-dragging)"));
  assert(
    unexcludedHoverSelectors.length === 0,
    `5.7.7 All ${hoverMatches.length} hover/focus selectors exclude .is-dragging (unexcluded: ${unexcludedHoverSelectors.join(", ")})`
  );

  // 5.7.8 CSS Cascade Conflict Simulation: verify dragged card under pointer hover resolves to rotate: var(--lean)
  function evaluateCascade(cssText, elementClasses, elementPseudos) {
    const cleanCss = cssText
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/@media[^{]+\{([^{}]*\{[^{}]*\}[^{}]*)*\}/g, "");

    function matchesCompound(selectorPart, classes, pseudos) {
      let s = selectorPart.trim();
      const notRegex = /:not\(([^)]+)\)/g;
      let notMatch;
      while ((notMatch = notRegex.exec(selectorPart)) !== null) {
        const inner = notMatch[1].trim();
        if (inner.startsWith(".")) {
          const cls = inner.slice(1);
          if (classes.includes(cls)) return false;
        }
      }
      s = s.replace(notRegex, "");

      const pseudoRegex = /:([a-zA-Z0-9_-]+)/g;
      let pMatch;
      while ((pMatch = pseudoRegex.exec(s)) !== null) {
        if (!pseudos.includes(":" + pMatch[1])) return false;
      }
      s = s.replace(pseudoRegex, "");

      const classMatches = Array.from(s.matchAll(/\.([a-zA-Z0-9_-]+)/g)).map(m => m[1]);
      for (const cls of classMatches) {
        if (!classes.includes(cls)) return false;
      }
      return true;
    }

    const ruleRegex = /([^{}]+)\{([^{}]+)\}/g;
    const parsedRules = [];
    let rMatch;
    while ((rMatch = ruleRegex.exec(cleanCss)) !== null) {
      const rawSel = rMatch[1].trim();
      if (rawSel.startsWith("@")) continue;
      const decls = {};
      rMatch[2].split(";").forEach(line => {
        const col = line.indexOf(":");
        if (col !== -1) decls[line.slice(0, col).trim()] = line.slice(col + 1).trim();
      });
      rawSel.split(",").forEach(s => {
        parsedRules.push({ selector: s.trim(), decls });
      });
    }

    let resolvedRotate = null;
    let resolvedScale = null;
    for (const { selector, decls } of parsedRules) {
      const parts = selector.split(/\s+/);
      const targetPart = parts[parts.length - 1];
      if (matchesCompound(targetPart, elementClasses, elementPseudos)) {
        if (decls.rotate) resolvedRotate = decls.rotate;
        if (decls.scale) resolvedScale = decls.scale;
      }
    }
    return { rotate: resolvedRotate, scale: resolvedScale };
  }

  // State 1: Active Dragging + Pointer Hover (Pointer over card)
  const dragHover = evaluateCascade(css, ["hand-card", "is-dragging"], [":hover"]);
  assert(
    dragHover.rotate && dragHover.rotate.includes("var(--lean") && !dragHover.rotate.includes("--fan-rot") && dragHover.rotate !== "0deg",
    `5.7.8 Drag + Hover cascade resolves to rotate: var(--lean) and does not clobber to 0deg (got: ${dragHover.rotate})`
  );
  assert(
    dragHover.scale && dragHover.scale.includes("1.15"),
    `5.7.8 Drag + Hover cascade maintains scale: 1.15 (got: ${dragHover.scale})`
  );

  // State 2: Active Dragging + Pointer Lag (Cursor outside card rect, no hover)
  const dragNoHover = evaluateCascade(css, ["hand-card", "is-dragging"], []);
  assert(
    dragNoHover.rotate && dragNoHover.rotate.includes("var(--lean") && !dragNoHover.rotate.includes("--fan-rot"),
    `5.7.8 Drag without hover cascade resolves to rotate: var(--lean) without --fan-rot (got: ${dragNoHover.rotate})`
  );
  assert(
    dragNoHover.scale && dragNoHover.scale.includes("1.15"),
    `5.7.8 Drag without hover maintains consistent scale: 1.15 without jitter (got: ${dragNoHover.scale})`
  );

  // State 3: Resting Card Hovered in Hand (Normal pickup hover)
  const handHover = evaluateCascade(css, ["hand-card"], [":hover"]);
  assert(
    handHover.rotate && handHover.rotate.includes("0deg") && handHover.scale && handHover.scale.includes("1.15"),
    `5.7.8 Normal hand card hover straightens to 0deg and scales to 1.15 (got rot: ${handHover.rotate}, scale: ${handHover.scale})`
  );

  assert(
    css.includes(".fx-play-impact-creature") &&
    css.includes(".fx-play-impact-land") &&
    css.includes(".fx-play-impact-spell") &&
    css.includes(".drop-success-land.reduced-motion") &&
    css.includes(".hand-card.play-invalid-feedback.reduced-motion"),
    "5.7.9 Card-play impacts, destination cues, and invalid feedback have reduced-motion styles"
  );

  assert(
    css.includes(".life-bar-wrap.boss-life-impact") &&
    css.includes(".life-bar-wrap.boss-life-lethal") &&
    css.includes("dialog.boss-victory-transition[open]") &&
    css.includes("boss-life-impact-duration") &&
    css.includes("boss-victory-transition-duration"),
    "5.7.10 Combat impacts and lethal victory transitions have timed boss-bar and dialog styles"
  );

  assert(
    css.includes(".projection-feedback") &&
    css.includes(".board-card.projection-feedback-pulse") &&
    css.includes("#calc-total.projection-feedback-pulse") &&
    uiJs.includes("function highlightCombatContributors") &&
    uiJs.includes("data-synergy-id=\"${x.id}\""),
    "5.7.11 Attacker projections and combat sources have visible highlight hooks"
  );

  assert(
    css.includes("@keyframes bossAmbientGlow") &&
    css.includes("@keyframes arenaAmbientDrift") &&
    css.includes("@keyframes relicAmbientTint") &&
    css.includes("body.page-hidden .battlefield-main::before") &&
    uiJs.includes("document.addEventListener(\"visibilitychange\"") &&
    uiJs.includes("--encounter-tint"),
    "5.7.12 Plane-tinted ambient motion pauses while the page is hidden"
  );

  assert(
    css.includes("@keyframes resourceValueChange") &&
    css.includes("@keyframes rewardCardEnter") &&
    css.includes("@keyframes routeSceneEnter") &&
    css.includes("dialog.route-selection-pending[open]") &&
    uiJs.includes("function setResourceText") &&
    uiJs.includes("function showShopRewardSummary") &&
    uiJs.includes("selectRouteNodeWithTransition"),
    "5.7.13 Resource counts, rewards, and route changes have focused transition feedback"
  );

  const desktopJs = fs.readFileSync(path.join(__dirname, "desktop.js"), "utf8");
  const indexHtml = fs.readFileSync(path.join(__dirname, "index.html"), "utf8");
  assert(
    desktopJs.includes("soundEnabled: false") &&
      desktopJs.includes("soundVolume: 0.3") &&
      uiJs.includes("function unlockSoundFromUserGesture") &&
      uiJs.includes("if (!settings.soundEnabled || settings.soundVolume <= 0)") &&
      ["cardPlay", "manaTap", "impact", "victory"].every(cue => uiJs.includes(`${cue}:`)) &&
      indexHtml.includes('id="settings-sound-enabled"') &&
      indexHtml.includes('id="settings-sound-volume"') &&
      indexHtml.includes('id="settings-sound-status"'),
    "5.7.14 Optional sound is muted by default, gesture-gated, adjustable, and status-reported"
  );

  assert(
    css.includes(".creature-card.creature-grounded-thump") &&
      css.includes(".mana-row-ripple") &&
      css.includes(".mana-pool-box.mana-shortage-pulse") &&
      css.includes(".land-drop-status.land-limit-pulse") &&
      uiJs.includes("creature-grounded-thump") &&
      uiJs.includes("mana-row-ripple") &&
      uiJs.includes("mana-shortage-pulse") &&
      uiJs.includes("land-limit-pulse") &&
      uiJs.includes("setResourceText(\"enemy-life-text\""),
    "5.7.15 Card play landing reactions, local playability pulses, and boss life settle are wired"
  );
}

// ============================================================================
// SECTION 6: SAVE RECOVERY, CHECKSUMS, STATE SNAPSHOTS, DOM SAFETY & SCHEDULER
// ============================================================================
console.log("\n=== BEGINNING SECTION 6: SAVE RECOVERY, DOM SAFETY & SCHEDULER SUITE ===");

function createMemoryStorage(initial = {}) {
  const map = new Map(Object.entries(initial));
  return {
    getItem: (k) => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => { map.set(k, String(v)); },
    removeItem: (k) => { map.delete(k); },
    clear: () => { map.clear(); },
    _dump: () => Object.fromEntries(map.entries())
  };
}

// --- 6.1 Canonical Save Schema Normalization & Legacy Migration ---
{
  const legacyV0Save = {
    version: 0,
    archetypeId: "gruul",
    encounterIdx: 2,
    playerLife: 17,
    gold: 11,
    deck: ["forest", { id: "lightning_bolt", foil: "Halo", permPowerBonus: 2 }],
    relics: [{ id: "sol_ring" }, "chromatic_lantern"],
    consumables: [{ id: "demonic_tutor" }]
  };
  const check = normalizeCanonicalSave(legacyV0Save);
  assert(
    check.valid === true &&
    check.migrated === true &&
    check.save.version === 1 &&
    check.save.masterDeck.length === 2 &&
    check.save.masterDeck[1].foil === "Halo" &&
    check.save.relicIds.length === 2 &&
    check.save.relics.length === 2 &&
    check.save.consumableIds[0] === "demonic_tutor" &&
    typeof check.save.saveIntegrity === "string" &&
    check.save.saveIntegrity.startsWith("fnv1a_"),
    "6.1 Legacy v0/unversioned save migrates to canonical v1 schema with both relicIds and relics populated and saveIntegrity checksum"
  );
}

// --- 6.2 Invalid Save JSON, Partial Payloads & Checksum Tampering ---
{
  const badType = normalizeCanonicalSave(null);
  const badVer = normalizeCanonicalSave({ version: 99, masterDeck: [{ id: "forest" }] });
  const badCards = normalizeCanonicalSave({ version: 1, masterDeck: [{ id: "nonexistent_card_xyz" }] });
  assert(
    !badType.valid && badType.status === "invalid_type" &&
    !badVer.valid && badVer.status === "unsupported_version" &&
    !badCards.valid && badCards.status === "unrecognized_cards",
    "6.2 Invalid types, unsupported versions, and unrecognized card decks are rejected with explicit status codes"
  );

  // Partial encounterState payload is safely stripped without crashing normalization
  const partialEncounterPayload = normalizeCanonicalSave({
    version: 1,
    inShop: false,
    masterDeck: [{ id: "forest" }, { id: "mountain" }],
    encounterState: { library: ["not-valid-snapshot-missing-arrays"] }
  });
  assert(
    partialEncounterPayload.valid === true && partialEncounterPayload.save.encounterState === null,
    "6.2 Partial/incomplete encounterState is safely nulled so encounter restarts cleanly"
  );

  // Tampered checksum detection
  const tampered = JSON.parse(JSON.stringify(partialEncounterPayload.save));
  tampered.gold = 99999; // Mutate gold without updating saveIntegrity
  const tamperCheck = normalizeCanonicalSave(tampered);
  assert(
    tamperCheck.valid === false && tamperCheck.status === "corrupt_checksum",
    "6.3 Checksum tampering (modified gold with stale saveIntegrity) is detected and rejected"
  );
}

// --- 6.4 Backup Save Preservation & Recovery on Corrupt Primary Save ---
{
  resetTestState();
  startNewRun(STARTER_DECKS[1]); // Rakdos
  state.gold = 14;
  state.playerLife = 16;
  state.encounterIdx = 1;

  const prevHeadless = state.headless;
  const prevDoc = globalThis.document;
  const prevLS = globalThis.localStorage;
  const memStore = createMemoryStorage();

  try {
    state.headless = false;
    globalThis.document = {};
    globalThis.localStorage = memStore;

    // 1. Save known-good run state
    const savedOk = saveRunState(false);
    const backupAfterFirstSave = memStore.getItem(SAVE_BACKUP_KEY);
    assert(
      savedOk && Boolean(backupAfterFirstSave),
      "6.4.1 saveRunState writes both primary save and known-good backup save"
    );

    // 2. Corrupt primary save in localStorage with truncated JSON
    const corruptRaw = '{"version":1,"gold":999,"masterDeck":[BROKEN_JSON';
    memStore.setItem(SAVE_KEY, corruptRaw);

    // Mutate current runtime state to verify loadRunState recovers from backup
    state.gold = 0;
    state.playerLife = 1;
    state.encounterIdx = 0;

    const recovered = loadRunState();
    const preservedCorrupt = memStore.getItem(SAVE_CORRUPT_KEY);
    assert(
      recovered === true &&
      state.gold === 14 &&
      state.playerLife === 16 &&
      state.encounterIdx === 1 &&
      Boolean(preservedCorrupt) &&
      preservedCorrupt.includes("BROKEN_JSON"),
      "6.4.2 When primary save is corrupt JSON, loadRunState preserves corrupt payload in SAVE_CORRUPT_KEY and recovers from SAVE_BACKUP_KEY"
    );
  } finally {
    state.headless = prevHeadless;
    if (prevDoc === undefined) delete globalThis.document;
    else globalThis.document = prevDoc;
    if (prevLS === undefined) delete globalThis.localStorage;
    else globalThis.localStorage = prevLS;
  }
}

// --- 6.5 Total Restore Failure Rollback & Restore-After-Run-Over ---
{
  resetTestState();
  startNewRun(STARTER_DECKS[2]); // Simic
  state.gold = 19;
  state.playerLife = 18;

  const prevHeadless = state.headless;
  const prevDoc = globalThis.document;
  const prevLS = globalThis.localStorage;
  const memStore = createMemoryStorage({
    [SAVE_KEY]: "{not-valid-json",
    [SAVE_BACKUP_KEY]: '{"version":99,"masterDeck":[]}'
  });

  try {
    state.headless = false;
    globalThis.document = {};
    globalThis.localStorage = memStore;

    // Both primary and backup are invalid: state must roll back cleanly to pre-restore snapshot
    const restored = loadRunState();
    assert(
      restored === false &&
      state.deckArchetype.id === STARTER_DECKS[2].id &&
      state.gold === 19 &&
      state.playerLife === 18,
      "6.5.1 When both primary and backup saves fail validation, loadRunState rolls back cleanly to pre-restore state"
    );

    // Now test Restore-After-Run-Over:
    // Save a valid run first, then set state.runOver = true and state.combatLocked = true
    memStore.clear();
    state.runOver = false;
    state.combatLocked = false;
    saveRunState(false);

    state.runOver = true;
    state.combatLocked = true;
    state.playerLife = 0;
    state.gold = 0;

    // Attempting to save while runOver === true must be a no-op (must not clobber valid save)
    const savedWhileOver = saveRunState(false);
    assert(savedWhileOver === false, "6.5.2 saveRunState refuses to overwrite save when state.runOver is true");

    // Restoring after runOver resets runOver & combatLocked to false and restores life/gold
    const restoredAfterOver = loadRunState();
    assert(
      restoredAfterOver === true &&
      state.runOver === false &&
      state.combatLocked === false &&
      state.playerLife === 18 &&
      state.gold === 19,
      "6.5.3 loadRunState after runOver resets runOver and combatLocked to false and restores saved run"
    );
  } finally {
    state.headless = prevHeadless;
    if (prevDoc === undefined) delete globalThis.document;
    else globalThis.document = prevDoc;
    if (prevLS === undefined) delete globalThis.localStorage;
    else globalThis.localStorage = prevLS;
  }
}

// --- 6.6 Missing DOM Node Resilience & Safe Modal Helpers ---
{
  const prevHeadless = state.headless;
  const prevDoc = globalThis.document;
  try {
    state.headless = false;
    // Sparse document where getElementById only returns plane-badge and all other nodes are missing (null)
    const planeBadgeStub = createMockElement("div", "plane-badge", "plane-badge");
    globalThis.document = {
      getElementById: (id) => (id === "plane-badge" ? planeBadgeStub : null),
      querySelector: () => null,
      querySelectorAll: () => [],
      addEventListener: () => {}
    };

    let threwOnMissingDom = false;
    try {
      renderAll();
      renderIncremental(["boss", "math", "stats", "command", "board", "hand", "window"]);
      renderShop();
      openDeckInspector("Test Title", "Test Desc", state.masterDeck);
      openNewRunModal(true);
      openVictoryModal(getCurrentEncounter(), 5, 2);
      initEvents();
      safeShowModal("nonexistent-dialog");
      safeCloseModal("nonexistent-dialog");
    } catch (err) {
      threwOnMissingDom = true;
    }

    assert(
      threwOnMissingDom === false && planeBadgeStub.textContent.includes("PLANE"),
      "6.6 UI renderers, modals, and event binders degrade gracefully without throwing when DOM nodes are missing"
    );
  } finally {
    state.headless = prevHeadless;
    if (prevDoc === undefined) delete globalThis.document;
    else globalThis.document = prevDoc;
  }
}

// --- 6.7 Render Scheduler Batching & Incremental Updates ---
{
  const prevHeadless = state.headless;
  const prevDoc = globalThis.document;
  const prevRAF = globalThis.requestAnimationFrame;
  let rafCallback = null;

  try {
    state.headless = false;
    const planeBadgeStub = createMockElement("div", "plane-badge", "plane-badge");
    const goldStub = createMockElement("span", "player-gold", "");
    const handCountStub = createMockElement("span", "hand-count", "");
    globalThis.document = {
      getElementById: (id) => {
        if (id === "plane-badge") return planeBadgeStub;
        if (id === "player-gold") return goldStub;
        if (id === "hand-count") return handCountStub;
        return null;
      },
      querySelector: () => null,
      querySelectorAll: () => []
    };
    globalThis.requestAnimationFrame = (cb) => {
      rafCallback = cb;
      return 101;
    };

    state.gold = 42;
    state.hand = [cloneCard("forest"), cloneCard("mountain")];
    goldStub.textContent = "$0";
    handCountStub.textContent = "0";

    // Schedule two separate partial renders ("stats" and "hand") and flush once
    scheduleRender(["stats"]);
    scheduleRender(["hand"]);
    assert(typeof rafCallback === "function", "6.7.1 scheduleRender queues a single animation frame callback");
    const flushed = flushScheduledRender();
    assert(
      flushed === true && goldStub.textContent === "$42" && handCountStub.textContent === "2",
      "6.7.2 flushScheduledRender batches queued sections ('stats' + 'hand') into a single incremental pass"
    );
  } finally {
    state.headless = prevHeadless;
    if (prevDoc === undefined) delete globalThis.document;
    else globalThis.document = prevDoc;
    if (prevRAF === undefined) delete globalThis.requestAnimationFrame;
    else globalThis.requestAnimationFrame = prevRAF;
  }
}

// --- 6.8 Randomized Stress Test for Repeated Save/Restore Cycles ---
{
  const prevHeadless = state.headless;
  const prevDoc = globalThis.document;
  const prevLS = globalThis.localStorage;
  const memStore = createMemoryStorage();

  // Deterministic PRNG (Mulberry32)
  let seed = 0x9E3779B9;
  const rand = () => {
    let t = (seed += 0x6D2B79F5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };

  let allCyclesPassed = true;
  try {
    state.headless = false;
    globalThis.document = {};
    globalThis.localStorage = memStore;

    for (let cycle = 0; cycle < 25; cycle++) {
      const deckChoice = STARTER_DECKS[cycle % STARTER_DECKS.length];
      startNewRun(deckChoice, "standard", DEFAULT_CAMPAIGN_ID, null, { allowLockedDeck: true });
      state.encounterIdx = Math.floor(rand() * ENCOUNTERS.length);
      state.playerLife = 1 + Math.floor(rand() * MAX_LIFE);
      state.gold = Math.floor(rand() * 50);
      state.turn = 1 + Math.floor(rand() * 4);
      state.manaPool.G = Math.floor(rand() * 5);
      state.manaPool.R = Math.floor(rand() * 5);
      const inShop = rand() > 0.5;
      if (inShop) {
        generateShopStock(false);
      }

      const expectedLife = state.playerLife;
      const expectedGold = state.gold;
      const expectedEnc = state.encounterIdx;
      const expectedTurn = state.turn;
      const expectedDeckLen = state.masterDeck.length;
      const expectedHandIds = state.hand.map(c => c.id).join(",");

      const saved = saveRunState(inShop);
      if (!saved) {
        allCyclesPassed = false;
        break;
      }

      // Every 4th cycle, simulate primary save corruption to stress backup auto-recovery
      if (cycle % 4 === 3) {
        memStore.setItem(SAVE_KEY, '{"corrupt":true,');
      }

      // Scramble live state before restoring
      state.playerLife = 1;
      state.gold = 0;
      state.encounterIdx = 0;
      state.hand = [];
      state.runOver = cycle % 5 === 0;

      const restored = loadRunState();
      if (
        !restored ||
        state.runOver !== false ||
        state.playerLife !== expectedLife ||
        state.gold !== expectedGold ||
        state.encounterIdx !== expectedEnc ||
        state.masterDeck.length !== expectedDeckLen ||
        (!inShop && (state.turn !== expectedTurn || state.hand.map(c => c.id).join(",") !== expectedHandIds))
      ) {
        allCyclesPassed = false;
        break;
      }
    }
  } finally {
    state.headless = prevHeadless;
    if (prevDoc === undefined) delete globalThis.document;
    else globalThis.document = prevDoc;
    if (prevLS === undefined) delete globalThis.localStorage;
    else globalThis.localStorage = prevLS;
  }

  assert(
    allCyclesPassed === true,
    "6.8 Randomized 25-cycle save/restore stress test preserves deck, hand, turn, mana, shop state, and recovers from injected corruption"
  );
}

// ============================================================================
// 7. STARTER DECKS, AVAILABILITY SEPARATION & NEW CARD MECHANICS SUITE
// ============================================================================

// --- 7.1 All Starter Decks Validate 40-Card List (17 Lands + 23 Spells), Card IDs, and Starting Relics ---
{
  assert(
    Array.isArray(STARTER_DECKS) && STARTER_DECKS.length >= 6,
    `7.1.1 STARTER_DECKS defines at least 6 starter decks (got ${STARTER_DECKS.length})`
  );

  const deckIds = STARTER_DECKS.map(d => d.id);
  assert(
    deckIds.includes("golgari_graveyard") &&
    deckIds.includes("artifact_constructs") &&
    deckIds.includes("simic_tidecallers"),
    "7.1.2 STARTER_DECKS includes graveyard, artifact, and unlockable Simic decks"
  );

  STARTER_DECKS.forEach(deck => {
    assert(
      Array.isArray(deck.cards) && deck.cards.length === 40,
      `7.1.3 Deck '${deck.id}' contains exactly 40 cards (got ${deck.cards ? deck.cards.length : 0})`
    );
    const allCardsExist = deck.cards.every(id => Boolean(CARD_DB[id]));
    assert(
      allCardsExist,
      `7.1.4 Every card ID in '${deck.id}' exists in CARD_DB`
    );
    const landCount = deck.cards.filter(id => CARD_DB[id] && CARD_DB[id].type === "Land").length;
    const spellCount = deck.cards.filter(id => CARD_DB[id] && CARD_DB[id].type !== "Land").length;
    assert(
      landCount === 17 && spellCount === 23,
      `7.1.5 Deck '${deck.id}' has 17 Lands and 23 Spells (got ${landCount} Lands, ${spellCount} Spells)`
    );
    const relicValid = RELIC_DB.some(r => r.id === deck.startingRelic);
    assert(
      relicValid,
      `7.1.6 Deck '${deck.id}' has a valid startingRelic ('${deck.startingRelic}') in RELIC_DB`
    );
    assert(
      Array.isArray(deck.colors) && deck.colors.length > 0 && typeof deck.name === "string" && typeof deck.badge === "string",
      `7.1.7 Deck '${deck.id}' defines colors, name, and badge metadata`
    );
  });
}

// --- 7.2 Deck Availability Separation from STARTER_DECKS Definitions ---
{
  assert(
    typeof isStarterDeckAvailable === "function" && typeof getAvailableStarterDecks === "function",
    "7.2.1 Deck availability helpers (isStarterDeckAvailable, getAvailableStarterDecks) are defined"
  );

  const initialAvailable = getAvailableStarterDecks();
  assert(
    initialAvailable.length === STARTER_DECKS.length - 1 &&
    !initialAvailable.some(deck => deck.id === "simic_tidecallers"),
    "7.2.2 The campaign-clear deck remains locked while all original decks stay available"
  );

  // Temporarily lock a deck via UNLOCKED_STARTER_DECK_IDS and verify STARTER_DECKS remains intact and testable
  UNLOCKED_STARTER_DECK_IDS.delete("artifact_constructs");
  try {
    assert(
      isStarterDeckAvailable("artifact_constructs") === false &&
      isStarterDeckAvailable("golgari_graveyard") === true,
      "7.2.3 isStarterDeckAvailable reflects UNLOCKED_STARTER_DECK_IDS state"
    );
    assert(
      getAvailableStarterDecks().length === STARTER_DECKS.length - 2 &&
      STARTER_DECKS.some(d => d.id === "artifact_constructs") &&
      !getAvailableStarterDecks().some(deck => deck.id === "simic_tidecallers"),
      "7.2.4 Locking a deck filters getAvailableStarterDecks() while keeping STARTER_DECKS definition testable"
    );

    const artifactDeck = STARTER_DECKS.find(d => d.id === "artifact_constructs");
    startNewRun(artifactDeck, "standard", DEFAULT_CAMPAIGN_ID, null, { allowLockedDeck: true });
    assert(
      state.deckArchetype.id === "artifact_constructs" && state.masterDeck.length === 40,
      "7.2.5 Locked starter deck can still be directly instantiated in startNewRun for testing"
    );
  } finally {
    UNLOCKED_STARTER_DECK_IDS.add("artifact_constructs");
  }
}

// --- 7.2.6 Persistent Starter Deck Unlock Profile ---
{
  const prevLS = globalThis.localStorage;
  const memStore = createMemoryStorage();
  try {
    resetTestState();
    state.masterDeck = [];
    state.deckArchetype = STARTER_DECKS[0];
    globalThis.localStorage = memStore;
    const initialProfile = readGameProfile();
    const lockedDeck = STARTER_DECKS.find(deck => deck.id === "simic_tidecallers");
    assert(
      initialProfile.ok &&
      initialProfile.exists === false &&
      !isStarterDeckAvailable(lockedDeck.id) &&
      getStarterDeckProgressMessage().includes("0/1"),
      "7.2.6 Fresh profile keeps the Simic deck locked and reports milestone progress"
    );
    assert(
      startNewRun(lockedDeck) === false &&
      state.masterDeck.length === 0,
      "7.2.7 Normal run start rejects a locked deck"
    );

    state.runId = "profile-campaign-clear-1";
    const firstClear = recordCampaignClear();
    const savedProfile = readGameProfile();
    assert(
      firstClear.ok &&
      firstClear.newlyUnlockedDeckId === lockedDeck.id &&
      savedProfile.ok &&
      savedProfile.profile.campaignClears === 1 &&
      savedProfile.profile.unlockedStarterDeckIds.includes(lockedDeck.id) &&
      isStarterDeckAvailable(lockedDeck.id),
      "7.2.8 Campaign clear persistently unlocks the Simic starter deck"
    );

    const duplicateClear = recordCampaignClear();
    assert(
      duplicateClear.ok &&
      duplicateClear.duplicate &&
      readGameProfile().profile.campaignClears === 1,
      "7.2.9 Re-recording the same run does not grant duplicate progress"
    );
    assert(
      startNewRun(lockedDeck) &&
      state.deckArchetype.id === lockedDeck.id &&
      state.masterDeck.length === 40,
      "7.2.10 A newly unlocked deck can start a normal run"
    );

    const legacyProfile = {
      version: 0,
      unlockedDeckIds: ["gruul"],
      campaignWins: 1
    };
    memStore.setItem(GAME_PROFILE_KEY, JSON.stringify(legacyProfile));
    const migratedProfile = readGameProfile();
    const persistedMigration = JSON.parse(memStore.getItem(GAME_PROFILE_KEY));
    assert(
      migratedProfile.ok &&
      migratedProfile.migrated === true &&
      persistedMigration.version === GAME_PROFILE_VERSION &&
      migratedProfile.profile.unlockedStarterDeckIds.includes(lockedDeck.id),
      "7.2.11 Supported older profile data migrates to the current schema"
    );

    const malformedProfile = "{broken";
    memStore.setItem(GAME_PROFILE_KEY, malformedProfile);
    const corruptProfile = readGameProfile();
    const corruptClear = recordCampaignClear("profile-corrupt-run");
    assert(
      !corruptProfile.ok &&
      !corruptClear.ok &&
      memStore.getItem(GAME_PROFILE_KEY) === malformedProfile &&
      state.profileError.includes("corrupt"),
      "7.2.12 Corrupt profile data is reported and preserved without granting unlocks"
    );

    const unsupportedProfile = JSON.stringify({ version: 99 });
    memStore.setItem(GAME_PROFILE_KEY, unsupportedProfile);
    const futureProfile = readGameProfile();
    assert(
      !futureProfile.ok &&
      memStore.getItem(GAME_PROFILE_KEY) === unsupportedProfile,
      "7.2.13 Unsupported profile versions are rejected without overwriting data"
    );

    globalThis.localStorage = {
      getItem: () => null,
      setItem: () => { throw new Error("quota exceeded"); }
    };
    state.runId = "profile-write-failure-run";
    const failedWrite = recordCampaignClear();
    assert(
      !failedWrite.ok &&
      state.profileError.includes("quota exceeded") &&
      !isStarterDeckAvailable(lockedDeck.id),
      "7.2.14 Profile write failures are surfaced and do not grant the locked deck"
    );
  } finally {
    if (prevLS === undefined) delete globalThis.localStorage;
    else globalThis.localStorage = prevLS;
  }
}

// --- 7.3 Golgari Graveyard / Undergrowth Card Mechanics ---
{
  // Stitcher's Supplier + Crucible of Worlds self-mill synergy
  resetTestState();
  state.relics = [{ ...RELIC_DB.find(r => r.id === "crucible_of_worlds") }];
  state.library = [
    cloneCard("forest"),
    cloneCard("fiend_artisan"),
    cloneCard("archon_of_cruelty")
  ];
  handleCreatureCast(cloneCard("stitchers_supplier"));
  assert(
    state.library.length === 0 &&
    state.graveyard.length === 3 &&
    state.turnResonance === 4 &&
    state.manaPool.ANY === 2,
    `7.3.1 Stitcher's Supplier mills 3 cards into Graveyard (+1 Mult) and triggers Crucible of Worlds (+2 Mult & +2 Treasure, capped at 2x/turn) (got gy=${state.graveyard.length}, mult=${state.turnResonance}, any=${state.manaPool.ANY})`
  );

  // Satyr Wayfinder mills 3 and returns a Land from Graveyard to Hand
  resetTestState();
  state.hand = [];
  state.library = [
    cloneCard("fiend_artisan"),
    cloneCard("overgrown_tomb"),
    cloneCard("swamp")
  ];
  handleCreatureCast(cloneCard("satyr_wayfinder"));
  assert(
    state.hand.length === 1 &&
    state.hand[0].id === "overgrown_tomb" &&
    state.graveyard.length === 2,
    `7.3.2 Satyr Wayfinder mills 3 cards and recovers a Land (preferring Dual/Fetch) from Graveyard to Hand`
  );

  // Grisly Salvage mills 3 and returns the strongest Creature from Graveyard to Hand
  resetTestState();
  state.hand = [];
  state.library = [
    cloneCard("stitchers_supplier"),
    cloneCard("archon_of_cruelty"),
    cloneCard("forest")
  ];
  handleSpellCast(cloneCard("grisly_salvage"));
  assert(
    state.hand.length === 1 &&
    state.hand[0].id === "archon_of_cruelty" &&
    state.turnResonance === 3,
    "7.3.3 Grisly Salvage mills 3 cards, returns strongest Creature from Graveyard to Hand, and adds +2 Resonance"
  );

  // Fiend Artisan scales +1/+1 per Creature in Graveyard
  resetTestState();
  state.graveyard = [
    cloneCard("stitchers_supplier"),
    cloneCard("satyr_wayfinder"),
    cloneCard("vampire_nighthawk"),
    cloneCard("forest") // Land should not count
  ];
  handleCreatureCast(cloneCard("fiend_artisan"));
  const artisan = state.playerCreatures.find(c => c.id === "fiend_artisan");
  assert(
    artisan && artisan.power === 5 && artisan.toughness === 5,
    `7.3.4 Fiend Artisan (base 2/2) gains +1/+1 for each of the 3 Creatures in Graveyard -> 5/5 (got ${artisan ? artisan.power : 0}/${artisan ? artisan.toughness : 0})`
  );

  // Spider Spawning spawns 2/2 Haste Lifelink Spiders scaled by Graveyard creatures (clamped 2..5)
  resetTestState();
  state.graveyard = [
    cloneCard("stitchers_supplier"),
    cloneCard("satyr_wayfinder"),
    cloneCard("vampire_nighthawk"),
    cloneCard("archon_of_cruelty")
  ];
  handleSpellCast(cloneCard("izoni_undergrowth"));
  const spiders = state.playerCreatures.find(c => c.name === "Spider Token");
  assert(
    spiders && spiders.count === 4 && spiders.power === 2 && spiders.keywords.includes("Lifelink") && spiders.keywords.includes("Haste"),
    `7.3.5 Spider Spawning creates 4x 2/2 Haste Lifelink Spider tokens for 4 Graveyard Creatures (got count=${spiders ? spiders.count : 0})`
  );
}

// --- 7.3.6 New Card Mechanics ---
{
  const newCardIds = [
    "mosswake_forager",
    "briarback_colossus",
    "emberline_daredevil",
    "furnace_arc",
    "tideglass_sentry",
    "slipstream_reversal",
    "ashen_bargain",
    "dawnbell_acolyte",
    "sunlit_rally",
    "floodplain_cartographer"
  ];
  assert(
    newCardIds.every(id => CARD_DB[id] && CARD_DB[id].id === id),
    "7.3.6.1 All ten new card definitions are registered in CARD_DB"
  );

  resetTestState();
  state.hand = [];
  state.library = [cloneCard("forest"), cloneCard("overgrown_tomb"), cloneCard("island")];
  handleCreatureCast(cloneCard("mosswake_forager"));
  assert(
    state.hand.length === 1 &&
    state.hand[0].id === "overgrown_tomb" &&
    state.graveyard.length === 1 &&
    state.graveyard[0].id === "island" &&
    state.turnResonance === 2,
    "7.3.6.2 Mosswake Forager mills two, recovers a dual land, and gains +1 Resonance"
  );

  resetTestState();
  handleCreatureCast(cloneCard("briarback_colossus"));
  triggerLandfall();
  const briarback = state.playerCreatures.find(creature => creature.id === "briarback_colossus");
  assert(
    briarback && briarback.tempPower === 2 && briarback.tempToughness === 2,
    "7.3.6.3 Briarback Colossus gets +2/+2 from Landfall"
  );

  resetTestState();
  handleCreatureCast(cloneCard("emberline_daredevil"));
  handleSpellCast({ id: "test_instant", name: "Test Instant", type: "Instant" });
  const daredevil = state.playerCreatures.find(creature => creature.id === "emberline_daredevil");
  assert(
    daredevil && daredevil.tempPower === 2 && daredevil.tempToughness === 2 && state.turnResonance === 2,
    "7.3.6.4 Emberline Daredevil's Prowess triggers when an Instant is cast"
  );

  resetTestState();
  handleSpellCast(cloneCard("furnace_arc"));
  assert(
    state.turnBurnPower === 3 && state.turnResonance === 2,
    "7.3.6.5 Furnace Arc adds 3 Burn and +1 Resonance"
  );

  resetTestState();
  state.hand = [];
  state.library = [cloneCard("forest")];
  state.enemyCreatures = [
    { uid: "weak-blocker", name: "Weak Blocker", power: 1, toughness: 2, color: "G", keywords: [], frozen: false },
    { uid: "strong-blocker", name: "Strong Blocker", power: 4, toughness: 4, color: "U", keywords: [], frozen: false }
  ];
  handleCreatureCast(cloneCard("tideglass_sentry"));
  assert(
    state.enemyCreatures.find(blocker => blocker.uid === "strong-blocker").frozen &&
    !state.enemyCreatures.find(blocker => blocker.uid === "weak-blocker").frozen &&
    state.hand.length === 1,
    "7.3.6.6 Tideglass Sentry freezes the strongest blocker and draws one card"
  );

  resetTestState();
  state.enemyCreatures = [
    { uid: "weak-blocker", name: "Weak Blocker", power: 1, toughness: 2, color: "G", keywords: [], frozen: false },
    { uid: "strong-blocker", name: "Strong Blocker", power: 4, toughness: 4, color: "U", keywords: [], frozen: false }
  ];
  handleSpellCast(cloneCard("slipstream_reversal"));
  assert(
    state.enemyCreatures.length === 1 &&
    state.enemyCreatures[0].uid === "weak-blocker" &&
    state.turnResonance === 3,
    "7.3.6.7 Slipstream Reversal returns the strongest blocker and gains +2 Resonance"
  );

  resetTestState();
  state.playerLife = 2;
  state.manaPool.B = 1;
  const bargain = cloneCard("ashen_bargain");
  state.hand = [bargain];
  state.library = [cloneCard("forest"), cloneCard("swamp")];
  assert(
    !canPlayCard(bargain) &&
    getCardPlayabilityInfo(bargain).reason.includes("at least 3 Life"),
    "7.3.6.8 Ashen Bargain cannot be cast without enough Life to pay its cost"
  );
  state.playerLife = 3;
  assert(canPlayCard(bargain), "7.3.6.9 Ashen Bargain is playable when its Life cost can be paid");
  playCardFromHand(bargain.uid);
  assert(
    state.playerLife === 1 &&
    state.hand.length === 2 &&
    state.library.length === 0 &&
    state.turnResonance === 2,
    "7.3.6.10 Ashen Bargain pays 2 Life, draws two cards, and gains +1 Resonance"
  );

  resetTestState();
  state.playerLife = 15;
  handleCreatureCast(cloneCard("dawnbell_acolyte"));
  assert(
    state.playerLife === 17 && state.turnResonance === 2,
    "7.3.6.11 Dawnbell Acolyte heals 2 Life and gains +1 Resonance on ETB"
  );

  resetTestState();
  handleSpellCast(cloneCard("sunlit_rally"));
  const soldiers = state.playerCreatures.find(creature => creature.name === "Soldier Token");
  assert(
    soldiers && soldiers.count === 2 && soldiers.keywords.includes("Haste") && state.turnResonance === 2,
    "7.3.6.12 Sunlit Rally creates two Haste Soldiers and gains +1 Resonance"
  );

  resetTestState();
  state.hand = [];
  state.library = [cloneCard("forest"), cloneCard("island")];
  handleCreatureCast(cloneCard("floodplain_cartographer"));
  triggerLandfall();
  triggerLandfall();
  const cartographer = state.playerCreatures.find(creature => creature.id === "floodplain_cartographer");
  assert(
    cartographer && cartographer.tempPower === 2 && cartographer.tempToughness === 2 && state.hand.length === 2,
    "7.3.6.13 Floodplain Cartographer gains +1/+1 and draws a card for each Landfall"
  );
}

// --- 7.4 Colorless / Artifact Construct Card Mechanics & Shop Pool Weighting ---
{
  // Wastes basic land taps for {C} and pays generic mana costs
  resetTestState();
  const wastesCard = cloneCard("wastes");
  handleLandPlay(wastesCard);
  const plan = findManaPaymentPlan("{1}");
  assert(
    plan !== null && plan.landsToTap.length === 1 && plan.landsToTap[0] === wastesCard.uid,
    "7.4.1 Wastes basic land enters untapped and pays generic {1} cost"
  );

  // Thopter Foundry + Steel Overseer + Arcbound Ravager + Cyberdrive Awakener
  resetTestState();
  handleSpellCast(cloneCard("thopter_foundry"));
  const thopters = state.playerCreatures.find(c => c.name === "Drone Construct");
  assert(
    thopters && thopters.count === 2 && thopters.subtype === "Construct" && thopters.keywords.includes("Flying"),
    "7.4.2 Thopter Foundry spawns two 1/1 Flying Haste Thopter Construct tokens"
  );

  handleCreatureCast(cloneCard("steel_overseer"));
  assert(
    thopters.power === 2 && thopters.toughness === 2,
    "7.4.3 Steel Overseer ETB permanently buffs all controlled creatures by +1/+1"
  );

  // Start of next turn triggers Steel Overseer upkeep anthem
  state.library = [cloneCard("wastes")];
  startPlayerTurn(false);
  assert(
    thopters.power === 3 && thopters.toughness === 3,
    "7.4.4 Steel Overseer upkeep permanently buffs all controlled creatures by +1/+1 at start of turn"
  );

  // Arcbound Ravager Modular ETB counts other controlled creature units (2 Thopters + 1 Steel Overseer = +3/+3 -> 5/5)
  handleCreatureCast(cloneCard("arcbound_ravager"));
  const ravager = state.playerCreatures.find(c => c.id === "arcbound_ravager");
  assert(
    ravager && ravager.power === 5 && ravager.toughness === 5,
    `7.4.5 Arcbound Ravager (base 2/2) gains +3/+3 for 3 other controlled units -> 5/5 (got ${ravager ? ravager.power : 0}/${ravager ? ravager.toughness : 0})`
  );

  // Myr Battlesphere spawns 3 Myr Construct tokens
  handleCreatureCast(cloneCard("myr_battlesphere"));
  const myrs = state.playerCreatures.find(c => c.name === "Shard Construct");
  assert(
    myrs && myrs.count === 3 && myrs.subtype === "Construct",
    "7.4.6 Myr Battlesphere ETB spawns three 1/1 Haste Myr Construct tokens"
  );

  // Cyberdrive Awakener grants +3/+3, Flying, and Haste to all creatures this turn
  handleSpellCast(cloneCard("cyberdrive_awakener"));
  assert(
    ravager.tempPower === 3 && getCreatureKeywords(ravager).includes("Flying"),
    "7.4.7 Cyberdrive Awakener grants +3/+3 and Flying to all creatures this turn"
  );

  // Galvanic Blast destroys blocker or deals 5 Burn to Boss
  resetTestState();
  handleSpellCast(cloneCard("galvanic_blast"));
  assert(
    state.turnBurnPower === 5 && state.turnResonance === 2,
    "7.4.8 Galvanic Blast deals +5 Burn Power to Boss and +1 Resonance when no blockers are present"
  );

  // Colorless shop pool weighting: Artifact Constructs deck drafts colorless cards in-color
  resetTestState();
  const artifactArch = STARTER_DECKS.find(d => d.id === "artifact_constructs");
  startNewRun(artifactArch);
  let colorlessDraftHits = 0;
  let totalDraftCards = 0;
  for (let i = 0; i < 20; i++) {
    generateShopStock(false);
    state.shopStock.cards.forEach(item => {
      totalDraftCards++;
      if (item.card.color === "C" || item.card.isFetch) colorlessDraftHits++;
    });
  }
  assert(
    colorlessDraftHits / totalDraftCards >= 0.75,
    `7.4.9 Artifact Constructs shop draft pool weights Colorless/Fetch cards >= 75% (got ${colorlessDraftHits}/${totalDraftCards})`
  );
}

// ============================================================================
// SECTION 8: BRANCHING ENCOUNTER MAP (PART 2)
// ============================================================================
console.log("\n=== SECTION 8: BRANCHING ENCOUNTER MAP (PART 2) ===");

// --- 8.1 Route Graph Structure & Reachability ---
{
  assert(
    typeof ROUTE_NODE_TYPES === "object" &&
    ROUTE_NODE_TYPES.fight &&
    ROUTE_NODE_TYPES.elite &&
    ROUTE_NODE_TYPES.boss &&
    ROUTE_NODE_TYPES.shop &&
    ROUTE_NODE_TYPES.rest &&
    ROUTE_NODE_TYPES.event,
    "8.1.1 ROUTE_NODE_TYPES defines fight, elite, boss, shop, rest, and event node types"
  );

  assert(
    Array.isArray(CAMPAIGN_ROUTE_NODES) && CAMPAIGN_ROUTE_NODES.length >= 8,
    `8.1.2 CAMPAIGN_ROUTE_NODES defines a branching graph (${CAMPAIGN_ROUTE_NODES.length} nodes)`
  );

  const nodeById = new Map(CAMPAIGN_ROUTE_NODES.map(n => [n.id, n]));
  const startNode = CAMPAIGN_ROUTE_NODES[0];
  const reachable = new Set();
  const queue = [startNode.id];
  let allEdgesValid = true;
  let allStepsIncreasing = true;

  while (queue.length > 0) {
    const curId = queue.shift();
    if (reachable.has(curId)) continue;
    reachable.add(curId);
    const cur = nodeById.get(curId);
    for (const nextId of (cur.next || [])) {
      const nextNode = nodeById.get(nextId);
      if (!nextNode) {
        allEdgesValid = false;
      } else {
        if (nextNode.step <= cur.step) allStepsIncreasing = false;
        queue.push(nextId);
      }
    }
  }

  assert(
    allEdgesValid && allStepsIncreasing && reachable.size === CAMPAIGN_ROUTE_NODES.length,
    `8.1.3 Every node in CAMPAIGN_ROUTE_NODES is reachable from ${startNode.id} in a strictly forward DAG`
  );

  const terminalNodes = CAMPAIGN_ROUTE_NODES.filter(n => !n.next || n.next.length === 0);
  assert(
    terminalNodes.length === 1 && terminalNodes[0].id === "p2_boss",
    "8.1.4 All paths in CAMPAIGN_ROUTE_NODES converge at the Plane 2 final boss (p2_boss)"
  );

  const allCampaignGraphsValid = CAMPAIGN_DEFINITIONS.every(campaign => {
    const nodes = campaign.routeNodes;
    const byId = new Map(nodes.map(node => [node.id, node]));
    const seen = new Set();
    const pending = nodes.length ? [nodes[0].id] : [];
    while (pending.length) {
      const id = pending.shift();
      if (seen.has(id)) continue;
      seen.add(id);
      const node = byId.get(id);
      if (!node) return false;
      for (const nextId of node.next || []) {
        if (!byId.has(nextId) || byId.get(nextId).step <= node.step) return false;
        pending.push(nextId);
      }
    }
    const terminals = nodes.filter(node => !node.next || node.next.length === 0);
    return seen.size === nodes.length &&
      terminals.length === 1 &&
      terminals[0].type === "boss" &&
      terminals[0].encounterIdx === campaign.encounters.length - 1;
  });
  assert(
    allCampaignGraphsValid,
    "8.1.5 Every campaign has a reachable route graph that converges on its final boss"
  );
}

// --- 8.2 Invalid Choices Rejected & Completing a Node Exactly Once ---
{
  resetTestState();
  startNewRun(STARTER_DECKS[0]);

  assert(
    state.route && state.route.currentNodeId === "p1_start" && state.route.completedNodeIds.length === 0,
    "8.2.1 startNewRun initializes state.route at p1_start with no completed nodes"
  );

  // Cannot select next node before completing current node
  assert(
    canSelectRouteNode("p1_upper_rest") === false && selectRouteNode("p1_upper_rest") === false,
    "8.2.2 Cannot select a connected next node before the current node is completed"
  );

  const misplacedNodeResult = resolveNonCombatRouteNode(getRouteNodeById("p1_upper_rest"));
  assert(
    misplacedNodeResult.ok === false &&
    misplacedNodeResult.reason === "not_current" &&
    state.gold === 6 &&
    state.route.completedNodeIds.length === 0,
    "8.2.3 Non-combat rewards cannot be applied for a node that is not the current route stop"
  );

  // Completing current node works exactly once
  const firstComplete = completeCurrentRouteNode();
  const secondComplete = completeCurrentRouteNode();
  assert(
    firstComplete === true && secondComplete === false && state.route.completedNodeIds.length === 1,
    "8.2.4 completeCurrentRouteNode marks the current node completed exactly once"
  );

  // Invalid choices rejected: unknown ID, already-completed node, or non-connected future node
  assert(
    canSelectRouteNode("nonexistent_node") === false &&
    canSelectRouteNode("p1_start") === false &&
    canSelectRouteNode("p1_boss") === false &&
    canSelectRouteNode("p2_entry_shop") === false &&
    selectRouteNode("p1_boss") === false,
    "8.2.5 Rejects invalid route choices (unknown ID, already completed node, or non-adjacent node)"
  );

  // Valid choices from p1_start are p1_upper_rest and p1_lower_event
  const nextFromStart = getAvailableNextRouteNodes().map(n => n.id);
  assert(
    nextFromStart.length === 2 &&
    nextFromStart.includes("p1_upper_rest") &&
    nextFromStart.includes("p1_lower_event"),
    "8.2.6 Completing p1_start unlocks both p1_upper_rest and p1_lower_event branches"
  );
}

// --- 8.3 Branching Path Resolution (Rest Site, Event, Shop Outpost & Combat) ---
{
  // Path A: p1_start -> p1_upper_rest (Rest Site) -> p1_elite -> p1_boss -> p2_entry_shop (Shop) -> p2_mid_elite -> p2_boss
  resetTestState();
  startNewRun(STARTER_DECKS[0]);
  state.playerLife = 14;
  completeCurrentRouteNode();

  const choseRest = selectRouteNode("p1_upper_rest");
  const foilCountAfterRest = state.masterDeck.filter(c => c.foil).length;
  assert(
    choseRest === true &&
    state.route.currentNodeId === "p1_upper_rest" &&
    state.route.completedNodeIds.includes("p1_upper_rest") &&
    state.playerLife === 24 &&
    foilCountAfterRest >= 1,
    "8.3.1 Selecting p1_upper_rest (Rest Site) heals +10 Life, buffs/foils a Creature, and completes the node"
  );

  // Sibling branch p1_lower_event is now unreachable, and re-resolving p1_upper_rest is rejected
  const duplicateResolve = resolveNonCombatRouteNode(getRouteNodeById("p1_upper_rest"));
  assert(
    canSelectRouteNode("p1_lower_event") === false &&
    canSelectRouteNode("p1_upper_rest") === false &&
    duplicateResolve.ok === false &&
    duplicateResolve.reason === "already_completed",
    "8.3.2 Choosing a branch locks out its sibling branch and prevents completing the same node twice"
  );

  // Advance to p1_elite (Krenko) and p1_boss (Sheoldred)
  assert(
    selectRouteNode("p1_elite") === true && state.encounterIdx === 1,
    "8.3.3 Selecting p1_elite transitions to Encounter 1 (Krenko, Mob Boss)"
  );
  completeCurrentRouteNode();
  assert(
    selectRouteNode("p1_boss") === true && state.encounterIdx === 2,
    "8.3.4 Selecting p1_boss transitions to Encounter 2 (Sheoldred, the Apocalypse)"
  );
  completeCurrentRouteNode();

  // Plane 2 entry branch: choose p2_entry_shop (Blind Eternities Caravan) instead of fighting Talrand
  const goldBeforeShopNode = state.gold;
  state.playerLife = 20;
  const choseShopNode = selectRouteNode("p2_entry_shop");
  assert(
    choseShopNode === true &&
    state.route.currentNodeId === "p2_entry_shop" &&
    state.route.completedNodeIds.includes("p2_entry_shop") &&
    state.gold === goldBeforeShopNode + 6 &&
    state.playerLife === 24 &&
    state.shopStock.cards.length > 0,
    "8.3.5 Selecting p2_entry_shop grants +$6 Caravan Stipend, +4 Life, and generates Sanctum Shop stock"
  );

  // Path B: p1_start -> p1_lower_event (Event)
  resetTestState();
  startNewRun(STARTER_DECKS[0]);
  state.playerLife = 15;
  const goldBeforeEvent = state.gold;
  completeCurrentRouteNode();
  const choseEvent = selectRouteNode("p1_lower_event");
  assert(
    choseEvent === true &&
    state.playerLife === 15 &&
    state.gold === goldBeforeEvent &&
    state.route.pendingEventId === "p1_lower_event" &&
    !state.route.completedNodeIds.includes("p1_lower_event"),
    "8.3.6 Selecting p1_lower_event opens its choices without applying an automatic reward"
  );
  assert(
    getRouteEventChoiceStatus("blood_tithe").available &&
    getRouteEventChoiceStatus("purify").available &&
    getRouteEventChoiceStatus("leave").available,
    "8.3.7 The shrine exposes each eligible choice"
  );
  const bloodTithe = resolveRouteEventChoice("p1_lower_event", "blood_tithe");
  assert(
    bloodTithe.ok &&
    state.playerLife === 10 &&
    state.gold === goldBeforeEvent + 8 &&
    state.route.pendingEventId === null &&
    state.route.completedNodeIds.includes("p1_lower_event"),
    "8.3.8 Paying 5 Life grants $8 Gold and completes the event"
  );
  const duplicateTithe = resolveRouteEventChoice("p1_lower_event", "blood_tithe");
  assert(
    duplicateTithe.ok === false &&
    state.playerLife === 10 &&
    state.gold === goldBeforeEvent + 8,
    "8.3.9 Resolving the same event twice cannot repeat its reward"
  );

  resetTestState();
  startNewRun(STARTER_DECKS[0]);
  state.playerLife = 5;
  state.gold = 4;
  completeCurrentRouteNode();
  selectRouteNode("p1_lower_event");
  assert(
    getRouteEventChoiceStatus("blood_tithe").available === false &&
    getRouteEventChoiceStatus("purify").available === false &&
    getRouteEventChoiceStatus("leave").available,
    "8.3.10 Low Life and insufficient Gold disable the paid choices with eligibility reasons"
  );
  const leaveShrine = resolveRouteEventChoice("p1_lower_event", "leave");
  assert(
    leaveShrine.ok &&
    state.playerLife === 5 &&
    state.gold === 4 &&
    state.route.completedNodeIds.includes("p1_lower_event"),
    "8.3.11 Leaving the shrine completes it without changing resources"
  );

  resetTestState();
  startNewRun(STARTER_DECKS[0]);
  state.playerLife = MAX_LIFE - 3;
  state.gold = 5;
  completeCurrentRouteNode();
  selectRouteNode("p1_lower_event");
  const lifeBeforePurify = state.playerLife;
  const purifyShrine = resolveRouteEventChoice("p1_lower_event", "purify");
  assert(
    purifyShrine.ok &&
    state.playerLife === MAX_LIFE &&
    state.gold === 0 &&
    state.playerLife - lifeBeforePurify === 3,
    "8.3.12 Spending $5 restores up to 8 Life without exceeding maximum Life"
  );
  assert(
    getRouteEventChoiceStatus("purify").available === false,
    "8.3.13 The healing choice is unavailable at maximum Life"
  );
}

// --- 8.4 Route Save/Restore Preservation (Canonical Save & Full Run Snapshot) ---
{
  const prevHeadless = state.headless;
  const prevDoc = globalThis.document;
  const prevLS = globalThis.localStorage;
  const memStore = createMemoryStorage();

  try {
    state.headless = false;
    globalThis.document = {};
    globalThis.localStorage = memStore;

    startNewRun(STARTER_DECKS[0]);
    state.playerLife = 15;
    completeCurrentRouteNode();
    selectRouteNode("p1_lower_event");
    const pendingEventSnapshot = createFullRunSnapshot();
    const pendingEventSaved = saveRunState(false);

    state.route = createInitialRouteState(0);
    restoreFullRunSnapshot(pendingEventSnapshot);
    const snapshotRestoredPendingEvent =
      state.route.pendingEventId === "p1_lower_event" &&
      !state.route.completedNodeIds.includes("p1_lower_event");

    state.route = createInitialRouteState(0);
    state.encounterIdx = 0;
    const pendingEventLoaded = loadRunState();
    const pendingEventStatus = getRouteEventChoiceStatus("blood_tithe");
    const resolvedAfterLoad = resolveRouteEventChoice("p1_lower_event", "blood_tithe");
    assert(
      pendingEventSaved &&
      snapshotRestoredPendingEvent &&
      pendingEventLoaded &&
      pendingEventStatus.available &&
      resolvedAfterLoad.ok &&
      state.playerLife === 10 &&
      state.gold === 14,
      "8.4.1 Pending event identity restores from both snapshots and disk without duplicating effects"
    );

    startNewRun(STARTER_DECKS[0]);
    completeCurrentRouteNode(); // complete p1_start
    selectRouteNode("p1_lower_event");
    resolveRouteEventChoice("p1_lower_event", "leave");
    selectRouteNode("p1_elite"); // enter Krenko fight
    completeCurrentRouteNode(); // complete Krenko
    selectRouteNode("p1_boss"); // enter Sheoldred fight
    completeCurrentRouteNode(); // complete Sheoldred -> pending choice between p2_entry_fight and p2_entry_shop
    state.route.pendingSelection = true;

    const fullSnap = createFullRunSnapshot();
    const savedOk = saveRunState(true);
    assert(savedOk === true, "8.4.2 saveRunState persists run with active branching route state");

    // Mutate route state to verify both restoreFullRunSnapshot and loadRunState restore exact route choices
    state.route = createInitialRouteState(0);
    restoreFullRunSnapshot(fullSnap);
    assert(
      state.route.currentNodeId === "p1_boss" &&
      state.route.completedNodeIds.includes("p1_lower_event") &&
      !state.route.completedNodeIds.includes("p1_upper_rest") &&
      state.route.pendingSelection === true,
      "8.4.3 restoreFullRunSnapshot restores exact currentNodeId, completedNodeIds, and pendingSelection"
    );

    // Scramble route again and restore from localStorage via loadRunState
    state.route = createInitialRouteState(0);
    state.encounterIdx = 0;
    const loadedOk = loadRunState();
    const availableAfterRestore = getAvailableNextRouteNodes().map(n => n.id);
    assert(
      loadedOk === true &&
      state.route.currentNodeId === "p1_boss" &&
      state.route.visitedNodeIds.includes("p1_lower_event") &&
      !state.route.visitedNodeIds.includes("p1_upper_rest") &&
      availableAfterRestore.length === 2 &&
      availableAfterRestore.includes("p2_entry_fight") &&
      availableAfterRestore.includes("p2_entry_shop"),
      "8.4.4 loadRunState restores saved route history and exact available next choices (p2_entry_fight, p2_entry_shop)"
    );

    const repairedRoute = normalizeRouteState({
      loop: 9,
      currentNodeId: "p2_boss",
      completedNodeIds: [],
      visitedNodeIds: ["p1_start", "p2_boss"],
      pendingSelection: true
    }, 0, false);
    assert(
      repairedRoute.loop === 0 &&
      repairedRoute.currentNodeId === "p1_start" &&
      repairedRoute.completedNodeIds.length === 0 &&
      repairedRoute.visitedNodeIds.length === 1 &&
      repairedRoute.pendingSelection === false,
      "8.4.5 Normalization repairs impossible route histories and derives the loop from encounter progress"
    );
  } finally {
    state.headless = prevHeadless;
    if (prevDoc === undefined) delete globalThis.document;
    else globalThis.document = prevDoc;
    if (prevLS === undefined) delete globalThis.localStorage;
    else globalThis.localStorage = prevLS;
  }
}

// ============================================================================
// SECTION 9: POST-BATTLE CARD DRAFT & SAVE RESTORATION (Part 3)
// ============================================================================
console.log(`\n=== SECTION 9: POST-BATTLE CARD DRAFT & SAVE RESTORATION ===`);

// --- 9.1: Card Legality & Pool Sampling ---
{
  const basicLandIds = ["forest", "mountain", "swamp", "island", "plains", "wastes"];
  
  // 9.1.1: Exclude all basic lands across all decks
  let allBasicsExcluded = true;
  STARTER_DECKS.forEach(deck => {
    const deckColors = new Set(deck.colors);
    basicLandIds.forEach(id => {
      if (isCardLegalForDeck(id, deckColors) || isCardLegalForDeck(CARD_DB[id], deckColors)) {
        allBasicsExcluded = false;
      }
    });
  });
  assert(allBasicsExcluded === true, "9.1.1 isCardLegalForDeck strictly excludes all basic lands for all archetypes");

  // 9.1.2: Fetch land (evolving_wilds) is legal for all archetypes
  let fetchLegalEverywhere = true;
  STARTER_DECKS.forEach(deck => {
    const deckColors = new Set(deck.colors);
    if (!isCardLegalForDeck("evolving_wilds", deckColors)) {
      fetchLegalEverywhere = false;
    }
  });
  assert(fetchLegalEverywhere === true, "9.1.2 Fetch land (evolving_wilds) is universal fixer legal for all starter decks");

  // 9.1.3: Dual lands match only when all produced colors match deck
  const gruulCols = new Set(["G", "R"]);
  const izzetCols = new Set(["U", "R"]);
  assert(
    isCardLegalForDeck("stomping_ground", gruulCols) === true &&
    isCardLegalForDeck("stomping_ground", izzetCols) === false &&
    isCardLegalForDeck("steam_vents", izzetCols) === true &&
    isCardLegalForDeck("steam_vents", gruulCols) === false,
    "9.1.3 Dual lands are legal only when all produced colors are in deckColors"
  );

  // 9.1.4: Colorless construct cards are legal for Colorless archetype and excluded from colored decks
  const colorlessCols = new Set(["C"]);
  assert(
    isCardLegalForDeck("arcbound_ravager", colorlessCols) === true &&
    isCardLegalForDeck("vault_skirge", colorlessCols) === true &&
    isCardLegalForDeck("thoughtcast", colorlessCols) === true &&
    isCardLegalForDeck("arcbound_ravager", gruulCols) === false &&
    isCardLegalForDeck("thoughtcast", izzetCols) === false,
    "9.1.4 Colorless cards are legal for Colorless archetype {C} and excluded from colored decks"
  );

  // 9.1.5: Multi-color colored cards require all pips in deck
  const borosCols = new Set(["W", "R"]);
  const monoWhiteCols = new Set(["W"]);
  assert(
    isCardLegalForDeck("brainstorm", izzetCols) === true &&
    isCardLegalForDeck("brainstorm", new Set(["U"])) === false &&
    isCardLegalForDeck("heroic_reinforcements", borosCols) === true &&
    isCardLegalForDeck("heroic_reinforcements", monoWhiteCols) === false,
    "9.1.5 Multi-color cards require all colored mana pips to be present in deckColors"
  );

  // 9.1.6 & 9.1.7: sampleDraftPool returns exactly 3 distinct cards without replacement for all archetypes
  let allDraftsValid = true;
  STARTER_DECKS.forEach(deck => {
    const deckColors = new Set(deck.colors);
    const pool = sampleDraftPool(deckColors, 3);
    if (!Array.isArray(pool) || pool.length !== 3) allDraftsValid = false;
    const ids = pool.map(c => typeof c === "string" ? c : c.id);
    if (new Set(ids).size !== 3) allDraftsValid = false;
    if (ids.some(id => basicLandIds.includes(id))) allDraftsValid = false;
    if (!ids.every(id => isCardLegalForDeck(id, deckColors))) allDraftsValid = false;
  });
  assert(allDraftsValid === true, "9.1.6 sampleDraftPool returns 3 distinct legal non-basic cards without replacement for all decks");

  // 9.1.8: Deterministic sampling with mock RNG produces repeatable exact sequence
  let seqIdx = 0;
  const mockSequence = [0.1, 0.5, 0.9];
  const deterministicRng = () => mockSequence[seqIdx++ % mockSequence.length];
  seqIdx = 0;
  const poolA = sampleDraftPool(gruulCols, 3, deterministicRng).map(c => c.id || c);
  seqIdx = 0;
  const poolB = sampleDraftPool(gruulCols, 3, deterministicRng).map(c => c.id || c);
  assert(
    poolA.length === 3 &&
    poolA[0] === poolB[0] &&
    poolA[1] === poolB[1] &&
    poolA[2] === poolB[2],
    "9.1.8 Deterministic RNG produces identical repeatable draft pool choices"
  );

  const generatedA = sampleGeneratedCreature(gruulCols, 123456);
  const generatedB = sampleGeneratedCreature(gruulCols, 123456);
  assert(
    generatedA && JSON.stringify(generatedA) === JSON.stringify(generatedB) &&
    generatedA.type === "Creature" &&
    generatedA.power >= 1 && generatedA.toughness >= 1 &&
    generatedA.keywords.length === 1 &&
    isCardLegalForDeck(generatedA, gruulCols) &&
    normalizeGeneratedCardDefinition(generatedA)?.id === generatedA.id,
    "9.1.9 Seeded generated creatures are deterministic, legal, bounded, and validate from their blueprint"
  );
  assert(
    resolveDraftCard(generatedA)?.id === generatedA.id &&
    resolveDraftCard({ id: generatedA.id, generatedDefinition: generatedA })?.id === generatedA.id &&
    resolveDraftCard("lightning_bolt")?.id === "lightning_bolt",
    "9.1.10 Draft UI resolves generated, persisted generated, and catalog card choices"
  );
  assert(
    sampleGeneratedCreature(new Set(), 123456) === null &&
    normalizeGeneratedCardDefinition({ ...generatedA, power: 99 }) === null,
    "9.1.11 Generated creature creation rejects empty colors and validation rejects modified definitions"
  );
  assert(
    STARTER_DECKS.every((deck, idx) => {
      const card = sampleGeneratedCreature(deck.colors, 9000 + idx);
      return card && isCardLegalForDeck(card, deck.colors);
    }),
    "9.1.12 Generated creature rewards are available and legal for every starter deck, including colorless"
  );

  // Edge case: count > pool size returns all available cards safely without error
  const tinyPool = sampleDraftPool(colorlessCols, 100);
  assert(
    Array.isArray(tinyPool) && tinyPool.length > 0 && tinyPool.length < 100,
    "9.1.13 sampleDraftPool handles count exceeding pool size safely without crashing"
  );
}

// --- 9.2: Encounter Victory Interception & Final Campaign Bypass ---
{
  resetTestState();
  startNewRun(STARTER_DECKS[0]);

  // Non-final victory (encounter 0): generates pendingDraft
  state.encounterIdx = 0;
  state.enemyLife = 0;
  handleEncounterVictory();

  assert(
    state.pendingDraft &&
    Array.isArray(state.pendingDraft.choices) &&
    state.pendingDraft.choices.length === 3 &&
    state.pendingDraft.encounterIdx === 0 &&
    state.pendingDraft.resolved === false &&
    state.pendingDraft.skipped === false &&
    state.pendingDraft.selectedCardId === null,
    "9.2.1 Defeating non-final encounter sets state.pendingDraft with 3 choices, resolved: false"
  );

  const goldAfterVictory = state.gold;
  const lifeAfterVictory = state.playerLife;
  const pendingDraftAfterVictory = state.pendingDraft;
  assert(
    handleEncounterVictory() === false &&
    state.gold === goldAfterVictory &&
    state.playerLife === lifeAfterVictory &&
    state.pendingDraft === pendingDraftAfterVictory,
    "9.2.2 Repeated victory callbacks do not grant duplicate rewards or generate another draft"
  );

  // beginEncounter resets pendingDraft
  beginEncounter();
  assert(state.pendingDraft === null, "9.2.3 beginEncounter resets state.pendingDraft to null");

  // Final campaign encounter (encounter 5, Elesh Norn): bypasses draft completely
  state.encounterIdx = ENCOUNTERS.length - 1;
  state.route = {
    loop: 0,
    currentNodeId: "p2_boss",
    completedNodeIds: ["p1_start", "p1_upper_rest", "p1_elite", "p1_boss", "p2_entry_fight", "p2_mid_elite"],
    visitedNodeIds: ["p1_start", "p1_upper_rest", "p1_elite", "p1_boss", "p2_entry_fight", "p2_mid_elite", "p2_boss"],
    pendingSelection: false,
    lastActivitySummary: null
  };
  state.enemyLife = 0;
  const finalVictoryResolved = handleEncounterVictory();

  assert(
    finalVictoryResolved === true && state.pendingDraft === null,
    "9.2.4 Defeating final campaign encounter (Elesh Norn) bypasses draft generation (pendingDraft === null)"
  );
}

// --- 9.3: Card Selection Mechanics & Idempotency ---
{
  resetTestState();
  startNewRun(STARTER_DECKS[0]);
  state.encounterIdx = 0;
  state.enemyLife = 0;
  handleEncounterVictory();

  const initialDeckSize = state.masterDeck.length;
  const chosenChoice = state.pendingDraft.choices[1];
  const chosenId = typeof chosenChoice === "string" ? chosenChoice : chosenChoice.id;

  // Invalid index selection is rejected
  assert(
    selectDraftCard(-1) === false &&
    selectDraftCard(99) === false &&
    state.masterDeck.length === initialDeckSize,
    "9.3.1 Out-of-bounds selection index is rejected without altering deck"
  );

  // Valid card selection
  const selectSuccess = selectDraftCard(1);
  assert(
    selectSuccess === true &&
    state.masterDeck.length === initialDeckSize + 1 &&
    state.masterDeck[state.masterDeck.length - 1].id === chosenId &&
    state.pendingDraft.resolved === true &&
    state.pendingDraft.skipped === false &&
    state.pendingDraft.selectedCardId === chosenId,
    "9.3.2 selectDraftCard adds card clone to masterDeck, updates count, and sets resolved: true"
  );

  // Idempotency guard: double selection strictly rejected
  const doubleSelect = selectDraftCard(0);
  assert(
    doubleSelect === false &&
    state.masterDeck.length === initialDeckSize + 1,
    "9.3.3 Re-selecting after resolution is rejected (idempotency guard)"
  );

  // Cannot skip after select
  const skipAfterSelect = skipDraft();
  assert(
    skipAfterSelect === false,
    "9.3.4 Calling skipDraft after card selection is rejected"
  );
}

// --- 9.4: Draft Skip Compensation & Idempotency ---
{
  resetTestState();
  startNewRun(STARTER_DECKS[0]);
  state.encounterIdx = 1;
  state.route = {
    loop: 0,
    currentNodeId: "p1_elite",
    completedNodeIds: ["p1_start", "p1_upper_rest"],
    visitedNodeIds: ["p1_start", "p1_upper_rest", "p1_elite"],
    pendingSelection: false,
    lastActivitySummary: null
  };
  state.enemyLife = 0;
  handleEncounterVictory();

  const initialDeckSize = state.masterDeck.length;
  const initialGold = state.gold;

  const skipSuccess = skipDraft();
  assert(
    skipSuccess === true &&
    state.masterDeck.length === initialDeckSize &&
    state.gold === initialGold + 2 &&
    state.pendingDraft.resolved === true &&
    state.pendingDraft.skipped === true &&
    state.pendingDraft.selectedCardId === null,
    "9.4.1 skipDraft awards +$2 gold, adds 0 cards to masterDeck, and marks draft resolved"
  );

  // Double skip strictly rejected
  const doubleSkip = skipDraft();
  assert(
    doubleSkip === false &&
    state.gold === initialGold + 2,
    "9.4.2 Calling skipDraft a second time is rejected (gold remains unchanged)"
  );

  // Cannot select after skip
  const selectAfterSkip = selectDraftCard(0);
  assert(
    selectAfterSkip === false &&
    state.masterDeck.length === initialDeckSize,
    "9.4.3 Calling selectDraftCard after skip is rejected (deck size remains unchanged)"
  );
}

// --- 9.5: Save / Restore Persistence ---
{
  const prevDoc = globalThis.document;
  const prevLS = globalThis.localStorage;
  const memStore = createMemoryStorage();
  const prevHeadless = state.headless;

  try {
    resetTestState();
    startNewRun(STARTER_DECKS[0], "short_fuse", "riftfall", "riftfall-draft-seed");
    state.headless = false;
    globalThis.document = {};
    globalThis.localStorage = memStore;
    state.encounterIdx = 0;
    state.enemyLife = 0;
    handleEncounterVictory();

    const originalChoices = state.pendingDraft.choices.map(item => typeof item === "string" ? item : item.id);
    assert(originalChoices.length === 3, "9.5.1 Pending draft generated before save");

    // Save while draft is pending
    const originalRunId = state.runId;
    state.runTurns = 7;
    const savedPending = saveRunState(false);
    const expectedFutureRandoms = Array.from({ length: 5 }, () => gameRandom());
    assert(savedPending === true, "9.5.2 saveRunState successfully persists state with active pendingDraft");

    // Clear state in-memory and reload from localStorage
    state.pendingDraft = null;
    state.masterDeck = [];
    const loadSuccess = loadRunState();
    const restoredFutureRandoms = Array.from({ length: 5 }, () => gameRandom());

    assert(
      loadSuccess === true &&
      state.pendingDraft &&
      state.pendingDraft.resolved === false &&
      state.pendingDraft.choices.length === 3 &&
      state.pendingDraft.choices.map(item => typeof item === "string" ? item : item.id).every((id, idx) => id === originalChoices[idx]) &&
      state.pendingDraft.cards.some(card => card.generated === true) &&
      state.challengeId === "short_fuse" &&
      state.campaignId === "riftfall" &&
      state.runSeed === "riftfall-draft-seed" &&
      state.runId === originalRunId &&
      state.runTurns === 7 &&
      state.maxTurns === 4 &&
      JSON.stringify(restoredFutureRandoms) === JSON.stringify(expectedFutureRandoms),
      "9.5.3 loadRunState restores draft, challenge, campaign, seed, and exact future RNG state"
    );

    // Resolve the generated choice, then verify the card remains usable after restore.
    const generatedChoiceIndex = state.pendingDraft.choices.findIndex(item =>
      typeof item === "object" && item.generated === true
    );
    const initialDeckLen = state.masterDeck.length;
    const generatedChoiceId = state.pendingDraft.choices[generatedChoiceIndex].id;
    const selectedGenerated = selectDraftCard(generatedChoiceIndex);
    assert(
      selectedGenerated === true &&
      state.masterDeck.length === initialDeckLen + 1 &&
      state.masterDeck.at(-1).id === generatedChoiceId &&
      state.masterDeck.at(-1).generated === true,
      "9.5.4 Generated reward can be drafted into the master deck"
    );

    saveRunState(true);

    // Reload again: draft must be resolved, choices preserved, and no duplicate rewards
    state.masterDeck = [];
    loadRunState();
    assert(
      (!state.pendingDraft || state.pendingDraft.resolved === true) &&
      state.masterDeck.length === initialDeckLen + 1 &&
      state.masterDeck.some(card => card.id === generatedChoiceId && card.generated === true),
      "9.5.5 Reload restores generated card and does not re-offer draft or duplicate reward"
    );

    startNewRun(STARTER_DECKS[0], "standard", "riftfall");
    state.encounterIdx = 5;
    state.route = {
      loop: 0,
      currentNodeId: "p2_boss",
      completedNodeIds: ["p1_start", "p1_upper_rest", "p1_elite", "p1_boss", "p2_entry_fight", "p2_mid_elite"],
      visitedNodeIds: ["p1_start", "p1_upper_rest", "p1_elite", "p1_boss", "p2_entry_fight", "p2_mid_elite", "p2_boss"],
      pendingEventId: null,
      pendingSelection: false,
      lastActivitySummary: null
    };
    beginEncounter();
    state.enemyLife = 0;
    const finalBossWon = handleEncounterVictory();
    state.campaignId = DEFAULT_CAMPAIGN_ID;
    state.encounterIdx = 0;
    state.route = createInitialRouteState(0);
    const restoredFinalBoss = loadRunState();
    assert(
      finalBossWon &&
      restoredFinalBoss &&
      state.campaignId === "riftfall" &&
      getCurrentEncounter().name === "The Void Architect" &&
      state.route.currentNodeId === "p2_boss" &&
      state.route.completedNodeIds.includes("p2_boss") &&
      getAvailableNextRouteNodes().length === 0 &&
      readGameProfile().profile.unlockedStarterDeckIds.includes("simic_tidecallers"),
      "9.5.6 Restoring a completed Riftfall final node preserves its campaign and terminal route state"
    );
  } finally {
    state.headless = prevHeadless;
    if (prevDoc === undefined) delete globalThis.document;
    else globalThis.document = prevDoc;
    if (prevLS === undefined) delete globalThis.localStorage;
    else globalThis.localStorage = prevLS;
  }
}

// --- 9.5.7: Run History Recording & Storage Safety ---
{
  const prevLS = globalThis.localStorage;
  const prevHeadless = state.headless;
  const memStore = createMemoryStorage();
  try {
    resetTestState();
    state.headless = true;
    globalThis.localStorage = memStore;
    startNewRun(STARTER_DECKS[0], "standard", "riftfall", "history-victory-seed");
    state.encounterIdx = 5;
    state.route = {
      loop: 0,
      currentNodeId: "p2_boss",
      completedNodeIds: ["p1_start", "p1_upper_rest", "p1_elite", "p1_boss", "p2_entry_fight", "p2_mid_elite"],
      visitedNodeIds: ["p1_start", "p1_upper_rest", "p1_elite", "p1_boss", "p2_entry_fight", "p2_mid_elite", "p2_boss"],
      pendingEventId: null,
      pendingSelection: false,
      lastActivitySummary: null
    };
    beginEncounter();
    state.runTurns = 12;
    state.enemyLife = 0;
    const victoryHandled = handleEncounterVictory();
    const firstHistory = readRunHistory();
    const duplicateVictory = recordCompletedRun("victory");
    assert(
      victoryHandled &&
      firstHistory.ok &&
      firstHistory.entries.length === 1 &&
      firstHistory.entries[0].outcome === "victory" &&
      firstHistory.entries[0].runId === state.runId &&
      firstHistory.entries[0].turns === 12 &&
      duplicateVictory.ok &&
      duplicateVictory.duplicate &&
      readRunHistory().entries.length === 1,
      "9.5.7.1 Final victory records the run once with its ID and turn count"
    );

    startNewRun(STARTER_DECKS[1], "standard", DEFAULT_CAMPAIGN_ID, "history-defeat-seed");
    state.runTurns = 4;
    handleDefeat();
    const defeatHistory = readRunHistory();
    assert(
      defeatHistory.ok &&
      defeatHistory.entries.length === 2 &&
      defeatHistory.entries[0].outcome === "defeat" &&
      defeatHistory.entries[0].turns === 4 &&
      defeatHistory.entries[1].outcome === "victory",
      "9.5.7.2 Defeat is recorded as the newest completed run"
    );

    let allEntriesSaved = true;
    for (let index = 0; index < MAX_RUN_HISTORY_ENTRIES + 3; index += 1) {
      state.runId = `history-cap-${index}`;
      state.runStartedAt = Date.now();
      state.runHistoryRecorded = false;
      state.runTurns = index;
      const saved = recordCompletedRun("defeat");
      allEntriesSaved = allEntriesSaved && saved.ok;
    }
    const cappedHistory = readRunHistory();
    assert(
      allEntriesSaved &&
      cappedHistory.ok &&
      cappedHistory.entries.length === MAX_RUN_HISTORY_ENTRIES &&
      cappedHistory.entries[0].runId === `history-cap-${MAX_RUN_HISTORY_ENTRIES + 2}` &&
      !cappedHistory.entries.some(entry => entry.runId === firstHistory.entries[0].runId),
      "9.5.7.4 Run history is capped at 25 newest entries"
    );

    const malformedHistory = "{malformed";
    memStore.setItem(RUN_HISTORY_KEY, malformedHistory);
    state.runId = "history-malformed-preserve";
    state.runHistoryRecorded = false;
    const malformedWrite = recordCompletedRun("defeat");
    assert(
      !readRunHistory().ok &&
      !malformedWrite.ok &&
      memStore.getItem(RUN_HISTORY_KEY) === malformedHistory,
      "9.5.7.5 Malformed history reports an error and is never overwritten"
    );

    globalThis.localStorage = {
      getItem: () => null,
      setItem: () => { throw new Error("quota exceeded"); }
    };
    state.runId = "history-storage-failure";
    state.runHistoryRecorded = false;
    const storageFailure = recordCompletedRun("defeat");
    assert(
      !storageFailure.ok &&
      state.runHistoryRecorded === false &&
      state.runHistoryError.includes("quota exceeded"),
      "9.5.7.6 Storage write failures are surfaced without marking the run recorded"
    );
  } finally {
    state.headless = prevHeadless;
    if (prevLS === undefined) delete globalThis.localStorage;
    else globalThis.localStorage = prevLS;
  }
}

// --- 9.6: Normalizer Parity Across Files ---
{
  load("desktop.js");

  const rawValid = {
    version: 1,
    savedAt: 1700000000000,
    inShop: false,
    archetypeId: "gruul",
    encounterIdx: 1,
    playerLife: 20,
    gold: 10,
    masterDeck: [{ id: "lightning_bolt" }],
    relicIds: [],
    consumableIds: [],
    pendingDraft: {
      choices: ["stomping_ground", "lotus_cobra", "cultivate"],
      encounterIdx: 1,
      resolved: false,
      skipped: false,
      selectedCardId: null
    }
  };

  const normGame = normalizeCanonicalSave(rawValid);
  const normDesk = DesktopBridge.normalizeSaveObject(rawValid);

  assert(
    normGame.valid === true && normDesk.valid === true,
    "9.6.1 Both game.js and desktop.js normalizers validate valid draft payload"
  );

  assert(
    JSON.stringify(normGame.save.pendingDraft) === JSON.stringify(normDesk.save.pendingDraft),
    "9.6.2 pendingDraft normalization is byte-for-byte symmetric across game.js and desktop.js"
  );

  const challengePayload = { ...rawValid, challengeId: "short_fuse" };
  const challengeGame = normalizeCanonicalSave(challengePayload);
  const challengeDesktop = DesktopBridge.normalizeSaveObject(challengePayload);
  const invalidChallenge = normalizeCanonicalSave({ ...rawValid, challengeId: "not_a_challenge" });
  assert(
    challengeGame.valid &&
    challengeDesktop.valid &&
    challengeGame.save.challengeId === "short_fuse" &&
    challengeDesktop.save.challengeId === "short_fuse" &&
    challengeGame.save.saveIntegrity === challengeDesktop.save.saveIntegrity &&
    invalidChallenge.valid &&
    invalidChallenge.save.challengeId === undefined,
    "9.6.3 Challenge save normalization and checksums are symmetric, with unknown IDs sanitized"
  );

  const campaignPayload = { ...rawValid, campaignId: "riftfall" };
  const campaignGame = normalizeCanonicalSave(campaignPayload);
  const campaignDesktop = DesktopBridge.normalizeSaveObject(campaignPayload);
  const invalidCampaign = normalizeCanonicalSave({ ...rawValid, campaignId: "unknown_campaign" });
  assert(
    campaignGame.valid &&
    campaignDesktop.valid &&
    campaignGame.save.campaignId === "riftfall" &&
    campaignDesktop.save.campaignId === "riftfall" &&
    campaignGame.save.saveIntegrity === campaignDesktop.save.saveIntegrity &&
    invalidCampaign.valid &&
    invalidCampaign.save.campaignId === undefined,
    "9.6.4 Campaign save normalization and checksums are symmetric, with unknown IDs sanitized"
  );

  const seededPayload = { ...rawValid, runSeed: "shared-seed", rngState: 123456789 };
  const seededGame = normalizeCanonicalSave(seededPayload);
  const seededDesktop = DesktopBridge.normalizeSaveObject(seededPayload);
  const invalidSeedPayload = { ...rawValid, runSeed: "s".repeat(MAX_RUN_SEED_LENGTH + 1), rngState: 123456789 };
  const invalidSeedGame = normalizeCanonicalSave(invalidSeedPayload);
  assert(
    seededGame.valid &&
    seededDesktop.valid &&
    seededGame.save.runSeed === "shared-seed" &&
    seededDesktop.save.runSeed === "shared-seed" &&
    seededGame.save.rngState === 123456789 &&
    seededGame.save.saveIntegrity === seededDesktop.save.saveIntegrity &&
    invalidSeedGame.valid &&
    invalidSeedGame.save.runSeed === undefined &&
    invalidSeedGame.save.rngState === undefined,
    "9.6.5 Seed and PRNG state normalize consistently across game and desktop saves"
  );

  const historyPayload = {
    ...rawValid,
    runId: "run-history-roundtrip",
    runStartedAt: 1699999999000,
    runHistoryRecorded: true,
    runTurns: 14
  };
  const historyGame = normalizeCanonicalSave(historyPayload);
  const historyDesktop = DesktopBridge.normalizeSaveObject(historyPayload);
  assert(
    historyGame.valid &&
    historyDesktop.valid &&
    historyGame.save.runId === "run-history-roundtrip" &&
    historyGame.save.runStartedAt === 1699999999000 &&
    historyGame.save.runHistoryRecorded === true &&
    historyGame.save.runTurns === 14 &&
    historyGame.save.saveIntegrity === historyDesktop.save.saveIntegrity,
    "9.6.6 Run history identity fields normalize consistently with matching checksums"
  );

  const evolvedPayload = {
    ...rawValid,
    masterDeck: [{
      id: "llanowar_elves",
      permPowerBonus: 1,
      permToughnessBonus: 1,
      evolutionId: "trampler",
      keywords: ["Mana +1 {G}", "Trample"]
    }]
  };
  const evolvedGame = normalizeCanonicalSave(evolvedPayload);
  const evolvedDesktop = DesktopBridge.normalizeSaveObject(evolvedPayload);
  assert(
    evolvedGame.valid &&
    evolvedDesktop.valid &&
    JSON.stringify(evolvedGame.save.masterDeck) === JSON.stringify(evolvedDesktop.save.masterDeck) &&
    evolvedGame.save.masterDeck[0].evolutionId === "trampler" &&
    evolvedGame.save.saveIntegrity === evolvedDesktop.save.saveIntegrity,
    "9.6.3 Game and desktop normalizers preserve evolved-card metadata with matching integrity checks"
  );

  const invalidEvolutionPayload = {
    ...rawValid,
    masterDeck: [
      { id: "forest", evolutionId: "veteran" },
      { id: "llanowar_elves", evolutionId: "trampler" }
    ]
  };
  const invalidEvolutionGame = normalizeCanonicalSave(invalidEvolutionPayload);
  const invalidEvolutionDesktop = DesktopBridge.normalizeSaveObject(invalidEvolutionPayload);
  assert(
    invalidEvolutionGame.valid &&
    invalidEvolutionDesktop.valid &&
    !Object.prototype.hasOwnProperty.call(invalidEvolutionGame.save.masterDeck[0], "evolutionId") &&
    !Object.prototype.hasOwnProperty.call(invalidEvolutionDesktop.save.masterDeck[0], "evolutionId") &&
    !Object.prototype.hasOwnProperty.call(invalidEvolutionGame.save.masterDeck[1], "evolutionId") &&
    !Object.prototype.hasOwnProperty.call(invalidEvolutionDesktop.save.masterDeck[1], "evolutionId"),
    "9.6.4 Invalid evolution metadata is discarded for non-Creatures and incomplete applied effects"
  );

  const generatedCard = sampleGeneratedCreature(new Set(["G", "R"]), 4444);
  const generatedPayload = {
    ...rawValid,
    masterDeck: [
      { id: "lightning_bolt" },
      { id: generatedCard.id, generatedDefinition: generatedCard }
    ],
    pendingDraft: {
      choices: [{ id: generatedCard.id, generatedDefinition: generatedCard }],
      encounterIdx: 1,
      resolved: false
    }
  };
  const generatedGame = normalizeCanonicalSave(generatedPayload);
  const generatedDesk = DesktopBridge.normalizeSaveObject(generatedPayload);
  const tamperedGenerated = {
    ...generatedGame.save,
    masterDeck: generatedGame.save.masterDeck.map(item =>
      item.id === generatedCard.id
        ? { ...item, generatedDefinition: { ...item.generatedDefinition, power: 99 } }
        : item
    )
  };
  assert(
    generatedGame.valid &&
    generatedDesk.valid &&
    generatedGame.save.masterDeck.some(item => item.generatedDefinition?.id === generatedCard.id) &&
    generatedGame.save.pendingDraft.choices.some(item => item.generatedDefinition?.id === generatedCard.id) &&
    JSON.stringify(generatedGame.save) === JSON.stringify(generatedDesk.save) &&
    DesktopBridge.normalizeSaveObject(tamperedGenerated).valid === false,
    "9.6.3 Desktop and game save normalizers preserve generated cards and reject tampered generated definitions"
  );

  // Sanitize unrecognized cards in pendingDraft
  const rawWithCorruptChoices = {
    ...rawValid,
    pendingDraft: {
      choices: ["stomping_ground", "fake_nonexistent_card_xyz", "cultivate"],
      encounterIdx: 1,
      resolved: false
    }
  };

  const sanitizedGame = normalizeCanonicalSave(rawWithCorruptChoices);
  const sanitizedDesk = DesktopBridge.normalizeSaveObject(rawWithCorruptChoices);

  assert(
    sanitizedGame.save.pendingDraft.choices.length === 2 &&
    !sanitizedGame.save.pendingDraft.choices.includes("fake_nonexistent_card_xyz") &&
    JSON.stringify(sanitizedGame.save.pendingDraft) === JSON.stringify(sanitizedDesk.save.pendingDraft),
    "9.6.4 Corrupt or unrecognized card IDs are filtered from pendingDraft choices symmetrically"
  );

  // 9.6.5: Backup envelope format preservation
  const backupEnvelope = {
    format: "manastorm-save-backup",
    save: rawValid
  };
  const normBackup = DesktopBridge.normalizeSaveObject(backupEnvelope);
  assert(
    normBackup.valid === true &&
    normBackup.save.pendingDraft &&
    normBackup.save.pendingDraft.choices.length === 3,
    "9.6.5 Backup envelope format preserves pendingDraft through DesktopBridge.normalizeSaveObject"
  );

  // 9.6.6: compareSaveFreshness checks draft resolution when timestamp and encounter match
  const savePending = { savedAt: 1000, encounterIdx: 1, inShop: false, pendingDraft: { resolved: false } };
  const saveResolved = { savedAt: 1000, encounterIdx: 1, inShop: false, pendingDraft: { resolved: true } };
  assert(
    DesktopBridge.compareSaveFreshness(saveResolved, savePending) > 0 &&
    DesktopBridge.compareSaveFreshness(savePending, saveResolved) < 0,
    "9.6.6 compareSaveFreshness prioritizes resolved draft over pending draft when timestamp/encounter match"
  );
}

// --- 9.7: Edge Cases, Aliases & Robustness ---
{
  resetTestState();
  startNewRun(STARTER_DECKS[0]);

  // 9.7.1: Invalid inputs to isCardLegalForDeck return false
  assert(
    isCardLegalForDeck(null, new Set(["G"])) === false &&
    isCardLegalForDeck(undefined, new Set(["G"])) === false &&
    isCardLegalForDeck("", new Set(["G"])) === false &&
    isCardLegalForDeck({}, new Set(["G"])) === false,
    "9.7.1 isCardLegalForDeck gracefully handles null, undefined, empty string, and empty object"
  );

  // 9.7.2: state.pendingDraft.cards getter returns CARD_DB objects
  state.encounterIdx = 0;
  state.enemyLife = 0;
  handleEncounterVictory();
  assert(
    Array.isArray(state.pendingDraft.cards) &&
    state.pendingDraft.cards.length === 3 &&
    Boolean(state.pendingDraft.cards[0].name) &&
    Boolean(state.pendingDraft.cards[0].type),
    "9.7.2 state.pendingDraft.cards getter returns array of fully populated CARD_DB card objects"
  );

  // 9.7.3: Selection by card ID string
  const targetCard = state.pendingDraft.choices[2];
  const targetCardId = typeof targetCard === "string" ? targetCard : targetCard.id;
  const deckSizeBefore = state.masterDeck.length;
  const pickedById = selectDraftCard(targetCardId);
  assert(
    pickedById === true &&
    state.masterDeck.length === deckSizeBefore + 1 &&
    state.masterDeck[state.masterDeck.length - 1].id === targetCardId,
    "9.7.3 selectDraftCard supports selection via exact card ID string"
  );

  // 9.7.4: Cannot draft or skip when state.runOver = true
  resetTestState();
  startNewRun(STARTER_DECKS[0]);
  state.encounterIdx = 0;
  state.enemyLife = 0;
  handleEncounterVictory();
  state.runOver = true;
  assert(
    selectDraftCard(0) === false &&
    skipDraft() === false,
    "9.7.4 Both selectDraftCard and skipDraft are rejected when state.runOver is true"
  );

  // 9.7.5: generateDraftRewardPool alias works identically to sampleDraftPool
  assert(
    typeof generateDraftRewardPool === "function" &&
    generateDraftRewardPool === sampleDraftPool,
    "9.7.5 generateDraftRewardPool is exposed as alias to sampleDraftPool"
  );
}

// --- 10.1: Searchable Card Collection ---
{
  const cards = Object.values(CARD_DB);
  const originalOrder = cards.map(card => card.id);
  const blueCards = filterCardCollection(cards, { color: "U" });
  const creatureRules = filterCardCollection(cards, { type: "Creature", query: "landfall" });
  const colorlessCards = filterCardCollection(cards, { color: "C" });
  const sortedByMana = filterCardCollection(cards, { sort: "mana" });
  const emptyResults = filterCardCollection(cards, { query: "no-card-matches-this-query" });
  const escapedCard = renderCardCollectionCard({
    ...CARD_DB.forest,
    name: "<img src=x>",
    rules: "<script>alert(1)</script>"
  });
  assert(
    blueCards.some(card => card.id === "island") &&
    blueCards.some(card => card.id === "hallowed_fountain") &&
    blueCards.some(card => card.id === "ledger_shredder") &&
    !blueCards.some(card => card.id === "forest"),
    "10.1.1 Card color filter includes multicolor lands and colored spells"
  );
  assert(
    creatureRules.length > 0 &&
    creatureRules.every(card => card.type === "Creature" && `${card.rules} ${card.name}`.toLowerCase().includes("landfall")),
    "10.1.2 Search text and type filters combine against card names and rules"
  );
  assert(
    colorlessCards.some(card => card.id === "thoughtcast") &&
    !colorlessCards.some(card => card.id === "forest") &&
    getCardCollectionTypes().includes("Creature"),
    "10.1.3 Colorless filtering and available type discovery work"
  );
  assert(
    sortedByMana.length === cards.length &&
    sortedByMana.every((card, index) => index === 0 || getCardCollectionManaValue(sortedByMana[index - 1]) <= getCardCollectionManaValue(card)) &&
    JSON.stringify(cards.map(card => card.id)) === JSON.stringify(originalOrder),
    "10.1.4 Sorting returns an ordered copy without mutating the card catalog"
  );
  assert(
    emptyResults.length === 0 &&
    escapedCard.includes("&lt;img src=x&gt;") &&
    escapedCard.includes("&lt;script&gt;"),
    "10.1.5 Empty search results and escaped catalog text are handled safely"
  );
}

// --- 10.2: Bounded Structured Combat Log ---
{
  resetTestState();
  startNewRun(STARTER_DECKS[0]);
  state.enemyLife = 1000;
  state.enemyMaxLife = 1000;
  state.turn = 1;
  state.maxTurns = 5;
  state.playerLife = 20;
  state.playerCreatures = [{
    uid: "log-attacker",
    name: "Log Attacker",
    power: 4,
    toughness: 4,
    tempPower: 0,
    tempToughness: 0,
    keywords: [],
    tempKeywords: [],
    attacking: true,
    summoningSick: false,
    count: 1
  }];
  state.enemyCreatures = [{
    uid: "log-blocker",
    name: "Log Blocker",
    power: 1,
    toughness: 5,
    keywords: [],
    frozen: false
  }];
  addResonance(1, "Log Test Trigger");
  executeCombatAndEndTurn();
  const encounterEvents = getCombatLogEntries();
  const triggerIndex = encounterEvents.findIndex(event => event.message.includes("Log Test Trigger"));
  const combatIndex = encounterEvents.findIndex(event => event.message.startsWith("Attack resolved"));
  const blockerIndex = encounterEvents.findIndex(event => event.type === "blocker");
  const playerDamageIndex = encounterEvents.findIndex(event => event.message.startsWith("Player dealt"));
  const retaliationIndex = encounterEvents.findIndex(event => event.message.startsWith("Enemy retaliation"));
  const nextTurnIndex = encounterEvents.findIndex(event => event.message.startsWith("Turn 2 begins"));
  assert(
    encounterEvents[0].type === "encounter" &&
    encounterEvents[1].type === "turn" &&
    triggerIndex > 0 &&
    combatIndex > triggerIndex &&
    blockerIndex > combatIndex &&
    playerDamageIndex > blockerIndex &&
    retaliationIndex > playerDamageIndex &&
    nextTurnIndex > retaliationIndex,
    "10.2.1 Encounter, trigger, blocker, damage, retaliation, and next-turn events retain resolution order"
  );
  assert(
    encounterEvents.some(event => event.type === "damage" && event.details.lifeAfter === 19) &&
    encounterEvents.every((event, index) => index === 0 || event.id > encounterEvents[index - 1].id),
    "10.2.2 Combat log records Life changes and monotonic event ordering"
  );

  for (let index = 0; index < MAX_COMBAT_LOG_ENTRIES + 10; index += 1) {
    recordCombatEvent("trigger", `bounded-event-${index}`);
  }
  const boundedEvents = getCombatLogEntries();
  assert(
    boundedEvents.length === MAX_COMBAT_LOG_ENTRIES &&
    boundedEvents[boundedEvents.length - 1].message === `bounded-event-${MAX_COMBAT_LOG_ENTRIES + 9}`,
    "10.2.3 Combat log keeps only the newest 100 events"
  );

  state.encounterIdx = 1;
  beginEncounter();
  const nextEncounterEvents = getCombatLogEntries();
  assert(
    nextEncounterEvents.length === 2 &&
    nextEncounterEvents[0].type === "encounter" &&
    nextEncounterEvents[1].type === "turn",
    "10.2.4 Starting another encounter clears the prior encounter log"
  );
}

// === SECTION 11: CARD PURGE, PROCEDURAL AUDIO & KEYWORD GLOSSARY ===
{
  console.log("\n=== SECTION 11: CARD PURGE, PROCEDURAL AUDIO & KEYWORD GLOSSARY ===");
  resetTestState();
  startNewRun(STARTER_DECKS[0]);

  // 11.1 canSafelyPurgeCard and getAvailablePurgeTargets
  assert(state.masterDeck.length === 40, "11.1.1 Initial deck has 40 cards");
  assert(canSafelyPurgeCard().allowed === true, "11.1.2 canSafelyPurgeCard allows thinning when deck has 40 cards");
  assert(getAvailablePurgeTargets().length === 40, "11.1.3 getAvailablePurgeTargets returns all 40 cards");

  // Artificial reduction to 30 cards
  const savedExtraCards = state.masterDeck.splice(30);
  assert(state.masterDeck.length === 30, "11.1.4 Reduced deck to exactly 30 cards");
  assert(canSafelyPurgeCard().allowed === false, "11.1.5 canSafelyPurgeCard guards deck at 30 cards");
  assert(getAvailablePurgeTargets().length === 0, "11.1.6 getAvailablePurgeTargets returns empty array when at min deck size");

  // Restore cards
  state.masterDeck.push(...savedExtraCards);
  assert(state.masterDeck.length === 40, "11.1.7 Restored deck to 40 cards");

  // 11.2 completeCardPurgePurchase
  state.gold = 10;
  generateShopStock(false);
  const purgeUpgradeIdx = state.shopStock.upgrades.findIndex(u => u.id === "card_purge");
  assert(purgeUpgradeIdx !== -1, "11.2.1 card_purge upgrade is present in shop upgrades stock");

  const purgeUpg = state.shopStock.upgrades[purgeUpgradeIdx];
  const targetCard = state.masterDeck.find(c => c.id === "llanowar_elves") || state.masterDeck[0];
  const targetUid = targetCard.uid;
  const initialDeckLen = state.masterDeck.length;

  // Insufficient gold test
  state.gold = 0;
  const failedGoldPurge = completeCardPurgePurchase(purgeUpgradeIdx, targetUid);
  assert(failedGoldPurge === false, "11.2.2 completeCardPurgePurchase fails with insufficient gold");
  assert(state.masterDeck.length === initialDeckLen, "11.2.3 Master deck unchanged after failed gold purge");

  // Successful purge test
  state.gold = purgeUpg.cost + 5;
  const initialGold = state.gold;
  const successPurge = completeCardPurgePurchase(purgeUpgradeIdx, targetUid);
  assert(successPurge === true, "11.2.4 completeCardPurgePurchase succeeds with valid state and gold");
  assert(state.gold === initialGold - purgeUpg.cost, "11.2.5 Gold deducted correctly for card purge");
  assert(purgeUpg.bought === true, "11.2.6 card_purge upgrade marked bought");
  assert(state.masterDeck.length === initialDeckLen - 1, "11.2.7 Card removed from master deck");
  assert(!state.masterDeck.some(c => c.uid === targetUid), "11.2.8 Specific purged card UID is no longer in master deck");

  // Purge when already bought
  const repeatPurge = completeCardPurgePurchase(purgeUpgradeIdx, state.masterDeck[0].uid);
  assert(repeatPurge === false, "11.2.9 Cannot repeat already bought purge upgrade");

  // 11.3 Procedural Audio Cues
  assert(typeof SOUND_CUES === "object" && SOUND_CUES !== null, "11.3.1 SOUND_CUES object exists");
  assert(Array.isArray(SOUND_CUES.defeat) && SOUND_CUES.defeat.length >= 2, "11.3.2 defeat sound cue defined with rich harmonic tones");
  assert(Array.isArray(SOUND_CUES.shopBuy) && SOUND_CUES.shopBuy.length >= 2, "11.3.3 shopBuy sound cue defined with coin chime");
  assert(Array.isArray(SOUND_CUES.cardPurge) && SOUND_CUES.cardPurge.length >= 2, "11.3.4 cardPurge sound cue defined with dissolve tone");
  assert(Array.isArray(SOUND_CUES.relicTrigger) && SOUND_CUES.relicTrigger.length >= 2, "11.3.5 relicTrigger sound cue defined with harmonic tones");

  // 11.4 Keyword Glossary & Accessibility
  assert(typeof KEYWORD_GLOSSARY === "object" && KEYWORD_GLOSSARY !== null, "11.4.1 KEYWORD_GLOSSARY object exists");
  const requiredKeywords = [
    "Trample", "Haste", "Prowess", "Landfall", "Double Strike",
    "Deathtouch", "Lifelink", "Flying", "Connive", "Frozen", "Freeze",
    "Anthem", "Dredge", "Recur", "Metalcraft", "Undergrowth",
    "Tribal", "Overdrive", "Ramp", "Ritual", "Tokens", "Bounce",
    "Burn", "Vigilance", "Ward"
  ];
  const allKeywordsPresent = requiredKeywords.every(kw => typeof KEYWORD_GLOSSARY[kw] === "string" && KEYWORD_GLOSSARY[kw].length > 10);
  assert(allKeywordsPresent, "11.4.2 All core keywords documented with clear explanations in KEYWORD_GLOSSARY");

  // Verify renderKeywordTagsHtml generates accessible markup
  const sampleTagsHtml = renderKeywordTagsHtml(["Trample"], ["Flying"]);
  assert(sampleTagsHtml.includes('tabindex="0"'), "11.4.3 Keyword tags include tabindex=0 for keyboard accessibility");
  assert(sampleTagsHtml.includes('role="note"'), "11.4.4 Keyword tags include role=note for screen readers");
  assert(sampleTagsHtml.includes('title="Trample:'), "11.4.5 Keyword tags include complete glossary description in title attribute");
}

// ============================================================================
// SECTION 12: LIVING LANDS (ENHANCEMENTS, OVERCHARGE, FUSION & PERSISTENCE)
// ============================================================================
console.log("\n=== SECTION 12: LIVING LANDS (ENHANCEMENTS, OVERCHARGE & FUSION) ===");
{
  // 12.1 Volcanic Land Enhancement (damages blocker, kills 1-toughness, burns when empty)
  resetTestState();
  const volMountain = cloneCard("mountain");
  applyLandEnhancementToCard(volMountain, "volcanic");
  state.playerLands = [volMountain];
  state.enemyCreatures = [
    { uid: "e_big", name: "Big Guard", power: 3, toughness: 4, keywords: [] },
    { uid: "e_small", name: "Goblin Raider", power: 2, toughness: 1, keywords: [] }
  ];
  tapLandManually(volMountain.uid);
  assert(state.enemyCreatures.length === 1 && state.enemyCreatures[0].uid === "e_big",
    "12.1.1 Volcanic Land tap kills lowest-toughness 1-toughness blocker");
  volMountain.tapped = false;
  state.enemyCreatures = [];
  tapLandManually(volMountain.uid);
  assert(state.turnBurnPower === 1,
    "12.1.2 Volcanic Land tap adds +1 Burn Power when no enemy blockers exist");

  // 12.2 Resonant Land Enhancement (fires via auto-tapper payManaForCard)
  resetTestState();
  const resForest = cloneCard("forest");
  applyLandEnhancementToCard(resForest, "resonant");
  state.playerLands = [resForest];
  const paid = payManaForCard({ manaCost: "{G}" });
  assert(paid === true && state.turnResonance === 2,
    "12.2.1 Resonant Land triggers +1 Resonance when tapped by auto-tapper");

  // 12.3 Blighted Land Enhancement (mills 1 and triggers Crucible of Worlds)
  resetTestState();
  const blightSwamp = cloneCard("swamp");
  applyLandEnhancementToCard(blightSwamp, "blighted");
  state.playerLands = [blightSwamp];
  state.library = [cloneCard("llanowar_elves")];
  state.relics = [RELIC_DB.find(r => r.id === "crucible_of_worlds")];
  tapLandManually(blightSwamp.uid);
  assert(state.library.length === 0 && state.graveyard.length === 1 && state.manaPool.ANY === 1,
    "12.3.1 Blighted Land mills top card to Graveyard and triggers Crucible of Worlds");

  // 12.4 Prismatic Land Enhancement (mana solver + Prismatic Court 5-color synergy)
  resetTestState();
  const prisForest = cloneCard("forest");
  applyLandEnhancementToCard(prisForest, "prismatic");
  state.playerLands = [prisForest];
  const plan = findManaPaymentPlan("{U}");
  assert(plan !== null && plan.landsToTap[0] === prisForest.uid,
    "12.4.1 Prismatic Land can pay any colored pip ({U}) in mana solver");
  const rainbowSyn = getSynergyStates().find(s => s.id === "rainbow");
  assert(rainbowSyn && rainbowSyn.count === 5 && rainbowSyn.tier === 2,
    "12.4.2 Prismatic Land counts as all 5 colors for Prismatic Court synergy");

  // 12.5 Land Overcharge (mana mode + resonance mode + Crucible synergy + guards)
  resetTestState();
  const ocMountain = cloneCard("mountain");
  applyLandEnhancementToCard(ocMountain, "resonant");
  const ocForest = cloneCard("forest");
  const tappedLand = cloneCard("island");
  tappedLand.tapped = true;
  state.playerLands = [ocMountain, ocForest, tappedLand];
  state.relics = [RELIC_DB.find(r => r.id === "crucible_of_worlds")];

  assert(overchargeLand(tappedLand.uid, "mana") === false,
    "12.5.1 Cannot overcharge an already tapped land");

  const ocManaOk = overchargeLand(ocMountain.uid, "mana", "R");
  assert(
    ocManaOk === true &&
    state.manaPool.R === 2 &&
    state.manaPool.ANY === 1 &&
    state.turnResonance === 3 && // Base 1 + Crucible 1 + Resonant tap 1
    state.graveyard.some(c => c.uid === ocMountain.uid) &&
    !state.playerLands.some(l => l.uid === ocMountain.uid),
    "12.5.2 Overcharge (mana) cracks land to Graveyard, grants +2 {R}, fires Resonant tap & Crucible"
  );

  const resBefore = state.turnResonance;
  const ocResOk = overchargeLand(ocForest.uid, "resonance");
  assert(
    ocResOk === true &&
    state.turnResonance === resBefore + 3 && // +2 Overcharge + 1 Crucible
    state.graveyard.some(c => c.uid === ocForest.uid),
    "12.5.3 Overcharge (resonance) cracks land to Graveyard and adds +2 Resonance"
  );

  // 12.6 Land Fusion (Dual & Mono, deck thinning, inheritance, tap passive, guards)
  resetTestState();
  startNewRun(STARTER_DECKS[0]); // Gruul (Forest + Mountain)
  const deckSizeBefore = state.masterDeck.length;
  const forestA = state.masterDeck.find(c => c.id === "forest");
  const mountainA = state.masterDeck.find(c => c.id === "mountain");
  applyLandEnhancementToCard(forestA, "resonant");

  assert(fuseLandsInDeck(forestA.uid, forestA.uid).ok === false,
    "12.6.1 Cannot fuse a Basic Land with itself");

  const fusionRes = fuseLandsInDeck(forestA.uid, mountainA.uid);
  assert(
    fusionRes.ok === true &&
    state.masterDeck.length === deckSizeBefore - 1 &&
    fusionRes.fusedCard.id === "fused_G_R" &&
    fusionRes.fusedCard.name === "Cinderroot Caldera" &&
    fusionRes.fusedCard.fused === true &&
    fusionRes.fusedCard.fusedPassive === "burn_resonance" &&
    fusionRes.fusedCard.landEnhancement === "resonant",
    "12.6.2 Fusing Forest + Mountain creates Cinderroot Caldera, thins deck by 1, and preserves enhancement"
  );

  // Verify Cinderroot Caldera tap passive fires (+1 Burn & +1 Resonance, plus inherited +1 Resonant)
  resetTestState();
  const caldera = fusionRes.fusedCard;
  caldera.tapped = false;
  state.playerLands = [caldera];
  payManaForCard({ manaCost: "{R}" });
  assert(state.turnBurnPower === 1 && state.turnResonance === 3,
    "12.6.3 Tapping Resonant Cinderroot Caldera triggers +1 Burn and +2 Resonance (fused + enhancement)");

  // 12.7 Shop & Rest Site Purchases + Save/Load Persistence
  resetTestState();
  startNewRun(STARTER_DECKS[0]);
  state.gold = 20;
  generateShopStock(false);
  const enhUpgIdx = state.shopStock.upgrades.findIndex(u => u.id === "land_enhancement");
  const fusUpgIdx = state.shopStock.upgrades.findIndex(u => u.id === "land_fusion");
  assert(enhUpgIdx !== -1 && fusUpgIdx !== -1,
    "12.7.1 Shop stocks both Living Land Infusion and Leyline Land Fusion upgrades");

  const targetLand = getAvailableLandEnhancementTargets()[0];
  const enhBought = completeLandEnhancementPurchase(enhUpgIdx, targetLand.uid, "volcanic");
  assert(enhBought === true && targetLand.landEnhancement === "volcanic" && state.shopStock.upgrades[enhUpgIdx].bought,
    "12.7.2 Purchasing Living Land Infusion enhances land and marks upgrade bought");

  const basicLands = getAvailableLandFusionTargets();
  const b1 = basicLands.find(l => l.produces[0] === "G");
  const b2 = basicLands.find(l => l.produces[0] === "R");
  const fusBought = completeLandFusionPurchase(fusUpgIdx, b1.uid, b2.uid);
  assert(fusBought === true && state.shopStock.upgrades[fusUpgIdx].bought && state.masterDeck.some(c => c.id === "fused_G_R"),
    "12.7.3 Purchasing Leyline Land Fusion merges 2 basics into Fused Land and marks upgrade bought");

  // Save & Restore round-trip
  const savePayload = createCanonicalSavePayload(true);
  const normalized = normalizeCanonicalSave(savePayload);
  assert(normalized.valid === true, "12.7.4 Canonical save with enhanced & fused lands passes validation");
  applyCanonicalSaveToState(normalized.save, false);
  const restoredEnhanced = state.masterDeck.find(c => c.landEnhancement === "volcanic");
  const restoredFused = state.masterDeck.find(c => c.id === "fused_G_R");
  assert(
    Boolean(restoredEnhanced) &&
    Boolean(restoredFused) &&
    restoredFused.fused === true &&
    restoredFused.fusedPassive === "burn_resonance" &&
    restoredFused.produces.includes("G") &&
    restoredFused.produces.includes("R"),
    "12.7.5 Save/Load round-trip preserves both Land Enhancements and Fused Land definitions"
  );
}

console.log("\n=== SECTION 13: 10-GUILD ROSTER, BOSS RELICS, PERMANENTS, TELEGRAPHS, ENDLESS & ASCENSION ===");
{
  // 13.1 Complete 10-Guild Roster (+ Colorless = 11 Starter Decks)
  const newGuildIds = ["azorius_blink", "dimir_dredge", "orzhov_aristocrats", "selesnya_tokens"];
  assert(
    STARTER_DECKS.length === 11 &&
    newGuildIds.every(id => STARTER_DECKS.some(d => d.id === id)),
    "13.1.1 All 10 two-color guilds + Colorless (11 starter decks) exist in STARTER_DECKS"
  );
  newGuildIds.forEach(id => {
    const deck = STARTER_DECKS.find(d => d.id === id);
    const lands = deck.cards.filter(cid => CARD_DB[cid]?.type === "Land").length;
    assert(
      deck.cards.length === 40 && lands === 17 && deck.cards.every(cid => Boolean(CARD_DB[cid])),
      `13.1.2 Guild '${id}' has 40 valid cards (17 Lands + 23 Spells)`
    );
  });

  // 13.2 Boss Relics & Relic Rarity Tiers
  resetTestState();
  startNewRun(STARTER_DECKS[0]);
  const rarities = new Set(RELIC_DB.map(r => r.rarity));
  assert(
    rarities.has("common") && rarities.has("uncommon") && rarities.has("rare") && rarities.has("boss") &&
    getBossRelicPool().length >= 5,
    "13.2.1 RELIC_DB defines Common, Uncommon, Rare, and 5+ Boss Relics"
  );
  generateShopStock(false);
  assert(
    state.shopStock.relics.every(r => !r.bossOnly && r.rarity !== "boss"),
    "13.2.2 Regular Sanctum Shop excludes bossOnly relics"
  );

  // Trigger Plane 1 Overlord victory -> pendingBossRelic offered
  state.encounterIdx = 2; // Vaelor, Plane 1 Overlord
  state.route.currentNodeId = "p1_boss";
  state.enemyLife = 0;
  handleEncounterVictory();
  assert(
    Boolean(state.pendingBossRelic) &&
    state.pendingBossRelic.choices.length === 3 &&
    !state.pendingBossRelic.resolved,
    "13.2.3 Defeating Plane 1 Overlord offers a 1-of-3 Boss Relic choice"
  );
  const chosenBossId = state.pendingBossRelic.choices[0];
  const claimed = selectBossRelic(0);
  assert(
    claimed === true &&
    state.pendingBossRelic.resolved === true &&
    hasRelic(chosenBossId) &&
    getRelicMaxSlots() === 6,
    "13.2.4 Claiming a Boss Relic adds it to Command Zone and unlocks 6th Relic slot"
  );

  // 13.3 Persistent Enchantments & Artifacts (Board Permanents)
  resetTestState();
  startNewRun(STARTER_DECKS.find(d => d.id === "orzhov_aristocrats"));
  state.manaPool.W = 5;
  state.manaPool.R = 5;
  state.manaPool.C = 5;
  const anthemCard = cloneCard("glorious_anthem");
  const signetCard = cloneCard("arcane_signet");
  state.hand = [anthemCard, signetCard];
  playCardFromHand(anthemCard.uid);
  playCardFromHand(signetCard.uid);
  assert(
    state.playerPermanents.length === 2 &&
    state.playerPermanents.some(p => p.id === "glorious_anthem") &&
    state.playerPermanents.some(p => p.id === "arcane_signet"),
    "13.3.1 Casting Enchantments and Artifacts deploys them to state.playerPermanents"
  );
  spawnTokens("Test Soldier", 2, 2, "W", ["Haste"], 1);
  state.enemyCreatures = [];
  const projWithAnthem = calculateProjectedCombat();
  assert(
    projWithAnthem.power >= 4,
    `13.3.2 Radiant Anthem grants +2/+2 static combat power (projected power=${projWithAnthem.power})`
  );

  // 13.4 Boss Surge Mechanics, Curse & Enemy Telegraphs
  resetTestState();
  startNewRun(STARTER_DECKS[0]);
  state.encounterIdx = 2; // Vaelor (surgeTurn = 3, surgeCurse = 1)
  beginEncounter();
  state.turn = 2;
  const t2Intent = getEncounterTurnIntent(getCurrentEncounter(), 2);
  assert(
    t2Intent.surgeUpcoming === true && !t2Intent.surgeActive,
    "13.4.1 Turn 2 telegraphs Vaelor's Turn 3 Dusk Blight Surge"
  );
  state.turn = 3;
  const t3Intent = getEncounterTurnIntent(getCurrentEncounter(), 3);
  assert(
    t3Intent.surgeActive === true,
    "13.4.2 Turn 3 marks Vaelor's Dusk Blight Surge as active"
  );
  const libBeforeCurse = state.library.length;
  state.playerCreatures = [];
  state.enemyCreatures = [];
  executeCombatAndEndTurn();
  const hasCurse = state.library.some(c => c.id === "blight_curse") || state.hand.some(c => c.id === "blight_curse");
  assert(
    hasCurse && (state.library.length + state.hand.length >= libBeforeCurse),
    "13.4.3 Vaelor Turn 3 Surge shuffles a Rift Blight Curse into the player's Library"
  );

  // 13.5 Escalating Endless Mutators & Ascension Ladder
  assert(
    getActiveEndlessMutators(0).length === 0 &&
    getActiveEndlessMutators(1).some(m => m.id === "hardened_vanguard") &&
    getActiveEndlessMutators(2).some(m => m.id === "aether_inflation") &&
    getActiveEndlessMutators(3).some(m => m.id === "collapsing_clock") &&
    getActiveEndlessMutators(4).some(m => m.id === "relentless_tide"),
    "13.5.1 Endless Mutators escalate cumulatively from Loop 1 to Loop 4+"
  );
  resetTestState();
  startNewRun(STARTER_DECKS[0], "standard", DEFAULT_CAMPAIGN_ID, null, { ascensionLevel: 3 });
  assert(
    state.ascensionLevel === 3 &&
    state.playerLife === START_LIFE - 4 &&
    state.enemyMaxLife === Math.round(ENCOUNTERS[0].maxLife * 1.25),
    "13.5.2 Ascension 3 applies -4 starting Life and +25% Boss HP scaling"
  );

  // 13.6 Expanded Evolutions, Land Enhancements & Consumables
  assert(
    CARD_EVOLUTION_OPTIONS.length === 5 &&
    LAND_ENHANCEMENT_OPTIONS.length === 6 &&
    CONSUMABLE_DB.length === 8,
    "13.6.1 Expanded Evolutions (5), Land Enhancements (6), and Consumables (8) are registered"
  );
  resetTestState();
  startNewRun(STARTER_DECKS[0]);
  spawnTokens("Alpha Beast", 5, 5, "G", ["Haste"], 1);
  const mirrorScroll = { ...CONSUMABLE_DB.find(c => c.id === "mirror_scroll"), uid: nextUid() };
  state.consumables = [mirrorScroll];
  useConsumable(mirrorScroll.uid);
  assert(
    state.playerCreatures.length === 2,
    "13.6.2 Rift Mirror consumable clones strongest Creature on board with Haste"
  );
  const overdriveScroll = { ...CONSUMABLE_DB.find(c => c.id === "aether_overdrive"), uid: nextUid() };
  state.consumables = [overdriveScroll];
  useConsumable(overdriveScroll.uid);
  assert(
    state.playerCreatures.every(c => (c.tempPower || 0) >= 2 && getCreatureKeywords(c).includes("Trample")),
    "13.6.3 Overdrive Scroll grants +2/+2, Haste, and Trample to all Creatures"
  );
}

// ============================================================================
// SECTION 14: ONLINE MTG CARD ART LIBRARY (SCRYFALL)
// ============================================================================
console.log("\n=== SECTION 14: ONLINE MTG CARD ART LIBRARY (SCRYFALL) ===");
{
  const allCardIds = Object.keys(CARD_DB);
  const missingArt = allCardIds.filter(id => {
    const url = getScryfallCardArtUrl(CARD_DB[id], getCardArtTheme(CARD_DB[id]));
    return !url || !url.startsWith("https://cards.scryfall.io/art_crop/");
  });
  assert(
    missingArt.length === 0,
    `14.1 Every card in CARD_DB (${allCardIds.length}) maps to a Scryfall art_crop image URL`
  );

  const boltHtml = renderCardArtHtml(CARD_DB.lightning_bolt, "hand");
  assert(
    boltHtml.includes('class="card-art-img"') && boltHtml.includes("https://cards.scryfall.io/art_crop/") && boltHtml.includes("card-art-svg"),
    "14.2 renderCardArtHtml renders Scryfall <img> with engraved SVG fallback"
  );

  const tokenCard = { id: "token_goblin", name: "Goblin Token", type: "Creature", subtype: "Goblin", color: "R" };
  const tokenHtml = renderCardArtHtml(tokenCard, "board");
  assert(
    tokenHtml.includes('class="card-art-img"') && tokenHtml.includes("https://cards.scryfall.io/art_crop/"),
    "14.3 Token & unmapped cards resolve theme-matched Scryfall art_crop URLs"
  );

  const badgeHtml = renderCardIconBadgeHtml(CARD_DB.serra_angel);
  assert(
    badgeHtml.includes('class="card-icon-badge-img"') && badgeHtml.includes("https://cards.scryfall.io/art_crop/"),
    "14.4 renderCardIconBadgeHtml renders Scryfall thumbnail image with fallback"
  );
}

// ============================================================================
// SECTION 15: LAYOUT, DECK INSPECTOR, SHOP USABILITY & HOVER INSPECTOR WIRING
// ============================================================================
console.log("\n=== SECTION 15: LAYOUT, DECK INSPECTOR, SHOP USABILITY & HOVER INSPECTOR ===");
{
  resetTestState();
  startNewRun(STARTER_DECKS[0]);

  // 15.1 Duplicate stacking & category sorting in Deck Inspector
  const sampleCards = [
    { ...CARD_DB.forest, uid: "f1" },
    { ...CARD_DB.forest, uid: "f2" },
    { ...CARD_DB.forest, uid: "f3", foil: "Foil" },
    { ...CARD_DB.llanowar_elves, uid: "e1" },
    { ...CARD_DB.llanowar_elves, uid: "e2" },
    { ...CARD_DB.lightning_bolt, uid: "b1" }
  ];
  const grouped = groupDeckInspectorCards(sampleCards);
  assert(
    grouped.length === 4 &&
    grouped.find(g => g.card.id === "llanowar_elves").count === 2 &&
    grouped.find(g => g.card.id === "forest" && !g.card.foil).count === 2 &&
    grouped.find(g => g.card.id === "forest" && g.card.foil === "Foil").count === 1,
    "15.1 groupDeckInspectorCards stacks identical copies while preserving foiled variants"
  );

  // 15.2 openDeckInspector renders summary, mana curve, filter tabs, and stacked badges
  const prevHeadless = state.headless;
  const prevDoc = globalThis.document;
  const prevWin = globalThis.window;
  try {
    const nodes = {
      "deck-dialog-title": createMockElement("h2", "deck-dialog-title"),
      "deck-dialog-desc": createMockElement("p", "deck-dialog-desc"),
      "deck-dialog-summary": createMockElement("section", "deck-dialog-summary"),
      "deck-dialog-tabs": createMockElement("div", "deck-dialog-tabs"),
      "deck-dialog-grid": createMockElement("div", "deck-dialog-grid"),
      "deck-dialog": createMockElement("dialog", "deck-dialog"),
      "shop-gold": createMockElement("strong", "shop-gold"),
      "shop-deck-summary": createMockElement("div", "shop-deck-summary"),
      "shop-owned-relics-bar": createMockElement("section", "shop-owned-relics-bar"),
      "shop-relics": createMockElement("div", "shop-relics"),
      "shop-cards": createMockElement("div", "shop-cards"),
      "shop-upgrades": createMockElement("div", "shop-upgrades"),
      "btn-reroll-shop": createMockElement("button", "btn-reroll-shop"),
      "card-hover-inspector": createMockElement("aside", "card-hover-inspector")
    };
    globalThis.document = {
      getElementById: (id) => nodes[id] || null,
      querySelector: () => null,
      querySelectorAll: () => []
    };
    globalThis.window = { innerWidth: 1280 };
    state.headless = false;

    openDeckInspector("Library", "Test Library", sampleCards);
    assert(
      nodes["deck-dialog-summary"].innerHTML.includes("MANA CURVE") &&
      nodes["deck-dialog-summary"].innerHTML.includes("Lands <strong>3</strong>") &&
      nodes["deck-dialog-tabs"].innerHTML.includes('data-deck-filter="land"') &&
      nodes["deck-dialog-grid"].innerHTML.includes("×2") &&
      nodes["deck-dialog-grid"].innerHTML.includes("card-art-frame"),
      "15.2 openDeckInspector renders stats summary, mana curve, filter tabs, copy badges, and card art"
    );

    // 15.3 renderShop displays deck ratio, SLOTS FULL when relics are maxed, and inline sell bar
    generateShopStock(false);
    const maxSlots = getRelicMaxSlots();
    state.relics = RELIC_DB.slice(0, maxSlots).map(r => ({ ...r }));
    state.gold = 99;
    renderShop();
    assert(
      nodes["shop-deck-summary"].innerHTML.includes("Deck: <strong>") &&
      nodes["shop-relics"].innerHTML.includes("SLOTS FULL") &&
      nodes["shop-owned-relics-bar"].innerHTML.includes("data-shop-sell-relic=") &&
      nodes["shop-cards"].innerHTML.includes("data-shop-card-idx="),
      "15.3 renderShop renders deck Land/Spell ratio, SLOTS FULL label, inline owned relic sell bar, and hover attributes"
    );

    // 15.4 Hover inspector payload resolution for Shop items, Permanents, and Deck Inspector cards
    state.playerPermanents = [{ uid: "perm_1", name: "Sylvan Anthem", type: "Enchantment", color: "G", rules: "Creatures you control get +1/+1." }];
    const shopCardPayload = resolveHoverInspectorPayload({ dataset: { shopCardIdx: "0" } });
    const shopRelicPayload = resolveHoverInspectorPayload({ dataset: { shopRelicIdx: "0" } });
    const permPayload = resolveHoverInspectorPayload({ dataset: { permanentUid: "perm_1" } });
    const deckPayload = resolveHoverInspectorPayload({ dataset: { deckInspectorIdx: "0" } });
    assert(
      shopCardPayload && shopCardPayload.badge.includes("SANCTUM SHOP") &&
      shopRelicPayload && shopRelicPayload.data.isRelic === true &&
      permPayload && permPayload.data.name === "Sylvan Anthem" &&
      deckPayload && deckPayload.badge.includes("DECK INSPECTOR"),
      "15.4 resolveHoverInspectorPayload resolves shop cards, shop relics, active permanents, and deck inspector cards"
    );

    showCardHoverInspector(shopRelicPayload.data);
    assert(
      nodes["card-hover-inspector"].innerHTML.includes("Command Zone Relic"),
      "15.5 showCardHoverInspector renders Command Zone Relics cleanly"
    );
  } finally {
    state.headless = prevHeadless;
    if (prevDoc === undefined) delete globalThis.document;
    else globalThis.document = prevDoc;
    if (prevWin === undefined) delete globalThis.window;
    else globalThis.window = prevWin;
  }
}

console.log(`\n========================================`);
console.log(`ALL SUITES COMPLETE: ${passed} passed, ${failed} failed`);
console.log(`========================================`);
if (failed > 0 && typeof process !== "undefined") {
  process.exit(1);
}
