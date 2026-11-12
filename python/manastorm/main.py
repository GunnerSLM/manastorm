"""MANASTORM — Tactical TCG Roguelike in Native Python.

Native Desktop GUI using Pygame-CE:
- Fanned arc hand layout with sagitta curvature, hover elevation, and playable card glow
- Symplectic Euler spring drag-to-play with velocity lean
- Real-time MTG x Balatro combat projection & live damage breakdown
- Attacker toggling (Attacking ⚔️ vs Guarding 🛡️)
- Manual land tapping for floating mana pool
- Turn 1 Free Mulligan (M key or button)
- Victory card drafting & encounter progression (Garruk, Krenko, Sheoldred, Talrand...)
- Detailed card inspection preview on hover
- Floating combat FX notifications and live combat event log
- Procedural oscillator audio synthesis with toggle (S key)
"""

import sys
import os
import pygame
from typing import Optional, List, Tuple, Dict, Any
from manastorm.core.engine import create_new_game, GameState, MAX_LIFE, START_LIFE
from manastorm.core.models import Card, CreatureState, LandState
from manastorm.core.mana import can_play_card
from manastorm.core.combat import calculate_combat_projection, BlockerState
from manastorm.ui.hand_fan import calculate_fan_layout
from manastorm.ui.physics import SpringState, step_spring, calculate_drag_lean
from manastorm.audio.synth import SoundManager

WINDOW_WIDTH = 1240
WINDOW_HEIGHT = 820
CARD_WIDTH = 136
CARD_HEIGHT = 186

# Dark tactical fantasy palette matching style.css
COLOR_BG = (15, 17, 26)
COLOR_PANEL = (24, 28, 42)
COLOR_PANEL_ALT = (19, 22, 34)
COLOR_BORDER = (45, 52, 74)
COLOR_BORDER_LIGHT = (70, 80, 110)
COLOR_TEXT_PRIMARY = (235, 240, 255)
COLOR_TEXT_MUTED = (140, 150, 175)
COLOR_GOLD = (255, 212, 102)
COLOR_ACCENT = (75, 240, 153)
COLOR_BURN = (255, 71, 87)
COLOR_BLUE = (89, 162, 255)
COLOR_PURPLE = (175, 100, 255)

MANA_COLORS = {
    "G": (46, 204, 113),
    "R": (231, 76, 60),
    "B": (44, 62, 80),
    "U": (52, 152, 219),
    "W": (241, 196, 15),
    "C": (149, 165, 166),
    "ANY": (155, 89, 182),
}


