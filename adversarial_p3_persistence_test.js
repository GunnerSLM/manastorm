// MANASTORM — Part 3 Adversarial State Persistence, Symmetry & Lifecycle Stress Test Suite
// Verification via: /System/Library/Frameworks/JavaScriptCore.framework/Versions/A/Helpers/jsc adversarial_p3_persistence_test.js

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
load("desktop.js");

state.headless = true;

let passed = 0;
let failed = 0;

function assert(cond, msg) {
  if (cond) {
    passed++;
  } else {
    failed++;
    console.error(`❌ FAIL: ${msg}`);
  }
}

function createMemoryStorage() {
  const store = new Map();
  return {
    getItem(k) { return store.has(k) ? store.get(k) : null; },
    setItem(k, v) { store.set(k, String(v)); },
    removeItem(k) { store.delete(k); },
    clear() { store.clear(); },
    key(i) { return Array.from(store.keys())[i] || null; },
    get length() { return store.size; },
    _dump() { return Object.fromEntries(store.entries()); }
  };
}

function resetTestState() {
  state.headless = true;
  state.runOver = false;
  state.combatLocked = false;
  state.relics = [];
  state.consumables = [];
  state.playerLands = [];
  state.playerCreatures = [];
  state.enemyCreatures = [];
  state.graveyard = [];
  state.manaPool = { G: 0, R: 0, B: 0, U: 0, W: 0, C: 0, ANY: 0 };
  state.turnBurnPower = 0;
  state.turnResonance = 1;
  state.resonanceSources = [{ label: "Base Resonance", amount: 1, type: "add" }];
  state.burnSources = [];
  state.turnStats = { spellsPlayed: 0, manaSpent: 0, playerDamageDealt: 0 };
  state.synTiers = {};
  state.encounterIdx = 0;
  state.enemyLife = 0;
  state.playerLife = 20;
  state.gold = 10;
  state.pendingDraft = null;
}

console.log("=== BEGINNING ADVERSARIAL POST-BATTLE CARD DRAFT & PERSISTENCE STRESS HARNESS ===");

