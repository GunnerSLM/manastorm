// MANASTORM — DOM Rendering, Hover Breakdowns, Modals & Event Delegation

let colorDialogPendingFallback = null;
let colorDialogAllowCancel = false;
let targetDialogPendingFallback = null;
let targetDialogActive = false;
const targetDialogQueue = [];
let newRunForceChoice = false;
let routeForceChoice = false;
let invalidPlayFeedbackTimer = null;
const invalidCardFeedbackTimers = new WeakMap();
const dropZoneSuccessTimers = new WeakMap();
let projectionFeedbackTimer = null;
let projectionPulseTimer = null;
let lastProjectionSource = null;
let lastProjectionTally = null;
let ambientVisibilityListenerInitialized = false;
let routeSelectionPending = false;
const resourceFeedbackTimers = new WeakMap();
const rewardFeedbackTimers = new WeakMap();
const pendingShopRewardHighlights = new Set();
const pendingRelicRewardHighlights = new Set();
let soundAudioContext = null;
let soundMasterGain = null;
let soundStatusMessage = "Sound is muted until you enable it.";
let soundStatusIsError = false;
let soundStatusToastTimer = null;

const SOUND_CUES = {
  cardPlay: [{ frequency: 440, duration: 0.11, waveform: "triangle", level: 0.58 }],
  manaTap: [{ frequency: 660, duration: 0.08, waveform: "sine", level: 0.5 }],
  impact: [
    { frequency: 150, duration: 0.14, waveform: "sine", level: 0.62 },
    { frequency: 245, duration: 0.1, waveform: "triangle", level: 0.22, offset: 0.025 }
  ],
  victory: [
    { frequency: 523, duration: 0.18, waveform: "sine", level: 0.48, offset: 0 },
    { frequency: 659, duration: 0.19, waveform: "sine", level: 0.48, offset: 0.12 },
    { frequency: 784, duration: 0.26, waveform: "triangle", level: 0.48, offset: 0.24 }
  ],
  defeat: [
    { frequency: 392, duration: 0.22, waveform: "sawtooth", level: 0.45, offset: 0 },
    { frequency: 311, duration: 0.24, waveform: "sawtooth", level: 0.45, offset: 0.15 },
    { frequency: 220, duration: 0.35, waveform: "sine", level: 0.55, offset: 0.32 }
  ],
  shopBuy: [
    { frequency: 587, duration: 0.09, waveform: "triangle", level: 0.42, offset: 0 },
    { frequency: 880, duration: 0.14, waveform: "sine", level: 0.45, offset: 0.07 }
  ],
  relicTrigger: [
    { frequency: 880, duration: 0.12, waveform: "sine", level: 0.45, offset: 0 },
    { frequency: 1174, duration: 0.16, waveform: "triangle", level: 0.4, offset: 0.08 }
  ],
  cardPurge: [
    { frequency: 320, duration: 0.15, waveform: "sawtooth", level: 0.45, offset: 0 },
    { frequency: 160, duration: 0.22, waveform: "sine", level: 0.5, offset: 0.08 }
  ]
};

function isHeadlessEnv() {
  return Boolean((typeof state !== "undefined" && state.headless) || typeof document === "undefined");
}

// ============================================================================
// SAFE DOM HELPERS & MODAL LIFECYCLE GUARDS (Fix #5 & #7)
// ============================================================================

function getEl(idOrEl) {
  if (!idOrEl) return null;
  if (typeof idOrEl === "object") return idOrEl;
  if (typeof document === "undefined" || typeof document.getElementById !== "function") return null;
  try {
    return document.getElementById(idOrEl) || null;
  } catch (_) {
    return null;
  }
}

function queryEl(selector, root = null) {
  const base = root || (typeof document !== "undefined" ? document : null);
  if (!base || typeof base.querySelector !== "function") return null;
  try {
    return base.querySelector(selector) || null;
  } catch (_) {
    return null;
  }
}

function queryAll(selector, root = null) {
  const base = root || (typeof document !== "undefined" ? document : null);
  if (!base || typeof base.querySelectorAll !== "function") return [];
  try {
    return Array.from(base.querySelectorAll(selector));
  } catch (_) {
    return [];
  }
}

function setText(idOrEl, text) {
  const el = getEl(idOrEl);
  if (!el) return false;
  try {
    const str = String(text ?? "");
    if (el.textContent !== str) {
      el.textContent = str;
    }
    return true;
  } catch (_) {
    return false;
  }
}

function safeShowModal(idOrDialog) {
  const dlg = getEl(idOrDialog);
  if (!dlg) return false;
  try {
    if (!dlg.open && typeof dlg.showModal === "function") {
      dlg.showModal();
    }
    return true;
  } catch (_) {
    return false;
  }
}

function safeCloseModal(idOrDialog) {
  const dlg = getEl(idOrDialog);
  if (!dlg) return false;
  try {
    if (dlg.open !== false && typeof dlg.close === "function") {
      dlg.close();
    }
    return true;
  } catch (_) {
    return false;
  }
}

function isShopDialogOpen() {
  if (isHeadlessEnv()) return false;
  const dlg = getEl("shop-dialog");
  return Boolean(dlg && dlg.open);
}

function openColorPickerModal(title, desc, choices, allowCancel = false) {
  if (!Array.isArray(choices) || choices.length === 0) return;
  if (isHeadlessEnv()) {
    // Smart headless choice: prefer a color required by spells in hand that we have least of
    let bestChoice = choices[0];
    if (typeof state !== "undefined" && state.hand) {
      const neededByCol = { G: 0, R: 0, B: 0, U: 0, W: 0, C: 0 };
      state.hand.forEach(c => {
        if (c.type !== "Land" && c.manaCost) {
          const parsed = parseManaCost(c.manaCost);
          COLORS.forEach(col => { neededByCol[col] += parsed.pips[col] || 0; });
        }
      });
      const producedByCol = { G: 0, R: 0, B: 0, U: 0, W: 0, C: 0 };
      state.playerLands.forEach(l => {
        if (l.produces.length === 1) producedByCol[l.produces[0]]++;
      });
      choices.forEach(ch => {
        const curCol = bestChoice.colorCode;
        const candCol = ch.colorCode;
        const curDeficit = (neededByCol[curCol] || 0) - (producedByCol[curCol] || 0);
        const candDeficit = (neededByCol[candCol] || 0) - (producedByCol[candCol] || 0);
        if (candDeficit > curDeficit) bestChoice = ch;
      });
    }
    bestChoice.onSelect();
    return;
  }

  const dialog = getEl("color-dialog");
  const row = getEl("color-choice-row");
  if (!dialog || !row) {
    if (!allowCancel && choices[0] && typeof choices[0].onSelect === "function") {
      choices[0].onSelect();
    }
    return;
  }

  setText("color-dialog-title", title);
  setText("color-dialog-desc", desc);
  const closeForm = getEl("color-dialog-close-form");
  if (closeForm) {
    closeForm.hidden = !allowCancel;
  }

  colorDialogAllowCancel = allowCancel;
  colorDialogPendingFallback = !allowCancel && choices.length > 0 ? choices[0].onSelect : null;

  row.innerHTML = choices.map((ch, idx) => `
    <button type="button" class="color-choice-btn card-color-${ch.colorCode}" data-choice-idx="${idx}">
      <span class="cost-pip cost-pip-${ch.colorCode}">${ch.colorCode}</span>
      <span>${ch.label}</span>
    </button>
  `).join("");

  row.onclick = (e) => {
    const btn = e.target && typeof e.target.closest === "function" ? e.target.closest("[data-choice-idx]") : null;
    if (!btn) return;
    const idx = Number(btn.dataset.choiceIdx);
    colorDialogPendingFallback = null;
    safeCloseModal(dialog);
    if (choices[idx] && typeof choices[idx].onSelect === "function") {
      choices[idx].onSelect();
    }
  };

  safeShowModal(dialog);
}

function openTargetPickerModal(title, desc, items, renderItemHtml, onPick, options = {}) {
  if (!Array.isArray(items) || items.length === 0) return;
  if (items.length === 1 || isHeadlessEnv()) {
    onPick(items[0]);
    return;
  }

  const request = { title, desc, items, renderItemHtml, onPick, allowCancel: Boolean(options.allowCancel) };
  if (targetDialogActive) {
    targetDialogQueue.push(request);
    return;
  }
  showTargetPickerModal(request);
}

function showTargetPickerModal(request) {
  const { title, desc, items, renderItemHtml, onPick, allowCancel = false } = request;
  const dialog = getEl("target-dialog");
  const grid = getEl("target-dialog-grid");
  if (!dialog || !grid) {
    if (!allowCancel) onPick(items[0]);
    renderAll();
    return;
  }

  targetDialogActive = true;
  setText("target-dialog-title", title);
  setText("target-dialog-desc", desc);

  targetDialogPendingFallback = allowCancel ? null : () => {
    onPick(items[0]);
    renderAll();
  };

  grid.innerHTML = items.map((item, idx) => renderItemHtml(item, idx)).join("");

  grid.onclick = (e) => {
    const btn = e.target && typeof e.target.closest === "function" ? e.target.closest("[data-target-idx]") : null;
    if (!btn) return;
    const idx = Number(btn.dataset.targetIdx);
    targetDialogPendingFallback = null;
    safeCloseModal(dialog);
    onPick(items[idx]);
    renderAll();
  };

  const autoBtn = getEl("btn-target-auto");
  if (autoBtn) {
    autoBtn.onclick = () => {
      targetDialogPendingFallback = null;
      safeCloseModal(dialog);
      onPick(items[0]);
      renderAll();
    };
  }

  safeShowModal(dialog);
}

function handleTargetDialogClose() {
  const fallback = targetDialogPendingFallback;
  targetDialogPendingFallback = null;
  try {
    if (fallback) fallback();
  } finally {
    targetDialogActive = false;
    const nextRequest = targetDialogQueue.shift();
    if (nextRequest) showTargetPickerModal(nextRequest);
  }
}

const CARD_SELECTOR = ".card, .hand-card, .board-card, .land-card, .relic-card, .shop-item-card, .inspector-card, .draft-card";

function prefersReducedMotion() {
  if (typeof state !== "undefined" && state.prefersReducedMotion !== undefined) {
    return Boolean(state.prefersReducedMotion);
  }
  if (typeof state !== "undefined" && state.motionPreference === "reduced") {
    return true;
  }
  if (typeof state !== "undefined" && state.motionPreference === "full") {
    return false;
  }
  return Boolean(
    typeof window !== "undefined" &&
    window.matchMedia &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches
  );
}

function getCombatAnimationDelay(baseDelayMs) {
  const delay = Number(baseDelayMs);
  if (!Number.isFinite(delay) || delay <= 0 || prefersReducedMotion()) return 0;
  const speed = typeof DesktopBridge !== "undefined"
    ? DesktopBridge.getSettings()?.combatSpeed
    : "normal";
  const multiplier = speed === "instant" ? 0 : (speed === "fast" ? 0.45 : 1);
  return multiplier === 0 ? 0 : Math.max(1, Math.round(delay * multiplier));
}

function setSoundStatusMessage(message, isError = false) {
  soundStatusMessage = String(message || "");
  soundStatusIsError = Boolean(isError);
  const status = getEl("settings-sound-status");
  if (status) {
    status.textContent = soundStatusMessage;
    status.classList.toggle("error", Boolean(isError));
  }
  const toast = getEl("sound-feedback-status");
  if (toast) {
    if (soundStatusToastTimer) clearTimeout(soundStatusToastTimer);
    toast.hidden = !isError;
    toast.textContent = isError ? soundStatusMessage : "";
    toast.classList.toggle("error", Boolean(isError));
    if (isError) {
      if (typeof ensureFxLayerTop === "function") ensureFxLayerTop();
      soundStatusToastTimer = setTimeout(() => {
        toast.hidden = true;
        soundStatusToastTimer = null;
      }, 6000);
    } else {
      soundStatusToastTimer = null;
    }
  }
  if (isError && typeof showSettingsStatusMessage === "function") {
    showSettingsStatusMessage(soundStatusMessage, true);
  }
}

function getSoundAudioContext() {
  if (soundAudioContext) return soundAudioContext;
  const AudioContextConstructor = typeof window !== "undefined"
    ? (window.AudioContext || window.webkitAudioContext)
    : null;
  if (typeof AudioContextConstructor !== "function") {
    setSoundStatusMessage("Sound is unavailable in this browser. Visual feedback remains enabled.", true);
    return null;
  }
  try {
    soundAudioContext = new AudioContextConstructor();
    soundMasterGain = soundAudioContext.createGain();
    soundMasterGain.gain.value = 0;
    soundMasterGain.connect(soundAudioContext.destination);
    return soundAudioContext;
  } catch (error) {
    soundAudioContext = null;
    soundMasterGain = null;
    console.error("Unable to initialize MANASTORM sound feedback.", error);
    setSoundStatusMessage("Sound could not be initialized. Visual feedback remains enabled.", true);
    return null;
  }
}

function applySoundOutputSettings() {
  if (!soundAudioContext || !soundMasterGain || typeof DesktopBridge === "undefined") return;
  const settings = DesktopBridge.getSettings();
  const targetGain = settings.soundEnabled ? Math.max(0, Math.min(1, settings.soundVolume)) * 0.18 : 0;
  const gain = soundMasterGain.gain;
  if (typeof gain.cancelScheduledValues === "function") {
    gain.cancelScheduledValues(soundAudioContext.currentTime);
  }
  if (typeof gain.setTargetAtTime === "function") {
    gain.setTargetAtTime(targetGain, soundAudioContext.currentTime, 0.025);
  } else {
    gain.value = targetGain;
  }
}

function unlockSoundFromUserGesture() {
  const context = getSoundAudioContext();
  if (!context) return Promise.resolve(false);
  if (context.state === "running") {
    applySoundOutputSettings();
    return Promise.resolve(true);
  }
  if (context.state === "closed" || typeof context.resume !== "function") {
    setSoundStatusMessage("Sound could not start. Try enabling Sound Effects again.", true);
    return Promise.resolve(false);
  }
  let resumeResult;
  try {
    resumeResult = context.resume();
  } catch (error) {
    console.error("Unable to resume MANASTORM sound feedback.", error);
    setSoundStatusMessage("Sound could not start. Try enabling Sound Effects again.", true);
    return Promise.resolve(false);
  }
  return Promise.resolve(resumeResult).then(() => {
    if (context.state !== "running") {
      setSoundStatusMessage("Sound is still unavailable. Try enabling Sound Effects again.", true);
      return false;
    }
    applySoundOutputSettings();
    return true;
  }).catch(error => {
    console.error("Unable to resume MANASTORM sound feedback.", error);
    setSoundStatusMessage("Sound could not start. Try enabling Sound Effects again.", true);
    return false;
  });
}

function scheduleSoundCue(context, cueName) {
  const tones = SOUND_CUES[cueName];
  if (!Array.isArray(tones) || !soundMasterGain) return false;
  applySoundOutputSettings();
  const now = context.currentTime;
  tones.forEach(tone => {
    const oscillator = context.createOscillator();
    const envelope = context.createGain();
    const startAt = now + (tone.offset || 0);
    const endAt = startAt + tone.duration;
    oscillator.type = tone.waveform;
    oscillator.frequency.setValueAtTime(tone.frequency, startAt);
    envelope.gain.setValueAtTime(0.0001, startAt);
    envelope.gain.linearRampToValueAtTime(tone.level, startAt + 0.008);
    envelope.gain.exponentialRampToValueAtTime(0.0001, endAt);
    oscillator.connect(envelope);
    envelope.connect(soundMasterGain);
    oscillator.start(startAt);
    oscillator.stop(endAt + 0.01);
  });
  return true;
}

function playSoundCue(cueName) {
  if (isHeadlessEnv() || !SOUND_CUES[cueName] || typeof DesktopBridge === "undefined") return false;
  const settings = DesktopBridge.getSettings();
  if (!settings.soundEnabled || settings.soundVolume <= 0) return false;
  const context = getSoundAudioContext();
  if (!context) return false;
  if (context.state === "running") {
    try {
      return scheduleSoundCue(context, cueName);
    } catch (error) {
      console.error(`Unable to play MANASTORM ${cueName} sound.`, error);
      setSoundStatusMessage("Sound could not be played. Visual feedback remains enabled.", true);
      return false;
    }
  }
  unlockSoundFromUserGesture().then(ready => {
    if (!ready) return;
    try {
      scheduleSoundCue(context, cueName);
    } catch (error) {
      console.error(`Unable to play MANASTORM ${cueName} sound.`, error);
      setSoundStatusMessage("Sound could not be played. Visual feedback remains enabled.", true);
    }
  });
  return true;
}

function setResourceText(id, text) {
  const el = getEl(id);
  if (!el) return false;
  const nextText = String(text ?? "");
  const previousTarget = el.dataset.resourceValue;
  const displayedText = String(el.textContent || "");
  el.dataset.resourceValue = nextText;
  if (previousTarget == null || previousTarget === nextText || isHeadlessEnv()) {
    el.textContent = nextText;
    return true;
  }

  const currentMatch = displayedText.match(/^(.*?)(-?\d+(?:\.\d+)?)(.*)$/);
  const nextMatch = nextText.match(/^(.*?)(-?\d+(?:\.\d+)?)(.*)$/);
  if (!currentMatch || !nextMatch) {
    el.textContent = nextText;
    return true;
  }
  const previousValue = Number(currentMatch[2]);
  const nextValue = Number(nextMatch[2]);
  if (!Number.isFinite(previousValue) || !Number.isFinite(nextValue) || previousValue === nextValue) {
    el.textContent = nextText;
    return true;
  }

  const direction = nextValue > previousValue ? "up" : "down";
  const animationDuration = getCombatAnimationDelay(520);
  const staticFeedback = animationDuration === 0 && prefersReducedMotion();
  const cancelPrevious = resourceFeedbackTimers.get(el);
  if (cancelPrevious) cancelPrevious();
  el.classList.remove("resource-change-up", "resource-change-down", "resource-change-static");
  if (animationDuration === 0 && !staticFeedback) {
    el.textContent = nextText;
    return true;
  }

  void el.offsetWidth;
  el.classList.add(staticFeedback ? "resource-change-static" : `resource-change-${direction}`);
  if (staticFeedback) {
    el.textContent = nextText;
    const timer = setTimeout(() => {
      el.classList.remove("resource-change-static");
      resourceFeedbackTimers.delete(el);
    }, 700);
    resourceFeedbackTimers.set(el, () => clearTimeout(timer));
    return true;
  }

  el.style.setProperty("--resource-feedback-duration", `${animationDuration}ms`);
  let startedAt = null;
  let frameHandle = null;
  const useAnimationFrame = typeof requestAnimationFrame === "function";
  const cancel = () => {
    if (frameHandle == null) return;
    if (useAnimationFrame && typeof cancelAnimationFrame === "function") {
      cancelAnimationFrame(frameHandle);
    } else {
      clearTimeout(frameHandle);
    }
  };
  const tick = timestamp => {
    if (typeof document !== "undefined" && document.hidden) {
      el.textContent = nextText;
      el.classList.remove("resource-change-up", "resource-change-down");
      resourceFeedbackTimers.delete(el);
      return;
    }
    if (startedAt == null) startedAt = timestamp;
    const progress = Math.min(1, (timestamp - startedAt) / animationDuration);
    const eased = 1 - ((1 - progress) ** 3);
    const value = Math.round(previousValue + ((nextValue - previousValue) * eased));
    el.textContent = `${nextMatch[1]}${value}${nextMatch[3]}`;
    if (progress < 1) {
      frameHandle = useAnimationFrame
        ? requestAnimationFrame(tick)
        : setTimeout(() => tick(Date.now()), 16);
      return;
    }
    el.textContent = nextText;
    el.classList.remove("resource-change-up", "resource-change-down");
    resourceFeedbackTimers.delete(el);
  };
  frameHandle = useAnimationFrame
    ? requestAnimationFrame(tick)
    : setTimeout(() => tick(Date.now()), 16);
  resourceFeedbackTimers.set(el, cancel);
  return true;
}

function emphasizeRewardElement(el, durationMs = 520) {
  if (!el || isHeadlessEnv()) return false;
  const reducedMotion = prefersReducedMotion();
  const animationDuration = getCombatAnimationDelay(durationMs);
  if (animationDuration === 0 && !reducedMotion) return false;
  const previousTimer = rewardFeedbackTimers.get(el);
  if (previousTimer) clearTimeout(previousTimer);
  el.classList.remove("reward-enter", "reward-enter-static");
  void el.offsetWidth;
  el.classList.add(reducedMotion ? "reward-enter-static" : "reward-enter");
  if (animationDuration > 0) {
    el.style.setProperty("--reward-enter-duration", `${animationDuration}ms`);
  }
  rewardFeedbackTimers.set(el, setTimeout(() => {
    el.classList.remove("reward-enter", "reward-enter-static");
    rewardFeedbackTimers.delete(el);
  }, reducedMotion ? 700 : animationDuration));
  return true;
}

function markShopRewardHighlight(key) {
  if (!isHeadlessEnv() && typeof key === "string" && key) pendingShopRewardHighlights.add(key);
}

function markRelicRewardHighlight(id) {
  if (!isHeadlessEnv() && typeof id === "string" && id) pendingRelicRewardHighlights.add(id);
}

function showShopRewardSummary(message) {
  const summary = getEl("shop-reward-summary");
  if (!summary) return false;
  setText(summary, message);
  emphasizeRewardElement(summary, 620);
  return true;
}

function initializeAmbientVisibilityHandling() {
  if (
    ambientVisibilityListenerInitialized ||
    typeof document === "undefined" ||
    typeof document.addEventListener !== "function"
  ) return;
  ambientVisibilityListenerInitialized = true;
  const updateVisibility = () => {
    if (document.body && document.body.classList) {
      document.body.classList.toggle("page-hidden", Boolean(document.hidden));
    }
  };
  document.addEventListener("visibilitychange", updateVisibility);
  updateVisibility();
}

function showAttackerProjectionFeedback(creatureUid, damageDelta, totalDamage, attacking) {
  if (isHeadlessEnv()) return false;
  const creature = state.playerCreatures.find(item => item.uid === creatureUid);
  const feedback = getEl("projection-feedback");
  if (!creature || !feedback) return false;

  if (projectionFeedbackTimer) clearTimeout(projectionFeedbackTimer);
  if (projectionPulseTimer) clearTimeout(projectionPulseTimer);
  [lastProjectionSource, lastProjectionTally].forEach(el => {
    if (!el) return;
    el.classList.remove("projection-feedback-pulse", "reduced-motion");
  });

  const source = queryEl(`#player-creatures [data-creature-uid="${creatureUid}"]`);
  const tally = getEl("calc-total");
  const change = damageDelta > 0
    ? `increases by ${damageDelta}`
    : (damageDelta < 0 ? `decreases by ${Math.abs(damageDelta)}` : "is unchanged");
  feedback.textContent = `${creature.name} ${attacking ? "joins the attack" : "holds back"}: projected damage ${change} (${totalDamage} total).`;
  feedback.hidden = false;
  feedback.dataset.kind = "projection";

  const reducedMotion = prefersReducedMotion();
  [source, tally].forEach(el => {
    if (!el) return;
    el.classList.add("projection-feedback-pulse");
    if (reducedMotion) el.classList.add("reduced-motion");
  });
  lastProjectionSource = source;
  lastProjectionTally = tally;

  projectionPulseTimer = setTimeout(() => {
    [lastProjectionSource, lastProjectionTally].forEach(el => {
      if (!el) return;
      el.classList.remove("projection-feedback-pulse", "reduced-motion");
    });
    lastProjectionSource = null;
    lastProjectionTally = null;
    projectionPulseTimer = null;
  }, 620);
  projectionFeedbackTimer = setTimeout(() => {
    feedback.hidden = true;
    feedback.textContent = "";
    projectionFeedbackTimer = null;
  }, 2600);
  return true;
}

function calculateCardTilt(rect, clientX, clientY, maxTilt = 14) {
  if (!rect || !rect.width || !rect.height) {
    return { rx: "0.00deg", ry: "0.00deg", glareX: "50.0%", glareY: "50.0%", glareOpacity: 0 };
  }
  const clampX = Math.max(0, Math.min(rect.width, clientX - rect.left));
  const clampY = Math.max(0, Math.min(rect.height, clientY - rect.top));
  const normX = (clampX / rect.width) * 2 - 1;   // -1 (left) to +1 (right)
  const normY = (clampY / rect.height) * 2 - 1;  // -1 (top) to +1 (bottom)
  const rx = -normY * maxTilt;
  const ry = normX * maxTilt;
  const glareX = (clampX / rect.width) * 100;
  const glareY = (clampY / rect.height) * 100;
  return {
    rx: `${rx.toFixed(2)}deg`,
    ry: `${ry.toFixed(2)}deg`,
    glareX: `${glareX.toFixed(1)}%`,
    glareY: `${glareY.toFixed(1)}%`,
    glareOpacity: 1
  };
}

function applyCardTilt(cardEl, clientX, clientY, maxTilt = 14) {
  if (!cardEl || !cardEl.style) return;
  if (prefersReducedMotion() || (cardEl.classList && cardEl.classList.contains("is-dragging"))) {
    resetCardTilt(cardEl);
    return;
  }
  const rect = typeof cardEl.getBoundingClientRect === "function" ? cardEl.getBoundingClientRect() : null;
  if (!rect || !rect.width || !rect.height) return;
  const tilt = calculateCardTilt(rect, clientX, clientY, maxTilt);
  cardEl.style.setProperty("--rx", tilt.rx);
  cardEl.style.setProperty("--ry", tilt.ry);
  cardEl.style.setProperty("--glare-x", tilt.glareX);
  cardEl.style.setProperty("--glare-y", tilt.glareY);
  cardEl.style.setProperty("--glare-opacity", String(tilt.glareOpacity));
}

function resetCardTilt(cardEl) {
  if (!cardEl || !cardEl.style) return;
  cardEl.style.removeProperty("--rx");
  cardEl.style.removeProperty("--ry");
  cardEl.style.removeProperty("--glare-x");
  cardEl.style.removeProperty("--glare-y");
  cardEl.style.removeProperty("--glare-opacity");
}

function moveOrInsertBefore(parent, node, refNode) {
  if (node === refNode) return;
  if (node.isConnected && node.parentNode === parent && "moveBefore" in Element.prototype) {
    try {
      parent.moveBefore(node, refNode);
      return;
    } catch (_) {
      // Fallback to insertBefore
    }
  }
  parent.insertBefore(node, refNode);
}

function patchInnerHtmlIfChanged(el, html) {
  if (!el) return false;
  if (el._lastInnerHtml !== html) {
    el.innerHTML = html;
    el._lastInnerHtml = html;
    return true;
  }
  return false;
}

