// @ts-check

import { Component } from '../domain/components.js';
import { applyPalette, getGrayscaleTemplate, roundRect } from '../graphics/graphics.js';
import { levelBonus, getDynamicRoomDescription, getTimeOfDay } from '../rules/index.js';
import { getTickerText } from '../graphics/renderer.js';
import { inputManager } from '../engine/input.js';
import { UI_PALETTE, UI_STYLE } from '../infra/graphics-constants.js';
import { ENEMIES, roomHasFeature } from '../content/data.js';

/**
 * UIRenderSystem handles HUD, dialogue, menus, and overlays.
 */
export class UIRenderSystem {
    /**
     * @param {import('../domain/ecs.js').WorldStore} world
     * @param {object} vp - Viewport metrics
     * @param {any} worldData
     * @param {any} stores - { worldState }
     */
    constructor(world, vp, worldData, stores = {}) {
        this.world = world;
        this.VP = vp;
        this.worldData = worldData;
        this.worldState = stores.worldState || {};
        this.shardEnemies = stores.shardEnemies || null;
        this.getNPCsAt = stores.getNPCsAt || (() => []);
        this.heartSprite = null;
        this.emptyHeartSprite = null;
        this.menuHitRegions = [];
        this.dialogueHitRegions = [];
        this.hudHitRegions = [];
    }

    /**
     * @param {CanvasRenderingContext2D} ctx
     * @param {object} localPlayerStore
     */
    draw(ctx, localPlayerStore) {
        const topBarH = this.drawTopBar(ctx, localPlayerStore);
        this.drawTicker(ctx, topBarH);
        this.drawHUDBar(ctx, localPlayerStore);
        this.drawDialogue(ctx);
        this.drawMenu(ctx);
        this.drawOverlays(ctx);
    }

    getTopBarHeight() {
        return Math.max(56, Math.floor(this.VP.S * 1.35));
    }

    getTickerHeight() {
        return Math.max(18, Math.floor(this.VP.S * 0.38));
    }

    getHudHeight() {
        return Math.max(64, Math.floor(this.VP.S * 1.7));
    }

    drawHUDBar(ctx, player) {
        this.hudHitRegions = [];
        const HUD_H = this.getHudHeight();
        const barY = this.VP.CH - HUD_H;
        const PAD = 8;
        const loc = this.worldData?.[player.location];

        // Background strip
        ctx.fillStyle = 'rgba(8, 12, 8, 0.93)';
        ctx.fillRect(0, barY, this.VP.CW, HUD_H);
        ctx.fillStyle = 'rgba(199, 216, 171, 0.22)';
        ctx.fillRect(0, barY, this.VP.CW, 2);

        const btnH = Math.max(36, HUD_H - PAD * 2);
        const fs = Math.max(11, Math.floor(this.VP.S * 0.22));

        // Persistent buttons (right side): Bag, Quests, Menu
        const persistent = [
            { label: 'Bag', action: 'inventory' },
            { label: 'Quests', action: 'quests' },
            { label: '= Menu', action: 'menu' },
        ];
        const pBtnW = Math.max(52, Math.floor(this.VP.S * 1.35));
        let rx = this.VP.CW - PAD;
        for (let i = persistent.length - 1; i >= 0; i--) {
            const btn = persistent[i];
            rx -= pBtnW;
            this._drawHUDBtn(ctx, rx, barY + PAD, pBtnW, btnH, btn.label, false, fs);
            this.hudHitRegions.push({ x: rx, y: barY + PAD, w: pBtnW, h: btnH, action: btn.action });
            rx -= PAD;
        }

        // Contextual buttons (left side): up to 3
        const contextual = this._getContextualBtns(player, loc);
        const cBtnW = Math.max(60, Math.floor(this.VP.S * 1.6));
        let cx = PAD;
        for (const btn of contextual.slice(0, 3)) {
            this._drawHUDBtn(ctx, cx, barY + PAD, cBtnW, btnH, btn.label, btn.danger || false, fs);
            this.hudHitRegions.push({ x: cx, y: barY + PAD, w: cBtnW, h: btnH, action: btn.action, payload: btn.payload || null });
            cx += cBtnW + PAD;
        }
    }

