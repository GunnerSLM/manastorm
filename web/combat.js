// MANASTORM — Combat Projection, Breakdown Calculator, Retaliation Animation & Wave Spawner

function getCreatureKeywords(c) {
  return [...new Set([...(c.keywords || []), ...(c.tempKeywords || [])])];
}

function addTempKeyword(c, kw) {
  if (!c.tempKeywords) c.tempKeywords = [];
  if (!c.keywords.includes(kw) && !c.tempKeywords.includes(kw)) {
    c.tempKeywords.push(kw);
  }
}

function toggleCreatureAttack(creatureUid) {
  if (state.runOver || state.combatLocked) return;
  const c = state.playerCreatures.find(cr => cr.uid === creatureUid);
  if (!c) return;
  if (c.summoningSick) {
    spawnFx("Summoning Sick! Needs Haste to attack Turn 1.", "#98a4c0");
    return;
  }
  const previousDamage = calculateProjectedCombat().totalDamage;
  c.attacking = !c.attacking;
  const projectedCombat = calculateProjectedCombat();
  renderAll();
  if (typeof showAttackerProjectionFeedback === "function") {
    showAttackerProjectionFeedback(
      creatureUid,
      projectedCombat.totalDamage - previousDamage,
      projectedCombat.totalDamage,
      c.attacking
    );
  }
}

function getEffectiveBurnPower(rawBurn, enc) {
  if (rawBurn <= 0) return { effective: 0, note: null };
  if (enc && enc.burnImmune) {
    return { effective: 0, note: `${enc.name} (Iron Hide: Burn Immune)` };
  }
  if (enc && enc.burnResistance) {
    const reduced = Math.ceil(rawBurn * (1 - enc.burnResistance));
    return { effective: reduced, note: `${enc.name} (Ward: -${rawBurn - reduced} Burn)` };
  }
  return { effective: rawBurn, note: null };
}

function getManaSurgeBonus() {
  if (!getRelicDefs().some(d => d.manaSurge)) {
    return { power: 0, mult: 0, count: 0 };
  }
  const untapped = state.playerLands.filter(l => !l.tapped).length;
  const floating = COLORS.reduce((s, col) => s + (state.manaPool[col] || 0), 0)
    + (state.manaPool.C || 0)
    + (state.manaPool.ANY || 0);
  const totalUnused = untapped + floating;
  return {
    count: totalUnused,
    power: totalUnused * 2,
    mult: Math.min(5, totalUnused)
  };
}

