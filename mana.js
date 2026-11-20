// MANASTORM — Exact Colored Mana Solver, Pip Parser & Smart Auto-Tapper

// Parses "{2}{G}{G}" into { generic: 2, pips: { G: 2, R: 0, B: 0, U: 0, W: 0 }, total: 4, tokens: ["2", "G", "G"] }
function parseManaCost(manaCostStr = "") {
  const result = {
    generic: 0,
    pips: { G: 0, R: 0, B: 0, U: 0, W: 0 },
    total: 0,
    tokens: []
  };
  if (!manaCostStr) return result;

  const matches = manaCostStr.match(/\{([^}]+)\}/g) || [];
  for (const raw of matches) {
    const sym = raw.slice(1, -1);
    result.tokens.push(sym);
    if (/^\d+$/.test(sym)) {
      const val = parseInt(sym, 10);
      result.generic += val;
      result.total += val;
    } else if (result.pips[sym] !== undefined) {
      result.pips[sym] += 1;
      result.total += 1;
    }
  }
  return result;
}

function renderManaCostHtml(card) {
  if (card.type === "Land") {
    if (card.isFetch) return `<span class="mana-cost-badge"><span class="cost-pip cost-pip-generic" title="Fetch Land">F</span></span>`;
    return `<span class="mana-cost-badge">${card.produces.map(col => `<span class="cost-pip cost-pip-${col}">${col}</span>`).join("")}</span>`;
  }
  const parsed = parseManaCost(card.manaCost);
  if (parsed.tokens.length === 0) {
    return `<span class="mana-cost-badge"><span class="cost-pip cost-pip-generic">0</span></span>`;
  }
  return `<span class="mana-cost-badge">${parsed.tokens.map(tok => {
    const isNum = /^\d+$/.test(tok);
    const cls = isNum ? "cost-pip-generic" : `cost-pip-${tok}`;
    return `<span class="cost-pip ${cls}">${tok}</span>`;
  }).join("")}</span>`;
}

function isPrismaticLand(land) {
  return Boolean(land && land.landEnhancement === "prismatic");
}

function getLandManaOptions(land) {
  if (!land) return [];
  if (hasAnyColorLands() || isPrismaticLand(land)) return COLORS;
  return Array.isArray(land.produces) ? land.produces : [];
}

function applyLandTapEffects(land) {
  if (!land) return;
  const enh = land.landEnhancement;
  if (enh === "volcanic") {
    if (state.enemyCreatures.length > 0) {
      let targetIdx = 0;
      for (let i = 1; i < state.enemyCreatures.length; i++) {
        if (state.enemyCreatures[i].toughness < state.enemyCreatures[targetIdx].toughness) {
          targetIdx = i;
        }
      }
      const target = state.enemyCreatures[targetIdx];
      target.toughness -= 1;
      if (target.toughness <= 0) {
        state.enemyCreatures.splice(targetIdx, 1);
        if (typeof spawnFx === "function") spawnFx(`🌋 Volcanic ${land.name} destroyed ${target.name}!`, "#ff6b35");
      } else {
        if (typeof spawnFx === "function") spawnFx(`🌋 Volcanic ${land.name}: -1 Toughness to ${target.name}`, "#ff6b35");
      }
    } else if (typeof addBurnPower === "function") {
      addBurnPower(1, `Volcanic ${land.name}`);
      if (typeof spawnFx === "function") spawnFx(`🌋 Volcanic ${land.name}: +1 Burn!`, "#ff6b35");
    }
  } else if (enh === "resonant") {
    if (typeof addResonance === "function") addResonance(1, `Resonant ${land.name}`);
    if (typeof spawnFx === "function") spawnFx(`⚡ Resonant ${land.name}: +1 Mult!`, "#b18cff");
  } else if (enh === "blighted") {
    if (state.library.length > 0 && typeof pushToGraveyard === "function") {
      const milled = state.library.pop();
      pushToGraveyard(milled);
      if (typeof spawnFx === "function") spawnFx(`🪦 Blighted ${land.name} milled ${milled.name}`, "#9b59b6");
    }
  }

  const passive = land.fusedPassive;
  if (!passive) return;
  const millOne = () => {
    if (state.library.length > 0 && typeof pushToGraveyard === "function") {
      pushToGraveyard(state.library.pop());
    }
  };
  if (passive === "resonance_1") {
    if (typeof addResonance === "function") addResonance(1, land.name);
  } else if (passive === "burn_2") {
    if (typeof addBurnPower === "function") addBurnPower(2, land.name);
  } else if (passive === "burn_resonance") {
    if (typeof addBurnPower === "function") addBurnPower(1, land.name);
    if (typeof addResonance === "function") addResonance(1, land.name);
  } else if (passive === "mill_resonance") {
    millOne();
    if (typeof addResonance === "function") addResonance(1, land.name);
  } else if (passive === "mill_burn") {
    millOne();
    if (typeof addBurnPower === "function") addBurnPower(1, land.name);
  } else if (passive === "heal_resonance") {
    if (typeof gainLife === "function") gainLife(1, land.name);
    if (typeof addResonance === "function") addResonance(1, land.name);
  } else if (passive === "heal_burn") {
    if (typeof gainLife === "function") gainLife(1, land.name);
    if (typeof addBurnPower === "function") addBurnPower(1, land.name);
  } else if (passive === "heal_mill") {
    if (typeof gainLife === "function") gainLife(1, land.name);
    millOne();
  }
}