    _getContextualBtns(player, loc) {
        if (!loc) return [];
        const btns = [];
        const sharedEnemy = this.shardEnemies?.get(player.location);
        const enemyDead = !!sharedEnemy && sharedEnemy.hp <= 0;
        const enemyAlive = !!loc.enemy && !enemyDead && ENEMIES[loc.enemy];
        const hasLoot = enemyDead && (sharedEnemy?.loot?.length ?? 0) > 0;
        const inCombat = !!player.currentEnemy;
        const npcs = this.getNPCsAt(player.location);
        const hasBank = roomHasFeature(player.location, 'bank');

        if (enemyAlive) {
            btns.push({ label: inCombat ? 'Strike' : 'Attack', action: 'attack', danger: inCombat });
            if (inCombat) btns.push({ label: 'Flee', action: 'flee' });
        }
        if (hasLoot) btns.push({ label: 'Pickup', action: 'pickup' });
        if (npcs.length > 0 && !inCombat) btns.push({ label: 'Talk', action: 'npc', payload: { npcId: npcs[0] } });
        if (hasBank && !inCombat) btns.push({ label: 'Bank', action: 'bank' });
        return btns;
    }

    _drawHUDBtn(ctx, x, y, w, h, label, danger, fs) {
        ctx.fillStyle = danger ? 'rgba(180, 40, 40, 0.35)' : 'rgba(56, 78, 48, 0.88)';
        roundRect(ctx, x, y, w, h, UI_STYLE.radius);
        ctx.fill();
        ctx.strokeStyle = danger ? '#ff6666' : UI_PALETTE.border;
        ctx.lineWidth = UI_STYLE.borderW;
        ctx.stroke();

        ctx.font = `bold ${fs}px monospace`;
        ctx.fillStyle = danger ? '#ffaaaa' : UI_PALETTE.textHi;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(label, x + w / 2, y + h / 2);
    }

    resolveHUDClick(x, y) {
        return this.hudHitRegions.find(r => x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h) || null;
    }