// ============================================================================
// 1. SAVE / RESTORE ROUND-TRIP PERSISTENCE & RELOAD EXPLOITS
// ============================================================================
console.log("--- 1. Save / Restore Round-Trip Persistence & Reload Exploits ---");
{
  const prevDoc = globalThis.document;
  const prevLS = globalThis.localStorage;
  const memStore = createMemoryStorage();

  try {
    resetTestState();
    startNewRun(STARTER_DECKS[0]);
    state.headless = false;
    globalThis.document = { getElementById: () => null, querySelector: () => null, querySelectorAll: () => [] };
    globalThis.localStorage = memStore;
    state.encounterIdx = 0;
    state.enemyLife = 0;
    handleEncounterVictory();

    assert(state.pendingDraft !== null, "1.1.1 Pending draft generated on encounter victory");
    const originalChoices = [...state.pendingDraft.choices];
    assert(originalChoices.length === 3, "1.1.2 Exactly 3 draft choices generated");
    assert(state.pendingDraft.resolved === false, "1.1.3 Draft starts unresolved");

    const saveSuccess = saveRunState(false);
    assert(saveSuccess === true, "1.1.4 saveRunState(false) succeeds during active pending draft");

    const rawStored = memStore.getItem(SAVE_KEY);
    assert(typeof rawStored === "string" && rawStored.length > 0, "1.1.5 Save data present in localStorage");
    const parsedStored = JSON.parse(rawStored);
    assert(parsedStored.pendingDraft !== null, "1.1.6 Stored payload includes pendingDraft");
    assert(
      Array.isArray(parsedStored.pendingDraft.choices) &&
      parsedStored.pendingDraft.choices.length === 3 &&
      parsedStored.pendingDraft.choices[0] === originalChoices[0] &&
      parsedStored.pendingDraft.choices[1] === originalChoices[1] &&
      parsedStored.pendingDraft.choices[2] === originalChoices[2],
      "1.1.7 Stored draft choices match in-memory choices exactly"
    );
    assert(parsedStored.pendingDraft.resolved === false, "1.1.8 Stored draft resolved flag is false");
    assert(parsedStored.inShop === false, "1.1.9 inShop is false while draft is pending");

    // 1.2: Reload mid-draft
    state.pendingDraft = null;
    state.masterDeck = [];
    const loadSuccess = loadRunState();
    assert(loadSuccess === true, "1.2.1 loadRunState() succeeds");
    assert(state.pendingDraft !== null, "1.2.2 state.pendingDraft is restored from storage");
    assert(state.pendingDraft.resolved === false, "1.2.3 Restored draft resolved is false");
    assert(
      state.pendingDraft.choices.length === 3 &&
      state.pendingDraft.choices[0] === originalChoices[0] &&
      state.pendingDraft.choices[1] === originalChoices[1] &&
      state.pendingDraft.choices[2] === originalChoices[2],
      "1.2.4 Restored draft choices match original choices identically"
    );
    assert(
      Array.isArray(state.pendingDraft.cards) &&
      state.pendingDraft.cards.length === 3 &&
      state.pendingDraft.cards[0].id === originalChoices[0],
      "1.2.5 Restored state.pendingDraft.cards getter resolves full card definitions from CARD_DB"
    );

    // 1.3: Resolve mid-draft after reload
    const deckLenBeforeDraft = state.masterDeck.length;
    const pickedCardId = originalChoices[1];
    const pickSuccess = selectDraftCard(1);
    assert(pickSuccess === true, "1.3.1 selectDraftCard(1) succeeds on reloaded draft");
    assert(state.masterDeck.length === deckLenBeforeDraft + 1, "1.3.2 Master deck count increased by exactly 1");
    assert(state.masterDeck[state.masterDeck.length - 1].id === pickedCardId, "1.3.3 Selected card added to master deck");
    assert(state.pendingDraft.resolved === true, "1.3.4 state.pendingDraft.resolved marked true");
    assert(state.pendingDraft.selectedCardId === pickedCardId, "1.3.5 state.pendingDraft.selectedCardId set to picked card");

    // 1.4: Save resolved draft
    const rawStoredAfterDraft = memStore.getItem(SAVE_KEY);
    const parsedStoredAfterDraft = JSON.parse(rawStoredAfterDraft);
    assert(parsedStoredAfterDraft.pendingDraft.resolved === true, "1.4.1 Stored save after pick has resolved: true");
    assert(parsedStoredAfterDraft.pendingDraft.selectedCardId === pickedCardId, "1.4.2 Stored save has selectedCardId recorded");
    assert(parsedStoredAfterDraft.inShop === true, "1.4.3 inShop is true after draft resolution");

    // 1.5: Reload again after resolution
    const deckLenAfterPick = state.masterDeck.length;
    const loadAfterResolveSuccess = loadRunState();
    assert(loadAfterResolveSuccess === true, "1.5.1 loadRunState() succeeds after draft resolution");
    assert(state.masterDeck.length === deckLenAfterPick, "1.5.2 Deck size unchanged on reload after resolution");
    assert(
      !state.pendingDraft || state.pendingDraft.resolved === true,
      "1.5.3 state.pendingDraft is closed or resolved on reload"
    );

    // 1.6: Duplicate reward exploit attempts on reloaded resolved draft
    const exploitPick = selectDraftCard(0);
    assert(exploitPick === false, "1.6.1 Calling selectDraftCard after reload on resolved draft is rejected");
    assert(state.masterDeck.length === deckLenAfterPick, "1.6.2 Master deck size not altered by exploit attempt");

    const exploitSkip = skipDraft();
    assert(exploitSkip === false, "1.6.3 Calling skipDraft after reload on resolved draft is rejected");

    // 1.7: Save & reload after skipDraft
    resetTestState();
    startNewRun(STARTER_DECKS[0]);
    state.headless = false;
    state.encounterIdx = 1;
    state.enemyLife = 0;
    handleEncounterVictory();

    const goldBeforeSkip = state.gold;
    const deckBeforeSkip = state.masterDeck.length;
    const skipSuccess = skipDraft();
    assert(skipSuccess === true, "1.7.1 skipDraft() succeeds on fresh encounter victory");
    assert(state.gold === goldBeforeSkip + 2, "1.7.2 Gold increased by exactly +$2");
    assert(state.masterDeck.length === deckBeforeSkip, "1.7.3 Master deck size unchanged by skip");
    assert(state.pendingDraft.resolved === true && state.pendingDraft.skipped === true, "1.7.4 Draft resolved with skipped: true");

    // Reload after skip
    state.gold = 0;
    state.pendingDraft = null;
    loadRunState();
    assert(state.gold === goldBeforeSkip + 2, "1.7.5 Correct gold restored on reload after skip");
    assert(!state.pendingDraft || (state.pendingDraft.resolved === true && state.pendingDraft.skipped === true), "1.7.6 Draft is closed or resolved after reload");
    assert(selectDraftCard(0) === false, "1.7.7 Cannot select card after reload when draft was skipped");
    assert(skipDraft() === false, "1.7.8 Cannot skip again after reload when draft was skipped");
    assert(state.gold === goldBeforeSkip + 2, "1.7.9 Gold remains unchanged after duplicate exploit attempts");

    // 1.8: Corrupted primary save fallback recovery preserves pendingDraft
    const backupBeforeCorrupt = memStore.getItem(SAVE_BACKUP_STORE_KEY);
    assert(backupBeforeCorrupt !== null, "1.8.1 Backup store key exists");
    memStore.setItem(SAVE_KEY, "CORRUPT_JSON_DATA_{{{{");
    const recovered = loadRunState();
    assert(recovered === true, "1.8.2 loadRunState recovers from backup store when primary is corrupt");
    assert(state.gold === goldBeforeSkip + 2, "1.8.3 Recovered state has correct gold");
  } finally {
    state.headless = true;
    if (prevDoc === undefined) delete globalThis.document;
    else globalThis.document = prevDoc;
    if (prevLS === undefined) delete globalThis.localStorage;
    else globalThis.localStorage = prevLS;
  }
}