function stripInteractiveDataAttrs(el) {
  delete el.dataset.handUid;
  delete el.dataset.creatureUid;
  delete el.dataset.landUid;
  delete el.dataset.consumableUid;
  delete el.dataset.enemyUid;
  delete el.dataset.renderKey;
  el.querySelectorAll("[data-hand-uid],[data-creature-uid],[data-land-uid],[data-consumable-uid]").forEach(child => {
    delete child.dataset.handUid;
    delete child.dataset.creatureUid;
    delete child.dataset.landUid;
    delete child.dataset.consumableUid;
  });
}

function spawnExitGhost(el, rect, exitClass, durationMs = 440) {
  stripInteractiveDataAttrs(el);
  if (el.parentNode) {
    el.remove();
  }
  if (isHeadlessEnv() || !rect || rect.width === 0 || rect.height === 0) return;
  const layer = document.getElementById("fx-layer");
  if (!layer) return;

  el.classList.add("fx-ghost-node", exitClass);
  el.style.left = `${rect.left}px`;
  el.style.top = `${rect.top}px`;
  el.style.width = `${rect.width}px`;
  el.style.height = `${rect.height}px`;
  layer.appendChild(el);

  const waitMs = getCombatAnimationDelay(durationMs);
  setTimeout(() => {
    if (el.parentNode) el.remove();
  }, waitMs);
}

function animateFlipEntry(el, fromRect, options = {}) {
  if (isHeadlessEnv() || prefersReducedMotion() || !fromRect || fromRect.width === 0) return;
  if (typeof el.animate !== "function") return;
  const toRect = el.getBoundingClientRect();
  if (!toRect || toRect.width === 0) return;

  const dx = (fromRect.left + fromRect.width / 2) - (toRect.left + toRect.width / 2);
  const dy = (fromRect.top + fromRect.height / 2) - (toRect.top + toRect.height / 2);
  if (Math.abs(dx) < 3 && Math.abs(dy) < 3) return;

  const scaleX = Math.max(0.45, Math.min(1.4, fromRect.width / toRect.width));
  const scaleY = Math.max(0.45, Math.min(1.4, fromRect.height / toRect.height));

  try {
    el.animate(
      [
        {
          transform: `translate(${dx.toFixed(1)}px, ${dy.toFixed(1)}px) scale(${scaleX.toFixed(2)}, ${scaleY.toFixed(2)})`,
          opacity: options.fromOpacity !== undefined ? options.fromOpacity : 0.88,
          zIndex: 35
        },
        {
          transform: "translate(0px, 0px) scale(1, 1)",
          opacity: 1,
          zIndex: 35
        }
      ],
      {
        duration: options.duration || 310,
        delay: options.delay || 0,
        easing: "cubic-bezier(0.22, 1, 0.36, 1)",
        fill: "both"
      }
    );
  } catch (_) {}
}

function reconcileKeyedList(container, items, getKey, createEl, updateEl, options = {}) {
  if (!container) return;

  const existingHint = container.querySelector(":scope > [data-empty-hint]");
  if (items.length === 0) {
    const existingKeyed = Array.from(container.querySelectorAll(":scope > [data-render-key]"));
    existingKeyed.forEach(oldEl => {
      const key = oldEl.dataset.renderKey;
      const rect = oldEl.getBoundingClientRect();
      if (options.onExit) {
        options.onExit(oldEl, key, rect);
      } else {
        oldEl.remove();
      }
    });
    if (options.emptyHintHtml) {
      if (!existingHint) {
        const hint = document.createElement("div");
        hint.className = options.emptyHintClass || "zone-hint";
        hint.dataset.emptyHint = "true";
        hint.innerHTML = options.emptyHintHtml;
        container.appendChild(hint);
      } else {
        patchInnerHtmlIfChanged(existingHint, options.emptyHintHtml);
      }
    }
    return;
  }

  if (existingHint) {
    existingHint.remove();
  }

  const existingMap = new Map();
  const existingRects = new Map();
  Array.from(container.querySelectorAll(":scope > [data-render-key]")).forEach(child => {
    const k = child.dataset.renderKey;
    existingMap.set(k, child);
    existingRects.set(k, child.getBoundingClientRect());
  });

  // Also clear any legacy non-keyed children left over from initial HTML
  Array.from(container.children).forEach(child => {
    if (!child.dataset.renderKey && !child.dataset.emptyHint) {
      child.remove();
    }
  });

  const nextKeys = new Set(items.map((item, idx) => String(getKey(item, idx))));
  existingMap.forEach((oldEl, key) => {
    if (!nextKeys.has(key)) {
      const rect = existingRects.get(key);
      if (options.onExit) {
        options.onExit(oldEl, key, rect);
      } else {
        oldEl.remove();
      }
      existingMap.delete(key);
    }
  });

  const newlyEntered = [];
  let cursor = container.firstElementChild;

  items.forEach((item, idx) => {
    const key = String(getKey(item, idx));
    let el = existingMap.get(key);
    const isNew = !el;
    if (isNew) {
      el = createEl(item, idx);
      el.dataset.renderKey = key;
    }
    updateEl(el, item, idx, isNew);

    if (el !== cursor) {
      moveOrInsertBefore(container, el, cursor);
    } else {
      cursor = cursor.nextElementSibling;
    }

    if (isNew) {
      newlyEntered.push({ el, item, idx, key });
    } else if (options.animateMove && !prefersReducedMotion()) {
      const prevRect = existingRects.get(key);
      if (prevRect) {
        animateFlipEntry(el, prevRect, { duration: 220, fromOpacity: 1 });
      }
    }
  });

  if (options.onEnter && newlyEntered.length > 0) {
    newlyEntered.forEach(({ el, item, idx, key }) => {
      options.onEnter(el, item, idx, key);
    });
  }
}

let hasInitialHandRendered = false;

function buildManaPoolItems() {
  const items = [];
  for (const col of COLORS) {
    if (state.manaPool[col] > 0) {
      items.push({
        key: `pip_${col}`,
        cls: `mana-pip pip-${col}`,
        count: state.manaPool[col],
        text: `{${col}} ×${state.manaPool[col]}`,
        title: `${COLOR_NAMES[col]} in Mana Pool`
      });
    }
  }
  if (state.manaPool.C > 0) {
    items.push({
      key: "pip_C",
      cls: "mana-pip pip-C",
      count: state.manaPool.C,
      text: `{C} ×${state.manaPool.C}`,
      title: "Colorless Mana in Mana Pool"
    });
  }
  if (state.manaPool.ANY > 0) {
    items.push({
      key: "pip_ANY",
      cls: "mana-pip pip-W",
      count: state.manaPool.ANY,
      text: `★ Wild ×${state.manaPool.ANY}`,
      title: "Any-Color Wild Mana in Mana Pool"
    });
  }

  const untappedCounts = { G: 0, R: 0, B: 0, U: 0, W: 0, C: 0, Dual: 0 };
  state.playerLands.filter(l => !l.tapped).forEach(l => {
    if (l.produces.length > 1) untappedCounts.Dual++;
    else if (l.produces[0]) untappedCounts[l.produces[0]]++;
  });
  const landSummary = Object.entries(untappedCounts)
    .filter(([, cnt]) => cnt > 0)
    .map(([k, cnt]) => k === "Dual" ? `Dual:${cnt}` : `{${k}}:${cnt}`)
    .join(" ");

  if (landSummary) {
    items.push({
      key: "pip_LAND_SUMMARY",
      cls: "mana-pip pip-C",
      count: state.playerLands.filter(l => !l.tapped).length,
      text: `Lands [${landSummary}]`,
      title: "Untapped Lands ready to auto-tap"
    });
  }
  return items;
}

function captureFocusedCardSelector() {
  if (isHeadlessEnv()) return null;
  const active = document.activeElement;
  if (!active || !active.dataset) return null;
  if (active.dataset.handUid) return `[data-hand-uid="${active.dataset.handUid}"]`;
  if (active.dataset.creatureUid) return `[data-creature-uid="${active.dataset.creatureUid}"]`;
  if (active.dataset.landUid) return `[data-land-uid="${active.dataset.landUid}"]`;
  if (active.dataset.consumableUid) return `[data-consumable-uid="${active.dataset.consumableUid}"]`;
  return null;
}

function renderBreakdownRows(items) {
  return items.map(it => `
    <div class="breakdown-row">
      <span>${it.label}</span>
      <strong>${it.value}</strong>
    </div>
  `).join("");
}

const KEYWORD_GLOSSARY = {
  "Trample": "Excess combat damage over a blocker's lethal toughness carries through to the Boss.",
  "Haste": "Can attack immediately on the turn it enters the battlefield (ignores Summoning Sickness).",
  "Prowess": "Triggers whenever you cast a noncreature Spell, granting bonus Power or Resonance.",
  "Landfall": "Triggers whenever a Land enters your battlefield (including Fetch Lands and Cultivate).",
  "Double Strike": "Strikes twice in combat (2× Power). Kills blockers on First Strike before they strike back.",
  "Deathtouch": "Any positive combat damage (1+) dealt by this creature is lethal to an enemy blocker.",
  "Lifelink": "Heals your Planeswalker Life equal to the combat Power this creature deals.",
  "Flying": "Can only be blocked by enemy creatures that also have Flying.",
  "Connive": "Draws a card, discards your lowest-value card, and permanently buffs +1/+1 if a nonland was discarded.",
  "Frozen": "Cannot block your attackers or retaliate at the end of this turn.",
  "Freeze": "Taps an enemy creature and prevents it from blocking or retaliating this turn.",
  "Anthem": "Provides passive Power and Toughness bonus (+X/+X) to your attacking creatures.",
  "Dredge": "Allows returning fallen creatures or spells from the graveyard to hand.",
  "Recur": "Retrieves cards from the graveyard back into your deck or hand.",
  "Metalcraft": "Empowers abilities while you control 3 or more artifacts or relics.",
  "Undergrowth": "Scales in combat Power or Resonance based on creatures in your graveyard.",
  "Tribal": "Grants amplified bonuses when playing cards sharing the creature subtype.",
  "Overdrive": "Multiplies combat Resonance when cast under high mana investment.",
  "Ramp": "Puts additional Lands directly onto the battlefield to accelerate your mana pool.",
  "Ritual": "Produces temporary burst mana for the current turn at low cost.",
  "Tokens": "Creates 1/1 creature token copies on the battlefield that attack and trigger synergies.",
  "Bounce": "Returns an enemy blocker to hand or clears it from the combat line.",
  "Burn": "Deals direct combat damage to the Boss or enemy blockers.",
  "Vigilance": "Attacks without tapping or incurring defensive vulnerability.",
  "Ward": "Shields against hostile spells or effects unless an extra cost is paid."
};

function extractCardKeywords(cardOrCreature) {
  const found = new Set();
  (cardOrCreature.keywords || []).forEach(k => found.add(k));
  (cardOrCreature.tempKeywords || []).forEach(k => found.add(k));
  if (cardOrCreature.frozen) found.add("Frozen");
  const rules = String(cardOrCreature.rules || "");
  Object.keys(KEYWORD_GLOSSARY).forEach(kw => {
    if (rules.includes(kw)) found.add(kw);
  });
  return Array.from(found);
}

function getCardPlayabilityInfo(card) {
  if (!card) return { playable: false, badge: "", reason: "", missingPips: [] };
  if (card.type === "Land") {
    if (state.landsPlayedThisTurn >= state.maxLandsPerTurn) {
      return {
        playable: false,
        badge: `Land Limit (${state.landsPlayedThisTurn}/${state.maxLandsPerTurn})`,
        reason: `Unplayable: You have already played ${state.landsPlayedThisTurn}/${state.maxLandsPerTurn} Land this turn.`,
        missingPips: []
      };
    }
    return {
      playable: true,
      badge: "Play Land",
      reason: `Play onto your Mana Base (${state.landsPlayedThisTurn}/${state.maxLandsPerTurn} Land drops used).`,
      missingPips: []
    };
  }

  if (canPlayCard(card)) {
    return {
      playable: true,
      badge: "Cast Spell",
      reason: "Playable — Click to cast (auto-taps optimal untapped Lands).",
      missingPips: []
    };
  }
  const lifeCost = Math.max(0, Math.floor(Number(card.lifeCost) || 0));
  if (lifeCost > 0 && state.playerLife <= lifeCost) {
    return {
      playable: false,
      badge: `Need ${lifeCost + 1}+ Life`,
      reason: `Unplayable: Need at least ${lifeCost + 1} Life to pay the ${lifeCost} Life cost.`,
      missingPips: []
    };
  }

  // Determine exact missing colored mana pips or total mana deficit
  const cost = parseManaCost(card.manaCost || "");
  const genericNeeded = cost.generic;

  const untappedLands = state.playerLands.filter(l => !l.tapped);
  const totalFloating = COLORS.reduce((s, col) => s + (state.manaPool[col] || 0), 0)
    + (state.manaPool.C || 0)
    + (state.manaPool.ANY || 0);
  const totalAvailable = totalFloating + untappedLands.length;

  const missingPips = [];
  let totalColoredReq = 0;
  for (const col of COLORS) {
    const req = cost.pips[col] || 0;
    totalColoredReq += req;
    if (req > 0) {
      const poolHave = (state.manaPool[col] || 0) + (state.manaPool.ANY || 0);
      const landHave = untappedLands.filter(l => l.produces && l.produces.includes(col)).length;
      const deficit = req - (poolHave + landHave);
      for (let i = 0; i < deficit; i++) {
        missingPips.push(`{${col}}`);
      }
    }
  }

  const totalRequired = totalColoredReq + genericNeeded;
  const totalDeficit = Math.max(1, totalRequired - totalAvailable);

  if (missingPips.length > 0) {
    const pipStr = missingPips.join("");
    return {
      playable: false,
      badge: `Missing ${pipStr}`,
      reason: `Unplayable: Missing colored mana ${missingPips.join(", ")}${totalAvailable < totalRequired ? ` (Have ${totalAvailable}/${totalRequired} total mana)` : ""}.`,
      missingPips
    };
  }

  return {
    playable: false,
    badge: `Need +${totalDeficit} Mana`,
    reason: `Unplayable: Need ${totalDeficit} more Mana (Have ${totalAvailable}/${totalRequired}).`,
    missingPips: []
  };
}

function getCardArtTheme(c) {
  const name = String(c.name || "").toLowerCase();
  const sub = String(c.subtype || "").toLowerCase();
  const type = String(c.type || "").toLowerCase();
  const col = c.color || "C";

  if (type === "land" || Array.isArray(c.produces)) {
    if (c.isFetch || sub.includes("fetch")) return "fetch";
    if ((c.produces && c.produces.length > 1) || sub.includes("dual")) return "dual";
    if (col === "G") return "forest";
    if (col === "R") return "mountain";
    if (col === "B") return "swamp";
    if (col === "U") return "island";
    if (col === "W") return "plains";
    if (col === "C") return "construct";
    return "dual";
  }
  if (name.includes("dragon") || sub.includes("dragon") || name.includes("hellkite")) return "dragon";
  if (name.includes("goblin") || sub.includes("goblin") || name.includes("krenko")) return "goblin";
  if (name.includes("angel") || sub.includes("angel") || name.includes("serra") || name.includes("archangel")) return "angel";
  if (name.includes("vampire") || name.includes("demon") || name.includes("archfiend") || name.includes("wurm") || name.includes("grave") || name.includes("obliterator")) return "vampire";
  if (name.includes("bird") || name.includes("drake") || name.includes("phoenix") || name.includes("hawk") || (c.keywords && c.keywords.includes("Flying") && col === "U")) return "bird";
  if (name.includes("mage") || name.includes("wizard") || name.includes("prodigy") || name.includes("delver") || name.includes("pyromancer")) return "wizard";
  if (type === "creature" || c.power !== undefined) {
    if (col === "G") return "beast";
    if (col === "R") return "dragon";
    if (col === "B") return "vampire";
    if (col === "U") return "wizard";
    if (col === "W") return "angel";
    return "construct";
  }
  if (col === "R") return "fire_spell";
  if (col === "B") return "necro_spell";
  if (col === "G") return "nature_spell";
  if (col === "U") return "arcane_spell";
  if (col === "W") return "holy_spell";
  return "arcane_spell";
}

const ART_SVG_PATHS = {
  forest: `<path d="M24 4L10 22h8l-6 14h24l-6-14h8L24 4zm0 32v8" stroke="currentColor" stroke-width="2.2" fill="currentColor" fill-opacity="0.28" stroke-linejoin="round"/>`,
  mountain: `<path d="M4 38L18 10l9 16 7-11 10 23H4z" stroke="currentColor" stroke-width="2.2" fill="currentColor" fill-opacity="0.28" stroke-linejoin="round"/><path d="M18 10l-4 8 4 3 4-3-4-8z" fill="currentColor" fill-opacity="0.55"/>`,
  swamp: `<path d="M28 8a14 14 0 1 0 0 28 11 11 0 0 1 0-28z" fill="currentColor" fill-opacity="0.32" stroke="currentColor" stroke-width="2"/><path d="M6 38h36M12 42h24" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>`,
  island: `<path d="M6 32c5-6 11-6 16 0s11 6 16 0M6 39c5-5 11-5 16 0s11 5 16 0M24 7l-7 17h14L24 7z" stroke="currentColor" stroke-width="2.2" fill="currentColor" fill-opacity="0.26" stroke-linecap="round" stroke-linejoin="round"/>`,
  plains: `<circle cx="24" cy="24" r="8" fill="currentColor" fill-opacity="0.38" stroke="currentColor" stroke-width="2.2"/><path d="M24 4v6m0 28v6M4 24h6m28 0h6M10 10l4 4m20 20l4 4M38 10l-4 4M14 34l-4 4" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/>`,
  fetch: `<polygon points="24,4 29,18 44,24 29,30 24,44 19,30 4,24 19,18" fill="currentColor" fill-opacity="0.28" stroke="currentColor" stroke-width="2.2"/><circle cx="24" cy="24" r="4" fill="currentColor"/>`,
  dual: `<circle cx="19" cy="24" r="11" fill="currentColor" fill-opacity="0.22" stroke="currentColor" stroke-width="2"/><circle cx="29" cy="24" r="11" fill="currentColor" fill-opacity="0.22" stroke="currentColor" stroke-width="2"/>`,
  dragon: `<path d="M24 6L8 18l6 4-8 12 18-6 18 6-8-12 6-4L24 6z" fill="currentColor" fill-opacity="0.32" stroke="currentColor" stroke-width="2.2" stroke-linejoin="round"/><circle cx="24" cy="20" r="3" fill="currentColor"/>`,
  goblin: `<path d="M12 36L36 8l-4 14 8 2L14 40l4-12-6 8z" fill="currentColor" fill-opacity="0.34" stroke="currentColor" stroke-width="2.1" stroke-linejoin="round"/>`,
  angel: `<path d="M24 12c-7-8-18-4-18 6 0 7 8 11 18 20 10-9 18-13 18-20 0-10-11-14-18-6z" fill="currentColor" fill-opacity="0.28" stroke="currentColor" stroke-width="2.2"/><ellipse cx="24" cy="7" rx="9" ry="2.6" fill="none" stroke="currentColor" stroke-width="2"/>`,
  vampire: `<path d="M14 8h20l-3 16a7 7 0 0 1-14 0L14 8zm10 23v9m-7 0h14" fill="currentColor" fill-opacity="0.28" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/>`,
  wizard: `<path d="M6 24s7-12 18-12 18 12 18 12-7 12-18 12S6 24 6 24z" fill="currentColor" fill-opacity="0.22" stroke="currentColor" stroke-width="2.2"/><circle cx="24" cy="24" r="5.5" fill="currentColor"/>`,
  beast: `<path d="M10 36c2-12 9-22 14-28 5 6 12 16 14 28-6-5-10-7-14-7s-8 2-14 7z" fill="currentColor" fill-opacity="0.32" stroke="currentColor" stroke-width="2.2" stroke-linejoin="round"/>`,
  bird: `<path d="M4 22c8-10 15-10 20-2 5-8 12-8 20 2-7 2-13 6-20 14-7-8-13-12-20-14z" fill="currentColor" fill-opacity="0.3" stroke="currentColor" stroke-width="2.2" stroke-linejoin="round"/>`,
  construct: `<polygon points="24,6 40,15 40,33 24,42 8,33 8,15" fill="currentColor" fill-opacity="0.25" stroke="currentColor" stroke-width="2.2"/><circle cx="24" cy="24" r="6" fill="none" stroke="currentColor" stroke-width="2"/>`,
  fire_spell: `<path d="M26 4L10 26h12l-4 18 18-22H24L26 4z" fill="currentColor" fill-opacity="0.38" stroke="currentColor" stroke-width="2.2" stroke-linejoin="round"/>`,
  necro_spell: `<circle cx="24" cy="20" r="12" fill="currentColor" fill-opacity="0.26" stroke="currentColor" stroke-width="2.2"/><path d="M18 31v9h12v-9M20 19h2m4 0h2" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/>`,
  nature_spell: `<path d="M38 10C20 10 10 20 10 38c18 0 28-10 28-28zM10 38L28 20" fill="currentColor" fill-opacity="0.3" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/>`,
  arcane_spell: `<polygon points="24,5 29,17 42,19 32,28 35,41 24,34 13,41 16,28 6,19 19,17" fill="currentColor" fill-opacity="0.28" stroke="currentColor" stroke-width="2.1" stroke-linejoin="round"/>`,
  holy_spell: `<path d="M24 4v40M8 20h32" stroke="currentColor" stroke-width="3.2" stroke-linecap="round"/><circle cx="24" cy="20" r="9" fill="currentColor" fill-opacity="0.25" stroke="currentColor" stroke-width="2"/>`
};

function renderCardArtHtml(c, mode = "hand") {
  const theme = getCardArtTheme(c);
  const svgInner = ART_SVG_PATHS[theme] || ART_SVG_PATHS.arcane_spell;
  return `
    <div class="card-art-frame art-theme-${theme} art-mode-${mode}" aria-hidden="true">
      <svg class="card-art-svg" viewBox="0 0 48 48" focusable="false">${svgInner}</svg>
      <div class="card-art-vignette"></div>
    </div>
  `;
}

function renderKeywordTagsHtml(permKws, tempKws = []) {
  const permHtml = (permKws || []).map(k => {
    const tip = KEYWORD_GLOSSARY[k] ? `${k}: ${KEYWORD_GLOSSARY[k]}` : k;
    return `<span class="kw-tag" tabindex="0" role="note" aria-label="${tip}" title="${tip}">${k}</span>`;
  }).join("");
  const tempHtml = (tempKws || []).map(k => {
    const tip = KEYWORD_GLOSSARY[k] ? `${k} (This Turn): ${KEYWORD_GLOSSARY[k]}` : `${k} (Until end of turn)`;
    return `<span class="kw-tag kw-temp" tabindex="0" role="note" aria-label="${tip}" title="${tip}">${k}</span>`;
  }).join("");
  return permHtml + tempHtml;
}

function renderEvolutionMarkHtml(card) {
  const evolution = getCardEvolutionDefinition(card?.evolutionId);
  return evolution
    ? `<span class="evolution-mark" title="${evolution.name}" aria-label="Evolved: ${evolution.name}">✦</span>`
    : "";
}

function showCardHoverInspector(cardData, sourceEl, contextBadge = "") {
  if (isHeadlessEnv() || !cardData) return;
  const inspector = document.getElementById("card-hover-inspector");
  if (!inspector) return;

  const isCreature = cardData.type === "Creature" || cardData.power !== undefined;
  const pow = isCreature
    ? (cardData.power + (cardData.tempPower || 0) + (cardData.permPowerBonus || 0))
    : 0;
  const tough = isCreature
    ? (cardData.toughness + (cardData.tempToughness || 0) + (cardData.permToughnessBonus || 0))
    : 0;
  const allKws = extractCardKeywords(cardData);
  const foilCls = cardData.foil ? ` foil-card-${cardData.foil}` : "";
  const typeLine = cardData.type
    ? `${cardData.type}${cardData.subtype ? ` — ${cardData.subtype}` : ""}`
    : (Array.isArray(cardData.produces) ? "Land" : "Creature");

  const kwGlossaryHtml = allKws.length > 0
    ? `<div class="inspector-glossary">
        <div class="inspector-glossary-title">KEYWORD GLOSSARY</div>
        ${allKws.map(kw => `
          <div class="inspector-kw-item">
            <strong>${kw}</strong>
            <span>${KEYWORD_GLOSSARY[kw] || "Special combat or triggered ability."}</span>
          </div>
        `).join("")}
      </div>`
    : "";

  inspector.innerHTML = `
    <div class="inspector-card card-color-${cardData.color || "C"}${foilCls}">
      ${cardData.foil ? `<div class="foil-badge">✨ ${cardData.foil} Foil</div>` : ""}
      <div class="card-top-bar">
        <span class="card-title">${cardData.name}${renderEvolutionMarkHtml(cardData)}</span>
        ${cardData.manaCost ? renderManaCostHtml(cardData) : ""}
      </div>
      ${renderCardArtHtml(cardData, "inspector")}
      <div class="card-type-line">${typeLine}</div>
      ${allKws.length > 0 ? `<div class="card-keywords">${renderKeywordTagsHtml(allKws)}</div>` : ""}
      <div class="card-rules inspector-rules">${cardData.rules || (Array.isArray(cardData.produces) ? `Tap to add ${cardData.produces.map(c => `{${c}}`).join(" or ")}.` : "")}</div>
      <div class="card-bottom-bar">
        <span class="inspector-context-pill">${contextBadge}</span>
        ${isCreature ? `<span class="pt-box">${pow}/${tough}</span>` : ""}
      </div>
    </div>
    ${kwGlossaryHtml}
  `;

  if (sourceEl && typeof sourceEl.getBoundingClientRect === "function") {
    const r = sourceEl.getBoundingClientRect();
    const putLeft = r.left > window.innerWidth * 0.58;
    inspector.classList.toggle("dock-left", putLeft);
  }
  inspector.hidden = false;
}

function hideCardHoverInspector() {
  if (isHeadlessEnv()) return;
  const inspector = document.getElementById("card-hover-inspector");
  if (inspector) inspector.hidden = true;
}

function triggerTransientClass(el, cls, durationMs = 320) {
  if (!el || isHeadlessEnv()) return;
  const animationDuration = getCombatAnimationDelay(durationMs);
  if (animationDuration <= 0) return;
  el.classList.remove(cls);
  void el.offsetWidth;
  el.classList.add(cls);
  setTimeout(() => {
    el.classList.remove(cls);
  }, animationDuration);
}

function ensureFxLayerTop() {
  if (isHeadlessEnv()) return null;
  const layer = getEl("fx-layer");
  if (!layer) return null;
  if (typeof layer.showPopover === "function") {
    try {
      if (layer.matches(":popover-open")) {
        layer.hidePopover();
      }
      layer.showPopover();
    } catch (_) {}
  }
  return layer;
}

