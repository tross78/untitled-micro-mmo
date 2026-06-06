// @ts-check

import { world as worldData } from '../content/data.js';
import { getDaylight } from '../rules/index.js';
import { SCENERY_LIGHT } from '../infra/graphics-constants.js';

/**
 * LightingRenderSystem draws the ambient colour grade over the world viewport, plus additive warm
 * glows around light-emitting scenery (torches, fires) when the scene is dim.
 *
 * Ambient is wall-clock driven outdoors (a full-day colour grade, in sync with getTimeOfDay gameplay),
 * a constant moody darkening in dungeons, and untouched in interiors (shops stay readable). Glows are
 * gated by how dark the scene is, so daytime is unaffected. Cheap: one tint fillRect + a radial
 * gradient per visible light source.
 */

// Keyframes around the 24h clock: [hour, r, g, b, alpha]. Interpolated linearly; wraps at 24h.
const TINT_KEYFRAMES = [
    [0.0,  16, 22, 52, 0.52],  // midnight — deep blue
    [5.0,  30, 40, 80, 0.42],  // late night
    [6.5, 255, 140, 90, 0.20], // dawn — warm
    [8.0, 205, 215, 235, 0.07],// morning — faint cool haze
    [12.0, 255, 255, 255, 0.0],// noon — neutral
    [16.0, 255, 210, 150, 0.08],// afternoon — gentle warm
    [18.5, 255, 150, 80, 0.20],// golden hour
    [20.0, 230, 120, 80, 0.30],// sunset
    [21.5, 70, 60, 120, 0.42], // twilight — purple-blue
    [24.0, 16, 22, 52, 0.52],  // wrap to midnight
];

const DUNGEON_TINT = { r: 12, g: 16, b: 34, a: 0.34 }; // moody, but still readable without torches

export class LightingRenderSystem {
    /** @param {object} vp - Viewport metrics */
    constructor(vp) {
        this.VP = vp;
        this._glowCache = new Map(); // label -> baked radial-glow sprite (re-tinted per light type)
    }

    /**
     * Baked radial glow sprite for a light type. Rasterizing a radial gradient every frame (×N torches,
     * with 'lighter' compositing) is the expensive path on weak GPUs — so we bake it once and blit it,
     * scaling to the on-screen radius and modulating brightness via globalAlpha (cheap).
     */
    _glowSprite(label, color) {
        const cached = this._glowCache.get(label);
        if (cached !== undefined) return cached;
        let sprite = null;
        const R = 64; // baked half-size; blit scales it to the real radius
        try {
            const cv = typeof OffscreenCanvas !== 'undefined'
                ? new OffscreenCanvas(R * 2, R * 2)
                : Object.assign(document.createElement('canvas'), { width: R * 2, height: R * 2 });
            const g = cv.getContext('2d');
            const grad = g.createRadialGradient(R, R, 0, R, R, R);
            grad.addColorStop(0, `rgba(${color}, 1)`);
            grad.addColorStop(0.5, `rgba(${color}, 0.45)`);
            grad.addColorStop(1, `rgba(${color}, 0)`);
            g.fillStyle = grad;
            g.fillRect(0, 0, R * 2, R * 2);
            sprite = cv;
        } catch { sprite = null; }
        this._glowCache.set(label, sprite);
        return sprite;
    }

    /** Interpolated ambient tint for a given hour (0..24). @returns {{r,g,b,a:number}} */
    tintForHour(hour) {
        const kf = TINT_KEYFRAMES;
        for (let i = 0; i < kf.length - 1; i++) {
            const [h0, r0, g0, b0, a0] = kf[i];
            const [h1, r1, g1, b1, a1] = kf[i + 1];
            if (hour >= h0 && hour <= h1) {
                const t = h1 === h0 ? 0 : (hour - h0) / (h1 - h0);
                return {
                    r: Math.round(r0 + (r1 - r0) * t),
                    g: Math.round(g0 + (g1 - g0) * t),
                    b: Math.round(b0 + (b1 - b0) * t),
                    a: a0 + (a1 - a0) * t,
                };
            }
        }
        const [, r, g, b, a] = kf[0];
        return { r, g, b, a };
    }

