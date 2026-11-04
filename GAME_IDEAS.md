# MANASTORM — Ideas for Future Game Features

This guide turns possible additions into implementation outlines that fit the current run loop: build a deck, fight an encounter, collect rewards, visit the shop, and continue the campaign.

## Gameplay and Builds

### 1. More starter decks

Add decks with play patterns that differ from the current landfall, spellstorm, reanimator, and lifegain strategies—for example, an artifact/colorless deck or a dedicated graveyard deck.

**Implementation**
- Add card definitions to [`data/cards.js`](./data/cards.js), including effects only where the current effect system cannot express the mechanic.
- Add each deck to `STARTER_DECKS` with a legal card list, colors, starting relic, and description.
- Add a targeted test that checks deck size, card IDs, and starting relic validity. Run the campaign simulator to check that the new deck is viable.
- If unlocks are added later, keep deck availability separate from deck definitions so all decks remain testable.

### 2. Branching encounter map

Let players choose their next stop instead of following the same fixed ladder. Possible nodes include a normal fight, elite, shop, rest site, or event.

**Implementation**
- Represent a route as run data: node IDs, node types, connections, and the node currently being visited. Keep encounter definitions in [`data/cards.js`](./data/cards.js) or move campaign-specific definitions into a dedicated data module if the route grows.
- Add a route-selection dialog or screen in [`index.html`](./index.html), with rendering and input handling in [`ui.js`](./ui.js).
- Extend [`game.js`](./game.js) to resolve a selected node and transition to its activity; preserve the selected route in save snapshots so continuing a run restores the same choices.
- Add tests for route reachability, invalid choices, save/restore, and completing a node exactly once.
- Start with a small fixed graph; procedural map generation can follow once the route rules are stable.

### 3. Post-battle card draft

Offer a small set of cards after a victory and let the player choose one to add to their deck (or skip). This gives a reward alternative to spending gold in the shop.

**Implementation**
- Build a deterministic, testable reward-pool function that samples legal cards using the current deck colors and card type.
- Add the reward choice to the existing victory flow in [`ui.js`](./ui.js) and add the chosen card to `state.masterDeck` in [`game.js`](./game.js).
- Define whether the draft happens before or after a shop and whether skipping grants any compensation; represent that decision explicitly in the run state.
- Test that a selected card is added once, skipping makes no deck changes, and a restored victory/reward state cannot grant duplicate cards.

### 4. More boss rules and encounter modifiers

Add encounters that change strategic priorities, such as a limited-land-drop fight, escalating hazards, or blockers that strengthen if left alive.

**Implementation**
- Prefer declarative encounter properties and narrowly scoped combat hooks over boss-name checks scattered through the game.
- Add the rule text and spawn configuration beside existing entries in [`data/cards.js`](./data/cards.js); implement rule resolution in [`game.js`](./game.js) and damage/blocker logic in [`combat.js`](./combat.js).
- Show any state-changing rule clearly in the boss panel and combat preview in [`ui.js`](./ui.js).
- Add isolated combat tests for each rule and include the new encounter in balance simulations via [`sim.js`](./sim.js).

### 5. Card evolution and upgrades

Let players improve a chosen card between encounters, with a meaningful choice such as increased stats versus a changed effect.

**Implementation**
- Define upgrade choices as data and store the selected upgrade on the card instance in `state.masterDeck`; do not mutate the shared base definition in `CARD_DB`.
- Reuse or extend the post-battle and shop upgrade flows in [`game.js`](./game.js) and [`ui.js`](./ui.js).
- Ensure upgraded card data survives run save/export/import in [`game.js`](./game.js) and [`desktop.js`](./desktop.js).
- Test choosing either path, invalid targets, repeated upgrades, and save/restore. Simulate the resulting power increase before setting prices or limits.

## Run Variety and Progression

### 6. Challenge modes

Offer optional run modifiers such as fewer turns, restricted colors, stronger enemy waves, or a starting bonus paired with a drawback.

**Implementation**
- Store a challenge ID and its parameters in run state, then apply modifiers at run or encounter initialization in [`game.js`](./game.js).
- Add a challenge selector to the new-run flow in [`ui.js`](./ui.js), and display active modifiers near the boss/run status in [`index.html`](./index.html).
- Keep modifiers data-driven where possible and make sure all effects are included in combat previews.
- Test that a challenge does not leak into a later standard run and that saved runs resume with the same rules.

### 7. Persistent unlocks

Unlock starter decks, cards, relics, or cosmetic finishes through achievements or campaign milestones.

**Implementation**
- Keep meta-progression separate from the current-run save fields; store unlocks in a versioned profile save.
- Add explicit unlock requirements and a single validation path before offering locked content in [`ui.js`](./ui.js).
- Update the new-run/deck selection UI and provide clear progress feedback.
- Test fresh profiles, unlock grant conditions, duplicate grants, and corrupted or older profile data. Avoid making essential cards dependent on grind.