    drawTopBar(ctx, player) {
        const room = this.worldData?.[player.location];
        if (!room) return 0;

        const STRIP = this.getTopBarHeight();
        const PAD = Math.max(10, Math.floor(this.VP.S * 0.24));
        const statsPanelW = Math.min(Math.floor(this.VP.CW * 0.42), Math.max(180, Math.floor(this.VP.S * 5.1)));
        const leftMaxWidth = Math.max(80, this.VP.CW - statsPanelW - PAD * 3);
        
        // Background
        ctx.fillStyle = UI_PALETTE.overlay;
        ctx.fillRect(0, 0, this.VP.CW, STRIP);
        ctx.fillStyle = 'rgba(199, 216, 171, 0.15)';
        ctx.fillRect(0, STRIP - 2, this.VP.CW, 2);

        // --- LEFT SIDE: Room Info ---
        ctx.textAlign = 'left';
        ctx.textBaseline = 'top';
        
        // Room Name
        ctx.font = `bold ${Math.floor(this.VP.S * 0.38)}px monospace`;
        ctx.fillStyle = UI_PALETTE.textHi;
        ctx.fillText(this.fitText(ctx, room.name, leftMaxWidth), PAD, 8);

        // Room Description (dynamic)
        ctx.font = `${Math.floor(this.VP.S * 0.24)}px monospace`;
        ctx.fillStyle = UI_PALETTE.textLo;
        const fullDesc = getDynamicRoomDescription(room, this.worldState);
        ctx.fillText(this.fitText(ctx, fullDesc, leftMaxWidth), PAD, Math.floor(STRIP * 0.52));

        // --- RIGHT SIDE: Player Stats (Phase 8.76 P0c) ---
        if (!this.heartSprite) {
            const template = getGrayscaleTemplate('heart');
            if (template) {
                this.heartSprite = applyPalette(template, { primary: '#ff4444', secondary: '#aa1111', outline: '#000', accent: '#ffffff' });
                this.emptyHeartSprite = applyPalette(template, { primary: '#333', secondary: '#222', outline: '#000', accent: '#444' });
            }
        }

        const hp = player.hp ?? 10;
        const bonus = levelBonus(player.level ?? 1);
        const rested = !!player.statusEffects?.find(s => s.id === 'well_rested');
        const maxHp = (player.maxHp ?? 10) + (bonus.maxHp ?? 0) + (rested ? 5 : 0);
        const atk = (player.attack || 1) + bonus.attack;
        const def = (player.defense || 0) + bonus.defense;
        const gold = player.gold ?? 0;
        const hunts = player.forestFights ?? 0;
        const tod = getTimeOfDay();
        const weather = this.worldState?.weather || 'clear';
        const envIcon = tod === 'night' ? (weather === 'storm' ? '⛈' : weather === 'fog' ? '🌫' : '🌙') : (weather === 'storm' ? '⛈' : weather === 'fog' ? '🌫' : '☀');
        const envText = `${tod === 'night' ? 'Night' : 'Day'}${weather !== 'clear' ? ` · ${weather}` : ''}`;
        const panelX = this.VP.CW - statsPanelW - PAD;
        const panelY = PAD - 2;
        const panelH = STRIP - PAD * 2 + 2;
        const gap = Math.max(4, Math.floor(this.VP.S * 0.1));
        const cellW = Math.floor((statsPanelW - gap) / 2);
        const rowH = Math.floor((panelH - gap * 3) / 4);

        const actualPanelH = rowH * 4 + gap * 3;
        ctx.fillStyle = 'rgba(18, 24, 18, 0.9)';
        roundRect(ctx, panelX, panelY, statsPanelW, actualPanelH, UI_STYLE.radius);
        ctx.fill();
        ctx.strokeStyle = 'rgba(199, 216, 171, 0.24)';
        ctx.lineWidth = 1;
        ctx.stroke();

        this.drawStatCell(ctx, panelX, panelY, cellW, rowH, {
            icon: 'heart',
            text: `${hp}/${maxHp}`,
            color: '#ffaaaa'
        });
        this.drawStatCell(ctx, panelX + cellW + gap, panelY, cellW, rowH, {
            icon: '⚔',
            text: String(atk),
            color: '#ffcc00'
        });
        this.drawStatCell(ctx, panelX, panelY + rowH + gap, cellW, rowH, {
            icon: '🛡',
            text: String(def),
            color: '#66ccff'
        });
        this.drawStatCell(ctx, panelX + cellW + gap, panelY + rowH + gap, cellW, rowH, {
            icon: '◆',
            text: String(gold),
            color: UI_PALETTE.accent
        });
        this.drawStatCell(ctx, panelX, panelY + (rowH + gap) * 2, statsPanelW, rowH, {
            icon: '⚡',
            text: `${hunts} hunts`,
            color: UI_PALETTE.accent
        });
        this.drawStatCell(ctx, panelX, panelY + (rowH + gap) * 3, statsPanelW, rowH, {
            icon: envIcon,
            text: envText,
            color: tod === 'night' ? '#aac4ff' : '#ffe8a0'
        });

        return STRIP;
    }