// Shared block & combat damage model used by both live projection, hover breakdowns, and combat resolution
function calculateProjectedCombat() {
  const enc = getCurrentEncounter();
  const attackers = [];
  state.playerCreatures.forEach(c => {
    if (!c.attacking || c.summoningSick) return;
    const count = c.count || 1;
    const kws = getCreatureKeywords(c);
    const unitPow = Math.max(0, c.power + (c.tempPower || 0));
    const unitTough = Math.max(1, c.toughness + (c.tempToughness || 0));
    const hasDoubleStrike = kws.includes("Double Strike");
    const strikeMult = hasDoubleStrike ? 2 : 1;
    for (let i = 0; i < count; i++) {
      attackers.push({
        sourceUid: c.uid,
        name: c.name,
        singleStrikePower: unitPow,
        power: unitPow * strikeMult,
        toughness: unitTough,
        keywords: kws
      });
    }
  });

  attackers.sort((a, b) => b.power - a.power);

  const availableBlockers = state.enemyCreatures.map(b => ({ ...b, used: false, dies: false }));
  const deadBlockerUids = new Set();
  const deadAttackerCountsByUid = {};
  const blockerAssignments = {};
  const attackerAssignments = {};

  const burnInfo = getEffectiveBurnPower(state.turnBurnPower, enc);
  let unblockedCreaturePower = 0;
  const attackerDamageByName = {};
  const attackerDamageByUid = {};
  let lifelinkHeal = 0;

  attackers.forEach(att => {
    if (!attackerAssignments[att.sourceUid]) {
      attackerAssignments[att.sourceUid] = {
        blockedCount: 0,
        deadCount: 0,
        blockerNames: [],
        damageToBoss: 0
      };
    }

    const isFlying = att.keywords.includes("Flying");
    const hasTrample = att.keywords.includes("Trample");
    const hasDeathtouch = att.keywords.includes("Deathtouch");
    const hasLifelink = att.keywords.includes("Lifelink");
    const hasDoubleStrike = att.keywords.includes("Double Strike");

    const blocker = availableBlockers.find(
      b => !b.used && !b.frozen && (!isFlying || b.keywords.includes("Flying"))
    );

    let dmgToBoss = 0;
    if (!blocker) {
      dmgToBoss = att.power;
    } else {
      blocker.used = true;
      attackerAssignments[att.sourceUid].blockedCount++;
      attackerAssignments[att.sourceUid].blockerNames.push(blocker.name);

      const lethalNeeded = hasDeathtouch ? 1 : blocker.toughness;

      // Check if blocker dies from attacker's damage
      if (att.power >= lethalNeeded && att.power > 0) {
        blocker.dies = true;
        deadBlockerUids.add(blocker.uid);
      }

      // Check if Double Strike kills blocker during first-strike step before blocker can hit back
      const killedOnFirstStrike =
        hasDoubleStrike && att.singleStrikePower >= lethalNeeded && att.singleStrikePower > 0;

      // Blocker deals combat damage back to attacker unless killed on first strike
      const blockerHasDeathtouch = blocker.keywords && blocker.keywords.includes("Deathtouch");
      const attackerLethal = blockerHasDeathtouch ? 1 : att.toughness;
      let attackerDied = false;
      if (!killedOnFirstStrike && blocker.power >= attackerLethal && blocker.power > 0) {
        deadAttackerCountsByUid[att.sourceUid] = (deadAttackerCountsByUid[att.sourceUid] || 0) + 1;
        attackerAssignments[att.sourceUid].deadCount++;
        attackerDied = true;
      }

      if (hasTrample) {
        dmgToBoss = Math.max(0, att.power - lethalNeeded);
      }

      blockerAssignments[blocker.uid] = {
        attackerUid: att.sourceUid,
        attackerName: att.name,
        dmgTaken: att.power,
        dies: blocker.dies,
        killsAttacker: attackerDied,
        trampleOver: dmgToBoss
      };
    }

    if (dmgToBoss > 0) {
      attackerDamageByName[att.name] = (attackerDamageByName[att.name] || 0) + dmgToBoss;
      attackerDamageByUid[att.sourceUid] = (attackerDamageByUid[att.sourceUid] || 0) + dmgToBoss;
      attackerAssignments[att.sourceUid].damageToBoss += dmgToBoss;
    }
    unblockedCreaturePower += dmgToBoss;
    if (hasLifelink) lifelinkHeal += att.power;
  });

  const syn = getSynergyStates();
  const synMult = syn.reduce((s, x) => s + x.mult, 0);
  const synPower = attackers.length > 0 ? syn.reduce((s, x) => s + x.power, 0) : 0;

  const manaSurge = getManaSurgeBonus();
  const surgePower = (attackers.length > 0 || burnInfo.effective > 0) ? manaSurge.power : 0;
  const surgeMult = manaSurge.mult;

  const totalPower = unblockedCreaturePower + burnInfo.effective + synPower + surgePower;
  const preRelicMult = state.turnResonance + synMult + surgeMult;
  const finalMult = getCombatResonanceMultiplier(preRelicMult);

  // Build itemized Power & Resonance breakdowns for UI hover inspection
  const powerBreakdown = [];
  Object.entries(attackerDamageByName).forEach(([name, dmg]) => {
    powerBreakdown.push({ label: `${name} (Combat)`, value: `+${dmg}` });
  });
  if (state.turnBurnPower > 0) {
    if (burnInfo.note && burnInfo.effective !== state.turnBurnPower) {
      powerBreakdown.push({ label: `Spell/ETB Burn (${burnInfo.note})`, value: `+${burnInfo.effective} (from ${state.turnBurnPower})` });
    } else {
      powerBreakdown.push({ label: "Spell & Relic Burn", value: `+${burnInfo.effective}` });
    }
  }
  if (attackers.length > 0) {
    syn.filter(x => x.power > 0).forEach(x => {
      powerBreakdown.push({ label: `${x.icon} ${x.name} (Synergy)`, value: `+${x.power}` });
    });
  }
  if (surgePower > 0) {
    powerBreakdown.push({ label: `Nyxbloom Mana Surge (${manaSurge.count} unspent)`, value: `+${surgePower}` });
  }
  if (powerBreakdown.length === 0) {
    powerBreakdown.push({ label: "No unblocked attackers or burn", value: "0" });
  }

  const resonanceBreakdown = [];
  (state.resonanceSources || [{ label: "Base Resonance", amount: 1 }]).forEach(src => {
    resonanceBreakdown.push({
      label: src.label,
      value: src.type === "mult" ? `×${src.amount}` : (src.label === "Base Resonance" ? `${src.amount}` : `+${src.amount}`)
    });
  });
  syn.filter(x => x.mult > 0).forEach(x => {
    resonanceBreakdown.push({ label: `${x.icon} ${x.name} (Synergy)`, value: `+${x.mult}` });
  });
  if (surgeMult > 0) {
    resonanceBreakdown.push({ label: `Nyxbloom Mana Surge (${manaSurge.count} unspent)`, value: `+${surgeMult}` });
  }
  getRelicDefs().forEach(def => {
    if (typeof def.onModifyCombatMult === "function") {
      resonanceBreakdown.push({ label: `✦ ${def.name} (Relic)`, value: "×2" });
    }
  });

  return {
    power: totalPower,
    mult: finalMult,
    totalDamage: totalPower * finalMult,
    lifelinkHeal,
    attackersCount: attackers.length,
    deadBlockerUids,
    deadAttackerCountsByUid,
    blockerAssignments,
    attackerAssignments,
    attackerDamageByUid,
    powerBreakdown,
    resonanceBreakdown
  };
}

