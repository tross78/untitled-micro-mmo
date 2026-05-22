// @ts-check

import { Component } from '../domain/components.js';
import { applyPalette, getGrayscaleTemplate, PALETTES, roundRect } from '../graphics/graphics.js';
import { levelBonus, getDynamicRoomDescription, getTimeOfDay } from '../rules/index.js';
import { getTickerText } from '../graphics/renderer.js';
import { inputManager } from '../engine/input.js';
import { UI_PALETTE, UI_STYLE } from '../infra/graphics-constants.js';
import { ENEMIES, roomHasFeature } from '../content/data.js';
import { NPCS } from '../content/data/npcs.js';
import { pendingDuel } from '../state/store.js';

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
        this.players = stores.players || null;
        this.heartSprite = null;
        this.emptyHeartSprite = null;
        this.portraitCache = new Map();
        this.menuHitRegions = [];
        this.dialogueHitRegions = [];
        this.hudHitRegions = [];
        // Cache for _getContextualBtns — recomputed only when location/combat state changes
        this._ctxBtnCache = null;
        this._ctxBtnKey = '';
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

        // Contextual buttons (left side): up to 3, constrained to not overlap persistent buttons
        const contextual = this._getContextualBtns(player, loc);
        const persistentW = persistent.length * (pBtnW + PAD);
        const availableW = this.VP.CW - persistentW - PAD * 2;
        const maxContextual = contextual.slice(0, 3);
        const cBtnW = maxContextual.length > 0
            ? Math.min(Math.max(60, Math.floor(this.VP.S * 1.6)), Math.floor((availableW - PAD * (maxContextual.length - 1)) / maxContextual.length))
            : Math.max(60, Math.floor(this.VP.S * 1.6));
        let cx = PAD;
        for (const btn of maxContextual) {
            this._drawHUDBtn(ctx, cx, barY + PAD, cBtnW, btnH, btn.label, btn.danger || false, fs);
            this.hudHitRegions.push({ x: cx, y: barY + PAD, w: cBtnW, h: btnH, action: btn.action, payload: btn.payload || null });
            cx += cBtnW + PAD;
        }
    }

    _getContextualBtns(player, loc) {
        if (!loc) return [];

        const sharedEnemy = this.shardEnemies?.get(player.location);
        const enemyHp = sharedEnemy?.hp ?? -1;
        const lootLen = sharedEnemy?.loot?.length ?? 0;
        const duelKey = pendingDuel ? pendingDuel.expiresAt : 0;

        // Cheap fingerprint — skip the 5 world queries when nothing has changed.
        // Include tile position so adjacency-gated buttons (Duel, Talk) recompute on move.
        const key = `${player.location}|${player.x}|${player.y}|${player.currentEnemy}|${enemyHp}|${lootLen}|${duelKey}`;
        if (key === this._ctxBtnKey && this._ctxBtnCache) return this._ctxBtnCache;

        // Pending duel challenge is inserted first so it always appears in the
        // first 3 contextual slots. (Appending it after Attack/Flee/Pickup caused
        // it to exceed the 3-button limit and be clipped on mobile.)
        const btns = [];
        if (pendingDuel && Date.now() <= pendingDuel.expiresAt) {
            btns.push({ label: 'Accept Duel', action: 'duel_accept' });
            btns.push({ label: 'Decline Duel', action: 'duel_decline' });
        }
        const enemyDead = !!sharedEnemy && enemyHp <= 0;
        const enemyAlive = !!loc.enemy && !enemyDead && ENEMIES[loc.enemy];
        const hasLoot = enemyDead && lootLen > 0;
        const inCombat = !!player.currentEnemy;
        const npcs = this.getNPCsAt(player.location);
        const hasBank = roomHasFeature(player.location, 'bank');

        // Get player tile position for range checks
        const playerEntities = this.world.query([Component.PlayerControlled, Component.Transform]);
        const playerTransform = playerEntities.length > 0
            ? this.world.getComponent(playerEntities[0], Component.Transform)
            : null;

        const isAdjacentTo = (eid) => {
            if (!playerTransform) return false;
            const t = this.world.getComponent(eid, Component.Transform);
            if (!t || t.mapId !== player.location) return false;
            return Math.max(Math.abs(t.x - playerTransform.x), Math.abs(t.y - playerTransform.y)) <= 1;
        };

        // Query [Transform, Sprite] once and partition by palette — was queried 3× before
        const spriteEntities = this.world.query([Component.Transform, Component.Sprite]);
        const enemyEntities = [];
        const npcEntityIds = [];
        const peerEntityIds = [];
        for (const eid of spriteEntities) {
            const sp = this.world.getComponent(eid, Component.Sprite);
            if (sp?.palette === 'enemy') enemyEntities.push(eid);
            else if (sp?.palette === 'peer' && !sp.ghost) peerEntityIds.push(eid);
            else npcEntityIds.push(eid);
        }

        const enemyInRange = inCombat || (enemyAlive && enemyEntities.some(isAdjacentTo));

        if (enemyAlive && enemyInRange) {
            btns.push({ label: inCombat ? 'Strike' : 'Attack', action: 'attack', danger: inCombat });
            if (inCombat) btns.push({ label: 'Flee', action: 'flee' });
        }
        if (hasLoot) btns.push({ label: 'Pickup', action: 'pickup' });

        // Resource/forage node at player's feet
        if (!inCombat && playerTransform) {
            const gatherables = this.world.query([Component.Gatherable, Component.Transform]);
            const hasGatherableAtFeet = gatherables.some(id => {
                const t = this.world.getComponent(id, Component.Transform);
                return t && t.x === playerTransform.x && t.y === playerTransform.y && t.mapId === player.location;
            });
            if (hasGatherableAtFeet) btns.push({ label: 'Gather', action: 'pickup' });
        }

        // NPC range check — only show Talk when adjacent to that NPC's entity
        const nearbyNpc = npcs.find(_npcId =>
            npcEntityIds.some(eid => isAdjacentTo(eid))
        );
        if (nearbyNpc && !inCombat) btns.push({ label: 'Talk', action: 'npc', payload: { npcId: nearbyNpc } });

        if (hasBank && !inCombat) btns.push({ label: 'Bank', action: 'bank' });

        // Duel — show when a peer entity is adjacent and not in combat
        if (!inCombat && this.players) {
            const nearbyPeer = peerEntityIds.find(isAdjacentTo);
            if (nearbyPeer) {
                const sp = this.world.getComponent(nearbyPeer, Component.Sprite);
                const hashId = (str) => { let h = 0; for (let i = 0; i < str.length; i++) h = (Math.imul(h ^ str.charCodeAt(i), 0x9e3779b9) >>> 0); return h; };
                const peerEntry = sp?.seed != null ? [...this.players.entries()].find(([id]) => hashId(id) === sp.seed) : null;
                const peerId = peerEntry?.[0];
                if (peerId) btns.push({ label: 'Duel', action: 'duel', payload: { peerId } });
            }
        }

        this._ctxBtnKey = key;
        this._ctxBtnCache = btns;
        return btns;
    }

    _drawHUDBtn(ctx, x, y, w, h, label, danger, fs) {
        // Outer border — stroke immediately after fill so it targets the correct path
        ctx.fillStyle = danger ? 'rgba(180, 40, 40, 0.35)' : 'rgba(56, 78, 48, 0.88)';
        roundRect(ctx, x, y, w, h, UI_STYLE.radius);
        ctx.fill();
        ctx.strokeStyle = danger ? '#ff6666' : UI_PALETTE.border;
        ctx.lineWidth = UI_STYLE.borderW;
        ctx.stroke();

        // Inner highlights (fills only — no stroke so they don't leave stray paths)
        ctx.fillStyle = danger ? 'rgba(255, 160, 160, 0.18)' : 'rgba(255, 248, 220, 0.12)';
        roundRect(ctx, x + 2, y + 2, w - 4, Math.max(6, Math.floor(h * 0.28)), Math.max(4, UI_STYLE.radius - 2));
        ctx.fill();
        ctx.fillStyle = danger ? 'rgba(120, 20, 20, 0.35)' : 'rgba(12, 18, 10, 0.3)';
        roundRect(ctx, x + 2, y + h - Math.max(7, Math.floor(h * 0.22)), w - 4, Math.max(5, Math.floor(h * 0.18)), Math.max(4, UI_STYLE.radius - 2));
        ctx.fill();
        if (danger) {
            ctx.fillStyle = 'rgba(255, 120, 120, 0.28)';
            roundRect(ctx, x + 2, y + 2, Math.max(6, Math.floor(w * 0.08)), h - 4, Math.max(4, UI_STYLE.radius - 2));
            ctx.fill();
        }

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
        ctx.fillStyle = 'rgba(255, 248, 220, 0.08)';
        roundRect(ctx, x + 2, y + 2, w - 4, Math.max(5, Math.floor(h * 0.32)), Math.max(3, Math.floor(UI_STYLE.radius * 0.45)));
        ctx.fill();
        ctx.fillStyle = 'rgba(10, 14, 10, 0.22)';
        roundRect(ctx, x + 2, y + h - Math.max(6, Math.floor(h * 0.2)), w - 4, Math.max(4, Math.floor(h * 0.16)), Math.max(3, Math.floor(UI_STYLE.radius * 0.45)));
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
        ctx.save();
        ctx.beginPath();
        ctx.rect(0, barY, this.VP.CW, barH);
        ctx.clip();
        ctx.fillText(this.fitText(ctx, text, this.VP.CW - 16), this.VP.CW / 2, barY + barH / 2);
        ctx.restore();
    }

    drawOverlays(ctx) {
        const now = Date.now();
        const overlays = this.world.query([Component.UIOverlay]);

        for (const id of overlays) {
            const overlay = this.world.getComponent(id, Component.UIOverlay);
            if (!overlay) continue;
            if (Date.now() > overlay.expires) {
                this.world.removeComponent(id, Component.UIOverlay);
                this.world.deleteEntity(id);
                continue;
            }

            if (overlay.type === 'toast') this.drawToast(ctx, overlay.text, now, overlay.expires);
            else if (overlay.type === 'fanfare') this.drawFanfare(ctx, overlay.text, now, overlay.expires);
            else if (overlay.type === 'banner') this.drawBanner(ctx, overlay.text, now, overlay.expires);
        }
    }

    drawBanner(ctx, text, now, expires) {
        const alpha = Math.min(1, (expires - now) / 400);
        ctx.fillStyle = `rgba(18, 24, 18, ${0.88 * alpha})`;
        const bh = Math.floor(this.VP.S * 1.0);
        ctx.fillRect(0, 4, this.VP.CW, bh);
        ctx.fillStyle = `rgba(255, 248, 220, ${0.1 * alpha})`;
        ctx.fillRect(6, 8, this.VP.CW - 12, Math.max(4, Math.floor(bh * 0.24)));
        ctx.fillStyle = `rgba(10, 12, 10, ${0.22 * alpha})`;
        ctx.fillRect(0, 4 + bh - 5, this.VP.CW, 5);
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
        const maxW = this.VP.CW - 32;
        const displayText = this.fitText(ctx, text, maxW - 32);
        const tw = Math.min(ctx.measureText(displayText).width + 32, maxW);
        const th = fs + 16;
        const px = Math.max(8, (this.VP.CW - tw) / 2);
        const py = Math.floor(this.VP.S * 1.2);

        ctx.globalAlpha = alpha;
        ctx.fillStyle = UI_PALETTE.bg;
        roundRect(ctx, px, py, tw, th, UI_STYLE.radius);
        ctx.fill();
        ctx.strokeStyle = UI_PALETTE.border;
        ctx.lineWidth = UI_STYLE.borderW;
        ctx.stroke();
        ctx.fillStyle = 'rgba(255, 248, 220, 0.08)';
        roundRect(ctx, px + 3, py + 3, tw - 6, Math.max(6, Math.floor(th * 0.3)), Math.max(4, UI_STYLE.radius - 2));
        ctx.fill();
        ctx.fillStyle = UI_PALETTE.accent;
        ctx.fillRect(px + 8, py + 8, 3, 3);
        ctx.fillRect(px + tw - 11, py + 8, 3, 3);
        ctx.fillRect(px + 8, py + th - 11, 3, 3);
        ctx.fillRect(px + tw - 11, py + th - 11, 3, 3);

        ctx.fillStyle = UI_PALETTE.textHi;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(displayText, px + tw / 2, py + th / 2);
        ctx.globalAlpha = 1.0;
    }

    drawFanfare(ctx, text, now, expires) {
        const alpha = Math.min(1, (expires - now) / 300);
        ctx.fillStyle = `rgba(18, 24, 18, ${0.9 * alpha})`;
        const bh = Math.floor(this.VP.CH * 0.4);
        const by = (this.VP.CH - bh) / 2;
        ctx.fillRect(0, by, this.VP.CW, bh);
        ctx.strokeStyle = `rgba(255, 221, 85, ${0.22 * alpha})`;
        ctx.lineWidth = 2;
        const cx = this.VP.CW / 2;
        const cy = by + bh / 2;
        const inner = Math.floor(this.VP.S * 1.2);
        const outer = Math.floor(this.VP.S * 3.4);
        ctx.beginPath();
        for (let i = 0; i < 8; i++) {
            const angle = (Math.PI * 2 * i) / 8;
            ctx.moveTo(cx + Math.cos(angle) * inner, cy + Math.sin(angle) * inner);
            ctx.lineTo(cx + Math.cos(angle) * outer, cy + Math.sin(angle) * outer);
        }
        ctx.stroke();
        
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
        const portrait = this.getDialoguePortrait(dialogue.speakerId);
        const headerH = Math.max(26, Math.floor(this.VP.S * 0.7));
        const portraitSize = portrait ? Math.max(28, Math.floor(this.VP.S * 1.6)) : 0;
        const portraitPad = portrait ? portraitSize + 10 : 0;
        const textWidth = BOX_W - PAD * 2 - portraitPad;

        ctx.fillStyle = UI_PALETTE.bg;
        roundRect(ctx, BOX_X, BOX_Y, BOX_W, BOX_H, UI_STYLE.radius);
        ctx.fill();
        ctx.fillStyle = 'rgba(255, 248, 220, 0.05)';
        for (let y = BOX_Y + 10; y < BOX_Y + BOX_H - 10; y += 6) {
            ctx.fillRect(BOX_X + 8, y, BOX_W - 16, 1);
        }
        ctx.strokeStyle = UI_PALETTE.border;
        ctx.lineWidth = UI_STYLE.borderW;
        ctx.stroke();
        ctx.fillStyle = 'rgba(255, 221, 85, 0.12)';
        roundRect(ctx, BOX_X + 6, BOX_Y + 6, BOX_W - 12, headerH, 5);
        ctx.fill();
        ctx.fillStyle = 'rgba(255, 248, 220, 0.1)';
        ctx.fillRect(BOX_X + 10, BOX_Y + 10, BOX_W - 20, 2);
        ctx.fillStyle = 'rgba(0, 0, 0, 0.22)';
        ctx.fillRect(BOX_X + 10, BOX_Y + headerH + 7, BOX_W - 20, 1);
        ctx.fillStyle = 'rgba(255, 248, 220, 0.12)';
        ctx.fillRect(BOX_X + 6, BOX_Y + 6, 5, 5);
        ctx.fillRect(BOX_X + BOX_W - 11, BOX_Y + 6, 5, 5);
        ctx.fillRect(BOX_X + 6, BOX_Y + BOX_H - 11, 5, 5);
        ctx.fillRect(BOX_X + BOX_W - 11, BOX_Y + BOX_H - 11, 5, 5);

        ctx.font = `bold ${Math.floor(this.VP.S * 0.38)}px monospace`;
        ctx.fillStyle = UI_PALETTE.accent;
        ctx.textAlign = 'left';
        ctx.textBaseline = 'top';
        ctx.fillText(dialogue.speakerId.toUpperCase(), BOX_X + PAD, BOX_Y + PAD * 0.6);

        if (portrait) {
            ctx.drawImage(
                portrait,
                BOX_X + PAD,
                BOX_Y + headerH + 10,
                portraitSize,
                portraitSize
            );
        }

        ctx.font = `${Math.floor(this.VP.S * 0.32)}px monospace`;
        ctx.fillStyle = UI_PALETTE.text;
        const visibleChars = Math.floor(dialogue.progress);
        const text = dialogue.text.slice(0, visibleChars);
        const lines = this.measureWrap(ctx, text, Math.max(80, textWidth));
        const lineH = Math.floor(this.VP.S * 0.45);
        lines.forEach((line, i) => {
            ctx.fillText(
                line,
                BOX_X + PAD + portraitPad,
                BOX_Y + headerH + PAD * 0.95 + i * lineH
            );
        });

        if (visibleChars >= dialogue.text.length) {
            const alpha = 0.5 + Math.sin(Date.now() / 200) * 0.5;
            ctx.fillStyle = `rgba(255, 221, 85, ${alpha})`;
            ctx.textAlign = 'right';
            let diaHint = 'Space/Enter to close';
            if (inputManager.lastInputMode === 'gamepad') diaHint = '(A) to advance';
            else if (inputManager.lastInputMode === 'touch') diaHint = 'Tap to advance';
            ctx.font = `${Math.floor(this.VP.S * 0.28)}px monospace`;
            ctx.fillText(diaHint, BOX_X + BOX_W - PAD - 14, BOX_Y + BOX_H - PAD * 0.6);
            ctx.fillRect(BOX_X + BOX_W - PAD - 8, BOX_Y + BOX_H - PAD * 0.9, 4, 4);
            ctx.fillRect(BOX_X + BOX_W - PAD - 6, BOX_Y + BOX_H - PAD * 0.7, 4, 4);

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

        const visibleEntries = menu.entries.slice(panel.scrollOffset, panel.scrollOffset + panel.visibleCount);
        visibleEntries.forEach((entry, visIdx) => {
            const absoluteIndex = panel.scrollOffset + visIdx;
            const row = panel.rows[visIdx];
            if (!row) return;
            const selected = absoluteIndex === (menu.selectedIndex || 0);

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
            this.menuHitRegions.push({ index: absoluteIndex, ...row });
        });

        // Scroll indicators
        ctx.font = `${detailSize}px monospace`;
        ctx.fillStyle = UI_PALETTE.textLo;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        if (panel.scrollOffset > 0) {
            ctx.fillText('▲', panel.x + panel.w / 2, panel.rowsTop - detailSize);
        }
        if (panel.scrollOffset + panel.visibleCount < menu.entries.length) {
            const lastRow = panel.rows[panel.rows.length - 1];
            if (lastRow) ctx.fillText('▼', panel.x + panel.w / 2, lastRow.y + lastRow.h + detailSize);
        }

        // Footer Hint
        ctx.font = `${detailSize}px monospace`;
        ctx.fillStyle = UI_PALETTE.textLo;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        
        let hint = '↑↓ / WASD to navigate  •  Enter/Space to confirm  •  Esc to back';
        if (inputManager.lastInputMode === 'gamepad') {
            hint = 'D-Pad / Stick to navigate  •  (A) to confirm  •  (B) to back';
        } else if (inputManager.lastInputMode === 'touch') {
            hint = 'Tap to choose  •  Swipe ↑↓ to scroll  •  Tap outside to back';
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
        const MAX_VISIBLE = 7;
        const visibleCount = Math.min(MAX_VISIBLE, menu.entries.length);
        const rowH = Math.max(36, Math.floor((availableH - rowGap * Math.max(0, visibleCount - 1)) / Math.max(1, visibleCount)));

        // Derive scroll offset to keep selectedIndex visible
        const selectedIndex = menu.selectedIndex || 0;
        const scrollOffset = Math.max(0, Math.min(
            menu.entries.length - visibleCount,
            selectedIndex - Math.floor(visibleCount / 2)
        ));

        const rows = menu.entries.slice(scrollOffset, scrollOffset + visibleCount).map((_, i) => ({
            x: x + pad,
            y: rowsTop + i * (rowH + rowGap),
            w: w - pad * 2,
            h: rowH,
        }));
        return { x, y, w, h, pad, headerH, rows, scrollOffset, visibleCount, rowH, rowGap, rowsTop };
    }

    drawWrappedText(ctx, text, x, y, maxWidth, lineHeight) {
        const lines = this.measureWrap(ctx, text, maxWidth);
        lines.forEach((line, idx) => ctx.fillText(line, x, y + idx * lineHeight));
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

    measureWrap(ctx, text, maxWidth) {
        const words = String(text || '').split(/\s+/).filter(Boolean);
        if (!words.length) return [''];
        const lines = [];
        let line = '';
        for (const word of words) {
            const test = line ? `${line} ${word}` : word;
            if (ctx.measureText(test).width > maxWidth && line) {
                lines.push(line);
                line = word;
            } else {
                line = test;
            }
        }
        if (line) lines.push(line);
        return lines;
    }

    getDialoguePortrait(speakerId) {
        const npc = NPCS[speakerId];
        if (!npc?.sprite) return null;
        const cacheKey = `${npc.sprite}:${npc.palette || 'npcWarm'}`;
        if (this.portraitCache.has(cacheKey)) return this.portraitCache.get(cacheKey);
        const template = getGrayscaleTemplate(npc.sprite);
        const palette = PALETTES[npc.palette] || PALETTES.npcWarm;
        const portrait = template && palette ? applyPalette(template, palette) : null;
        this.portraitCache.set(cacheKey, portrait);
        return portrait;
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