    drawStatCell(ctx, x, y, w, h, { icon, text, color }) {
        const pad = Math.max(6, Math.floor(this.VP.S * 0.14));
        const iconSize = Math.max(14, Math.floor(this.VP.S * 0.34));
        const textSize = Math.max(12, Math.floor(this.VP.S * 0.28));

        ctx.fillStyle = 'rgba(56, 78, 48, 0.22)';
        roundRect(ctx, x, y, w, h, Math.max(4, Math.floor(UI_STYLE.radius * 0.6)));
        ctx.fill();

        const iconX = x + pad;
        const textX = x + pad + iconSize + 6;
        const textY = y + h / 2;

        if (icon === 'heart' && this.heartSprite) {
            ctx.drawImage(this.heartSprite, iconX, y + Math.floor((h - iconSize) / 2), iconSize, iconSize);
        } else {
            ctx.font = `bold ${iconSize}px monospace`;
            ctx.fillStyle = color;
            ctx.textAlign = 'left';
            ctx.textBaseline = 'middle';
            ctx.fillText(icon, iconX, textY);
        }

        ctx.font = `bold ${textSize}px monospace`;
        ctx.fillStyle = color;
        ctx.textAlign = 'left';
        ctx.textBaseline = 'middle';
        ctx.fillText(this.fitText(ctx, text, Math.max(20, w - (textX - x) - pad)), textX, textY);
    }

    drawTicker(ctx, yOffset = 0) {
        const text = getTickerText();
        if (!text) return;

        const barH = this.getTickerHeight();
        const barY = yOffset;
        
        ctx.fillStyle = 'rgba(8, 12, 8, 0.6)';
        ctx.fillRect(0, barY, this.VP.CW, barH);
        
        ctx.font = `italic ${Math.floor(this.VP.S * 0.28)}px monospace`;
        ctx.fillStyle = UI_PALETTE.textLo;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(text, this.VP.CW / 2, barY + barH / 2);
    }

    drawOverlays(ctx) {
        const now = Date.now();
        const overlays = this.world.query([Component.UIOverlay]);

        overlays.forEach(id => {
            const overlay = this.world.getComponent(id, Component.UIOverlay);
            if (now > overlay.expires) {
                this.world.removeComponent(id, Component.UIOverlay);
                return;
            }

            if (overlay.type === 'toast') this.drawToast(ctx, overlay.text, now, overlay.expires);
            else if (overlay.type === 'fanfare') this.drawFanfare(ctx, overlay.text, now, overlay.expires);
            else if (overlay.type === 'banner') this.drawBanner(ctx, overlay.text, now, overlay.expires);
        });
    }

    drawBanner(ctx, text, now, expires) {
        const alpha = Math.min(1, (expires - now) / 400);
        ctx.fillStyle = `rgba(18, 24, 18, ${0.85 * alpha})`;
        const bh = Math.floor(this.VP.S * 0.85);
        ctx.fillRect(0, 4, this.VP.CW, bh);
        ctx.fillStyle = `rgba(246, 237, 197, ${alpha})`;
        ctx.font = `bold ${Math.floor(this.VP.S * 0.45)}px monospace`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(text, this.VP.CW / 2, 4 + bh / 2);
    }

    drawToast(ctx, text, now, expires) {
        const alpha = Math.min(1, (expires - now) / 400);
        const fs = Math.floor(this.VP.S * 0.32);
        ctx.font = `${fs}px monospace`;
        const tw = ctx.measureText(text).width + 32;
        const th = fs + 16;
        const px = (this.VP.CW - tw) / 2;
        const py = Math.floor(this.VP.S * 1.2);

        ctx.globalAlpha = alpha;
        ctx.fillStyle = UI_PALETTE.bg;
        roundRect(ctx, px, py, tw, th, UI_STYLE.radius);
        ctx.fill();
        ctx.strokeStyle = UI_PALETTE.border;
        ctx.lineWidth = UI_STYLE.borderW;
        ctx.stroke();

        ctx.fillStyle = UI_PALETTE.textHi;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(text, this.VP.CW / 2, py + th / 2);
        ctx.globalAlpha = 1.0;
    }

