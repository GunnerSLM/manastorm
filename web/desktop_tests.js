#!/usr/bin/env node
/**
 * MANASTORM — Desktop App (Tauri v2 & Native macOS WKWebView) Verification Suite
 * Tests Tauri v2 configuration, Rust command parity, icon binary headers,
 * frontend staging, DesktopBridge IPC/persistence/backups, and the compiled macOS .app binary.
 */

const fs = require("fs");
const os = require("os");
const path = require("path");
const vm = require("vm");
const { execFileSync } = require("child_process");
const { buildDist } = require("./scripts/build-dist");

const ROOT_DIR = __dirname;

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

console.log("=== BEGINNING MANASTORM DESKTOP APP VERIFICATION SUITE ===");

// ============================================================================
// 1. TAURI V2 CONFIGURATION, RUST COMMAND PARITY & ICON BINARY HEADERS
// ============================================================================
console.log("--- 1. Tauri v2 Configuration, Rust Command Parity & Icons ---");
{
  const tauriConfPath = path.join(ROOT_DIR, "src-tauri", "tauri.conf.json");
  assert(fs.existsSync(tauriConfPath), "1.1 src-tauri/tauri.conf.json exists");

  const tauriConf = JSON.parse(fs.readFileSync(tauriConfPath, "utf8"));
  assert(
    tauriConf.productName === "MANASTORM" &&
    tauriConf.identifier === "com.manastorm.tcg" &&
    tauriConf.build?.frontendDist === "../dist" &&
    tauriConf.app?.withGlobalTauri === true,
    "1.2 tauri.conf.json defines productName, identifier, frontendDist, and withGlobalTauri"
  );

  const mainWin = tauriConf.app?.windows?.[0];
  assert(
    mainWin && mainWin.width === 1440 && mainWin.height === 920 &&
    mainWin.minWidth === 1024 && mainWin.minHeight === 680 && mainWin.resizable === true,
    "1.3 tauri.conf.json configures main desktop window dimensions (1440x920, min 1024x680)"
  );

  const cargoToml = fs.readFileSync(path.join(ROOT_DIR, "src-tauri", "Cargo.toml"), "utf8");
  assert(
    cargoToml.includes('name = "manastorm-desktop"') &&
    cargoToml.includes('tauri = { version = "2"') &&
    cargoToml.includes('tauri-build = { version = "2"'),
    "1.4 src-tauri/Cargo.toml declares Tauri v2 dependencies"
  );

  const capJson = JSON.parse(
    fs.readFileSync(path.join(ROOT_DIR, "src-tauri", "capabilities", "default.json"), "utf8")
  );
  assert(
    Array.isArray(capJson.permissions) &&
    capJson.permissions.includes("core:window:allow-set-fullscreen") &&
    capJson.permissions.includes("core:window:allow-set-title"),
    "1.5 src-tauri/capabilities/default.json grants window fullscreen and title permissions"
  );

  const rustLib = fs.readFileSync(path.join(ROOT_DIR, "src-tauri", "src", "lib.rs"), "utf8");
  const objcMain = fs.readFileSync(path.join(ROOT_DIR, "src-tauri", "macos-native", "main.m"), "utf8");
  const expectedCommands = [
    "desktop_get_info",
    "desktop_load_save",
    "desktop_write_save",
    "desktop_clear_save",
    "desktop_load_settings",
    "desktop_write_settings",
    "desktop_toggle_fullscreen",
    "desktop_set_fullscreen",
    "desktop_set_title",
    "desktop_quit_app"
  ];
  for (const cmd of expectedCommands) {
    assert(
      rustLib.includes(`fn ${cmd}`) && objcMain.includes(`@"${cmd}"`),
      `1.6 Native IPC command '${cmd}' is implemented in both Tauri Rust (lib.rs) and macOS Objective-C (main.m)`
    );
  }

  // Verify PNG icons and dimensions
  const pngSpecs = [
    ["32x32.png", 32, 32],
    ["128x128.png", 128, 128],
    ["128x128@2x.png", 256, 256],
    ["icon.png", 1024, 1024]
  ];
  for (const [file, w, h] of pngSpecs) {
    const buf = fs.readFileSync(path.join(ROOT_DIR, "src-tauri", "icons", file));
    const isPng = buf[0] === 0x89 && buf.toString("ascii", 1, 4) === "PNG";
    const width = buf.readUInt32BE(16);
    const height = buf.readUInt32BE(20);
    assert(
      isPng && width === w && height === h,
      `1.7 Icon ${file} has valid PNG header and dimensions ${w}x${h} (got ${width}x${height})`
    );
  }

  const icnsBuf = fs.readFileSync(path.join(ROOT_DIR, "src-tauri", "icons", "icon.icns"));
  assert(
    icnsBuf.toString("ascii", 0, 4) === "icns" && icnsBuf.length > 10000,
    "1.8 icon.icns has valid 'icns' magic header and multi-resolution payload"
  );

  const icoBuf = fs.readFileSync(path.join(ROOT_DIR, "src-tauri", "icons", "icon.ico"));
  assert(
    icoBuf.readUInt16LE(0) === 0 && icoBuf.readUInt16LE(2) === 1 && icoBuf.readUInt16LE(4) === 4,
    "1.9 icon.ico has valid Windows ICO header with 4 embedded icon resolutions"
  );
}