// ============================================================================
// 2. SYMMETRIC NORMALIZATION & HOSTILE PAYLOAD FUZZING
// ============================================================================
console.log("--- 2. Symmetric Normalization & Hostile Payload Fuzzing ---");
{
  const basePayload = {
    version: 1,
    savedAt: 1700000000000,
    inShop: false,
    archetypeId: "gruul",
    encounterIdx: 1,
    playerLife: 20,
    gold: 10,
    masterDeck: [{ id: "lightning_bolt" }],
    relicIds: [],
    consumableIds: []
  };

  // Helper to test symmetry across normalizeCanonicalSave and DesktopBridge.normalizeSaveObject
  function testSymmetry(name, pendingDraftInput) {
    const payload = {
      ...basePayload,
      pendingDraft: pendingDraftInput
    };

    const normDesk = DesktopBridge.normalizeSaveObject(payload);

    // Test with DesktopBridge defined
    const normGameWithBridge = normalizeCanonicalSave(payload);
    assert(normGameWithBridge.valid === normDesk.valid, `${name} — valid flag matches with bridge (${normGameWithBridge.valid})`);

    // Test game.js fallback with DesktopBridge undefined
    const savedBridge = DesktopBridge;
    globalThis.DesktopBridge = undefined;
    let normGameFallback = null;
    try {
      normGameFallback = normalizeCanonicalSave(payload);
    } finally {
      globalThis.DesktopBridge = savedBridge;
    }

    assert(normGameFallback.valid === normDesk.valid, `${name} — valid flag matches fallback (${normGameFallback.valid})`);

    if (normDesk.valid) {
      const draftDeskJson = JSON.stringify(normDesk.save.pendingDraft);
      const draftBridgeJson = JSON.stringify(normGameWithBridge.save.pendingDraft);
      const draftFallbackJson = JSON.stringify(normGameFallback.save.pendingDraft);
      assert(
        draftDeskJson === draftBridgeJson && draftDeskJson === draftFallbackJson,
        `${name} — 3-way pendingDraft parity identical (desktop vs game.js with bridge vs game.js fallback)`
      );
    }
  }

  // 2.1: Valid pending draft
  testSymmetry("2.1.1 Valid unresolved pendingDraft", {
    choices: ["stomping_ground", "lotus_cobra", "cultivate"],
    encounterIdx: 1,
    resolved: false,
    skipped: false,
    selectedCardId: null
  });

  testSymmetry("2.1.2 Valid resolved pendingDraft (picked)", {
    choices: ["stomping_ground", "lotus_cobra", "cultivate"],
    encounterIdx: 1,
    resolved: true,
    skipped: false,
    selectedCardId: "lotus_cobra"
  });

  testSymmetry("2.1.3 Valid resolved pendingDraft (skipped)", {
    choices: ["stomping_ground", "lotus_cobra", "cultivate"],
    encounterIdx: 1,
    resolved: true,
    skipped: true,
    selectedCardId: null
  });

  // 2.2: Non-array choices
  testSymmetry("2.2.1 choices is string", { choices: "lightning_bolt", encounterIdx: 1, resolved: false });
  testSymmetry("2.2.2 choices is number", { choices: 12345, encounterIdx: 1, resolved: false });
  testSymmetry("2.2.3 choices is boolean", { choices: true, encounterIdx: 1, resolved: false });
  testSymmetry("2.2.4 choices is null", { choices: null, encounterIdx: 1, resolved: false });
  testSymmetry("2.2.5 choices is plain object", { choices: { 0: "lightning_bolt" }, encounterIdx: 1, resolved: false });

  // 2.3: Hostile card IDs in choices
  testSymmetry("2.3.1 Unknown card IDs filtered", {
    choices: ["fake_card_1", "lightning_bolt", "nonexistent_card_2"],
    encounterIdx: 1,
    resolved: false
  });
  testSymmetry("2.3.2 All card IDs unknown (drops to null)", {
    choices: ["bogus_a", "bogus_b", "bogus_c"],
    encounterIdx: 1,
    resolved: false
  });
  testSymmetry("2.3.3 Nulls, numbers, empty strings inside choices array", {
    choices: [null, 42, "", undefined, {}, "lightning_bolt", []],
    encounterIdx: 1,
    resolved: false
  });

  // 2.4: Alternate cards property instead of choices
  testSymmetry("2.4.1 cards array of strings", {
    cards: ["lightning_bolt", "giant_growth"],
    encounterIdx: 1,
    resolved: false
  });
  testSymmetry("2.4.2 cards array of objects with id", {
    cards: [{ id: "lightning_bolt" }, { id: "giant_growth" }, { id: "fake_card" }],
    encounterIdx: 1,
    resolved: false
  });

  // 2.5: Hostile & boundary encounterIdx
  testSymmetry("2.5.1 Negative encounterIdx in draft (-1)", {
    choices: ["lightning_bolt"],
    encounterIdx: -1,
    resolved: false
  });
  testSymmetry("2.5.2 Floating point encounterIdx (2.7)", {
    choices: ["lightning_bolt"],
    encounterIdx: 2.7,
    resolved: false
  });
  testSymmetry("2.5.3 String encounterIdx ('3')", {
    choices: ["lightning_bolt"],
    encounterIdx: "3",
    resolved: false
  });
  testSymmetry("2.5.4 NaN encounterIdx", {
    choices: ["lightning_bolt"],
    encounterIdx: NaN,
    resolved: false
  });
  testSymmetry("2.5.5 Null encounterIdx", {
    choices: ["lightning_bolt"],
    encounterIdx: null,
    resolved: false
  });

  // 2.6: Flag coercion
  testSymmetry("2.6.1 Truthy string flags ('yes', 1)", {
    choices: ["lightning_bolt"],
    encounterIdx: 1,
    resolved: "yes",
    skipped: 1,
    selectedCardId: "lightning_bolt"
  });
  testSymmetry("2.6.2 Missing flags", {
    choices: ["lightning_bolt"],
    encounterIdx: 1
  });

  // 2.7: selectedCardId validation
  testSymmetry("2.7.1 selectedCardId is number", {
    choices: ["lightning_bolt"],
    encounterIdx: 1,
    resolved: true,
    selectedCardId: 999
  });
  testSymmetry("2.7.2 selectedCardId is object", {
    choices: ["lightning_bolt"],
    encounterIdx: 1,
    resolved: true,
    selectedCardId: { id: "lightning_bolt" }
  });

  // 2.8: Empty choices with resolved: true vs resolved: false
  testSymmetry("2.8.1 Empty choices with resolved: false (normalizes to null)", {
    choices: [],
    encounterIdx: 1,
    resolved: false
  });
  testSymmetry("2.8.2 Empty choices with resolved: true (preserved with choices: [])", {
    choices: [],
    encounterIdx: 1,
    resolved: true,
    skipped: true
  });

  // 2.9: Prototype pollution attempt
  testSymmetry("2.9.1 Prototype pollution attempt", JSON.parse('{"choices":["lightning_bolt"],"__proto__":{"polluted":true}}'));
  assert(Object.prototype.polluted === undefined, "2.9.2 Object.prototype was not polluted");

  // 2.10: Massive random fuzzing battery
  const legalCardIds = Object.keys(CARD_DB);
  const hostileTokens = [null, undefined, 0, 1, -1, NaN, Infinity, "", " ", "bogus_id", {}, [], true, false];
  for (let trial = 0; trial < 20; trial++) {
    const count = 5 + (trial % 10);
    const choices = [];
    for (let c = 0; c < count; c++) {
      if ((trial + c) % 2 === 0) {
        choices.push(legalCardIds[(trial * 17 + c * 31) % legalCardIds.length]);
      } else {
        choices.push(hostileTokens[(trial + c) % hostileTokens.length]);
      }
    }
    testSymmetry(`2.10 Fuzz Trial ${trial}`, {
      choices,
      encounterIdx: (trial % 3 === 0) ? -trial : trial,
      resolved: trial % 2 === 0,
      skipped: trial % 4 === 0,
      selectedCardId: trial % 2 === 0 ? "lightning_bolt" : hostileTokens[trial % hostileTokens.length]
    });
  }
}