function spawnFloatingNumber(targetElOrRect, text, variant = "dmg-boss", magnitude = 1, offsetJitter = true) {
  if (isHeadlessEnv() || !targetElOrRect) return;
  const layer = ensureFxLayerTop() || document.getElementById("fx-layer");
  if (!layer) return;

  const rect = typeof targetElOrRect.getBoundingClientRect === "function"
    ? targetElOrRect.getBoundingClientRect()
    : targetElOrRect;
  if (!rect || (rect.width === 0 && rect.height === 0)) return;

  const el = document.createElement("div");
  el.className = `fx-dmg-num ${variant}`;
  el.textContent = text;

  const scale = 1 + Math.min(0.68, Math.log10(Math.max(1, Number(magnitude) || 1)) * 0.28);
  el.style.setProperty("--dmg-scale", scale.toFixed(2));

  const jitterX = offsetJitter ? (Math.random() * 28 - 14) : 0;
  const jitterY = offsetJitter ? (Math.random() * 14 - 7) : 0;
  const cx = rect.left + rect.width / 2 + jitterX;
  const cy = rect.top + Math.min(26, rect.height * 0.35) + jitterY;

  el.style.left = `${cx.toFixed(1)}px`;
  el.style.top = `${cy.toFixed(1)}px`;
  layer.appendChild(el);

  const waitMs = getCombatAnimationDelay(940);
  setTimeout(() => {
    if (el.parentNode) el.remove();
  }, waitMs);
}

const pendingTriggerQueue = [];
let triggerFlushScheduled = false;

function findTriggerSourceElement(label) {
  if (isHeadlessEnv() || !label) return null;
  const clean = String(label).toLowerCase();

  if (typeof state !== "undefined" && Array.isArray(state.relics)) {
    for (const r of state.relics) {
      if (clean.includes(r.name.toLowerCase())) {
        const el = document.querySelector(`#relic-slots [data-relic-id="${r.id}"]`);
        if (el) return el;
      }
    }
  }
  if (typeof state !== "undefined" && Array.isArray(state.playerCreatures)) {
    for (const c of state.playerCreatures) {
      if (clean.includes(c.name.toLowerCase())) {
        const el = document.querySelector(`#player-creatures [data-creature-uid="${c.uid}"]`);
        if (el) return el;
      }
    }
  }
  if (clean.includes("landfall") && typeof state !== "undefined" && state.playerLands.length > 0) {
    const lastLand = state.playerLands[state.playerLands.length - 1];
    const el = document.querySelector(`#player-lands [data-land-uid="${lastLand.uid}"]`);
    if (el) return el;
  }
  if (clean.includes("nyxbloom mana surge")) {
    const surgeRelic = getRelicDefs().find(def => def.manaSurge);
    if (surgeRelic) {
      const el = document.querySelector(`#relic-slots [data-relic-id="${surgeRelic.id}"]`);
      if (el) return el;
    }
  }
  return null;
}

function highlightCombatContributors(combat) {
  if (isHeadlessEnv() || !combat) return;
  const elements = new Set();
  const addElement = el => {
    if (el && elements.size < 8) elements.add(el);
  };
  const activeSynergies = getSynergyStates().filter(syn => syn.power > 0 || syn.mult > 0);
  activeSynergies.forEach(syn => {
    addElement(queryEl(`#synergy-box [data-synergy-id="${syn.id}"]`));
  });

  Object.keys(combat.attackerDamageByUid || {}).forEach(uid => {
    addElement(queryEl(`#player-creatures [data-creature-uid="${uid}"]`));
  });
  const breakdown = [...(combat.powerBreakdown || []), ...(combat.resonanceBreakdown || [])];
  breakdown.forEach(item => {
    addElement(findTriggerSourceElement(item.label));
  });
  [...(state.resonanceSources || []), ...(state.burnSources || [])].forEach(source => {
    addElement(findTriggerSourceElement(source.label));
  });

  activeSynergies.forEach(syn => {
    const contributors = state.playerCreatures.filter(creature => {
      if (syn.id === "goblin") return creature.subtype === "Goblin";
      if (syn.id === "swarm") return true;
      if (syn.id === "titans") return creature.power + (creature.tempPower || 0) >= 5;
      if (syn.id === "skies") return getCreatureKeywords(creature).includes("Flying");
      if (syn.id === "rainbow") {
        return String(creature.color || "").split("").some(color => "GRBUW".includes(color));
      }
      return false;
    });
    contributors.slice(0, 3).forEach(creature => {
      addElement(queryEl(`#player-creatures [data-creature-uid="${creature.uid}"]`));
    });

    if (syn.id === "landfall" && state.playerLands.length > 0) {
      addElement(findTriggerSourceElement("landfall"));
    } else if (syn.id === "rainbow") {
      const lastLand = state.playerLands[state.playerLands.length - 1];
      if (lastLand) addElement(queryEl(`#player-lands [data-land-uid="${lastLand.uid}"]`));
    } else if (syn.id === "grave") {
      addElement(getEl("btn-view-graveyard"));
    }

    getRelicDefs().filter(def => (def.boosts && def.boosts[syn.id] > 1)).forEach(def => {
      addElement(findTriggerSourceElement(def.name));
    });
  });

  elements.forEach(el => triggerTransientClass(el, "source-trigger-pulse", 560));
}

function flushTriggerNotifications() {
  triggerFlushScheduled = false;
  if (isHeadlessEnv()) {
    pendingTriggerQueue.length = 0;
    return;
  }
  while (pendingTriggerQueue.length > 0) {
    const ev = pendingTriggerQueue.shift();
    if (ev.kind === "resonance") {
      const srcEl = findTriggerSourceElement(ev.label);
      const pillEl = document.querySelector(".mult-pill");
      const badgeText = ev.mode === "mult" ? `×${ev.val} Mult!` : `+${ev.val} Mult`;
      if (srcEl) {
        triggerTransientClass(srcEl, "source-trigger-pulse", 580);
        spawnFloatingNumber(srcEl, badgeText, "dmg-mult", ev.val * 3);
      } else if (pillEl) {
        spawnFloatingNumber(pillEl, badgeText, "dmg-mult", ev.val * 2);
      }
      if (pillEl) {
        triggerTransientClass(pillEl, "tally-pill-pop", 360);
      }
    } else if (ev.kind === "burn") {
      const srcEl = findTriggerSourceElement(ev.label) || document.querySelector(".power-pill");
      const pillEl = document.querySelector(".power-pill");
      if (srcEl) {
        triggerTransientClass(srcEl, "source-trigger-pulse", 540);
        spawnFloatingNumber(srcEl, `+${ev.amount} Burn Pwr`, "dmg-burn", ev.amount * 2);
      }
      if (pillEl) {
        triggerTransientClass(pillEl, "tally-pill-pop", 340);
      }
    } else if (ev.kind === "life" && ev.amount > 0) {
      const lifeChip = document.querySelector(".life-chip");
      if (lifeChip) {
        spawnFloatingNumber(lifeChip, `+${ev.amount} HP`, "dmg-heal", ev.amount * 2);
      }
    }
  }
}

function scheduleTriggerFlush() {
  if (isHeadlessEnv() || triggerFlushScheduled) return;
  triggerFlushScheduled = true;
  Promise.resolve().then(flushTriggerNotifications);
}

function notifyResonanceTrigger(val, label, mode = "add") {
  if (isHeadlessEnv()) return;
  pendingTriggerQueue.push({ kind: "resonance", val, label, mode });
  scheduleTriggerFlush();
}

function notifyBurnTrigger(amount, label) {
  if (isHeadlessEnv()) return;
  pendingTriggerQueue.push({ kind: "burn", amount, label });
  scheduleTriggerFlush();
}

function notifyLifeChange(amount, label) {
  if (isHeadlessEnv()) return;
  pendingTriggerQueue.push({ kind: "life", amount, label });
  scheduleTriggerFlush();
}

let prevEnemyEncounterIdx = -1;
let prevEnemyLifePct = 100;
let ghostBarTimer = null;
let lastPreCombatSnapshot = null;
let bossLifeImpactTimer = null;

function showBossLifeImpact(lifeBar, lethal) {
  if (!lifeBar || isHeadlessEnv()) return;
  if (bossLifeImpactTimer) clearTimeout(bossLifeImpactTimer);

  const impactClass = lethal ? "boss-life-lethal" : "boss-life-impact";
  const duration = getCombatAnimationDelay(lethal ? 620 : 420);
  lifeBar.classList.remove("boss-life-impact", "boss-life-lethal", "reduced-motion");
  if (lifeBar.style?.removeProperty) lifeBar.style.removeProperty("--boss-life-impact-duration");
  void lifeBar.offsetWidth;
  lifeBar.classList.add(impactClass);
  if (duration === 0) lifeBar.classList.add("reduced-motion");
  if (duration > 0 && lifeBar.style?.setProperty) {
    lifeBar.style.setProperty("--boss-life-impact-duration", `${duration}ms`);
  }

  bossLifeImpactTimer = setTimeout(() => {
    lifeBar.classList.remove(impactClass, "reduced-motion");
    if (lifeBar.style?.removeProperty) lifeBar.style.removeProperty("--boss-life-impact-duration");
    bossLifeImpactTimer = null;
  }, duration || 220);
}

function runCombatResolutionChoreography(power, mult, totalDamage) {
  if (isHeadlessEnv()) return;
  const snap = lastPreCombatSnapshot;
  const bossWrap = queryEl("#boss-panel .life-bar-wrap") || getEl("boss-panel");
  const bossRect = bossWrap ? bossWrap.getBoundingClientRect() : null;
  const attackerOrder = new Map();

  // 1. Stagger attacker lunges and matching blocker reactions into a readable hit sequence.
  const firstBlockerByAttacker = {};
  if (snap && snap.combat && snap.combat.blockerAssignments) {
    Object.entries(snap.combat.blockerAssignments).forEach(([bUid, bInfo]) => {
      if (bInfo && bInfo.attackerUid && !firstBlockerByAttacker[bInfo.attackerUid]) {
        firstBlockerByAttacker[bInfo.attackerUid] = bUid;
      }
    });
  }

  if (snap && snap.attackerRects) {
    let attackerIndex = 0;
    const lungeDuration = getCombatAnimationDelay(340);
    snap.attackerRects.forEach((attRect, uid) => {
      attackerOrder.set(uid, attackerIndex);
      const staggerDelay = getCombatAnimationDelay(Math.min(attackerIndex * 65, 260));
      attackerIndex++;
      const targetBlockerUid = firstBlockerByAttacker[uid];
      let targetRect = bossRect;
      if (targetBlockerUid && snap.blockerRects.has(targetBlockerUid)) {
        targetRect = snap.blockerRects.get(targetBlockerUid);
      }
      if (lungeDuration > 0 && targetRect) {
        const launch = () => {
          const liveEl = queryEl(`#player-creatures [data-creature-uid="${uid}"]`);
          if (!liveEl || typeof liveEl.animate !== "function") return;
          const dx = ((targetRect.left + targetRect.width / 2) - (attRect.left + attRect.width / 2)) * 0.42;
          const dy = Math.min(-24, ((targetRect.top + targetRect.height / 2) - (attRect.top + attRect.height / 2)) * 0.45);
          try {
            liveEl.animate(
              [
                { transform: "translate(0px, 0px) scale(1)" },
                { transform: `translate(${dx.toFixed(1)}px, ${dy.toFixed(1)}px) scale(1.09)`, offset: 0.42 },
                { transform: "translate(0px, 0px) scale(1)" }
              ],
              { duration: lungeDuration, easing: "cubic-bezier(0.18, 1.35, 0.36, 1)" }
            );
          } catch (_) {}
        };
        if (staggerDelay > 0) setTimeout(launch, staggerDelay);
        else launch();
      }
    });
  }

  if (snap && snap.combat && snap.combat.blockerAssignments && snap.blockerRects) {
    Object.entries(snap.combat.blockerAssignments).forEach(([bUid, bInfo]) => {
      const bRect = snap.blockerRects.get(bUid);
      const dmgVal = bInfo ? (bInfo.dmgTaken || bInfo.damageTaken || 0) : 0;
      const attackerIndex = attackerOrder.get(bInfo?.attackerUid) || 0;
      const staggerDelay = getCombatAnimationDelay(Math.min(attackerIndex * 65, 260));
      const showBlockerHit = () => {
        const liveBlocker = queryEl(`#enemy-creatures [data-enemy-uid="${bUid}"]`);
        if (liveBlocker) triggerTransientClass(liveBlocker, "card-hit-shake", 380);
        if (bRect && dmgVal > 0) spawnFloatingNumber(bRect, `-${dmgVal}`, "dmg-blocker", dmgVal);
      };
      if (staggerDelay > 0) setTimeout(showBlockerHit, staggerDelay);
      else showBlockerHit();
    });
  }

  highlightCombatContributors(snap?.combat);

  // 2. Balatro-style Score Tally: Power counts up -> Mult slams -> Total slams + Boss damage popup + Screen Shake
  const pwrEl = document.getElementById("calc-power");
  const multEl = document.getElementById("calc-mult");
  const totEl = document.getElementById("calc-total");
  const pwrPill = document.querySelector(".power-pill");
  const multPill = document.querySelector(".mult-pill");
  const totPill = document.querySelector(".total-pill");

  const tallyDuration = getCombatAnimationDelay(260);
  if (tallyDuration > 0 && pwrEl && multEl && totEl) {
    triggerTransientClass(pwrPill, "tally-pill-pop", 280);
    const steps = 6;
    for (let i = 1; i <= steps; i++) {
      setTimeout(() => {
        if (pwrEl) pwrEl.textContent = Math.round((power * i) / steps);
      }, getCombatAnimationDelay(i * 24));
    }
    setTimeout(() => {
      if (multEl) multEl.textContent = mult;
      triggerTransientClass(multPill, "tally-mult-slam", 360);
    }, getCombatAnimationDelay(145));
    setTimeout(() => {
      if (totEl) totEl.textContent = `${totalDamage} DMG`;
      triggerTransientClass(totPill, "tally-total-slam", 440);
    }, tallyDuration);
  } else {
    if (pwrEl) pwrEl.textContent = power;
    if (multEl) multEl.textContent = mult;
    if (totEl) totEl.textContent = `${totalDamage} DMG`;
  }

  const attackerCount = snap?.attackerRects?.size || 0;
  const impactDelay = getCombatAnimationDelay(Math.min(Math.max(0, attackerCount - 1) * 65, 260) + 120);
  const lethal = Boolean(snap && snap.enemyLife > 0 && totalDamage >= snap.enemyLife);
  if (totalDamage > 0) {
    const showBossHit = () => {
      if (bossWrap) showBossLifeImpact(bossWrap, lethal);
      if (bossRect) spawnFloatingNumber(bossRect, `-${totalDamage} DMG`, "dmg-boss", totalDamage, false);

      const shakeDelay = getCombatAnimationDelay(1);
      if (shakeDelay > 0) {
        const mainEl = queryEl(".battlefield-main");
        const shakeCls = totalDamage >= 40 ? "screen-shake-lg" : (totalDamage >= 15 ? "screen-shake-md" : "screen-shake-sm");
        triggerTransientClass(mainEl, shakeCls, 440);
      }
    };
    if (impactDelay > 0) setTimeout(showBossHit, impactDelay);
    else showBossHit();
  }
}

let activeHandDragController = null;
const seededHandRects = new Map();

function seedPrevHandRect(uid, rect) {
  seededHandRects.set(uid, rect);
}

// ============================================================================
// RENDER SCHEDULER & INCREMENTAL SUB-RENDERERS
// ============================================================================

const ALL_RENDER_SECTIONS = Object.freeze([
  "boss",
  "math",
  "stats",
  "command",
  "board",
  "hand",
  "window"
]);

let pendingRenderSections = new Set();
let scheduledRenderToken = null;

function renderBossPanel(enc, lifePct) {
  const ambient = Number(enc.plane) >= 2
    ? { tint: "#f39b78", glow: "rgba(243, 125, 89, 0.16)" }
    : { tint: "#65c8c0", glow: "rgba(74, 184, 176, 0.16)" };
  [getEl("boss-panel"), queryEl(".battlefield-main"), getEl("relic-slots")].forEach(el => {
    if (!el || !el.style || typeof el.style.setProperty !== "function") return;
    el.style.setProperty("--encounter-tint", ambient.tint);
    el.style.setProperty("--encounter-glow", ambient.glow);
  });
  setText("plane-badge", `PLANE ${enc.plane} • ${enc.tier}`);
  setText("boss-name", enc.name);
  setText("boss-rule", enc.rule);
  const challenge = typeof getRunChallengeById === "function"
    ? getRunChallengeById(state.challengeId)
    : null;
  const challengeBadge = getEl("run-challenge-badge");
  if (challengeBadge && challenge) {
    challengeBadge.hidden = challenge.id === "standard";
    challengeBadge.textContent = `CHALLENGE • ${challenge.name.toUpperCase()}: ${challenge.description}`;
    challengeBadge.title = challenge.description;
  }
  const campaign = typeof getActiveCampaign === "function" ? getActiveCampaign() : null;
  const campaignBadge = getEl("run-campaign-badge");
  if (campaignBadge && campaign) {
    campaignBadge.hidden = false;
    campaignBadge.textContent = `CAMPAIGN • ${campaign.name.toUpperCase()}`;
    campaignBadge.title = campaign.description;
  }
  const seedBadge = getEl("run-seed-badge");
  if (seedBadge) {
    seedBadge.hidden = !state.runSeed;
    seedBadge.textContent = state.runSeed ? `SEEDED RUN • ${state.runSeed}` : "";
    seedBadge.title = state.runSeed ? `Share this seed to replay the same run: ${state.runSeed}` : "";
  }

  const enemyLifeBar = getEl("enemy-life-bar");
  if (enemyLifeBar && enemyLifeBar.style) {
    const fillDuration = getCombatAnimationDelay(350);
    enemyLifeBar.style.transition = fillDuration > 0
      ? `width ${fillDuration}ms var(--ease-out)`
      : "none";
    enemyLifeBar.style.width = `${lifePct}%`;
  }
  setResourceText("enemy-life-text", `${state.enemyLife} / ${state.enemyMaxLife}`);

  const ghostBarEl = getEl("enemy-life-ghost");
  if (ghostBarEl && ghostBarEl.style) {
    const trailDuration = getCombatAnimationDelay(580);
    ghostBarEl.style.transition = trailDuration > 0
      ? `width ${trailDuration}ms var(--ease-out)`
      : "none";
    if (state.encounterIdx !== prevEnemyEncounterIdx || lifePct >= prevEnemyLifePct) {
      if (ghostBarTimer) {
        clearTimeout(ghostBarTimer);
        ghostBarTimer = null;
      }
      ghostBarEl.style.transition = "none";
      ghostBarEl.style.width = `${lifePct}%`;
      void ghostBarEl.offsetWidth;
      ghostBarEl.style.transition = trailDuration > 0
        ? `width ${trailDuration}ms var(--ease-out)`
        : "none";
    } else {
      if (ghostBarTimer) clearTimeout(ghostBarTimer);
      const trailDelay = getCombatAnimationDelay(220);
      if (trailDelay === 0) {
        ghostBarTimer = null;
        ghostBarEl.style.width = `${lifePct}%`;
      } else {
        ghostBarTimer = setTimeout(() => {
          if (ghostBarEl.style) ghostBarEl.style.width = `${lifePct}%`;
          ghostBarTimer = null;
        }, trailDelay);
      }
    }
  }
  prevEnemyEncounterIdx = state.encounterIdx;
  prevEnemyLifePct = lifePct;

  const encounters = typeof getActiveCampaignEncounters === "function"
    ? getActiveCampaignEncounters()
    : ENCOUNTERS;
  const routeNodes = typeof getActiveCampaignRouteNodes === "function"
    ? getActiveCampaignRouteNodes()
    : CAMPAIGN_ROUTE_NODES;
  const encPos = state.encounterIdx % encounters.length;
  const loop = Math.floor(state.encounterIdx / encounters.length);
  const currentNode = typeof getCurrentRouteNode === "function" ? getCurrentRouteNode() : null;
  const totalRouteSteps = Array.isArray(routeNodes)
    ? Math.max(...routeNodes.map(n => n.step)) + 1
    : encounters.length;
  const curStep = currentNode && typeof currentNode.step === "number" ? currentNode.step + 1 : encPos + 1;
  setText("route-step-badge", `${curStep}/${totalRouteSteps}`);

  const ladderHtml = encounters.map((e, i) =>
    `<span class="ladder-node ${i < encPos ? "done" : ""} ${i === encPos ? "current" : ""}" title="${e.name} (Click to inspect Planar Route)">${i < encPos ? "✓" : i + 1}</span>`
  ).join('<span class="ladder-link"></span>') + (loop > 0 ? `<small class="ladder-loop">Loop ${loop + 1}</small>` : "");
  patchInnerHtmlIfChanged(getEl("encounter-ladder"), ladderHtml);
}

function renderCombatMathAndSynergies(enc, combat, lifePct) {
  setText("calc-power", combat.power);
  setText("calc-mult", combat.mult);
  setText("calc-total", `${combat.totalDamage} DMG`);
  setText("mobile-boss-name", enc.name);
  setText("mobile-boss-life", `${state.enemyLife} / ${state.enemyMaxLife}`);
  setText("mobile-player-life", `${state.playerLife} / ${MAX_LIFE}`);
  setText("mobile-turn-counter", `${state.turn} / ${state.maxTurns}`);
  setText("mobile-projected-damage", `${combat.totalDamage} DMG`);

  const powerTip = combat.powerBreakdown.map(b => `${b.label}: ${b.value}`).join("\n");
  const multTip = combat.resonanceBreakdown.map(b => `${b.label}: ${b.value}`).join("\n");
  const powerPill = queryEl(".power-pill");
  const multPill = queryEl(".mult-pill");
  if (powerPill) powerPill.title = `POWER BREAKDOWN (${combat.power}):\n${powerTip}`;
  if (multPill) multPill.title = `RESONANCE BREAKDOWN (×${combat.mult}):\n${multTip}`;

  const breakdownEl = getEl("math-breakdown-popover");
  if (breakdownEl) {
    patchInnerHtmlIfChanged(breakdownEl, `
      <div class="breakdown-col">
        <div class="breakdown-title">POWER SOURCES (${combat.power})</div>
        ${renderBreakdownRows(combat.powerBreakdown)}
      </div>
      <div class="breakdown-col">
        <div class="breakdown-title">RESONANCE SOURCES (×${combat.mult})</div>
        ${renderBreakdownRows(combat.resonanceBreakdown)}
      </div>
    `);
  }

  const syns = getSynergyStates();
  const bonusTxt = x => [x.mult ? `+${x.mult} Mult` : "", x.power ? `+${x.power} Pwr` : ""].filter(Boolean).join(" ");
  const shown = syns.filter(x => x.count > 0);
  const synergyHtml =
    `<div class="math-header">SYNERGIES</div>` + (shown.length ? shown.map(x => {
      const tip = x.tiers.map(([n, b]) => `${n}+ ${x.unit}: ${bonusTxt({ mult: b.mult, power: b.power }) || "—"}`).join("\n")
        + (x.boost > 1 ? `\n(×${x.boost} relic boost)` : "");
      const pips = x.tiers.map((t, i) => `<i class="syn-pip ${i <= x.tier ? "on" : ""}"></i>`).join("");
      return `<div class="syn-row ${x.tier >= 0 ? "active" : ""}" data-synergy-id="${x.id}" title="${tip}">
        <span class="syn-name">${x.icon} ${x.name}</span>
        <span class="syn-count">${x.count}${x.next ? "/" + x.next : ""}</span>
        <span class="syn-bonus">${bonusTxt(x) || "—"}</span>
        <span class="syn-pips">${pips}</span></div>`;
    }).join("") : `<div class="zone-hint">Cast spells, play lands &amp; build your board to ignite synergies.</div>`);
  patchInnerHtmlIfChanged(getEl("synergy-box"), synergyHtml);

  syns.forEach(x => {
    if (x.tier > (state.synTiers[x.id] ?? -1)) spawnFx(`${x.icon} ${x.name} — Tier ${x.tier + 1}!`, "#ffbe3b");
    state.synTiers[x.id] = x.tier;
  });

  const projPct = Math.min(lifePct, (combat.totalDamage / state.enemyMaxLife) * 100);
  const projEl = getEl("enemy-life-proj");
  if (projEl && projEl.style) {
    projEl.style.left = `${lifePct - projPct}%`;
    projEl.style.width = `${projPct}%`;
  }

  const survivors = state.enemyCreatures.filter(b => !combat.deadBlockerUids.has(b.uid) && !b.frozen);
  const threat = survivors.reduce((s, b) => s + b.power + (enc.staxHideBonus || 0), 0) + (enc.staxDrain || 0);
  const threatEl = getEl("calc-threat");
  if (threatEl) {
    threatEl.textContent = `-${threat} HP`;
    if (threatEl.classList) threatEl.classList.toggle("danger", threat >= state.playerLife);
    const combatEndsEncounter = state.enemyLife > 0 && combat.totalDamage >= state.enemyLife;
    const nextWaveCount = !combatEndsEncounter && state.turn < state.maxTurns
      ? getEnemyWaveSpawnCount(
        enc,
        state.turn + 1,
        state.enemyCreatures.filter(b => !combat.deadBlockerUids.has(b.uid)).length
      )
      : 0;
    threatEl.title = nextWaveCount > 0
      ? `Next turn: ${nextWaveCount}× ${enc.spawn.name} (${enc.spawn.power}/${enc.spawn.toughness + (enc.cenobiteAura || 0)})`
      : "No additional enemy wave next turn";
  }

  const playerLifeEl = getEl("player-life");
  if (playerLifeEl && playerLifeEl.classList) {
    playerLifeEl.classList.toggle("danger", state.playerLife <= 8);
  }

  const lethal = combat.totalDamage >= state.enemyLife && state.enemyLife > 0;
  const finalTurn = state.turn >= state.maxTurns;
  const combatBtn = getEl("btn-combat");
  if (combatBtn) {
    combatBtn.disabled = Boolean(state.runOver || state.combatLocked || state.enemyLife <= 0);
    if (combatBtn.classList) combatBtn.classList.toggle("lethal", lethal && !combatBtn.disabled);
    combatBtn.textContent = state.runOver
      ? "🔒 Run Ended — Choose New Deck"
      : (lethal ? "💥 LETHAL — Finish the Boss!" : "⚔️ Resolve Attack & End Turn");
    combatBtn.title = `Projected damage: ${combat.totalDamage}. Enemy retaliation: ${threat} Life. Shortcut: Space.`;
    if (typeof combatBtn.setAttribute === "function") {
      combatBtn.setAttribute(
        "aria-label",
        `${lethal ? "Lethal attack. " : ""}Resolve attack for ${combat.totalDamage} damage; expect ${threat} retaliation damage.`
      );
    }
  }

  const phase = getEl("phase-indicator");
  if (phase) {
    phase.textContent = state.runOver
      ? "RUN ENDED"
      : (finalTurn ? "FINAL TURN — LETHAL OR BUST" : "MAIN PHASE");
    if (phase.classList) phase.classList.toggle("final", finalTurn || state.runOver);
  }
}

