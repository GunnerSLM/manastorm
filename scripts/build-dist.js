#!/usr/bin/env node
/**
 * MANASTORM — Frontend Distribution Stager
 * Stages clean production frontend assets into ./dist for Tauri v2 (frontendDist: "../dist")
 * and the native macOS application bundle, excluding test harnesses and build artifacts.
 */

const fs = require("fs");
const path = require("path");

const ROOT_DIR = path.resolve(__dirname, "..");
const DIST_DIR = path.join(ROOT_DIR, "dist");

const RUNTIME_FILES = [
  "index.html",
  "style.css",
  "desktop.js",
  "game.js",
  "combat.js",
  "mana.js",
  "ui.js",
  "data/cards.js",
  "data/card_art.js",
  "data/relics.js"
];

function buildDist() {
  fs.rmSync(DIST_DIR, { recursive: true, force: true });
  fs.mkdirSync( path.join(DIST_DIR, "data"), { recursive: true });

  for (const relPath of RUNTIME_FILES) {
    const src = path.join(ROOT_DIR, relPath);
    const dest = path.join(DIST_DIR, relPath);
    if (!fs.existsSync(src)) {
      throw new Error(`Missing required runtime file: ${relPath}`);
    }
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.copyFileSync(src, dest);
  }

  // Copy icon if available
  const iconSrc = path.join(ROOT_DIR, "icons", "128x128.png");
  if (fs.existsSync(iconSrc)) {
    fs.copyFileSync(iconSrc, path.join(DIST_DIR, "icon.png"));
  }

  console.log(`✅ Staged ${RUNTIME_FILES.length} runtime assets into dist/`);
  return DIST_DIR;
}

if (require.main === module) {
  buildDist();
}

module.exports = { buildDist, RUNTIME_FILES, DIST_DIR };
