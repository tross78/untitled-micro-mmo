// @ts-check

import { Component } from '../domain/components.js';
import { drawTile, zoneTileType, applyPalette, getGrayscaleTemplate, getSceneryPalette, getCompiledAssetMeta, usesCompiledShape } from '../graphics/graphics.js';
import { SCENERY_RENDER_STYLE } from '../infra/graphics-constants.js';
import { getScatteredContent, hashStr } from '../rules/index.js';

/**
 * MapRenderSystem handles procedural tile generation and background caching.
 */
export class MapRenderSystem {
    /**
     * @param {import('../domain/ecs.js').WorldStore} world
     * @param {object} vp - Viewport metrics
     */
    constructor(world, vp) {
        this.world = world;
        this.VP = vp;
        this.tileCache = null; // { locKey: string, canvas: OffscreenCanvas } — full room, blit by camera offset
        this._scatterCache = null; // { key: string, content: array } — memoized scattered content
    }

    invalidate() {
        this.tileCache = null;
        this._scatterCache = null;
    }

    /**
     * @param {CanvasRenderingContext2D} ctx
     * @param {object} state - { localPlayer, worldState, worldData }
     * @param {number} camX
     * @param {number} camY
     * @param {number} screenOffsetX
     * @param {number} screenOffsetY
     * @param {number} gameTime - Monotonic game time in seconds from the loop
     */
    draw(ctx, state, camX, camY, screenOffsetX = 0, screenOffsetY = 0, gameTime = 0) {
        const { localPlayer, worldState, worldData } = state;
        const locId = localPlayer.location;
        const loc = worldData[locId];
        if (!loc) return;

        const tileType = zoneTileType(locId);
        const locKey = `${locId}:${loc.width}:${loc.height}:${worldState.day}`;

        // 1. Manage Cache — rebuild only when room or day changes, not on camera movement
        if (!this.tileCache || this.tileCache.locKey !== locKey) {
            this.rebuildCache(loc, locKey, tileType);
        }

        // 2. Blit visible slice of the full-room canvas using camera as source offset
        const srcX = camX * this.VP.S;
        const srcY = camY * this.VP.S;
        const srcW = Math.min(this.VP.W * this.VP.S, this.tileCache.canvas.width - srcX);
        const srcH = Math.min(this.VP.H * this.VP.S, this.tileCache.canvas.height - srcY);
        if (srcW > 0 && srcH > 0) {
            ctx.drawImage(this.tileCache.canvas, srcX, srcY, srcW, srcH, screenOffsetX, screenOffsetY, srcW, srcH);
        }

        // 3. Draw Static Scenery
        (loc.scenery || []).forEach(sc => {
            const sx = sc.x - camX;
            const sy = sc.y - camY;
            if (sx < -(sc.w || 1) || sx >= this.VP.W || sy < -(sc.h || 1) || sy >= this.VP.H) return;
            this.drawScenery(ctx, sx, sy, sc.label, screenOffsetX, screenOffsetY, sc.w || 1, sc.h || 1, sc.x, sc.y, gameTime);
        });

        // 4. Draw Exits — portals glow, stairs get sprite, edge/door get a directional arrow
        (loc.exitTiles || []).forEach(ex => {
            const sx = ex.x - camX;
            const sy = ex.y - camY;
            if (sx < -(ex.w || 1) || sx >= this.VP.W || sy < -(ex.h || 1) || sy >= this.VP.H) return;
            if (ex.type === 'portal') {
                drawTile(ctx, 'exit', screenOffsetX + sx * this.VP.S, screenOffsetY + sy * this.VP.S, 0, this.VP.S);
            } else if (ex.type === 'stairs' || ex.type === 'up' || ex.type === 'down') {
                this.drawScenery(ctx, sx, sy, 'stairs', screenOffsetX, screenOffsetY, 1, 1, ex.x, ex.y, gameTime);
            } else {
                this.drawExitArrow(ctx, ex, loc, sx, sy, screenOffsetX, screenOffsetY, gameTime);
            }
        });

        // 5. Draw Scattered Content — memoized per (locId, day), filtered per frame for gathered nodes
        const scatterKey = `${locId}:${worldState.day}`;
        if (!this._scatterCache || this._scatterCache.key !== scatterKey) {
            this._scatterCache = { key: scatterKey, content: getScatteredContent(locId, worldState.day, loc) };
        }
        const gatheredNodes = localPlayer.gatheredNodes;
        const gatheredSameDay = gatheredNodes?.day === worldState.day;
        this._scatterCache.content.forEach(sc => {
            if (gatheredSameDay && gatheredNodes?.nodes?.has(`${locId}:${sc.x},${sc.y}`)) return;
            const sx = sc.x - camX;
            const sy = sc.y - camY;
            if (sx < -1 || sx >= this.VP.W || sy < -1 || sy >= this.VP.H) return;
            this.drawScenery(ctx, sx, sy, sc.label, screenOffsetX, screenOffsetY, 1, 1, sc.x, sc.y, gameTime);
        });

        // 6. Draw Movement Target (Affordance Phase 8.5a)
        const playersWithTarget = this.world.query([Component.PlayerControlled, Component.Transform, Component.MovementTarget]);
        playersWithTarget.forEach(id => {
            const target = this.world.getComponent(id, Component.MovementTarget);
            const tx = target.x - camX;
            const ty = target.y - camY;
            if (tx < -1 || tx >= this.VP.W || ty < -1 || ty >= this.VP.H) return;

            const px = screenOffsetX + tx * this.VP.S + this.VP.S / 2;
            const py = screenOffsetY + ty * this.VP.S + this.VP.S / 2;
            const alpha = 0.5 + Math.sin(gameTime * (1000 / 150)) * 0.3;

            ctx.strokeStyle = `rgba(255, 255, 255, ${alpha})`;
            ctx.lineWidth = 2;
            ctx.beginPath();
            ctx.arc(px, py, this.VP.S / 3, 0, Math.PI * 2);
            ctx.stroke();
            ctx.beginPath();
            ctx.arc(px, py, this.VP.S / 6, 0, Math.PI * 2);
            ctx.stroke();
        });

        // 7. Draw tap/click pulse affordance (P1)
        const now = Date.now();
        const playersWithTap = this.world.query([Component.PlayerControlled, Component.TapPulse]);
        playersWithTap.forEach(id => {
            const tap = this.world.getComponent(id, Component.TapPulse);
            if (!tap) return;
            if (now > tap.expiresAt) {
                this.world.removeComponent(id, Component.TapPulse);
                return;
            }
            const progress = 1 - (tap.expiresAt - now) / 600;
            const tx = tap.x - camX;
            const ty = tap.y - camY;
            if (tx < -1 || tx >= this.VP.W || ty < -1 || ty >= this.VP.H) return;
            const px = screenOffsetX + tx * this.VP.S + this.VP.S / 2;
            const py = screenOffsetY + ty * this.VP.S + this.VP.S / 2;
            const alpha = (1 - progress) * 0.7;
            const radius = (this.VP.S / 3) * (0.6 + progress * 0.8);
            ctx.strokeStyle = `rgba(255, 255, 255, ${alpha})`;
            ctx.lineWidth = 2;
            ctx.beginPath();
            ctx.arc(px, py, radius, 0, Math.PI * 2);
            ctx.stroke();
        });

        // Night lighting disabled — revisit in future phase
    }

