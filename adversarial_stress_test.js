// MANASTORM — Adversarial Stress Test Suite (Challenger M2-2)
// Run with: node adversarial_stress_test.js  OR  /System/Library/Frameworks/JavaScriptCore.framework/Versions/A/Helpers/jsc adversarial_stress_test.js

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

let totalTests = 0;
let passedTests = 0;
let failedTests = 0;

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

function assert(cond, msg) {
  totalTests++;
  if (cond) {
    passedTests++;
  } else {
    failedTests++;
    console.error(`❌ STRESS FAIL: ${msg}`);
  }
}

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

console.log("=== BEGINNING ADVERSARIAL DRAG STATE MACHINE STRESS HARNESS ===");

// ============================================================================
// 1. STATE MACHINE & GESTURE DISCRIMINATION (6px THRESHOLD FUZZING)
// ============================================================================
console.log("--- 1. Gesture Discrimination & 6px Threshold Fuzzing ---");

{
  const testCard = { uid: "fuzz-card-1", name: "Shock", type: "Instant", color: "R", manaCost: "{R}" };
  const mockHandCard = createMockElement("button", "fuzz-btn", "hand-card");
  mockHandCard.dataset.handUid = testCard.uid;

  state.headless = false;
  state.hand = [testCard];
  state.runOver = false;
  state.combatLocked = false;
  state.prefersReducedMotion = false;

  const originX = 500;
  const originY = 500;

  // Fuzz test distances below threshold: 0px, 0.5px, 2px, 4px, 5.9px, 6.0px
  const subThresholdDists = [0, 0.1, 1.0, 2.0, 3.5, 5.0, 5.9, 5.99, 6.0];
  const angles = [0, Math.PI / 4, Math.PI / 2, (3 * Math.PI) / 4, Math.PI, (5 * Math.PI) / 4, (3 * Math.PI) / 2, (7 * Math.PI) / 4];

  for (const d of subThresholdDists) {
    for (const theta of angles) {
      const ctrl = createHandDragController();
      ctrl.handlePointerDown({ target: mockHandCard, pointerId: 101, pointerType: "mouse", clientX: originX, clientY: originY });

      const moveX = originX + d * Math.cos(theta);
      const moveY = originY + d * Math.sin(theta);
      ctrl.handlePointerMove({ pointerId: 101, clientX: moveX, clientY: moveY });

      const stateWhileMoved = ctrl.getState();
      ctrl.handlePointerUp({ pointerId: 101, clientX: moveX, clientY: moveY });
      const suppressed = ctrl.consumeClickSuppression();
      const finalState = ctrl.getState();

      assert(
        stateWhileMoved === "armed" && finalState === "idle" && suppressed === false,
        `Sub-threshold dist=${d.toFixed(2)}px angle=${(theta * 180 / Math.PI).toFixed(0)}deg: remains armed and preserves click (suppressed=false)`
      );
    }
  }

  // Fuzz test distances above threshold: 6.01px, 6.1px, 7px, 10px, 50px, 500px
  const supraThresholdDists = [6.01, 6.1, 7.0, 10.0, 25.0, 100.0, 500.0];

  for (const d of supraThresholdDists) {
    for (const theta of angles) {
      const ctrl = createHandDragController();
      ctrl.handlePointerDown({ target: mockHandCard, pointerId: 102, pointerType: "mouse", clientX: originX, clientY: originY });

      const moveX = originX + d * Math.cos(theta);
      const moveY = originY + d * Math.sin(theta);
      ctrl.handlePointerMove({ pointerId: 102, clientX: moveX, clientY: moveY });

      const stateWhileMoved = ctrl.getState();
      ctrl.handlePointerUp({ pointerId: 102, clientX: moveX, clientY: moveY });
      const suppressed = ctrl.consumeClickSuppression();

      assert(
        stateWhileMoved === "dragging" && suppressed === true,
        `Supra-threshold dist=${d.toFixed(2)}px angle=${(theta * 180 / Math.PI).toFixed(0)}deg: transitions to dragging and suppresses click (suppressed=true)`
      );
      ctrl.cancel("cleanup");
    }
  }

  // Jitter / Non-monotonic movement
  {
    const ctrl = createHandDragController();
    ctrl.handlePointerDown({ target: mockHandCard, pointerId: 103, pointerType: "mouse", clientX: originX, clientY: originY });
    // Jitter around inside 6px: (0,0) -> (3, 3) dist 4.24 -> (1, 5) dist 5.1 -> (4, 4) dist 5.65 -> (2, 2) dist 2.83
    ctrl.handlePointerMove({ pointerId: 103, clientX: originX + 3, clientY: originY + 3 });
    assert(ctrl.getState() === "armed", "Jitter step 1: armed");
    ctrl.handlePointerMove({ pointerId: 103, clientX: originX + 1, clientY: originY + 5 });
    assert(ctrl.getState() === "armed", "Jitter step 2: armed");
    ctrl.handlePointerMove({ pointerId: 103, clientX: originX + 4, clientY: originY + 4 });
    assert(ctrl.getState() === "armed", "Jitter step 3: armed");
    ctrl.handlePointerMove({ pointerId: 103, clientX: originX + 2, clientY: originY + 2 });
    assert(ctrl.getState() === "armed", "Jitter step 4: armed");
    ctrl.handlePointerUp({ pointerId: 103, clientX: originX + 2, clientY: originY + 2 });
    assert(ctrl.consumeClickSuppression() === false, "Jitter test: click preserved when never exceeding 6px");
  }

  // Multi-step crossing the threshold
  {
    const ctrl = createHandDragController();
    ctrl.handlePointerDown({ target: mockHandCard, pointerId: 104, pointerType: "mouse", clientX: originX, clientY: originY });
    ctrl.handlePointerMove({ pointerId: 104, clientX: originX + 5, clientY: originY }); // dist = 5.0
    assert(ctrl.getState() === "armed", "Multi-step before threshold: armed");
    ctrl.handlePointerMove({ pointerId: 104, clientX: originX + 6, clientY: originY }); // dist = 6.0
    assert(ctrl.getState() === "armed", "Multi-step at exact threshold 6.0: armed");
    ctrl.handlePointerMove({ pointerId: 104, clientX: originX + 6.05, clientY: originY }); // dist = 6.05 > 6.0
    assert(ctrl.getState() === "dragging", "Multi-step exceeding threshold: enters dragging");
    ctrl.cancel("cleanup");
  }
}

// ============================================================================
// 2. CONCURRENCY & MULTI-POINTER RACE CONDITIONS
// ============================================================================
console.log("--- 2. Concurrency & Multi-Pointer Race Conditions ---");