function renderPlayerStatsAndMana() {
  setResourceText("player-life", `${state.playerLife} / ${MAX_LIFE}`);
  setText("turn-counter", `${state.turn} / ${state.maxTurns}`);
  setResourceText("player-gold", `$${state.gold}`);
  setText("land-drop-status", `Lands: ${state.landsPlayedThisTurn}/${state.maxLandsPerTurn}`);

  const manaContainer = getEl("mana-pool-display");
  const manaItems = buildManaPoolItems();
  reconcileKeyedList(
    manaContainer,
    manaItems,
    item => item.key,
    () => document.createElement("span"),
    (el, item, _idx, isNew) => {
      const prevCount = el._pipCount || 0;
      el.className = item.cls;
      el.textContent = item.text;
      if (item.title) el.title = item.title;
      if (isNew && item.key !== "pip_LAND_SUMMARY") {
        triggerTransientClass(el, "pip-pop-in", 300);
      } else if (!isNew && item.count > prevCount && item.key !== "pip_LAND_SUMMARY") {
        triggerTransientClass(el, "pip-pulse", 300);
      }
      el._pipCount = item.count;
    },
    {
      emptyHintHtml: "Pool Empty — Play or Tap Lands",
      emptyHintClass: "zone-hint",
      onExit(oldEl, key, rect) {
        if (key !== "pip_LAND_SUMMARY") {
          spawnExitGhost(oldEl, rect, "pip-exit-drain", 280);
        } else {
          oldEl.remove();
        }
      }
    }
  );

  setText("library-count", state.library.length);
  setText("graveyard-count", state.graveyard.length);
  setText("archetype-badge", `${state.deckArchetype.badge} (${state.masterDeck.length} Cards)`);

  const mullBtn = getEl("btn-mulligan");
  if (mullBtn) {
    mullBtn.textContent = `Free Mulligan (${state.mulligansLeft})`;
    mullBtn.disabled = state.mulligansLeft <= 0 || !state.canMulligan || state.runOver || state.combatLocked;
  }
}

function renderCommandZone() {
  setText("relic-count", `(${state.relics.length}/5)`);
  const relicContainer = getEl("relic-slots");
  const relicSlotItems = [
    ...state.relics.map((r, idx) => ({ type: "relic", relic: r, idx, key: `relic_${r.id}` })),
    ...Array.from({ length: Math.max(0, 5 - state.relics.length) }, (_, i) => ({
      type: "empty",
      key: `empty_relic_${state.relics.length + i}`
    }))
  ];
  reconcileKeyedList(
    relicContainer,
    relicSlotItems,
    item => item.key,
    item => {
      const div = document.createElement("div");
      div.className = item.type === "relic" ? "relic-card" : "relic-empty-slot";
      return div;
    },
    (el, item) => {
      if (item.type === "empty") {
        el.className = "relic-empty-slot";
        delete el.dataset.relicId;
        patchInnerHtmlIfChanged(el, "Empty Relic Slot");
        return;
      }
      const { relic: r, idx } = item;
      const sellVal = Math.floor((r.cost || 4) / 2);
      if (!el.classList.contains("relic-card")) el.className = "relic-card";
      el.dataset.relicId = r.id;
      if (pendingRelicRewardHighlights.delete(r.id)) {
        emphasizeRewardElement(el);
      }
      patchInnerHtmlIfChanged(el, `
        <div class="relic-header-row">
          <div class="relic-name">✦ ${r.name}</div>
          <div class="relic-actions">
            ${state.relics.length > 1 ? `
              <button type="button" class="relic-move" data-move-relic="${idx}" data-move-dir="-1" title="Move Relic Left" aria-label="Move ${r.name} Left" ${idx === 0 ? "disabled" : ""}>◀</button>
              <button type="button" class="relic-move" data-move-relic="${idx}" data-move-dir="1" title="Move Relic Right" aria-label="Move ${r.name} Right" ${idx === state.relics.length - 1 ? "disabled" : ""}>▶</button>
            ` : ""}
            <button type="button" class="relic-sell" data-sell-relic="${r.id}" title="Sell for $${sellVal}">$${sellVal}</button>
          </div>
        </div>
        <div class="relic-desc">${r.desc}</div>
      `);
    },
    { animateMove: true }
  );

  const consCountEl = getEl("consumable-count");
  const consSlotsEl = getEl("consumable-slots");
  if (consCountEl && consSlotsEl) {
    consCountEl.textContent = `(${state.consumables.length}/2)`;
    const consItems = [
      ...state.consumables.map(s => ({ type: "scroll", scroll: s, key: `scroll_${s.uid}` })),
      ...Array.from({ length: Math.max(0, 2 - state.consumables.length) }, (_, i) => ({
        type: "empty",
        key: `empty_scroll_${state.consumables.length + i}`
      }))
    ];
    reconcileKeyedList(
      consSlotsEl,
      consItems,
      item => item.key,
      item => {
        const el = document.createElement(item.type === "scroll" ? "button" : "div");
        if (item.type === "scroll") el.type = "button";
        return el;
      },
      (el, item) => {
        if (item.type === "empty") {
          el.className = "consumable-empty-slot";
          delete el.dataset.consumableUid;
          patchInnerHtmlIfChanged(el, "Empty Scroll Slot");
          return;
        }
        const s = item.scroll;
        el.className = "consumable-card";
        el.dataset.consumableUid = s.uid;
        el.title = `Click to activate ${s.name}`;
        el.disabled = Boolean(state.runOver || state.combatLocked);
        patchInnerHtmlIfChanged(el, `
          <div class="consumable-name">${s.icon} ${s.name}</div>
          <div class="consumable-desc">${s.desc}</div>
        `);
      },
      {
        onExit(oldEl, key, rect) {
          if (key.startsWith("scroll_")) {
            spawnExitGhost(oldEl, rect, "card-exit-spell-cast", 420);
          } else {
            oldEl.remove();
          }
        }
      }
    );
  }
}

function renderBattlefieldLanes(enc, combat, prevHandRects, libRect) {
  const enemyRow = getEl("enemy-creatures");
  reconcileKeyedList(
    enemyRow,
    state.enemyCreatures,
    ec => ec.uid,
    () => document.createElement("div"),
    (el, ec) => {
      const willDie = combat.deadBlockerUids.has(ec.uid);
      const assign = combat.blockerAssignments[ec.uid];
      const strikePow = ec.frozen ? 0 : ec.power + (enc.staxHideBonus || 0);
      const blockSummary = ec.frozen
        ? "Frozen — cannot block or retaliate this turn."
        : (assign
          ? `Blocks ${assign.attackerName} (${willDie ? "Falls in combat" : `Survives & strikes for ${strikePow}`})`
          : `Unassigned — strikes you for ${strikePow} at end of turn.`);

      let statusPillHtml = `<span class="status-pill status-blocker">BLOCKER</span>`;
      if (ec.frozen) {
        statusPillHtml = `<span class="status-pill status-frozen">❄️ FROZEN</span>`;
      } else if (willDie) {
        statusPillHtml = `<span class="status-pill status-lethal">💀 FALLS vs ${assign ? assign.attackerName : "ATK"}</span>`;
      } else if (assign) {
        statusPillHtml = `<span class="status-pill status-blocker">🛡️ BLOCKS ${assign.attackerName}</span>`;
      }

      const keepRetal = el.classList && el.classList.contains("enemy-retaliating") ? " enemy-retaliating" : "";
      const enemyFoilCls = ec.foil ? ` foil-card-${ec.foil}` : "";
      el.className = `board-card card-color-${ec.color}${enemyFoilCls}${willDie ? " will-die" : ""}${ec.frozen ? " frozen-card" : ""}${keepRetal}`;
      el.dataset.enemyUid = ec.uid;
      patchInnerHtmlIfChanged(el, `
        ${ec.foil ? `<div class="foil-badge">✨ ${ec.foil}</div>` : ""}
        <div class="card-top-bar">
          <span class="card-title">${ec.name}</span>
        </div>
        <div class="card-keywords">
          ${renderKeywordTagsHtml(ec.keywords, ec.frozen ? ["Frozen"] : [])}
        </div>
        <div class="card-rules">${blockSummary}</div>
        <div class="card-bottom-bar">
          ${statusPillHtml}
          <span class="pt-box">${ec.power}/${ec.toughness}</span>
        </div>
      `);
    },
    {
      emptyHintHtml: "No Enemy Blockers — All your attackers hit the Boss directly!",
      onExit(oldEl, _key, rect) {
        spawnExitGhost(oldEl, rect, "card-exit-shatter", 450);
      }
    }
  );

  const playerRow = getEl("player-creatures");
  reconcileKeyedList(
    playerRow,
    state.playerCreatures,
    pc => pc.uid,
    () => {
      const btn = document.createElement("button");
      btn.type = "button";
      return btn;
    },
    (el, pc, _idx, isNew) => {
      const pow = pc.power + (pc.tempPower || 0);
      const tough = pc.toughness + (pc.tempToughness || 0);
      const deadCount = combat.deadAttackerCountsByUid[pc.uid] || 0;
      const attAssign = combat.attackerAssignments[pc.uid];
      const damageToBoss = combat.attackerDamageByUid[pc.uid] || 0;
      const count = pc.count || 1;
      const stateClass = pc.summoningSick ? "summoning-sick" : (pc.attacking ? "attacking" : "");
      const casualtyClass = deadCount > 0 ? "will-die" : "";

      let statusBadge = "";
      if (pc.summoningSick) {
        statusBadge = `<span class="status-pill status-sick">SUMMON SICK</span>`;
      } else if (!pc.attacking) {
        statusBadge = `<span class="status-pill status-ready">HOLDING</span>`;
      } else if (deadCount > 0) {
        const blockerHint = attAssign && attAssign.blockerNames.length ? `Blocked by ${attAssign.blockerNames.join(", ")}` : "Dies in combat";
        statusBadge = count > 1
          ? `<span class="status-pill status-lethal" title="${blockerHint}">💀 ${deadCount}/${count} DIE</span>`
          : `<span class="status-pill status-lethal" title="${blockerHint}">💀 DIES IF ATK</span>`;
      } else if (attAssign && attAssign.blockedCount > 0) {
        statusBadge = `<span class="status-pill status-attack" title="Blocked by ${attAssign.blockerNames.join(", ")} (Survives)">⚔️ BLOCKED (OK)</span>`;
      } else {
        statusBadge = `<span class="status-pill status-attack">⚔️ UNBLOCKED</span>`;
      }

      const permKws = pc.keywords || [];
      const tempKws = (pc.tempKeywords || []).filter(k => !permKws.includes(k));
      const foilCls = pc.foil ? ` foil-card-${pc.foil}` : "";

      el.className = `board-card card-color-${pc.color}${foilCls} ${stateClass} ${casualtyClass}`.trim();
      el.dataset.creatureUid = pc.uid;
      el.setAttribute("aria-pressed", !pc.summoningSick && pc.attacking ? "true" : "false");
      el.setAttribute("aria-disabled", pc.summoningSick ? "true" : "false");
      const projectionDescription = pc.summoningSick
        ? "Cannot attack this turn because of summoning sickness."
        : (pc.attacking
          ? (damageToBoss > 0
            ? `Attacking and contributing ${damageToBoss} unblocked power to ${combat.totalDamage} projected damage.`
            : `Attacking but blocked; contributes no direct Boss damage to ${combat.totalDamage} projected damage.`)
          : `Holding back; current projected damage is ${combat.totalDamage}.`);
      el.title = projectionDescription;
      el.setAttribute("aria-label", `${pc.name}, ${pow}/${tough}. ${projectionDescription} Activate to toggle attacking.`);

      patchInnerHtmlIfChanged(el, `
        ${pc.foil ? `<div class="foil-badge">✨ ${pc.foil}</div>` : ""}
        <div class="card-top-bar">
          <span class="card-title">${pc.name}${renderEvolutionMarkHtml(pc)}</span>
          ${count > 1 ? `<span class="stack-count-badge">×${count}</span>` : ""}
        </div>
        <div class="card-keywords">
          ${renderKeywordTagsHtml(permKws, tempKws)}
        </div>
        <div class="card-rules">${pc.rules}</div>
        <div class="card-bottom-bar">
          ${statusBadge}
          <span class="pt-box">${pow}/${tough}</span>
        </div>
      `);

      if (!isNew) {
        if ((el._prevPow !== undefined && pow > el._prevPow) || (el._prevTough !== undefined && tough > el._prevTough)) {
          triggerTransientClass(el.querySelector(".pt-box"), "pt-buff-pop", 340);
        }
        if (el._prevCount !== undefined && count > el._prevCount) {
          triggerTransientClass(el.querySelector(".stack-count-badge"), "stack-buff-pop", 340);
        }
      }
      el._prevPow = pow;
      el._prevTough = tough;
      el._prevCount = count;
    },
    {
      emptyHintHtml: "Your Battlefield is empty. Cast Creatures or Token spells from your hand!",
      onEnter(el, pc) {
        const fromRect = prevHandRects.get(pc.uid);
        if (fromRect) {
          animateFlipEntry(el, fromRect, { duration: 320 });
        }
      },
      onExit(oldEl, _key, rect) {
        spawnExitGhost(oldEl, rect, "card-exit-shatter", 450);
      }
    }
  );

  const landRow = getEl("player-lands");
  reconcileKeyedList(
    landRow,
    state.playerLands,
    l => l.uid,
    () => {
      const btn = document.createElement("button");
      btn.type = "button";
      return btn;
    },
    (el, l) => {
      const enhDef = l.landEnhancement && typeof getLandEnhancementDefinition === "function"
        ? getLandEnhancementDefinition(l.landEnhancement)
        : null;
      const pipBadges = l.landEnhancement === "prismatic"
        ? `<span class="cost-pip cost-pip-generic" title="Prismatic — Any Color">★</span>`
        : l.produces.map(col => `<span class="cost-pip cost-pip-${col}">${col}</span>`).join("");
      const enhCls = enhDef ? ` land-enhanced land-enh-${enhDef.id}` : "";
      const fusedCls = l.fused ? " land-fused" : "";
      el.className = `land-card card-color-${l.color}${enhCls}${fusedCls}${l.tapped ? " tapped" : ""}`;
      el.dataset.landUid = l.uid;
      el.setAttribute("aria-disabled", l.tapped ? "true" : "false");
      const baseHint = l.tapped
        ? "Untaps next turn"
        : (l.fused
          ? l.rules.replace(/^Fused Land — /, "")
          : (l.landEnhancement === "prismatic" || l.produces.length > 1
            ? "Click to pick color"
            : `Tap for {${l.produces[0]}}`));
      const enhBadgeHtml = enhDef
        ? `<span class="land-enhancement-badge" title="${enhDef.desc}">${enhDef.icon} ${enhDef.name}</span>`
        : "";
      const overchargeHtml = !l.tapped && !l.isFetch
        ? `<span role="button" tabindex="0" class="land-overcharge-btn" data-overcharge-land="${l.uid}" title="Overcharge: Crack to Graveyard for +2 Mana or +2 Resonance">⚡ Overcharge</span>`
        : "";
      patchInnerHtmlIfChanged(el, `
        <div class="card-top-bar">
          <span class="card-title">${l.name}</span>
          <span class="mana-cost-badge">${l.tapped ? `<span class="kw-tag">Tapped</span>` : pipBadges}</span>
        </div>
        ${enhBadgeHtml ? `<div class="land-meta-row">${enhBadgeHtml}</div>` : ""}
        <div class="card-rules">${baseHint}</div>
        ${overchargeHtml ? `<div class="land-actions-row">${overchargeHtml}</div>` : ""}
      `);
    },
    {
      emptyHintHtml: "Play a Land from your hand (Basic Lands, Dual Lands, or Fetch Lands).",
      onEnter(el, l) {
        const fromRect = prevHandRects.get(l.uid) || libRect;
        if (fromRect) {
          animateFlipEntry(el, fromRect, { duration: 300 });
        }
      },
      onExit(oldEl, _key, rect) {
        spawnExitGhost(oldEl, rect, "card-exit-shatter", 360);
      }
    }
  );

  if (!state.combatLocked) {
    const attackerRects = new Map();
    queryAll("#player-creatures [data-creature-uid]").forEach(el => {
      const uid = el.dataset.creatureUid;
      const pc = state.playerCreatures.find(c => c.uid === uid);
      if (pc && pc.attacking && !pc.summoningSick && typeof el.getBoundingClientRect === "function") {
        attackerRects.set(uid, el.getBoundingClientRect());
      }
    });
    const blockerRects = new Map();
    queryAll("#enemy-creatures [data-enemy-uid]").forEach(el => {
      if (typeof el.getBoundingClientRect === "function") {
        blockerRects.set(el.dataset.enemyUid, el.getBoundingClientRect());
      }
    });
    lastPreCombatSnapshot = {
      combat,
      enemyLife: state.enemyLife,
      attackerRects,
      blockerRects
    };
  }
}

function renderHandZone(prevHandRects, libRect, boardUidSet) {
  setText("hand-count", state.hand.length);
  const handRow = getEl("player-hand");
  const count = state.hand.length;
  const containerWidth = (handRow && handRow.clientWidth) ? handRow.clientWidth : 900;
  const cardWidth = 148;
  const sampleLayout = calculateFanLayout(0, count, containerWidth, cardWidth);
  if (handRow && handRow.style) {
    handRow.style.setProperty("--hand-overlap", `${sampleLayout.overlap}px`);
    handRow.style.setProperty("--card-count", count);
  }

  reconcileKeyedList(
    handRow,
    state.hand,
    c => c.uid,
    () => {
      const btn = document.createElement("button");
      btn.type = "button";
      return btn;
    },
    (el, c, idx) => {
      const playability = getCardPlayabilityInfo(c);
      const playable = playability.playable;
      const isCreature = c.type === "Creature";
      const dispPow = isCreature ? c.power + (c.permPowerBonus || 0) : 0;
      const dispTough = isCreature ? c.toughness + (c.permToughnessBonus || 0) : 0;
      const foilCls = c.foil ? ` foil-card-${c.foil}` : "";
      const isCurrentlyDragged = activeHandDragController && activeHandDragController.getDraggedCardUid() === c.uid;
      const baseClass = `hand-card card-color-${c.color}${foilCls} ${playable ? "playable" : "unplayable"}`;
      el.className = isCurrentlyDragged ? `${baseClass} is-dragging${!playable ? " drag-invalid" : ""}` : baseClass;
      el.dataset.handUid = c.uid;
      el.setAttribute("aria-disabled", playable ? "false" : "true");
      el.title = playability.reason;
      el.style.setProperty("--card-idx", idx);
      el.style.setProperty("--card-count", count);

      const layout = calculateFanLayout(idx, count, containerWidth, cardWidth);
      el.style.setProperty("--fan-rot", `${layout.rot}deg`);
      el.style.setProperty("--fan-y", `${layout.y}px`);
      el.style.setProperty("--fan-x", "0px");

      const enhDef = c.landEnhancement && typeof getLandEnhancementDefinition === "function"
        ? getLandEnhancementDefinition(c.landEnhancement)
        : null;
      const landRulesText = enhDef ? `${c.rules} ${enhDef.icon} ${enhDef.name}: ${enhDef.desc}` : c.rules;

      patchInnerHtmlIfChanged(el, `
        ${idx < 9 ? `<span class="hand-key-badge" aria-hidden="true">${idx + 1}</span>` : ""}
        ${c.foil ? `<div class="foil-badge">✨ ${c.foil}</div>` : ""}
        ${enhDef ? `<div class="foil-badge land-enh-pill">${enhDef.icon} ${enhDef.name}</div>` : ""}
        <div>
          <div class="card-top-bar">
            <span class="card-title">${c.name}${renderEvolutionMarkHtml(c)}</span>
            ${renderManaCostHtml(c)}
          </div>
          <div class="card-type-line">${c.type}${c.subtype ? ` — ${c.subtype}` : ""}</div>
          <div class="card-keywords">
            ${renderKeywordTagsHtml(c.keywords || [])}
          </div>
        </div>
        <div class="card-rules">${landRulesText}</div>
        <div class="card-bottom-bar">
          <span class="card-type-line">${playability.badge}</span>
          ${isCreature ? `<span class="pt-box">${dispPow}/${dispTough}</span>` : ""}
        </div>
      `);
    },
    {
      animateMove: true,
      onEnter(el, _c, idx) {
        if (hasInitialHandRendered && libRect) {
          animateFlipEntry(el, libRect, { duration: 280, delay: Math.min(idx * 35, 180), fromOpacity: 0.5 });
        }
      },
      onExit(oldEl, key, rect) {
        if (boardUidSet.has(key)) {
          oldEl.remove();
        } else {
          const exitRect = prevHandRects.get(key) || rect;
          spawnExitGhost(oldEl, exitRect, "card-exit-spell-cast", 420);
        }
      }
    }
  );
  hasInitialHandRendered = true;
}

function renderDesktopAndWindowStatus() {
  if (!state.combatLocked) {
    saveRunState(Boolean(isShopDialogOpen() || state.enemyLife <= 0));
  }
  if (typeof DesktopBridge !== "undefined") {
    DesktopBridge.updateWindowTitle(state);
    setText("desktop-mode-badge", DesktopBridge.isDesktopApp() ? "APP" : "WEB");
  }
}

function renderIncremental(sections = ALL_RENDER_SECTIONS) {
  if (isHeadlessEnv() || !getEl("plane-badge")) return;

  const sectionSet = new Set(Array.isArray(sections) && sections.length ? sections : ALL_RENDER_SECTIONS);
  const focusSelector = captureFocusedCardSelector();

  const prevHandRects = new Map(seededHandRects);
  if (sectionSet.has("board") || sectionSet.has("hand")) {
    seededHandRects.clear();
    queryAll("#player-hand [data-hand-uid]").forEach(el => {
      if (!prevHandRects.has(el.dataset.handUid) && typeof el.getBoundingClientRect === "function") {
        prevHandRects.set(el.dataset.handUid, el.getBoundingClientRect());
      }
    });
  }
  const libBtnEl = getEl("btn-view-library");
  const libRect = (libBtnEl && typeof libBtnEl.getBoundingClientRect === "function")
    ? libBtnEl.getBoundingClientRect()
    : null;

  const boardUidSet = new Set([
    ...state.playerCreatures.map(c => c.uid),
    ...state.playerLands.map(l => l.uid)
  ]);

  const enc = getCurrentEncounter();
  const lifePct = Math.max(0, Math.min(100, (state.enemyLife / state.enemyMaxLife) * 100));
  const needsCombat = sectionSet.has("math") || sectionSet.has("board");
  const combat = needsCombat ? calculateProjectedCombat() : null;

  if (sectionSet.has("boss")) {
    renderBossPanel(enc, lifePct);
  }
  if (sectionSet.has("math") && combat) {
    renderCombatMathAndSynergies(enc, combat, lifePct);
  }
  if (sectionSet.has("stats")) {
    renderPlayerStatsAndMana();
  }
  if (sectionSet.has("command")) {
    renderCommandZone();
  }
  if (sectionSet.has("board") && combat) {
    renderBattlefieldLanes(enc, combat, prevHandRects, libRect);
  }
  if (sectionSet.has("hand")) {
    renderHandZone(prevHandRects, libRect, boardUidSet);
  }

  flushTriggerNotifications();

  if (focusSelector) {
    const restored = queryEl(focusSelector);
    if (restored && typeof restored.focus === "function") {
      restored.focus();
    }
  }

  if (sectionSet.has("window")) {
    renderDesktopAndWindowStatus();
  }
}

function flushScheduledRender() {
  if (scheduledRenderToken != null) {
    if (typeof cancelAnimationFrame === "function" && typeof scheduledRenderToken === "number") {
      try { cancelAnimationFrame(scheduledRenderToken); } catch (_) {}
    }
    scheduledRenderToken = null;
  }
  if (pendingRenderSections.size === 0) return false;
  const sections = Array.from(pendingRenderSections);
  pendingRenderSections.clear();
  renderIncremental(sections);
  return true;
}

function scheduleRender(sections = ALL_RENDER_SECTIONS) {
  const list = Array.isArray(sections) && sections.length ? sections : ALL_RENDER_SECTIONS;
  for (const s of list) pendingRenderSections.add(s);
  if (scheduledRenderToken != null) return;
  if (typeof requestAnimationFrame === "function") {
    scheduledRenderToken = requestAnimationFrame(() => {
      scheduledRenderToken = null;
      flushScheduledRender();
    });
  } else {
    scheduledRenderToken = Promise.resolve().then(() => {
      scheduledRenderToken = null;
      flushScheduledRender();
    });
  }
}

function renderAll() {
  pendingRenderSections.clear();
  renderIncremental(ALL_RENDER_SECTIONS);
}