// ============================================================================
// 2. FRONTEND DISTRIBUTION STAGING (scripts/build-dist.js)
// ============================================================================
console.log("--- 2. Frontend Distribution Staging (dist/) ---");
{
  const distDir = buildDist();
  const required = [
    "index.html",
    "style.css",
    "desktop.js",
    "game.js",
    "combat.js",
    "mana.js",
    "ui.js",
    "data/cards.js",
    "data/relics.js",
    "icon.png"
  ];
  for (const rel of required) {
    assert(
      fs.existsSync(path.join(distDir, rel)),
      `2.1 Staged dist/ contains runtime asset ${rel}`
    );
  }
  assert(
    !fs.existsSync(path.join(distDir, "tests.js")) &&
    !fs.existsSync(path.join(distDir, "adversarial_stress_test.js")) &&
    !fs.existsSync(path.join(distDir, "src-tauri")),
    "2.2 Staged dist/ excludes test suites and src-tauri build tree"
  );
}

// ============================================================================
// 3. DESKTOP BRIDGE, DISK PERSISTENCE, BACKUP & SETTINGS INTEGRATION
// ============================================================================
console.log("--- 3. DesktopBridge Runtime, Disk Save Sync, Backup & Settings ---");
{
  const storageMap = new Map();
  globalThis.localStorage = {
    getItem: (k) => (storageMap.has(k) ? storageMap.get(k) : null),
    setItem: (k, v) => storageMap.set(k, String(v)),
    removeItem: (k) => storageMap.delete(k),
    clear: () => storageMap.clear()
  };

  const load = (file) =>
    vm.runInThisContext(fs.readFileSync(path.join(ROOT_DIR, file), "utf8"), { filename: file });

  load("data/cards.js");
  load("data/relics.js");
  load("mana.js");
  load("combat.js");
  load("desktop.js");
  load("ui.js");
  load("game.js");

  state.headless = true;

  // 3.1 Default runtime is 'web' in standard environment
  assert(
    DesktopBridge.detectRuntime() === "web" && DesktopBridge.isDesktopApp() === false,
    "3.1 DesktopBridge detects 'web' runtime when no native bridge globals are present"
  );
  assert(
    DesktopBridge.getSettings().soundEnabled === false &&
    DesktopBridge.getSettings().soundVolume === 0.3,
    "3.1.1 Sound feedback is muted by default with a quiet persisted volume level"
  );

  const repairedRoute = DesktopBridge.normalizeSaveObject({
    version: CANONICAL_SAVE_VERSION,
    masterDeck: ["forest"],
    encounterIdx: 0,
    inShop: false,
    route: {
      loop: 9,
      currentNodeId: "p2_boss",
      completedNodeIds: [],
      visitedNodeIds: ["p1_start", "p2_boss"],
      pendingSelection: true
    }
  });
  assert(
    repairedRoute.valid &&
    repairedRoute.save.route.loop === 0 &&
    repairedRoute.save.route.currentNodeId === "p1_start" &&
    repairedRoute.save.route.completedNodeIds.length === 0 &&
    repairedRoute.save.route.visitedNodeIds.length === 1 &&
    repairedRoute.save.route.pendingSelection === false,
    "3.1.1 Desktop save normalization repairs impossible route histories"
  );

  // 3.2 Mock Tauri v2 __TAURI_INTERNALS__ runtime
  let diskSaveData = null;
  let diskSettingsData = null;
  let nativeFullscreen = false;
  let nativeWindowTitle = "";
  let nativeQuitCalled = false;

  globalThis.__TAURI_INTERNALS__ = {
    invoke: async (cmd, args = {}) => {
      switch (cmd) {
        case "desktop_get_info":
          return {
            runtime: "tauri",
            platform: "macos",
            version: "1.0.0",
            appDataDir: "/tmp/mock-tauri-data",
            fullscreen: nativeFullscreen
          };
        case "desktop_load_save":
          return diskSaveData;
        case "desktop_write_save":
          diskSaveData = args.payload;
          return { ok: true, bytes: (args.payload || "").length };
        case "desktop_clear_save":
          diskSaveData = null;
          return { ok: true, bytes: 0 };
        case "desktop_load_settings":
          return diskSettingsData;
        case "desktop_write_settings":
          diskSettingsData = args.payload;
          return { ok: true, bytes: (args.payload || "").length };
        case "desktop_toggle_fullscreen":
          nativeFullscreen = !nativeFullscreen;
          return { fullscreen: nativeFullscreen };
        case "desktop_set_fullscreen":
          nativeFullscreen = Boolean(args.fullscreen);
          return { fullscreen: nativeFullscreen };
        case "desktop_set_title":
          nativeWindowTitle = args.title || "";
          return { ok: true };
        case "desktop_quit_app":
          nativeQuitCalled = true;
          return { ok: true };
        default:
          throw new Error(`Unexpected command: ${cmd}`);
      }
    }
  };

  assert(
    DesktopBridge.detectRuntime() === "tauri" && DesktopBridge.isDesktopApp() === true,
    "3.2 DesktopBridge detects 'tauri' runtime when __TAURI_INTERNALS__.invoke is present"
  );

  // 3.3 Mock macOS native WKWebView runtime priority
  globalThis.__MANASTORM_NATIVE__ = true;
  assert(
    DesktopBridge.detectRuntime() === "macos-native" && DesktopBridge.isDesktopApp() === true,
    "3.3 DesktopBridge detects 'macos-native' runtime when __MANASTORM_NATIVE__ is set"
  );
  delete globalThis.__MANASTORM_NATIVE__;

  async function runAsyncDesktopTests() {
    // 3.4 Start a new run and verify saveRunState syncs to native disk
    startNewRun(STARTER_DECKS[1]); // Izzet Prowess & Storm
    state.encounterIdx = 2;
    state.playerLife = 24;
    state.gold = 19;

    // Temporarily allow saveRunState to run by providing minimal non-headless flag
    state.headless = false;
    globalThis.document = {
      documentElement: {
        style: { setProperty: () => {} },
        setAttribute: () => {}
      },
      body: {
        classList: { toggle: () => {} }
      },
      getElementById: () => null,
      querySelectorAll: () => []
    };

    saveRunState(false);
    // Allow microtask queue to flush async invoke
    await new Promise(r => setTimeout(r, 10));

    assert(
      typeof diskSaveData === "string" && diskSaveData.includes('"archetypeId":"red_storm"'),
      "3.4 saveRunState() automatically syncs serialized run state to native disk via desktop_write_save"
    );

    // 3.5 Export save backup and verify structure
    const exportedJson = DesktopBridge.exportSavePayload();
    const exportedObj = JSON.parse(exportedJson);
    assert(
      exportedObj.format === "manastorm-save-backup" &&
      exportedObj.summary.encounter === 3 &&
      exportedObj.summary.playerLife === 24 &&
      exportedObj.summary.gold === 19,
      "3.5 exportSavePayload() produces valid backup bundle with run summary metadata"
    );

    // 3.6 Clear run state and verify both localStorage and native disk save are cleared
    clearRunState();
    await new Promise(r => setTimeout(r, 10));
    assert(
      localStorage.getItem(SAVE_KEY) === null && diskSaveData === null,
      "3.6 clearRunState() removes save from both localStorage and native disk"
    );

    // 3.7 Import save backup and verify state hydration
    state.headless = true;
    startNewRun(STARTER_DECKS[0]); // Reset to Gruul encounter 0
    assert(state.encounterIdx === 0 && state.gold === 6, "3.7 Pre-import state reset to Gruul encounter 1");

    state.headless = false;
    const importRes = await DesktopBridge.importSavePayload(exportedJson);
    state.headless = true;
    assert(
      importRes.ok === true &&
      state.deckArchetype.id === "red_storm" &&
      state.encounterIdx === 2 &&
      state.playerLife === 24 &&
      state.gold === 19,
      "3.7 importSavePayload() validates and restores saved run into active game state and native disk"
    );

    // 3.8 Reject invalid save payloads cleanly
    const badRes1 = await DesktopBridge.importSavePayload("{not valid json");
    const badRes2 = await DesktopBridge.importSavePayload(JSON.stringify({ version: 99, masterDeck: [] }));
    assert(
      badRes1.ok === false && badRes2.ok === false,
      "3.8 importSavePayload() rejects corrupted JSON and invalid save schemas"
    );

    const generatedReward = sampleGeneratedCreature(state.deckArchetype.colors, 7654321);
    const generatedCandidate = createCanonicalSavePayload(true);
    delete generatedCandidate.saveIntegrity;
    generatedCandidate.masterDeck.push({
      id: generatedReward.id,
      generatedDefinition: generatedReward
    });
    const generatedCheck = DesktopBridge.normalizeSaveObject(generatedCandidate);
    state.headless = false;
    const generatedImport = await DesktopBridge.importSavePayload(JSON.stringify({
      format: "manastorm-save-backup",
      version: 1,
      save: generatedCheck.save
    }));
    state.headless = true;
    assert(
      generatedCheck.valid &&
      generatedImport.ok === true &&
      state.masterDeck.some(card => card.id === generatedReward.id && card.generated === true),
      "3.8.1 Desktop backup import restores generated creature definition into the active deck"
    );

    // 3.9 Native disk hydration on startup when localStorage is empty
    localStorage.removeItem(SAVE_KEY);
    state.encounterIdx = 0;
    state.gold = 1;
    state.headless = false;
    const initRes = await DesktopBridge.init();
    state.headless = true;
    assert(
      initRes.restoredFromDisk === true &&
      state.encounterIdx === 2 &&
      state.gold === 19,
      "3.9 DesktopBridge.init() hydrates run from native disk when WebView localStorage is empty"
    );

    // 3.10 Desktop Settings & prefersReducedMotion integration
    await DesktopBridge.updateSettings({ soundEnabled: true, soundVolume: 0.65 });
    const soundSettingsPersisted = typeof diskSettingsData === "string" &&
      diskSettingsData.includes('"soundEnabled":true') &&
      diskSettingsData.includes('"soundVolume":0.65');
    await DesktopBridge.updateSettings({ soundVolume: 1.5 });
    const soundVolumeClamped = DesktopBridge.getSettings().soundVolume === 1;
    await DesktopBridge.updateSettings({ soundEnabled: false, soundVolume: 0.3 });
    assert(
      soundSettingsPersisted &&
      soundVolumeClamped &&
      DesktopBridge.getSettings().soundEnabled === false,
      "3.10 Sound opt-in and volume persist, and volume is clamped to its supported range"
    );

    let audioContextsCreated = 0;
    let oscillatorsStarted = 0;
    const previousWindow = globalThis.window;
    globalThis.window = {
      AudioContext: class {
        constructor() {
          audioContextsCreated++;
          this.state = "suspended";
          this.currentTime = 0;
          this.destination = {};
        }
        createGain() {
          return {
            gain: {
              value: 0,
              cancelScheduledValues() {},
              setTargetAtTime() {},
              setValueAtTime() {},
              linearRampToValueAtTime() {},
              exponentialRampToValueAtTime() {}
            },
            connect() {}
          };
        }
        createOscillator() {
          return {
            frequency: { setValueAtTime() {} },
            connect() {},
            start() { oscillatorsStarted++; },
            stop() {}
          };
        }
        resume() {
          this.state = "running";
          return Promise.resolve();
        }
      }
    };
    state.headless = false;
    const mutedCueSuppressed = playSoundCue("cardPlay") === false && audioContextsCreated === 0;
    await DesktopBridge.updateSettings({ soundEnabled: true });
    const optedInCueAccepted = playSoundCue("cardPlay") === true;
    await new Promise(resolve => setTimeout(resolve, 0));
    const enabledCuePlayed = oscillatorsStarted === 1;
    await DesktopBridge.updateSettings({ soundEnabled: false });
    const mutedAgain = playSoundCue("manaTap") === false && oscillatorsStarted === 1;
    state.headless = true;
    if (previousWindow === undefined) delete globalThis.window;
    else globalThis.window = previousWindow;
    await DesktopBridge.updateSettings({ soundEnabled: false, soundVolume: 0.3 });
    assert(
      mutedCueSuppressed && optedInCueAccepted && enabledCuePlayed && mutedAgain,
      "3.10 Sound stays silent until opted in and immediately respects mute changes"
    );

    delete state.prefersReducedMotion;
    await DesktopBridge.updateSettings({ uiScale: 110, motionMode: "reduced" });
    assert(
      DesktopBridge.getSettings().uiScale === 110 &&
      prefersReducedMotion() === true &&
      typeof diskSettingsData === "string" &&
      diskSettingsData.includes('"uiScale":110'),
      "3.10 updateSettings() persists uiScale & motionMode='reduced' and activates prefersReducedMotion()"
    );

    await DesktopBridge.updateSettings({ motionMode: "full" });
    assert(
      prefersReducedMotion() === false,
      "3.10 motionMode='full' overrides prefersReducedMotion() to false"
    );

    await DesktopBridge.updateSettings({ combatSpeed: "normal" });
    const normalCombatDelay = getCombatAnimationDelay(420);
    await DesktopBridge.updateSettings({ combatSpeed: "fast" });
    const fastCombatDelay = getCombatAnimationDelay(420);
    const fastSettingsPersisted = typeof diskSettingsData === "string" &&
      diskSettingsData.includes('"combatSpeed":"fast"');
    await DesktopBridge.updateSettings({ combatSpeed: "instant" });
    const instantCombatDelay = getCombatAnimationDelay(420);
    await DesktopBridge.updateSettings({ motionMode: "reduced", combatSpeed: "fast" });
    const reducedMotionDelay = getCombatAnimationDelay(420);
    assert(
      normalCombatDelay === 420 &&
      fastCombatDelay === 189 &&
      instantCombatDelay === 0 &&
      reducedMotionDelay === 0 &&
      fastSettingsPersisted,
      "3.10 Combat speed settings persist, scale delays, and Reduced Motion always skips them"
    );

    const speedTestState = { ...state };
    const resolveAtSpeed = async (combatSpeed) => {
      await DesktopBridge.updateSettings({ motionMode: "full", combatSpeed });
      state.headless = true;
      state.encounterIdx = 0;
      state.runOver = false;
      state.combatLocked = false;
      state.runTurns = 0;
      state.turn = 1;
      state.maxTurns = 5;
      state.enemyLife = 1000;
      state.enemyMaxLife = 1000;
      state.playerLife = 20;
      state.turnResonance = 1;
      state.turnBurnPower = 0;
      state.playerLands = [];
      state.library = [];
      state.relics = [];
      state.playerCreatures = [{
        uid: "speed-test-attacker",
        name: "Speed Test Attacker",
        power: 4,
        toughness: 4,
        keywords: [],
        tempKeywords: [],
        attacking: true,
        summoningSick: false,
        count: 1
      }];
      state.enemyCreatures = [{
        uid: "speed-test-blocker",
        name: "Speed Test Blocker",
        power: 1,
        toughness: 1,
        keywords: [],
        frozen: false
      }];
      executeCombatAndEndTurn();
      return {
        enemyLife: state.enemyLife,
        playerLife: state.playerLife,
        turn: state.turn,
        runTurns: state.runTurns,
        runOver: state.runOver,
        playerCreatures: state.playerCreatures.map(creature => creature.name)
      };
    };
    const normalCombatOutcome = await resolveAtSpeed("normal");
    const instantCombatOutcome = await resolveAtSpeed("instant");
    assert(
      JSON.stringify(normalCombatOutcome) === JSON.stringify(instantCombatOutcome),
      "3.10 Combat presentation speed does not alter combat or turn outcomes"
    );
    await DesktopBridge.updateSettings({ motionMode: "full", combatSpeed: "normal" });
    Object.assign(state, speedTestState);

    await DesktopBridge.stepUiScale(1); // 110 -> 120
    assert(DesktopBridge.getSettings().uiScale === 120, "3.11 stepUiScale(1) steps from 110% to 120%");
    await DesktopBridge.stepUiScale(1); // clamped at 120
    assert(DesktopBridge.getSettings().uiScale === 120, "3.11 stepUiScale clamps at maximum 120%");

    // 3.12 Fullscreen toggle, dynamic window title & native quit
    const fsAfterToggle = await DesktopBridge.toggleFullscreen();
    assert(
      fsAfterToggle === true && nativeFullscreen === true,
      "3.12 toggleFullscreen() invokes native window fullscreen command"
    );

    const formattedTitle = DesktopBridge.updateWindowTitle(state);
    await new Promise(r => setTimeout(r, 10));
    assert(
      formattedTitle.includes("MANASTORM — Plane") &&
      formattedTitle.includes("24/30 HP") &&
      nativeWindowTitle === formattedTitle,
      `3.13 updateWindowTitle() formats encounter status and updates native window title (${formattedTitle})`
    );

    await DesktopBridge.quitApp(true);
    assert(nativeQuitCalled === true, "3.14 quitApp() saves run and invokes desktop_quit_app");

    delete globalThis.__TAURI_INTERNALS__;

    // 3.15 Test WKScriptMessageHandler (webkit.messageHandlers.manastormBridge) IPC round-trip
    globalThis.webkit = {
      messageHandlers: {
        manastormBridge: {
          postMessage(msg) {
            setTimeout(() => {
              if (msg.cmd === "desktop_get_info") {
                globalThis.__MANASTORM_IPC_RESOLVE__(msg.id, true, {
                  runtime: "macos-native",
                  platform: "macos",
                  version: "1.0.0",
                  appDataDir: "/tmp/mock-wkwebview",
                  fullscreen: false
                });
              } else if (msg.cmd === "desktop_write_settings") {
                globalThis.__MANASTORM_IPC_RESOLVE__(msg.id, true, { ok: true, bytes: 42 });
              }
            }, 2);
          }
        }
      }
    };
    const wkInfo = await DesktopBridge.invokeNative("desktop_get_info", {});
    assert(
      DesktopBridge.detectRuntime() === "macos-native" &&
      wkInfo && wkInfo.runtime === "macos-native" && wkInfo.appDataDir === "/tmp/mock-wkwebview",
      "3.15 WKScriptMessageHandler bridge resolves async native IPC calls cleanly"
    );

    // 3.16 Test Native Menu Bar command routing (zoom-reset, zoom-out, zoom-in)
    state.headless = false;
    globalThis.ManastormMenuCommand("zoom-reset");
    await new Promise(r => setTimeout(r, 10));
    assert(
      DesktopBridge.getSettings().uiScale === 100,
      "3.16 ManastormMenuCommand('zoom-reset') resets UI scale to 100%"
    );
    globalThis.ManastormMenuCommand("zoom-out");
    await new Promise(r => setTimeout(r, 10));
    assert(
      DesktopBridge.getSettings().uiScale === 90,
      "3.16 ManastormMenuCommand('zoom-out') steps UI scale to 90%"
    );
    state.headless = true;

    delete globalThis.webkit;

    // 3.17 - 3.21 Migration & Disk vs LocalStorage Disagreement Edge Cases
    globalThis.__TAURI_INTERNALS__ = {
      invoke: async (cmd, args = {}) => {
        switch (cmd) {
          case "desktop_get_info":
            return { runtime: "tauri", platform: "macos", version: "1.0.0", appDataDir: "/tmp/mock", fullscreen: false };
          case "desktop_load_save":
            return diskSaveData;
          case "desktop_write_save":
            diskSaveData = args.payload;
            return { ok: true, bytes: (args.payload || "").length };
          case "desktop_clear_save":
            diskSaveData = null;
            return { ok: true, bytes: 0 };
          case "desktop_load_settings":
            return diskSettingsData;
          case "desktop_write_settings":
            diskSettingsData = args.payload;
            return { ok: true, bytes: (args.payload || "").length };
          default:
            return { ok: true };
        }
      }
    };

    // 3.17 Empty localStorage + valid disk save
    localStorage.clear();
    diskSaveData = JSON.stringify({
      version: 1,
      savedAt: 1000,
      archetypeId: "gruul",
      encounterIdx: 1,
      playerLife: 22,
      gold: 12,
      masterDeck: [{ id: "forest" }, { id: "mountain" }]
    });
    const recEmptyLocal = await DesktopBridge.reconcileSavesWithDisk();
    assert(
      recEmptyLocal.chosenSource === "disk" &&
      localStorage.getItem(SAVE_KEY) !== null &&
      DesktopBridge.getKnownGoodBackup() !== null,
      "3.17 Empty localStorage + valid disk save: reconcileSavesWithDisk selects 'disk' and populates localStorage + backup"
    );

    // 3.18 Empty disk save + valid localStorage
    diskSaveData = null;
    const recEmptyDisk = await DesktopBridge.reconcileSavesWithDisk();
    await new Promise(r => setTimeout(r, 10));
    assert(
      recEmptyDisk.chosenSource === "localStorage" &&
      typeof diskSaveData === "string" &&
      diskSaveData.includes('"archetypeId":"gruul"'),
      "3.18 Empty disk save + valid localStorage: reconcileSavesWithDisk selects 'localStorage' and syncs to disk"
    );

    // 3.19 Mismatched versions: legacy v0 migration and v99 rejection
    const v0Migrated = DesktopBridge.normalizeSaveObject({
      version: 0,
      archetypeId: "gruul",
      deck: ["forest", "lightning_bolt"],
      relics: ["sol_ring"]
    });
    const v99Rejected = DesktopBridge.normalizeSaveObject({
      version: 99,
      masterDeck: [{ id: "forest" }]
    });
    assert(
      v0Migrated.valid === true &&
      v0Migrated.migrated === true &&
      v0Migrated.save.version === 1 &&
      v99Rejected.valid === false &&
      v99Rejected.status === "unsupported_version",
      "3.19 Mismatched save versions: legacy v0 migrates to v1 while unsupported v99 is rejected"
    );

    // 3.20 Corrupt disk JSON vs valid localStorage save
    const knownGoodBeforeCorrupt = DesktopBridge.getKnownGoodBackup();
    diskSaveData = "{corrupt_disk_json: true, truncated";
    const recCorruptDisk = await DesktopBridge.reconcileSavesWithDisk();
    await new Promise(r => setTimeout(r, 10));
    const preservedCorrupt = localStorage.getItem(SAVE_CORRUPT_KEY);
    assert(
      recCorruptDisk.chosenSource === "localStorage" &&
      Boolean(preservedCorrupt) &&
      preservedCorrupt.includes("corrupt_disk_json") &&
      JSON.stringify(DesktopBridge.getKnownGoodBackup()?.save) === JSON.stringify(knownGoodBeforeCorrupt?.save) &&
      typeof diskSaveData === "string" &&
      !diskSaveData.includes("corrupt_disk_json"),
      "3.20 Corrupt disk JSON is preserved in SAVE_CORRUPT_KEY without overwriting backup, and valid localStorage save repairs disk"
    );

    // 3.21 Stale disk data vs newer localStorage data
    const olderDiskSave = DesktopBridge.normalizeSaveObject({
      version: 1,
      savedAt: 1000,
      archetypeId: "gruul",
      encounterIdx: 1,
      playerLife: 20,
      gold: 8,
      masterDeck: [{ id: "forest" }]
    }).save;
    const newerLocalSave = DesktopBridge.normalizeSaveObject({
      version: 1,
      savedAt: 5000,
      archetypeId: "gruul",
      encounterIdx: 3,
      playerLife: 18,
      gold: 25,
      masterDeck: [{ id: "forest" }, { id: "mountain" }]
    }).save;
    diskSaveData = JSON.stringify(olderDiskSave);
    localStorage.setItem(SAVE_KEY, JSON.stringify(newerLocalSave));

    const recStaleDisk = await DesktopBridge.reconcileSavesWithDisk();
    await new Promise(r => setTimeout(r, 10));
    const parsedAfterStale = JSON.parse(localStorage.getItem(SAVE_KEY));
    const parsedDiskAfterStale = JSON.parse(diskSaveData);
    assert(
      recStaleDisk.chosenSource === "localStorage" &&
      parsedAfterStale.encounterIdx === 3 &&
      parsedAfterStale.gold === 25 &&
      parsedDiskAfterStale.encounterIdx === 3,
      "3.21 Stale disk save vs newer localStorage save: reconcileSavesWithDisk keeps newer localStorage progress and updates disk"
    );

    // 3.22 Preserve both corrupt primary saves and recover from the known-good backup
    const recoveryBackup = JSON.stringify(knownGoodBeforeCorrupt.save);
    localStorage.setItem(SAVE_BACKUP_KEY, recoveryBackup);
    localStorage.setItem(SAVE_KEY, "{corrupt_local_json");
    diskSaveData = "{corrupt_disk_json";
    const recBothCorrupt = await DesktopBridge.reconcileSavesWithDisk();
    const corruptArchive = JSON.parse(localStorage.getItem(SAVE_CORRUPT_KEY));
    const recoveredPrimary = JSON.parse(localStorage.getItem(SAVE_KEY));
    const recoveredDisk = JSON.parse(diskSaveData);
    assert(
      recBothCorrupt.chosenSource === "backup" &&
      corruptArchive.records.some(record => record.source === "localStorage" && record.raw === "{corrupt_local_json") &&
      corruptArchive.records.some(record => record.source === "disk" && record.raw === "{corrupt_disk_json") &&
      recoveredPrimary.encounterIdx === knownGoodBeforeCorrupt.save.encounterIdx &&
      recoveredDisk.encounterIdx === knownGoodBeforeCorrupt.save.encounterIdx,
      "3.22 Corrupt local and disk saves are both preserved while startup restores the known-good backup"
    );

    delete globalThis.__TAURI_INTERNALS__;
    delete globalThis.document;
  }

  // Execute async tests synchronously via top-level promise chain below
  globalThis.__runAsyncDesktopTests = runAsyncDesktopTests;
}