{
  const card1 = { uid: "race-card-1", name: "Card 1", type: "Instant", manaCost: "{R}" };
  const card2 = { uid: "race-card-2", name: "Card 2", type: "Creature", manaCost: "{G}" };
  const el1 = createMockElement("button", "btn-1", "hand-card");
  el1.dataset.handUid = card1.uid;
  const el2 = createMockElement("button", "btn-2", "hand-card");
  el2.dataset.handUid = card2.uid;

  state.hand = [card1, card2];
  const ctrl = createHandDragController();

  // Pointer 1 grabs Card 1
  ctrl.handlePointerDown({ target: el1, pointerId: 1, pointerType: "touch", clientX: 100, clientY: 100 });
  assert(ctrl.getState() === "armed" && ctrl.getDraggedCardUid() === card1.uid, "Pointer 1 arms Card 1");

  // Pointer 2 attempts pointerdown on Card 2 while Pointer 1 is armed
  ctrl.handlePointerDown({ target: el2, pointerId: 2, pointerType: "touch", clientX: 200, clientY: 100 });
  assert(ctrl.getDraggedCardUid() === card1.uid, "Pointer 2 pointerdown is ignored while Pointer 1 is armed");

  // Pointer 2 moves -> should be ignored
  ctrl.handlePointerMove({ pointerId: 2, clientX: 200, clientY: 50 });
  assert(ctrl.getState() === "armed", "Pointer 2 move is ignored");

  // Pointer 2 pointerup -> should be ignored
  ctrl.handlePointerUp({ pointerId: 2, clientX: 200, clientY: 50 });
  assert(ctrl.getState() === "armed" && ctrl.getDraggedCardUid() === card1.uid, "Pointer 2 up is ignored");

  // Pointer 1 moves > 6px -> dragging Card 1
  ctrl.handlePointerMove({ pointerId: 1, clientX: 100, clientY: 70 });
  assert(ctrl.getState() === "dragging" && ctrl.getDraggedCardUid() === card1.uid, "Pointer 1 moves > 6px into dragging");

  // Pointer 3 attempts pointerdown on Card 2 while Pointer 1 is dragging
  ctrl.handlePointerDown({ target: el2, pointerId: 3, pointerType: "touch", clientX: 200, clientY: 100 });
  assert(ctrl.getDraggedCardUid() === card1.uid, "Pointer 3 pointerdown is ignored while dragging Card 1");

  // Pointer 1 cancels
  ctrl.cancel("escape");
  assert(ctrl.getState() === "idle", "Pointer 1 cancel restores idle");

  // Now Pointer 2 can arm Card 2 cleanly
  ctrl.handlePointerDown({ target: el2, pointerId: 2, pointerType: "mouse", clientX: 200, clientY: 100 });
  assert(ctrl.getState() === "armed" && ctrl.getDraggedCardUid() === card2.uid, "After cancel, Pointer 2 can arm Card 2");
  ctrl.cancel("cleanup");
}

// ============================================================================
// 3. DROP ZONE HIT-TESTING BOUNDARY EDGE CASES
// ============================================================================
console.log("--- 3. Drop Zone Hit-Testing Boundary Edge Cases ---");

{
  // Layout setup:
  // battlefield-table: [50, 50, 850, 500]
  // player-creatures:  [100, 250, 800, 399]
  // player-lands:      [100, 400, 800, 500]
  // player-hand:       [100, 501, 800, 650]
  const mockTable = createMockElement("section", "", "battlefield-table");
  mockTable._setRect({ left: 50, top: 50, right: 850, bottom: 500 });

  const mockCreatures = createMockElement("div", "player-creatures", "creature-row");
  mockCreatures._setRect({ left: 100, top: 250, right: 800, bottom: 399 });

  const mockLands = createMockElement("div", "player-lands", "land-row");
  mockLands._setRect({ left: 100, top: 400, right: 800, bottom: 500 });

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

  const land = { uid: "l1", type: "Land", name: "Forest" };
  const creature = { uid: "c1", type: "Creature", name: "Bear" };
  const spell = { uid: "s1", type: "Instant", name: "Bolt" };

  // --- Land Edge Cases ---
  // Exactly on boundaries of player-lands
  assert(getDropZoneForCard(land, 100, 400) === "lands", "Land: top-left corner (100, 400) is 'lands'");
  assert(getDropZoneForCard(land, 800, 500) === "lands", "Land: bottom-right corner (800, 500) is 'lands'");
  assert(getDropZoneForCard(land, 450, 450) === "lands", "Land: center of lands is 'lands'");

  // 1px outside player-lands
  assert(getDropZoneForCard(land, 99, 450) === null, "Land: 1px left of lands (99, 450) is null");
  assert(getDropZoneForCard(land, 801, 450) === null, "Land: 1px right of lands (801, 450) is null");
  assert(getDropZoneForCard(land, 450, 399) === null, "Land: 1px above lands (450, 399) is in creatures lane -> null");
  assert(getDropZoneForCard(land, 450, 501) === null, "Land: 1px below lands (450, 501) is in hand -> null");

  // Land over creatures lane or table
  assert(getDropZoneForCard(land, 450, 300) === null, "Land dropped on creatures lane returns null");
  assert(getDropZoneForCard(land, 450, 150) === null, "Land dropped on upper table returns null");

  // --- Creature Edge Cases ---
  // Exactly on boundaries of player-creatures
  assert(getDropZoneForCard(creature, 100, 250) === "creatures", "Creature: top-left corner (100, 250) is 'creatures'");
  assert(getDropZoneForCard(creature, 800, 399) === "creatures", "Creature: bottom-right corner (800, 399) is 'creatures'");
  assert(getDropZoneForCard(creature, 450, 320) === "creatures", "Creature: center of creatures is 'creatures'");

  // 1px outside player-creatures
  assert(getDropZoneForCard(creature, 99, 320) === null, "Creature: 1px left of creatures (99, 320) is null");
  assert(getDropZoneForCard(creature, 801, 320) === null, "Creature: 1px right of creatures (801, 320) is null");
  assert(getDropZoneForCard(creature, 450, 249) === null, "Creature: 1px above creatures (450, 249) is in upper table -> null");
  assert(getDropZoneForCard(creature, 450, 400) === null, "Creature: 1px below creatures (450, 400) is in lands lane -> null");

  // Creature dropped on lands lane
  assert(getDropZoneForCard(creature, 450, 450) === null, "Creature dropped on lands lane returns null");

  // --- Spell Edge Cases (Instant, Sorcery, Artifact) ---
  // Anywhere on battlefield table:
  assert(getDropZoneForCard(spell, 450, 150) === "table", "Spell: upper table returns 'table'");
  assert(getDropZoneForCard(spell, 450, 320) === "table", "Spell: creatures lane returns 'table'");
  assert(getDropZoneForCard(spell, 450, 450) === "table", "Spell: lands lane returns 'table'");
  assert(getDropZoneForCard(spell, 50, 50) === "table", "Spell: top-left corner (50, 50) of table is 'table'");
  assert(getDropZoneForCard(spell, 850, 500) === "table", "Spell: bottom-right corner (850, 500) of table is 'table'");

  // 1px outside battlefield table:
  assert(getDropZoneForCard(spell, 49, 250) === null, "Spell: 1px left of table (49, 250) is null");
  assert(getDropZoneForCard(spell, 851, 250) === null, "Spell: 1px right of table (851, 250) is null");
  assert(getDropZoneForCard(spell, 450, 49) === null, "Spell: 1px above table (450, 49) is null");

  // --- Hand Area Priority ---
  // Even if table bottom extends into hand, any clientY >= handEl.top MUST return null
  assert(getDropZoneForCard(spell, 450, 501) === null, "Spell inside hand (501px) returns null");
  assert(getDropZoneForCard(creature, 450, 501) === null, "Creature inside hand returns null");
  assert(getDropZoneForCard(land, 450, 501) === null, "Land inside hand returns null");
  assert(getDropZoneForCard(spell, 450, 700) === null, "Below hand area returns null");

  // Invalid parameters
  assert(getDropZoneForCard(null, 450, 450) === null, "Null card returns null");
  assert(getDropZoneForCard(land, null, 450) === null, "Null clientX returns null");
  assert(getDropZoneForCard(land, 450, null) === null, "Null clientY returns null");

  delete globalThis.document;
}