function renderShop() {
  if (isHeadlessEnv()) return;

  setResourceText("shop-gold", `$${state.gold}`);
  const rewardDuration = getCombatAnimationDelay(460);
  const rewardClass = key => pendingShopRewardHighlights.has(key) && rewardDuration > 0 ? " reward-enter" : "";
  const rewardStyle = key => pendingShopRewardHighlights.has(key) && rewardDuration > 0
    ? ` style="--reward-enter-duration:${rewardDuration}ms"`
    : "";
  const rerollBtn = getEl("btn-reroll-shop");
  if (rerollBtn) {
    rerollBtn.disabled = state.gold < 2;
  }

  const relicBox = getEl("shop-relics");
  if (relicBox) {
    relicBox.innerHTML = state.shopStock.relics.map((r, i) => `
      <div class="shop-item-card${rewardClass(`relic_${r.id}`)}"${rewardStyle(`relic_${r.id}`)}>
        <div class="shop-item-top">
          <span class="shop-item-name">✨ ${r.name}</span>
          <button type="button" class="btn-buy" data-buy-relic="${i}"
            ${r.bought || state.gold < r.cost || state.relics.length >= 5 ? "disabled" : ""}>
            ${r.bought ? "OWNED" : `$${r.cost}`}
          </button>
        </div>
        <div class="relic-desc">${r.desc}</div>
      </div>
    `).join("");
  }

  const cardsBox = getEl("shop-cards");
  if (cardsBox) {
    cardsBox.innerHTML = state.shopStock.cards.map((item, i) => {
      const c = item.card;
      return `
        <div class="shop-item-card${rewardClass(`card_${c.id}`)}"${rewardStyle(`card_${c.id}`)}>
          <div class="shop-item-top">
            <span class="shop-item-name">${c.name} ${renderManaCostHtml(c)}</span>
            <button type="button" class="btn-buy" data-buy-card="${i}"
              ${item.bought || state.gold < item.cost ? "disabled" : ""}>
              ${item.bought ? "DRAFTED" : `$${item.cost}`}
            </button>
          </div>
          <div class="relic-desc">${c.rules}</div>
        </div>
      `;
    }).join("");
  }

  const upgBox = getEl("shop-upgrades");
  if (upgBox) {
    const thinCheck = canSafelyThinBasics();
    const purgeCheck = typeof canSafelyPurgeCard === "function" ? canSafelyPurgeCard() : { allowed: true };
    upgBox.innerHTML = state.shopStock.upgrades.map((u, i) => {
      const scrollFull = u.isConsumable && state.consumables.length >= 2;
      const healFull = u.id === "sanctum_heal" && state.playerLife >= MAX_LIFE;
      const thinBlocked = u.id === "exile_thin" && !thinCheck.allowed;
      const purgeBlocked = u.id === "card_purge" && !purgeCheck.allowed;
      const noEvolutionTarget = u.id === "card_evolution" && getAvailableEvolutionTargets().length === 0;
      const noLandEnhancementTarget = u.id === "land_enhancement" && typeof getAvailableLandEnhancementTargets === "function" && getAvailableLandEnhancementTargets().length === 0;
      const noLandFusionTarget = u.id === "land_fusion" && typeof getAvailableLandFusionTargets === "function" && getAvailableLandFusionTargets().length < 2;
      const disabled = u.bought || state.gold < u.cost || scrollFull || healFull || thinBlocked || purgeBlocked || noEvolutionTarget || noLandEnhancementTarget || noLandFusionTarget;

      let btnText = `$${u.cost}`;
      if (u.bought) btnText = "APPLIED";
      else if (scrollFull) btnText = "FULL";
      else if (healFull) btnText = "MAX HP";
      else if (thinBlocked) btnText = "GUARDED";
      else if (purgeBlocked) btnText = "MIN 30";
      else if (noEvolutionTarget) btnText = "NO TARGET";
      else if (noLandEnhancementTarget) btnText = "NO LAND";
      else if (noLandFusionTarget) btnText = "NEED 2 BASICS";

      const descText = u.id === "exile_thin"
        ? `${u.desc} (${thinCheck.reason})`
        : (u.id === "card_purge" ? `${u.desc} (${purgeCheck.reason})` : u.desc);

      const upgIcon = u.isConsumable
        ? "📜"
        : (u.id === "sanctum_heal"
          ? "💚"
          : (u.id === "card_evolution"
            ? "✨"
            : (u.id === "land_enhancement"
              ? "🌋"
              : (u.id === "land_fusion"
                ? "⛰️"
                : (u.id === "card_purge" ? "🔥" : "🔨")))));

      return `
        <div class="shop-item-card${rewardClass(`upgrade_${u.id}`)}"${rewardStyle(`upgrade_${u.id}`)}>
          <div class="shop-item-top">
            <span class="shop-item-name">${upgIcon} ${u.name}</span>
            <button type="button" class="btn-buy" data-buy-upg="${i}"
              ${disabled ? "disabled" : ""}>
              ${btnText}
            </button>
          </div>
          <div class="relic-desc">${descText}</div>
        </div>
      `;
    }).join("");
  }
  pendingShopRewardHighlights.clear();
}

function openCardEvolutionPicker(upgradeIdx) {
  const candidates = getAvailableEvolutionTargets();
  if (candidates.length === 0) return false;

  openTargetPickerModal(
    "Choose a Creature to Evolve",
    "This permanent upgrade can be applied to each Creature only once. Press Escape to cancel.",
    candidates,
    (card, idx) => {
      const power = card.power + (card.permPowerBonus || 0);
      const toughness = card.toughness + (card.permToughnessBonus || 0);
      return `
        <button type="button" class="evolution-option-card card-color-${card.color}" data-target-idx="${idx}">
          <span class="card-title">${card.name}</span>
          <span class="card-type-line">${card.subtype || "Creature"} • ${power}/${toughness}</span>
          <span class="card-keywords">${renderKeywordTagsHtml(card.keywords || [])}</span>
        </button>
      `;
    },
    card => {
      const options = getAvailableCardEvolutionOptions(card);
      openTargetPickerModal(
        `Evolve ${card.name}`,
        "Choose +3/+3 or +1/+1 with Trample. Press Escape to cancel.",
        options,
        (option, idx) => `
          <button type="button" class="evolution-option-card" data-target-idx="${idx}">
            <span class="card-title">${option.name}</span>
            <span class="card-type-line">${option.desc}</span>
          </button>
        `,
        option => completeCardEvolutionPurchase(upgradeIdx, card.uid, option.id),
        { allowCancel: true }
      );
    },
    { allowCancel: true }
  );
  return true;
}

function openCardPurgePicker(upgradeIdx) {
  const candidates = typeof getAvailablePurgeTargets === "function" ? getAvailablePurgeTargets() : [];
  if (candidates.length === 0) return false;

  openTargetPickerModal(
    "Choose a Card to Permanently Purge",
    "Permanently exile this card from your deck for the rest of the campaign (minimum 30 cards). Press Escape to cancel.",
    candidates,
    (card, idx) => {
      const isCreature = card.type === "Creature" || card.power !== undefined;
      const pow = isCreature ? (card.power + (card.permPowerBonus || 0)) : 0;
      const tough = isCreature ? (card.toughness + (card.permToughnessBonus || 0)) : 0;
      const ptText = isCreature ? ` • ${pow}/${tough}` : "";
      const costText = card.manaCost ? ` [${card.manaCost}]` : "";
      return `
        <button type="button" class="evolution-option-card card-color-${card.color || 'C'}" data-target-idx="${idx}">
          <span class="card-title">${card.name}${costText}</span>
          <span class="card-type-line">${card.type || "Card"}${card.subtype ? ` — ${card.subtype}` : ""}${ptText}</span>
          <span class="card-keywords">${renderKeywordTagsHtml(card.keywords || [])}</span>
        </button>
      `;
    },
    card => completeCardPurgePurchase(upgradeIdx, card.uid),
    { allowCancel: true }
  );
  return true;
}

function openOverchargeLandModal(landUid) {
  if (state.runOver || state.combatLocked) return false;
  const land = state.playerLands.find(l => l.uid === landUid);
  if (!land || land.tapped || land.isFetch) return false;

  const manaOptions = typeof getLandManaOptions === "function" ? getLandManaOptions(land) : (land.produces || []);
  const choices = [
    ...manaOptions.map(col => ({
      id: `mana_${col}`,
      title: `⚡ Mana Surge: +2 {${col}} Mana`,
      desc: `Sacrifice ${land.name} to your Graveyard, fire any tap triggers, and add +2 {${col}} (${COLOR_NAMES[col] || col}) to your mana pool.`,
      mode: "mana",
      color: col
    })),
    {
      id: "resonance",
      title: "🌩️ Storm Crack: +2 Resonance",
      desc: `Sacrifice ${land.name} to your Graveyard, fire any tap triggers, and gain +2 Resonance this turn.`,
      mode: "resonance",
      color: null
    }
  ];

  openTargetPickerModal(
    `Overcharge ${land.name}`,
    "Crack this Land to your Graveyard for an immediate burst of power. Press Escape to cancel.",
    choices,
    (choice, idx) => `
      <button type="button" class="evolution-option-card${choice.color ? ` card-color-${choice.color}` : ""}" data-target-idx="${idx}">
        <span class="card-title">${choice.title}</span>
        <span class="card-type-line">${choice.desc}</span>
      </button>
    `,
    choice => overchargeLand(land.uid, choice.mode, choice.color),
    { allowCancel: true }
  );
  return true;
}

function openLandEnhancementPicker(upgradeIdx, isRestFree = false) {
  const candidates = typeof getAvailableLandEnhancementTargets === "function"
    ? getAvailableLandEnhancementTargets()
    : [];
  if (candidates.length === 0) return false;

  openTargetPickerModal(
    isRestFree ? "Leyline Infusion — Choose a Land (Free)" : "Living Land Infusion — Choose a Land",
    "Choose an unenhanced Land in your deck to permanently infuse with a Living Land trait. Press Escape to cancel.",
    candidates,
    (card, idx) => `
      <button type="button" class="evolution-option-card card-color-${card.color || "L"}" data-target-idx="${idx}">
        <span class="card-title">${card.name}</span>
        <span class="card-type-line">${card.subtype || "Land"} • Produces ${(card.produces || []).map(c => `{${c}}`).join(" / ")}</span>
        <span class="card-rules">${card.rules}</span>
      </button>
    `,
    card => {
      openTargetPickerModal(
        `Infuse ${card.name}`,
        "Choose a Living Land Enhancement. Triggers whenever this Land is tapped or overcharged.",
        LAND_ENHANCEMENT_OPTIONS,
        (opt, idx) => `
          <button type="button" class="evolution-option-card" data-target-idx="${idx}">
            <span class="card-title">${opt.icon} ${opt.name}</span>
            <span class="card-type-line">${opt.desc}</span>
          </button>
        `,
        opt => (isRestFree
          ? completeRestLandEnhancement(card.uid, opt.id)
          : completeLandEnhancementPurchase(upgradeIdx, card.uid, opt.id)),
        { allowCancel: true }
      );
    },
    { allowCancel: true }
  );
  return true;
}

function openLandFusionPicker(upgradeIdx, isRestFree = false) {
  const candidates = typeof getAvailableLandFusionTargets === "function"
    ? getAvailableLandFusionTargets()
    : [];
  if (candidates.length < 2) return false;

  openTargetPickerModal(
    isRestFree ? "Leyline Fusion — Pick First Basic Land (Free)" : "Leyline Land Fusion — Pick First Basic Land",
    "Select 2 Basic Lands to merge into 1 custom Fused Land with a tap passive (thins your deck by 1!).",
    candidates,
    (card, idx) => {
      const enhDef = card.landEnhancement ? getLandEnhancementDefinition(card.landEnhancement) : null;
      return `
        <button type="button" class="evolution-option-card card-color-${card.color || "L"}" data-target-idx="${idx}">
          <span class="card-title">${card.name}${enhDef ? ` (${enhDef.icon} ${enhDef.name})` : ""}</span>
          <span class="card-type-line">Basic Land • Produces {${card.produces[0]}}</span>
        </button>
      `;
    },
    firstLand => {
      const remaining = candidates.filter(c => c.uid !== firstLand.uid);
      openTargetPickerModal(
        `Fuse ${firstLand.name} With...`,
        "Pick a second Basic Land to see and forge the resulting Fused Land.",
        remaining,
        (secondLand, idx) => {
          const preview = createFusedLandDefinition(firstLand.produces[0], secondLand.produces[0]);
          return `
            <button type="button" class="evolution-option-card card-color-${preview ? preview.color : "L"}" data-target-idx="${idx}">
              <span class="card-title">${secondLand.name} → ⛰️ ${preview ? preview.name : "Fused Land"}</span>
              <span class="card-type-line">${preview ? preview.rules : ""}</span>
            </button>
          `;
        },
        secondLand => (isRestFree
          ? completeRestLandFusion(firstLand.uid, secondLand.uid)
          : completeLandFusionPurchase(upgradeIdx, firstLand.uid, secondLand.uid)),
        { allowCancel: true }
      );
    },
    { allowCancel: true }
  );
  return true;
}

function openRestLandWorkshopModal(node) {
  const canInfuse = typeof getAvailableLandEnhancementTargets === "function" && getAvailableLandEnhancementTargets().length > 0;
  const canFuse = typeof getAvailableLandFusionTargets === "function" && getAvailableLandFusionTargets().length >= 2;
  if (!canInfuse && !canFuse) return false;

  const actions = [];
  if (canFuse) {
    actions.push({
      id: "fuse",
      title: "⛰️ Leyline Land Fusion (Free)",
      desc: "Merge 2 Basic Lands in your deck into a custom Fused Land with a tap passive."
    });
  }
  if (canInfuse) {
    actions.push({
      id: "infuse",
      title: "🌋 Living Land Infusion (Free)",
      desc: "Infuse a Land in your deck with Volcanic, Resonant, Blighted, or Prismatic."
    });
  }
  actions.push({
    id: "skip",
    title: "Skip Terraform",
    desc: "Continue along the Planar Route without modifying your Lands."
  });

  openTargetPickerModal(
    `${node ? node.title : "Rest Site"} — Leyline Terraform`,
    "Your rest restored your strength. Choose one free Living Lands modification before continuing:",
    actions,
    (act, idx) => `
      <button type="button" class="evolution-option-card" data-target-idx="${idx}">
        <span class="card-title">${act.title}</span>
        <span class="card-type-line">${act.desc}</span>
      </button>
    `,
    act => {
      if (act.id === "fuse") openLandFusionPicker(-1, true);
      else if (act.id === "infuse") openLandEnhancementPicker(-1, true);
    },
    { allowCancel: true }
  );
  return true;
}

const MAX_COMBAT_LOG_ENTRIES = 100;
const COMBAT_LOG_EVENT_LABELS = {
  encounter: "Encounter",
  turn: "Turn",
  play: "Card played",
  trigger: "Trigger",
  combat: "Combat",
  blocker: "Blocker",
  damage: "Damage",
  result: "Result"
};
let combatLogEntries = [];
let combatLogSequence = 0;
let combatLogEncounterKey = null;

function getCombatLogEncounterKey() {
  return `${state.campaignId || DEFAULT_CAMPAIGN_ID}:${state.route?.loop || 0}:${state.encounterIdx}`;
}

function renderCombatLog() {
  if (isHeadlessEnv()) return;
  const entriesEl = getEl("combat-log-entries");
  const statusEl = getEl("combat-log-status");
  if (!entriesEl || !statusEl) return;
  statusEl.textContent = `${combatLogEntries.length} event${combatLogEntries.length === 1 ? "" : "s"} recorded for this encounter (up to ${MAX_COMBAT_LOG_ENTRIES}).`;
  entriesEl.innerHTML = combatLogEntries.length > 0
    ? combatLogEntries.map(entry => `
        <li class="combat-log-entry combat-log-${entry.type}">
          <span class="combat-log-turn">Turn ${entry.turn}</span>
          <strong>${COMBAT_LOG_EVENT_LABELS[entry.type] || "Event"}</strong>
          <span class="combat-log-message">${escapeHtmlText(entry.message)}</span>
        </li>
      `).join("")
    : `<li class="combat-log-empty">No combat events recorded yet.</li>`;
  entriesEl.scrollTop = entriesEl.scrollHeight;
}

function refreshCombatLogView() {
  try {
    renderCombatLog();
  } catch (error) {
    console.error("[Combat Log] Failed to render encounter history.", error);
    const statusEl = getEl("combat-log-status");
    if (statusEl) statusEl.textContent = "Combat log could not be displayed. See the console for details.";
  }
}

function resetCombatLogForEncounter() {
  combatLogEntries = [];
  combatLogSequence = 0;
  combatLogEncounterKey = getCombatLogEncounterKey();
  refreshCombatLogView();
}

function emitCombatLogEvent(type, message, details = {}) {
  const eventType = Object.prototype.hasOwnProperty.call(COMBAT_LOG_EVENT_LABELS, type) ? type : "trigger";
  const encounterKey = getCombatLogEncounterKey();
  if (combatLogEncounterKey !== encounterKey) resetCombatLogForEncounter();
  const safeDetails = {};
  if (details && typeof details === "object" && !Array.isArray(details)) {
    Object.entries(details).slice(0, 8).forEach(([key, value]) => {
      if (typeof value === "string") safeDetails[key.slice(0, 40)] = value.slice(0, 120);
      else if (typeof value === "number" && Number.isFinite(value)) safeDetails[key.slice(0, 40)] = value;
      else if (typeof value === "boolean") safeDetails[key.slice(0, 40)] = value;
    });
  }
  const entry = {
    id: ++combatLogSequence,
    turn: Math.max(0, Math.floor(Number(state.turn) || 0)),
    type: eventType,
    message: String(message || "Combat event").slice(0, 320),
    timestamp: Date.now(),
    details: safeDetails
  };
  combatLogEntries.push(entry);
  if (combatLogEntries.length > MAX_COMBAT_LOG_ENTRIES) {
    combatLogEntries.splice(0, combatLogEntries.length - MAX_COMBAT_LOG_ENTRIES);
  }
  refreshCombatLogView();
  return entry;
}

function getCombatLogEntries() {
  return combatLogEntries.map(entry => ({ ...entry, details: { ...entry.details } }));
}

function openCombatLogModal() {
  if (isHeadlessEnv()) return;
  renderCombatLog();
  safeShowModal("combat-log-dialog");
}

const logHistory = [];
function setLog(msg) {
  if (isHeadlessEnv()) return;
  logHistory.push(msg);
  if (logHistory.length > 10) logHistory.shift();
  const strip = getEl("combat-log-strip");
  if (strip) {
    strip.textContent = msg;
    strip.title = `Open detailed combat log\n${logHistory.join("\n")}`;
  }

  // Staggered enemy retaliation visual sequence when enemies strike at end of turn
  if (typeof msg === "string" && msg.startsWith("⚠️ Enemy Retaliation:")) {
    const enc = typeof getCurrentEncounter === "function" ? getCurrentEncounter() : null;
    const bonusPow = enc && enc.staxHideBonus ? enc.staxHideBonus : 0;
    const lifeChip = queryEl(".life-chip");
    const activeCards = queryAll("#enemy-creatures .board-card:not(.frozen-card)");
    activeCards.forEach((cardEl, idx) => {
      const uid = cardEl.dataset.enemyUid;
      const ec = state.enemyCreatures.find(b => b.uid === uid);
      const strikePow = ec ? ec.power + bonusPow : 1;
      const strikeDelay = getCombatAnimationDelay(idx * 75);
      const strikeDuration = getCombatAnimationDelay(300);
      const showStrike = () => {
        if (strikeDuration > 0 && typeof cardEl.animate === "function") {
          try {
            cardEl.animate(
              [
                { transform: "translateY(0px) scale(1)" },
                { transform: "translateY(26px) scale(1.08)", offset: 0.45 },
                { transform: "translateY(0px) scale(1)" }
              ],
              { duration: strikeDuration, easing: "cubic-bezier(0.18, 1.35, 0.36, 1)" }
            );
          } catch (_) {}
        }
        spawnFloatingNumber(cardEl, `⚔️ ${strikePow}`, "dmg-player", strikePow);
        if (lifeChip) {
          spawnFloatingNumber(lifeChip, `-${strikePow} HP`, "dmg-player", strikePow);
        }
      };
      if (strikeDelay > 0) setTimeout(showStrike, strikeDelay);
      else showStrike();
    });
    if (enc && enc.staxDrain && lifeChip) {
      spawnFloatingNumber(lifeChip, `-${enc.staxDrain} Drain`, "dmg-player", enc.staxDrain);
    }
  }
}

function spawnFx(text, borderColor = "#ffbe3b") {
  if (isHeadlessEnv()) return;
  const layer = ensureFxLayerTop() || getEl("fx-layer");
  if (!layer) return;

  if (typeof text === "string") {
    const combatMatch = text.match(/^⚔️\s*(\d+)\s*×\s*(\d+)\s*=\s*(\d+)\s*DMG!/);
    if (combatMatch) {
      runCombatResolutionChoreography(
        Number(combatMatch[1]),
        Number(combatMatch[2]),
        Number(combatMatch[3])
      );
    }
  }

  const el = document.createElement("div");
  el.className = "fx-pop";
  el.textContent = text;
  el.style.borderColor = borderColor;
  el.style.left = `${45 + (Math.random() * 18 - 9)}%`;
  el.style.top = `${42 + (Math.random() * 16 - 8)}%`;
  layer.appendChild(el);
  setTimeout(() => el.remove(), getCombatAnimationDelay(1100));
}

function showLocalPlayabilityFeedback(card, message) {
  if (isHeadlessEnv()) return false;
  const feedback = getEl("hand-play-feedback");
  if (!feedback || !card || !message) return false;

  if (invalidPlayFeedbackTimer) clearTimeout(invalidPlayFeedbackTimer);
  feedback.textContent = message;
  feedback.hidden = false;
  feedback.dataset.kind = "error";
  const cardEl = queryAll("#player-hand [data-hand-uid]")
    .find(el => el.dataset.handUid === card.uid);
  if (cardEl) {
    const previousTimer = invalidCardFeedbackTimers.get(cardEl);
    if (previousTimer) clearTimeout(previousTimer);
    cardEl.classList.remove("play-invalid-feedback");
    void cardEl.offsetWidth;
    cardEl.classList.add("play-invalid-feedback");
    if (prefersReducedMotion()) cardEl.classList.add("reduced-motion");
    invalidCardFeedbackTimers.set(cardEl, setTimeout(() => {
      cardEl.classList.remove("play-invalid-feedback");
      cardEl.classList.remove("reduced-motion");
      invalidCardFeedbackTimers.delete(cardEl);
    }, 440));
  }

  if (card.type === "Land") {
    const landStatus = getEl("land-drop-status");
    if (landStatus) {
      triggerTransientClass(landStatus, "land-limit-pulse", 440);
    }
  } else {
    const manaBox = queryEl(".mana-pool-box");
    if (manaBox) {
      triggerTransientClass(manaBox, "mana-shortage-pulse", 440);
    }
  }

  invalidPlayFeedbackTimer = setTimeout(() => {
    feedback.hidden = true;
    feedback.textContent = "";
    invalidPlayFeedbackTimer = null;
  }, 3200);
  return true;
}

function clearLocalPlayabilityFeedback() {
  if (invalidPlayFeedbackTimer) {
    clearTimeout(invalidPlayFeedbackTimer);
    invalidPlayFeedbackTimer = null;
  }
  const feedback = getEl("hand-play-feedback");
  if (feedback) {
    feedback.hidden = true;
    feedback.textContent = "";
  }
}

function showCardPlayImpact(card) {
  if (isHeadlessEnv() || !card) return false;

  let target = null;
  let effectClass = "fx-play-impact-spell";
  if (card.type === "Creature") {
    target = queryAll("#player-creatures [data-creature-uid]")
      .find(el => el.dataset.creatureUid === card.uid);
    effectClass = "fx-play-impact-creature";
    if (target) {
      triggerTransientClass(target, "creature-grounded-thump", 360);
    }
  } else if (card.type === "Land") {
    target = queryAll("#player-lands [data-land-uid]")
      .find(el => el.dataset.landUid === card.uid);
    effectClass = "fx-play-impact-land";
    const manaRow = getEl("mana-pool-display") || queryEl(".mana-pool-box");
    if (manaRow) {
      triggerTransientClass(manaRow, "mana-row-ripple", 420);
    }
  } else {
    target = queryEl(".battlefield-table");
  }
  if (!target || typeof target.getBoundingClientRect !== "function") return false;

  const rect = target.getBoundingClientRect();
  if (!rect || (!rect.width && !rect.height)) return false;
  const layer = ensureFxLayerTop() || getEl("fx-layer");
  if (!layer) return false;

  const impact = document.createElement("span");
  impact.className = `fx-play-impact ${effectClass}${prefersReducedMotion() ? " reduced-motion" : ""}`;
  impact.setAttribute("aria-hidden", "true");
  const impactColors = {
    G: ["#2ecc71", "rgba(46, 204, 113, 0.14)", "rgba(46, 204, 113, 0.42)"],
    R: ["#ff6b6b", "rgba(255, 107, 107, 0.14)", "rgba(255, 107, 107, 0.42)"],
    B: ["#9b59b6", "rgba(155, 89, 182, 0.14)", "rgba(155, 89, 182, 0.42)"],
    U: ["#3498db", "rgba(52, 152, 219, 0.14)", "rgba(52, 152, 219, 0.42)"],
    W: ["#f1c40f", "rgba(241, 196, 15, 0.14)", "rgba(241, 196, 15, 0.42)"],
    C: ["#9ba8bd", "rgba(155, 168, 189, 0.14)", "rgba(155, 168, 189, 0.42)"]
  };
  const colorSource = card.type === "Land" && Array.isArray(card.produces)
    ? card.produces
    : [card.color];
  const colorId = colorSource.map(color => String(color || "").toUpperCase())
    .flatMap(color => color.split(""))
    .find(color => impactColors[color]);
  const [color, fill, glow] = impactColors[colorId] || impactColors.B;
  impact.style.setProperty("--impact-color", color);
  impact.style.setProperty("--impact-fill", fill);
  impact.style.setProperty("--impact-glow", glow);
  impact.style.left = `${rect.left + rect.width / 2}px`;
  impact.style.top = `${rect.top + rect.height / 2}px`;
  layer.appendChild(impact);
  setTimeout(() => impact.remove(), prefersReducedMotion() ? 420 : 520);
  return true;
}

function showDropZoneSuccess(zone) {
  if (isHeadlessEnv()) return false;
  const target = zone === "lands"
    ? getEl("player-lands")?.closest(".land-lane")
    : (zone === "creatures"
      ? getEl("player-creatures")?.closest(".player-lane")
      : (zone === "table" ? queryEl(".battlefield-table") : null));
  if (!target) return false;
  const className = zone === "lands"
    ? "drop-success-land"
    : (zone === "creatures" ? "drop-success-creature" : "drop-success-spell");
  const previousTimer = dropZoneSuccessTimers.get(target);
  if (previousTimer) clearTimeout(previousTimer);
  target.classList.remove(className);
  void target.offsetWidth;
  target.classList.add(className);
  if (prefersReducedMotion()) target.classList.add("reduced-motion");
  dropZoneSuccessTimers.set(target, setTimeout(() => {
    target.classList.remove(className);
    target.classList.remove("reduced-motion");
    dropZoneSuccessTimers.delete(target);
  }, 420));
  return true;
}

function getCardCollectionColorIds(card) {
  if (!card || typeof card !== "object") return [];
  if (card.type === "Land" && card.isFetch) return [...COLORS];
  if (card.type === "Land" && Array.isArray(card.produces)) {
    return [...new Set(card.produces)];
  }
  if (card.color === "C") return ["C"];

  const parsed = typeof parseManaCost === "function" ? parseManaCost(card.manaCost || "") : null;
  const manaColors = parsed
    ? COLORS.filter(color => parsed.pips[color] > 0)
    : [];
  if (manaColors.length > 0) return manaColors;
  return COLORS.includes(card.color) ? [card.color] : [];
}

function getCardCollectionTypes(cards = Object.values(CARD_DB)) {
  return [...new Set(cards
    .filter(card => card && typeof card.type === "string")
    .map(card => card.type))]
    .sort((a, b) => a.localeCompare(b));
}

function getCardCollectionManaValue(card) {
  return typeof parseManaCost === "function"
    ? parseManaCost(card?.manaCost || "").total
    : 0;
}

function filterCardCollection(cards, filters = {}) {
  if (!Array.isArray(cards)) return [];
  const query = String(filters.query || "").trim().toLocaleLowerCase();
  const color = filters.color || "all";
  const type = filters.type || "all";
  const sort = filters.sort || "name";
  const matches = cards.filter(card => {
    if (!card || typeof card !== "object") return false;
    if (color !== "all" && !getCardCollectionColorIds(card).includes(color)) return false;
    if (type !== "all" && card.type !== type) return false;
    if (!query) return true;
    const searchable = [
      card.name,
      card.type,
      card.subtype,
      card.manaCost,
      card.rules,
      ...(Array.isArray(card.keywords) ? card.keywords : [])
    ].filter(Boolean).join(" ").toLocaleLowerCase();
    return searchable.includes(query);
  });

  return matches.sort((a, b) => {
    if (sort === "mana") {
      return getCardCollectionManaValue(a) - getCardCollectionManaValue(b) ||
        String(a.name || "").localeCompare(String(b.name || ""));
    }
    if (sort === "type") {
      return String(a.type || "").localeCompare(String(b.type || "")) ||
        String(a.name || "").localeCompare(String(b.name || ""));
    }
    return String(a.name || "").localeCompare(String(b.name || ""));
  });
}