    drawFanfare(ctx, text, now, expires) {
        const alpha = Math.min(1, (expires - now) / 300);
        ctx.fillStyle = `rgba(18, 24, 18, ${0.9 * alpha})`;
        const bh = Math.floor(this.VP.CH * 0.4);
        const by = (this.VP.CH - bh) / 2;
        ctx.fillRect(0, by, this.VP.CW, bh);
        
        ctx.strokeStyle = `rgba(199, 216, 171, ${alpha})`;
        ctx.lineWidth = 4;
        ctx.strokeRect(-10, by, this.VP.CW + 20, bh);

        ctx.fillStyle = `rgba(255, 221, 85, ${alpha})`;
        ctx.font = `bold ${Math.floor(this.VP.S * 0.65)}px monospace`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        const lines = text.split('\n');
        const lineH = Math.floor(this.VP.S * 0.7);
        const startY = this.VP.CH / 2 - (lines.length - 1) * lineH / 2;
        lines.forEach((l, i) => ctx.fillText(l, this.VP.CW / 2, startY + i * lineH));
    }

    drawDialogue(ctx) {
        const players = this.world.query([Component.Dialogue]);
        this.dialogueHitRegions = [];
        if (players.length === 0) return;
        const dialogue = this.world.getComponent(players[0], Component.Dialogue);
        const BOX_H = Math.floor(this.VP.CH * 0.35);
        const BOX_W = this.VP.CW - 32;
        const BOX_X = 16;
        const BOX_Y = this.VP.CH - BOX_H - this.getHudHeight() - 8;
        const PAD = UI_STYLE.pad * 1.5;

        ctx.fillStyle = UI_PALETTE.bg;
        roundRect(ctx, BOX_X, BOX_Y, BOX_W, BOX_H, UI_STYLE.radius);
        ctx.fill();
        ctx.strokeStyle = UI_PALETTE.border;
        ctx.lineWidth = UI_STYLE.borderW;
        ctx.stroke();
        ctx.fillStyle = 'rgba(255, 221, 85, 0.12)';
        roundRect(ctx, BOX_X + 6, BOX_Y + 6, BOX_W - 12, Math.max(22, Math.floor(this.VP.S * 0.55)), 5);
        ctx.fill();

        ctx.font = `bold ${Math.floor(this.VP.S * 0.38)}px monospace`;
        ctx.fillStyle = UI_PALETTE.accent;
        ctx.textAlign = 'left';
        ctx.textBaseline = 'top';
        ctx.fillText(dialogue.speakerId.toUpperCase(), BOX_X + PAD, BOX_Y + PAD * 0.6);

        ctx.font = `${Math.floor(this.VP.S * 0.32)}px monospace`;
        ctx.fillStyle = UI_PALETTE.text;
        const visibleChars = Math.floor(dialogue.progress);
        const text = dialogue.text.slice(0, visibleChars);
        const words = text.split(' ');
        let curLine = '', lines = [];
        for (const w of words) {
            if ((curLine + w).length > 32) { lines.push(curLine); curLine = w + ' '; }
            else { curLine += w + ' '; }
        }
        lines.push(curLine);
        const lineH = Math.floor(this.VP.S * 0.45);
        lines.forEach((line, i) => ctx.fillText(line, BOX_X + PAD, BOX_Y + PAD * 1.6 + i * lineH));

        if (visibleChars >= dialogue.text.length) {
            const alpha = 0.5 + Math.sin(Date.now() / 200) * 0.5;
            ctx.fillStyle = `rgba(255, 221, 85, ${alpha})`;
            ctx.textAlign = 'right';
            let diaHint = 'Space/Enter to close';
            if (inputManager.lastInputMode === 'gamepad') diaHint = '(A) to advance';
            else if (inputManager.lastInputMode === 'touch') diaHint = 'Tap to advance';
            ctx.font = `${Math.floor(this.VP.S * 0.28)}px monospace`;
            ctx.fillText(`${diaHint} ▼`, BOX_X + BOX_W - PAD, BOX_Y + BOX_H - PAD * 0.6);

            const btnW = Math.max(72, Math.floor(this.VP.S * 1.9));
            const btnH = Math.max(24, Math.floor(this.VP.S * 0.55));
            const btnX = BOX_X + BOX_W - PAD - btnW;
            const btnY = BOX_Y + BOX_H - PAD * 1.05 - btnH;
            ctx.fillStyle = 'rgba(18, 24, 18, 0.9)';
            roundRect(ctx, btnX, btnY, btnW, btnH, Math.floor(btnH / 2));
            ctx.fill();
            ctx.strokeStyle = UI_PALETTE.border;
            ctx.lineWidth = UI_STYLE.borderW;
            ctx.stroke();
            ctx.fillStyle = UI_PALETTE.textHi;
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.font = `bold ${Math.floor(this.VP.S * 0.24)}px monospace`;
            ctx.fillText('Close', btnX + btnW / 2, btnY + btnH / 2);
            this.dialogueHitRegions.push({ kind: 'close', x: btnX, y: btnY, w: btnW, h: btnH });
        }
    }

