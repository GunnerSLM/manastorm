# MANASTORM — Tactical TCG Roguelike (macOS App)

> **MTG × Balatro tactical deckbuilder** packaged as a lightweight, self-contained native macOS `.app` (`Cocoa` + `WKWebView`, zero external runtime dependencies, < 2 MB bundle).

## Build & Run

```bash
# Build dist-macos/MANASTORM.app
npm run build

# Launch the app
npm run open
# (or: open dist-macos/MANASTORM.app)
```

## Testing

```bash
# Run unit, adversarial stress, and native macOS app verification suites
npm test
```

## Project Layout

```text
├── macos-native/main.m     # Native Cocoa + WKWebView shell, unified titlebar, IPC & disk persistence
├── scripts/
│   ├── build-macos-app.js  # Compiles MANASTORM.app & ad-hoc signs it
│   ├── build-dist.js       # Stages production runtime assets into dist/
│   └── generate-icons.js   # Procedural PNG & macOS .icns icon generator
├── icons/                  # Generated app icons
├── data/                   # Card, relic, consumable, encounter & starter deck definitions
├── index.html, style.css   # Tactical battlefield UI & foil shaders
├── game.js, combat.js, mana.js, ui.js, desktop.js
└── dist-macos/MANASTORM.app (generated)
```