function executeCombatAndEndTurn() {
  if (state.enemyLife <= 0 || state.runOver || state.combatLocked) return;
  state.runTurns = Math.max(0, Math.floor(Number(state.runTurns) || 0)) + 1;

  const combat = calculateProjectedCombat();
  recordCombatEvent(
    "combat",
    `Attack resolved: ${combat.power} power × ${combat.mult} resonance = ${combat.totalDamage} damage.`,
    { power: combat.power, resonance: combat.mult, damage: combat.totalDamage }
  );
  Object.entries(combat.blockerAssignments).forEach(([blockerUid, assignment]) => {
    const blocker = state.enemyCreatures.find(creature => creature.uid === blockerUid);
    const outcome = assignment.dies ? "was destroyed" : "survived";
    recordCombatEvent(
      "blocker",
      `${blocker?.name || "Enemy blocker"} blocked ${assignment.attackerName} and ${outcome}${assignment.trampleOver > 0 ? `; ${assignment.trampleOver} trample damage got through` : ""}.`,
      { blockerUid, attackerName: assignment.attackerName, destroyed: assignment.dies, trampleDamage: assignment.trampleOver }
    );
  });
  if (combat.lifelinkHeal > 0) {
    const healed = gainLife(combat.lifelinkHeal, "Lifelink");
    spawnFx(`Lifelink: +${healed > 0 ? healed : combat.lifelinkHeal} Life!`, "#26d07c");
  }

  state.enemyLife = Math.max(0, state.enemyLife - combat.totalDamage);
  recordCombatEvent("damage", `Player dealt ${combat.totalDamage} damage to ${getCurrentEncounter().name}.`, {
    damage: combat.totalDamage,
    target: getCurrentEncounter().name,
    lifeRemaining: state.enemyLife
  });
  if (combat.attackersCount > 0 && typeof playSoundCue === "function") {
    playSoundCue("impact");
  }
  spawnFx(`⚔️ ${combat.power} × ${combat.mult} = ${combat.totalDamage} DMG!`, "#ffd466");

  // Remove enemy blockers killed in combat
  if (combat.deadBlockerUids.size > 0) {
    state.enemyCreatures = state.enemyCreatures.filter(b => !combat.deadBlockerUids.has(b.uid));
  }

  // Apply combat casualties to player creatures and send fallen non-token creatures to the Graveyard
  const survivingPlayerCreatures = [];
  for (const c of state.playerCreatures) {
    const deadCount = combat.deadAttackerCountsByUid[c.uid] || 0;
    if (deadCount > 0) {
      recordCombatEvent("combat", `${deadCount} ${c.name} ${deadCount === 1 ? "creature fell" : "creatures fell"} in combat.`, {
        creature: c.name,
        count: deadCount
      });
    }
    if (deadCount > 0 && !c.isToken) {
      for (let i = 0; i < deadCount; i++) {
        pushToGraveyard(creatureToCard(c));
      }
    }
    const remaining = (c.count || 1) - deadCount;
    if (remaining > 0) {
      c.count = remaining;
      if (c.isToken) {
        c.rules = `Token Stack (${c.count}x).`;
      }
      survivingPlayerCreatures.push(c);
    }
  }
  state.playerCreatures = survivingPlayerCreatures;

  if (state.enemyLife <= 0) {
    handleEncounterVictory();
    return;
  }

  const enc = getCurrentEncounter();
  const activeRetaliators = state.enemyCreatures.filter(b => !b.frozen);
  let enemyAttack = activeRetaliators.reduce((sum, b) => sum + b.power + (enc.staxHideBonus || 0), 0);
  const retalParts = activeRetaliators.map(b => `${b.name} (${b.power + (enc.staxHideBonus || 0)})`);

  if (enc.staxDrain) {
    enemyAttack += enc.staxDrain;
    state.enemyLife = Math.min(state.enemyMaxLife, state.enemyLife + enc.staxDrain);
    retalParts.push(`${enc.name} Drain (${enc.staxDrain})`);
  }

  const finishEndOfTurn = () => {
    state.combatLocked = false;
    const prevLife = state.playerLife;
    if (enemyAttack > 0) {
      state.playerLife = Math.max(0, state.playerLife - enemyAttack);
      recordCombatEvent("damage", `Enemy retaliation dealt ${enemyAttack} damage (${prevLife} → ${state.playerLife} Life).`, {
        damage: enemyAttack,
        lifeBefore: prevLife,
        lifeAfter: state.playerLife
      });
      spawnFx(`🛡️ Enemy Retaliation: -${enemyAttack} HP!`, "#ff4757");
    } else {
      recordCombatEvent("turn", "Enemy forces did not retaliate this turn.");
    }

    // Thaw frozen blockers after enemy combat step
    state.enemyCreatures.forEach(b => { b.frozen = false; });

    if (state.turn >= state.maxTurns || state.playerLife <= 0) {
      recordCombatEvent("turn", `Turn ${state.turn} ended.`, { turn: state.turn });
      if (enemyAttack > 0) {
        setLog(`Turn ${state.turn} Retaliation: ${retalParts.join(" + ")} dealt ${enemyAttack} DMG (Life: ${prevLife} → ${state.playerLife}).`);
      }
      renderAll();
      handleDefeat();
      return;
    }

    const retalSummary = enemyAttack > 0
      ? `Enemy struck for ${enemyAttack} DMG [${retalParts.join(", ")}] (Life: ${prevLife} → ${state.playerLife}). `
      : "No Enemy Retaliation! ";

    state.turn++;
    spawnEnemyWave(enc);
    startPlayerTurn(false, retalSummary);
  };

  // In interactive browser mode, play a short enemy retaliation animation when enemies strike back
  const retaliationDelay = typeof getCombatAnimationDelay === "function"
    ? getCombatAnimationDelay(420)
    : 420;
  if (!state.headless && typeof document !== "undefined" && enemyAttack > 0 && retaliationDelay > 0) {
    state.combatLocked = true;
    renderAll();
    const enemyCards = document.querySelectorAll("#enemy-creatures .board-card:not(.frozen-card)");
    enemyCards.forEach(el => el.classList.add("enemy-retaliating"));
    const lifeChip = document.querySelector(".life-chip");
    if (lifeChip) lifeChip.classList.add("life-hit-flash");
    setLog(`⚠️ Enemy Retaliation: ${retalParts.join(" + ")} striking for ${enemyAttack} DMG...`);

    setTimeout(() => {
      if (lifeChip) lifeChip.classList.remove("life-hit-flash");
      finishEndOfTurn();
    }, retaliationDelay);
  } else {
    finishEndOfTurn();
  }
}