    drawMenu(ctx) {
        const players = this.world.query([Component.PlayerControlled, Component.Menu]);
        this.menuHitRegions = [];
        if (players.length === 0) return;
        const menu = this.world.getComponent(players[0], Component.Menu);

        const panel = this.getMenuLayout(menu);
        const titleSize = Math.max(20, Math.floor(this.VP.S * 0.45));
        const bodySize = Math.max(14, Math.floor(this.VP.S * 0.3));
        const detailSize = Math.max(12, Math.floor(this.VP.S * 0.24));

        // Full screen overlay
        ctx.fillStyle = 'rgba(8, 12, 8, 0.82)';
        ctx.fillRect(0, 0, this.VP.CW, this.VP.CH);

        // Panel Background
        ctx.fillStyle = UI_PALETTE.bg;
        roundRect(ctx, panel.x, panel.y, panel.w, panel.h, UI_STYLE.radius);
        ctx.fill();
        ctx.strokeStyle = UI_PALETTE.border;
        ctx.lineWidth = UI_STYLE.borderW;
        ctx.stroke();

        // Header Strip
        ctx.fillStyle = UI_PALETTE.bgLight;
        roundRect(ctx, panel.x, panel.y, panel.w, panel.headerH, UI_STYLE.radius);
        ctx.fill();
        // Flatten bottom of header strip
        ctx.fillRect(panel.x, panel.y + panel.headerH / 2, panel.w, panel.headerH / 2);

        ctx.font = `bold ${titleSize}px monospace`;
        ctx.fillStyle = UI_PALETTE.textHi;
        ctx.textAlign = 'left';
        ctx.textBaseline = 'middle';
        ctx.fillText(menu.title || menu.type.toUpperCase(), panel.x + panel.pad, panel.y + panel.headerH / 2);

        if (menu.message) {
            ctx.font = `${bodySize}px monospace`;
            ctx.fillStyle = UI_PALETTE.text;
            this.drawWrappedText(ctx, menu.message, panel.x + panel.pad, panel.y + panel.headerH + panel.pad, panel.w - panel.pad * 2, Math.max(18, Math.floor(bodySize * 1.35)));
        }

        menu.entries.forEach((entry, index) => {
            const row = panel.rows[index];
            if (!row) return;
            const selected = index === (menu.selectedIndex || 0);
            
            if (selected) {
                ctx.fillStyle = entry.disabled ? 'rgba(120, 120, 80, 0.4)' : UI_PALETTE.bgLight;
                roundRect(ctx, row.x, row.y, row.w, row.h, 4);
                ctx.fill();
                ctx.strokeStyle = entry.disabled ? UI_PALETTE.textLo : UI_PALETTE.accent;
                ctx.lineWidth = 2;
                ctx.stroke();
            } else {
                ctx.fillStyle = 'rgba(0,0,0,0.2)';
                roundRect(ctx, row.x, row.y, row.w, row.h, 4);
                ctx.fill();
            }

            ctx.font = `bold ${bodySize}px monospace`;
            ctx.fillStyle = entry.disabled ? UI_PALETTE.textLo : (selected ? UI_PALETTE.accent : UI_PALETTE.textHi);
            ctx.textAlign = 'left';
            ctx.textBaseline = 'top';
            ctx.fillText(entry.label || '...', row.x + panel.pad * 0.75, row.y + 8);

            if (entry.detail) {
                ctx.font = `${detailSize}px monospace`;
                ctx.fillStyle = entry.disabled ? 'rgba(150,150,150,0.5)' : (selected ? UI_PALETTE.textHi : UI_PALETTE.textLo);
                ctx.fillText(entry.detail, row.x + panel.pad * 0.75, row.y + 8 + bodySize + 4);
            }
            this.menuHitRegions.push({ index, ...row });
        });

        // Footer Hint
        ctx.font = `${detailSize}px monospace`;
        ctx.fillStyle = UI_PALETTE.textLo;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        
        let hint = '↑↓ / WASD to navigate  •  Enter/Space to confirm  •  Esc to back';
        if (inputManager.lastInputMode === 'gamepad') {
            hint = 'D-Pad / Stick to navigate  •  (A) to confirm  •  (B) to back';
        } else if (inputManager.lastInputMode === 'touch') {
            hint = 'Tap to choose  •  Swipe to move  •  Esc/Back to exit';
        }
        
        ctx.fillText(hint, panel.x + panel.w / 2, panel.y + panel.h - panel.pad * 0.85);
    }

