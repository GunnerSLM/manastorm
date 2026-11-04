// MANASTORM — Unified Desktop Runtime Bridge (Tauri v2, Native macOS WKWebView & Web Fallback)
// Handles native disk save persistence, window/fullscreen management, UI scaling, and save backups.

const DESKTOP_SETTINGS_KEY = "manastorm_settings_v1";
const CANONICAL_SAVE_VERSION = 1;
const SAVE_BACKUP_KEY = "manastorm_saved_run_backup_v1";
const SAVE_CORRUPT_KEY = "manastorm_saved_run_corrupt_v1";

const DEFAULT_DESKTOP_SETTINGS = {
  uiScale: 100,
  motionMode: "system", // "system" | "full" | "reduced"
  fullscreen: false,
  confirmQuit: true
};

const VALID_UI_SCALES = [90, 100, 110, 120];
const VALID_MOTION_MODES = ["system", "full", "reduced"];

function getSafeStorage() {
  try {
    if (typeof localStorage !== "undefined" && localStorage && typeof localStorage.getItem === "function") {
      return localStorage;
    }
  } catch (_) {}
  return null;
}

// ============================================================================
// CANONICAL SAVE SCHEMA, INTEGRITY CHECKSUM & MIGRATION HELPERS
// ============================================================================

function computeSaveChecksum(saveObj) {
  if (!saveObj || typeof saveObj !== "object") return "fnv1a_00000000";
  const canonicalCore = {
    version: Number(saveObj.version) || CANONICAL_SAVE_VERSION,
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

function isValidEncounterSnapshotObject(snap) {
  if (!snap || typeof snap !== "object") return false;
  const requiredArrays = ["library", "hand", "graveyard", "playerLands", "playerCreatures", "enemyCreatures"];
  for (const field of requiredArrays) {
    if (!Array.isArray(snap[field])) return false;
  }
  if (snap.manaPool !== undefined && (!snap.manaPool || typeof snap.manaPool !== "object")) {
    return false;
  }
  return true;
}

function normalizeRouteObject(rawRoute, encounterIdx = 0, inShop = false) {
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

function migrateSaveObject(candidate) {
  if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) {
    return { ok: false, status: "invalid_type", error: "Save data must be a JSON object." };
  }

  const raw = candidate.format === "manastorm-save-backup" && candidate.save && typeof candidate.save === "object"
    ? candidate.save
    : candidate;

  let migrated = false;
  let working = { ...raw };

  // Support migrating legacy v0 / unversioned saves to canonical v1
  if (working.version === undefined || working.version === 0 || working.version === "1" || working.version === "1.0") {
    working.version = CANONICAL_SAVE_VERSION;
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

  if (working.version !== CANONICAL_SAVE_VERSION) {
    return {
      ok: false,
      status: "unsupported_version",
      error: `Invalid MANASTORM v1 save format or unsupported version (${String(working.version)}).`
    };
  }

  return { ok: true, save: working, migrated };
}

function normalizeSaveObject(candidate) {
  const migration = migrateSaveObject(candidate);
  if (!migration.ok) {
    return { valid: false, status: migration.status, error: migration.error };
  }

  const raw = migration.save;
  if (!Array.isArray(raw.masterDeck) || raw.masterDeck.length === 0) {
    return { valid: false, status: "empty_deck", error: "Invalid MANASTORM v1 save format or empty deck." };
  }

  const normalizedDeck = [];
  for (const item of raw.masterDeck) {
    const cardId = typeof item === "string" ? item : item?.id;
    if (!cardId) continue;
    if (typeof CARD_DB !== "undefined" && !CARD_DB[cardId]) continue;
    normalizedDeck.push({
      id: String(cardId),
      foil: (item && item.foil) || null,
      permPowerBonus: Number(item && item.permPowerBonus) || 0,
      permToughnessBonus: Number(item && item.permToughnessBonus) || 0,
      keywords: Array.isArray(item && item.keywords) ? [...item.keywords] : []
    });
  }

  if (normalizedDeck.length === 0) {
    return {
      valid: false,
      status: "unrecognized_cards",
      error: "Save deck contains no recognized MANASTORM cards."
    };
  }

  const relicIds = Array.isArray(raw.relicIds)
    ? raw.relicIds.filter(id => typeof id === "string" && (typeof RELIC_DB === "undefined" || RELIC_DB.some(r => r.id === id)))
    : (Array.isArray(raw.relics)
      ? raw.relics
          .map(r => (typeof r === "string" ? r : r?.id))
          .filter(id => typeof id === "string" && (typeof RELIC_DB === "undefined" || RELIC_DB.some(r => r.id === id)))
      : []);

  const consumableIds = Array.isArray(raw.consumableIds)
    ? raw.consumableIds.filter(id => typeof id === "string" && (typeof CONSUMABLE_DB === "undefined" || CONSUMABLE_DB.some(s => s.id === id)))
    : (Array.isArray(raw.consumables)
      ? raw.consumables
          .map(s => (typeof s === "string" ? s : s?.id))
          .filter(id => typeof id === "string" && (typeof CONSUMABLE_DB === "undefined" || CONSUMABLE_DB.some(s => s.id === id)))
      : []);

  const defaultArchId =
    (typeof STARTER_DECKS !== "undefined" && STARTER_DECKS[0] && STARTER_DECKS[0].id) || "gruul_landfall";
  const matchedArch =
    typeof STARTER_DECKS !== "undefined" && Array.isArray(STARTER_DECKS)
      ? STARTER_DECKS.find(d => d.id === raw.archetypeId)
      : null;
  const archetypeId = matchedArch ? matchedArch.id : String(raw.archetypeId || defaultArchId);

  const maxLifeCap = typeof MAX_LIFE !== "undefined" ? MAX_LIFE : 30;
  const startLifeDefault = typeof START_LIFE !== "undefined" ? START_LIFE : 20;
  const rawLife = Number(raw.playerLife);
  const playerLife = Number.isFinite(rawLife) && rawLife > 0
    ? Math.min(maxLifeCap, Math.max(1, Math.round(rawLife)))
    : startLifeDefault;

  const rawGold = Number(raw.gold);
  const gold = Number.isFinite(rawGold) && rawGold >= 0 ? Math.floor(rawGold) : 0;

  const rawEncIdx = Number(raw.encounterIdx);
  const encounterIdx = Number.isFinite(rawEncIdx) && rawEncIdx >= 0 ? Math.floor(rawEncIdx) : 0;
  const inShop = Boolean(raw.inShop);

  const encounterState = !inShop && isValidEncounterSnapshotObject(raw.encounterState)
    ? raw.encounterState
    : null;

  const shopStock = inShop && raw.shopStock && typeof raw.shopStock === "object"
    ? {
        relics: Array.isArray(raw.shopStock.relics) ? raw.shopStock.relics : [],
        cards: Array.isArray(raw.shopStock.cards) ? raw.shopStock.cards : [],
        upgrades: Array.isArray(raw.shopStock.upgrades) ? raw.shopStock.upgrades : []
      }
    : null;

  const route = normalizeRouteObject(raw.route, encounterIdx, inShop);

  let pendingDraft = null;
  if (raw.pendingDraft && typeof raw.pendingDraft === "object") {
    const rawChoices = Array.isArray(raw.pendingDraft.choices)
      ? raw.pendingDraft.choices
      : (Array.isArray(raw.pendingDraft.cards) ? raw.pendingDraft.cards : []);
    const validChoices = rawChoices
      .map(item => (typeof item === "string" ? item : (item && item.id ? item.id : null)))
      .filter(id => typeof id === "string" && id.length > 0 && (typeof CARD_DB === "undefined" || CARD_DB[id]));
    if (validChoices.length > 0 || raw.pendingDraft.resolved) {
      const encIdx = Number(raw.pendingDraft.encounterIdx);
      pendingDraft = {
        choices: validChoices,
        encounterIdx: Number.isFinite(encIdx) && encIdx >= 0 ? Math.floor(encIdx) : encounterIdx,
        resolved: Boolean(raw.pendingDraft.resolved),
        skipped: Boolean(raw.pendingDraft.skipped),
        selectedCardId: typeof raw.pendingDraft.selectedCardId === "string" ? raw.pendingDraft.selectedCardId : null
      };
    }
  }

  const canonicalSave = {
    version: CANONICAL_SAVE_VERSION,
    savedAt: Number.isFinite(Number(raw.savedAt)) && Number(raw.savedAt) > 0 ? Number(raw.savedAt) : 0,
    inShop,
    archetypeId,
    encounterIdx,
    playerLife,
    gold,
    masterDeck: normalizedDeck,
    relicIds,
    relics: relicIds.map(id => ({ id })),
    consumableIds,
    encounterState,
    shopStock,
    route,
    pendingDraft
  };

  const expectedChecksum = computeSaveChecksum(canonicalSave);
  if (typeof raw.saveIntegrity === "string" && raw.saveIntegrity.length > 0) {
    // Verify checksum against the input's own fields first so legitimate normalization doesn't false-positive,
    // while any tampering of core fields on a checksummed payload is caught immediately.
    const rawChecksum = computeSaveChecksum(raw);
    if (raw.saveIntegrity !== expectedChecksum && raw.saveIntegrity !== rawChecksum) {
      return {
        valid: false,
        status: "corrupt_checksum",
        error: "Save integrity check failed (corrupted or tampered save payload)."
      };
    }
  }
  canonicalSave.saveIntegrity = expectedChecksum;

  const archName =
    (matchedArch && matchedArch.badge) ||
    raw.archetypeId ||
    "Unknown Guild";

  return {
    valid: true,
    status: migration.migrated ? "migrated" : "ok",
    migrated: migration.migrated,
    save: canonicalSave,
    summary: {
      archetype: archName,
      encounter: encounterIdx + 1,
      playerLife,
      gold,
      deckSize: normalizedDeck.length,
      inShop
    }
  };
}

function compareSaveFreshness(candidateA, candidateB) {
  // Returns > 0 if A is newer/ahead of B, < 0 if B is newer/ahead of A, 0 if equivalent
  if (!candidateA && !candidateB) return 0;
  if (candidateA && !candidateB) return 1;
  if (!candidateA && candidateB) return -1;

  const timeA = Number(candidateA.savedAt) || 0;
  const timeB = Number(candidateB.savedAt) || 0;
  if (timeA > 0 && timeB > 0 && timeA !== timeB) {
    return timeA > timeB ? 1 : -1;
  }

  const encA = Number(candidateA.encounterIdx) || 0;
  const encB = Number(candidateB.encounterIdx) || 0;
  if (encA !== encB) {
    return encA > encB ? 1 : -1;
  }

  if (Boolean(candidateA.inShop) !== Boolean(candidateB.inShop)) {
    return candidateA.inShop ? 1 : -1;
  }

  const turnA = Number(candidateA.encounterState?.turn) || 0;
  const turnB = Number(candidateB.encounterState?.turn) || 0;
  if (turnA !== turnB) {
    return turnA > turnB ? 1 : -1;
  }

  const draftPendingA = Boolean(candidateA.pendingDraft && !candidateA.pendingDraft.resolved);
  const draftPendingB = Boolean(candidateB.pendingDraft && !candidateB.pendingDraft.resolved);
  if (draftPendingA !== draftPendingB) {
    return draftPendingA ? -1 : 1;
  }

  return 0;
}

const DesktopBridge = (() => {
  let currentSettings = { ...DEFAULT_DESKTOP_SETTINGS };
  let runtimeInfo = {
    runtime: "web",
    platform: "browser",
    version: "1.0.0",
    appDataDir: null,
    fullscreen: false
  };
  let lastWindowTitle = "";
  let ipcRequestId = 0;
  const pendingIpcMap = new Map();

  // --- Concern 1: Runtime Detection & Native IPC Transport ---
  function isHeadless() {
    if (typeof isHeadlessEnv === "function") return isHeadlessEnv();
    return typeof document === "undefined";
  }

  function detectRuntime() {
    if (typeof globalThis !== "undefined") {
      if (globalThis.__MANASTORM_NATIVE__ === true) {
        return "macos-native";
      }
      if (
        globalThis.webkit &&
        globalThis.webkit.messageHandlers &&
        globalThis.webkit.messageHandlers.manastormBridge
      ) {
        return "macos-native";
      }
      if (
        (globalThis.__TAURI_INTERNALS__ && typeof globalThis.__TAURI_INTERNALS__.invoke === "function") ||
        (globalThis.__TAURI__ && globalThis.__TAURI__.core && typeof globalThis.__TAURI__.core.invoke === "function")
      ) {
        return "tauri";
      }
    }
    return "web";
  }

  function isDesktopApp() {
    const rt = detectRuntime();
    return rt === "tauri" || rt === "macos-native";
  }

  if (typeof globalThis !== "undefined" && !globalThis.__MANASTORM_IPC_RESOLVE__) {
    globalThis.__MANASTORM_IPC_RESOLVE__ = (id, ok, resultOrError) => {
      const entry = pendingIpcMap.get(id);
      if (!entry) return;
      pendingIpcMap.delete(id);
      if (ok) {
        entry.resolve(resultOrError);
      } else {
        entry.reject(new Error(String(resultOrError || "Native IPC error")));
      }
    };
  }

  async function invokeNative(cmd, args = {}) {
    if (typeof globalThis !== "undefined") {
      if (globalThis.__TAURI_INTERNALS__ && typeof globalThis.__TAURI_INTERNALS__.invoke === "function") {
        return await globalThis.__TAURI_INTERNALS__.invoke(cmd, args);
      }
      if (
        globalThis.__TAURI__ &&
        globalThis.__TAURI__.core &&
        typeof globalThis.__TAURI__.core.invoke === "function"
      ) {
        return await globalThis.__TAURI__.core.invoke(cmd, args);
      }
      if (
        globalThis.webkit &&
        globalThis.webkit.messageHandlers &&
        globalThis.webkit.messageHandlers.manastormBridge
      ) {
        const id = ++ipcRequestId;
        return await new Promise((resolve, reject) => {
          pendingIpcMap.set(id, { resolve, reject });
          try {
            globalThis.webkit.messageHandlers.manastormBridge.postMessage({ id, cmd, args });
          } catch (err) {
            pendingIpcMap.delete(id);
            reject(err);
          }
        });
      }
    }
    return null;
  }

  function getRuntimeInfo() {
    return {
      ...runtimeInfo,
      runtime: detectRuntime(),
      isDesktop: isDesktopApp()
    };
  }

  // --- Concern 2: Settings Synchronization ---
  function sanitizeSettings(raw) {
    const base = { ...DEFAULT_DESKTOP_SETTINGS };
    if (!raw || typeof raw !== "object") return base;
    const scaleNum = Number(raw.uiScale);
    if (VALID_UI_SCALES.includes(scaleNum)) {
      base.uiScale = scaleNum;
    }
    if (VALID_MOTION_MODES.includes(raw.motionMode)) {
      base.motionMode = raw.motionMode;
    }
    if (typeof raw.fullscreen === "boolean") {
      base.fullscreen = raw.fullscreen;
    }
    if (typeof raw.confirmQuit === "boolean") {
      base.confirmQuit = raw.confirmQuit;
    }
    return base;
  }

  function applySettingsToEnvironment() {
    if (typeof state !== "undefined" && state) {
      state.motionPreference = currentSettings.motionMode;
    }
    if (isHeadless() || typeof document === "undefined") return;

    const root = document.documentElement;
    if (root && root.style && typeof root.style.setProperty === "function") {
      const scaleFactor = (currentSettings.uiScale / 100).toFixed(2);
      root.style.setProperty("--ui-scale", scaleFactor);
      if (typeof root.setAttribute === "function") {
        root.setAttribute("data-ui-scale", String(currentSettings.uiScale));
        root.setAttribute("data-motion-mode", currentSettings.motionMode);
      }
    }
    if (document.body && document.body.classList && typeof document.body.classList.toggle === "function") {
      document.body.classList.toggle("desktop-app-mode", isDesktopApp());
      document.body.classList.toggle("is-fullscreen", Boolean(currentSettings.fullscreen));
    }
  }

  function loadSettingsFromLocalStorage() {
    const storage = getSafeStorage();
    if (!storage) return { ...DEFAULT_DESKTOP_SETTINGS };
    try {
      const raw = storage.getItem(DESKTOP_SETTINGS_KEY);
      if (!raw) return { ...DEFAULT_DESKTOP_SETTINGS };
      return sanitizeSettings(JSON.parse(raw));
    } catch (_) {
      return { ...DEFAULT_DESKTOP_SETTINGS };
    }
  }

  function saveSettingsToLocalStorage(settings) {
    const storage = getSafeStorage();
    if (!storage) return;
    try {
      storage.setItem(DESKTOP_SETTINGS_KEY, JSON.stringify(settings));
    } catch (_) {}
  }

  async function syncSettingsToDisk(settings) {
    if (!isDesktopApp()) return false;
    try {
      const payload = JSON.stringify(settings);
      await invokeNative("desktop_write_settings", { payload });
      return true;
    } catch (_) {
      return false;
    }
  }

  function getSettings() {
    return { ...currentSettings };
  }

  async function updateSettings(partial) {
    currentSettings = sanitizeSettings({ ...currentSettings, ...(partial || {}) });
    saveSettingsToLocalStorage(currentSettings);
    applySettingsToEnvironment();
    await syncSettingsToDisk(currentSettings);
    if (!isHeadless() && typeof renderAll === "function" && typeof state !== "undefined" && state.masterDeck?.length) {
      renderAll();
    }
    return getSettings();
  }

  function stepUiScale(deltaSteps) {
    const idx = VALID_UI_SCALES.indexOf(currentSettings.uiScale);
    const curIdx = idx === -1 ? 1 : idx;
    const nextIdx = Math.max(0, Math.min(VALID_UI_SCALES.length - 1, curIdx + deltaSteps));
    return updateSettings({ uiScale: VALID_UI_SCALES[nextIdx] });
  }

  // --- Concern 3: Save Validation, Backup Preservation & Disk Sync ---
  function validateSaveObject(candidate) {
    return normalizeSaveObject(candidate);
  }

  function preserveCorruptSave(rawPayload, source = "localStorage") {
    const storage = getSafeStorage();
    if (!storage || !rawPayload) return false;
    try {
      const record = JSON.stringify({
        source,
        preservedAt: new Date().toISOString(),
        raw: typeof rawPayload === "string" ? rawPayload : JSON.stringify(rawPayload)
      });
      storage.setItem(SAVE_CORRUPT_KEY, record);
      return true;
    } catch (_) {
      return false;
    }
  }

  function saveKnownGoodBackup(serializedSave) {
    const storage = getSafeStorage();
    if (!storage || !serializedSave) return false;
    try {
      const parsed = typeof serializedSave === "string" ? JSON.parse(serializedSave) : serializedSave;
      const check = validateSaveObject(parsed);
      if (!check.valid) return false;
      storage.setItem(SAVE_BACKUP_KEY, JSON.stringify(check.save));
      return true;
    } catch (_) {
      return false;
    }
  }

  function getKnownGoodBackup() {
    const storage = getSafeStorage();
    if (!storage) return null;
    try {
      const raw = storage.getItem(SAVE_BACKUP_KEY);
      if (!raw) return null;
      const check = validateSaveObject(JSON.parse(raw));
      return check.valid ? check : null;
    } catch (_) {
      return null;
    }
  }

  async function syncSaveToDisk(payloadObjOrString) {
    if (!isDesktopApp()) return false;
    try {
      const parsed =
        typeof payloadObjOrString === "string"
          ? JSON.parse(payloadObjOrString)
          : payloadObjOrString;
      const check = validateSaveObject(parsed);
      if (!check.valid) return false;
      const payload = JSON.stringify(check.save);
      await invokeNative("desktop_write_save", { payload });
      return true;
    } catch (_) {
      return false;
    }
  }

  async function clearDiskSave() {
    if (!isDesktopApp()) return false;
    try {
      await invokeNative("desktop_clear_save", {});
      return true;
    } catch (_) {
      return false;
    }
  }

  function getActiveSaveSummary() {
    const storage = getSafeStorage();
    if (!storage || typeof SAVE_KEY === "undefined") return null;
    try {
      const raw = storage.getItem(SAVE_KEY);
      if (raw) {
        const check = validateSaveObject(JSON.parse(raw));
        if (check.valid) return check.summary;
      }
      const backup = getKnownGoodBackup();
      return backup ? backup.summary : null;
    } catch (_) {
      const backup = getKnownGoodBackup();
      return backup ? backup.summary : null;
    }
  }

  function exportSavePayload() {
    if (typeof state !== "undefined" && !state.runOver && typeof saveRunState === "function" && !isHeadless()) {
      const shopOpen = typeof isShopDialogOpen === "function"
        ? isShopDialogOpen()
        : Boolean(
            typeof document !== "undefined" &&
            document.getElementById &&
            document.getElementById("shop-dialog")?.open
          );
      saveRunState(shopOpen);
    }
    const storage = getSafeStorage();
    if (!storage || typeof SAVE_KEY === "undefined") return null;
    const raw = storage.getItem(SAVE_KEY) || storage.getItem(SAVE_BACKUP_KEY);
    if (!raw) return null;
    try {
      const saveObj = JSON.parse(raw);
      const check = validateSaveObject(saveObj);
      if (!check.valid) return null;
      const bundle = {
        format: "manastorm-save-backup",
        version: CANONICAL_SAVE_VERSION,
        exportedAt: new Date().toISOString(),
        runtime: detectRuntime(),
        summary: check.summary,
        save: check.save
      };
      return JSON.stringify(bundle, null, 2);
    } catch (_) {
      return null;
    }
  }

  async function importSavePayload(rawJsonString) {
    if (!rawJsonString || typeof rawJsonString !== "string") {
      return { ok: false, error: "Please provide a JSON save backup to import." };
    }
    let parsed;
    try {
      parsed = JSON.parse(rawJsonString.trim());
    } catch (_) {
      return { ok: false, error: "Save backup is not valid JSON." };
    }

    const check = validateSaveObject(parsed);
    if (!check.valid) {
      return { ok: false, error: check.error };
    }

    const storage = getSafeStorage();
    const previousSaveRaw = storage && typeof SAVE_KEY !== "undefined" ? storage.getItem(SAVE_KEY) : null;
    if (previousSaveRaw) {
      saveKnownGoodBackup(previousSaveRaw);
    }

    const normalizedJson = JSON.stringify(check.save);
    if (storage && typeof SAVE_KEY !== "undefined") {
      storage.setItem(SAVE_KEY, normalizedJson);
      saveKnownGoodBackup(normalizedJson);
    }
    await syncSaveToDisk(normalizedJson);

    if (!isHeadless() && typeof document !== "undefined" && typeof document.querySelectorAll === "function") {
      for (const dlg of document.querySelectorAll("dialog[open]")) {
        if (dlg.id !== "shop-dialog" || !check.save.inShop) {
          try { dlg.close(); } catch (_) {}
        }
      }
    }

    if (typeof loadRunState === "function") {
      const loaded = loadRunState({ allowHeadless: !isHeadless() });
      if (!loaded && !isHeadless()) {
        if (previousSaveRaw && storage && typeof SAVE_KEY !== "undefined") {
          storage.setItem(SAVE_KEY, previousSaveRaw);
        }
        return { ok: false, error: "Save passed validation but could not be hydrated." };
      }
    }

    return { ok: true, summary: check.summary };
  }

  async function reconcileSavesWithDisk() {
    const storage = getSafeStorage();
    const saveKey = typeof SAVE_KEY !== "undefined" ? SAVE_KEY : "manastorm_saved_run_v1";
    const rawLocalSave = storage ? storage.getItem(saveKey) : null;

    let localCheck = null;
    if (rawLocalSave) {
      try {
        localCheck = validateSaveObject(JSON.parse(rawLocalSave));
        if (!localCheck.valid) {
          preserveCorruptSave(rawLocalSave, "localStorage");
        }
      } catch (_) {
        preserveCorruptSave(rawLocalSave, "localStorage");
        localCheck = { valid: false, status: "corrupt_json", error: "Local save is not valid JSON." };
      }
    }

    let rawDiskSave = null;
    let diskCheck = null;
    if (isDesktopApp()) {
      try {
        rawDiskSave = await invokeNative("desktop_load_save", {});
      } catch (_) {
        rawDiskSave = null;
      }
      if (rawDiskSave && typeof rawDiskSave === "string") {
        try {
          diskCheck = validateSaveObject(JSON.parse(rawDiskSave));
          if (!diskCheck.valid) {
            preserveCorruptSave(rawDiskSave, "disk");
          }
        } catch (_) {
          preserveCorruptSave(rawDiskSave, "disk");
          diskCheck = { valid: false, status: "corrupt_json", error: "Disk save is not valid JSON." };
        }
      }
    }

    // Case 1: Both disk and local saves are valid
    if (diskCheck?.valid && localCheck?.valid) {
      const diskNormalized = JSON.stringify(diskCheck.save);
      const localNormalized = JSON.stringify(localCheck.save);
      const freshness = compareSaveFreshness(diskCheck.save, localCheck.save);

      if (freshness < 0) {
        // Local save is strictly newer than stale disk save: preserve disk in backup and update disk
        saveKnownGoodBackup(diskNormalized);
        if (storage) storage.setItem(saveKey, localNormalized);
        await syncSaveToDisk(localNormalized);
        return { restoredFromDisk: false, source: "local_newer", chosenSource: "localStorage" };
      }

      // Disk save is newer or differs from local
      if (diskNormalized !== rawLocalSave) {
        saveKnownGoodBackup(localNormalized);
        if (storage) storage.setItem(saveKey, diskNormalized);
        let restoredFromDisk = false;
        if (!isHeadless() && typeof loadRunState === "function") {
          restoredFromDisk = loadRunState();
        }
        return { restoredFromDisk, source: "disk", chosenSource: "disk" };
      }
      saveKnownGoodBackup(localNormalized);
      return { restoredFromDisk: false, source: "in_sync", chosenSource: "in_sync" };
    }

    // Case 2: Only disk save is valid (local is empty or corrupt)
    if (diskCheck?.valid && !localCheck?.valid) {
      const diskNormalized = JSON.stringify(diskCheck.save);
      if (storage) {
        storage.setItem(saveKey, diskNormalized);
        saveKnownGoodBackup(diskNormalized);
      }
      let restoredFromDisk = false;
      if (!isHeadless() && typeof loadRunState === "function") {
        restoredFromDisk = loadRunState();
      }
      return { restoredFromDisk, source: "disk_recovery", chosenSource: "disk" };
    }

    // Case 3: Only local save is valid (disk is empty or corrupt)
    if (localCheck?.valid && !diskCheck?.valid) {
      const localNormalized = JSON.stringify(localCheck.save);
      if (storage) {
        storage.setItem(saveKey, localNormalized);
        saveKnownGoodBackup(localNormalized);
      }
      await syncSaveToDisk(localNormalized);
      return { restoredFromDisk: false, source: "local_seeded_disk", chosenSource: "localStorage" };
    }

    // Case 4: Both primary saves missing or invalid -> check known-good backup
    const backupCheck = getKnownGoodBackup();
    if (backupCheck?.valid) {
      const backupNormalized = JSON.stringify(backupCheck.save);
      if (storage) {
        storage.setItem(saveKey, backupNormalized);
      }
      await syncSaveToDisk(backupNormalized);
      let restoredFromBackup = false;
      if (!isHeadless() && typeof loadRunState === "function") {
        restoredFromBackup = loadRunState();
      }
      return { restoredFromDisk: restoredFromBackup, source: "backup_recovery", chosenSource: "backup" };
    }

    return { restoredFromDisk: false, source: "none", chosenSource: "none" };
  }

  // --- Concern 4: Shell Integration (Fullscreen, Window Title, Menus, Quit) ---
  async function toggleFullscreen() {
    if (isDesktopApp()) {
      try {
        const res = await invokeNative("desktop_toggle_fullscreen", {});
        if (res && typeof res.fullscreen === "boolean") {
          currentSettings.fullscreen = res.fullscreen;
        } else {
          currentSettings.fullscreen = !currentSettings.fullscreen;
        }
        saveSettingsToLocalStorage(currentSettings);
        applySettingsToEnvironment();
        await syncSettingsToDisk(currentSettings);
        return currentSettings.fullscreen;
      } catch (_) {}
    }

    if (!isHeadless() && typeof document !== "undefined") {
      try {
        if (!document.fullscreenElement && document.documentElement?.requestFullscreen) {
          await document.documentElement.requestFullscreen();
          currentSettings.fullscreen = true;
        } else if (document.fullscreenElement && document.exitFullscreen) {
          await document.exitFullscreen();
          currentSettings.fullscreen = false;
        } else {
          currentSettings.fullscreen = !currentSettings.fullscreen;
        }
      } catch (_) {
        currentSettings.fullscreen = !currentSettings.fullscreen;
      }
      saveSettingsToLocalStorage(currentSettings);
      applySettingsToEnvironment();
    } else {
      currentSettings.fullscreen = !currentSettings.fullscreen;
    }
    return currentSettings.fullscreen;
  }

  async function setFullscreen(targetState) {
    const desired = Boolean(targetState);
    if (isDesktopApp()) {
      try {
        const res = await invokeNative("desktop_set_fullscreen", { fullscreen: desired });
        currentSettings.fullscreen = res && typeof res.fullscreen === "boolean" ? res.fullscreen : desired;
        saveSettingsToLocalStorage(currentSettings);
        applySettingsToEnvironment();
        await syncSettingsToDisk(currentSettings);
        return currentSettings.fullscreen;
      } catch (_) {}
    }
    currentSettings.fullscreen = desired;
    saveSettingsToLocalStorage(currentSettings);
    applySettingsToEnvironment();
    return currentSettings.fullscreen;
  }

  function formatWindowTitle(st) {
    if (!st || !st.deckArchetype) {
      return "MANASTORM — Tactical TCG Roguelike";
    }
    if (st.runOver) {
      return "MANASTORM — Run Ended • Choose a New Deck";
    }
    const enc = typeof getCurrentEncounter === "function" ? getCurrentEncounter() : null;
    const encName = enc ? enc.name : `Encounter ${(st.encounterIdx || 0) + 1}`;
    const planeNum = enc && enc.plane ? enc.plane : 1;
    const hp = `${st.playerLife ?? 20}/${typeof MAX_LIFE !== "undefined" ? MAX_LIFE : 30} HP`;
    const gold = `$${st.gold ?? 0}`;
    return `MANASTORM — Plane ${planeNum}: ${encName} (${hp} • ${gold})`;
  }

  function updateWindowTitle(st) {
    const nextTitle = formatWindowTitle(st);
    if (nextTitle === lastWindowTitle) return nextTitle;
    lastWindowTitle = nextTitle;

    if (!isHeadless() && typeof document !== "undefined") {
      document.title = nextTitle;
    }
    if (isDesktopApp()) {
      invokeNative("desktop_set_title", { title: nextTitle }).catch(() => {});
    }
    return nextTitle;
  }

  async function quitApp(force = false) {
    if (typeof state !== "undefined" && !state.runOver && typeof saveRunState === "function") {
      const shopOpen = typeof isShopDialogOpen === "function"
        ? isShopDialogOpen()
        : Boolean(
            !isHeadless() &&
            typeof document !== "undefined" &&
            document.getElementById &&
            document.getElementById("shop-dialog")?.open
          );
      saveRunState(shopOpen);
    }
    if (isDesktopApp()) {
      await invokeNative("desktop_quit_app", { force: Boolean(force) });
      return true;
    }
    if (!isHeadless() && typeof window !== "undefined" && typeof window.close === "function") {
      window.close();
    }
    return false;
  }

  function handleMenuAction(action) {
    if (isHeadless()) return;
    switch (action) {
      case "new-run":
        if (typeof openNewRunModal === "function" && typeof state !== "undefined") {
          openNewRunModal(Boolean(state.runOver));
        }
        break;
      case "view-library":
        if (typeof openDeckInspector === "function" && typeof state !== "undefined") {
          openDeckInspector(
            `Remaining Library (${state.library.length} Cards)`,
            "Cards currently remaining in your deck (shown in shuffled order). Fetch Lands and Cultivate let you search specific Basic Land colors out of here!",
            state.library
          );
        }
        break;
      case "view-graveyard":
        if (typeof openDeckInspector === "function" && typeof state !== "undefined") {
          openDeckInspector(
            `Graveyard (${state.graveyard.length} Cards)`,
            "Resolved Spells, cracked Fetch Lands, and fallen Creatures.",
            state.graveyard
          );
        }
        break;
      case "open-settings":
        if (typeof openDesktopSettingsModal === "function") {
          openDesktopSettingsModal();
        }
        break;
      case "toggle-fullscreen":
        toggleFullscreen();
        break;
      case "zoom-in":
        stepUiScale(1);
        break;
      case "zoom-out":
        stepUiScale(-1);
        break;
      case "zoom-reset":
        updateSettings({ uiScale: 100 });
        break;
      case "save-and-quit":
        quitApp(true);
        break;
      default:
        break;
    }
  }

  // Deterministic Startup Sequence: Load Settings -> Validate/Reconcile Saves -> Hydrate State -> Render
  async function init() {
    currentSettings = loadSettingsFromLocalStorage();
    runtimeInfo.runtime = detectRuntime();
    applySettingsToEnvironment();

    if (!isDesktopApp()) {
      // Even in web mode, validate local save / recover from backup if primary save was corrupted
      await reconcileSavesWithDisk();
      return { runtimeInfo: { ...runtimeInfo }, settings: getSettings(), restoredFromDisk: false };
    }

    try {
      const info = await invokeNative("desktop_get_info", {});
      if (info && typeof info === "object") {
        runtimeInfo = {
          ...runtimeInfo,
          ...info,
          runtime: info.runtime || detectRuntime()
        };
      }
    } catch (_) {}

    // Step 1: Hydrate settings from native disk if present
    try {
      const rawDiskSettings = await invokeNative("desktop_load_settings", {});
      if (rawDiskSettings && typeof rawDiskSettings === "string") {
        const diskSettings = sanitizeSettings(JSON.parse(rawDiskSettings));
        currentSettings = diskSettings;
        saveSettingsToLocalStorage(currentSettings);
        applySettingsToEnvironment();
      } else {
        await syncSettingsToDisk(currentSettings);
      }
    } catch (_) {}

    // Step 2: Validate and reconcile saves between native disk, localStorage, and backup
    let restoredFromDisk = false;
    try {
      const syncResult = await reconcileSavesWithDisk();
      restoredFromDisk = Boolean(syncResult.restoredFromDisk);
    } catch (_) {}

    return { runtimeInfo: { ...runtimeInfo }, settings: getSettings(), restoredFromDisk };
  }

  return {
    init,
    detectRuntime,
    isDesktopApp,
    getRuntimeInfo,
    invokeNative,
    getSettings,
    updateSettings,
    stepUiScale,
    syncSaveToDisk,
    clearDiskSave,
    computeSaveChecksum,
    migrateSaveObject,
    normalizeSaveObject,
    validateSaveObject,
    compareSaveFreshness,
    saveKnownGoodBackup,
    getKnownGoodBackup,
    preserveCorruptSave,
    reconcileSavesWithDisk,
    getActiveSaveSummary,
    exportSavePayload,
    importSavePayload,
    toggleFullscreen,
    setFullscreen,
    formatWindowTitle,
    updateWindowTitle,
    quitApp,
    handleMenuAction,
    VALID_UI_SCALES,
    VALID_MOTION_MODES
  };
})();

if (typeof globalThis !== "undefined") {
  globalThis.DesktopBridge = DesktopBridge;
  globalThis.ManastormMenuCommand = (action) => DesktopBridge.handleMenuAction(action);
  globalThis.computeSaveChecksum = computeSaveChecksum;
  globalThis.migrateSaveObject = migrateSaveObject;
  globalThis.normalizeSaveObject = normalizeSaveObject;
  globalThis.validateSaveObject = (c) => DesktopBridge.validateSaveObject(c);
  globalThis.compareSaveFreshness = compareSaveFreshness;
  globalThis.SAVE_BACKUP_KEY = SAVE_BACKUP_KEY;
  globalThis.SAVE_CORRUPT_KEY = SAVE_CORRUPT_KEY;
}