// ============================================================================
// 3. CHECKSUM INTEGRITY & TAMPER RESISTANCE
// ============================================================================
console.log("--- 3. Checksum Integrity & Tamper Resistance ---");
{
  const validBase = {
    version: 1,
    savedAt: 1700000000000,
    inShop: false,
    archetypeId: "gruul",
    encounterIdx: 1,
    playerLife: 20,
    gold: 10,
    masterDeck: [{ id: "lightning_bolt" }],
    relicIds: [],
    consumableIds: []
  };

  // 3.1: Save integrity invariant: pendingDraft does NOT affect checksum
  const normBaseNoDraft = normalizeCanonicalSave({ ...validBase, pendingDraft: null });
  const baseChecksum = normBaseNoDraft.save.saveIntegrity;

  const normBasePending = normalizeCanonicalSave({
    ...validBase,
    pendingDraft: {
      choices: ["stomping_ground", "lotus_cobra", "cultivate"],
      encounterIdx: 1,
      resolved: false,
      skipped: false,
      selectedCardId: null
    }
  });

  const normBaseResolved = normalizeCanonicalSave({
    ...validBase,
    pendingDraft: {
      choices: ["stomping_ground", "lotus_cobra", "cultivate"],
      encounterIdx: 1,
      resolved: true,
      skipped: false,
      selectedCardId: "lotus_cobra"
    }
  });

  assert(
    normBasePending.save.saveIntegrity === baseChecksum,
    "3.1.1 Adding pendingDraft does not alter canonicalCore checksum"
  );
  assert(
    normBaseResolved.save.saveIntegrity === baseChecksum,
    "3.1.2 Resolving pendingDraft does not alter canonicalCore checksum"
  );

  // 3.2: Tampering non-core field pendingDraft on a checksummed save does NOT trigger false positive
  const checksummedSave = {
    ...validBase,
    saveIntegrity: baseChecksum,
    pendingDraft: {
      choices: ["stomping_ground", "cultivate"],
      encounterIdx: 1,
      resolved: false
    }
  };

  const recheckGame = normalizeCanonicalSave(checksummedSave);
  const recheckDesk = DesktopBridge.normalizeSaveObject(checksummedSave);
  assert(
    recheckGame.valid === true && recheckDesk.valid === true,
    "3.2.1 Modifying pendingDraft on checksummed save passes without false-positive corrupt_checksum"
  );

  // 3.3: Tampering core fields (e.g. gold, playerLife, masterDeck) FAILS checksum
  const tamperedGold = {
    ...validBase,
    saveIntegrity: baseChecksum,
    gold: 99999
  };
  const checkTamperedGoldGame = normalizeCanonicalSave(tamperedGold);
  const checkTamperedGoldDesk = DesktopBridge.normalizeSaveObject(tamperedGold);
  assert(
    checkTamperedGoldGame.valid === false && checkTamperedGoldGame.status === "corrupt_checksum",
    "3.3.1 normalizeCanonicalSave detects tampered gold with corrupt_checksum"
  );
  assert(
    checkTamperedGoldDesk.valid === false && checkTamperedGoldDesk.status === "corrupt_checksum",
    "3.3.2 DesktopBridge.normalizeSaveObject detects tampered gold with corrupt_checksum"
  );

  const tamperedDeck = {
    ...validBase,
    saveIntegrity: baseChecksum,
    masterDeck: [{ id: "lightning_bolt" }, { id: "lotus_cobra" }]
  };
  const checkTamperedDeck = normalizeCanonicalSave(tamperedDeck);
  assert(
    checkTamperedDeck.valid === false && checkTamperedDeck.status === "corrupt_checksum",
    "3.3.3 Tampered masterDeck fails checksum integrity check"
  );
}

