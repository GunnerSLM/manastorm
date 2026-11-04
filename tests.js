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
  assert(res.power === 3 && res.deadBlockerUids.has("b_big"),
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
  const hasPridemateSource = combat.resonanceBreakdown.some(b => b.label.includes("Ajani's Pridemate"));
  const hasHeliodSource = combat.resonanceBreakdown.some(b => b.label.includes("Heliod"));
  assert(hasPridemateSource && hasHeliodSource, "3.5 Resonance breakdown lists both Ajani's Pridemate and Heliod sources");
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

  // 5.5.1 Valid Land Drop: pointerdown -> move -> pointerup calls playCardFromHand and plays land
  simCtrl.handlePointerDown({ target: mockLandEl, pointerId: 20, clientX: 200, clientY: 550 });
  simCtrl.handlePointerMove({ pointerId: 20, clientX: 200, clientY: 450 }); // inside #player-lands
  simCtrl.handlePointerUp({ pointerId: 20, clientX: 200, clientY: 450 });
  assert(
    state.playerLands.some(l => l.uid === "land-uid-1"),
    "5.5.1 Headless simulation: valid land drop plays land into state.playerLands"
  );

  // 5.5.2 Valid Creature Drop: pointerdown -> move -> pointerup plays creature
  simCtrl.handlePointerDown({ target: mockCreatureEl, pointerId: 21, clientX: 350, clientY: 550 });
  simCtrl.handlePointerMove({ pointerId: 21, clientX: 350, clientY: 320 }); // inside #player-creatures
  simCtrl.handlePointerUp({ pointerId: 21, clientX: 350, clientY: 320 });
  assert(
    state.playerCreatures.some(c => c.uid === "creature-uid-1"),
    "5.5.2 Headless simulation: valid creature drop plays creature into state.playerCreatures"
  );

  // 5.5.3 Invalid Drop (Unplayable Card): shows .drag-invalid and triggers spawnFx; card remains in hand
  let fxSpawnedMsg = "";
  globalThis.spawnFx = (msg, col) => { fxSpawnedMsg = msg; };
  simCtrl.handlePointerDown({ target: mockExpensiveEl, pointerId: 22, clientX: 500, clientY: 550 });
  simCtrl.handlePointerMove({ pointerId: 22, clientX: 500, clientY: 200 }); // over table
  assert(
    mockExpensiveEl.classList.contains("drag-invalid"),
    "5.5.3 Unplayable card shows .drag-invalid while dragging"
  );
  simCtrl.handlePointerUp({ pointerId: 22, clientX: 500, clientY: 200 });
  assert(
    fxSpawnedMsg.includes("Missing Mana Pips") && state.hand.some(c => c.uid === "expensive-spell"),
    "5.5.3 Invalid drop triggers spawnFx message and retains card in hand"
  );

  // 5.5.4 Missed Drop outside zone: snaps back silently without spawnFx and retains card
  fxSpawnedMsg = "";
  simCtrl.handlePointerDown({ target: mockExpensiveEl, pointerId: 23, clientX: 500, clientY: 550 });
  simCtrl.handlePointerMove({ pointerId: 23, clientX: 500, clientY: 530 }); // inside hand area
  simCtrl.handlePointerUp({ pointerId: 23, clientX: 500, clientY: 530 });
  assert(
    fxSpawnedMsg === "" && state.hand.some(c => c.uid === "expensive-spell"),
    "5.5.4 Drop outside play zone snaps back silently without spawnFx"
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

  delete globalThis.spawnFx;
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
      startNewRun(deckChoice);
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
    deckIds.includes("golgari_graveyard") && deckIds.includes("artifact_constructs"),
    "7.1.2 STARTER_DECKS includes 'golgari_graveyard' and 'artifact_constructs'"
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
    initialAvailable.length === STARTER_DECKS.length,
    "7.2.2 All starter decks are available by default"
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
      getAvailableStarterDecks().length === STARTER_DECKS.length - 1 &&
      STARTER_DECKS.some(d => d.id === "artifact_constructs"),
      "7.2.4 Locking a deck filters getAvailableStarterDecks() while keeping STARTER_DECKS definition testable"
    );

    const artifactDeck = STARTER_DECKS.find(d => d.id === "artifact_constructs");
    startNewRun(artifactDeck);
    assert(
      state.deckArchetype.id === "artifact_constructs" && state.masterDeck.length === 40,
      "7.2.5 Locked starter deck can still be directly instantiated in startNewRun for testing"
    );
  } finally {
    UNLOCKED_STARTER_DECK_IDS.add("artifact_constructs");
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
  const thopters = state.playerCreatures.find(c => c.name === "Thopter Construct");
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
  const myrs = state.playerCreatures.find(c => c.name === "Myr Construct");
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

  // Completing current node works exactly once
  const firstComplete = completeCurrentRouteNode();
  const secondComplete = completeCurrentRouteNode();
  assert(
    firstComplete === true && secondComplete === false && state.route.completedNodeIds.length === 1,
    "8.2.3 completeCurrentRouteNode marks the current node completed exactly once"
  );

  // Invalid choices rejected: unknown ID, already-completed node, or non-connected future node
  assert(
    canSelectRouteNode("nonexistent_node") === false &&
    canSelectRouteNode("p1_start") === false &&
    canSelectRouteNode("p1_boss") === false &&
    canSelectRouteNode("p2_entry_shop") === false &&
    selectRouteNode("p1_boss") === false,
    "8.2.4 Rejects invalid route choices (unknown ID, already completed node, or non-adjacent node)"
  );

  // Valid choices from p1_start are p1_upper_rest and p1_lower_event
  const nextFromStart = getAvailableNextRouteNodes().map(n => n.id);
  assert(
    nextFromStart.length === 2 &&
    nextFromStart.includes("p1_upper_rest") &&
    nextFromStart.includes("p1_lower_event"),
    "8.2.5 Completing p1_start unlocks both p1_upper_rest and p1_lower_event branches"
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
  const scrollsBeforeEvent = state.consumables.length;
  completeCurrentRouteNode();
  const choseEvent = selectRouteNode("p1_lower_event");
  assert(
    choseEvent === true &&
    state.playerLife === 18 &&
    state.gold === goldBeforeEvent + 7 &&
    state.consumables.length === scrollsBeforeEvent + 1,
    "8.3.6 Selecting p1_lower_event (Event) grants +$7 Gold, +3 Life, and 1 Arcane Scroll"
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
    completeCurrentRouteNode(); // complete p1_start
    selectRouteNode("p1_lower_event"); // complete p1_lower_event
    selectRouteNode("p1_elite"); // enter Krenko fight
    completeCurrentRouteNode(); // complete Krenko
    selectRouteNode("p1_boss"); // enter Sheoldred fight
    completeCurrentRouteNode(); // complete Sheoldred -> pending choice between p2_entry_fight and p2_entry_shop
    state.route.pendingSelection = true;

    const fullSnap = createFullRunSnapshot();
    const savedOk = saveRunState(true);
    assert(savedOk === true, "8.4.1 saveRunState persists run with active branching route state");

    // Mutate route state to verify both restoreFullRunSnapshot and loadRunState restore exact route choices
    state.route = createInitialRouteState(0);
    restoreFullRunSnapshot(fullSnap);
    assert(
      state.route.currentNodeId === "p1_boss" &&
      state.route.completedNodeIds.includes("p1_lower_event") &&
      !state.route.completedNodeIds.includes("p1_upper_rest") &&
      state.route.pendingSelection === true,
      "8.4.2 restoreFullRunSnapshot restores exact currentNodeId, completedNodeIds, and pendingSelection"
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
      "8.4.3 loadRunState restores saved route history and exact available next choices (p2_entry_fight, p2_entry_shop)"
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

  // 9.1.9: Edge case: count > pool size returns all available cards safely without error
  const tinyPool = sampleDraftPool(colorlessCols, 100);
  assert(
    Array.isArray(tinyPool) && tinyPool.length > 0 && tinyPool.length < 100,
    "9.1.9 sampleDraftPool handles count exceeding pool size safely without crashing"
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

  // beginEncounter resets pendingDraft
  beginEncounter();
  assert(state.pendingDraft === null, "9.2.2 beginEncounter resets state.pendingDraft to null");

  // Final campaign encounter (encounter 5, Elesh Norn): bypasses draft completely
  state.encounterIdx = ENCOUNTERS.length - 1;
  state.enemyLife = 0;
  handleEncounterVictory();

  assert(
    state.pendingDraft === null,
    "9.2.3 Defeating final campaign encounter (Elesh Norn) bypasses draft generation (pendingDraft === null)"
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
    startNewRun(STARTER_DECKS[0]);
    state.headless = false;
    globalThis.document = {};
    globalThis.localStorage = memStore;
    state.encounterIdx = 0;
    state.enemyLife = 0;
    handleEncounterVictory();

    const originalChoices = [...state.pendingDraft.choices];
    assert(originalChoices.length === 3, "9.5.1 Pending draft generated before save");

    // Save while draft is pending
    const savedPending = saveRunState(false);
    assert(savedPending === true, "9.5.2 saveRunState successfully persists state with active pendingDraft");

    // Clear state in-memory and reload from localStorage
    state.pendingDraft = null;
    state.masterDeck = [];
    const loadSuccess = loadRunState();

    assert(
      loadSuccess === true &&
      state.pendingDraft &&
      state.pendingDraft.resolved === false &&
      state.pendingDraft.choices.length === 3 &&
      state.pendingDraft.choices[0] === originalChoices[0] &&
      state.pendingDraft.choices[1] === originalChoices[1] &&
      state.pendingDraft.choices[2] === originalChoices[2],
      "9.5.3 loadRunState restores exact draft choices and unresolved state on reload"
    );

    // Resolve draft by selecting card 0, then save again
    const chosenCardId = state.pendingDraft.choices[0];
    const initialDeckLen = state.masterDeck.length;
    selectDraftCard(0);
    assert(state.masterDeck.length === initialDeckLen + 1, "9.5.4 Card successfully drafted into deck");

    saveRunState(true);

    // Reload again: draft must be resolved, choices preserved, and no duplicate rewards
    loadRunState();
    assert(
      (!state.pendingDraft || state.pendingDraft.resolved === true) &&
      state.masterDeck.length === initialDeckLen + 1,
      "9.5.5 Reloading after draft resolution does not re-offer draft or duplicate rewards"
    );
  } finally {
    state.headless = prevHeadless;
    if (prevDoc === undefined) delete globalThis.document;
    else globalThis.document = prevDoc;
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
    "9.6.3 Corrupt or unrecognized card IDs are filtered from pendingDraft choices symmetrically"
  );

  // 9.6.4: Backup envelope format preservation
  const backupEnvelope = {
    format: "manastorm-save-backup",
    save: rawValid
  };
  const normBackup = DesktopBridge.normalizeSaveObject(backupEnvelope);
  assert(
    normBackup.valid === true &&
    normBackup.save.pendingDraft &&
    normBackup.save.pendingDraft.choices.length === 3,
    "9.6.4 Backup envelope format preserves pendingDraft through DesktopBridge.normalizeSaveObject"
  );

  // 9.6.5: compareSaveFreshness checks draft resolution when timestamp and encounter match
  const savePending = { savedAt: 1000, encounterIdx: 1, inShop: false, pendingDraft: { resolved: false } };
  const saveResolved = { savedAt: 1000, encounterIdx: 1, inShop: false, pendingDraft: { resolved: true } };
  assert(
    DesktopBridge.compareSaveFreshness(saveResolved, savePending) > 0 &&
    DesktopBridge.compareSaveFreshness(savePending, saveResolved) < 0,
    "9.6.5 compareSaveFreshness prioritizes resolved draft over pending draft when timestamp/encounter match"
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
  const targetCardId = state.pendingDraft.choices[2];
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

console.log(`\n========================================`);
console.log(`ALL SUITES COMPLETE: ${passed} passed, ${failed} failed`);
console.log(`========================================`);
if (failed > 0 && typeof process !== "undefined") {
  process.exit(1);
}
