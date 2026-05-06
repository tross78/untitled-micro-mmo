// @ts-check

import { Component } from '../domain/components.js';
import { applyPalette, getGrayscaleTemplate, roundRect } from '../graphics/graphics.js';
import { levelBonus } from '../rules/index.js';
import { getTickerText } from '../graphics/renderer.js';
import { inputManager } from '../engine/input.js';
import { UI_PALETTE, UI_STYLE } from '../infra/graphics-constants.js';

/**
 * UIRenderSystem handles HUD, dialogue, menus, and overlays.
 */
export class UIRenderSystem {
    /**
     * @param {import('../domain/ecs.js').WorldStore} world
     * @param {object} vp - Viewport metrics
     * @param {any} worldData
     */
    constructor(world, vp, worldData) {
        this.world = world;
        this.VP = vp;
        this.worldData = worldData;
        this.heartSprite = null;
        this.emptyHeartSprite = null;
        this.menuHitRegions = [];
    }

    /**
     * @param {CanvasRenderingContext2D} ctx
     * @param {object} localPlayerStore
     */
    draw(ctx, localPlayerStore) {
        this.drawEnvironmentBar(ctx, localPlayerStore);
        this.drawHUD(ctx, localPlayerStore);
        this.drawTicker(ctx);
        this.drawDialogue(ctx);
        this.drawMenu(ctx, localPlayerStore);
        this.drawOverlays(ctx);
    }

    drawEnvironmentBar(ctx, player) {
        const room = this.worldData?.[player.location];
        if (!room) return;

        const STRIP = Math.max(40, Math.floor(this.VP.S * 1.15));
        ctx.fillStyle = UI_PALETTE.overlay;
        ctx.fillRect(0, 0, this.VP.CW, STRIP);
        ctx.fillStyle = 'rgba(255, 221, 85, 0.12)';
        ctx.fillRect(0, 0, this.VP.CW, 3);
        
        ctx.font = `bold ${Math.floor(this.VP.S * 0.34)}px monospace`;
        ctx.fillStyle = UI_PALETTE.textHi;
        ctx.textAlign = 'left';
        ctx.textBaseline = 'top';
        ctx.fillText(room.name, 12, 8);

        ctx.font = `${Math.floor(this.VP.S * 0.22)}px monospace`;
        ctx.fillStyle = UI_PALETTE.textLo;
        const summary = room.description.length > 72 ? `${room.description.slice(0, 69)}...` : room.description;
        ctx.fillText(summary, 12, STRIP - 10);
    }

    drawHUD(ctx, player) {
        const STRIP = Math.floor(this.VP.S * 0.85);
        const y = this.VP.CH - STRIP;
        const PAD = UI_STYLE.pad;

        ctx.fillStyle = UI_PALETTE.overlay;
        ctx.fillRect(0, y, this.VP.CW, STRIP);
        ctx.fillStyle = 'rgba(199, 216, 171, 0.14)';
        ctx.fillRect(0, y, this.VP.CW, 2);

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
        const heartsCount = Math.ceil(maxHp / 10);
        const fullHearts = Math.floor(hp / 10);

        if (this.heartSprite && this.emptyHeartSprite) {
            for (let i = 0; i < heartsCount; i++) {
                const hx = PAD + i * 18;
                const hy = y + (STRIP - 14) / 2;
                const sprite = (i < fullHearts) ? this.heartSprite : this.emptyHeartSprite;
                ctx.drawImage(sprite, hx, hy, 14, 14);
            }
        }

        ctx.textBaseline = 'middle';
        const fs = Math.floor(STRIP * 0.4);
        ctx.font = `bold ${fs}px monospace`;

        ctx.fillStyle = UI_PALETTE.textLo;
        ctx.textAlign = 'center';
        ctx.fillText(`Gold`, this.VP.CW / 2, y + Math.floor(STRIP * 0.28));
        ctx.fillStyle = UI_PALETTE.accent;
        ctx.fillText(`◆ ${player.gold ?? 0}`, this.VP.CW / 2, y + Math.floor(STRIP * 0.68));

        const fights = player.forestFights ?? 0;
        ctx.fillStyle = UI_PALETTE.textLo;
        ctx.textAlign = 'right';
        ctx.fillText(`Hunts`, this.VP.CW - PAD, y + Math.floor(STRIP * 0.28));
        ctx.fillStyle = fights > 0 ? UI_PALETTE.success : UI_PALETTE.textLo;
        ctx.fillText(`⚡ ${fights}`, this.VP.CW - PAD, y + Math.floor(STRIP * 0.68));
    }

    drawTicker(ctx) {
        const text = getTickerText();
        if (!text) return;

        const barY = Math.floor(this.VP.S * 0.9);
        const barH = Math.max(22, Math.floor(this.VP.S * 0.5));
        ctx.fillStyle = UI_PALETTE.overlay;
        ctx.fillRect(0, barY, this.VP.CW, barH);
        ctx.font = `italic ${Math.floor(this.VP.S * 0.26)}px monospace`;
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
        if (players.length === 0) return;
        const dialogue = this.world.getComponent(players[0], Component.Dialogue);
        const BOX_H = Math.floor(this.VP.CH * 0.35);
        const BOX_W = this.VP.CW - 32;
        const BOX_X = 16;
        const BOX_Y = this.VP.CH - BOX_H - 48;
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
            let diaHint = 'Space/Enter to advance';
            if (inputManager.lastInputMode === 'gamepad') diaHint = '(A) to advance';
            else if (inputManager.lastInputMode === 'touch') diaHint = 'Tap to advance';
            ctx.font = `${Math.floor(this.VP.S * 0.28)}px monospace`;
            ctx.fillText(`${diaHint} ▼`, BOX_X + BOX_W - PAD, BOX_Y + BOX_H - PAD * 0.6);
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

    resolveMenuClick(x, y) {
        const players = this.world.query([Component.PlayerControlled, Component.Menu]);
        if (players.length === 0 || !this.menuHitRegions.length) return -1;
        const hit = this.menuHitRegions.find((row) => x >= row.x && x <= row.x + row.w && y >= row.y && y <= row.y + row.h);
        return hit ? hit.index : -1;
    }
}