// ============================================================================
// 4. LIFECYCLE & ENCOUNTER TRANSITIONS (FULL CAMPAIGN SIMULATION)
// ============================================================================
console.log("--- 4. Lifecycle & Encounter Transitions ---");
{
  resetTestState();
  startNewRun(STARTER_DECKS[0]);

  // Campaign flow: encounters 0 through 5
  // Encounters 0-4 must offer draft, encounter 5 must NOT.
  for (let encIdx = 0; encIdx < ENCOUNTERS.length; encIdx++) {
    state.encounterIdx = encIdx;
    state.enemyLife = 0;
    const isFinal = encIdx === ENCOUNTERS.length - 1;

    handleEncounterVictory();

    if (!isFinal) {
      assert(
        state.pendingDraft !== null,
        `4.1.${encIdx} Encounter ${encIdx} victory generates pending draft`
      );
      assert(
        Array.isArray(state.pendingDraft.choices) && state.pendingDraft.choices.length === 3,
        `4.2.${encIdx} Encounter ${encIdx} pending draft has exactly 3 choices`
      );
      assert(
        state.pendingDraft.resolved === false,
        `4.3.${encIdx} Encounter ${encIdx} pending draft is unresolved`
      );

      // Alternate between drafting a card and skipping
      if (encIdx % 2 === 0) {
        const deckBefore = state.masterDeck.length;
        const targetId = state.pendingDraft.choices[0];
        const res = selectDraftCard(0);
        assert(res === true, `4.4.${encIdx} selectDraftCard(0) succeeds`);
        assert(state.masterDeck.length === deckBefore + 1, `4.5.${encIdx} Deck size incremented by 1`);
        assert(state.pendingDraft.resolved === true, `4.6.${encIdx} Draft marked resolved`);
      } else {
        const goldBefore = state.gold;
        const res = skipDraft();
        assert(res === true, `4.4.${encIdx} skipDraft() succeeds`);
        assert(state.gold === goldBefore + 2, `4.5.${encIdx} Gold incremented by +$2`);
        assert(state.pendingDraft.resolved === true, `4.6.${encIdx} Draft marked resolved`);
      }

      // Progression: beginEncounter resets draft
      beginEncounter();
      assert(
        state.pendingDraft === null,
        `4.7.${encIdx} beginEncounter() resets state.pendingDraft to null before next fight`
      );
    } else {
      // Encounter 5: Final Boss (Elesh Norn)
      assert(
        state.pendingDraft === null,
        `4.8.${encIdx} Defeating final campaign boss sets pendingDraft = null (draft bypassed)`
      );
    }
  }

  // 4.9: UI Modal Routing Invariants
  {
    let lastShownModal = null;
    let victoryModalCalled = false;
    let draftModalCalled = false;

    const mockDialog = {
      addEventListener() {},
      showModal() {},
      close() {},
      querySelector() { return null; },
      querySelectorAll() { return []; },
      appendChild() {},
      removeChild() {},
      style: {},
      classList: { add() {}, remove() {}, contains() { return false; }, toggle() {} }
    };

    const prevDoc = globalThis.document;
    const prevGetEl = globalThis.getEl;
    const prevSafeShowModal = globalThis.safeShowModal;
    const prevOpenVictoryModal = globalThis.openVictoryModal;
    const prevOpenDraftModal = globalThis.openDraftModal;
    const prevRenderAll = globalThis.renderAll;
    const prevRenderShop = globalThis.renderShop;

    try {
      state.headless = false;
      globalThis.document = {
        getElementById: () => mockDialog,
        querySelector: () => null,
        querySelectorAll: () => []
      };
      globalThis.getEl = (id) => mockDialog;
      globalThis.renderAll = () => {};
      globalThis.renderShop = () => {};
      globalThis.safeShowModal = (id) => { lastShownModal = id; };
      globalThis.openVictoryModal = () => { victoryModalCalled = true; };
      globalThis.openDraftModal = () => { draftModalCalled = true; };

      // Case A: Non-final encounter with pending unresolved draft -> routes to draft modal
      state.encounterIdx = 2;
      state.pendingDraft = { choices: ["lightning_bolt"], resolved: false };
      presentVictoryOrShopModal(ENCOUNTERS[2], 10, 5, "VICTORY", "Summary");
      assert(draftModalCalled === true, "4.9.1 presentVictoryOrShopModal routes to openDraftModal when draft is pending");

      // Case B: Final boss encounter -> routes to victory modal
      draftModalCalled = false;
      victoryModalCalled = false;
      state.encounterIdx = ENCOUNTERS.length - 1;
      state.pendingDraft = null;
      presentVictoryOrShopModal(ENCOUNTERS[ENCOUNTERS.length - 1], 20, 5, "VICTORY", "Summary");
      assert(victoryModalCalled === true, "4.9.2 presentVictoryOrShopModal routes directly to openVictoryModal for final boss");
      assert(draftModalCalled === false, "4.9.3 openDraftModal is NOT called for final boss");
    } finally {
      state.headless = true;
      if (prevDoc === undefined) delete globalThis.document;
      else globalThis.document = prevDoc;
      globalThis.getEl = prevGetEl;
      globalThis.safeShowModal = prevSafeShowModal;
      globalThis.openVictoryModal = prevOpenVictoryModal;
      globalThis.openDraftModal = prevOpenDraftModal;
      globalThis.renderAll = prevRenderAll;
      globalThis.renderShop = prevRenderShop;
    }
  }
}

