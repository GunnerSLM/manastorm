# MANASTORM Fixes and Improvements

This document captures the main issues and improvement opportunities identified in the current codebase. The goal is to increase reliability, resilience, and maintainability without changing the core game loop or user experience unexpectedly.

## High Priority

### 1) Harden save loading and recovery

Files involved: [game.js](./game.js), [desktop.js](./desktop.js)

Current risk:
- Save validation exists, but restore logic is spread across multiple places and can silently fail.
- `saveRunState()` writes a partial payload with `masterDeck`, `relics`, and `encounterState`, but the restore path assumes a strict structure and silently falls back to `beginEncounter()`.
- `loadRunState()` can recover from disk storage, but there is no single canonical save schema that is treated as the source of truth across browser/localStorage/native disk states.

Recommended fix:
- Define one canonical save schema and normalize every import path into it before save/restore.
- Add a clear recovery strategy: if validation fails, keep the last known-good backup and avoid wiping progress.
- Add explicit logging and a UI-safe fallback state when restore fails instead of silently starting a fresh run.
- Consider saving a versioned backup alongside the active save, which makes corruption recovery much easier.

### 2) Avoid silent save corruption

Files involved: [desktop.js](./desktop.js), [game.js](./game.js)

Current risk:
- `validateSaveObject()` checks structure, but the app can still continue with partially valid objects or mismatched runtime data.
- The current code compares normalized save JSON to `localStorage`, but it does not clearly differentiate between corrupted data, stale data, and intentionally older save versions.

Recommended fix:
- Keep a backup save entry and a migration path for older versions.
- If a save fails validation, do not overwrite the backup immediately; preserve the original and prompt the player to restore a known good state.
- Add a `saveIntegrity` check or checksum where practical.

### 3) Simplify desktop runtime synchronization

Files involved: [desktop.js](./desktop.js)

Current risk:
- The desktop bridge handles local storage hydration, native disk save sync, full-screen state, settings persistence, and window-title updates.
- The init flow does both "check disk, seed localStorage" and "hydrate from disk" in a way that can race with app state initialization.
- The logic is resilient but difficult to reason about and test because state is shared across multiple scopes.

Recommended fix:
- Split the bridge into smaller concerns: settings sync, save sync, runtime detection, and shell integration.
- Use a single startup sequence with deterministic ordering: load settings -> validate saves -> hydrate state -> render.
- Add explicit unit tests for migration edge cases: empty localStorage, empty disk save, mismatched versions, corrupt JSON, and stale data.

## Medium Priority

### 4) Reduce drag-state complexity and pointer race conditions

File involved: [ui.js](./ui.js)

Current risk:
- The drag system tracks pointer IDs and card state across multiple listeners and lifecycle events.
- Race conditions are likely in edge cases like multi-pointer interactions, invalid drops, interrupted drags, and reduced-motion snapbacks.
- Validated harnesses exist, but the logic is still dense and hard to maintain.

Recommended fix:
- Centralize drag state into one object with explicit states such as `idle`, `dragging`, `snapback`, `dropped`, `cancelled`.
- Replace repeated manual cleanup with a single `resetDragState()` routine.
- Normalize pointer handling so that pointer capture, release, and invalid-drop cleanup follow the same path.
- Keep all drag suppression rules in one place to minimize cross-interaction bugs.

### 5) Improve DOM safety and lifecycle cleanup

Files involved: [ui.js](./ui.js), [game.js](./game.js)

Current risk:
- The code references DOM elements repeatedly without consistently guarding against missing nodes.
- A few flows assume a dialog or panel is present during restore or state transitions, which can break in tests or when the app boots in different environments.

Recommended fix:
- Add a small DOM helper that safely reads and updates elements by id and returns null when absent.
- Centralize element lookup and null checks so UI rendering is less brittle.
- Add defensive `try/catch` guards around modal open/close, text updates, or render calls that assume DOM layout is always ready.

### 6) Reduce repeated expensive render work

Files involved: [ui.js](./ui.js), [game.js](./game.js)

Current risk:
- Rendering appears to be triggered from several state changes and event handlers, which can make the UI expensive during drag or animation-heavy operations.
- A few code paths trigger full rerenders after a save restore or dialog update even when only a subset of data changed.

Recommended fix:
- Introduce a small render scheduler or batching layer so repeated updates are collapsed into a single pass.
- Split full state render from incremental UI updates (e.g., hand layout, combat summary, toolbar state, and deck state).
- Use targeted updates instead of re-rendering the whole UI for every event.

## Lower Priority / Maintainability

### 7) Consolidate game state access patterns

Files involved: [game.js](./game.js), [ui.js](./ui.js)

Current risk:
- State mutation and UI effect logic are spread across multiple modules, which increases the chance of stale data or inconsistent reads.
- Some functions rely on global state assumptions without a clear ownership model.

Recommended fix:
- Define a clear state owner and public state update functions.
- Keep direct DOM mutation limited to UI layer code and avoid reaching into render logic from deep game routines.
- Use a state snapshot pattern for persistence and restore flows to minimize partial mutation errors.

### 8) Improve test coverage around edge cases

Files involved: [tests.js](./tests.js), [desktop_tests.js](./desktop_tests.js), [adversarial_stress_test.js](./adversarial_stress_test.js)

Current risk:
- The project has a strong test suite, but the most fragile areas are around save recovery, desktop sync, and pointer interruption paths.
- Some edge-case failures are likely undercovered because they only appear during unusual timing or environment transitions.

Recommended fix:
- Add cases for invalid save JSON, partial save payloads, disk/localStorage disagreement, interrupted pointer capture, and restore-after-run-over flows.
- Include a minimal randomized stress test for repeated save/restore cycles.

## Suggested Execution Order

1. Save schema normalization and recovery
2. Desktop sync lifecycle cleanup
3. Drag-state refactor and pointer race fixes
4. DOM safety cleanup
5. Render batching and optimization
6. Broader maintainability cleanup

## Summary

The biggest issues are not major conceptual flaws in the game design, but reliability and maintainability problems in state handling, save recovery, and interaction lifecycle management. If these are addressed first, the project will be much easier to evolve safely while reducing bug risk during real gameplay and desktop runtime transitions.