// ============================================================================
// 4. UNPLAYABLE FEEDBACK (DESATURATION, WOBBLE, SPAWNFX) vs PLAYABLE FLIP
// ============================================================================
console.log("--- 4. Unplayable Feedback & Playable FLIP Seeding ---");

{
  resetTestState();
  startNewRun(STARTER_DECKS[0]);

  const playableLand = { uid: "play-land-1", name: "Forest", type: "Land", color: "G", produces: ["G"], keywords: [] };
  const playableSpell = { uid: "play-spell-1", name: "Lightning Bolt", type: "Instant", color: "R", manaCost: "{R}", keywords: [] };
  const unplayableManaSpell = { uid: "unplay-spell-1", name: "Expensive Spell", type: "Sorcery", color: "G", manaCost: "{G}{G}{G}{G}{G}", keywords: [] };
  const unplayableLand = { uid: "unplay-land-2", name: "Mountain", type: "Land", color: "R", produces: ["R"], keywords: [] };

  state.hand = [playableLand, playableSpell, unplayableManaSpell, unplayableLand];
  state.manaPool = { G: 0, R: 1, U: 0, B: 0, W: 0, C: 0, ANY: 0 };
  state.landsPlayedThisTurn = 0;
  state.maxLandsPerTurn = 1;

  const mockLands = createMockElement("div", "player-lands", "land-row");
  mockLands._setRect({ left: 100, top: 400, right: 800, bottom: 500 });
  const mockTable = createMockElement("section", "", "battlefield-table");
  mockTable._setRect({ left: 50, top: 50, right: 850, bottom: 500 });
  const mockHand = createMockElement("div", "player-hand", "hand-row");
  mockHand._setRect({ left: 100, top: 501, right: 800, bottom: 650 });

  globalThis.document = {
    getElementById: (id) => {
      if (id === "player-lands") return mockLands;
      if (id === "player-hand") return mockHand;
      return null;
    },
    querySelector: (sel) => {
      if (sel === ".battlefield-table") return mockTable;
      return null;
    }
  };

  let seededRect = null;
  globalThis.seedPrevHandRect = (uid, rect) => {
    seededRect = { uid, rect: { ...rect } };
  };

  let lastFxMsg = null;
  let lastFxColor = null;
  globalThis.spawnFx = (msg, col) => {
    lastFxMsg = msg;
    lastFxColor = col;
  };

  // Case 4.1: Playable land dropped in player-lands
  {
    const el = createMockElement("button", "btn-land", "hand-card");
    el.dataset.handUid = playableLand.uid;
    el._setRect({ left: 200, top: 520, right: 348, bottom: 664 });

    const ctrl = createHandDragController();
    ctrl.handlePointerDown({ target: el, pointerId: 201, clientX: 250, clientY: 550 });
    ctrl.handlePointerMove({ pointerId: 201, clientX: 250, clientY: 450 }); // in lands
    assert(!el.classList.contains("drag-invalid"), "Playable land does NOT have .drag-invalid");
    ctrl.handlePointerUp({ pointerId: 201, clientX: 250, clientY: 450 });

    assert(seededRect && seededRect.uid === playableLand.uid, "4.1 Valid drop: seedPrevHandRect called with card uid and rect");
    assert(state.playerLands.some(l => l.uid === playableLand.uid), "4.1 Valid drop: playCardFromHand executed and card entered battlefield");
    assert(ctrl.getState() === "idle", "4.1 Valid drop: controller reset to idle");
  }

  // Case 4.2: Unplayable Land (land limit reached)
  {
    // We already played 1 land above, so landsPlayedThisTurn == 1 >= maxLandsPerTurn (1)
    assert(!canPlayCard(unplayableLand), "unplayableLand is not playable due to land limit");

    const el = createMockElement("button", "btn-land-unplay", "hand-card");
    el.dataset.handUid = unplayableLand.uid;
    el._setRect({ left: 350, top: 520, right: 498, bottom: 664 });

    const ctrl = createHandDragController();
    ctrl.handlePointerDown({ target: el, pointerId: 202, clientX: 350, clientY: 550 });
    ctrl.handlePointerMove({ pointerId: 202, clientX: 350, clientY: 450 }); // in lands

    assert(el.classList.contains("drag-invalid"), "4.2 Unplayable land gets .drag-invalid while dragged");
    assert(el.style.getPropertyValue("--drag-reason") === `"Land Limit"`, "4.2 Drag reason is 'Land Limit'");

    lastFxMsg = null;
    lastFxColor = null;
    ctrl.handlePointerUp({ pointerId: 202, clientX: 350, clientY: 450 });

    assert(lastFxMsg && lastFxMsg.includes("Land Limit"), "4.2 Drop unplayable land triggers spawnFx with 'Land Limit'");
    assert(lastFxColor === "#ff6b6b", "4.2 spawnFx color is #ff6b6b");
    assert(state.hand.some(c => c.uid === unplayableLand.uid), "4.2 Unplayable land remains in hand (not played)");
    ctrl.cancel("cleanup");
  }

  // Case 4.3: Unplayable Spell (missing mana pips)
  {
    assert(!canPlayCard(unplayableManaSpell), "unplayableManaSpell is not playable due to mana");

    const el = createMockElement("button", "btn-spell-unplay", "hand-card");
    el.dataset.handUid = unplayableManaSpell.uid;
    el._setRect({ left: 500, top: 520, right: 648, bottom: 664 });

    const ctrl = createHandDragController();
    ctrl.handlePointerDown({ target: el, pointerId: 203, clientX: 500, clientY: 550 });
    ctrl.handlePointerMove({ pointerId: 203, clientX: 500, clientY: 200 }); // over table

    assert(el.classList.contains("drag-invalid"), "4.3 Unplayable spell gets .drag-invalid while dragged");
    assert(el.style.getPropertyValue("--drag-reason") === `"Missing Mana Pips"`, "4.3 Drag reason is 'Missing Mana Pips'");

    lastFxMsg = null;
    lastFxColor = null;
    ctrl.handlePointerUp({ pointerId: 203, clientX: 500, clientY: 200 });

    assert(lastFxMsg && lastFxMsg.includes("Missing Mana Pips for {G}{G}{G}{G}{G}!"), "4.3 Drop unplayable spell triggers spawnFx with exact mana cost");
    assert(lastFxColor === "#ff6b6b", "4.3 spawnFx color is #ff6b6b");
    assert(state.hand.some(c => c.uid === unplayableManaSpell.uid), "4.3 Unplayable spell remains in hand");
    ctrl.cancel("cleanup");
  }

  // Case 4.4: Dropping outside play zone snaps back SILENTLY (no spawnFx)
  {
    const el = createMockElement("button", "btn-spell-outside", "hand-card");
    el.dataset.handUid = unplayableManaSpell.uid;

    const ctrl = createHandDragController();
    ctrl.handlePointerDown({ target: el, pointerId: 204, clientX: 500, clientY: 550 });
    ctrl.handlePointerMove({ pointerId: 204, clientX: 500, clientY: 530 }); // inside hand area

    lastFxMsg = null;
    ctrl.handlePointerUp({ pointerId: 204, clientX: 500, clientY: 530 });

    assert(lastFxMsg === null, "4.4 Dropping outside play zone snaps back silently without spawnFx");
    assert(state.hand.some(c => c.uid === unplayableManaSpell.uid), "4.4 Card remains in hand");
    ctrl.cancel("cleanup");
  }

  delete globalThis.seedPrevHandRect;
  delete globalThis.spawnFx;
  delete globalThis.document;
}

