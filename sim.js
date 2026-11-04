// MANASTORM — Headless Balance Simulator & Relic Impact Analyzer
// Run with: node sim.js  OR  /System/Library/Frameworks/JavaScriptCore.framework/Versions/A/Helpers/jsc sim.js

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

load("data/cards.js");
load("data/relics.js");
load("mana.js");
load("combat.js");
load("ui.js");
load("game.js");

state.headless = true;

function cardManaValue(card) {
  if (!card || card.type === "Land") return 0;
  return parseManaCost(card.manaCost).total;
}

function scoreLandToPlay(land) {
  // If we have landfall triggers on board, Fetch lands are highest priority!
  const hasLandfallCreature = state.playerCreatures.some(c => Boolean(c.landfall));
  if (land.isFetch) {
    return hasLandfallCreature ? 100 : 40;
  }
  if (land.produces.length > 1) return 60;
  // Prefer basic land colors we don't yet control on board
  const col = land.produces[0];
  const alreadyHave = state.playerLands.some(l => l.produces.includes(col));
  return alreadyHave ? 20 : 50;
}

function scoreSpellToCast(card) {
  const cmc = cardManaValue(card);
  // Sequence engine creatures (Lotus Cobra, Prowess, Ledger Shredder, Pridemate, Llanowar Elves, Self-Mill) BEFORE instants/sorceries
  if (card.type === "Creature") {
    if (card.etb === "mana_dork" || card.upkeep === "sentinel") return 80 + cmc;
    if (card.etb === "supplier" || card.etb === "wayfinder") return 82 + cmc;
    if (card.etb === "overseer") return 62;
    if (card.etb === "modular") return 48 + state.playerCreatures.length * 4;
    if (card.etb === "fiend_artisan") {
      const gyCreatures = state.graveyard.filter(c => c.type === "Creature").length;
      return 48 + gyCreatures * 5;
    }
    if (card.landfall || (card.keywords && card.keywords.includes("Prowess")) || card.connive || card.onLifegain) {
      return 70 + cmc;
    }
    return 50 + cmc * 10;
  }
  // Rituals & Ramp & Self-Mill/Treasure Draw first so we can cast bigger threats or grow Undergrowth
  if (
    card.effect === "ritual" ||
    card.effect === "dark_ritual" ||
    card.effect === "cultivate" ||
    card.effect === "thoughtcast" ||
    card.effect === "draw_2"
  ) {
    return 90 + cmc;
  }
  if (card.effect === "grisly_salvage") {
    return 88;
  }
  // Card draw / reanimate / token creation before board-wide buffs
  if (card.effect === "reanimate") {
    const hasGyCreature = state.graveyard.some(c => c.type === "Creature");
    return hasGyCreature ? 85 : 55;
  }
  if (card.effect === "spider_spawning" || card.effect === "thopter_foundry") {
    return 72 + cmc;
  }
  if (card.effect === "village_rites") {
    // Only cast Village Rites if we have no creatures, or have a token/1-drop, or need cards late
    const hasExpendable = state.playerCreatures.length === 0 ||
      state.playerCreatures.some(c => c.isToken || c.power <= 2);
    return hasExpendable ? 65 : -10;
  }
  if (
    card.effect === "overrun" ||
    card.effect === "battle_rage" ||
    card.effect === "formation" ||
    card.effect === "cyberdrive"
  ) {
    return state.playerCreatures.length > 0 ? 30 + cmc * 5 : -10;
  }
  return 40 + cmc * 10;
}

