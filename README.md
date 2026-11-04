# MANASTORM — Tactical TCG Roguelike

> **MTG × Balatro tactical deckbuilder** with tactile cards, foil shaders, fanned-arc hand mechanics, and a reactive drag-and-drop combat engine — packaged as a lightweight **Desktop App (Tauri v2 & Native macOS `WKWebView`)** and standalone web application.

---

## 🌟 Key Features

- **Native Desktop App (`< 2 MB`)**: Standalone desktop application powered by Tauri v2 and macOS native `WKWebView` with atomic disk save persistence (`~/Library/Application Support/com.manastorm.tcg/`), native fullscreen (`F11` / `⌃⌘F`), OS menu bar integration, UI scaling (`90%–120%`), and JSON save backup export/import.
- **Balatro × MTG Combat Math Engine**: Unblocked creature power scales with planeswalker resonance (`Power × Resonance`) to deal devastating projected damage.
- **Tactile Card Feel & 3D Tilt**: Pointer-tracked 3D tilt with real-time glare dynamics and customized foil shaders (`Foil`, `Etched`, `Halo`).
- **Fanned Arc Hand & Dynamic Overlap**: Cards fan dynamically into a natural arc with parabolic sag, hover/focus straightening, and smooth adjacent card spreading.
- **Spring-Physics Drag to Play**: Fluid Symplectic Euler spring mechanics with velocity lean, drop zone targeting (Lands, Creatures, Spells), wobble snapback on invalid drops, and FLIP transitions.
- **Accessibility & Reduced Motion**: Full keyboard navigation, screen reader accessibility attributes, and in-app or system `prefers-reduced-motion` compliance.
- **Comprehensive Headless Verification**: Automated unit test suites, desktop IPC & native binary self-tests, headless campaign balance simulators, and adversarial stress harnesses.

---

## 🖥️ Running the Desktop App

### 1. Instant Native macOS App (`MANASTORM.app` — Zero Rust/Network Required)
A precompiled native Apple Silicon (`arm64`) macOS application bundle is built directly into `dist-macos/MANASTORM.app` using macOS Cocoa & WebKit (`WKWebView`):

```bash
# Launch the compiled macOS Desktop App
open dist-macos/MANASTORM.app

# Rebuild the native macOS .app bundle from source at any time
npm run build:macos
```

### 2. Cross-Platform Tauri v2 Build (macOS `.dmg`, Windows `.msi`/`.exe`, Linux `.deb`/`.AppImage`)
The project includes a complete **Tauri v2** configuration in `src-tauri/`. If you have the Rust toolchain (`rustup`) installed:

```bash
# Run in Tauri development window
npm run tauri:dev

# Build production installers (.dmg, .app, .msi, .exe, .AppImage)
npm run tauri:build
```

### 3. Running in the Browser
You can also open `index.html` directly in any modern web browser:
```bash
open index.html
```

---

## 🧪 Testing & Simulation

The project includes unit tests, adversarial gesture/state-machine stress tests, desktop runtime/binary verification tests, and balance simulations:

```bash
# Run all test suites (137 unit + 691 adversarial + 55 desktop assertions)
npm test

# Run individual suites
node tests.js                   # 137 unit tests across rules, combat, and UI mechanics
node adversarial_stress_test.js # 691 hostile assertions for pointer/drag/physics
node desktop_tests.js           # 55 assertions for Tauri v2, DesktopBridge, & MANASTORM.app binary
node sim.js                     # Headless 3,200-campaign Monte Carlo balance simulator
```

---

## 📁 Project Structure

```
├── index.html                   # Main application UI, battlefield layout, and Desktop Settings modal
├── style.css                    # Game design system, 3D tilt, fanned-hand, and UI scale styles
├── desktop.js                   # Unified Desktop Bridge (Tauri v2, macOS WKWebView & Web fallback)
├── game.js                      # Game loop, turn structure, and state/save management
├── combat.js                    # Combat calculations, resonance, and damage resolution
├── mana.js                      # MTG-style color pip management and mana solver
├── ui.js                        # UI controller, drag-to-play, spring physics, and fan layout
├── data/
│   ├── cards.js                 # Card definitions (Creatures, Spells, Lands, Starter Decks)
│   └── relics.js                # Relics, shop items, and boss encounter definitions
├── src-tauri/
│   ├── Cargo.toml               # Tauri v2 Rust crate manifest
│   ├── tauri.conf.json          # Tauri v2 window, bundle, CSP, and frontendDist configuration
│   ├── capabilities/default.json# Tauri v2 window & core ACL permissions
│   ├── src/lib.rs               # Tauri v2 Rust IPC commands (disk save/load, fullscreen, window title)
│   ├── src/main.rs              # Tauri v2 binary entry point
│   ├── macos-native/main.m      # Native Objective-C Cocoa + WKWebView macOS app implementation
│   └── icons/                   # Generated PNG, macOS .icns, and Windows .ico application icons
├── scripts/
│   ├── generate-icons.js        # Procedural high-DPI MANASTORM icon generator (.png, .icns, .ico)
│   ├── build-dist.js            # Stages clean frontend production assets into dist/
│   └── build-macos-app.js       # Compiles and codesigns dist-macos/MANASTORM.app
├── tests.js                     # Node-compatible unit test suite (137 tests)
├── adversarial_stress_test.js   # Hostile stress tests for pointer/drag/physics (691 tests)
├── desktop_tests.js             # Desktop bridge, Tauri config, and native binary test suite (55 tests)
└── sim.js                       # Headless campaign Monte Carlo balance simulator
```

---

## 🎮 Controls & Desktop Hotkeys

- **Mouse / Drag**: Click and drag cards to their target zones (Lands $\to$ Land row, Creatures $\to$ Battlefield, Spells $\to$ Table).
- **Click**: Click an unplayed card to play it directly.
- **Touch**: Tap once to focus and inspect; tap again to play. Dragging is also directly supported.
- **Desktop Keyboard Shortcuts**:
  - `1`–`9`: Play card from hand
  - `Space`: Resolve combat attack & end turn
  - `M`: Use Turn-1 Free Mulligan
  - `L` / `G`: Inspect remaining Library / Graveyard
  - `F11` or `⌃⌘F`: Toggle native fullscreen
  - `,` or `⌘,`: Open Desktop & Sanctum Save Settings
  - `Esc`: Cancel active drag / close modal dialog