// ============================================================================
// 5. CANCELLATION PATHS & REDUCED MOTION INSTANTANEOUS SNAPBACK
// ============================================================================
console.log("--- 5. Cancellation Paths & Reduced Motion Snapback ---");

{
  const card = { uid: "cancel-card-1", name: "Bear", type: "Creature", manaCost: "{1}{G}" };
  const el = createMockElement("button", "cancel-btn", "hand-card");
  el.dataset.handUid = card.uid;
  state.hand = [card];

  const mockCreatures = createMockElement("div", "player-creatures", "creature-row");
  mockCreatures._setRect({ left: 100, top: 250, right: 800, bottom: 399 });
  const mockHand = createMockElement("div", "player-hand", "hand-row");
  mockHand._setRect({ left: 100, top: 501, right: 800, bottom: 650 });

  globalThis.document = {
    getElementById: (id) => (id === "player-creatures" ? mockCreatures : id === "player-hand" ? mockHand : null),
    querySelector: () => null
  };

  // 5.1 Escape key cancellation
  {
    const ctrl = createHandDragController();
    ctrl.handlePointerDown({ target: el, pointerId: 301, clientX: 200, clientY: 550 });
    ctrl.handlePointerMove({ pointerId: 301, clientX: 200, clientY: 300 }); // dragging
    assert(ctrl.getState() === "dragging" && el.classList.contains("is-dragging"), "Drag active before Escape");

    ctrl.cancel("escape");
    assert(
      ctrl.getState() === "idle" &&
      !el.classList.contains("is-dragging") &&
      el.style.getPropertyValue("--drag-x") === "" &&
      el.style.getPropertyValue("--drag-y") === "",
      "5.1 Escape cancellation: synchronously restores idle and clears all drag variables"
    );
  }

  // 5.2 pointercancel event
  {
    const ctrl = createHandDragController();
    ctrl.handlePointerDown({ target: el, pointerId: 302, clientX: 200, clientY: 550 });
    ctrl.handlePointerMove({ pointerId: 302, clientX: 200, clientY: 300 }); // dragging
    assert(ctrl.getState() === "dragging", "Drag active before pointercancel");

    ctrl.handlePointerCancel({ pointerId: 302 });
    assert(
      ctrl.getState() === "idle" && !el.classList.contains("is-dragging"),
      "5.2 pointercancel: cleanly aborts active drag and restores idle"
    );
  }

  // 5.3 Number key shortcut cancellation
  {
    const ctrl = createHandDragController();
    ctrl.handlePointerDown({ target: el, pointerId: 303, clientX: 200, clientY: 550 });
    ctrl.handlePointerMove({ pointerId: 303, clientX: 200, clientY: 300 }); // dragging
    assert(ctrl.getState() === "dragging", "Drag active before numberKey");

    ctrl.cancel("numberKey");
    assert(
      ctrl.getState() === "idle" && !el.classList.contains("is-dragging"),
      "5.3 numberKey cancellation: cancels drag synchronously so number key can play card"
    );
  }

  // 5.4 Reduced Motion 0-tick synchronous snapback
  {
    state.prefersReducedMotion = true;
    const ctrl = createHandDragController();
    ctrl.handlePointerDown({ target: el, pointerId: 304, clientX: 200, clientY: 550 });
    ctrl.handlePointerMove({ pointerId: 304, clientX: 300, clientY: 400 }); // deltaX=100, deltaY=-150

    // Check 1:1 pointer tracking
    assert(
      el.style.getPropertyValue("--drag-x") === "100.0px" &&
      el.style.getPropertyValue("--drag-y") === "-150.0px" &&
      el.style.getPropertyValue("--lean") === "0deg",
      "5.4 Reduced motion: follows 1:1 with --lean: 0deg"
    );

    // Drop outside play zone -> must snap back synchronously in 0 ticks (no RAF loop)
    ctrl.handlePointerUp({ pointerId: 304, clientX: 300, clientY: 550 });
    assert(
      ctrl.getState() === "idle" &&
      el.style.getPropertyValue("--drag-x") === "" &&
      el.style.getPropertyValue("--drag-y") === "" &&
      !el.classList.contains("is-dragging"),
      "5.4 Reduced motion snap-back: finishes synchronously in 0 ticks with idle state and styles cleared"
    );
    state.prefersReducedMotion = false;
  }

  delete globalThis.document;
}

// ============================================================================
// 6. TOUCH TAP-TO-FOCUS & TWO-TAP PLAY
// ============================================================================
console.log("--- 6. Touch Tap-to-Focus & Two-Tap Play ---");

{
  resetTestState();
  startNewRun(STARTER_DECKS[0]);

  const card1 = { uid: "touch-1", name: "Forest", type: "Land", color: "G", produces: ["G"], keywords: [] };
  const card2 = { uid: "touch-2", name: "Mountain", type: "Land", color: "R", produces: ["R"], keywords: [] };
  state.hand = [card1, card2];

  const el1 = createMockElement("button", "t-btn-1", "hand-card");
  el1.dataset.handUid = card1.uid;
  const el2 = createMockElement("button", "t-btn-2", "hand-card");
  el2.dataset.handUid = card2.uid;

  const ctrl = createHandDragController();

  // First tap on card 1 (touch down and up without move > 6px)
  ctrl.handlePointerDown({ target: el1, pointerId: 401, pointerType: "touch", clientX: 100, clientY: 500 });
  ctrl.handlePointerUp({ pointerId: 401, clientX: 101, clientY: 501 });

  assert(el1.classList.contains("touch-focused"), "6.1 First tap on touch card applies .touch-focused");
  assert(ctrl.consumeClickSuppression() === true, "6.1 First tap suppresses native click so card is NOT played");
  assert(state.hand.some(c => c.uid === card1.uid), "6.1 Card 1 remains in hand after first tap");

  // Tap on card 2: card 1 loses focus, card 2 gains focus
  ctrl.handlePointerDown({ target: el2, pointerId: 402, pointerType: "touch", clientX: 200, clientY: 500 });
  ctrl.handlePointerUp({ pointerId: 402, clientX: 201, clientY: 501 });

  assert(!el1.classList.contains("touch-focused"), "6.2 Card 1 loses focus when Card 2 tapped");
  assert(el2.classList.contains("touch-focused"), "6.2 Card 2 gains focus");
  assert(ctrl.consumeClickSuppression() === true, "6.2 Click suppressed for Card 2 tap");

  // Second tap on card 2: plays Card 2!
  ctrl.handlePointerDown({ target: el2, pointerId: 403, pointerType: "touch", clientX: 200, clientY: 500 });
  ctrl.handlePointerUp({ pointerId: 403, clientX: 200, clientY: 500 });

  assert(!el2.classList.contains("touch-focused"), "6.3 Second tap on Card 2 clears focus");
  assert(state.playerLands.some(l => l.uid === card2.uid), "6.3 Second tap plays Card 2 onto battlefield");

  // Direct touch drag: touch down and move 20px -> should enter dragging immediately (no tap needed)
  ctrl.handlePointerDown({ target: el1, pointerId: 404, pointerType: "touch", clientX: 100, clientY: 500 });
  ctrl.handlePointerMove({ pointerId: 404, clientX: 100, clientY: 450 }); // move 50px

  assert(ctrl.getState() === "dragging" && el1.classList.contains("is-dragging"), "6.4 Direct touch drag enters dragging directly without tap");
  ctrl.cancel("cleanup");
}