function renderCardCollectionCard(card) {
  const isCreature = card.type === "Creature";
  const color = escapeHtmlText(card.color || "C");
  return `
    <article class="inspector-card collection-card card-color-${color}" aria-label="${escapeHtmlText(`${card.name}, ${card.type}`)}">
      ${renderCardArtHtml(card, "inspector")}
      <div>
        <div class="card-top-bar">
          <span class="card-title">${escapeHtmlText(card.name)}</span>
          ${renderManaCostHtml(card)}
        </div>
        <div class="card-type-line">${escapeHtmlText(card.type)}${card.subtype ? ` — ${escapeHtmlText(card.subtype)}` : ""}</div>
      </div>
      <div class="card-rules">${escapeHtmlText(card.rules || "")}</div>
      <div class="card-bottom-bar">
        <span>${escapeHtmlText((card.keywords || []).join(" • "))}</span>
        ${isCreature ? `<span class="pt-box">${Number(card.power) || 0}/${Number(card.toughness) || 0}</span>` : ""}
      </div>
    </article>
  `;
}

function renderCardCollection() {
  const results = getEl("collection-results");
  const count = getEl("collection-result-count");
  if (!results || !count) return;
  const cards = filterCardCollection(Object.values(CARD_DB), {
    query: getEl("collection-search")?.value || "",
    color: getEl("collection-color-filter")?.value || "all",
    type: getEl("collection-type-filter")?.value || "all",
    sort: getEl("collection-sort")?.value || "name"
  });
  count.textContent = `${cards.length} of ${Object.keys(CARD_DB).length} cards`;
  results.innerHTML = cards.length > 0
    ? cards.map(renderCardCollectionCard).join("")
    : `<div class="collection-empty">No cards match those filters. Try a different search, color, or type.</div>`;
}

function openCardCollectionModal() {
  if (isHeadlessEnv()) return;
  const dialog = getEl("card-collection-dialog");
  if (!dialog) return;
  const typeFilter = getEl("collection-type-filter");
  if (typeFilter && typeFilter.options.length <= 1) {
    typeFilter.innerHTML += getCardCollectionTypes()
      .map(type => `<option value="${escapeHtmlText(type)}">${escapeHtmlText(type)}</option>`)
      .join("");
  }
  renderCardCollection();
  safeShowModal(dialog);
}

function openDeckInspector(title, desc, cards) {
  if (isHeadlessEnv()) return;
  setText("deck-dialog-title", title);
  setText("deck-dialog-desc", desc);
  const grid = getEl("deck-dialog-grid");
  if (grid) {
    if (!Array.isArray(cards) || cards.length === 0) {
      grid.innerHTML = `<div class="zone-hint">Zone is currently empty.</div>`;
    } else {
      grid.innerHTML = cards.map(c => {
        const isCreature = c.type === "Creature";
        const dispPow = isCreature ? c.power + (c.permPowerBonus || 0) : 0;
        const dispTough = isCreature ? c.toughness + (c.permToughnessBonus || 0) : 0;
        const foilCls = c.foil ? ` foil-card-${c.foil}` : "";
        return `
          <div class="hand-card card-color-${c.color}${foilCls}" style="cursor:default">
            ${c.foil ? `<div class="foil-badge">✨ ${c.foil}</div>` : ""}
            <div>
              <div class="card-top-bar">
                <span class="card-title">${c.name}</span>
                ${renderManaCostHtml(c)}
              </div>
              <div class="card-type-line">${c.type}</div>
            </div>
            <div class="card-rules">${c.rules}</div>
            <div class="card-bottom-bar">
              <span></span>
              ${isCreature ? `<span class="pt-box">${dispPow}/${dispTough}</span>` : ""}
            </div>
          </div>
        `;
      }).join("");
    }
  }
  safeShowModal("deck-dialog");
}

function openNewRunModal(forceChoice = false, customTitle = null, customDesc = null) {
  if (isHeadlessEnv()) return;
  const dialog = getEl("newrun-dialog");
  if (!dialog) return;
  newRunForceChoice = Boolean(forceChoice);
  if (typeof dialog.setAttribute === "function") {
    dialog.setAttribute("closedby", newRunForceChoice ? "none" : "any");
  }

  const closeForm = getEl("newrun-close-form");
  if (closeForm) {
    closeForm.hidden = newRunForceChoice;
  }

  setText("newrun-title", customTitle || "Choose Your Planeswalker Deck (40 Cards)");
  setText(
    "newrun-desc",
    customDesc || "Each 40-card deck mixes 17 Lands (including Fetch Lands) and 23 Spells, plus 1 starting Command Zone Relic."
  );

  const challengeSelect = getEl("run-challenge-select");
  if (challengeSelect && Array.isArray(RUN_CHALLENGES)) {
    challengeSelect.innerHTML = RUN_CHALLENGES.map(challenge =>
      `<option value="${challenge.id}">${challenge.name}</option>`
    ).join("");
    challengeSelect.value = RUN_CHALLENGES.some(challenge => challenge.id === state.challengeId)
      ? state.challengeId
      : "standard";
    updateRunChallengeDescription();
  }

  const campaignSelect = getEl("run-campaign-select");
  if (campaignSelect && Array.isArray(CAMPAIGN_DEFINITIONS)) {
    campaignSelect.innerHTML = CAMPAIGN_DEFINITIONS.map(campaign =>
      `<option value="${campaign.id}">${campaign.name}</option>`
    ).join("");
    campaignSelect.value = CAMPAIGN_DEFINITIONS.some(campaign => campaign.id === state.campaignId)
      ? state.campaignId
      : DEFAULT_CAMPAIGN_ID;
    updateRunCampaignDescription();
  }

  const seedInput = getEl("run-seed-input");
  if (seedInput) seedInput.value = state.runSeed || "";
  if (typeof getStarterDeckProgressMessage === "function") {
    setText("starter-unlock-status", getStarterDeckProgressMessage());
  }

  const grid = getEl("starter-decks-grid");
  if (grid) {
    grid.innerHTML = STARTER_DECKS.map(d => {
      const idx = STARTER_DECKS.indexOf(d);
      const relicDef = RELIC_DB.find(r => r.id === d.startingRelic);
      const available = typeof isStarterDeckAvailable !== "function" || isStarterDeckAvailable(d.id);
      const requirement = STARTER_DECK_UNLOCK_REQUIREMENTS[d.id];
      const lockedLabel = requirement
        ? `🔒 Locked — ${requirement.description} to unlock`
        : "🔒 Locked";
      return `
        <button type="button" class="starter-deck-box${available ? "" : " starter-deck-locked"}" data-starter-idx="${idx >= 0 ? idx : 0}" data-starter-id="${d.id}"${available ? "" : ' disabled aria-disabled="true"'}>
          <span class="plane-badge">${d.badge}</span>
          <h3>${d.name}</h3>
          <p class="relic-desc">${d.desc}</p>
          <div class="zone-hint">Starting Relic: <strong>${relicDef ? relicDef.name : d.startingRelic}</strong></div>
          <span class="${available ? "btn-combat" : "starter-deck-lock-label"}" style="margin-top:auto">${available ? "Play This 40-Card Deck" : lockedLabel}</span>
        </button>
      `;
    }).join("");
  }
  safeShowModal(dialog);
}

function updateRunChallengeDescription() {
  const challengeSelect = getEl("run-challenge-select");
  const challenge = typeof getRunChallengeById === "function"
    ? getRunChallengeById(challengeSelect ? challengeSelect.value : "standard")
    : null;
  if (challenge) setText("run-challenge-desc", challenge.description);
}

function updateRunCampaignDescription() {
  const campaignSelect = getEl("run-campaign-select");
  const campaign = typeof getCampaignById === "function"
    ? getCampaignById(campaignSelect ? campaignSelect.value : "blind_eternities")
    : null;
  if (campaign) setText("run-campaign-desc", campaign.description);
}

async function copyRunSeed() {
  const seedInput = getEl("run-seed-input");
  const seed = typeof normalizeRunSeed === "function"
    ? normalizeRunSeed(seedInput ? seedInput.value : "")
    : null;
  if (!seed) {
    setText("run-seed-desc", "Enter a seed or choose Use Daily Seed before copying.");
    return false;
  }
  if (typeof navigator !== "undefined" && navigator.clipboard && navigator.clipboard.writeText) {
    try {
      await navigator.clipboard.writeText(seed);
      setText("run-seed-desc", `Copied seed "${seed}" to the clipboard.`);
      return true;
    } catch (error) {
      setText("run-seed-desc", `Clipboard access failed: ${error?.message || error}. Select the seed field and copy it manually.`);
      return false;
    }
  }
  setText("run-seed-desc", "Clipboard access is unavailable. Select the seed field and copy it manually.");
  if (seedInput && typeof seedInput.select === "function") seedInput.select();
  return false;
}

function openVictoryModal(enc, earned, healed) {
  if (isHeadlessEnv()) return;
  const dialog = getEl("victory-dialog");
  if (!dialog) {
    safeShowModal("shop-dialog");
    return;
  }
  const campaign = typeof getActiveCampaign === "function" ? getActiveCampaign() : null;
  setText("victory-badge", campaign ? campaign.victoryBadge : "CAMPAIGN CONQUERED");
  setText(
    "victory-summary",
    `${campaign ? campaign.ending : `You defeated ${enc.name} and completed the campaign.`} (+$${earned} Gold${healed > 0 ? `, +${healed} Life` : ""})`
  );
  const statsEl = getEl("victory-stats");
  if (statsEl) {
    statsEl.innerHTML = `
      <div class="stat-chip"><span class="stat-label">ARCHETYPE</span><strong>${state.deckArchetype.badge}</strong></div>
      <div class="stat-chip"><span class="stat-label">RELICS HELD</span><strong>${state.relics.length} / 5</strong></div>
      <div class="stat-chip"><span class="stat-label">DECK SIZE</span><strong>${state.masterDeck.length} Cards</strong></div>
      <div class="stat-chip"><span class="stat-label">LIFE REMAINING</span><strong>${state.playerLife} / ${MAX_LIFE}</strong></div>
    `;
  }
  safeShowModal(dialog);
}

function openDraftModal(enc) {
  if (isHeadlessEnv()) return;
  const dialog = getEl("draft-dialog");
  if (!dialog) return;

  safeCloseModal("shop-dialog");
  safeCloseModal("victory-dialog");
  const currentEnc = enc || (typeof getCurrentEncounter === "function" ? getCurrentEncounter() : null);
  if (currentEnc) {
    setText("draft-plane-badge", `VICTORY • ${currentEnc.name.toUpperCase()} DEFEATED`);
  }
  setText("draft-gold", `$${state.gold}`);
  setText("draft-deck-count", `${state.masterDeck.length} Cards`);

  renderDraftModal();
  safeShowModal(dialog);
}

function renderDraftModal() {
  if (isHeadlessEnv()) return;
  const grid = getEl("draft-card-grid");
  if (!grid) return;

  setResourceText("draft-gold", `$${state.gold}`);
  setText("draft-deck-count", `${state.masterDeck.length} Cards`);

  if (!state.pendingDraft || !Array.isArray(state.pendingDraft.choices) || state.pendingDraft.choices.length === 0) {
    grid.innerHTML = `<div class="draft-empty-state">No draft cards available.</div>`;
    return;
  }

  const choices = state.pendingDraft.choices;
  const entranceDuration = getCombatAnimationDelay(380);
  grid.innerHTML = choices.map((item, idx) => {
    const card = resolveDraftCard(item);
    if (!card) return "";

    const isCreature = card.type === "Creature";
    const dispPow = isCreature ? (card.power || 0) + (card.permPowerBonus || 0) : 0;
    const dispTough = isCreature ? (card.toughness || 0) + (card.permToughnessBonus || 0) : 0;
    const foilCls = card.foil ? ` foil-card-${card.foil}` : "";
    const manaHtml = typeof renderManaCostHtml === "function" ? renderManaCostHtml(card) : "";

    return `
      <div class="draft-card card card-color-${card.color}${foilCls}${entranceDuration > 0 ? " reward-card-enter" : ""}"
        data-draft-idx="${idx}" data-card-id="${card.id}"
        style="--reward-enter-duration:${entranceDuration}ms;--reward-enter-delay:${getCombatAnimationDelay(idx * 65)}ms">
        <div class="draft-card-content">
          <div class="draft-card-header">
            <span class="draft-card-title">${card.name}</span>
            ${manaHtml}
          </div>
          <div class="draft-card-type">${card.type}${card.subtype ? ` — ${card.subtype}` : ""}${card.generated ? " • Generated" : ""}</div>
          <div class="draft-card-rules">${card.rules || ""}</div>
        </div>
        <div class="draft-card-bottom">
          <div class="pt-box-container">
            ${isCreature ? `<span class="pt-box">${dispPow}/${dispTough}</span>` : ""}
          </div>
          <button type="button" class="btn-combat btn-draft-select" data-draft-choice="${idx}">
            ✨ Draft Card
          </button>
        </div>
      </div>
    `;
  }).join("");
}

function resolveDraftCard(item) {
  if (typeof item === "string") {
    return typeof CARD_DB !== "undefined" ? CARD_DB[item] : null;
  }
  if (!item || typeof item !== "object") return null;
  const card = item.generatedDefinition || item;
  return typeof CARD_DB !== "undefined" && CARD_DB[card.id] ? CARD_DB[card.id] : card;
}

function closeDraftModal() {
  if (isHeadlessEnv()) return;
  const dialog = getEl("draft-dialog");
  if (dialog) {
    safeCloseModal(dialog);
  }
}

function presentVictoryOrShopModal(enc, earned, healed, badgeText, summaryText) {
  if (isHeadlessEnv()) return;
  setText("shop-plane-badge", badgeText);
  setText("victory-reward-summary", summaryText);
  renderShop();
  renderAll();
  const campaignEncounters = typeof getActiveCampaignEncounters === "function"
    ? getActiveCampaignEncounters()
    : ENCOUNTERS;
  const isCampaignClear = state.encounterIdx % campaignEncounters.length === campaignEncounters.length - 1;
  const resultDialogId = isCampaignClear
    ? "victory-dialog"
    : (state.pendingDraft && !state.pendingDraft.resolved ? "draft-dialog" : "shop-dialog");
  const resultDialog = getEl(resultDialogId);
  if (resultDialog?.classList) {
    const transitionDuration = getCombatAnimationDelay(520);
    resultDialog.classList.add("boss-victory-transition");
    if (transitionDuration === 0) resultDialog.classList.add("reduced-motion");
    if (resultDialog.style?.removeProperty) {
      resultDialog.style.removeProperty("--boss-victory-transition-duration");
    }
    if (transitionDuration > 0 && resultDialog.style?.setProperty) {
      resultDialog.style.setProperty("--boss-victory-transition-duration", `${transitionDuration}ms`);
    }
    setTimeout(() => {
      resultDialog.classList.remove("boss-victory-transition", "reduced-motion");
      if (resultDialog.style?.removeProperty) {
        resultDialog.style.removeProperty("--boss-victory-transition-duration");
      }
    }, transitionDuration || 220);
  }

  if (isCampaignClear) {
    openVictoryModal(enc, earned, healed);
  } else if (state.pendingDraft && !state.pendingDraft.resolved) {
    openDraftModal(enc);
  } else {
    safeShowModal("shop-dialog");
  }
}

function openRestoredShopModal(enc) {
  if (isHeadlessEnv()) return;
  if (state.pendingDraft && !state.pendingDraft.resolved) {
    openDraftModal(enc);
    return;
  }
  setText("shop-plane-badge", `CLEARED PLANE ${enc.plane} • ${enc.tier}`);
  setText("victory-reward-summary", `Restored Sanctum Shop after defeating ${enc.name}.`);
  renderShop();
  safeShowModal("shop-dialog");
}

function renderRouteModal(forceChoice = false) {
  if (isHeadlessEnv()) return;
  const dialog = getEl("route-dialog");
  const grid = getEl("route-map-grid");
  const routeNodes = typeof getActiveCampaignRouteNodes === "function"
    ? getActiveCampaignRouteNodes()
    : CAMPAIGN_ROUTE_NODES;
  if (!dialog || !grid || !Array.isArray(routeNodes)) return;

  const route = typeof ensureRouteState === "function" ? ensureRouteState() : state.route;
  const availableNext = typeof getAvailableNextRouteNodes === "function" ? getAvailableNextRouteNodes() : [];
  const availableIds = new Set(availableNext.map(n => n.id));
  const completedIds = new Set(route && Array.isArray(route.completedNodeIds) ? route.completedNodeIds : []);
  const visitedIds = new Set(route && Array.isArray(route.visitedNodeIds) ? route.visitedNodeIds : []);
  const currentId = route ? route.currentNodeId : "p1_start";
  const currentNode = typeof getCurrentRouteNode === "function" ? getCurrentRouteNode() : null;
  const pendingEvent = route && route.pendingEventId && typeof getRouteNodeById === "function"
    ? getRouteNodeById(route.pendingEventId)
    : null;
  const currentStep = currentNode ? currentNode.step : 0;

  const mustChoose = Boolean(
    pendingEvent ||
    ((forceChoice || (route && route.pendingSelection)) && availableIds.size > 0)
  );
  routeForceChoice = mustChoose;

  if (typeof dialog.setAttribute === "function") {
    dialog.setAttribute("closedby", mustChoose ? "none" : "any");
  }
  const closeForm = getEl("route-close-form");
  if (closeForm) {
    closeForm.hidden = mustChoose;
  }

  const loopNum = (route && route.loop ? route.loop : 0) + 1;
  const loopSuffix = loopNum > 1 ? ` • LOOP ${loopNum}` : "";
  const campaign = typeof getActiveCampaign === "function" ? getActiveCampaign() : null;
  setText(
    "route-plane-badge",
    pendingEvent
      ? `PLANAR EVENT • ${pendingEvent.title.toUpperCase()}`
      : (mustChoose
      ? `CHOOSE NEXT STOP • ${campaign ? campaign.name.toUpperCase() : "PLANAR ROUTE"}${loopSuffix}`
      : `${campaign ? campaign.name.toUpperCase() : "PLANAR ROUTE"} • ROUTE MAP${loopSuffix}`)
  );
  setText(
    "route-dialog-title",
    pendingEvent
      ? `Resolve ${pendingEvent.title}`
      : (mustChoose ? "Choose Your Next Planar Stop" : "Planar Route Map")
  );
  setText(
    "route-dialog-desc",
    pendingEvent
      ? pendingEvent.desc
      : (mustChoose
      ? "Select a connected node below. Rest Sites resolve immediately; Planar Events offer risk/reward choices."
      : "Inspect your journey across Plane 1 and Plane 2. Defeat the current Ward to unlock the next branching stop.")
  );

  const banner = getEl("route-activity-banner");
  if (banner) {
    if (route && route.lastActivitySummary) {
      banner.hidden = false;
      banner.textContent = `✨ Last Stop: ${route.lastActivitySummary}`;
    } else {
      banner.hidden = true;
      banner.textContent = "";
    }
  }

  if (pendingEvent) {
    const choices = Array.isArray(pendingEvent.choices) ? pendingEvent.choices : [];
    grid.innerHTML = `
      <div class="route-event-choice-grid" role="group" aria-label="${pendingEvent.title} choices">
        ${choices.map(choice => {
          const status = typeof getRouteEventChoiceStatus === "function"
            ? getRouteEventChoiceStatus(choice.id)
            : { available: false, reason: "Event choices are unavailable." };
          return `
            <button type="button" class="route-event-choice" data-route-event-choice-id="${choice.id}"
              ${status.available ? "" : "disabled"}
              aria-label="${choice.title}. ${choice.desc}${status.reason ? ` ${status.reason}` : ""}">
              <strong>${choice.title}</strong>
              <span>${choice.desc}</span>
              ${status.reason ? `<small>${status.reason}</small>` : ""}
            </button>
          `;
        }).join("")}
      </div>
    `;
    return;
  }

  const stepsMap = new Map();
  routeNodes.forEach(node => {
    if (!stepsMap.has(node.step)) stepsMap.set(node.step, []);
    stepsMap.get(node.step).push(node);
  });

  const sortedSteps = Array.from(stepsMap.keys()).sort((a, b) => a - b);
  grid.innerHTML = sortedSteps.map(stepIdx => {
    const nodes = stepsMap.get(stepIdx);
    const planeNum = nodes[0] ? nodes[0].plane : 1;
    const isBranchStep = nodes.length > 1;
    const nodesHtml = nodes.map(node => {
      const typeMeta = (typeof ROUTE_NODE_TYPES !== "undefined" && ROUTE_NODE_TYPES[node.type])
        ? ROUTE_NODE_TYPES[node.type]
        : { icon: "📍", badge: String(node.type || "NODE").toUpperCase() };
      const isCompleted = completedIds.has(node.id);
      const isCurrent = node.id === currentId && !isCompleted;
      const isAvailable = availableIds.has(node.id);
      const isVisited = visitedIds.has(node.id);
      const isBypassed = !isCompleted && !isCurrent && !isAvailable && !isVisited && currentStep >= node.step;

      let stateClass = "route-node-locked";
      let statusLabel = "🔒 Ahead";
      if (isAvailable) {
        stateClass = "route-node-available";
        statusLabel = "⚡ Click to Travel Here";
      } else if (isCurrent) {
        stateClass = "route-node-current";
        statusLabel = "⚔️ Active Stop";
      } else if (isCompleted) {
        stateClass = "route-node-completed";
        statusLabel = "✓ Completed";
      } else if (isBypassed) {
        stateClass = "route-node-bypassed";
        statusLabel = "— Path Bypassed";
      }

      const nextTitles = (node.next || [])
        .map(nid => routeNodes.find(n => n.id === nid))
        .filter(Boolean)
        .map(n => n.title);
      const leadsToHtml = nextTitles.length > 0
        ? `<div class="route-node-links">Leads to: ${nextTitles.join(" / ")}</div>`
        : `<div class="route-node-links">Final Planar Overlord</div>`;

      return `
        <button type="button"
          class="route-node-card route-type-${node.type} ${stateClass}"
          data-route-node-id="${node.id}"
          data-route-node-type="${node.type}"
          ${isAvailable ? "" : "disabled"}
          aria-label="${node.title} (${typeMeta.badge}) - ${statusLabel}">
          <div class="route-node-top">
            <span class="route-type-badge route-badge-${node.type}">${typeMeta.icon} ${typeMeta.badge}</span>
            <span class="route-status-pill">${statusLabel}</span>
          </div>
          <div class="route-node-title">${node.title}</div>
          <div class="route-node-subtitle">${node.subtitle || ""}</div>
          <div class="route-node-desc">${node.desc}</div>
          ${leadsToHtml}
        </button>
      `;
    }).join("");

    return `
      <div class="route-step-row ${isBranchStep ? "route-step-branch" : "route-step-single"}" data-route-step="${stepIdx}">
        <div class="route-step-header">
          <span class="route-step-num">STEP ${stepIdx + 1}</span>
          <span class="route-step-plane">PLANE ${planeNum}${isBranchStep ? " • CHOOSE 1 PATH" : ""}</span>
        </div>
        <div class="route-step-nodes">
          ${nodesHtml}
        </div>
      </div>
    `;
  }).join("");
}

function openRouteModal(forceChoice = false) {
  if (isHeadlessEnv()) return;
  const dialog = getEl("route-dialog");
  if (!dialog) return;
  renderRouteModal(forceChoice);
  const entranceDuration = getCombatAnimationDelay(360);
  if (entranceDuration > 0) {
    dialog.style.setProperty("--route-scene-duration", `${entranceDuration}ms`);
    dialog.classList.remove("route-scene-entering");
    void dialog.offsetWidth;
    dialog.classList.add("route-scene-entering");
    setTimeout(() => dialog.classList.remove("route-scene-entering"), entranceDuration);
  }
  safeShowModal(dialog);
}

function selectRouteNodeWithTransition(nodeId, node, button, dialog, grid) {
  if (routeSelectionPending) return false;
  const finishSelection = () => {
    routeSelectionPending = false;
    dialog.classList.remove("route-selection-pending");
    dialog.removeAttribute("aria-busy");
    grid.removeAttribute("aria-busy");
    grid.style.pointerEvents = "";
    button.classList.remove("route-node-selected");

    const ok = typeof selectRouteNode === "function" ? selectRouteNode(nodeId) : false;
    if (!ok) return;
    if (!node || node.type === "fight" || node.type === "elite" || node.type === "boss" || node.type === "shop") {
      routeForceChoice = false;
      safeCloseModal(dialog);
    } else {
      renderRouteModal(true);
    }
  };

  const transitionDuration = getCombatAnimationDelay(190);
  if (transitionDuration <= 0) {
    finishSelection();
    return true;
  }

  routeSelectionPending = true;
  dialog.classList.add("route-selection-pending");
  dialog.style.setProperty("--route-scene-duration", `${transitionDuration}ms`);
  dialog.setAttribute("aria-busy", "true");
  grid.setAttribute("aria-busy", "true");
  grid.style.pointerEvents = "none";
  button.classList.add("route-node-selected");
  setTimeout(finishSelection, transitionDuration);
  return true;
}

function escapeHtmlText(value) {
  return String(value).replace(/[&<>"']/g, character => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    "\"": "&quot;",
    "'": "&#39;"
  }[character]));
}