function getEnemyWaveSpawnCount(enc, turn = state.turn, existingCount = state.enemyCreatures.length) {
  if (!enc || !enc.spawn) return 0;

  let count = enc.spawn.count || 1;
  if (enc.evenTurnDoubleSpawn && turn % 2 === 0) {
    count *= 2;
  }
  if (enc.stampedeTurn && turn >= enc.stampedeTurn) {
    count += 1;
  }
  if (enc.evenTurnBonusGuard && turn % 2 === 0) {
    count += enc.evenTurnBonusGuard;
  }
  const challenge = typeof getRunChallengeById === "function"
    ? getRunChallengeById(state.challengeId)
    : null;
  if (challenge && challenge.extraEnemyPerWave) {
    count += challenge.extraEnemyPerWave;
  }
  if (challenge && challenge.extraEnemyOnEvenTurns && turn % 2 === 0) {
    count += challenge.extraEnemyOnEvenTurns;
  }
  return Math.max(0, Math.min(count, 5 - Math.max(0, existingCount)));
}

function spawnEnemyWave(enc) {
  const count = getEnemyWaveSpawnCount(enc, state.turn, state.enemyCreatures.length);

  const bonusTough = enc.cenobiteAura || 0;
  for (let i = 0; i < count; i++) {
    if (state.enemyCreatures.length < 5) {
      state.enemyCreatures.push({
        uid: nextUid(),
        name: enc.spawn.name,
        power: enc.spawn.power,
        toughness: enc.spawn.toughness + bonusTough,
        color: enc.spawn.color,
        keywords: [...(enc.spawn.keywords || [])],
        frozen: false
      });
    }
  }
}
