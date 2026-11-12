# MANASTORM — Tactical TCG Roguelike

> **MTG × Balatro tactical deckbuilder** with tactile cards, foil shaders, fanned-arc hand mechanics, and a reactive drag-and-drop combat engine — featuring both a **100% Native Python Desktop App (Pygame-CE + ModernGL)** and a lightweight **Web/Tauri v2 Desktop App**.

---

## 📁 Repository Structure

```
/Users/gunner/Programming/Sandbox/
├── python/                     # 100% Native Python Desktop Game
│   ├── manastorm/              # Core game engine, UI, audio, and rules
│   │   ├── main.py             # Desktop game runner
│   │   ├── core/               # Deterministic rule engine, mana solver, combat math
│   │   ├── ui/                 # Symplectic Euler spring physics & fanned arc layout
│   │   ├── audio/              # NumPy waveform oscillator synthesis
│   │   └── data/               # Card and encounter databases
│   ├── tests/                  # Automated pytest test suite (23 passing tests)
│   ├── assets/                 # Shaders (card_vert.glsl, foil_frag.glsl), icons, fonts
│   ├── pyproject.toml          # Python package configuration
│   └── .venv/                  # Virtual environment with Pygame-CE & ModernGL
├── web/                        # Web & Tauri v2 Desktop Implementation
│   ├── index.html              # Frontend DOM battlefield UI
│   ├── style.css               # CSS design system & foil shaders
│   ├── game.js                 # JS game state loop
│   ├── combat.js               # Combat calculations
│   ├── mana.js                 # Exact colored mana solver
│   ├── ui.js                   # Web DOM renderer & spring drag controller
│   ├── data/                   # cards.js & relics.js
│   ├── src-tauri/              # Tauri v2 Rust desktop wrapper
│   ├── scripts/                # Packaging and asset staging scripts
│   └── package.json            # npm scripts & test runners
└── docs/                       # Project Documentation & Architecture Guides
    ├── FIXES.md
    ├── GAME_IDEAS.md
    └── GAME_UI_IMPROVEMENTS.md
```

---

## 🐍 Running the Native Python Desktop App

The Python implementation runs natively via **Pygame-CE** and **ModernGL** with procedural audio synthesis:

```bash
# Run the Python desktop game
cd python
.venv/bin/python manastorm/main.py
# Or using the installed command
.venv/bin/manastorm

# Run the Python pytest suite
.venv/bin/pytest tests/
```

### Controls (Python Desktop):
- **Mouse Drag / Click**: Drag card up to cast, or click to play directly.
- **Battlefield Click**: Click any friendly creature to toggle **⚔️ Attacking** vs **🛡️ Guarding**.
- **Land Click**: Click an untapped land in the Land row to manually tap for mana.
- `1`–`9`: Play corresponding card from hand.
- `Space`: Resolve combat attack and end turn.
- `M`: Turn 1 Free Mulligan (reshuffle and redraw hand).
- `S`: Toggle audio mute.
- `R`: Start new run on game over.
- `Esc`: Cancel drag / Quit.

---

## 🌐 Running the Web / Tauri App

```bash
cd web

# 1. Run in web browser
open index.html

# 2. Rebuild native macOS bundle
npm run build:macos
open dist-macos/MANASTORM.app

# 3. Run in Tauri v2 development window
npm run tauri:dev

# 4. Run JS test suites
npm test
```

---

## 🧪 Testing & Verification

- **Python Suite**: `cd python && .venv/bin/pytest tests/` (23 unit assertions across mana solving, combat math, game loop, UI physics, and audio)
- **Web Suite**: `cd web && npm test` (unit, adversarial stress, and desktop assertions)