    rebuildCache(loc, locKey, tileType) {
        // Build a Map of override positions for O(1) lookup
        const overrideMap = new Map();
        for (const o of (loc.tileOverrides || [])) overrideMap.set(`${o.x},${o.y}`, o.type);

        const off = new OffscreenCanvas(
            Math.max(this.VP.S, loc.width * this.VP.S),
            Math.max(this.VP.S, loc.height * this.VP.S)
        );
        const octx = off.getContext('2d');
        if (!octx) return;
        octx.imageSmoothingEnabled = false;

        const baseHash = hashStr(locKey);
        for (let wy = 0; wy < loc.height; wy++) {
            for (let wx = 0; wx < loc.width; wx++) {
                const type = overrideMap.get(`${wx},${wy}`) || tileType;
                const seed = baseHash ^ (wx * 7919) ^ (wy * 6271);
                drawTile(octx, type, wx * this.VP.S, wy * this.VP.S, seed, this.VP.S);
            }
        }
        this.tileCache = { locKey, canvas: off };
    }

    drawExitArrow(ctx, ex, loc, sx, sy, screenOffsetX, screenOffsetY, gameTime = 0) {
        const exW = ex.w || 1;
        const exH = ex.h || 1;
        const px = screenOffsetX + sx * this.VP.S;
        const py = screenOffsetY + sy * this.VP.S;
        const tileW = exW * this.VP.S;
        const tileH = exH * this.VP.S;

        // Infer direction from which room edge the exit sits on
        let dir = null;
        if (ex.y === 0) dir = 'north';
        else if (ex.y + exH >= loc.height) dir = 'south';
        else if (ex.x === 0) dir = 'west';
        else if (ex.x + exW >= loc.width) dir = 'east';

        const pulse = 0.55 + Math.sin(gameTime * (1000 / 600)) * 0.2;
        ctx.save();
        ctx.globalAlpha = pulse;

        // Subtle tinted background on the exit tile
        ctx.fillStyle = 'rgba(120, 220, 160, 0.18)';
        ctx.fillRect(px, py, tileW, tileH);

        // Draw a small chevron arrow in the direction of travel
        if (dir) {
            const cx = px + tileW / 2;
            const cy = py + tileH / 2;
            const as = Math.min(tileW, tileH) * 0.28; // arrow half-size

            ctx.strokeStyle = 'rgba(120, 230, 160, 0.9)';
            ctx.lineWidth = 2;
            ctx.lineCap = 'round';
            ctx.lineJoin = 'round';
            ctx.beginPath();
            if (dir === 'north') {
                ctx.moveTo(cx - as, cy + as * 0.5);
                ctx.lineTo(cx, cy - as * 0.5);
                ctx.lineTo(cx + as, cy + as * 0.5);
            } else if (dir === 'south') {
                ctx.moveTo(cx - as, cy - as * 0.5);
                ctx.lineTo(cx, cy + as * 0.5);
                ctx.lineTo(cx + as, cy - as * 0.5);
            } else if (dir === 'west') {
                ctx.moveTo(cx + as * 0.5, cy - as);
                ctx.lineTo(cx - as * 0.5, cy);
                ctx.lineTo(cx + as * 0.5, cy + as);
            } else {
                ctx.moveTo(cx - as * 0.5, cy - as);
                ctx.lineTo(cx + as * 0.5, cy);
                ctx.lineTo(cx - as * 0.5, cy + as);
            }
            ctx.stroke();
        }

        ctx.restore();
    }