### 8. Risk/reward events

Add non-combat stops with choices such as trading life for gold, removing a card, taking a relic with a drawback, or healing at a cost.

**Implementation**
- Define event choices as data with a description, eligibility conditions, and explicit effects.
- Reuse modal patterns from [`ui.js`](./ui.js); apply validated effects in [`game.js`](./game.js), not directly in UI event handlers.
- Save event identity and resolution status to prevent a reload from repeating a reward or penalty.
- Test each choice's resource changes, unavailable-choice handling, skip behavior, and restore behavior.

### 9. Alternate campaign routes and final bosses

Give runs different endpoints and themes, instead of only repeating the same encounter sequence with increased life.

**Implementation**
- Introduce route/campaign definitions that reference encounter IDs, rewards, and endings; keep the existing encounter ladder as the default route.
- Make campaign progression explicit in run state and update the ladder rendering in [`ui.js`](./ui.js).
- Add route completion and final-boss tests, including resuming a saved run at the last node.
- Use the simulator to compare route length and expected difficulty before adding many branches.

## Quality of Life and Replayability

### 10. Run history

Record completed runs with the selected deck, route, challenges, relics, turns, and outcome.

**Implementation**
- Create a compact, versioned run-summary record when a run ends; avoid storing full combat state or card-by-card event logs unless needed.
- Add a history dialog and summary renderer in [`index.html`](./index.html) and [`ui.js`](./ui.js).
- Use bounded local storage and handle unavailable or invalid storage using the existing persistence conventions in [`game.js`](./game.js) and [`desktop.js`](./desktop.js).
- Test victories, defeats, history limits, and malformed history data.

### 11. Card collection and library browser

Provide a searchable catalog with filters for color, type, and rules text, optionally showing locked cards.

**Implementation**
- Build the catalog from `CARD_DB` in [`data/cards.js`](./data/cards.js), with filtering and sorting kept separate from combat state.
- Add a dedicated library dialog in [`index.html`](./index.html) and render results through [`ui.js`](./ui.js), reusing the existing card presentation and inspector where practical.
- Include keyboard-accessible filters and an empty-results state.
- Test filtering and sorting as pure functions so browsing does not modify the active deck or run.

### 12. Battle speed controls and combat log

Allow players to shorten or disable animation delays and review a concise record of casts, triggers, blockers, damage, and end-of-turn effects.

**Implementation**
- Add a small speed setting to the existing settings UI; respect reduced-motion preferences regardless of the selected speed.
- Emit structured combat events from [`game.js`](./game.js) and [`combat.js`](./combat.js), then let [`ui.js`](./ui.js) render them as readable log entries.
- Keep the log bounded per encounter and ensure logging is observational—it must not alter game resolution.
- Test event ordering and verify that speed settings do not change game outcomes.

### 13. Daily and seeded runs

Let players start a run from a shared seed so they can compare decisions under the same generated conditions.

**Implementation**
- Add a seeded random-number generator and route all randomness used for shuffle, rewards, and procedural choices through it. Keep an unseeded mode for ordinary runs.
- Store the seed and RNG state in the run save so a reload does not change future draws or rewards.
- Add a seed entry/share control to the new-run UI in [`ui.js`](./ui.js).
- Test repeatability across identical seeds, divergence across different seeds, and continuity after save/restore. Consider daily seed selection as a later UI/service feature; a local seed-based mode needs no online service.

## Suggested Implementation Order

1. **Card drafts** — builds on the existing victory and shop rewards with limited changes to campaign structure.
2. **Card evolution** — extends existing deck and upgrade data, with save compatibility as the main risk to manage.
3. **Branching encounter map** — adds substantial run-choice depth; establish its save schema before introducing events and rest nodes.
4. **Boss modifiers and challenge modes** — add incrementally and validate with combat tests and [`sim.js`](./sim.js).
5. **Seeded runs, history, and the collection browser** — add replayability and usability without changing the combat loop.
6. **Persistent unlocks and alternate campaigns** — consider after the underlying run and profile data formats are stable.

## General Implementation Notes

- Preserve the separation between game rules/state ([`game.js`](./game.js), [`combat.js`](./combat.js)), content data ([`data/cards.js`](./data/cards.js), [`data/relics.js`](./data/relics.js)), and presentation ([`ui.js`](./ui.js), [`index.html`](./index.html)).
- Any feature that changes a run must define how it is serialized, restored, and validated. Add migration coverage when save formats change.
- Add focused unit tests in [`tests.js`](./tests.js); update [`desktop_tests.js`](./desktop_tests.js) when desktop save/import behavior changes.
- Run `npm test` for the full suite and `npm run sim` (or `node sim.js`) when a feature affects campaign difficulty or rewards.