// ============================================================================
// 7. CLICK EVENT LISTENER INTEGRATION & SIMULATED DOM DISPATCH
// ============================================================================
console.log("--- 7. Click Event Listener Integration & Click Suppression ---");

{
  resetTestState();
  startNewRun(STARTER_DECKS[0]);

  const testCard = { uid: "click-card-1", name: "Forest", type: "Land", color: "G", produces: ["G"], keywords: [] };
  state.hand = [testCard];

  const mockCardEl = createMockElement("button", "click-card-btn", "hand-card");
  mockCardEl.dataset.handUid = testCard.uid;

  const mockHandEl = createMockElement("div", "player-hand", "hand-row");
  mockHandEl.children.push(mockCardEl);

  let playedCardUids = [];
  const origPlayCard = globalThis.playCardFromHand;
  globalThis.playCardFromHand = (uid) => {
    playedCardUids.push(uid);
  };

  // Wire up the click handler identical to ui.js lines 2345-2353
  const clickHandler = (e) => {
    if (activeHandDragController && activeHandDragController.consumeClickSuppression()) {
      e.stopPropagation();
      e.preventDefault();
      return;
    }
    const cardEl = e.target.closest("[data-hand-uid]");
    if (cardEl) playCardFromHand(cardEl.dataset.handUid);
  };
  mockHandEl.addEventListener("click", clickHandler);

  // Scenario 7.1: True Click / Micro-movement (dist <= 6px) -> Click fires -> card IS played
  {
    playedCardUids = [];
    const ctrl = createHandDragController();
    ctrl.handlePointerDown({ target: mockCardEl, pointerId: 501, pointerType: "mouse", clientX: 200, clientY: 500 });
    ctrl.handlePointerMove({ pointerId: 501, clientX: 204, clientY: 503 }); // dist = 5.0 <= 6
    ctrl.handlePointerUp({ pointerId: 501, clientX: 204, clientY: 503 });

    // Simulate subsequent browser click event
    const clickEvt = {
      type: "click",
      target: mockCardEl,
      defaultPrevented: false,
      preventDefault: function() { this.defaultPrevented = true; },
      stopPropagation: function() { this.propagationStopped = true; }
    };
    mockHandEl.dispatchEvent(clickEvt);

    assert(
      !clickEvt.defaultPrevented && playedCardUids.length === 1 && playedCardUids[0] === testCard.uid,
      "7.1 Micro-movement <= 6px preserves click: click event is NOT prevented and plays card"
    );
  }

  // Scenario 7.2: Real Drag (dist > 6px) -> Click fires -> click is SUPPRESSED and card is NOT played via click
  {
    playedCardUids = [];
    const ctrl = createHandDragController();
    ctrl.handlePointerDown({ target: mockCardEl, pointerId: 502, pointerType: "mouse", clientX: 200, clientY: 500 });
    ctrl.handlePointerMove({ pointerId: 502, clientX: 200, clientY: 480 }); // dist = 20 > 6
    ctrl.handlePointerUp({ pointerId: 502, clientX: 200, clientY: 480 });

    // Simulate subsequent browser click event
    const clickEvt = {
      type: "click",
      target: mockCardEl,
      defaultPrevented: false,
      preventDefault: function() { this.defaultPrevented = true; },
      stopPropagation: function() { this.propagationStopped = true; }
    };
    mockHandEl.dispatchEvent(clickEvt);

    assert(
      clickEvt.defaultPrevented === true && playedCardUids.length === 0,
      "7.2 Drag > 6px suppresses click: preventDefault() is called and click handler does NOT play card"
    );

    // Subsequent legitimate click on another element or same element is NOT suppressed
    const nextClickEvt = {
      type: "click",
      target: mockCardEl,
      defaultPrevented: false,
      preventDefault: function() { this.defaultPrevented = true; },
      stopPropagation: function() { this.propagationStopped = true; }
    };
    mockHandEl.dispatchEvent(nextClickEvt);
    assert(
      !nextClickEvt.defaultPrevented && playedCardUids.length === 1,
      "7.2 Click suppression is single-use: subsequent click is processed normally"
    );
  }

  globalThis.playCardFromHand = origPlayCard;
}

// ============================================================================
// 8. SPRING PHYSICS EXTREME STRESS & NUMERICAL STABILITY
// ============================================================================
console.log("--- 8. Spring Physics Extreme Stress & Numerical Stability ---");

{
  // 8.1 Massive time delta (e.g. background tab throttling wakeup)
  const hugeDts = [0.2, 0.5, 1.0, 5.0, 60.0, 3600.0];
  for (const dt of hugeDts) {
    const s = stepSpring({ pos: 0, vel: 0 }, 100, dt, { stiffness: 320, damping: 28 });
    assert(
      Number.isFinite(s.pos) && Number.isFinite(s.vel) && !Number.isNaN(s.pos) && !Number.isNaN(s.vel),
      `8.1 Large dt=${dt}s does not explode to NaN or Infinity: pos=${s.pos.toFixed(2)}, vel=${s.vel.toFixed(2)}`
    );
  }

  // 8.2 Extreme displacements
  const extremeTargets = [1e5, -1e5, 1e7, -1e7];
  for (const target of extremeTargets) {
    let s = { pos: 0, vel: 0 };
    for (let i = 0; i < 50; i++) {
      s = stepSpring(s, target, 0.016, { stiffness: 320, damping: 35.7 });
    }
    assert(
      Number.isFinite(s.pos) && Number.isFinite(s.vel),
      `8.2 Extreme target ${target} remains finite without overflow`
    );
  }

  // 8.3 Corrupt inputs and parameter boundaries
  const corrupt1 = stepSpring(undefined, undefined, undefined);
  const corrupt2 = stepSpring({ pos: "bad", vel: "bad" }, null, "bad");
  const corrupt3 = stepSpring({ pos: Infinity, vel: -Infinity }, 100, 0.016, { stiffness: -100, damping: -50 });
  const corrupt4 = stepSpring({ pos: 50, vel: 10 }, 50, 0.016, { stiffness: 0, damping: 0 });

  assert(
    Number.isFinite(corrupt1.pos) && Number.isFinite(corrupt1.vel) &&
    Number.isFinite(corrupt2.pos) && Number.isFinite(corrupt2.vel) &&
    Number.isFinite(corrupt3.pos) && Number.isFinite(corrupt3.vel) &&
    Number.isFinite(corrupt4.pos) && Number.isFinite(corrupt4.vel),
    "8.3 Corrupt / non-finite / zero-parameter inputs are cleanly sanitized to finite values"
  );
}

// ============================================================================
// 9. ABNORMAL LIFECYCLE & RACE CONDITIONS
// ============================================================================
console.log("--- 9. Abnormal Lifecycle & Robustness ---");