function renderRunHistory() {
  if (isHeadlessEnv()) return;
  const status = getEl("run-history-status");
  const list = getEl("run-history-list");
  if (!status || !list || typeof readRunHistory !== "function") return;

  const history = readRunHistory();
  if (!history.ok) {
    status.textContent = history.error || "Run history could not be loaded.";
    list.innerHTML = "";
    return;
  }
  if (state.runHistoryError) {
    status.textContent = `History loaded, but the latest run could not be recorded: ${state.runHistoryError}`;
  } else {
    status.textContent = `${history.entries.length} completed run${history.entries.length === 1 ? "" : "s"} stored (up to ${MAX_RUN_HISTORY_ENTRIES}).`;
  }
  if (history.entries.length === 0) {
    list.innerHTML = `<div class="run-history-empty">No completed runs yet. Your victories and defeats will appear here.</div>`;
    return;
  }

  list.innerHTML = history.entries.map(record => {
    const campaign = getCampaignById(record.campaignId);
    const challenge = getRunChallengeById(record.challengeId);
    const routeNodes = getCampaignRouteNodes(record.campaignId);
    const routeNodeById = new Map(routeNodes.map(node => [node.id, node]));
    const route = record.routeNodeIds
      .map(id => routeNodeById.get(id)?.title || id)
      .map(escapeHtmlText)
      .join(" → ");
    const relics = record.relicIds
      .map(id => RELIC_DB.find(relic => relic.id === id)?.name || id)
      .map(escapeHtmlText);
    const completedAt = new Date(record.completedAt);
    const dateValid = Number.isFinite(completedAt.getTime());
    const dateText = dateValid ? completedAt.toLocaleString() : "Unknown date";
    const dateAttribute = dateValid ? completedAt.toISOString() : "";
    const outcomeLabel = record.outcome === "victory" ? "CAMPAIGN CLEARED" : "RUN DEFEATED";
    return `
      <article class="run-history-entry run-history-${record.outcome}">
        <div class="run-history-entry-top">
          <strong>${outcomeLabel}</strong>
          <time datetime="${escapeHtmlText(dateAttribute)}">${escapeHtmlText(dateText)}</time>
        </div>
        <h3>${escapeHtmlText(record.deckName)}</h3>
        <p>${escapeHtmlText(campaign.name)} • ${escapeHtmlText(challenge.name)} • ${record.runSeed ? `Seed: ${escapeHtmlText(record.runSeed)}` : "Unseeded"}</p>
        <p>Final stop: <strong>${escapeHtmlText(record.finalEncounter)}</strong> • ${record.turns} turns • Loop ${record.loop + 1}</p>
        <p>Life ${record.life} • $${record.gold} • Relics: ${relics.length ? relics.join(", ") : "None"}</p>
        <p class="run-history-route">Route: ${route || "No route recorded"}</p>
      </article>
    `;
  }).join("");
}

function openRunHistoryModal() {
  if (isHeadlessEnv()) return;
  const dialog = getEl("run-history-dialog");
  if (!dialog) return;
  renderRunHistory();
  safeShowModal(dialog);
}

let activeTiltedCard = null;

function initCardTiltTracking() {
  if (typeof document === "undefined") return;

  document.addEventListener("pointermove", (e) => {
    const card = e.target && typeof e.target.closest === "function" ? e.target.closest(CARD_SELECTOR) : null;
    if (card) {
      if (activeTiltedCard && activeTiltedCard !== card) {
        resetCardTilt(activeTiltedCard);
      }
      activeTiltedCard = card;
      applyCardTilt(card, e.clientX, e.clientY);
    } else if (activeTiltedCard) {
      resetCardTilt(activeTiltedCard);
      activeTiltedCard = null;
    }
  }, { passive: true });

  document.addEventListener("pointerleave", (e) => {
    if (e.target && typeof e.target.closest === "function") {
      const card = e.target.closest(CARD_SELECTOR);
      if (card) resetCardTilt(card);
    }
    if (activeTiltedCard) {
      resetCardTilt(activeTiltedCard);
      activeTiltedCard = null;
    }
  }, true);

  document.addEventListener("pointerout", (e) => {
    if (!e.relatedTarget || (typeof e.relatedTarget.closest === "function" && !e.relatedTarget.closest(CARD_SELECTOR))) {
      const card = e.target && typeof e.target.closest === "function" ? e.target.closest(CARD_SELECTOR) : null;
      if (card) resetCardTilt(card);
      if (activeTiltedCard === card) activeTiltedCard = null;
    }
  }, { passive: true });
}

function calculateFanLayout(idx = 0, count = 1, containerWidth = 900, cardWidth = 148) {
  const c = Math.max(0, Number(count) || 0);
  const w = Math.max(1, Number(containerWidth) || 900);
  const cw = Math.max(1, Number(cardWidth) || 148);
  if (c <= 1) {
    return { x: 0, y: 0, rot: 0, overlap: 0 };
  }
  const i = Math.max(0, Math.min(c - 1, Number(idx) || 0));
  const pad = 80;
  const avail = Math.max(cw, w - pad);
  const step = Math.min(cw, (avail - cw) / (c - 1));
  const overlap = Math.max(0, cw - step);

  const centerIdx = (c - 1) / 2;
  const norm = centerIdx > 0 ? (i - centerIdx) / centerIdx : 0;

  const maxRot = Math.min(12, centerIdx * 2.5);
  const rot = Math.max(-12, Math.min(12, norm * maxRot));

  const maxDrop = Math.min(14, centerIdx * 2.5);
  const y = Math.max(0, Math.min(14, (norm * norm) * maxDrop));

  const x = (i - centerIdx) * step;

  return {
    x: Number(x.toFixed(2)),
    y: Number(y.toFixed(2)),
    rot: Number(rot.toFixed(2)),
    overlap: Number(overlap.toFixed(2))
  };
}

function stepSpring(state, target, dt, { stiffness = 280, damping = 28 } = {}) {
  let pos = Number(state?.pos);
  let vel = Number(state?.vel);
  if (!Number.isFinite(pos)) pos = 0;
  if (!Number.isFinite(vel)) vel = 0;

  const tgt = Number(target);
  const safeTarget = Number.isFinite(tgt) ? tgt : 0;

  const k = Number(stiffness);
  const safeK = Number.isFinite(k) && k > 0 ? k : 280;

  const c = Number(damping);
  const safeC = Number.isFinite(c) && c >= 0 ? c : 28;

  const delta = Number(dt);
  if (!Number.isFinite(delta) || delta <= 0) {
    return { pos, vel };
  }

  const clampedDt = Math.min(delta, 0.1);
  const stepSize = 0.008;
  let remaining = clampedDt;

  while (remaining > 0) {
    const step = Math.min(remaining, stepSize);
    const accel = -safeK * (pos - safeTarget) - safeC * vel;
    vel += accel * step;
    pos += vel * step;
    remaining -= step;
  }

  if (!Number.isFinite(pos)) pos = safeTarget;
  if (!Number.isFinite(vel)) vel = 0;

  return { pos, vel };
}

function getDropZoneForCard(card, clientX, clientY) {
  if (!card || clientX == null || clientY == null || typeof document === "undefined") return null;

  const handEl = document.getElementById("player-hand");
  if (handEl && typeof handEl.getBoundingClientRect === "function") {
    const hr = handEl.getBoundingClientRect();
    if (hr && clientY >= hr.top) {
      return null;
    }
  }

  const isInside = (el) => {
    if (!el || typeof el.getBoundingClientRect !== "function") return false;
    const r = el.getBoundingClientRect();
    if (!r) return false;
    return clientX >= r.left && clientX <= r.right && clientY >= r.top && clientY <= r.bottom;
  };

  const landsEl = document.getElementById("player-lands");
  const creaturesEl = document.getElementById("player-creatures");
  const tableEl = document.querySelector(".battlefield-table");

  if (card.type === "Land") {
    if (isInside(landsEl) || isInside(landsEl?.closest(".land-lane"))) return "lands";
    return null;
  }
  if (card.type === "Creature") {
    if (isInside(creaturesEl) || isInside(creaturesEl?.closest(".player-lane"))) return "creatures";
    return null;
  }
  // Sorcery, Instant, Artifact spells
  if (isInside(tableEl)) return "table";
  return null;
}

function cancelHandDrag(reason = "cancel") {
  if (activeHandDragController) {
    return activeHandDragController.cancel(reason);
  }
  return false;
}

function createHandDragController(config = {}) {
  const DRAG_THRESHOLD = 6; // px

  // Centralized drag state object (single source of truth for pointer drag lifecycle)
  const dragState = {
    phase: "idle", // "idle" | "armed" | "dragging" | "dropping" | "snapping"
    pointerId: null,
    pointerType: "mouse",
    hasPointerCapture: false,
    cardEl: null,
    card: null,
    startX: 0,
    startY: 0,
    currentX: 0,
    currentY: 0,
    springX: { pos: 0, vel: 0 },
    springY: { pos: 0, vel: 0 },
    leanSpring: { pos: 0, vel: 0 },
    wobbleTime: 0,
    isWobbling: false,
    rafId: null,
    lastTime: 0,
    suppressClick: false,
    suppressClickReason: null,
    touchFocusedEl: null,
    lastResetReason: "init"
  };

  function getActiveDropZoneEl(c) {
    if (typeof document === "undefined" || !c) return null;
    if (c.type === "Land") return getEl("player-lands");
    if (c.type === "Creature") return getEl("player-creatures");
    return queryEl(".battlefield-table");
  }

  function setZoneActive(c, active) {
    const el = getActiveDropZoneEl(c);
    if (el && el.classList) el.classList.toggle("drop-zone-active", Boolean(active));
  }

  function resetVisuals(el) {
    if (!el || !el.style) return;
    if (el.classList) {
      el.classList.remove("is-dragging", "drag-invalid");
    }
    el.style.removeProperty("--drag-x");
    el.style.removeProperty("--drag-y");
    el.style.removeProperty("--lean");
    el.style.removeProperty("--lift");
    el.style.removeProperty("--drag-reason");
  }

  function stopLoop() {
    if (dragState.rafId != null) {
      if (typeof cancelAnimationFrame === "function") {
        cancelAnimationFrame(dragState.rafId);
      }
      dragState.rafId = null;
    }
  }

  function acquirePointerCapture(el, pid) {
    if (!el || pid == null || typeof el.setPointerCapture !== "function") return false;
    try {
      el.setPointerCapture(pid);
      dragState.hasPointerCapture = true;
      return true;
    } catch (_) {
      dragState.hasPointerCapture = false;
      return false;
    }
  }

  function releaseActivePointerCapture() {
    const el = dragState.cardEl;
    const pid = dragState.pointerId;
    dragState.hasPointerCapture = false;
    if (!el || pid == null || typeof el.releasePointerCapture !== "function") return;
    try {
      if (typeof el.hasPointerCapture === "function" && !el.hasPointerCapture(pid)) return;
      el.releasePointerCapture(pid);
    } catch (_) {}
  }

  function markClickSuppressed(reason = "drag") {
    dragState.suppressClick = true;
    dragState.suppressClickReason = reason;
  }

  function consumeClickSuppression() {
    const suppressed = Boolean(dragState.suppressClick);
    dragState.suppressClick = false;
    dragState.suppressClickReason = null;
    return suppressed;
  }

  // Unified cleanup routine replacing repeated manual resets
  function resetDragState(reason = "reset") {
    stopLoop();
    setZoneActive(dragState.card, false);
    releaseActivePointerCapture();
    resetVisuals(dragState.cardEl);
    dragState.cardEl = null;
    dragState.card = null;
    dragState.pointerId = null;
    dragState.hasPointerCapture = false;
    dragState.springX = { pos: 0, vel: 0 };
    dragState.springY = { pos: 0, vel: 0 };
    dragState.leanSpring = { pos: 0, vel: 0 };
    dragState.wobbleTime = 0;
    dragState.isWobbling = false;
    dragState.phase = "idle";
    dragState.lastResetReason = reason;
    return true;
  }

  function cancel(reason = "cancel") {
    if (dragState.phase === "idle") return false;
    stopLoop();
    setZoneActive(dragState.card, false);
    releaseActivePointerCapture();

    const immediateReasons = new Set([
      "numberKey",
      "escape",
      "pointercancel",
      "lostpointercapture",
      "combatLocked",
      "runOver",
      "override",
      "tap",
      "destroy"
    ]);

    if (
      dragState.phase === "armed" ||
      prefersReducedMotion() ||
      immediateReasons.has(reason) ||
      typeof requestAnimationFrame !== "function"
    ) {
      return resetDragState(reason);
    }

    dragState.phase = "snapping";
    startSnapLoop();
    return true;
  }

  function startSnapLoop() {
    stopLoop();
    dragState.lastTime = (typeof performance !== "undefined" && performance.now)
      ? performance.now()
      : Date.now();

    function snapStep(now) {
      const dt = Math.min(((now || Date.now()) - dragState.lastTime) / 1000, 0.064);
      dragState.lastTime = now || Date.now();

      dragState.springX = stepSpring(dragState.springX, 0, dt, { stiffness: 260, damping: 22 });
      dragState.springY = stepSpring(dragState.springY, 0, dt, { stiffness: 260, damping: 22 });

      let lean = 0;
      if (dragState.isWobbling) {
        dragState.wobbleTime += dt;
        const amp = Math.max(0, 14 * Math.exp(-dragState.wobbleTime * 6));
        lean = Math.sin(dragState.wobbleTime * 28) * amp;
        if (amp < 0.2) dragState.isWobbling = false;
      } else {
        dragState.leanSpring = stepSpring(dragState.leanSpring, 0, dt, { stiffness: 260, damping: 22 });
        lean = Math.max(-15, Math.min(15, dragState.leanSpring.pos));
      }

      if (dragState.cardEl?.style) {
        dragState.cardEl.style.setProperty("--drag-x", `${dragState.springX.pos.toFixed(1)}px`);
        dragState.cardEl.style.setProperty("--drag-y", `${dragState.springY.pos.toFixed(1)}px`);
        dragState.cardEl.style.setProperty("--lean", `${lean.toFixed(2)}deg`);
      }

      const dist = Math.hypot(dragState.springX.pos, dragState.springY.pos);
      const speed = Math.hypot(dragState.springX.vel, dragState.springY.vel);

      if ((dist < 0.5 && speed < 1.0 && !dragState.isWobbling) || typeof requestAnimationFrame !== "function") {
        resetDragState("snapComplete");
        return;
      }

      dragState.rafId = requestAnimationFrame(snapStep);
    }

    if (typeof requestAnimationFrame === "function") {
      dragState.rafId = requestAnimationFrame(snapStep);
    } else {
      resetDragState("snapFallback");
    }
  }

  function startDragLoop() {
    stopLoop();
    dragState.lastTime = (typeof performance !== "undefined" && performance.now)
      ? performance.now()
      : Date.now();

    function dragStep(now) {
      if (dragState.phase !== "dragging") return;
      const dt = Math.min(((now || Date.now()) - dragState.lastTime) / 1000, 0.064);
      dragState.lastTime = now || Date.now();

      const targetDx = dragState.currentX - dragState.startX;
      const targetDy = dragState.currentY - dragState.startY;

      if (prefersReducedMotion()) {
        dragState.springX = { pos: targetDx, vel: 0 };
        dragState.springY = { pos: targetDy, vel: 0 };
        dragState.leanSpring = { pos: 0, vel: 0 };
      } else {
        dragState.springX = stepSpring(dragState.springX, targetDx, dt, { stiffness: 320, damping: 2 * Math.sqrt(320) });
        dragState.springY = stepSpring(dragState.springY, targetDy, dt, { stiffness: 320, damping: 2 * Math.sqrt(320) });
        const targetLean = Math.max(-15, Math.min(15, dragState.springX.vel * 0.025));
        dragState.leanSpring = stepSpring(dragState.leanSpring, targetLean, dt, { stiffness: 280, damping: 24 });
      }

      if (dragState.cardEl?.style) {
        const clampedLean = Math.max(-15, Math.min(15, dragState.leanSpring.pos));
        dragState.cardEl.style.setProperty("--drag-x", `${dragState.springX.pos.toFixed(1)}px`);
        dragState.cardEl.style.setProperty("--drag-y", `${dragState.springY.pos.toFixed(1)}px`);
        dragState.cardEl.style.setProperty("--lean", `${clampedLean.toFixed(2)}deg`);
        dragState.cardEl.style.setProperty("--lift", "-16px");
      }

      if (typeof requestAnimationFrame === "function") {
        dragState.rafId = requestAnimationFrame(dragStep);
      }
    }

    if (typeof requestAnimationFrame === "function") {
      dragState.rafId = requestAnimationFrame(dragStep);
    }
  }

  function onPointerDown(e) {
    if (!e) return;
    // Start a drag only for the primary pointer button (event.button === 0)
    if (e.button != null && e.button !== 0) return;
    if (typeof state !== "undefined" && (state.runOver || state.combatLocked)) return;
    if (dragState.phase !== "idle" && dragState.phase !== "snapping") return;
    if (dragState.phase === "snapping") resetDragState("override");

    const targetCardEl = e.target && typeof e.target.closest === "function" ? e.target.closest("[data-hand-uid]") : null;
    if (!targetCardEl) return;
    const uid = targetCardEl.dataset.handUid;
    const c = (typeof state !== "undefined" && state.hand) ? state.hand.find(item => item.uid === uid) : null;
    if (!c) return;

    dragState.phase = "armed";
    dragState.cardEl = targetCardEl;
    dragState.card = c;
    dragState.pointerId = e.pointerId;
    dragState.pointerType = e.pointerType || "mouse";
    dragState.startX = e.clientX;
    dragState.startY = e.clientY;
    dragState.currentX = e.clientX;
    dragState.currentY = e.clientY;
    dragState.springX = { pos: 0, vel: 0 };
    dragState.springY = { pos: 0, vel: 0 };
    dragState.leanSpring = { pos: 0, vel: 0 };
    dragState.isWobbling = false;
    dragState.wobbleTime = 0;

    acquirePointerCapture(dragState.cardEl, dragState.pointerId);
  }

  function onPointerMove(e) {
    if (!e) return;
    if (typeof state !== "undefined" && (state.runOver || state.combatLocked)) {
      cancel("combatLocked");
      return;
    }
    if (dragState.pointerId != null && e.pointerId !== dragState.pointerId) return;

    if (dragState.phase === "armed") {
      const dist = Math.hypot(e.clientX - dragState.startX, e.clientY - dragState.startY);
      if (dist > DRAG_THRESHOLD) {
        dragState.phase = "dragging";
        markClickSuppressed("dragThreshold");
        if (dragState.touchFocusedEl) {
          if (dragState.touchFocusedEl.classList) dragState.touchFocusedEl.classList.remove("touch-focused");
          dragState.touchFocusedEl = null;
        }
        if (dragState.cardEl?.classList) dragState.cardEl.classList.add("is-dragging");
        resetCardTilt(dragState.cardEl);

        const playable = canPlayCard(dragState.card);
        if (!playable && dragState.cardEl) {
          if (dragState.cardEl.classList) dragState.cardEl.classList.add("drag-invalid");
          const lifeCost = Math.max(0, Math.floor(Number(dragState.card.lifeCost) || 0));
          const reason = lifeCost > 0 && state.playerLife <= lifeCost
            ? getCardPlayabilityInfo(dragState.card).badge
            : (dragState.card.type === "Land" ? "Land Limit" : "Missing Mana Pips");
          if (dragState.cardEl.style) dragState.cardEl.style.setProperty("--drag-reason", `"${reason}"`);
        }

        setZoneActive(dragState.card, true);
        startDragLoop();
      }
    }

    if (dragState.phase === "dragging") {
      dragState.currentX = e.clientX;
      dragState.currentY = e.clientY;
      if (prefersReducedMotion() && dragState.cardEl?.style) {
        dragState.cardEl.style.setProperty("--drag-x", `${(dragState.currentX - dragState.startX).toFixed(1)}px`);
        dragState.cardEl.style.setProperty("--drag-y", `${(dragState.currentY - dragState.startY).toFixed(1)}px`);
        dragState.cardEl.style.setProperty("--lean", "0deg");
        dragState.cardEl.style.setProperty("--lift", "-16px");
      }
    }
  }

  function onPointerUp(e) {
    if (!e) return;
    if (dragState.pointerId != null && e.pointerId !== dragState.pointerId) return;

    if (dragState.phase === "armed") {
      const tappedEl = dragState.cardEl;
      const tappedCard = dragState.card;
      const wasTouch = dragState.pointerType === "touch";
      resetDragState("tap");

      if (wasTouch && tappedEl && tappedCard) {
        if (dragState.touchFocusedEl === tappedEl) {
          if (dragState.touchFocusedEl.classList) dragState.touchFocusedEl.classList.remove("touch-focused");
          dragState.touchFocusedEl = null;
          markClickSuppressed("touchPlay");
          playCardFromHand(tappedCard.uid);
        } else {
          if (dragState.touchFocusedEl && dragState.touchFocusedEl.classList) {
            dragState.touchFocusedEl.classList.remove("touch-focused");
          }
          dragState.touchFocusedEl = tappedEl;
          if (dragState.touchFocusedEl.classList) dragState.touchFocusedEl.classList.add("touch-focused");
          markClickSuppressed("touchFocus");
        }
      }
      return;
    }

    if (dragState.phase === "dragging") {
      markClickSuppressed("dragRelease");
      stopLoop();
      setZoneActive(dragState.card, false);
      releaseActivePointerCapture();

      const activeCard = dragState.card;
      const activeEl = dragState.cardEl;
      const zone = getDropZoneForCard(activeCard, e.clientX, e.clientY);
      const playable = canPlayCard(activeCard);

      if (zone && playable) {
        dragState.phase = "dropping";
        if (activeEl && typeof activeEl.getBoundingClientRect === "function") {
          seedPrevHandRect(activeCard.uid, activeEl.getBoundingClientRect());
        }
        showDropZoneSuccess(zone);
        const playedUid = activeCard.uid;
        resetDragState("dropSuccess");
        playCardFromHand(playedUid);
        return;
      }

      if (zone && !playable) {
        if (activeCard.type === "Land") {
          spawnFx(`Land Limit (${state.maxLandsPerTurn}/turn)!`, "#ff6b6b");
        } else {
          spawnFx(`Missing Mana Pips for ${activeCard.manaCost}!`, "#ff6b6b");
        }
        const reason = getCardPlayabilityInfo(activeCard).reason.replace(/^Unplayable:\s*/, "");
        showLocalPlayabilityFeedback(activeCard, reason);
        if (prefersReducedMotion() || typeof requestAnimationFrame !== "function") {
          resetDragState("invalidDropReducedMotion");
          return;
        }
        dragState.isWobbling = true;
        dragState.wobbleTime = 0;
        dragState.phase = "snapping";
        startSnapLoop();
        return;
      }

      // Dropped outside play zone: silent snap-back or immediate reset
      if (prefersReducedMotion() || typeof requestAnimationFrame !== "function") {
        resetDragState("outsideDropReducedMotion");
        return;
      }
      dragState.phase = "snapping";
      startSnapLoop();
    }
  }

  function onPointerCancel(e) {
    if (dragState.pointerId != null && e && e.pointerId != null && e.pointerId !== dragState.pointerId) return;
    cancel("pointercancel");
  }

  function onLostPointerCapture(e) {
    if (dragState.pointerId != null && e && e.pointerId != null && e.pointerId !== dragState.pointerId) return;
    dragState.hasPointerCapture = false;
    if (dragState.phase === "armed" || dragState.phase === "dragging") {
      resetDragState("lostpointercapture");
    }
  }

  function clearTouchFocus() {
    if (dragState.touchFocusedEl) {
      if (dragState.touchFocusedEl.classList) dragState.touchFocusedEl.classList.remove("touch-focused");
      dragState.touchFocusedEl = null;
    }
  }

  const instance = {
    getState: () => dragState.phase,
    getDragState: () => ({ ...dragState }),
    getActiveUid: () => dragState.card?.uid || null,
    getDraggedCardUid: () => dragState.card?.uid || null,
    handlePointerDown: onPointerDown,
    onPointerDown,
    handlePointerMove: onPointerMove,
    onPointerMove,
    handlePointerUp: onPointerUp,
    onPointerUp,
    handlePointerCancel: onPointerCancel,
    onPointerCancel,
    handleLostPointerCapture: onLostPointerCapture,
    onLostPointerCapture,
    resetDragState,
    cancel,
    clearTouchFocus,
    markClickSuppressed,
    consumeClickSuppression,
    destroy: () => {
      resetDragState("destroy");
      clearTouchFocus();
      if (activeHandDragController === instance) {
        activeHandDragController = null;
      }
    }
  };
  activeHandDragController = instance;
  return instance;
}

if (typeof globalThis !== "undefined") {
  globalThis.calculateFanLayout = calculateFanLayout;
  globalThis.stepSpring = stepSpring;
  globalThis.createHandDragController = createHandDragController;
  globalThis.getDropZoneForCard = getDropZoneForCard;
  globalThis.cancelHandDrag = cancelHandDrag;
  globalThis.seedPrevHandRect = seedPrevHandRect;
  globalThis.scheduleRender = scheduleRender;
  globalThis.flushScheduledRender = flushScheduledRender;
  globalThis.renderIncremental = renderIncremental;
  globalThis.openDraftModal = openDraftModal;
  globalThis.renderDraftModal = renderDraftModal;
  globalThis.closeDraftModal = closeDraftModal;
}

function showSettingsStatusMessage(message, isError = false) {
  const msgEl = getEl("settings-status-msg");
  if (!msgEl) return;
  msgEl.hidden = false;
  msgEl.textContent = message;
  if (msgEl.classList) msgEl.classList.toggle("error", Boolean(isError));
}

function renderDesktopSettingsModal() {
  if (isHeadlessEnv() || typeof DesktopBridge === "undefined") return;
  const info = DesktopBridge.getRuntimeInfo();
  const settings = DesktopBridge.getSettings();
  const summary = DesktopBridge.getActiveSaveSummary();

  const runtimeBadge = getEl("settings-runtime-badge");
  if (runtimeBadge) {
    if (info.runtime === "tauri") {
      runtimeBadge.textContent = "DESKTOP APP • TAURI V2 NATIVE ENGINE";
    } else if (info.runtime === "macos-native") {
      runtimeBadge.textContent = "DESKTOP APP • MACOS NATIVE WKWEBVIEW ENGINE";
    } else {
      runtimeBadge.textContent = "WEB MODE • LOCALSTORAGE SANCTUM ENGINE";
    }
  }

  const fsBtn = getEl("btn-toggle-fullscreen");
  if (fsBtn) {
    fsBtn.textContent = settings.fullscreen ? "🖥️ Exit Fullscreen (F11)" : "🖥️ Enter Fullscreen (F11)";
  }

  const scaleGroup = getEl("settings-scale-group");
  if (scaleGroup) {
    queryAll("[data-ui-scale]", scaleGroup).forEach(btn => {
      if (btn.classList) btn.classList.toggle("active", Number(btn.dataset.uiScale) === settings.uiScale);
    });
  }

  const motionGroup = getEl("settings-motion-group");
  if (motionGroup) {
    queryAll("[data-motion-mode]", motionGroup).forEach(btn => {
      if (btn.classList) btn.classList.toggle("active", btn.dataset.motionMode === settings.motionMode);
    });
  }

  const combatSpeedGroup = getEl("settings-combat-speed-group");
  if (combatSpeedGroup) {
    queryAll("[data-combat-speed]", combatSpeedGroup).forEach(btn => {
      if (btn.classList) btn.classList.toggle("active", btn.dataset.combatSpeed === settings.combatSpeed);
    });
  }

  const soundToggle = getEl("settings-sound-enabled");
  if (soundToggle) soundToggle.checked = Boolean(settings.soundEnabled);
  const soundVolume = getEl("settings-sound-volume");
  if (soundVolume) {
    soundVolume.value = String(Math.round(settings.soundVolume * 100));
  }
  const soundVolumeValue = getEl("settings-sound-volume-value");
  if (soundVolumeValue) soundVolumeValue.textContent = `${Math.round(settings.soundVolume * 100)}%`;
  if (!soundStatusIsError) {
    setSoundStatusMessage(settings.soundEnabled
      ? `Sound effects are on at ${Math.round(settings.soundVolume * 100)}% volume.`
      : "Sound is muted until you enable it.");
  }

  const saveSummaryEl = getEl("settings-save-summary");
  if (saveSummaryEl) {
    const storageLabel = info.isDesktop
      ? "Synced to Native Application Support & LocalStorage"
      : "Saved in Browser LocalStorage";
    if (summary) {
      saveSummaryEl.innerHTML =
        `<strong>${summary.archetype}</strong> • Encounter ${summary.encounter}${summary.inShop ? " (Sanctum Shop)" : ""} • ` +
        `<strong>${summary.playerLife} HP</strong> • <strong>$${summary.gold}</strong> • ${summary.deckSize} Cards<br>` +
        `<small>${storageLabel}</small>`;
    } else {
      saveSummaryEl.innerHTML = `No active run saved yet.<br><small>${storageLabel}</small>`;
    }
  }

  const quitBtn = getEl("btn-quit-desktop");
  if (quitBtn) {
    quitBtn.hidden = !info.isDesktop;
  }
}