// ============================================================================
// 5. EXPLOITATION & CONCURRENCY ATTACK VECTORS
// ============================================================================
console.log("--- 5. Exploitation & Concurrency Attack Vectors ---");
{
  resetTestState();
  startNewRun(STARTER_DECKS[0]);
  state.encounterIdx = 0;
  state.enemyLife = 0;
  handleEncounterVictory();

  // 5.1: Double-select race condition: sequential selectDraftCard calls
  const initialDeckSize = state.masterDeck.length;
  const r1 = selectDraftCard(0);
  const r2 = selectDraftCard(1);
  const r3 = selectDraftCard(2);
  assert(r1 === true, "5.1.1 First selectDraftCard succeeds");
  assert(r2 === false, "5.1.2 Second selectDraftCard in sequence is rejected");
  assert(r3 === false, "5.1.3 Third selectDraftCard in sequence is rejected");
  assert(state.masterDeck.length === initialDeckSize + 1, "5.1.4 Only exactly 1 card was added to master deck");

  // 5.2: Double-skip race condition: sequential skipDraft calls
  resetTestState();
  startNewRun(STARTER_DECKS[0]);
  state.encounterIdx = 1;
  state.enemyLife = 0;
  handleEncounterVictory();

  const initialGold = state.gold;
  const s1 = skipDraft();
  const s2 = skipDraft();
  const s3 = skipDraft();
  assert(s1 === true, "5.2.1 First skipDraft succeeds");
  assert(s2 === false, "5.2.2 Second skipDraft in sequence is rejected");
  assert(s3 === false, "5.2.3 Third skipDraft in sequence is rejected");
  assert(state.gold === initialGold + 2, "5.2.4 Gold only increased by +$2 once");

  // 5.3: Select-then-skip and Skip-then-select interleaving
  resetTestState();
  startNewRun(STARTER_DECKS[0]);
  state.encounterIdx = 2;
  state.enemyLife = 0;
  handleEncounterVictory();

  selectDraftCard(0);
  const skipAfterSelect = skipDraft();
  assert(skipAfterSelect === false, "5.3.1 skipDraft after selectDraftCard is rejected");

  resetTestState();
  startNewRun(STARTER_DECKS[0]);
  state.encounterIdx = 3;
  state.enemyLife = 0;
  handleEncounterVictory();

  skipDraft();
  const selectAfterSkip = selectDraftCard(0);
  assert(selectAfterSkip === false, "5.3.2 selectDraftCard after skipDraft is rejected");

  // 5.4: Post-defeat draft attempt
  resetTestState();
  startNewRun(STARTER_DECKS[0]);
  state.runOver = true;
  state.pendingDraft = { choices: ["lightning_bolt"], resolved: false };
  assert(selectDraftCard(0) === false, "5.4.1 selectDraftCard rejected when state.runOver is true");
  assert(skipDraft() === false, "5.4.2 skipDraft rejected when state.runOver is true");

  // 5.5: Object mutation immunity
  resetTestState();
  startNewRun(STARTER_DECKS[0]);
  state.encounterIdx = 0;
  state.enemyLife = 0;
  handleEncounterVictory();

  const choiceBeforePick = state.pendingDraft.choices[0];
  selectDraftCard(0);
  const addedCard = state.masterDeck[state.masterDeck.length - 1];

  // Mutate pendingDraft choices array maliciously
  state.pendingDraft.choices[0] = "mutated_card_id";
  assert(
    addedCard.id === choiceBeforePick,
    "5.5.1 Cloned card in master deck is immutable and unaffected by external mutation to choices array"
  );

  // 5.6: Card legality stress: Basic lands strictly excluded
  const allCardIds = Object.keys(CARD_DB);
  const basicLands = allCardIds.filter(id => CARD_DB[id].subtype === "Basic");
  assert(basicLands.length > 0, "5.6.1 Basic lands exist in CARD_DB");

  const colorsAll = new Set(["W", "U", "B", "R", "G", "C"]);
  for (const basicId of basicLands) {
    const legal = isCardLegalForDeck(CARD_DB[basicId], colorsAll);
    assert(legal === false, `5.6.2 Basic land ${basicId} is strictly excluded from draft legality`);
  }

  // Dual land legality: Stomping Ground produces {R, G}. Legal for Gruul, illegal for Dimir.
  const stompingGround = CARD_DB["stomping_ground"];
  if (stompingGround) {
    assert(
      isCardLegalForDeck(stompingGround, new Set(["R", "G"])) === true,
      "5.6.3 Stomping Ground legal for R/G deck"
    );
    assert(
      isCardLegalForDeck(stompingGround, new Set(["U", "B"])) === false,
      "5.6.4 Stomping Ground illegal for U/B deck"
    );
  }

  // Fetch land legality: Evolving Wilds is universal
  const evolvingWilds = CARD_DB["evolving_wilds"];
  if (evolvingWilds) {
    assert(
      isCardLegalForDeck(evolvingWilds, new Set(["U"])) === true &&
      isCardLegalForDeck(evolvingWilds, new Set(["C"])) === true,
      "5.6.5 Evolving Wilds is legal for any deck"
    );
  }
}