class ManastormApp:
    def __init__(self):
        pygame.init()
        pygame.display.set_caption("MANASTORM — Tactical TCG Roguelike")
        self.screen = pygame.display.set_mode((WINDOW_WIDTH, WINDOW_HEIGHT))
        self.clock = pygame.time.Clock()
        self.running = True

        # Initialize audio
        self.sound = SoundManager(enabled=True)
        self.sound.init_audio()

        # Fonts
        self.font_hero = pygame.font.SysFont("system", 28, bold=True)
        self.font_title = pygame.font.SysFont("system", 20, bold=True)
        self.font_body = pygame.font.SysFont("system", 14)
        self.font_small = pygame.font.SysFont("system", 11)
        self.font_bold = pygame.font.SysFont("system", 13, bold=True)
        self.font_pt = pygame.font.SysFont("system", 15, bold=True)

        # Game state
        self.game: GameState = create_new_game(deck_index=0, seed="MANASTORM-RUN-1")

        # Drag & Interaction state
        self.hovered_card_idx: Optional[int] = None
        self.dragged_card_idx: Optional[int] = None
        self.drag_start_pos = (0, 0)
        self.has_dragged = False
        self.drag_spring_x = SpringState()
        self.drag_spring_y = SpringState()

        # Inspected card for tooltip preview
        self.inspected_card: Optional[Any] = None
        self.inspected_type: str = ""  # "hand", "creature", "blocker", "land", "draft"

        # Active floating notifications: list of {"text": str, "color": tuple, "x": float, "y": float, "ttl": float}
        self.active_fx: List[Dict[str, Any]] = []

    def run(self):
        while self.running:
            dt = self.clock.tick(60) / 1000.0  # Seconds
            self.handle_events()
            self.update(dt)
            self.render()
            pygame.display.flip()
        pygame.quit()

    def handle_events(self):
        mouse_pos = pygame.mouse.get_pos()

        for event in pygame.event.get():
            if event.type == pygame.QUIT:
                self.running = False

            elif event.type == pygame.KEYDOWN:
                if event.key == pygame.K_ESCAPE:
                    if self.dragged_card_idx is not None:
                        self.dragged_card_idx = None
                    else:
                        self.running = False
                elif event.key == pygame.K_SPACE:
                    if not self.game.in_draft and not self.game.run_over:
                        self.resolve_combat()
                elif event.key == pygame.K_m:
                    if self.game.can_mulligan:
                        if self.game.mulligan():
                            self.sound.play("cardPlay")
                elif event.key == pygame.K_s:
                    self.sound.enabled = not self.sound.enabled
                    self.game.spawn_fx(f"Sound {'ON' if self.sound.enabled else 'MUTED'}", "#ffd466")
                elif event.key == pygame.K_r:
                    if self.game.run_over:
                        self.game = create_new_game(deck_index=0)
                        self.game.spawn_fx("New Run Started!", "#4bf099")
                elif pygame.K_1 <= event.key <= pygame.K_9:
                    idx = event.key - pygame.K_1
                    if idx < len(self.game.hand):
                        self.play_card_by_index(idx)

            elif event.type == pygame.MOUSEBUTTONDOWN and event.button == 1:
                # Handle draft clicks if in draft modal
                if self.game.in_draft:
                    self.handle_draft_click(mouse_pos)
                    continue

                # Handle game over restart click
                if self.game.run_over:
                    restart_btn = pygame.Rect(WINDOW_WIDTH // 2 - 100, WINDOW_HEIGHT // 2 + 60, 200, 45)
                    if restart_btn.collidepoint(mouse_pos):
                        self.game = create_new_game(deck_index=0)
                        self.game.spawn_fx("New Run Started!", "#4bf099")
                    continue

                # Check Mulligan button click
                if self.game.can_mulligan:
                    mull_btn = pygame.Rect(WINDOW_WIDTH - 280, 460, 120, 36)
                    if mull_btn.collidepoint(mouse_pos):
                        if self.game.mulligan():
                            self.sound.play("cardPlay")
                        continue

                # Check Combat attack button click
                combat_btn_rect = pygame.Rect(WINDOW_WIDTH - 280, 405, 250, 48)
                if combat_btn_rect.collidepoint(mouse_pos):
                    self.resolve_combat()
                    continue

                # Check clicking on lands to tap for mana manually
                land_clicked = self.handle_land_click(mouse_pos)
                if land_clicked:
                    continue

                # Check clicking on player creatures to toggle attack
                creature_clicked = self.handle_creature_click(mouse_pos)
                if creature_clicked:
                    continue

                # Check start dragging card from hand
                if self.hovered_card_idx is not None:
                    self.dragged_card_idx = self.hovered_card_idx
                    self.drag_start_pos = mouse_pos
                    self.has_dragged = False
                    self.drag_spring_x = SpringState(pos=mouse_pos[0], vel=0.0)
                    self.drag_spring_y = SpringState(pos=mouse_pos[1], vel=0.0)

            elif event.type == pygame.MOUSEBUTTONUP and event.button == 1:
                if self.dragged_card_idx is not None:
                    dist = ((mouse_pos[0] - self.drag_start_pos[0]) ** 2 + (mouse_pos[1] - self.drag_start_pos[1]) ** 2) ** 0.5
                    # If dragged up or clicked, play card!
                    if mouse_pos[1] < WINDOW_HEIGHT - 210 or dist < 8:
                        self.play_card_by_index(self.dragged_card_idx)
                    self.dragged_card_idx = None

    def handle_draft_click(self, mouse_pos: Tuple[int, int]) -> bool:
        start_x = WINDOW_WIDTH // 2 - 240
        y = WINDOW_HEIGHT // 2 - 80
        for i, card in enumerate(self.game.draft_choices):
            rect = pygame.Rect(start_x + i * 170, y, 150, 210)
            if rect.collidepoint(mouse_pos):
                self.game.draft_card(card.id)
                self.sound.play("victory")
                return True
        return False

    def handle_land_click(self, mouse_pos: Tuple[int, int]) -> bool:
        lx = 35
        for land in self.game.player_lands:
            rect = pygame.Rect(lx, 420, 84, 40)
            if rect.collidepoint(mouse_pos):
                if not land.tapped:
                    if self.game.tap_land_manually(land.uid):
                        self.sound.play("manaTap")
                    return True
            lx += 92
        return False

    def handle_creature_click(self, mouse_pos: Tuple[int, int]) -> bool:
        cx = 35
        for c in self.game.player_creatures:
            rect = pygame.Rect(cx, 245, 115, 125)
            if rect.collidepoint(mouse_pos):
                self.game.toggle_attacker(c.uid)
                return True
            cx += 128
        return False

    def play_card_by_index(self, idx: int):
        if idx >= len(self.game.hand):
            return
        card = self.game.hand[idx]

        # Check playability
        if not can_play_card(
            card=card,
            mana_pool=self.game.mana_pool,
            player_lands=self.game.player_lands,
            lands_played_this_turn=self.game.lands_played_this_turn,
            max_lands_per_turn=self.game.max_lands_per_turn,
            player_life=self.game.player_life,
            combat_locked=self.game.combat_locked,
            run_over=self.game.run_over,
            has_lantern=self.game.has_any_color_lands()
        ):
            reason = f"Need {card.manaCost}!" if card.type != "Land" else f"Land Limit ({self.game.max_lands_per_turn}/turn)"
            self.game.spawn_fx(f"Can't Play: {reason}", "#ff4757")
            return

        success = False
        if card.type == "Land":
            success = self.game.play_land(idx)
        elif card.type == "Creature":
            success = self.game.play_creature(idx)
        else:
            success = self.game.play_spell(idx)

        if success:
            self.sound.play("cardPlay")

    def resolve_combat(self):
        if self.game.run_over or self.game.in_draft:
            return

        proj = self.game.resolve_combat_step()
        if proj.total_damage > 0:
            self.sound.play("impact")

        if self.game.enemy_life <= 0:
            self.sound.play("victory")
        elif self.game.player_life <= 0 or self.game.turn > self.game.max_turns:
            self.sound.play("defeat")

    def update(self, dt: float):
        mouse_pos = pygame.mouse.get_pos()
        hand_count = len(self.game.hand)

        # Ingest FX from game engine queue
        while self.game.fx_queue:
            fx = self.game.fx_queue.pop(0)
            self.active_fx.append({
                "text": fx["text"],
                "color_hex": fx["color"],
                "x": WINDOW_WIDTH // 2 - 100,
                "y": WINDOW_HEIGHT // 2 + len(self.active_fx) * 25,
                "vy": -35.0,
                "ttl": fx.get("ttl", 2.2),
                "alpha": 255.0
            })

        # Update active FX
        surviving_fx = []
        for fx in self.active_fx:
            fx["ttl"] -= dt
            fx["y"] += fx["vy"] * dt
            fx["alpha"] = max(0.0, min(255.0, (fx["ttl"] / 2.2) * 255.0))
            if fx["ttl"] > 0:
                surviving_fx.append(fx)
        self.active_fx = surviving_fx

        # Update hovered card & inspector target
        self.hovered_card_idx = None
        self.inspected_card = None
        self.inspected_type = ""

        # Check hand hover
        if self.dragged_card_idx is None and mouse_pos[1] > WINDOW_HEIGHT - 230:
            for idx in reversed(range(hand_count)):
                layout = calculate_fan_layout(idx, hand_count, container_width=WINDOW_WIDTH - 260, card_width=CARD_WIDTH)
                card_x = (WINDOW_WIDTH - 280) // 2 + layout.x - CARD_WIDTH // 2
                card_y = WINDOW_HEIGHT - 215 + layout.y
                rect = pygame.Rect(card_x, card_y, CARD_WIDTH, CARD_HEIGHT)
                if rect.collidepoint(mouse_pos):
                    self.hovered_card_idx = idx
                    self.inspected_card = self.game.hand[idx]
                    self.inspected_type = "hand"
                    break

        # Check battlefield creature hover
        if not self.inspected_card:
            cx = 35
            for c in self.game.player_creatures:
                rect = pygame.Rect(cx, 245, 115, 125)
                if rect.collidepoint(mouse_pos):
                    self.inspected_card = c
                    self.inspected_type = "creature"
                    break
                cx += 128

        # Check enemy blocker hover
        if not self.inspected_card:
            bx = 350
            for b in self.game.enemy_creatures:
                rect = pygame.Rect(bx, 75, 115, 120)
                if rect.collidepoint(mouse_pos):
                    self.inspected_card = b
                    self.inspected_type = "blocker"
                    break
                bx += 128

        # Update drag spring
        if self.dragged_card_idx is not None:
            self.drag_spring_x = step_spring(self.drag_spring_x, mouse_pos[0], dt)
            self.drag_spring_y = step_spring(self.drag_spring_y, mouse_pos[1], dt)

    def render(self):
        self.screen.fill(COLOR_BG)

        # Top HUD Bar
        self.render_hud()

        # Enemy Encounter Section
        self.render_enemy_row()

        # Player Battlefield Section
        self.render_battlefield()

        # Lands & Mana Section
        self.render_lands_row()

        # Combat Projection & Action Panel
        self.render_combat_panel()

        # Fanned Hand Row
        self.render_hand()

        # Floating FX Text
        self.render_fx()

        # Dragged Card
        if self.dragged_card_idx is not None and self.dragged_card_idx < len(self.game.hand):
            card = self.game.hand[self.dragged_card_idx]
            lean = calculate_drag_lean(self.drag_spring_x.vel)
            cx = int(self.drag_spring_x.pos)
            cy = int(self.drag_spring_y.pos)
            self.draw_card(cx - CARD_WIDTH // 2, cy - CARD_HEIGHT // 2, card, rotation=lean, is_dragged=True)

        # Detailed Card Inspector Tooltip (when hovering any card)
        if self.inspected_card and self.dragged_card_idx is None:
            self.render_inspector_card()

        # Overlays: Draft Modal or Game Over Modal
        if self.game.in_draft:
            self.render_draft_overlay()
        elif self.game.run_over:
            self.render_game_over_overlay()

    def render_hud(self):
        hud_rect = pygame.Rect(0, 0, WINDOW_WIDTH, 52)
        pygame.draw.rect(self.screen, COLOR_PANEL, hud_rect)
        pygame.draw.line(self.screen, COLOR_BORDER, (0, 52), (WINDOW_WIDTH, 52), 1)

        # Planeswalker Life
        life_pct = max(0.0, min(1.0, self.game.player_life / MAX_LIFE))
        life_col = (255, 90, 100) if self.game.player_life > 6 else (255, 40, 50)
        life_surf = self.font_bold.render(f"❤️ Life: {self.game.player_life}/{MAX_LIFE}", True, life_col)
        self.screen.blit(life_surf, (20, 16))

        # Gold
        gold_surf = self.font_bold.render(f"🪙 Gold: {self.game.gold}", True, COLOR_GOLD)
        self.screen.blit(gold_surf, (170, 16))

        # Turn indicator
        turn_surf = self.font_bold.render(f"⏳ Turn {self.game.turn} of {self.game.max_turns}", True, COLOR_TEXT_PRIMARY)
        self.screen.blit(turn_surf, (300, 16))

        # Resonance
        res_surf = self.font_bold.render(f"✨ Resonance: ×{self.game.turn_resonance:.1f}", True, COLOR_BLUE)
        self.screen.blit(res_surf, (460, 16))

        # Burn Power
        burn_surf = self.font_bold.render(f"🔥 Burn: +{self.game.turn_burn_power}", True, COLOR_BURN)
        self.screen.blit(burn_surf, (640, 16))

        # Sound status
        snd_text = "🔊 Sound [S]" if self.sound.enabled else "🔇 Muted [S]"
        snd_surf = self.font_small.render(snd_text, True, COLOR_TEXT_MUTED)
        self.screen.blit(snd_surf, (WINDOW_WIDTH - 110, 18))

    def render_enemy_row(self):
        panel_rect = pygame.Rect(20, 65, WINDOW_WIDTH - 320, 145)
        pygame.draw.rect(self.screen, COLOR_PANEL, panel_rect, border_radius=8)
        pygame.draw.rect(self.screen, COLOR_BORDER, panel_rect, 1, border_radius=8)

        # Boss Tier & Name
        tier_surf = self.font_small.render(self.game.enemy_tier, True, COLOR_BURN)
        self.screen.blit(tier_surf, (35, 75))
        enc_title = self.font_title.render(self.game.enemy_name, True, COLOR_GOLD)
        self.screen.blit(enc_title, (35, 92))

        # Health bar
        bar_w = 260
        bar_h = 16
        pct = max(0.0, min(1.0, self.game.enemy_life / float(max(1, self.game.enemy_max_life))))
        pygame.draw.rect(self.screen, (50, 20, 20), (35, 122, bar_w, bar_h), border_radius=4)
        pygame.draw.rect(self.screen, COLOR_BURN, (35, 122, int(bar_w * pct), bar_h), border_radius=4)
        life_lbl = self.font_bold.render(f"{self.game.enemy_life} / {self.game.enemy_max_life} HP", True, COLOR_TEXT_PRIMARY)
        self.screen.blit(life_lbl, (35 + bar_w + 12, 120))

        # Boss special rule
        if self.game.enemy_rule:
            rule_line = self.game.enemy_rule[:48] + "..." if len(self.game.enemy_rule) > 50 else self.game.enemy_rule
            rule_surf = self.font_small.render(rule_line, True, COLOR_TEXT_MUTED)
            self.screen.blit(rule_surf, (35, 145))

        # Enemy Blockers
        bx = 350
        for b in self.game.enemy_creatures:
            b_rect = pygame.Rect(bx, 75, 115, 122)
            bg = (55, 30, 35) if not b.frozen else (30, 45, 60)
            pygame.draw.rect(self.screen, bg, b_rect, border_radius=6)
            b_border = (160, 50, 60) if not b.frozen else COLOR_BLUE
            pygame.draw.rect(self.screen, b_border, b_rect, 2 if not b.frozen else 3, border_radius=6)

            name_surf = self.font_bold.render(b.name[:13], True, COLOR_TEXT_PRIMARY)
            self.screen.blit(name_surf, (bx + 8, 85))

            stats_surf = self.font_pt.render(f"⚔️ {b.power} / 🛡️ {b.toughness}", True, COLOR_GOLD)
            self.screen.blit(stats_surf, (bx + 8, 110))

            status_text = "❄️ FROZEN" if b.frozen else ("🦅 Flying" if "Flying" in b.keywords else "🛡️ Blocker")
            status_surf = self.font_small.render(status_text, True, COLOR_BLUE if b.frozen else COLOR_TEXT_MUTED)
            self.screen.blit(status_surf, (bx + 8, 138))

            bx += 128

    def render_battlefield(self):
        panel_rect = pygame.Rect(20, 222, WINDOW_WIDTH - 320, 160)
        pygame.draw.rect(self.screen, COLOR_PANEL, panel_rect, border_radius=8)
        pygame.draw.rect(self.screen, COLOR_BORDER, panel_rect, 1, border_radius=8)

        lbl = self.font_bold.render("⚔️ Your Battlefield — Click creature to toggle Attack / Guard", True, COLOR_TEXT_MUTED)
        self.screen.blit(lbl, (35, 230))

        cx = 35
        for c in self.game.player_creatures:
            c_rect = pygame.Rect(cx, 252, 115, 120)
            is_ready = not c.summoningSickness
            bg_col = (28, 42, 36) if (c.attacking and is_ready) else (30, 34, 46)
            pygame.draw.rect(self.screen, bg_col, c_rect, border_radius=6)

            border_col = COLOR_ACCENT if (c.attacking and is_ready) else ((255, 180, 0) if c.summoningSickness else COLOR_BORDER)
            pygame.draw.rect(self.screen, border_col, c_rect, 2 if (c.attacking and is_ready) else 1, border_radius=6)

            # Name and Stack count
            name_text = c.name[:12] + (f" x{c.count}" if c.count > 1 else "")
            name_surf = self.font_bold.render(name_text, True, COLOR_TEXT_PRIMARY)
            self.screen.blit(name_surf, (cx + 8, 260))

            # P/T
            disp_pow = c.power + c.tempPower
            disp_tou = c.toughness + c.tempToughness
            stats_surf = self.font_pt.render(f"⚔️ {disp_pow} / 🛡️ {disp_tou}", True, COLOR_ACCENT)
            self.screen.blit(stats_surf, (cx + 8, 288))

            # Attacking status badge
            if c.summoningSickness:
                st_text = "💤 Sick (No Haste)"
                st_col = (255, 180, 0)
            elif c.attacking:
                st_text = "⚔️ Attacking"
                st_col = COLOR_ACCENT
            else:
                st_text = "🛡️ Guarding"
                st_col = COLOR_TEXT_MUTED

            st_surf = self.font_small.render(st_text, True, st_col)
            self.screen.blit(st_surf, (cx + 8, 318))

            cx += 128

    def render_lands_row(self):
        panel_rect = pygame.Rect(20, 394, WINDOW_WIDTH - 320, 80)
        pygame.draw.rect(self.screen, COLOR_PANEL, panel_rect, border_radius=8)
        pygame.draw.rect(self.screen, COLOR_BORDER, panel_rect, 1, border_radius=8)

        # Title & plays left
        plays_left = max(0, self.game.max_lands_per_turn - self.game.lands_played_this_turn)
        lbl = self.font_bold.render(f"🌲 Lands ({len(self.game.player_lands)}) — Plays left: {plays_left} | Click untapped land to tap manually", True, COLOR_TEXT_MUTED)
        self.screen.blit(lbl, (35, 400))

        # Floating mana badges
        mx = 35
        for col in ["G", "R", "B", "U", "W", "C", "ANY"]:
            val = getattr(self.game.mana_pool, col)
            if val > 0:
                pill_rect = pygame.Rect(mx, 422, 45, 20)
                pygame.draw.rect(self.screen, MANA_COLORS.get(col, (80, 80, 80)), pill_rect, border_radius=4)
                pill_text = self.font_small.render(f"{col}:{val}", True, (0, 0, 0))
                self.screen.blit(pill_text, (mx + 6, 425))
                mx += 52

        # Land slots
        lx = max(mx + 20, 180)
        for land in self.game.player_lands:
            col = MANA_COLORS.get(land.produces[0], (100, 100, 100)) if land.produces else (100, 100, 100)
            land_rect = pygame.Rect(lx, 424, 76, 36)
            bg_col = col if not land.tapped else (45, 48, 55)
            pygame.draw.rect(self.screen, bg_col, land_rect, border_radius=5)
            name_s = self.font_small.render(land.name[:8], True, (0, 0, 0) if not land.tapped else (120, 125, 135))
            self.screen.blit(name_s, (lx + 6, 434))
            if land.tapped:
                tap_s = self.font_small.render("Tapped", True, (160, 165, 175))
                self.screen.blit(tap_s, (lx + 6, 446))
            lx += 84

    def render_combat_panel(self):
        panel_rect = pygame.Rect(WINDOW_WIDTH - 280, 65, 260, 410)
        pygame.draw.rect(self.screen, COLOR_PANEL, panel_rect, border_radius=8)
        pygame.draw.rect(self.screen, COLOR_BORDER, panel_rect, 1, border_radius=8)

        # Projected combat math
        attackers = [
            {"uid": c.uid, "name": c.name, "power": c.power + c.tempPower, "toughness": c.toughness + c.tempToughness,
             "attacking": c.attacking and not c.summoningSickness, "summoningSick": c.summoningSickness,
             "keywords": c.keywords + c.tempKeywords, "count": c.count}
            for c in self.game.player_creatures
        ]
        proj = calculate_combat_projection(
            attackers_list=attackers,
            enemy_blockers=self.game.enemy_creatures,
            turn_burn_power=self.game.turn_burn_power,
            base_resonance=self.game.turn_resonance,
            burn_resistance=self.game.burn_resistance
        )

        title = self.font_title.render("⚔️ Projected Attack", True, COLOR_GOLD)
        self.screen.blit(title, (WINDOW_WIDTH - 265, 78))

        p_surf = self.font_body.render(f"Unblocked Power: {proj.unblocked_creature_power}", True, COLOR_TEXT_PRIMARY)
        self.screen.blit(p_surf, (WINDOW_WIDTH - 265, 110))

        b_surf = self.font_body.render(f"Effective Burn: +{proj.effective_burn}", True, COLOR_BURN)
        self.screen.blit(b_surf, (WINDOW_WIDTH - 265, 132))

        tot_p = self.font_body.render(f"Total Power: {proj.power}", True, COLOR_ACCENT)
        self.screen.blit(tot_p, (WINDOW_WIDTH - 265, 154))

        mult_s = self.font_body.render(f"Resonance: ×{proj.mult:.1f}", True, COLOR_BLUE)
        self.screen.blit(mult_s, (WINDOW_WIDTH - 265, 176))

        # Big damage banner
        dmg_bg = pygame.Rect(WINDOW_WIDTH - 265, 205, 230, 48)
        pygame.draw.rect(self.screen, (40, 35, 20), dmg_bg, border_radius=6)
        pygame.draw.rect(self.screen, COLOR_GOLD, dmg_bg, 2, border_radius=6)
        dmg_s = self.font_hero.render(f"{proj.total_damage} DAMAGE", True, COLOR_GOLD)
        self.screen.blit(dmg_s, (WINDOW_WIDTH - 250, 212))

        # Recent Combat Log snippets
        log_title = self.font_small.render("Combat Feed:", True, COLOR_TEXT_MUTED)
        self.screen.blit(log_title, (WINDOW_WIDTH - 265, 265))
        ly = 282
        for line in self.game.combat_log[-4:]:
            msg = line[:32] + "..." if len(line) > 34 else line
            log_s = self.font_small.render(msg, True, (180, 190, 210))
            self.screen.blit(log_s, (WINDOW_WIDTH - 265, ly))
            ly += 16

        # Mulligan button (turn 1 only)
        if self.game.can_mulligan:
            mull_btn = pygame.Rect(WINDOW_WIDTH - 265, 355, 230, 34)
            pygame.draw.rect(self.screen, (50, 45, 60), mull_btn, border_radius=6)
            pygame.draw.rect(self.screen, COLOR_PURPLE, mull_btn, 1, border_radius=6)
            mull_lbl = self.font_bold.render("🎲 Mulligan Hand [M]", True, COLOR_PURPLE)
            self.screen.blit(mull_lbl, (WINDOW_WIDTH - 230, 362))

        # Attack Button
        btn_rect = pygame.Rect(WINDOW_WIDTH - 265, 405, 230, 48)
        btn_col = COLOR_ACCENT if not self.game.run_over else (80, 80, 80)
        pygame.draw.rect(self.screen, btn_col, btn_rect, border_radius=6)
        btn_text = "Resolve Attack [Space]" if not self.game.run_over else "Run Ended"
        btn_lbl = self.font_bold.render(btn_text, True, (0, 0, 0))
        self.screen.blit(btn_lbl, (WINDOW_WIDTH - 245, 418))

    def render_hand(self):
        hand_count = len(self.game.hand)
        for idx in range(hand_count):
            if idx == self.dragged_card_idx:
                continue

            card = self.game.hand[idx]
            layout = calculate_fan_layout(idx, hand_count, container_width=WINDOW_WIDTH - 260, card_width=CARD_WIDTH)
            card_x = (WINDOW_WIDTH - 280) // 2 + layout.x - CARD_WIDTH // 2
            card_y = WINDOW_HEIGHT - 215 + layout.y

            is_hovered = (idx == self.hovered_card_idx)
            rot = 0.0 if is_hovered else layout.rot
            elevated_y = card_y - (30 if is_hovered else 0)

            # Check legal playability
            is_playable = can_play_card(
                card=card,
                mana_pool=self.game.mana_pool,
                player_lands=self.game.player_lands,
                lands_played_this_turn=self.game.lands_played_this_turn,
                max_lands_per_turn=self.game.max_lands_per_turn,
                player_life=self.game.player_life,
                combat_locked=self.game.combat_locked,
                run_over=self.game.run_over,
                has_lantern=self.game.has_any_color_lands()
            )

            self.draw_card(int(card_x), int(elevated_y), card, rotation=rot, is_hovered=is_hovered, is_playable=is_playable)

    def draw_card(self, x: int, y: int, card: Any, rotation: float = 0.0, is_hovered: bool = False, is_dragged: bool = False, is_playable: bool = False):
        surf = pygame.Surface((CARD_WIDTH, CARD_HEIGHT), pygame.SRCALPHA)

        # Base background by type
        bg_col = (28, 35, 52)
        if getattr(card, "type", "") == "Land":
            bg_col = (20, 42, 30)
        elif getattr(card, "type", "") in ("Spell", "Instant", "Sorcery"):
            bg_col = (42, 26, 45)

        pygame.draw.rect(surf, bg_col, (0, 0, CARD_WIDTH, CARD_HEIGHT), border_radius=8)

        # Border & glow
        if is_dragged:
            border_col = COLOR_ACCENT
            border_w = 3
        elif is_hovered:
            border_col = COLOR_GOLD
            border_w = 3
        elif is_playable:
            border_col = (75, 240, 153)  # Soft playable green border
            border_w = 2
        else:
            border_col = COLOR_BORDER
            border_w = 1

        pygame.draw.rect(surf, border_col, (0, 0, CARD_WIDTH, CARD_HEIGHT), border_w, border_radius=8)

        # Title
        name = getattr(card, "name", "Card")
        title_s = self.font_bold.render(name[:13], True, COLOR_TEXT_PRIMARY)
        surf.blit(title_s, (8, 10))

        # Mana cost
        cost = getattr(card, "manaCost", "")
        cost_s = self.font_small.render(cost, True, COLOR_GOLD)
        surf.blit(cost_s, (CARD_WIDTH - 42, 11))

        # Type Line
        c_type = getattr(card, "type", "Card")
        sub = getattr(card, "subtypes", [])
        type_str = f"{c_type}" + (f" - {sub[0]}" if sub else "")
        type_s = self.font_small.render(type_str[:18], True, COLOR_TEXT_MUTED)
        surf.blit(type_s, (8, 30))

        # Keywords tags
        kws = getattr(card, "keywords", [])
        if kws:
            kw_text = " • ".join(kws[:2])
            kw_s = self.font_small.render(kw_text, True, COLOR_BLUE)
            surf.blit(kw_s, (8, 48))

        # Rules snippet
        text = getattr(card, "text", "")
        lines = [text[i:i + 17] for i in range(0, min(len(text), 68), 17)]
        ry = 66
        for l in lines:
            r_s = self.font_small.render(l, True, (200, 205, 220))
            surf.blit(r_s, (8, ry))
            ry += 15

        # P/T box for creatures
        power = getattr(card, "power", None)
        toughness = getattr(card, "toughness", None)
        if power is not None and toughness is not None:
            pt_box = pygame.Rect(CARD_WIDTH - 48, CARD_HEIGHT - 28, 42, 22)
            pygame.draw.rect(surf, (15, 20, 30), pt_box, border_radius=4)
            pygame.draw.rect(surf, COLOR_BORDER, pt_box, 1, border_radius=4)
            pt_s = self.font_pt.render(f"{power}/{toughness}", True, COLOR_ACCENT)
            surf.blit(pt_s, (CARD_WIDTH - 44, CARD_HEIGHT - 26))

        # Playable badge
        if is_playable and not is_hovered:
            dot = pygame.Rect(CARD_WIDTH - 16, CARD_HEIGHT - 16, 8, 8)
            pygame.draw.circle(surf, COLOR_ACCENT, (CARD_WIDTH - 12, CARD_HEIGHT - 12), 4)

        if abs(rotation) > 0.1:
            rotated = pygame.transform.rotate(surf, -rotation)
            rect = rotated.get_rect(center=(x + CARD_WIDTH // 2, y + CARD_HEIGHT // 2))
            self.screen.blit(rotated, rect.topleft)
        else:
            self.screen.blit(surf, (x, y))

    def render_inspector_card(self):
        """Renders an enlarged preview card with full text and stats on the right HUD."""
        card = self.inspected_card
        if not card:
            return

        box = pygame.Rect(WINDOW_WIDTH - 280, 485, 260, 315)
        pygame.draw.rect(self.screen, COLOR_PANEL_ALT, box, border_radius=8)
        pygame.draw.rect(self.screen, COLOR_GOLD, box, 1, border_radius=8)

        # Name
        name = getattr(card, "name", "Card")
        name_s = self.font_title.render(name[:18], True, COLOR_GOLD)
        self.screen.blit(name_s, (WINDOW_WIDTH - 265, 495))

        # Mana Cost
        cost = getattr(card, "manaCost", "Free / Land")
        cost_s = self.font_body.render(f"Cost: {cost}", True, COLOR_TEXT_PRIMARY)
        self.screen.blit(cost_s, (WINDOW_WIDTH - 265, 524))

        # Type Line
        c_type = getattr(card, "type", "Card")
        type_s = self.font_small.render(f"Type: {c_type}", True, COLOR_TEXT_MUTED)
        self.screen.blit(type_s, (WINDOW_WIDTH - 265, 546))

        # Keywords
        kws = getattr(card, "keywords", [])
        if kws:
            kw_s = self.font_bold.render("Keywords: " + ", ".join(kws), True, COLOR_BLUE)
            self.screen.blit(kw_s, (WINDOW_WIDTH - 265, 568))

        # Full Rules Text
        text = getattr(card, "text", "") or getattr(card, "rules", "")
        # Word wrap rules
        words = text.split(" ")
        lines = []
        cur_line = ""
        for w in words:
            if len(cur_line + " " + w) > 28:
                lines.append(cur_line)
                cur_line = w
            else:
                cur_line = (cur_line + " " + w).strip()
        if cur_line:
            lines.append(cur_line)

        ty = 595
        for l in lines[:6]:
            t_s = self.font_small.render(l, True, COLOR_TEXT_PRIMARY)
            self.screen.blit(t_s, (WINDOW_WIDTH - 265, ty))
            ty += 16

        # P/T
        power = getattr(card, "power", None)
        toughness = getattr(card, "toughness", None)
        if power is not None and toughness is not None:
            pt_s = self.font_hero.render(f"P/T: {power}/{toughness}", True, COLOR_ACCENT)
            self.screen.blit(pt_s, (WINDOW_WIDTH - 265, 750))

    def render_fx(self):
        for fx in self.active_fx:
            surf = self.font_title.render(fx["text"], True, COLOR_GOLD)
            surf.set_alpha(int(fx["alpha"]))
            self.screen.blit(surf, (int(fx["x"]), int(fx["y"])))

    def render_draft_overlay(self):
        overlay = pygame.Surface((WINDOW_WIDTH, WINDOW_HEIGHT), pygame.SRCALPHA)
        overlay.fill((0, 0, 0, 200))
        self.screen.blit(overlay, (0, 0))

        # Banner
        banner_title = self.font_hero.render("🌟 VICTORY! CHOOSE A CARD REWARD 🌟", True, COLOR_GOLD)
        self.screen.blit(banner_title, (WINDOW_WIDTH // 2 - banner_title.get_width() // 2, WINDOW_HEIGHT // 2 - 180))

        sub_s = self.font_body.render("Click a card to add it to your deck and advance to the next encounter:", True, COLOR_TEXT_PRIMARY)
        self.screen.blit(sub_s, (WINDOW_WIDTH // 2 - sub_s.get_width() // 2, WINDOW_HEIGHT // 2 - 135))

        start_x = WINDOW_WIDTH // 2 - 240
        y = WINDOW_HEIGHT // 2 - 80
        for i, card in enumerate(self.game.draft_choices):
            rect = pygame.Rect(start_x + i * 170, y, 150, 210)
            pygame.draw.rect(self.screen, COLOR_PANEL, rect, border_radius=8)
            pygame.draw.rect(self.screen, COLOR_GOLD, rect, 2, border_radius=8)

            name_s = self.font_bold.render(card.name[:14], True, COLOR_TEXT_PRIMARY)
            self.screen.blit(name_s, (start_x + i * 170 + 10, y + 12))

            cost_s = self.font_small.render(card.manaCost, True, COLOR_GOLD)
            self.screen.blit(cost_s, (start_x + i * 170 + 10, y + 34))

            type_s = self.font_small.render(card.type, True, COLOR_TEXT_MUTED)
            self.screen.blit(type_s, (start_x + i * 170 + 10, y + 54))

            # Rules
            text = card.text[:60]
            words = text.split(" ")
            ly = y + 78
            cur = ""
            for w in words:
                if len(cur + " " + w) > 18:
                    s = self.font_small.render(cur, True, (210, 215, 230))
                    self.screen.blit(s, (start_x + i * 170 + 10, ly))
                    ly += 14
                    cur = w
                else:
                    cur = (cur + " " + w).strip()
            if cur:
                s = self.font_small.render(cur, True, (210, 215, 230))
                self.screen.blit(s, (start_x + i * 170 + 10, ly))

            if card.power is not None:
                pt_s = self.font_pt.render(f"{card.power}/{card.toughness}", True, COLOR_ACCENT)
                self.screen.blit(pt_s, (start_x + i * 170 + 10, y + 180))

            btn_box = pygame.Rect(start_x + i * 170 + 80, y + 176, 60, 24)
            pygame.draw.rect(self.screen, COLOR_GOLD, btn_box, border_radius=4)
            draft_s = self.font_small.render("DRAFT", True, (0, 0, 0))
            self.screen.blit(draft_s, (start_x + i * 170 + 92, y + 182))

    def render_game_over_overlay(self):
        overlay = pygame.Surface((WINDOW_WIDTH, WINDOW_HEIGHT), pygame.SRCALPHA)
        overlay.fill((0, 0, 0, 215))
        self.screen.blit(overlay, (0, 0))

        title_text = "🎉 CAMPAIGN CONQUERED! 🎉" if self.game.run_won else "💀 PLANESWALKER DEFEATED 💀"
        title_col = COLOR_GOLD if self.game.run_won else COLOR_BURN
        title_s = self.font_hero.render(title_text, True, title_col)
        self.screen.blit(title_s, (WINDOW_WIDTH // 2 - title_s.get_width() // 2, WINDOW_HEIGHT // 2 - 80))

        desc_text = "You cleared all encounters!" if self.game.run_won else f"Fell to {self.game.enemy_name} on Turn {self.game.turn}."
        desc_s = self.font_body.render(desc_text, True, COLOR_TEXT_PRIMARY)
        self.screen.blit(desc_s, (WINDOW_WIDTH // 2 - desc_s.get_width() // 2, WINDOW_HEIGHT // 2 - 30))

        # Restart button
        restart_btn = pygame.Rect(WINDOW_WIDTH // 2 - 100, WINDOW_HEIGHT // 2 + 40, 200, 48)
        pygame.draw.rect(self.screen, COLOR_ACCENT, restart_btn, border_radius=6)
        r_lbl = self.font_bold.render("Start New Run [R]", True, (0, 0, 0))
        self.screen.blit(r_lbl, (WINDOW_WIDTH // 2 - r_lbl.get_width() // 2, WINDOW_HEIGHT // 2 + 54))


def main():
    app = ManastormApp()
    app.run()


if __name__ == "__main__":
    main()