    /**
     * @param {CanvasRenderingContext2D} ctx
     * @param {string} roomId
     * @param {number} camX @param {number} camY
     * @param {number} screenOffsetX @param {number} screenOffsetY
     * @param {number} gameTime - seconds, for flame flicker
     * @param {number} [now] - epoch ms (defaults to Date.now); injectable for testing
     */
    draw(ctx, roomId, camX, camY, screenOffsetX, screenOffsetY, gameTime = 0, now = Date.now()) {
        const room = worldData[roomId];
        if (!room) return;
        const zone = room.zone;

        // 1. Ambient grade + how dark the scene is (0 = bright, 1 = pitch) for glow gating.
        // A room may override the zone default with `ambientDark` (0..1) — e.g. an indoor tavern set
        // to ~0.3 so its hearth glows all day without being re-zoned or darkened much.
        let tint = null;
        let darkness;
        if (typeof room.ambientDark === 'number') {
            darkness = Math.max(0, Math.min(1, room.ambientDark));
            // Only the darker overrides get a visible tint; gentle ones just enable the glow.
            if (darkness > 0.4) tint = { r: 14, g: 18, b: 36, a: Math.min(0.4, darkness * 0.45) };
        } else if (zone === 'dungeon') {
            tint = DUNGEON_TINT;
            darkness = 0.8;
        } else if (zone === 'interior') {
            tint = null;            // keep interiors as authored/readable
            darkness = 0.32;        // but allow hearths/candles to glow gently
        } else {
            tint = this.tintForHour((now / 3600000) % 24);
            darkness = 1 - getDaylight(now);
        }

        const topY = this.VP.topChrome || 0;
        const h = this.VP.worldPxH ?? this.VP.CH;
        if (tint && tint.a > 0.01) {
            ctx.fillStyle = `rgba(${tint.r}, ${tint.g}, ${tint.b}, ${tint.a.toFixed(3)})`;
            ctx.fillRect(0, topY, this.VP.CW, h);
        }

        // 2. Additive light-source glows — only worth drawing once the scene is dim enough.
        if (darkness > 0.12) {
            this.drawGlows(ctx, room, camX, camY, screenOffsetX, screenOffsetY, gameTime, darkness);
        }
    }

    drawGlows(ctx, room, camX, camY, screenOffsetX, screenOffsetY, gameTime, darkness) {
        const scenery = room.scenery;
        if (!Array.isArray(scenery)) return;
        const S = this.VP.S;
        let opened = false;
        for (const s of scenery) {
            const cfg = SCENERY_LIGHT[s.label];
            if (!cfg) continue;
            const wcx = (s.x + (s.w || 1) / 2 - camX) * S + screenOffsetX;
            const wcy = (s.y + (s.h || 1) / 2 - camY) * S + screenOffsetY;
            const r = cfg.radius * S;
            if (wcx < -r || wcy < -r || wcx > this.VP.CW + r || wcy > (this.VP.CH || 0) + r) continue;
            const sprite = this._glowSprite(s.label, cfg.color);
            if (!sprite) continue;
            if (!opened) {
                ctx.save();
                ctx.globalCompositeOperation = 'lighter';
                ctx.imageSmoothingEnabled = true; // keep the upscaled glow soft, not blocky
                opened = true;
            }
            const flick = 0.85 + 0.15 * Math.sin(gameTime * 7 + s.x * 1.7 + s.y * 2.3);
            ctx.globalAlpha = Math.min(1, cfg.intensity * darkness * flick);
            ctx.drawImage(sprite, wcx - r, wcy - r, r * 2, r * 2);
        }
        if (opened) { ctx.globalAlpha = 1; ctx.restore(); }
    }
}
