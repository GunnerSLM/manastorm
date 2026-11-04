# MANASTORM — Tactical TCG Roguelike

> **MTG × Balatro tactical deckbuilder** with tactile cards, foil shaders, fanned-arc hand mechanics, and a reactive drag-and-drop combat engine.

---

## 🌟 Key Features

- **Balatro × MTG Combat Math Engine**: Unblocked creature power scales with planeswalker resonance (`Power × Resonance`) to deal devastating projected damage.
- **Tactile Card Feel & 3D Tilt**: Pointer-tracked 3D tilt with real-time glare dynamics and customized foil shaders (`Foil`, `Etched`, `Halo`).
- **Fanned Arc Hand & Dynamic Overlap**: Cards fan dynamically into a natural arc with parabolic sag, hover/focus straightening, and smooth adjacent card spreading.
- **Spring-Physics Drag to Play**: Fluid Symplectic Euler spring mechanics with velocity lean, drop zone targeting (Lands, Creatures, Spells), wobble snapback on invalid drops, and FLIP transitions.
- **Accessibility & Reduced Motion**: Full keyboard navigation, screen reader accessibility attributes, and instantaneous `prefers-reduced-motion` compliance.
- **Comprehensive Headless Verification**: Automated unit test suites, headless campaign balance simulators, and adversarial stress harnesses.

---

## 🚀 Quick Start

MANASTORM is a zero-dependency, pure web application.

### Running in the Browser
Simply open `index.html` in any modern web browser:
```bash
open index.html
```
Or start a local web server:
```bash
# Python 3
python3 -m http.server 8000

# or Node.js npx
npx serve .
```
Then navigate to `http://localhost:8000`.

---

## 🧪 Testing & Simulation

The project includes unit tests, balance simulations, and adversarial gesture/state-machine stress tests:

```bash
# Run unit tests (137 tests across rules, combat, and UI mechanics)
node tests.js

# Run adversarial drag & UI stress harness (691 hostile assertions)
node adversarial_stress_test.js

# Run headless 3,200-campaign balance simulator
node sim.js
```

---

## 📁 Project Structure

```
├── index.html                 # Main application UI and battlefield layout
├── style.css                  # Game design system, 3D tilt, and fanned-hand styles
├── game.js                    # Game loop, turn structure, and state management
├── combat.js                  # Combat calculations, resonance, and damage resolution
├── mana.js                    # MTG-style color pip management and mana generation
├── ui.js                      # UI controller, drag-to-play, spring physics, and fan layout
├── data/
│   ├── cards.js               # Card definitions (Creatures, Spells, Lands)
│   └── relics.js              # Relics, shop items, and modifier definitions
├── tests.js                   # Node-compatible unit test suite
├── adversarial_stress_test.js # Hostile stress tests for pointer/drag/physics
└── sim.js                     # Headless campaign Monte Carlo balance simulator
```

---

## 🎮 Controls

- **Mouse / Drag**: Click and drag cards to their target zones (Lands $\to$ Land row, Creatures $\to$ Battlefield, Spells $\to$ Table).
- **Click**: Click an unplayed card to play it directly.
- **Touch**: Tap once to focus and inspect; tap again to play. Dragging is also directly supported.
- **Keyboard Shortcuts**: Number keys (`1`–`9`) play cards from hand; `Space` / `Enter` advances phase; `Esc` cancels active drags.