// Finds an exact assignment of Floating Mana + Untapped Lands that satisfies both
// colored requirements (e.g. {G}{G}, {U}{R}) and generic requirements (e.g. {2}),
// using bipartite augmenting-path matching for dual lands so greedy color order never fails!
function findManaPaymentPlan(manaCostStr) {
  const req = parseManaCost(manaCostStr);
  const pool = { ...state.manaPool };
  const hasLantern = hasAnyColorLands();

  // Untapped lands sorted so single-color Basic Lands are preferred BEFORE Dual/Prismatic Lands
  const flexibility = l => (isPrismaticLand(l) ? 5 : (l.produces ? l.produces.length : 0));
  const untappedLands = state.playerLands
    .filter(l => !l.tapped)
    .sort((a, b) => flexibility(a) - flexibility(b));

  const usedLandUids = new Set();

  // Step 1: Pay exact colored pips ({G}, {R}, {B}, {U}, {W})
  // 1a. Use matching floating colored mana first
  for (const col of COLORS) {
    const useFromPool = Math.min(req.pips[col], pool[col]);
    req.pips[col] -= useFromPool;
    pool[col] -= useFromPool;
  }

  // 1b. Use single-color untapped lands that produce the required color (when Chromatic Lantern is not active)
  if (!hasLantern) {
    for (const col of COLORS) {
      while (req.pips[col] > 0) {
        const singleLand = untappedLands.find(
          l => !usedLandUids.has(l.uid) && !isPrismaticLand(l) && l.produces.length === 1 && l.produces[0] === col
        );
        if (singleLand) {
          usedLandUids.add(singleLand.uid);
          req.pips[col]--;
        } else {
          break;
        }
      }
    }
  }

  // 1c. Exact bipartite matching (Kuhn's algorithm) for remaining colored pips against remaining untapped lands
  const pipsList = [];
  for (const col of COLORS) {
    for (let i = 0; i < req.pips[col]; i++) {
      pipsList.push(col);
    }
  }

  const candidateLands = untappedLands.filter(l => !usedLandUids.has(l.uid));
  const landMatchPipIdx = new Array(candidateLands.length).fill(-1);

  function canAssignPip(pipIdx, visitedLands) {
    const col = pipsList[pipIdx];
    for (let lIdx = 0; lIdx < candidateLands.length; lIdx++) {
      if (visitedLands[lIdx]) continue;
      const land = candidateLands[lIdx];
      if (!hasLantern && !isPrismaticLand(land) && !land.produces.includes(col)) continue;

      visitedLands[lIdx] = true;
      if (landMatchPipIdx[lIdx] === -1 || canAssignPip(landMatchPipIdx[lIdx], visitedLands)) {
        landMatchPipIdx[lIdx] = pipIdx;
        return true;
      }
    }
    return false;
  }

  let matchedPipsCount = 0;
  for (let pIdx = 0; pIdx < pipsList.length; pIdx++) {
    const visitedLands = new Array(candidateLands.length).fill(false);
    if (canAssignPip(pIdx, visitedLands)) {
      matchedPipsCount++;
    }
  }

  for (let lIdx = 0; lIdx < candidateLands.length; lIdx++) {
    if (landMatchPipIdx[lIdx] !== -1) {
      usedLandUids.add(candidateLands[lIdx].uid);
    }
  }

  // 1d. Use floating ANY (Treasure) mana for any colored pips not covered by lands
  const unmatchedColoredPips = pipsList.length - matchedPipsCount;
  if (unmatchedColoredPips > pool.ANY) {
    return null;
  }
  pool.ANY -= unmatchedColoredPips;

  // Step 2: Pay Generic Mana ({1}, {2}, {3}...)
  let genericNeeded = req.generic;

  // 2a. Spend Colorless {C} floating mana first
  const useC = Math.min(genericNeeded, pool.C);
  genericNeeded -= useC;
  pool.C -= useC;

  // 2b. Spend remaining colored floating mana
  for (const col of COLORS) {
    const useCol = Math.min(genericNeeded, pool[col]);
    genericNeeded -= useCol;
    pool[col] -= useCol;
  }

  // 2c. Tap remaining untapped lands (single-color first, duals second)
  for (const land of untappedLands) {
    if (genericNeeded <= 0) break;
    if (!usedLandUids.has(land.uid)) {
      usedLandUids.add(land.uid);
      genericNeeded--;
    }
  }

  // 2d. Spend floating ANY (Treasure) mana last
  const useWild = Math.min(genericNeeded, pool.ANY);
  genericNeeded -= useWild;
  pool.ANY -= useWild;

  if (genericNeeded > 0) return null;

  return {
    newPool: pool,
    landsToTap: Array.from(usedLandUids)
  };
}