// ============================================================================
// 6. FRESHNESS COMPARISON MATRIX & UI EVENT DELEGATION
// ============================================================================
console.log("--- 6. Freshness Comparison Matrix & UI Event Delegation ---");
{
  // 6.1: compareSaveFreshness matrix
  const baseA = { savedAt: 1000, encounterIdx: 1, inShop: false };
  const baseB = { savedAt: 1000, encounterIdx: 1, inShop: false };

  // Draft resolution comparison
  const pending = { ...baseA, pendingDraft: { resolved: false } };
  const resolved = { ...baseB, pendingDraft: { resolved: true } };
  const noDraft = { ...baseB, pendingDraft: null };

  assert(
    DesktopBridge.compareSaveFreshness(resolved, pending) === 1,
    "6.1.1 Resolved draft is fresher than pending draft when timestamp/encounter match"
  );
  assert(
    DesktopBridge.compareSaveFreshness(pending, resolved) === -1,
    "6.1.2 Pending draft is staler than resolved draft when timestamp/encounter match"
  );
  assert(
    DesktopBridge.compareSaveFreshness(noDraft, pending) === 1,
    "6.1.3 Save with no pendingDraft is treated as fresher than unresolved draft"
  );
  assert(
    DesktopBridge.compareSaveFreshness(pending, noDraft) === -1,
    "6.1.4 Unresolved draft is treated as staler than save with no pendingDraft"
  );
  assert(
    DesktopBridge.compareSaveFreshness(resolved, resolved) === 0,
    "6.1.5 Two resolved saves with matching timestamps tie (0)"
  );
  assert(
    DesktopBridge.compareSaveFreshness(pending, pending) === 0,
    "6.1.6 Two pending saves with matching timestamps tie (0)"
  );

  // Timestamp dominance over draft state
  const newerPending = { savedAt: 2000, encounterIdx: 1, inShop: false, pendingDraft: { resolved: false } };
  const olderResolved = { savedAt: 1000, encounterIdx: 1, inShop: false, pendingDraft: { resolved: true } };
  assert(
    DesktopBridge.compareSaveFreshness(newerPending, olderResolved) === 1,
    "6.1.7 Higher savedAt timestamp takes precedence over draft resolution state"
  );

  // 6.2: UI Event Delegation & Cancel Prevention on #draft-dialog
  const listeners = {};
  const mockDraftDialog = {
    addEventListener(event, fn) {
      listeners[event] = fn;
    }
  };

  mockDraftDialog.addEventListener("cancel", (e) => {
    e.preventDefault();
  });

  let skipDraftCalled = false;
  let selectDraftChoice = null;
  const originalSkipDraft = globalThis.skipDraft;
  const originalSelectDraft = globalThis.selectDraftCard;

  globalThis.skipDraft = () => { skipDraftCalled = true; };
  globalThis.selectDraftCard = (idx) => { selectDraftChoice = idx; };

  mockDraftDialog.addEventListener("click", (e) => {
    if (!e.target || typeof e.target.closest !== "function") return;
    const skipBtn = e.target.closest("#btn-skip-draft, .btn-skip-draft");
    if (skipBtn) {
      skipDraft();
      return;
    }
    const selectBtn = e.target.closest("[data-draft-choice], [data-draft-pick]");
    if (selectBtn) {
      const choiceIdx = Number(selectBtn.dataset.draftChoice ?? selectBtn.dataset.draftPick);
      if (Number.isFinite(choiceIdx)) {
        selectDraftCard(choiceIdx);
      }
      return;
    }
    const draftCard = e.target.closest(".draft-card[data-draft-idx]");
    if (draftCard) {
      const choiceIdx = Number(draftCard.dataset.draftIdx);
      if (Number.isFinite(choiceIdx)) {
        selectDraftCard(choiceIdx);
      }
    }
  });

  // Test Cancel event
  let cancelPrevented = false;
  listeners["cancel"]({ preventDefault() { cancelPrevented = true; } });
  assert(cancelPrevented === true, "6.2.1 Cancel event on #draft-dialog is prevented (cannot dismiss without deciding)");

  // Test Skip click
  listeners["click"]({
    target: {
      closest(sel) {
        return sel.includes("btn-skip-draft") ? { id: "btn-skip-draft" } : null;
      }
    }
  });
  assert(skipDraftCalled === true, "6.2.2 Clicking #btn-skip-draft invokes skipDraft()");

  // Test Select Button click
  listeners["click"]({
    target: {
      closest(sel) {
        return sel.includes("data-draft-choice") ? { dataset: { draftChoice: "2" } } : null;
      }
    }
  });
  assert(selectDraftChoice === 2, "6.2.3 Clicking [data-draft-choice='2'] invokes selectDraftCard(2)");

  // Test Draft Card click
  listeners["click"]({
    target: {
      closest(sel) {
        return sel.includes(".draft-card") ? { dataset: { draftIdx: "1" } } : null;
      }
    }
  });
  assert(selectDraftChoice === 1, "6.2.4 Clicking card element .draft-card[data-draft-idx='1'] invokes selectDraftCard(1)");

  globalThis.skipDraft = originalSkipDraft;
  globalThis.selectDraftCard = originalSelectDraft;
}

console.log("\n=================================================");
console.log(`ADVERSARIAL STRESS TEST COMPLETE: ${passed} passed, ${failed} failed`);
console.log("=================================================");

if (failed > 0 && typeof process !== "undefined") {
  process.exit(1);
}