function playAiTurn() {
  // 1. Opening-hand mulligan check on Turn 1
  if (state.turn === 1 && state.canMulligan && state.mulligansLeft > 0) {
    const lands = state.hand.filter(c => c.type === "Land").length;
    if (lands < 2 || lands > 5) {
      useMulligan();
    }
  }

  // 2. Use Black Lotus / Consumable Scroll if it helps cast a high-cost hand card or on Turn 2+
  if (state.consumables.length > 0) {
    const lotus = state.consumables.find(s => s.id === "black_lotus");
    const hasExpensiveCard = state.hand.some(c => c.type !== "Land" && !canPlayCard(c) && cardManaValue(c) >= 3);
    if (lotus && (hasExpensiveCard || state.turn >= 3)) {
      useConsumable(lotus.uid);
    } else if (state.turn >= 3 && state.consumables[0]) {
      useConsumable(state.consumables[0].uid);
    }
  }

  // 3. Play Land -> Cast Spells loop (since rituals/Cobra/Cultivate/draws unlock more plays)
  let safety = 0;
  while (safety++ < 30) {
    // Play a Land if we have land drops remaining and haven't played one yet (or after drawing into one)
    // Wait: if we can play Lotus Cobra or Scute Swarm BEFORE our land drop this turn, cast it first!
    const playableLandfallCreature = state.hand.find(
      c => c.type === "Creature" && c.landfall && canPlayCard(c)
    );
    if (playableLandfallCreature) {
      playCardFromHand(playableLandfallCreature.uid);
      continue;
    }

    const playableLands = state.hand.filter(c => c.type === "Land" && canPlayCard(c));
    if (playableLands.length > 0) {
      playableLands.sort((a, b) => scoreLandToPlay(b) - scoreLandToPlay(a));
      playCardFromHand(playableLands[0].uid);
      continue;
    }

    // Re-check Black Lotus after playing land if we still have an uncastable 4+ drop
    if (state.consumables.length > 0) {
      const lotus = state.consumables.find(s => s.id === "black_lotus");
      const hasUnplayableBig = state.hand.some(c => c.type !== "Land" && !canPlayCard(c) && cardManaValue(c) >= 4);
      if (lotus && hasUnplayableBig) {
        useConsumable(lotus.uid);
        continue;
      }
    }

    const playableSpells = state.hand
      .filter(c => c.type !== "Land" && canPlayCard(c))
      .map(c => ({ card: c, score: scoreSpellToCast(c) }))
      .filter(x => x.score >= 0)
      .sort((a, b) => b.score - a.score);

    if (playableSpells.length > 0) {
      playCardFromHand(playableSpells[0].card.uid);
      continue;
    }

    break;
  }

  // 4. Smart attacker selection: Attack with everything unless a non-lethal attack would suicide a key engine creature
  state.playerCreatures.forEach(c => {
    if (!c.summoningSick) c.attacking = true;
  });
  const proj = calculateProjectedCombat();
  if (proj.totalDamage < state.enemyLife && state.turn < state.maxTurns) {
    state.playerCreatures.forEach(c => {
      const isEngine = c.etb === "mana_dork" || c.upkeep === "sentinel" || Boolean(c.landfall);
      if (isEngine && (proj.deadAttackerCountsByUid[c.uid] || 0) > 0 && (c.count || 1) === 1) {
        c.attacking = false;
      }
    });
  }

  // 5. Resolve Combat & Turn
  executeCombatAndEndTurn();
}

function simulateSingleEncounter(deckConfig, encounterIdx, extraRelicIds = []) {
  state.deckArchetype = deckConfig;
  state.masterDeck = deckConfig.cards.map(id => cloneCard(id));
  state.relics = [];
  const startRelic = RELIC_DB.find(r => r.id === deckConfig.startingRelic);
  if (startRelic) state.relics.push({ ...startRelic });
  extraRelicIds.forEach(rid => {
    if (!hasRelic(rid)) {
      const def = RELIC_DB.find(r => r.id === rid);
      if (def) state.relics.push({ ...def });
    }
  });
  state.consumables = encounterIdx === 0 ? [{ ...CONSUMABLE_DB[0], uid: nextUid() }] : [];
  state.encounterIdx = encounterIdx;
  state.playerLife = START_LIFE;
  state.gold = 6;
  state.synTiers = {};

  beginEncounter();

  let guard = 0;
  while (state.enemyLife > 0 && !state.runOver && guard++ < 15) {
    playAiTurn();
  }

  return {
    won: state.enemyLife <= 0 && !state.runOver,
    turnsUsed: state.turn,
    lifeLeft: state.playerLife
  };
}

function aiShopStep() {
  // 1. Heal if low on life (< 14 HP)
  const healIdx = state.shopStock.upgrades.findIndex(u => u.id === "sanctum_heal" && !u.bought);
  if (healIdx !== -1 && state.playerLife <= 14 && state.gold >= state.shopStock.upgrades[healIdx].cost) {
    buyUpgrade(healIdx);
  }

  // 2. Buy strongest affordable Relics
  state.shopStock.relics.forEach((r, idx) => {
    if (!r.bought && state.gold >= r.cost && state.relics.length < 5) {
      buyRelic(idx);
    }
  });

  // 3. Buy Halo/Etched/Traditional Foil upgrades
  ["halo_foil", "foil_buff", "etched_foil"].forEach(upgId => {
    const uIdx = state.shopStock.upgrades.findIndex(u => u.id === upgId && !u.bought);
    if (uIdx !== -1 && state.gold >= state.shopStock.upgrades[uIdx].cost) {
      buyUpgrade(uIdx);
    }
  });

  // 4. Draft an in-color spell/dual land if gold remains
  state.shopStock.cards.forEach((item, idx) => {
    if (!item.bought && state.gold >= item.cost && state.masterDeck.length < 44) {
      buyDraftCard(idx);
    }
  });

  // 5. Buy Scroll if affordable and slot available
  const scrollIdx = state.shopStock.upgrades.findIndex(u => u.isConsumable && !u.bought);
  if (scrollIdx !== -1 && state.consumables.length < 2 && state.gold >= state.shopStock.upgrades[scrollIdx].cost) {
    buyUpgrade(scrollIdx);
  }
}