    drawScenery(ctx, sx, sy, label, screenOffsetX = 0, screenOffsetY = 0, w = 1, h = 1, _wx = 0, _wy = 0, gameTime = 0) {
        const px = screenOffsetX + sx * this.VP.S;
        const py = screenOffsetY + sy * this.VP.S;

        const compiledMeta = getCompiledAssetMeta(label);

        // Phase 8.76 P3: Animation frame for scenery — game-time-based, frame-rate-independent
        let frameIdx = 0;
        if (compiledMeta?.frames?.length > 1 && compiledMeta.frameRate) {
            frameIdx = Math.floor(gameTime * compiledMeta.frameRate) % compiledMeta.frames.length;
        }

        const usingCompiledShape = compiledMeta && usesCompiledShape(label);
        const logicalW = usingCompiledShape ? compiledMeta.logicalWidth : w;
        const logicalH = usingCompiledShape ? compiledMeta.logicalHeight : h;
        const template = getGrayscaleTemplate(label, 0, frameIdx) || getGrayscaleTemplate('rock');
        const palette = getSceneryPalette(label);
        const colored = applyPalette(template, palette);
        const renderStyle = usingCompiledShape ? {
            heightTiles: compiledMeta.renderHeightTiles,
            yOffsetTiles: compiledMeta.renderYOffsetTiles,
        } : SCENERY_RENDER_STYLE[label];
        const drawH = (renderStyle?.heightTiles || logicalH) * this.VP.S;
        const drawY = py - ((renderStyle?.yOffsetTiles || 0) * this.VP.S);

        ctx.drawImage(colored, px, drawY, logicalW * this.VP.S, drawH);
    }
}