    getMenuLayout(menu) {
        const pad = Math.max(14, Math.floor(this.VP.S * 0.32));
        const x = Math.floor(this.VP.CW * 0.08);
        const y = Math.floor(this.VP.CH * 0.08);
        const w = Math.floor(this.VP.CW * 0.84);
        const h = Math.floor(this.VP.CH * 0.84);
        const headerH = Math.max(48, Math.floor(this.VP.S * 0.95));
        const messageH = menu.message ? Math.max(52, Math.floor(this.VP.S * 1.8)) : 0;
        const footerH = Math.max(30, Math.floor(this.VP.S * 0.7));
        const rowsTop = y + headerH + messageH + pad * 0.4;
        const availableH = h - headerH - messageH - footerH - pad * 1.2;
        const rowGap = Math.max(4, Math.floor(this.VP.S * 0.09));
        const rowH = Math.max(28, Math.floor((availableH - rowGap * Math.max(0, menu.entries.length - 1)) / Math.max(1, menu.entries.length)));
        const rows = menu.entries.map((_, index) => ({
            x: x + pad,
            y: rowsTop + index * (rowH + rowGap),
            w: w - pad * 2,
            h: rowH,
        }));
        return { x, y, w, h, pad, headerH, rows };
    }

    drawWrappedText(ctx, text, x, y, maxWidth, lineHeight) {
        const words = String(text).split(/\s+/);
        let line = '';
        let drawY = y;
        words.forEach((word) => {
            const test = line ? `${line} ${word}` : word;
            if (ctx.measureText(test).width > maxWidth && line) {
                ctx.fillText(line, x, drawY);
                line = word;
                drawY += lineHeight;
            } else {
                line = test;
            }
        });
        if (line) ctx.fillText(line, x, drawY);
    }

    fitText(ctx, text, maxWidth) {
        const str = String(text || '');
        if (ctx.measureText(str).width <= maxWidth) return str;
        let out = str;
        while (out.length > 1 && ctx.measureText(`${out}...`).width > maxWidth) {
            out = out.slice(0, -1);
        }
        return `${out}...`;
    }

    resolveMenuClick(x, y) {
        const players = this.world.query([Component.PlayerControlled, Component.Menu]);
        if (players.length === 0 || !this.menuHitRegions.length) return -1;
        const hit = this.menuHitRegions.find((row) => x >= row.x && x <= row.x + row.w && y >= row.y && y <= row.y + row.h);
        return hit ? hit.index : -1;
    }

    resolveDialogueClick(x, y) {
        if (!this.dialogueHitRegions.length) return false;
        return this.dialogueHitRegions.some((row) => x >= row.x && x <= row.x + row.w && y >= row.y && y <= row.y + row.h);
    }
}
