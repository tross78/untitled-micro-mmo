// @ts-check

import { Component } from '../domain/components.js';
import { applyPalette, PALETTES, getGrayscaleTemplate } from '../graphics/graphics.js';

/**
 * UIRenderSystem handles HUD, dialogue, and overlays (toasts, fanfare).
 */
export class UIRenderSystem {
    /**
     * @param {import('../domain/ecs.js').WorldStore} world
     * @param {object} vp - Viewport metrics
     */
    constructor(world, vp) {
        this.world = world;
        this.VP = vp;
        this.heartSprite = null;
        this.emptyHeartSprite = null;
    }

    /**
     * @param {CanvasRenderingContext2D} ctx
     * @param {object} localPlayerStore
     */
    draw(ctx, localPlayerStore) {
        this.drawHUD(ctx, localPlayerStore);
        this.drawOverlays(ctx);
        this.drawDialogue(ctx);
    }

    drawHUD(ctx, player) {
        const STRIP = Math.floor(this.VP.S * 0.7);
        const y = this.VP.CH - STRIP;
        const PAD = 8;

        // semi-transparent strip
        ctx.fillStyle = 'rgba(0,0,0,0.75)';
        ctx.fillRect(0, y, this.VP.CW, STRIP);

        // 1. HP (Hearts)
        if (!this.heartSprite) {
            const template = getGrayscaleTemplate('heart');
            if (template) {
                this.heartSprite = applyPalette(template, PALETTES.self);
                this.emptyHeartSprite = applyPalette(template, { primary: '#333', secondary: '#222', outline: '#000', accent: '#444' });
            }
        }

        const hp = player.hp ?? 10;
        const maxHp = player.maxHp ?? 10;
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

        // 2. Gold (Rupee)
        ctx.fillStyle = '#ffd700';
        ctx.textAlign = 'center';
        ctx.fillText(`◆ ${player.gold ?? 0}`, this.VP.CW / 2, mid);

        // 3. Fights (Energy)
        const fights = player.forestFights ?? 0;
        ctx.fillStyle = fights > 0 ? '#aaffaa' : '#555';
        ctx.textAlign = 'right';
        ctx.fillText(`⚡ ${fights}`, this.VP.CW - PAD, mid);
    }

    drawOverlays(ctx) {
        const now = Date.now();
        const overlays = this.world.query([Component.UIOverlay]);

        overlays.forEach(id => {
            const overlay = this.world.getComponent(id, Component.UIOverlay);
            if (now > overlay.expires) {
                this.world.components.get(Component.UIOverlay).delete(id);
                return;
            }

            if (overlay.type === 'toast') {
                this.drawToast(ctx, overlay.text, now, overlay.expires);
            } else if (overlay.type === 'fanfare') {
                this.drawFanfare(ctx, overlay.text, now, overlay.expires);
            } else if (overlay.type === 'banner') {
                this.drawBanner(ctx, overlay.text, now, overlay.expires);
            }
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
        const BOX_Y = this.VP.CH - BOX_H - 40; // Offset from HUD
        const PAD = Math.floor(this.VP.S * 0.5);

        // Dark panel
        ctx.fillStyle = 'rgba(10,10,30,0.95)';
        ctx.fillRect(10, BOX_Y, this.VP.CW - 20, BOX_H);
        ctx.strokeStyle = '#8866cc';
        ctx.lineWidth = 2;
        ctx.strokeRect(12, BOX_Y + 2, this.VP.CW - 24, BOX_H - 4);

        // Speaker Name
        ctx.font = `bold ${Math.floor(this.VP.S * 0.35)}px monospace`;
        ctx.fillStyle = '#ffdd55';
        ctx.textAlign = 'left';
        ctx.textBaseline = 'top';
        ctx.fillText(dialogue.speakerId.toUpperCase(), 10 + PAD, BOX_Y + PAD * 0.5);

        // Wrapped Text
        ctx.font = `${Math.floor(this.VP.S * 0.3)}px monospace`;
        ctx.fillStyle = '#ddeeff';
        const visibleChars = Math.floor(dialogue.progress);
        const text = dialogue.text.slice(0, visibleChars);
        
        // Wrapped block
        const words = text.split(' ');
        let curLine = '';
        let lines = [];
        for (const w of words) {
            if ((curLine + w).length > 35) {
                lines.push(curLine);
                curLine = w + ' ';
            } else {
                curLine += w + ' ';
            }
        }
        lines.push(curLine);
        
        const lineH = Math.floor(this.VP.S * 0.4);
        lines.forEach((line, i) => {
            ctx.fillText(line, 10 + PAD, BOX_Y + PAD * 1.5 + i * lineH);
        });
        
        // Pulse advance prompt if text finished
        if (visibleChars >= dialogue.text.length) {
            const alpha = 0.5 + Math.sin(Date.now() / 200) * 0.5;
            ctx.fillStyle = `rgba(204, 136, 255, ${alpha})`;
            ctx.textAlign = 'right';
            ctx.fillText('▼', this.VP.CW - 10 - PAD, BOX_Y + BOX_H - PAD * 0.5);
        }
    }
}