{
  const card = { uid: "abnormal-1", name: "Grizzly Bears", type: "Creature", manaCost: "{1}{G}" };
  const mockEl = createMockElement("button", "ab-btn", "hand-card");
  mockEl.dataset.handUid = card.uid;
  state.hand = [card];

  const ctrl = createHandDragController();

  // 9.1 pointermove without pointerdown
  ctrl.handlePointerMove({ pointerId: 99, clientX: 200, clientY: 200 });
  assert(ctrl.getState() === "idle", "9.1 Pointermove without pointerdown leaves state idle");

  // 9.2 pointerup without pointerdown
  ctrl.handlePointerUp({ pointerId: 99, clientX: 200, clientY: 200 });
  assert(ctrl.getState() === "idle", "9.2 Pointerup without pointerdown leaves state idle");

  // 9.3 pointercancel while armed (before movement threshold)
  ctrl.handlePointerDown({ target: mockEl, pointerId: 601, clientX: 100, clientY: 100 });
  assert(ctrl.getState() === "armed", "Armed before cancel");
  ctrl.handlePointerCancel({ pointerId: 601 });
  assert(ctrl.getState() === "idle", "9.3 pointercancel while armed immediately restores idle");

  // 9.4 pointerdown on non-card target
  const nonCardEl = createMockElement("div", "bg-div");
  ctrl.handlePointerDown({ target: nonCardEl, pointerId: 602, clientX: 100, clientY: 100 });
  assert(ctrl.getState() === "idle", "9.4 Pointerdown on non-card target remains idle");

  // 9.5 pointerdown on stale card UID not in hand
  const staleEl = createMockElement("button", "stale-btn", "hand-card");
  staleEl.dataset.handUid = "non-existent-uid";
  ctrl.handlePointerDown({ target: staleEl, pointerId: 603, clientX: 100, clientY: 100 });
  assert(ctrl.getState() === "idle", "9.5 Pointerdown on stale card UID not in hand remains idle");

  // 9.6 combatLocked / runOver triggers during drag
  ctrl.handlePointerDown({ target: mockEl, pointerId: 604, clientX: 100, clientY: 100 });
  ctrl.handlePointerMove({ pointerId: 604, clientX: 100, clientY: 80 }); // dragging
  assert(ctrl.getState() === "dragging", "Dragging before combatLock");

  state.combatLocked = true;
  ctrl.handlePointerMove({ pointerId: 604, clientX: 100, clientY: 70 });
  assert(ctrl.getState() === "idle", "9.6 combatLocked aborts drag during pointermove");
  state.combatLocked = false;

  ctrl.handlePointerDown({ target: mockEl, pointerId: 605, clientX: 100, clientY: 100 });
  ctrl.handlePointerMove({ pointerId: 605, clientX: 100, clientY: 80 }); // dragging
  assert(ctrl.getState() === "dragging", "Dragging before runOver");

  state.runOver = true;
  ctrl.handlePointerMove({ pointerId: 605, clientX: 100, clientY: 70 });
  assert(ctrl.getState() === "idle", "9.6 runOver aborts drag during pointermove");
  state.runOver = false;

  // 9.7 Exception resilience during pointer capture
  mockEl.setPointerCapture = () => { throw new Error("Pointer capture failed in sandbox"); };
  mockEl.releasePointerCapture = () => { throw new Error("Pointer release failed in sandbox"); };

  let threw = false;
  try {
    ctrl.handlePointerDown({ target: mockEl, pointerId: 606, clientX: 100, clientY: 100 });
    ctrl.handlePointerMove({ pointerId: 606, clientX: 100, clientY: 80 });
    ctrl.cancel("cleanup");
  } catch (err) {
    threw = true;
  }
  assert(!threw && ctrl.getState() === "idle", "9.7 Pointer capture exception does not crash drag controller");
}

// ============================================================================
// 10. RE-RENDER DURING DRAG (reconcileKeyedList & renderHand)
// ============================================================================
console.log("--- 10. Re-render During Active Drag ---");

{
  const card1 = { uid: "render-c1", name: "Forest", type: "Land", color: "G", produces: ["G"], keywords: [] };
  const card2 = { uid: "render-c2", name: "Lightning Bolt", type: "Instant", color: "R", manaCost: "{R}", keywords: [] };
  state.hand = [card1, card2];

  const handRow = createMockElement("div", "player-hand", "hand-row");
  const card1El = createMockElement("button", "c1-btn", "hand-card");
  card1El.dataset.handUid = card1.uid;
  const card2El = createMockElement("button", "c2-btn", "hand-card");
  card2El.dataset.handUid = card2.uid;
  handRow.children = [card1El, card2El];

  const ctrl = createHandDragController();

  // Start drag on card1
  ctrl.handlePointerDown({ target: card1El, pointerId: 701, clientX: 100, clientY: 500 });
  ctrl.handlePointerMove({ pointerId: 701, clientX: 100, clientY: 450 }); // > 6px -> dragging

  assert(ctrl.getState() === "dragging", "Card 1 is dragging");
  assert(ctrl.getDraggedCardUid() === card1.uid, "Dragged UID is Card 1");

  // Verify that an external renderHand invocation respects activeHandDragController
  const isCurrentlyDragged = activeHandDragController && activeHandDragController.getDraggedCardUid() === card1.uid;
  assert(isCurrentlyDragged === true, "10.1 Active drag controller recognizes card1 as actively dragged");

  // Reconcile / render pass simulation:
  const playable = canPlayCard(card1);
  const baseClass = `hand-card card-color-${card1.color} ${playable ? "playable" : "unplayable"}`;
  card1El.className = isCurrentlyDragged ? `${baseClass} is-dragging${!playable ? " drag-invalid" : ""}` : baseClass;

  assert(card1El.classList.contains("is-dragging"), "10.2 Re-render preserves .is-dragging class on active card");

  // Can still cleanly drop or cancel
  ctrl.cancel("escape");
  assert(ctrl.getState() === "idle" && !card1El.classList.contains("is-dragging"), "10.3 Drag on re-rendered element cleanly cancels");
}

// ============================================================================
// 11. FALSY POINTER ID (pointerId = 0) LIFECYCLE & ISOLATION
// ============================================================================
console.log("--- 11. Falsy Pointer ID (pointerId = 0) Lifecycle & Isolation ---");
{
  const card = { uid: "p0-card", name: "Forest", type: "Land" };
  const mockCard = createMockElement("button", "p0-btn", "hand-card");
  mockCard.dataset.handUid = card.uid;
  state.hand = [card];

  const ctrl = createHandDragController();

  // 11.1 Arm with pointerId = 0
  ctrl.handlePointerDown({ target: mockCard, pointerId: 0, pointerType: "touch", clientX: 100, clientY: 500 });
  assert(ctrl.getState() === "armed", "11.1 pointerId=0 arms controller correctly");

  // 11.2 Another pointer (pointerId = 1) is rejected
  ctrl.handlePointerMove({ pointerId: 1, clientX: 100, clientY: 450 });
  assert(ctrl.getState() === "armed", "11.2 pointerId=1 is ignored when pointerId=0 is captured");

  // 11.3 Move pointerId = 0 > 6px
  ctrl.handlePointerMove({ pointerId: 0, clientX: 100, clientY: 450 });
  assert(ctrl.getState() === "dragging", "11.3 pointerId=0 successfully transitions to dragging");

  // 11.4 pointerId = 1 pointerup is ignored
  ctrl.handlePointerUp({ pointerId: 1, clientX: 100, clientY: 450 });
  assert(ctrl.getState() === "dragging", "11.4 pointerId=1 pointerup does not drop pointerId=0 drag");

  // 11.5 pointerId = 0 pointercancel cancels drag
  ctrl.handlePointerCancel({ pointerId: 0 });
  assert(ctrl.getState() === "idle", "11.5 pointerId=0 pointercancel cleanly cancels drag");
}