function canPlayCard(card) {
  if (state.runOver || state.combatLocked) return false;
  if (card.type === "Land") {
    return state.landsPlayedThisTurn < state.maxLandsPerTurn;
  }
  const lifeCost = Math.max(0, Math.floor(Number(card.lifeCost) || 0));
  if (lifeCost > 0 && state.playerLife <= lifeCost) return false;
  return findManaPaymentPlan(card.manaCost) !== null;
}

function payManaForCard(card) {
  const plan = findManaPaymentPlan(card.manaCost);
  if (!plan) return false;
  state.manaPool = plan.newPool;
  plan.landsToTap.forEach(uid => {
    const land = state.playerLands.find(l => l.uid === uid);
    if (land) {
      land.tapped = true;
      applyLandTapEffects(land);
    }
  });
  if (plan.landsToTap.length > 0 && typeof playSoundCue === "function") {
    playSoundCue("manaTap");
  }
  return true;
}

function tapLandManually(landUid) {
  if (state.runOver || state.combatLocked) return;
  const land = state.playerLands.find(l => l.uid === landUid);
  if (!land || land.tapped) return;

  const options = getLandManaOptions(land);

  if (options.length === 1) {
    const col = options[0];
    land.tapped = true;
    state.manaPool[col] += 1;
    applyLandTapEffects(land);
    if (typeof playSoundCue === "function") playSoundCue("manaTap");
    spawnFx(`+{${col}} Mana`, "#4bf099");
    renderAll();
  } else if (options.length > 1) {
    openColorPickerModal(
      `Tap ${land.name}`,
      "Choose which color of mana to add to your pool:",
      options.map(col => ({
        label: `Add {${col}} (${COLOR_NAMES[col]})`,
        colorCode: col,
        onSelect: () => {
          land.tapped = true;
          state.manaPool[col] += 1;
          applyLandTapEffects(land);
          if (typeof playSoundCue === "function") playSoundCue("manaTap");
          spawnFx(`+{${col}} Mana`, "#4bf099");
          renderAll();
        }
      })),
      true
    );
  }
}

function overchargeLand(landUid, mode = "mana", chosenColor = null) {
  if (state.runOver || state.combatLocked) return false;
  const idx = state.playerLands.findIndex(l => l.uid === landUid);
  if (idx === -1) return false;
  const land = state.playerLands[idx];
  if (!land || land.tapped || land.isFetch) return false;

  state.canMulligan = false;
  state.playerLands.splice(idx, 1);
  land.tapped = false;
  if (typeof pushToGraveyard === "function") {
    pushToGraveyard(land);
  } else {
    state.graveyard.push(land);
  }
  applyLandTapEffects(land);

  if (mode === "resonance") {
    if (typeof addResonance === "function") addResonance(2, "Land Overcharge");
    if (typeof spawnFx === "function") spawnFx(`⚡ Overcharged ${land.name}: +2 Resonance!`, "#ffbe3b");
    if (typeof setLog === "function") setLog(`Overcharged ${land.name} to the Graveyard for +2 Resonance!`);
  } else {
    const options = getLandManaOptions(land);
    const col = (chosenColor && options.includes(chosenColor)) ? chosenColor : (options[0] || "C");
    state.manaPool[col] = (state.manaPool[col] || 0) + 2;
    if (typeof spawnFx === "function") spawnFx(`⚡ Overcharged ${land.name}: +2 {${col}} Mana!`, "#ffbe3b");
    if (typeof setLog === "function") setLog(`Overcharged ${land.name} to the Graveyard for +2 {${col}} Mana!`);
  }

  if (typeof playSoundCue === "function") playSoundCue("manaTap");
  renderAll();
  return true;
}
