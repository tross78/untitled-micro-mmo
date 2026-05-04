// @ts-check

import { Component } from '../domain/components.js';
import { applyPalette, PALETTES, getGrayscaleTemplate } from '../graphics/graphics.js';
import { levelBonus } from '../rules/index.js';
import { getTickerText } from '../graphics/renderer.js';
import { inputManager } from '../engine/input.js';

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
        this.drawOverlays(ctx);
        this.drawDialogue(ctx);
        this.drawMenu(ctx, localPlayerStore);
    }

    drawEnvironmentBar(ctx, player) {
        const room = this.worldData?.[player.location];
        if (!room) return;

        const STRIP = 24;
        ctx.fillStyle = 'rgba(0,0,0,0.6)';
        ctx.fillRect(0, 0, this.VP.CW, STRIP);
        
        ctx.font = `italic ${Math.floor(this.VP.S * 0.25)}px monospace`;
        ctx.fillStyle = '#aaa';
        ctx.textAlign = 'left';
        ctx.textBaseline = 'middle';
        ctx.fillText(room.description, 10, STRIP / 2);
    }

    drawHUD(ctx, player) {
        const STRIP = Math.floor(this.VP.S * 0.7);
        const y = this.VP.CH - STRIP;
        const PAD = 8;

        ctx.fillStyle = 'rgba(0,0,0,0.75)';
        ctx.fillRect(0, y, this.VP.CW, STRIP);

        if (!this.heartSprite) {
            const template = getGrayscaleTemplate('heart');
            if (template) {
                this.heartSprite = applyPalette(template, PALETTES.self);
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
                const hx = PAD + i * 20;
                const hy = y + (STRIP - 16) / 2;
                const sprite = (i < fullHearts) ? this.heartSprite : this.emptyHeartSprite;
                ctx.drawImage(sprite, hx, hy, 16, 16);
            }
        }

        ctx.textBaseline = 'middle';
        const mid = y + STRIP / 2;
        const fs = Math.floor(STRIP * 0.45);
        ctx.font = `bold ${fs}px monospace`;

        ctx.fillStyle = '#ffd700';
        ctx.textAlign = 'center';
        ctx.fillText(`◆ ${player.gold ?? 0}`, this.VP.CW / 2, mid);

        const fights = player.forestFights ?? 0;
        ctx.fillStyle = fights > 0 ? '#aaffaa' : '#555';
        ctx.textAlign = 'right';
        ctx.fillText(`⚡ ${fights}`, this.VP.CW - PAD, mid);
    }

    drawTicker(ctx) {
        const text = getTickerText();
        if (!text) return;

        const barY = Math.floor(this.VP.S * 0.7);
        const barH = Math.max(20, Math.floor(this.VP.S * 0.45));
        ctx.fillStyle = 'rgba(0,0,0,0.45)';
        ctx.fillRect(0, barY, this.VP.CW, barH);
        ctx.font = `italic ${Math.floor(this.VP.S * 0.24)}px monospace`;
        ctx.fillStyle = '#9ab0c2';
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
        ctx.fillStyle = `rgba(0,0,0,${0.7 * alpha})`;
        const bh = Math.floor(this.VP.S * 0.7);
        ctx.fillRect(0, 2, this.VP.CW, bh);
        ctx.fillStyle = `rgba(255,255,200,${alpha})`;
        ctx.font = `bold ${Math.floor(this.VP.S * 0.4)}px monospace`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(text, this.VP.CW / 2, 2 + bh / 2);
    }

    drawToast(ctx, text, now, expires) {
        const alpha = Math.min(1, (expires - now) / 400);
        const fs = Math.floor(this.VP.S * 0.28);
        ctx.font = `${fs}px monospace`;
        const tw = ctx.measureText(text).width + 24;
        const px = (this.VP.CW - tw) / 2;
        const py = Math.floor(this.VP.S * 0.8);
        ctx.fillStyle = `rgba(20,20,40,${0.85 * alpha})`;
        ctx.fillRect(px, py, tw, fs + 10);
        ctx.fillStyle = `rgba(200,230,255,${alpha})`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(text, this.VP.CW / 2, py + (fs + 10) / 2);
    }

    drawFanfare(ctx, text, now, expires) {
        const alpha = Math.min(1, (expires - now) / 300);
        ctx.fillStyle = `rgba(0,0,0,${0.75 * alpha})`;
        const bh = Math.floor(this.VP.CH * 0.35);
        const by = (this.VP.CH - bh) / 2;
        ctx.fillRect(0, by, this.VP.CW, bh);
        ctx.fillStyle = `rgba(255,230,100,${alpha})`;
        ctx.font = `bold ${Math.floor(this.VP.S * 0.55)}px monospace`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        const lines = text.split('\n');
        const lineH = Math.floor(this.VP.S * 0.6);
        const startY = this.VP.CH / 2 - (lines.length - 1) * lineH / 2;
        lines.forEach((l, i) => ctx.fillText(l, this.VP.CW / 2, startY + i * lineH));
    }

    drawDialogue(ctx) {
        const players = this.world.query([Component.Dialogue]);
        if (players.length === 0) return;
        const dialogue = this.world.getComponent(players[0], Component.Dialogue);
        const BOX_H = Math.floor(this.VP.CH * 0.35);
        const BOX_Y = this.VP.CH - BOX_H - 40;
        const PAD = Math.floor(this.VP.S * 0.5);
        ctx.fillStyle = 'rgba(10,10,30,0.95)';
        ctx.fillRect(10, BOX_Y, this.VP.CW - 20, BOX_H);
        ctx.strokeStyle = '#8866cc';
        ctx.lineWidth = 2;
        ctx.strokeRect(12, BOX_Y + 2, this.VP.CW - 24, BOX_H - 4);
        ctx.font = `bold ${Math.floor(this.VP.S * 0.35)}px monospace`;
        ctx.fillStyle = '#ffdd55';
        ctx.textAlign = 'left';
        ctx.textBaseline = 'top';
        ctx.fillText(dialogue.speakerId.toUpperCase(), 10 + PAD, BOX_Y + PAD * 0.5);
        ctx.font = `${Math.floor(this.VP.S * 0.3)}px monospace`;
        ctx.fillStyle = '#ddeeff';
        const visibleChars = Math.floor(dialogue.progress);
        const text = dialogue.text.slice(0, visibleChars);
        const words = text.split(' ');
        let curLine = '', lines = [];
        for (const w of words) {
            if ((curLine + w).length > 35) { lines.push(curLine); curLine = w + ' '; }
            else { curLine += w + ' '; }
        }
        lines.push(curLine);
        const lineH = Math.floor(this.VP.S * 0.4);
        lines.forEach((line, i) => ctx.fillText(line, 10 + PAD, BOX_Y + PAD * 1.5 + i * lineH));
        if (visibleChars >= dialogue.text.length) {
            const alpha = 0.5 + Math.sin(Date.now() / 200) * 0.5;
            ctx.fillStyle = `rgba(204, 136, 255, ${alpha})`;
            ctx.textAlign = 'right';
            
            let diaHint = 'Space/Enter to advance';
            if (inputManager.lastInputMode === 'gamepad') diaHint = '(A) to advance';
            else if (inputManager.lastInputMode === 'touch') diaHint = 'Tap to advance';
            
            ctx.font = `${Math.floor(this.VP.S * 0.25)}px monospace`;
            ctx.fillText(`${diaHint} ▼`, this.VP.CW - 10 - PAD, BOX_Y + BOX_H - PAD * 0.5);
        }
    }

    drawMenu(ctx) {
        const players = this.world.query([Component.PlayerControlled, Component.Menu]);
        this.menuHitRegions = [];
        if (players.length === 0) return;
        const menu = this.world.getComponent(players[0], Component.Menu);

        const panel = this.getMenuLayout(menu);
        const titleSize = Math.max(20, Math.floor(this.VP.S * 0.42));
        const bodySize = Math.max(14, Math.floor(this.VP.S * 0.28));
        const detailSize = Math.max(12, Math.floor(this.VP.S * 0.22));

        ctx.fillStyle = 'rgba(7, 12, 10, 0.88)';
        ctx.fillRect(0, 0, this.VP.CW, this.VP.CH);

        ctx.fillStyle = 'rgba(27, 38, 24, 0.96)';
        ctx.fillRect(panel.x, panel.y, panel.w, panel.h);
        ctx.strokeStyle = '#c8d8b0';
        ctx.lineWidth = 3;
        ctx.strokeRect(panel.x + 1, panel.y + 1, panel.w - 2, panel.h - 2);

        ctx.fillStyle = 'rgba(56, 78, 48, 0.9)';
        ctx.fillRect(panel.x, panel.y, panel.w, panel.headerH);

        ctx.font = `bold ${titleSize}px monospace`;
        ctx.fillStyle = '#f6edc5';
        ctx.textAlign = 'left';
        ctx.textBaseline = 'middle';
        ctx.fillText(menu.title || menu.type.toUpperCase(), panel.x + panel.pad, panel.y + panel.headerH / 2);

        if (menu.message) {
            ctx.font = `${bodySize}px monospace`;
            ctx.fillStyle = '#d7e2c7';
            this.drawWrappedText(ctx, menu.message, panel.x + panel.pad, panel.y + panel.headerH + panel.pad * 0.85, panel.w - panel.pad * 2, Math.max(18, Math.floor(bodySize * 1.35)));
        }

        menu.entries.forEach((entry, index) => {
            const row = panel.rows[index];
            if (!row) return;
            const selected = index === (menu.selectedIndex || 0);
            if (selected) {
                ctx.fillStyle = entry.disabled ? 'rgba(98, 88, 54, 0.6)' : 'rgba(142, 172, 95, 0.78)';
                ctx.fillRect(row.x, row.y, row.w, row.h);
                ctx.strokeStyle = entry.disabled ? '#7a7044' : '#f6edc5';
                ctx.lineWidth = 2;
                ctx.strokeRect(row.x + 1, row.y + 1, row.w - 2, row.h - 2);
            } else {
                ctx.fillStyle = entry.disabled ? 'rgba(33, 42, 32, 0.9)' : 'rgba(18, 24, 20, 0.88)';
                ctx.fillRect(row.x, row.y, row.w, row.h);
            }

            ctx.font = `${bodySize}px monospace`;
            ctx.fillStyle = entry.disabled ? '#86917d' : (selected ? '#1c1e14' : '#edf3dc');
            ctx.textAlign = 'left';
            ctx.textBaseline = 'top';
            ctx.fillText(entry.label || '...', row.x + panel.pad * 0.75, row.y + 8);

            if (entry.detail) {
                ctx.font = `${detailSize}px monospace`;
                ctx.fillStyle = entry.disabled ? '#687060' : (selected ? '#344126' : '#adc39d');
                ctx.fillText(entry.detail, row.x + panel.pad * 0.75, row.y + 8 + bodySize + 4);
            }
            this.menuHitRegions.push({ index, ...row });
        });

        ctx.font = `${detailSize}px monospace`;
        ctx.fillStyle = '#b6c39d';
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
        const rowGap = Math.max(6, Math.floor(this.VP.S * 0.12));
        const rowH = Math.max(44, Math.floor((availableH - rowGap * Math.max(0, menu.entries.length - 1)) / Math.max(1, menu.entries.length)));
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