// ============================================================================
// 4. NATIVE MACOS APPLICATION BUNDLE & BINARY SELF-TEST
// ============================================================================
async function main() {
  await globalThis.__runAsyncDesktopTests();

  console.log("--- 4. Native macOS Application Bundle (MANASTORM.app) Self-Test ---");
  const appBundle = path.join(ROOT_DIR, "dist-macos", "MANASTORM.app");
  const binPath = path.join(appBundle, "Contents", "MacOS", "MANASTORM");
  const plistPath = path.join(appBundle, "Contents", "Info.plist");

  assert(fs.existsSync(binPath), "4.1 Compiled native binary dist-macos/MANASTORM.app/Contents/MacOS/MANASTORM exists");
  assert(fs.existsSync(plistPath), "4.2 dist-macos/MANASTORM.app/Contents/Info.plist exists");

  const tempDataDir = fs.mkdtempSync(path.join(os.tmpdir(), "manastorm-desktop-test-"));
  try {
    const stdout = execFileSync(binPath, ["--self-test", "--data-dir", tempDataDir], {
      encoding: "utf8"
    });
    const report = JSON.parse(stdout.trim());
    assert(
      report.ok === true &&
      report.runtime === "macos-native" &&
      report.verifiedAssets === 9,
      `4.3 Native macOS binary --self-test passed (${stdout.trim()})`
    );
  } catch (err) {
    assert(false, `4.3 Native macOS binary --self-test failed: ${err.message}`);
  } finally {
    fs.rmSync(tempDataDir, { recursive: true, force: true });
  }

  console.log("\n=================================================");
  console.log(`DESKTOP APP VERIFICATION COMPLETE: ${passed} passed, ${failed} failed`);
  console.log("=================================================");
  if (failed > 0) {
    process.exit(1);
  }
}

main();