function openDesktopSettingsModal() {
  if (isHeadlessEnv()) return;
  const dlg = getEl("settings-dialog");
  if (!dlg) return;
  const msgEl = getEl("settings-status-msg");
  if (msgEl) msgEl.hidden = true;
  renderDesktopSettingsModal();
  safeShowModal(dlg);
}

function initEvents() {
  if (isHeadlessEnv()) return;

  initializeAmbientVisibilityHandling();
  initCardTiltTracking();

  if (!activeHandDragController) {
    activeHandDragController = createHandDragController();
  }
  const handEl = getEl("player-hand");
  if (handEl) {
    handEl.addEventListener("pointerdown", activeHandDragController.handlePointerDown);
    handEl.addEventListener("lostpointercapture", activeHandDragController.handleLostPointerCapture);
    if (typeof window !== "undefined") {
      window.addEventListener("pointermove", activeHandDragController.handlePointerMove);
      window.addEventListener("pointerup", activeHandDragController.handlePointerUp);
      window.addEventListener("pointercancel", activeHandDragController.handlePointerCancel);
    } else {
      handEl.addEventListener("pointermove", activeHandDragController.handlePointerMove);
      handEl.addEventListener("pointerup", activeHandDragController.handlePointerUp);
      handEl.addEventListener("pointercancel", activeHandDragController.handlePointerCancel);
    }

    handEl.addEventListener("click", (e) => {
      if (activeHandDragController && activeHandDragController.consumeClickSuppression()) {
        e.stopPropagation();
        e.preventDefault();
        return;
      }
      const cardEl = e.target && typeof e.target.closest === "function" ? e.target.closest("[data-hand-uid]") : null;
      if (cardEl) playCardFromHand(cardEl.dataset.handUid);
    });
  }

  document.addEventListener("pointerdown", (e) => {
    if (activeHandDragController && (!e.target || typeof e.target.closest !== "function" || !e.target.closest(".hand-card"))) {
      activeHandDragController.clearTouchFocus();
    }
  }, { passive: true });

  const playerCreaturesEl = getEl("player-creatures");
  if (playerCreaturesEl) {
    playerCreaturesEl.addEventListener("click", (e) => {
      const crEl = e.target && typeof e.target.closest === "function" ? e.target.closest("[data-creature-uid]") : null;
      if (crEl) toggleCreatureAttack(crEl.dataset.creatureUid);
    });
  }

  const playerLandsEl = getEl("player-lands");
  if (playerLandsEl) {
    playerLandsEl.addEventListener("click", (e) => {
      if (!e.target || typeof e.target.closest !== "function") return;
      const overchargeEl = e.target.closest("[data-overcharge-land]");
      if (overchargeEl) {
        e.stopPropagation();
        if (typeof openOverchargeLandModal === "function") {
          openOverchargeLandModal(overchargeEl.dataset.overchargeLand);
        }
        return;
      }
      const landEl = e.target.closest("[data-land-uid]");
      if (landEl) tapLandManually(landEl.dataset.landUid);
    });
  }

  const mullBtn = getEl("btn-mulligan");
  if (mullBtn) {
    mullBtn.addEventListener("click", () => {
      cancelHandDrag("mulligan");
      useMulligan();
    });
  }

  const relicSlotsEl = getEl("relic-slots");
  if (relicSlotsEl) {
    relicSlotsEl.addEventListener("click", (e) => {
      if (!e.target || typeof e.target.closest !== "function") return;
      const moveBtn = e.target.closest("[data-move-relic]");
      if (moveBtn) {
        moveRelic(Number(moveBtn.dataset.moveRelic), Number(moveBtn.dataset.moveDir));
        return;
      }
      const b = e.target.closest("[data-sell-relic]");
      if (b) sellRelic(b.dataset.sellRelic);
    });
  }

  const consSlots = getEl("consumable-slots");
  if (consSlots) {
    consSlots.addEventListener("click", (e) => {
      const btn = e.target && typeof e.target.closest === "function" ? e.target.closest("[data-consumable-uid]") : null;
      if (btn) useConsumable(btn.dataset.consumableUid);
    });
  }

  document.addEventListener("contextmenu", (e) => {
    if (typeof DesktopBridge !== "undefined" && DesktopBridge.isDesktopApp()) {
      const tag = e.target && e.target.tagName ? e.target.tagName.toLowerCase() : "";
      if (tag !== "input" && tag !== "textarea") {
        e.preventDefault();
      }
    }
  });

  document.addEventListener("keydown", (e) => {
    if (!e.repeat && e.key === "F11" && typeof DesktopBridge !== "undefined") {
      e.preventDefault();
      DesktopBridge.toggleFullscreen().then(() => renderDesktopSettingsModal());
      return;
    }
    const activeTag = document.activeElement && document.activeElement.tagName
      ? document.activeElement.tagName.toLowerCase()
      : "";
    if (activeTag === "input" || activeTag === "textarea") return;

    if (queryEl("dialog[open]") || state.runOver || state.combatLocked || e.repeat || e.ctrlKey || e.metaKey || e.altKey) return;
    if (e.key === "Escape") {
      cancelHandDrag("escape");
    } else if (e.key >= "1" && e.key <= "9") {
      cancelHandDrag("numberKey");
      const idx = Number(e.key) - 1;
      if (state.hand[idx]) {
        e.preventDefault();
        playCardFromHand(state.hand[idx].uid);
      }
    } else if (e.code === "Space" && (!document.activeElement || document.activeElement === document.body)) {
      cancelHandDrag("combat");
      e.preventDefault();
      executeCombatAndEndTurn();
    } else if (e.key === "m" || e.key === "M") {
      cancelHandDrag("mulligan");
      useMulligan();
    } else if (e.key === "l" || e.key === "L") {
      cancelHandDrag("inspector");
      openDeckInspector(
        `Remaining Library (${state.library.length} Cards)`,
        "Cards currently remaining in your deck (shown in shuffled order). Fetch Lands and Cultivate let you search specific Basic Land colors out of here!",
        state.library
      );
    } else if (e.key === "g" || e.key === "G") {
      cancelHandDrag("inspector");
      openDeckInspector(
        `Graveyard (${state.graveyard.length} Cards)`,
        "Resolved Spells, cracked Fetch Lands, and fallen Creatures.",
        state.graveyard
      );
    } else if (e.key === "r" || e.key === "R") {
      cancelHandDrag("route");
      openRouteModal(Boolean(state.route && state.route.pendingSelection));
    } else if (e.key === ",") {
      cancelHandDrag("settings");
      openDesktopSettingsModal();
    }
  });

  const combatBtn = getEl("btn-combat");
  if (combatBtn) {
    combatBtn.addEventListener("click", () => {
      cancelHandDrag("combat");
      executeCombatAndEndTurn();
    });
  }

  const combatLogStrip = getEl("combat-log-strip");
  if (combatLogStrip) {
    combatLogStrip.addEventListener("click", openCombatLogModal);
    combatLogStrip.addEventListener("keydown", (e) => {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        openCombatLogModal();
      }
    });
  }

  const viewLibBtn = getEl("btn-view-library");
  if (viewLibBtn) {
    viewLibBtn.addEventListener("click", () => {
      openDeckInspector(
        `Remaining Library (${state.library.length} Cards)`,
        "Cards currently remaining in your deck (shown in shuffled order). Fetch Lands and Cultivate let you search specific Basic Land colors out of here!",
        state.library
      );
    });
  }

  const collectionBtn = getEl("btn-open-card-collection");
  if (collectionBtn) collectionBtn.addEventListener("click", openCardCollectionModal);
  const collectionSearch = getEl("collection-search");
  if (collectionSearch) collectionSearch.addEventListener("input", renderCardCollection);
  ["collection-color-filter", "collection-type-filter", "collection-sort"].forEach(id => {
    const filter = getEl(id);
    if (filter) filter.addEventListener("change", renderCardCollection);
  });

  const viewGraveBtn = getEl("btn-view-graveyard");
  if (viewGraveBtn) {
    viewGraveBtn.addEventListener("click", () => {
      openDeckInspector(
        `Graveyard (${state.graveyard.length} Cards)`,
        "Resolved Spells, cracked Fetch Lands, and fallen Creatures.",
        state.graveyard
      );
    });
  }

  const viewRouteBtn = getEl("btn-view-route");
  if (viewRouteBtn) {
    viewRouteBtn.addEventListener("click", () => {
      openRouteModal(Boolean(state.route && state.route.pendingSelection));
    });
  }
  const runHistoryBtn = getEl("btn-run-history");
  if (runHistoryBtn) {
    runHistoryBtn.addEventListener("click", openRunHistoryModal);
  }

  const ladderEl = getEl("encounter-ladder");
  if (ladderEl) {
    ladderEl.addEventListener("click", () => {
      openRouteModal(Boolean(state.route && state.route.pendingSelection));
    });
  }

  const routeDialog = getEl("route-dialog");
  if (routeDialog) {
    routeDialog.addEventListener("cancel", (e) => {
      if (routeForceChoice || (typeof routeDialog.getAttribute === "function" && routeDialog.getAttribute("closedby") === "none")) {
        e.preventDefault();
      }
    });
  }

  const routeGrid = getEl("route-map-grid");
  if (routeGrid) {
    routeGrid.addEventListener("click", (e) => {
      const eventChoiceBtn = e.target && typeof e.target.closest === "function"
        ? e.target.closest("[data-route-event-choice-id]")
        : null;
      if (eventChoiceBtn && !eventChoiceBtn.disabled) {
        const eventId = state.route && state.route.pendingEventId;
        const result = typeof resolveRouteEventChoice === "function"
          ? resolveRouteEventChoice(eventId, eventChoiceBtn.dataset.routeEventChoiceId)
          : { ok: false, reason: "Event choices are unavailable." };
        if (result.ok) {
          renderRouteModal(true);
        } else {
          renderRouteModal(true);
          setText("route-dialog-desc", result.reason || "Unable to resolve this event choice.");
        }
        return;
      }

      const btn = e.target && typeof e.target.closest === "function" ? e.target.closest("[data-route-node-id]") : null;
      if (!btn || btn.disabled) return;
      const nodeId = btn.dataset.routeNodeId;
      if (typeof canSelectRouteNode === "function" && !canSelectRouteNode(nodeId)) return;
      const node = typeof getRouteNodeById === "function" ? getRouteNodeById(nodeId) : null;
      selectRouteNodeWithTransition(nodeId, node, btn, routeDialog, routeGrid);
    });
  }

  const newRunBtn = getEl("btn-new-run");
  if (newRunBtn) {
    newRunBtn.addEventListener("click", () => {
      openNewRunModal(Boolean(state.runOver));
    });
  }

  const newrunDialog = getEl("newrun-dialog");
  if (newrunDialog) {
    newrunDialog.addEventListener("cancel", (e) => {
      if (newRunForceChoice || (typeof newrunDialog.getAttribute === "function" && newrunDialog.getAttribute("closedby") === "none")) {
        e.preventDefault();
      }
    });
  }

  const challengeSelect = getEl("run-challenge-select");
  if (challengeSelect) {
    challengeSelect.addEventListener("change", updateRunChallengeDescription);
  }
  const campaignSelect = getEl("run-campaign-select");
  if (campaignSelect) {
    campaignSelect.addEventListener("change", updateRunCampaignDescription);
  }
  const seedInput = getEl("run-seed-input");
  if (seedInput) {
    seedInput.addEventListener("input", () => {
      setText("run-seed-desc", seedInput.value.trim()
        ? "Seeded runs reproduce shuffles and rewards. Copy this seed to share the run."
        : "Use the same seed to replay the same shuffles and rewards. Daily seeds use the UTC date.");
    });
  }
  const dailySeedBtn = getEl("btn-use-daily-seed");
  if (dailySeedBtn) {
    dailySeedBtn.addEventListener("click", () => {
      const dailySeed = typeof getDailyRunSeed === "function" ? getDailyRunSeed() : null;
      if (!dailySeed) {
        setText("run-seed-desc", "Unable to determine today's UTC date seed.");
        return;
      }
      if (seedInput) seedInput.value = dailySeed;
      setText("run-seed-desc", `Today's shared daily seed is "${dailySeed}" (UTC).`);
    });
  }
  const copySeedBtn = getEl("btn-copy-run-seed");
  if (copySeedBtn) copySeedBtn.addEventListener("click", copyRunSeed);

  const starterGrid = getEl("starter-decks-grid");
  if (starterGrid) {
    starterGrid.addEventListener("click", (e) => {
      const box = e.target && typeof e.target.closest === "function" ? e.target.closest("[data-starter-idx], [data-starter-id]") : null;
      if (box) {
        const deckById = box.dataset.starterId ? STARTER_DECKS.find(d => d.id === box.dataset.starterId) : null;
        const idx = Number(box.dataset.starterIdx);
        const chosenDeck = deckById || STARTER_DECKS[idx] || STARTER_DECKS[0];
        if (!isStarterDeckAvailable(chosenDeck.id)) {
          setText("starter-unlock-status", getStarterDeckProgressMessage());
          return;
        }
        const challengeId = challengeSelect ? challengeSelect.value : "standard";
        if (!RUN_CHALLENGES.some(challenge => challenge.id === challengeId)) {
          setText("run-challenge-desc", "Select a valid challenge before starting this run.");
          return;
        }
        const campaignId = campaignSelect ? campaignSelect.value : DEFAULT_CAMPAIGN_ID;
        if (!CAMPAIGN_DEFINITIONS.some(campaign => campaign.id === campaignId)) {
          setText("run-campaign-desc", "Select a valid campaign before starting this run.");
          return;
        }
        const seed = seedInput ? seedInput.value : "";
        if (!isValidRunSeedInput(seed)) {
          setText("run-seed-desc", `Seeds must be ${MAX_RUN_SEED_LENGTH} characters or fewer.`);
          return;
        }
        newRunForceChoice = false;
        safeCloseModal(newrunDialog);
        clearRunState();
        startNewRun(chosenDeck, challengeId, campaignId, seed);
      }
    });
  }

  const victoryDialog = getEl("victory-dialog");
  if (victoryDialog) {
    victoryDialog.addEventListener("cancel", (e) => e.preventDefault());
    const endlessBtn = getEl("btn-endless-continue");
    if (endlessBtn) {
      endlessBtn.addEventListener("click", () => {
        safeCloseModal(victoryDialog);
        safeShowModal("shop-dialog");
      });
    }
    const victoryNewRunBtn = getEl("btn-victory-newrun");
    if (victoryNewRunBtn) {
      victoryNewRunBtn.addEventListener("click", () => {
        safeCloseModal(victoryDialog);
        state.runOver = true;
        clearRunState();
        openNewRunModal(true, "🏆 Planeswalker Ascendant — Start a New Run");
      });
    }
  }

  const draftDialog = getEl("draft-dialog");
  if (draftDialog) {
    draftDialog.addEventListener("cancel", (e) => {
      e.preventDefault();
    });

    draftDialog.addEventListener("click", (e) => {
      if (!e.target || typeof e.target.closest !== "function") return;
      const skipBtn = e.target.closest("#btn-skip-draft, .btn-skip-draft");
      if (skipBtn) {
        if (typeof skipDraft === "function") {
          skipDraft();
        }
        return;
      }
      const selectBtn = e.target.closest("[data-draft-choice], [data-draft-pick]");
      if (selectBtn) {
        const choiceIdx = Number(selectBtn.dataset.draftChoice ?? selectBtn.dataset.draftPick);
        if (Number.isFinite(choiceIdx) && typeof selectDraftCard === "function") {
          selectDraftCard(choiceIdx);
        }
        return;
      }
      const draftCard = e.target.closest(".draft-card[data-draft-idx]");
      if (draftCard) {
        const choiceIdx = Number(draftCard.dataset.draftIdx);
        if (Number.isFinite(choiceIdx) && typeof selectDraftCard === "function") {
          selectDraftCard(choiceIdx);
        }
      }
    });
  }

  const shopDialog = getEl("shop-dialog");
  if (shopDialog) {
    shopDialog.addEventListener("cancel", (e) => {
      e.preventDefault();
    });

    shopDialog.addEventListener("click", (e) => {
      if (!e.target || typeof e.target.closest !== "function") return;
      const relicBtn = e.target.closest("[data-buy-relic]");
      if (relicBtn) buyRelic(Number(relicBtn.dataset.buyRelic));

      const cardBtn = e.target.closest("[data-buy-card]");
      if (cardBtn) buyDraftCard(Number(cardBtn.dataset.buyCard));

      const upgBtn = e.target.closest("[data-buy-upg]");
      if (upgBtn) buyUpgrade(Number(upgBtn.dataset.buyUpg));
    });
  }

  const colorDialog = getEl("color-dialog");
  if (colorDialog) {
    colorDialog.addEventListener("cancel", (e) => {
      if (!colorDialogAllowCancel) {
        e.preventDefault();
      }
    });
    colorDialog.addEventListener("close", () => {
      if (colorDialogPendingFallback) {
        const fn = colorDialogPendingFallback;
        colorDialogPendingFallback = null;
        fn();
      }
    });
  }

  const targetDialog = getEl("target-dialog");
  if (targetDialog) {
    targetDialog.addEventListener("close", handleTargetDialogClose);
  }

  const rerollBtn = getEl("btn-reroll-shop");
  if (rerollBtn) {
    rerollBtn.addEventListener("click", () => {
      if (state.gold < 2) return;
      state.gold -= 2;
      generateShopStock(true);
      saveRunState(true);
      renderShop();
      renderAll();
    });
  }

  const nextEncBtn = getEl("btn-next-encounter");
  if (nextEncBtn) {
    nextEncBtn.addEventListener("click", () => {
      safeCloseModal(shopDialog);
      const nextNodes = typeof getAvailableNextRouteNodes === "function" ? getAvailableNextRouteNodes() : [];
      if (nextNodes.length > 0) {
        if (!isHeadlessEnv() && getEl("route-dialog")) {
          openRouteModal(true);
        } else if (typeof selectRouteNode === "function") {
          selectRouteNode(nextNodes[0].id);
        }
        return;
      }
      if (typeof advanceToNextLoopRoute === "function" && state.route && state.route.completedNodeIds.includes("p2_boss")) {
        advanceToNextLoopRoute();
        return;
      }
      state.encounterIdx++;
      beginEncounter();
      saveRunState(false);
    });
  }

  const desktopSettingsBtn = getEl("btn-desktop-settings");
  if (desktopSettingsBtn) {
    desktopSettingsBtn.addEventListener("click", () => {
      cancelHandDrag("settings");
      openDesktopSettingsModal();
    });
  }

  const settingsDialog = getEl("settings-dialog");
  if (settingsDialog && typeof DesktopBridge !== "undefined") {
    const fsBtn = getEl("btn-toggle-fullscreen");
    if (fsBtn) {
      fsBtn.addEventListener("click", async () => {
        await DesktopBridge.toggleFullscreen();
        renderDesktopSettingsModal();
      });
    }

    const scaleGroup = getEl("settings-scale-group");
    if (scaleGroup) {
      scaleGroup.addEventListener("click", async (e) => {
        const btn = e.target && typeof e.target.closest === "function" ? e.target.closest("[data-ui-scale]") : null;
        if (!btn) return;
        await DesktopBridge.updateSettings({ uiScale: Number(btn.dataset.uiScale) });
        renderDesktopSettingsModal();
      });
    }

    const motionGroup = getEl("settings-motion-group");
    if (motionGroup) {
      motionGroup.addEventListener("click", async (e) => {
        const btn = e.target && typeof e.target.closest === "function" ? e.target.closest("[data-motion-mode]") : null;
        if (!btn) return;
        await DesktopBridge.updateSettings({ motionMode: btn.dataset.motionMode });
        renderDesktopSettingsModal();
      });
    }

    const combatSpeedGroup = getEl("settings-combat-speed-group");
    if (combatSpeedGroup) {
      combatSpeedGroup.addEventListener("click", async (e) => {
        const btn = e.target && typeof e.target.closest === "function" ? e.target.closest("[data-combat-speed]") : null;
        if (!btn) return;
        await DesktopBridge.updateSettings({ combatSpeed: btn.dataset.combatSpeed });
        renderDesktopSettingsModal();
      });
    }

    const soundToggle = getEl("settings-sound-enabled");
    if (soundToggle) {
      soundToggle.addEventListener("change", async () => {
        const enabled = Boolean(soundToggle.checked);
        const unlock = enabled ? unlockSoundFromUserGesture() : Promise.resolve(true);
        await DesktopBridge.updateSettings({ soundEnabled: enabled });
        applySoundOutputSettings();
        renderDesktopSettingsModal();
        if (!enabled) {
          setSoundStatusMessage("Sound effects are off.");
          return;
        }
        if (await unlock) {
          setSoundStatusMessage(`Sound effects are on at ${Math.round(DesktopBridge.getSettings().soundVolume * 100)}% volume.`);
        }
      });
    }

    const soundVolume = getEl("settings-sound-volume");
    const soundVolumeValue = getEl("settings-sound-volume-value");
    if (soundVolume && soundVolumeValue) {
      soundVolume.addEventListener("input", () => {
        soundVolumeValue.textContent = `${Math.round(Number(soundVolume.value) || 0)}%`;
      });
      soundVolume.addEventListener("change", async () => {
        const nextVolume = Number(soundVolume.value) / 100;
        await DesktopBridge.updateSettings({ soundVolume: nextVolume });
        applySoundOutputSettings();
        renderDesktopSettingsModal();
      });
    }

    const exportBtn = getEl("btn-export-save");
    if (exportBtn) {
      exportBtn.addEventListener("click", () => {
        const json = DesktopBridge.exportSavePayload();
        if (!json) {
          showSettingsStatusMessage("⚠️ No active run save available to export.", true);
          return;
        }
        try {
          const blob = new Blob([json], { type: "application/json" });
          const url = URL.createObjectURL(blob);
          const a = document.createElement("a");
          const dateTag = new Date().toISOString().slice(0, 10);
          a.href = url;
          a.download = `manastorm-save-${dateTag}.json`;
          document.body.appendChild(a);
          a.click();
          a.remove();
          setTimeout(() => URL.revokeObjectURL(url), 1000);
          showSettingsStatusMessage("✅ Exported save backup (.json)!");
        } catch (_) {
          showSettingsStatusMessage("⚠️ Unable to trigger file download; use Copy Save JSON instead.", true);
        }
      });
    }

    const copyBtn = getEl("btn-copy-save");
    if (copyBtn) {
      copyBtn.addEventListener("click", async () => {
        const json = DesktopBridge.exportSavePayload();
        if (!json) {
          showSettingsStatusMessage("⚠️ No active run save available to copy.", true);
          return;
        }
        const textarea = getEl("textarea-import-save");
        const importBox = getEl("settings-import-box");
        if (textarea) textarea.value = json;
        if (importBox) importBox.hidden = false;
        if (typeof navigator !== "undefined" && navigator.clipboard && navigator.clipboard.writeText) {
          try {
            await navigator.clipboard.writeText(json);
            showSettingsStatusMessage("✅ Save JSON copied to clipboard!");
            return;
          } catch (_) {}
        }
        showSettingsStatusMessage("✅ Save JSON placed in the text box below!");
      });
    }

    const toggleImportBtn = getEl("btn-toggle-import-save");
    if (toggleImportBtn) {
      toggleImportBtn.addEventListener("click", () => {
        const importBox = getEl("settings-import-box");
        if (importBox) importBox.hidden = !importBox.hidden;
      });
    }

    const fileInput = getEl("input-import-file");
    if (fileInput) {
      fileInput.addEventListener("change", async (e) => {
        const file = e.target.files && e.target.files[0];
        if (!file) return;
        try {
          const text = await file.text();
          const textarea = getEl("textarea-import-save");
          if (textarea) textarea.value = text;
          showSettingsStatusMessage(`📂 Loaded ${file.name} — click Restore Imported Run to apply.`);
        } catch (_) {
          showSettingsStatusMessage("⚠️ Failed to read the selected save file.", true);
        }
      });
    }

    const confirmImportBtn = getEl("btn-confirm-import-save");
    if (confirmImportBtn) {
      confirmImportBtn.addEventListener("click", async () => {
        const textarea = getEl("textarea-import-save");
        const raw = textarea ? textarea.value : "";
        const res = await DesktopBridge.importSavePayload(raw);
        if (!res.ok) {
          showSettingsStatusMessage(`⚠️ ${res.error}`, true);
          return;
        }
        showSettingsStatusMessage(
          `✅ Restored ${res.summary.archetype} (Encounter ${res.summary.encounter})!`
        );
        renderDesktopSettingsModal();
        setTimeout(() => {
          safeCloseModal(settingsDialog);
        }, 450);
      });
    }

    const settingsNewRunBtn = getEl("btn-settings-newrun");
    if (settingsNewRunBtn) {
      settingsNewRunBtn.addEventListener("click", () => {
        safeCloseModal(settingsDialog);
        openNewRunModal(Boolean(state.runOver));
      });
    }

    const quitBtn = getEl("btn-quit-desktop");
    if (quitBtn) {
      quitBtn.addEventListener("click", () => {
        DesktopBridge.quitApp();
      });
    }
  }

  if (typeof HTMLDialogElement !== "undefined" && !("closedBy" in HTMLDialogElement.prototype)) {
    const outside = (e, dialog) => {
      const r = dialog.getBoundingClientRect();
      return e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom;
    };
    for (const dialog of queryAll("dialog")) {
      let pressedOutside = false;
      dialog.addEventListener("pointerdown", (e) => {
        pressedOutside = dialog.getAttribute("closedby") === "any" && outside(e, dialog);
      });
      dialog.addEventListener("pointerup", (e) => {
        if (pressedOutside && dialog.getAttribute("closedby") === "any" && outside(e, dialog)) {
          safeCloseModal(dialog);
        }
      });
    }
  }
}