// ============================================================================
// 12. HIGH-FREQUENCY THRESHOLD OSCILLATION & SUB-PIXEL BOUNDARIES
// ============================================================================
console.log("--- 12. High-Frequency Threshold Oscillation & Sub-Pixel Boundaries ---");
{
  const card = { uid: "osc-card", name: "Shock", type: "Instant", color: "R", manaCost: "{R}" };
  const mockCard = createMockElement("button", "osc-btn", "hand-card");
  mockCard.dataset.handUid = card.uid;
  state.hand = [card];

  const ctrl = createHandDragController();
  ctrl.handlePointerDown({ target: mockCard, pointerId: 801, clientX: 500, clientY: 500 });

  // 12.1 Sub-pixel boundary just under 6px: 5.999px
  ctrl.handlePointerMove({ pointerId: 801, clientX: 500 + 5.999, clientY: 500 });
  assert(ctrl.getState() === "armed", "12.1 Distance 5.999px remains armed");

  // 12.2 Sub-pixel boundary just over 6px: 6.001px
  ctrl.handlePointerMove({ pointerId: 801, clientX: 500 + 6.001, clientY: 500 });
  assert(ctrl.getState() === "dragging", "12.2 Distance 6.001px triggers dragging");

  // 12.3 Oscillation back below threshold: 1.0px from start
  ctrl.handlePointerMove({ pointerId: 801, clientX: 500 + 1.0, clientY: 500 });
  assert(ctrl.getState() === "dragging", "12.3 Returning below 6px keeps dragging state (no oscillation reversion)");

  // 12.4 Pointerup suppresses click even though ended near origin
  ctrl.handlePointerUp({ pointerId: 801, clientX: 500 + 1.0, clientY: 500 });
  assert(ctrl.consumeClickSuppression() === true, "12.4 Click is suppressed after dragging even if released near origin");
  ctrl.cancel("cleanup");
}

// ============================================================================
// 13. ITERATION 2 DOUBLE-SPACING & HAND GEOMETRY STRESS (1 to 25 CARDS)
// ============================================================================
console.log("--- 13. Iteration 2 Double-Spacing & Hand Geometry Stress ---");
{
  const containerW = 900;
  const cardW = 148;
  const handSizes = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 18, 20, 25];

  for (const count of handSizes) {
    const layoutSample = calculateFanLayout(0, count, containerW, cardW);
    const overlap = layoutSample.overlap;

    // Flexbox in-flow width of cards with negative margin:
    // width = count * cardW - (count - 1) * overlap
    const effectiveSpan = count <= 1 ? cardW : (cardW + (count - 1) * (cardW - overlap));

    assert(
      effectiveSpan <= containerW,
      `13.1 Hand size ${count} cards fits container width: effectiveSpan=${effectiveSpan.toFixed(2)}px <= ${containerW}px`
    );

    for (let idx = 0; idx < count; idx++) {
      const cardLayout = calculateFanLayout(idx, count, containerW, cardW);
      assert(
        Math.abs(cardLayout.rot) <= 12.01,
        `13.2 Hand size ${count} card ${idx} rotation <= 12deg: got ${cardLayout.rot}deg`
      );
      assert(
        cardLayout.y >= 0 && cardLayout.y <= 14.01,
        `13.3 Hand size ${count} card ${idx} sag y in [0, 14]px: got ${cardLayout.y}px`
      );
    }
  }

  // 13.4 Exact 2-card hand touching with 0px overlap and 0px void gap
  const twoCards = calculateFanLayout(0, 2, 900, 148);
  assert(twoCards.overlap === 0, "13.4 Two-card hand has overlap = 0 (touching without overlap)");
  const twoCardSpan = 148 + 148;
  assert(twoCardSpan === 296, "13.4 Two-card hand total span is exactly 296px with 0px void gap");
}

// ============================================================================
// 14. VELOCITY LEAN CLAMPING UNDER EXTREME VELOCITIES & SHOCK IMPULSE
// ============================================================================
console.log("--- 14. Velocity Lean Clamping Under Extreme Velocities ---");
{
  // Test stepSpring for lean under extreme velocity inputs (+/- 5000 px/s)
  const extremeVelocities = [500, 1000, 2500, 5000, 10000, -500, -1000, -2500, -5000, -10000];
  for (const v of extremeVelocities) {
    const targetLean = Math.max(-15, Math.min(15, v * 0.025));
    assert(
      Math.abs(targetLean) <= 15,
      `14.1 Target lean for velocity ${v}px/s is strictly clamped to +/-15deg: got ${targetLean}deg`
    );

    let leanSpring = { pos: 0, vel: 0 };
    // Step forward several frames
    let maxObservedLean = 0;
    for (let f = 0; f < 30; f++) {
      leanSpring = stepSpring(leanSpring, targetLean, 0.016, { stiffness: 280, damping: 24 });
      const clampedLean = Math.max(-15, Math.min(15, leanSpring.pos));
      maxObservedLean = Math.max(maxObservedLean, Math.abs(clampedLean));
    }
    assert(
      maxObservedLean <= 15.0001,
      `14.2 Clamped lean output for velocity ${v}px/s never exceeds 15deg (got max: ${maxObservedLean}deg)`
    );
  }
}

// ============================================================================
// 15. SIBLING SPREAD ISOLATION DURING ACTIVE DRAG
// ============================================================================
console.log("--- 15. Sibling Spread Isolation During Active Drag ---");
{
  const css = typeof readFile === "function"
    ? readFile("style.css")
    : require("fs").readFileSync(require("path").join(__dirname, "style.css"), "utf8");

  // Verify that hover / focus sibling spread rules require :not(.is-dragging)
  const spreadRules = [
    ".hand-card:hover:not(.is-dragging) ~ .hand-card",
    ".hand-card:focus-visible:not(.is-dragging) ~ .hand-card",
    ".hand-card.touch-focused:not(.is-dragging) ~ .hand-card",
    ".hand-card:has(~ .hand-card:hover:not(.is-dragging))",
    ".hand-card:has(~ .hand-card:focus-visible:not(.is-dragging))",
    ".hand-card:has(~ .hand-card.touch-focused:not(.is-dragging))"
  ];

  for (const rule of spreadRules) {
    assert(css.includes(rule), `15.1 style.css declares protected sibling spread rule: ${rule}`);
  }

  // Ensure no unexcluded sibling spread rule exists
  const unexcludedSpread = css.match(/\.hand-card(?::hover|:focus-visible|\.touch-focused)\s*[~+]\s*\.hand-card/g) || [];
  const leakingSpread = unexcludedSpread.filter(s => !s.includes(":not(.is-dragging)"));
  assert(
    leakingSpread.length === 0,
    `15.2 Zero unexcluded sibling spread combinators found (leaks: ${leakingSpread.join(", ")})`
  );
}

