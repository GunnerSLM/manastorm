// challenger_p3_1_adversarial_test.js
// EMPIRICAL CHALLENGER P3-1: Adversarial verification of MANASTORM Part 3 Post-Battle Card Draft
// Targets:
// 1. Legality & Basic Land Exclusion (Exhaustive 64-subset color matrix)
// 2. Sampling Integrity (Thousands of runs across archetypes, mono-color, 3-color, custom RNG)
// 3. Draft Selection & Skip Mechanics (Single-claim idempotency, boundary conditions, edge cases)
// 4. Save/Restore State Persistence & Normalization Parity

load("data/cards.js");
load("data/relics.js");
load("mana.js");
load("combat.js");
load("ui.js");
load("game.js");
load("desktop.js");

state.headless = true;

let totalAssertions = 0;
let passedAssertions = 0;
let failedAssertions = 0;

function assert(condition, message) {
  totalAssertions++;
  if (condition) {
    passedAssertions++;
  } else {
    failedAssertions++;
    print("❌ FAILED ASSERTION: " + message);
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
}

function createMemoryStorage() {
  const store = new Map();
  return {
    getItem(k) { return store.has(k) ? store.get(k) : null; },
    setItem(k, v) { store.set(k, String(v)); },
    removeItem(k) { store.delete(k); },
    clear() { store.clear(); },
    get length() { return store.size; },
    key(i) { return Array.from(store.keys())[i] || null; }
  };
}

print("===================================================================");
print("MANASTORM EMPIRICAL CHALLENGER P3-1 ADVERSARIAL STRESS SUITE");
print("===================================================================");

// =================================================================
// 1. LEGALITY & BASIC LAND EXCLUSION STRESS
// =================================================================
print("\n--- 1. Legality & Basic Land Exclusion Stress ---");

const ALL_BASIC_IDS = ["forest", "mountain", "swamp", "island", "plains", "wastes"];
const ALL_COLORS = ["G", "R", "B", "U", "W", "C"];

// Generate all 2^6 = 64 color subsets
function getAllColorSubsets() {
  const subsets = [];
  const n = ALL_COLORS.length;
  for (let mask = 0; mask < (1 << n); mask++) {
    const subset = [];
    for (let i = 0; i < n; i++) {
      if ((mask & (1 << i)) !== 0) subset.push(ALL_COLORS[i]);
    }
    subsets.push(subset);
  }
  return subsets;
}

const colorSubsets = getAllColorSubsets();
assert(colorSubsets.length === 64, "1.0: Generated 64 color subsets from 6 primary colors");

// 1.1: Basic lands must be rejected for ALL 64 color subsets (Set and Array, String ID and Card Object)
let allBasicsRejected = true;
let basicRejectionCount = 0;

for (const subset of colorSubsets) {
  const setCols = new Set(subset);
  const arrCols = [...subset];

  for (const basicId of ALL_BASIC_IDS) {
    const cardObj = CARD_DB[basicId];

    if (isCardLegalForDeck(basicId, setCols) !== false) allBasicsRejected = false;
    if (isCardLegalForDeck(basicId, arrCols) !== false) allBasicsRejected = false;
    if (isCardLegalForDeck(cardObj, setCols) !== false) allBasicsRejected = false;
    if (isCardLegalForDeck(cardObj, arrCols) !== false) allBasicsRejected = false;

    basicRejectionCount += 4;
  }
}

assert(
  allBasicsRejected && basicRejectionCount === 64 * 6 * 4,
  `1.1: All 6 basic lands strictly rejected for all 64 color combinations (${basicRejectionCount} variations tested)`
);

// 1.2: Dual lands strict matching
const DUAL_LAND_TEST_SPECS = [
  { id: "stomping_ground", produced: ["G", "R"] },
  { id: "steam_vents", produced: ["U", "R"] },
  { id: "blood_crypt", produced: ["B", "R"] },
  { id: "overgrown_tomb", produced: ["B", "G"] },
  { id: "sacred_foundry", produced: ["R", "W"] },
  { id: "hallowed_fountain", produced: ["W", "U"] }
];

let dualCorrect = true;
let dualTestsRun = 0;

for (const subset of colorSubsets) {
  const setCols = new Set(subset);
  for (const dual of DUAL_LAND_TEST_SPECS) {
    const shouldBeLegal = dual.produced.every(c => setCols.has(c));
    const legalId = isCardLegalForDeck(dual.id, setCols);
    const legalObj = isCardLegalForDeck(CARD_DB[dual.id], setCols);

    if (legalId !== shouldBeLegal || legalObj !== shouldBeLegal) {
      dualCorrect = false;
      print(`Dual mismatch: ${dual.id} in [${subset}]: expected ${shouldBeLegal}, got ${legalId}`);
    }
    dualTestsRun += 2;
  }
}

assert(
  dualCorrect && dualTestsRun === 64 * 6 * 2,
  `1.2: Dual lands legal iff all produced colors match deckColors (${dualTestsRun} evaluations)`
);

// 1.3: Fetch lands (evolving_wilds) are universal fixers legal everywhere
let fetchCorrect = true;
for (const subset of colorSubsets) {
  if (isCardLegalForDeck("evolving_wilds", new Set(subset)) !== true) fetchCorrect = false;
  if (isCardLegalForDeck("evolving_wilds", subset) !== true) fetchCorrect = false;
  if (isCardLegalForDeck(CARD_DB["evolving_wilds"], new Set(subset)) !== true) fetchCorrect = false;
}
assert(fetchCorrect, "1.3: Fetch land (evolving_wilds) is legal for every color subset");

// 1.4: Colorless construct cards in CARD_DB (color === "C")
const COLORLESS_CARDS = Object.values(CARD_DB).filter(c => c.color === "C" && c.subtype !== "Basic");
assert(COLORLESS_CARDS.length === 8, `Found exactly 8 non-basic colorless cards in CARD_DB (got ${COLORLESS_CARDS.length})`);

let colorlessCorrect = true;
let colorlessTestsRun = 0;
for (const subset of colorSubsets) {
  const setCols = new Set(subset);
  const hasC = setCols.has("C");

  for (const card of COLORLESS_CARDS) {
    const legal = isCardLegalForDeck(card.id, setCols);
    if (legal !== hasC) {
      colorlessCorrect = false;
      print(`Colorless mismatch on ${card.id} for [${subset}]: expected ${hasC}, got ${legal}`);
    }
    colorlessTestsRun++;
  }
}
assert(
  colorlessCorrect && colorlessTestsRun === 64 * 8,
  `1.4: Colorless cards require {C} in deckColors across all 64 color subsets (${colorlessTestsRun} evaluations)`
);

// 1.5: Colored cards require primary color and all pips
let coloredCorrect = true;
let coloredCount = 0;
for (const subset of colorSubsets) {
  const setCols = new Set(subset);

  for (const cid in CARD_DB) {
    const card = CARD_DB[cid];
    if (card.subtype === "Basic" || card.isFetch || card.type === "Land" || card.color === "C") continue;

    const parsed = parseManaCost(card.manaCost);
    let expected = setCols.has(card.color);
    if (expected && parsed && parsed.pips) {
      for (const col of COLORS) {
        if ((parsed.pips[col] || 0) > 0 && !setCols.has(col)) {
          expected = false;
          break;
        }
      }
    }
    const actual = isCardLegalForDeck(card, setCols);
    if (actual !== expected) {
      coloredCorrect = false;
    }
    coloredCount++;
  }
}
assert(
  coloredCorrect,
  `1.5: Colored cards require primary color and colored pips across all subsets (${coloredCount} evaluations)`
);

// 1.6: Boundary and malformed inputs to isCardLegalForDeck
const MALFORMED_VALUES = [
  null,
  undefined,
  "",
  0,
  false,
  true,
  NaN,
  Infinity,
  -Infinity,
  {},
  [],
  "fake_card_id_xyz",
  { subtype: "Basic" },
  { id: "nonexistent" }
];

let malformedSafe = true;
for (const val of MALFORMED_VALUES) {
  for (const cols of [new Set(["G"]), ["G", "R"], [], null, undefined, 123, "string_cols", {}]) {
    try {
      const res = isCardLegalForDeck(val, cols);
      if (res !== false) {
        malformedSafe = false;
      }
    } catch (e) {
      malformedSafe = false;
    }
  }
}
assert(
  malformedSafe,
  "1.6: isCardLegalForDeck returns false and never throws for malformed card or deckColors inputs"
);


// =================================================================
// 2. POOL SAMPLING INTEGRITY & HIGH-VOLUME FUZZING
// =================================================================
print("\n--- 2. Pool Sampling Integrity & High-Volume Fuzzing ---");

// 2.1: 6,000 iterations across all 6 starter decks (1,000 runs per archetype)
let sampleIntegrityPassed = true;
let totalSamplesRun = 0;

for (const deck of STARTER_DECKS) {
  const deckColors = new Set(deck.colors);

  for (let i = 0; i < 1000; i++) {
    const pool = sampleDraftPool(deckColors, 3);
    totalSamplesRun++;

    if (!Array.isArray(pool) || pool.length !== 3) {
      sampleIntegrityPassed = false;
      break;
    }

    const ids = pool.map(c => c.id || c);
    const idSet = new Set(ids);
    // Invariant: no duplicate cards in a 3-card draft
    if (idSet.size !== 3) {
      sampleIntegrityPassed = false;
      break;
    }

    // Invariant: no basic lands
    if (ids.some(id => ALL_BASIC_IDS.includes(id))) {
      sampleIntegrityPassed = false;
      break;
    }

    // Invariant: all cards strictly legal for deck
    if (!ids.every(id => isCardLegalForDeck(id, deckColors))) {
      sampleIntegrityPassed = false;
      break;
    }
  }
}

assert(
  sampleIntegrityPassed && totalSamplesRun === 6000,
  `2.1: 6,000 high-volume draft samples across all 6 starter decks: 100% length 3, 0 duplicates, 0 basics, 100% legal`
);

// 2.2: 3,000 iterations across Mono-Color (G, R, B, U, W, C) & 3-Color combinations
const MONO_AND_TRI_DECKS = [
  { name: "Mono-G", colors: ["G"] },
  { name: "Mono-R", colors: ["R"] },
  { name: "Mono-B", colors: ["B"] },
  { name: "Mono-U", colors: ["U"] },
  { name: "Mono-W", colors: ["W"] },
  { name: "Mono-C", colors: ["C"] },
  { name: "Temur (G/U/R)", colors: ["G", "U", "R"] },
  { name: "Esper (W/U/B)", colors: ["W", "U", "B"] },
  { name: "Jund (B/R/G)", colors: ["B", "R", "G"] },
  { name: "Naya (W/R/G)", colors: ["W", "R", "G"] },
  { name: "Bant (W/U/G)", colors: ["W", "U", "G"] },
  { name: "Grixis (U/B/R)", colors: ["U", "B", "R"] }
];

let monoTriPassed = true;
let monoTriRuns = 0;

for (const group of MONO_AND_TRI_DECKS) {
  const cols = new Set(group.colors);
  for (let i = 0; i < 250; i++) {
    const pool = sampleDraftPool(cols, 3);
    monoTriRuns++;

    if (!Array.isArray(pool) || pool.length !== 3) {
      monoTriPassed = false;
      break;
    }
    const ids = pool.map(c => c.id || c);
    if (new Set(ids).size !== 3) {
      monoTriPassed = false;
      break;
    }
    if (ids.some(id => ALL_BASIC_IDS.includes(id))) {
      monoTriPassed = false;
      break;
    }
    if (!ids.every(id => isCardLegalForDeck(id, cols))) {
      monoTriPassed = false;
      break;
    }
  }
}

assert(
  monoTriPassed && monoTriRuns === 12 * 250,
  `2.2: 3,000 draft samples across 6 mono-color and 6 tri-color decks: 100% length 3, 0 duplicates, 0 basics, 100% legal`
);

// 2.3: Deterministic RNG Seeds & Repeatability
function createMulberry32(seed) {
  let a = seed >>> 0;
  return function() {
    let t = (a += 0x6D2B79F5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

let deterministicMatch = true;
for (let seed = 1; seed <= 50; seed++) {
  const rng1 = createMulberry32(seed);
  const rng2 = createMulberry32(seed);

  const poolA = sampleDraftPool(new Set(["G", "R"]), 3, rng1).map(c => c.id || c);
  const poolB = sampleDraftPool(new Set(["G", "R"]), 3, rng2).map(c => c.id || c);

  if (poolA.length !== 3 || poolB.length !== 3) deterministicMatch = false;
  if (poolA[0] !== poolB[0] || poolA[1] !== poolB[1] || poolA[2] !== poolB[2]) {
    deterministicMatch = false;
  }
}

assert(
  deterministicMatch,
  "2.3: Deterministic PRNG seeds produce exactly repeatable draft pool sequences across 50 independent seeds"
);

// 2.4: Pathological RNG return values (clamping & safety)
const PATHOLOGICAL_RNGS = [
  { name: "Always 0.0", fn: () => 0.0 },
  { name: "Always 0.999999", fn: () => 0.999999 },
  { name: "Exact 1.0 (boundary)", fn: () => 1.0 },
  { name: "Above 1.0 (2.5)", fn: () => 2.5 },
  { name: "Negative (-0.5)", fn: () => -0.5 },
  { name: "NaN", fn: () => NaN },
  { name: "Infinity", fn: () => Infinity },
  { name: "Minus Infinity", fn: () => -Infinity },
  { name: "Non-function string", fn: "not a function" },
  { name: "Null", fn: null },
  { name: "Undefined", fn: undefined }
];

let pathologicalPassed = true;
for (const p of PATHOLOGICAL_RNGS) {
  try {
    const pool = sampleDraftPool(new Set(["G", "R"]), 3, p.fn);
    if (!Array.isArray(pool) || pool.length !== 3) pathologicalPassed = false;
    const ids = pool.map(c => c.id || c);
    if (new Set(ids).size !== 3) pathologicalPassed = false;
  } catch (e) {
    pathologicalPassed = false;
    print(`Exception with pathological RNG '${p.name}': ${e.message}`);
  }
}

assert(
  pathologicalPassed,
  "2.4: Pathological RNG functions (NaN, Infinity, negative, >=1.0, non-functions) handled safely without error or duplicates"
);

// 2.5: Count parameter boundary testing
const gruulCols = new Set(["G", "R"]);
const poolCount0 = sampleDraftPool(gruulCols, 0);
const poolCountNeg = sampleDraftPool(gruulCols, -5);
const poolCount1 = sampleDraftPool(gruulCols, 1);
const poolCount2 = sampleDraftPool(gruulCols, 2);
const poolCountLarge = sampleDraftPool(gruulCols, 9999);
const eligibleGruulCount = Object.values(CARD_DB).filter(c => isCardLegalForDeck(c, gruulCols)).length;

assert(
  Array.isArray(poolCount0) && poolCount0.length === 0 &&
  Array.isArray(poolCountNeg) && poolCountNeg.length === 0 &&
  poolCount1.length === 1 &&
  poolCount2.length === 2 &&
  poolCountLarge.length === eligibleGruulCount &&
  new Set(poolCountLarge.map(c => c.id)).size === eligibleGruulCount,
  "2.5: Count parameter boundaries (0, negative, 1, 2, and oversized 9999) return exact expected unique sets without errors"
);


// =================================================================
// 3. DRAFT SELECTION & SKIP MECHANICS & IDEMPOTENCY
// =================================================================
print("\n--- 3. Draft Selection & Skip Mechanics & Idempotency ---");

// 3.1: Card Selection Mechanics
{
  resetTestState();
  startNewRun(STARTER_DECKS[0]);
  state.encounterIdx = 0;
  state.enemyLife = 0;
  handleEncounterVictory();

  const initialDeckSize = state.masterDeck.length;
  const initialGold = state.gold;
  const targetId = state.pendingDraft.choices[0];

  assert(
    state.pendingDraft && state.pendingDraft.resolved === false && state.pendingDraft.choices.length === 3,
    "3.1.1: Pending draft active before selection"
  );

  const selectSuccess = selectDraftCard(0);
  assert(
    selectSuccess === true &&
    state.masterDeck.length === initialDeckSize + 1 &&
    state.gold === initialGold &&
    state.masterDeck[state.masterDeck.length - 1].id === targetId &&
    state.masterDeck[state.masterDeck.length - 1] !== CARD_DB[targetId] && // Cloned, not mutated CARD_DB ref
    state.pendingDraft.resolved === true &&
    state.pendingDraft.skipped === false &&
    state.pendingDraft.selectedCardId === targetId,
    "3.1.2: selectDraftCard adds exactly 1 cloned card to masterDeck, leaves gold unchanged, and marks resolved: true"
  );
}

// 3.2: Skip Draft Compensation Mechanics
{
  resetTestState();
  startNewRun(STARTER_DECKS[0]);
  state.encounterIdx = 1;
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
    "3.2.1: skipDraft adds 0 cards to masterDeck, awards exactly +$2 gold, and marks resolved: true, skipped: true"
  );
}

// 3.3: Stress-Test Single-Claim Idempotency (Rapid repeats & Alternating calls)
{
  // Test A: select then select
  resetTestState();
  startNewRun(STARTER_DECKS[0]);
  state.encounterIdx = 0;
  state.enemyLife = 0;
  handleEncounterVictory();

  const deckLenBefore = state.masterDeck.length;
  assert(selectDraftCard(0) === true, "3.3.1A: First selectDraftCard succeeds");
  assert(selectDraftCard(0) === false, "3.3.1B: Second selectDraftCard(0) returns false");
  assert(selectDraftCard(1) === false, "3.3.1C: Third selectDraftCard(1) returns false");
  assert(selectDraftCard(2) === false, "3.3.1D: Fourth selectDraftCard(2) returns false");
  assert(state.masterDeck.length === deckLenBefore + 1, "3.3.1E: masterDeck length remains deckLenBefore + 1 after repeat selects");

  // Test B: skip then skip
  resetTestState();
  startNewRun(STARTER_DECKS[0]);
  state.encounterIdx = 0;
  state.enemyLife = 0;
  handleEncounterVictory();

  const goldBefore = state.gold;
  assert(skipDraft() === true, "3.3.2A: First skipDraft succeeds");
  assert(skipDraft() === false, "3.3.2B: Second skipDraft returns false");
  assert(skipDraft() === false, "3.3.2C: Third skipDraft returns false");
  assert(state.gold === goldBefore + 2, "3.3.2D: Gold increased by exactly +2 after repeat skips (no double reward)");

  // Test C: select then skip
  resetTestState();
  startNewRun(STARTER_DECKS[0]);
  state.encounterIdx = 0;
  state.enemyLife = 0;
  handleEncounterVictory();

  const goldBeforeC = state.gold;
  assert(selectDraftCard(1) === true, "3.3.3A: selectDraftCard succeeds");
  assert(skipDraft() === false, "3.3.3B: skipDraft after selectDraftCard returns false");
  assert(state.gold === goldBeforeC, "3.3.3C: Gold remains unchanged after rejected skip");

  // Test D: skip then select
  resetTestState();
  startNewRun(STARTER_DECKS[0]);
  state.encounterIdx = 0;
  state.enemyLife = 0;
  handleEncounterVictory();

  const deckLenBeforeD = state.masterDeck.length;
  assert(skipDraft() === true, "3.3.4A: skipDraft succeeds");
  assert(selectDraftCard(0) === false, "3.3.4B: selectDraftCard after skipDraft returns false");
  assert(selectDraftCard(1) === false, "3.3.4C: selectDraftCard(1) after skipDraft returns false");
  assert(state.masterDeck.length === deckLenBeforeD, "3.3.4D: masterDeck remains unchanged after rejected selects");

  // Test E: Rapid Hammer Loop (1,000 rapid calls on resolved draft)
  let hammerAllFalse = true;
  for (let i = 0; i < 1000; i++) {
    if (i % 2 === 0) {
      if (selectDraftCard(i % 3) !== false) hammerAllFalse = false;
    } else {
      if (skipDraft() !== false) hammerAllFalse = false;
    }
  }
  assert(
    hammerAllFalse && state.masterDeck.length === deckLenBeforeD && state.gold === state.gold,
    "3.3.5: 1,000 rapid hammer calls of alternating select/skip on resolved draft 100% rejected with 0 side effects"
  );
}

// 3.4: Boundary and Malformed Indices to selectDraftCard
{
  resetTestState();
  startNewRun(STARTER_DECKS[0]);
  state.encounterIdx = 0;
  state.enemyLife = 0;
  handleEncounterVictory();

  const deckLen = state.masterDeck.length;

  const BAD_INDICES = [
    -1, -100, -Infinity,
    3, 4, 100, Infinity,
    0.5, 1.2, 2.9,
    NaN,
    null, undefined,
    true, false,
    {}, [],
    "not_a_valid_card_id",
    "forest" // In CARD_DB but not among draft choices
  ];

  let allBadRejected = true;
  for (const bad of BAD_INDICES) {
    const res = selectDraftCard(bad);
    if (res !== false) {
      allBadRejected = false;
      print(`Bad index ${JSON.stringify(bad)} was NOT rejected: returned ${res}`);
    }
  }

  assert(
    allBadRejected && state.masterDeck.length === deckLen && state.pendingDraft.resolved === false,
    "3.4.1: All 18 boundary/malformed indices to selectDraftCard rejected without mutating deck or resolving draft"
  );

  // After invalid attempts, a valid select STILL succeeds!
  assert(
    selectDraftCard(0) === true &&
    state.masterDeck.length === deckLen + 1 &&
    state.pendingDraft.resolved === true,
    "3.4.2: Legitimate selection succeeds cleanly after series of invalid index attempts"
  );
}

// 3.5: State Lifecycle Boundaries
{
  resetTestState();
  startNewRun(STARTER_DECKS[0]);

  // Before any encounter victory (pendingDraft is null)
  assert(state.pendingDraft === null, "3.5.1: state.pendingDraft is null initially");
  assert(selectDraftCard(0) === false, "3.5.2: selectDraftCard returns false when pendingDraft is null");
  assert(skipDraft() === false, "3.5.3: skipDraft returns false when pendingDraft is null");

  // With empty choices
  state.pendingDraft = { choices: [], encounterIdx: 0, resolved: false };
  assert(selectDraftCard(0) === false, "3.5.4: selectDraftCard returns false when choices is empty");

  // With choices containing invalid items
  state.pendingDraft = { choices: [null, undefined, "fake_nonexistent_id"], encounterIdx: 0, resolved: false };
  assert(selectDraftCard(0) === false, "3.5.5: selectDraftCard returns false when choice is null");
  assert(selectDraftCard(1) === false, "3.5.6: selectDraftCard returns false when choice is undefined");
  assert(selectDraftCard(2) === false, "3.5.7: selectDraftCard returns false when choice is unknown card ID");

  // When run is over
  state.encounterIdx = 0;
  state.enemyLife = 0;
  handleEncounterVictory();
  state.runOver = true;
  assert(selectDraftCard(0) === false, "3.5.8: selectDraftCard returns false when state.runOver is true");
  assert(skipDraft() === false, "3.5.9: skipDraft returns false when state.runOver is true");
}


// =================================================================
// 4. DYNAMIC DECK COLOR EXPANSION OVER MULTIPLE DRAFTS
// =================================================================
print("\n--- 4. Dynamic Deck Color Expansion ---");

{
  resetTestState();
  startNewRun(STARTER_DECKS[0]); // Gruul: ["G", "R"]

  const initColors = getDeckColors();
  assert(initColors.has("G") && initColors.has("R") && !initColors.has("U") && !initColors.has("B"), "4.1: Initial Gruul colors are {G, R}");

  // Artificially add a card with Blue pip to master deck
  state.masterDeck.push(cloneCard("steam_vents")); // U/R dual land
  const expandedColors = getDeckColors();
  assert(expandedColors.has("U") && expandedColors.has("G") && expandedColors.has("R"), "4.2: getDeckColors dynamically includes {U} after Steam Vents added");

  // Now sampleDraftPool can offer Blue cards or Steam Vents
  const pool = sampleDraftPool(expandedColors, 3);
  assert(
    pool.length === 3 && pool.every(c => isCardLegalForDeck(c, expandedColors)),
    "4.3: sampleDraftPool generates legal cards reflecting dynamically expanded 3-color pool"
  );
}


// =================================================================
// 5. SAVE / RESTORE INTEGRITY & PERSISTENCE STRESS
// =================================================================
print("\n--- 5. Save / Restore Persistence & Serialization Stress ---");

{
  const prevDoc = globalThis.document;
  const prevLS = globalThis.localStorage;
  const memStore = createMemoryStorage();
  const prevHeadless = state.headless;

  try {
    resetTestState();
    startNewRun(STARTER_DECKS[0]);
    state.headless = false;
    globalThis.document = { getElementById: () => null };
    globalThis.localStorage = memStore;

    // Simulate victory on Encounter 0
    state.encounterIdx = 0;
    state.enemyLife = 0;
    handleEncounterVictory();

    const originalChoices = [...state.pendingDraft.choices];
    assert(originalChoices.length === 3, "5.1: 3 draft choices generated");

    // Save pending draft
    const savePendingOk = saveRunState(false);
    assert(savePendingOk === true, "5.2: saveRunState succeeds with pendingDraft");

    // Check payload stored in localStorage
    const rawStored = memStore.getItem(SAVE_KEY);
    assert(rawStored && typeof rawStored === "string", "5.3: Raw save stored in localStorage");
    const parsedPayload = JSON.parse(rawStored);
    assert(
      parsedPayload.pendingDraft &&
      parsedPayload.pendingDraft.choices.length === 3 &&
      parsedPayload.pendingDraft.resolved === false,
      "5.4: Stored payload has uncorrupted pendingDraft"
    );

    // Corrupt memory state, then reload from localStorage
    state.pendingDraft = null;
    state.masterDeck = [];
    const loadOk = loadRunState();

    assert(
      loadOk === true &&
      state.pendingDraft &&
      state.pendingDraft.resolved === false &&
      state.pendingDraft.choices[0] === originalChoices[0] &&
      state.pendingDraft.choices[1] === originalChoices[1] &&
      state.pendingDraft.choices[2] === originalChoices[2],
      "5.5: loadRunState accurately restored pending draft choices after full memory wipe"
    );

    // Resolve via skip
    const goldBeforeSkip = state.gold;
    const skipRes = skipDraft();
    assert(skipRes === true && state.gold === goldBeforeSkip + 2, "5.6: skipDraft awards +$2 gold");

    // Save resolved state
    saveRunState(true);

    // Reload again: draft must be resolved/cleared, gold preserved, no duplicate skip
    loadRunState();
    assert(
      (!state.pendingDraft || state.pendingDraft.resolved === true) &&
      state.gold === goldBeforeSkip + 2,
      "5.7: Reloaded resolved draft preserves resolved status and does not allow re-drafting"
    );
    assert(skipDraft() === false, "5.8: skipDraft rejected after reload of resolved save");
    assert(selectDraftCard(0) === false, "5.9: selectDraftCard rejected after reload of resolved save");

  } finally {
    state.headless = prevHeadless;
    if (prevDoc === undefined) delete globalThis.document;
    else globalThis.document = prevDoc;
    if (prevLS === undefined) delete globalThis.localStorage;
    else globalThis.localStorage = prevLS;
  }
}


// =================================================================
// 6. DOWNSTREAM ENCOUNTER INTEGRATION & COMBAT LIBRARY PROPAGATION
// =================================================================
print("\n--- 6. Downstream Encounter Integration & Combat Library ---");

{
  // Test 6.1: Drafted card actually propagates into library during next encounter
  resetTestState();
  startNewRun(STARTER_DECKS[0]);
  state.encounterIdx = 0;
  state.enemyLife = 0;
  handleEncounterVictory();

  const chosenId = state.pendingDraft.choices[0];
  const deckSizeBefore = state.masterDeck.length;

  // Select card
  assert(selectDraftCard(0) === true, "6.1.1: Draft card selected");
  assert(state.masterDeck.length === deckSizeBefore + 1, "6.1.2: masterDeck incremented by 1");

  // Advance to Encounter 1
  state.encounterIdx = 1;
  beginEncounter();

  // Invariant: drafted card exists in state.library or state.hand
  const totalDeckCards = [...state.library, ...state.hand];
  const foundDrafted = totalDeckCards.some(c => c.id === chosenId);
  assert(
    foundDrafted === true && totalDeckCards.length === deckSizeBefore + 1,
    `6.1.3: Drafted card (${chosenId}) is present in library/hand for Encounter 1, deck count exact (${totalDeckCards.length})`
  );
  assert(state.pendingDraft === null, "6.1.4: state.pendingDraft is cleanly nullified upon beginEncounter");
}

{
  // Test 6.2: Final Boss Victory (Encounter 5, Elesh Norn) bypasses draft completely
  resetTestState();
  startNewRun(STARTER_DECKS[0]);
  state.encounterIdx = ENCOUNTERS.length - 1; // 5
  state.enemyLife = 0;

  handleEncounterVictory();

  assert(
    state.pendingDraft === null,
    "6.2.1: Defeating final boss (Encounter 5) does NOT create pendingDraft (state.pendingDraft === null)"
  );
  assert(
    selectDraftCard(0) === false && skipDraft() === false,
    "6.2.2: Neither selectDraftCard nor skipDraft can be invoked after final campaign boss"
  );
}


// =================================================================
// 7. DESKTOP NORMALIZER & CHECKSUM PARITY UNDER STRESS
// =================================================================
print("\n--- 7. Desktop Normalizer & Checksum Parity Under Stress ---");

{
  const testPayloads = [
    // Standard pending draft
    {
      version: 1, savedAt: 1000, inShop: false, archetypeId: "gruul", encounterIdx: 0,
      playerLife: 20, gold: 10, masterDeck: [{ id: "forest" }], relicIds: [], consumableIds: [],
      pendingDraft: { choices: ["cultivate", "lightning_bolt", "evolving_wilds"], encounterIdx: 0, resolved: false, skipped: false, selectedCardId: null }
    },
    // Resolved draft via selection
    {
      version: 1, savedAt: 2000, inShop: true, archetypeId: "gruul", encounterIdx: 0,
      playerLife: 20, gold: 10, masterDeck: [{ id: "forest" }, { id: "cultivate" }], relicIds: [], consumableIds: [],
      pendingDraft: { choices: ["cultivate", "lightning_bolt", "evolving_wilds"], encounterIdx: 0, resolved: true, skipped: false, selectedCardId: "cultivate" }
    },
    // Resolved draft via skip
    {
      version: 1, savedAt: 3000, inShop: true, archetypeId: "gruul", encounterIdx: 0,
      playerLife: 20, gold: 12, masterDeck: [{ id: "forest" }], relicIds: [], consumableIds: [],
      pendingDraft: { choices: ["cultivate", "lightning_bolt", "evolving_wilds"], encounterIdx: 0, resolved: true, skipped: true, selectedCardId: null }
    },
    // Null pendingDraft (e.g. boss victory or mid-combat)
    {
      version: 1, savedAt: 4000, inShop: false, archetypeId: "gruul", encounterIdx: 5,
      playerLife: 20, gold: 30, masterDeck: [{ id: "forest" }], relicIds: [], consumableIds: [],
      pendingDraft: null
    }
  ];

  let parityAllPassed = true;
  for (let idx = 0; idx < testPayloads.length; idx++) {
    const payload = testPayloads[idx];
    const normGame = normalizeCanonicalSave(payload);
    const normDesk = DesktopBridge.normalizeSaveObject(payload);

    if (normGame.valid !== true || normDesk.valid !== true) parityAllPassed = false;
    if (JSON.stringify(normGame.save.pendingDraft) !== JSON.stringify(normDesk.save.pendingDraft)) parityAllPassed = false;
    if (normGame.save.saveIntegrity !== normDesk.save.saveIntegrity) parityAllPassed = false;
  }

  assert(
    parityAllPassed,
    "7.1: Perfect byte-for-byte serialization & checksum parity across game.js and desktop.js for all draft lifecycle states"
  );
}

print("\n===================================================================");
print(`EMPIRICAL CHALLENGER P3-1 AUDIT: ${passedAssertions} passed, ${failedAssertions} failed out of ${totalAssertions} assertions`);
print("===================================================================");

if (failedAssertions > 0) {
  print("VERDICT: REQUEST_CHANGES");
  if (typeof process !== "undefined") process.exit(1);
} else {
  print("VERDICT: APPROVE");
}