function aiDraftStep() {
  if (!state.pendingDraft || state.pendingDraft.resolved || !Array.isArray(state.pendingDraft.choices)) {
    return;
  }
  const choices = state.pendingDraft.choices
    .map(c => typeof c === "string" ? CARD_DB[c] : c)
    .filter(Boolean);

  if (choices.length === 0) {
    skipDraft();
    return;
  }

  // If deck is already sufficiently large (>= 44 cards), take +$2 gold bounty
  if (state.masterDeck.length >= 44) {
    skipDraft();
    return;
  }

  // Score candidate cards
  let bestIdx = 0;
  let bestScore = -1;
  choices.forEach((card, idx) => {
    let score = 0;
    if (card.type === "Land") {
      score = typeof scoreLandToPlay === "function" ? scoreLandToPlay(card) : 30;
    } else {
      score = typeof scoreSpellToCast === "function" ? scoreSpellToCast(card) : ((card.power || 0) * 10 + 20);
    }
    if (score > bestScore) {
      bestScore = score;
      bestIdx = idx;
    }
  });

  if (bestScore >= 25) {
    selectDraftCard(bestIdx);
  } else {
    skipDraft();
  }
}

function simulateFullCampaign(deckConfig) {
  startNewRun(deckConfig);
  const cleared = [false, false, false, false, false, false];

  for (let encIdx = 0; encIdx < ENCOUNTERS.length; encIdx++) {
    state.encounterIdx = encIdx;
    if (encIdx > 0) {
      beginEncounter();
    }
    let guard = 0;
    while (state.enemyLife > 0 && !state.runOver && guard++ < 15) {
      playAiTurn();
    }
    if (state.enemyLife <= 0 && !state.runOver) {
      cleared[encIdx] = true;
      aiDraftStep();
      aiShopStep();
    } else {
      break;
    }
  }
  return cleared;
}

const N_CAMPAIGNS = 800;
console.log(`=== MANASTORM HEADLESS BALANCE SIMULATOR (${N_CAMPAIGNS} Full Campaigns / Deck) ===\n`);

const header = "Deck Archetype".padEnd(28) +
  ENCOUNTERS.map((e, i) => `E${i + 1}:${e.name.split(",")[0].slice(0, 10)}(${e.maxLife})`.padEnd(18)).join("");
console.log(header);
console.log("-".repeat(header.length));

STARTER_DECKS.forEach(deck => {
  const winsPerEnc = new Array(ENCOUNTERS.length).fill(0);
  const reachedPerEnc = new Array(ENCOUNTERS.length).fill(0);

  for (let i = 0; i < N_CAMPAIGNS; i++) {
    const cleared = simulateFullCampaign(deck);
    for (let e = 0; e < ENCOUNTERS.length; e++) {
      if (e === 0 || cleared[e - 1]) {
        reachedPerEnc[e]++;
        if (cleared[e]) winsPerEnc[e]++;
      }
    }
  }

  const row = deck.badge.padEnd(28) + ENCOUNTERS.map((_, e) => {
    const wr = reachedPerEnc[e] > 0 ? ((winsPerEnc[e] / reachedPerEnc[e]) * 100).toFixed(1) : "0.0";
    const cum = ((winsPerEnc[e] / N_CAMPAIGNS) * 100).toFixed(0);
    return `${wr}% (cum ${cum}%)`.padEnd(18);
  }).join("");
  console.log(row);
});

// Relic Impact Benchmark on Encounter 2 (Krenko) & Encounter 3 (Sheoldred)
console.log(`\n=== RELIC MARGINAL IMPACT vs PRICE ANALYSIS (Across All ${STARTER_DECKS.length} Starter Decks, E3 Sheoldred) ===`);
const N_RELIC_SIMS = 400;

function measureRelicWinRate(extraRelicId) {
  let wins = 0;
  const perDeck = Math.floor(N_RELIC_SIMS / STARTER_DECKS.length);
  STARTER_DECKS.forEach(deck => {
    for (let i = 0; i < perDeck; i++) {
      const res = simulateSingleEncounter(deck, 2, extraRelicId ? [extraRelicId] : []);
      if (res.won) wins++;
    }
  });
  return (wins / (perDeck * STARTER_DECKS.length)) * 100;
}

const baselineE3 = measureRelicWinRate(null);
console.log(`Baseline Starter Deck Win Rate vs E3 (No Extra Relic): ${baselineE3.toFixed(1)}%\n`);
console.log("Relic Name".padEnd(26) + "Price".padEnd(8) + "E3 Win%".padEnd(10) + "Delta".padEnd(10) + "Win% per $1");
console.log("-".repeat(68));

RELIC_DB.forEach(relic => {
  const wr = measureRelicWinRate(relic.id);
  const delta = wr - baselineE3;
  const eff = delta / relic.cost;
  console.log(
    relic.name.padEnd(26) +
    `$${relic.cost}`.padEnd(8) +
    `${wr.toFixed(1)}%`.padEnd(10) +
    `${delta >= 0 ? "+" : ""}${delta.toFixed(1)}%`.padEnd(10) +
    `${eff >= 0 ? "+" : ""}${eff.toFixed(2)}%/$`
  );
});