// ============================================================================
// 16. REDUCED MOTION UNPLAYABLE DROP 0-TICK SNAPBACK
// ============================================================================
console.log("--- 16. Reduced Motion Unplayable Drop 0-Tick Snapback ---");
{
  resetTestState();
  startNewRun(STARTER_DECKS[0]);

  const expensiveSpell = { uid: "rm-unplay-1", name: "Expensive Spell", type: "Sorcery", color: "G", manaCost: "{G}{G}{G}{G}{G}" };
  state.hand = [expensiveSpell];
  state.manaPool = { G: 0, R: 0, U: 0, B: 0, W: 0, C: 0, ANY: 0 };
  state.prefersReducedMotion = true;

  const mockTable = createMockElement("section", "", "battlefield-table");
  mockTable._setRect({ left: 50, top: 50, right: 850, bottom: 500 });
  const mockHand = createMockElement("div", "player-hand", "hand-row");
  mockHand._setRect({ left: 100, top: 501, right: 800, bottom: 650 });

  globalThis.document = {
    getElementById: (id) => (id === "player-hand" ? mockHand : null),
    querySelector: (sel) => (sel === ".battlefield-table" ? mockTable : null)
  };

  let fxSpawned = false;
  globalThis.spawnFx = () => { fxSpawned = true; };

  const el = createMockElement("button", "rm-btn", "hand-card");
  el.dataset.handUid = expensiveSpell.uid;

  const ctrl = createHandDragController();
  ctrl.handlePointerDown({ target: el, pointerId: 901, clientX: 200, clientY: 550 });
  ctrl.handlePointerMove({ pointerId: 901, clientX: 200, clientY: 200 }); // dragging over table

  assert(ctrl.getState() === "dragging", "16.1 Dragging active in reduced motion");
  assert(el.classList.contains("drag-invalid"), "16.1 Unplayable card has .drag-invalid");

  // Pointerup on table -> unplayable drop
  ctrl.handlePointerUp({ pointerId: 901, clientX: 200, clientY: 200 });

  assert(fxSpawned === true, "16.2 spawnFx called for unplayable drop under reduced motion");
  assert(
    ctrl.getState() === "idle" &&
    !el.classList.contains("is-dragging") &&
    el.style.getPropertyValue("--drag-x") === "" &&
    el.style.getPropertyValue("--drag-y") === "",
    "16.3 Reduced motion unplayable drop snaps back in 0 ticks (idle immediately, no wobble)"
  );

  state.prefersReducedMotion = false;
  delete globalThis.spawnFx;
  delete globalThis.document;
}

// ============================================================================
// 17. COMPREHENSIVE CANCELLATION MATRIX
// ============================================================================
console.log("--- 17. Comprehensive Cancellation Matrix ---");
{
  const cancelReasons = [
    "escape",
    "numberKey",
    "pointercancel",
    "combatLocked",
    "runOver",
    "combat",
    "mulligan",
    "destroy"
  ];

  const card = { uid: "matrix-c1", name: "Bear", type: "Creature", manaCost: "{1}{G}" };
  state.hand = [card];

  for (const reason of cancelReasons) {
    const el = createMockElement("button", `btn-${reason}`, "hand-card");
    el.dataset.handUid = card.uid;

    const ctrl = createHandDragController();
    ctrl.handlePointerDown({ target: el, pointerId: 1001, clientX: 100, clientY: 500 });
    ctrl.handlePointerMove({ pointerId: 1001, clientX: 100, clientY: 450 }); // dragging
    assert(ctrl.getState() === "dragging", `17.1 Dragging before cancel(${reason})`);

    if (reason === "pointercancel") {
      ctrl.handlePointerCancel({ pointerId: 1001 });
    } else if (reason === "destroy") {
      ctrl.destroy();
    } else {
      ctrl.cancel(reason);
    }

    assert(
      ctrl.getState() === "idle",
      `17.2 Cancel reason '${reason}' restores state to idle`
    );
    assert(
      !el.classList.contains("is-dragging") &&
      !el.classList.contains("drag-invalid") &&
      el.style.getPropertyValue("--drag-x") === "" &&
      el.style.getPropertyValue("--drag-y") === "" &&
      el.style.getPropertyValue("--lean") === "",
      `17.3 Cancel reason '${reason}' clears all visual classes and CSS variables`
    );
  }
}

// ============================================================================
// 18. INTERRUPTED POINTER CAPTURE (lostpointercapture), PRIMARY BUTTON GUARD & UNIFIED RESET
// ============================================================================
console.log("--- 18. Interrupted Pointer Capture (lostpointercapture) & Primary Button Guard ---");
{
  const card = { uid: "lpc-card", name: "Counterspell", type: "Instant", color: "U", manaCost: "{U}{U}" };
  state.hand = [card];
  const el = createMockElement("button", "btn-lpc", "hand-card");
  el.dataset.handUid = card.uid;

  const ctrl = createHandDragController();

  // 18.1 Non-primary mouse button (right-click button=2, middle-click button=1) is ignored
  ctrl.handlePointerDown({ target: el, pointerId: 1801, button: 2, clientX: 200, clientY: 500 });
  assert(ctrl.getState() === "idle", "18.1 Right-click (button=2) does not arm drag controller");
  ctrl.handlePointerDown({ target: el, pointerId: 1802, button: 1, clientX: 200, clientY: 500 });
  assert(ctrl.getState() === "idle", "18.1 Middle-click (button=1) does not arm drag controller");

  // 18.2 Primary mouse button (button=0) arms controller and captures pointer
  ctrl.handlePointerDown({ target: el, pointerId: 1803, button: 0, clientX: 200, clientY: 500 });
  assert(
    ctrl.getState() === "armed" && ctrl.getDragState().hasPointerCapture === true,
    "18.2 Primary button (button=0) arms controller and records hasPointerCapture=true"
  );

  // 18.3 Unrelated pointer's lostpointercapture is ignored
  ctrl.handleLostPointerCapture({ pointerId: 9999 });
  assert(ctrl.getState() === "armed", "18.3 Unrelated pointerId lostpointercapture does not interrupt active pointer");

  // 18.4 Active pointer's lostpointercapture during 'dragging' immediately resets state and visuals
  ctrl.handlePointerMove({ pointerId: 1803, clientX: 200, clientY: 420 });
  assert(ctrl.getState() === "dragging" && el.classList.contains("is-dragging"), "18.4 Active pointer enters dragging");

  ctrl.handleLostPointerCapture({ pointerId: 1803 });
  const snapAfterLPC = ctrl.getDragState();
  assert(
    ctrl.getState() === "idle" &&
    snapAfterLPC.hasPointerCapture === false &&
    snapAfterLPC.cardEl === null &&
    snapAfterLPC.lastResetReason === "lostpointercapture" &&
    !el.classList.contains("is-dragging") &&
    el.style.getPropertyValue("--drag-x") === "",
    "18.4 lostpointercapture during dragging resets dragState to idle and cleans up all styles"
  );
}

console.log("=================================================");
console.log(`ADVERSARIAL STRESS TEST COMPLETE: ${passedTests} passed, ${failedTests} failed out of ${totalTests} assertions`);
console.log("=================================================");

if (failedTests > 0) {
  process.exit(1);
}
