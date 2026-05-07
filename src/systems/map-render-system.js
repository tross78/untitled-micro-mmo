// @ts-check

import { Component } from '../domain/components.js';
import { drawTile, zoneTileType, applyPalette, getGrayscaleTemplate, getSceneryPalette, getCompiledAssetMeta } from '../graphics/graphics.js';
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
        this.tileCache = null; // { locKey: string, camX: number, camY: number, canvas: OffscreenCanvas }
    }

    /**
     * @param {CanvasRenderingContext2D} ctx
     * @param {object} state - { localPlayer, worldState, worldData }
     * @param {number} camX
     * @param {number} camY
     */
    draw(ctx, state, camX, camY, screenOffsetX = 0, screenOffsetY = 0) {
        const { localPlayer, worldState, worldData } = state;
        const locId = localPlayer.location;
        const loc = worldData[locId];
        if (!loc) return;

        const tileType = zoneTileType(locId);
        const floorX = Math.floor(camX);
        const floorY = Math.floor(camY);
        const locKey = `${locId}:${loc.width}:${loc.height}:${worldState.day}`;

        // 1. Manage Cache
        if (!this.tileCache || this.tileCache.locKey !== locKey || this.tileCache.camX !== floorX || this.tileCache.camY !== floorY) {
            this.rebuildCache(loc, locKey, floorX, floorY, tileType);
        }

        // 2. Draw Cached Layer
        const offsetX = (camX - floorX) * this.VP.S;
        const offsetY = (camY - floorY) * this.VP.S;
        ctx.drawImage(this.tileCache.canvas, screenOffsetX - offsetX, screenOffsetY - offsetY);

        // 3. Draw Static Scenery
        (loc.scenery || []).forEach(sc => {
            const sx = sc.x - camX;
            const sy = sc.y - camY;
            if (sx < -(sc.w || 1) || sx >= this.VP.W || sy < -(sc.h || 1) || sy >= this.VP.H) return;
            this.drawScenery(ctx, sx, sy, sc.label, screenOffsetX, screenOffsetY, sc.w || 1, sc.h || 1, sc.x, sc.y);
        });

        // 4. Draw Exits — portals glow, stairs get sprite, edge/door get a directional arrow
        (loc.exitTiles || []).forEach(ex => {
            const sx = ex.x - camX;
            const sy = ex.y - camY;
            if (sx < -(ex.w || 1) || sx >= this.VP.W || sy < -(ex.h || 1) || sy >= this.VP.H) return;
            if (ex.type === 'portal') {
                drawTile(ctx, 'exit', screenOffsetX + sx * this.VP.S, screenOffsetY + sy * this.VP.S, 0, this.VP.S);
            } else if (ex.type === 'stairs' || ex.type === 'up' || ex.type === 'down') {
                this.drawScenery(ctx, sx, sy, 'stairs', screenOffsetX, screenOffsetY);
            } else {
                this.drawExitArrow(ctx, ex, loc, sx, sy, screenOffsetX, screenOffsetY);
            }
        });

        // 5. Draw Scattered Content
        const scattered = getScatteredContent(locId, worldState.day, loc);
        scattered.forEach(sc => {
            const sx = sc.x - camX;
            const sy = sc.y - camY;
            if (sx < -1 || sx >= this.VP.W || sy < -1 || sy >= this.VP.H) return;
            this.drawScenery(ctx, sx, sy, sc.label, screenOffsetX, screenOffsetY);
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
            const alpha = 0.5 + Math.sin(Date.now() / 150) * 0.3;

            ctx.strokeStyle = `rgba(255, 255, 255, ${alpha})`;
            ctx.lineWidth = 2;
            ctx.beginPath();
            ctx.arc(px, py, this.VP.S / 3, 0, Math.PI * 2);
            ctx.stroke();
            ctx.beginPath();
            ctx.arc(px, py, this.VP.S / 6, 0, Math.PI * 2);
            ctx.stroke();
        });

        // Night lighting disabled — revisit in future phase
    }

    rebuildCache(loc, locKey, floorX, floorY, tileType) {
        const tilesWide = Math.max(0, Math.min(this.VP.W + 1, loc.width - floorX));
        const tilesHigh = Math.max(0, Math.min(this.VP.H + 1, loc.height - floorY));
        const off = new OffscreenCanvas(
            Math.max(this.VP.S, tilesWide * this.VP.S),
            Math.max(this.VP.S, tilesHigh * this.VP.S)
        );
        const octx = off.getContext('2d');
        if (!octx) return;
        octx.imageSmoothingEnabled = false;

        for (let ty = 0; ty < tilesHigh; ty++) {
            for (let tx = 0; tx < tilesWide; tx++) {
                const wx = floorX + tx;
                const wy = floorY + ty;

                const override = (loc.tileOverrides || []).find(o => o.x === wx && o.y === wy);
                const seed = hashStr(locKey) ^ (wx * 7919) ^ (wy * 6271);
                drawTile(octx, override?.type || tileType, tx * this.VP.S, ty * this.VP.S, seed, this.VP.S);
            }
        }
        this.tileCache = { locKey, camX: floorX, camY: floorY, canvas: off };
    }

    drawExitArrow(ctx, ex, loc, sx, sy, screenOffsetX, screenOffsetY) {
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

        const pulse = 0.55 + Math.sin(Date.now() / 600) * 0.2;
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

    drawScenery(ctx, sx, sy, label, screenOffsetX = 0, screenOffsetY = 0, w = 1, h = 1, _wx = 0, _wy = 0) {
        const px = screenOffsetX + sx * this.VP.S;
        const py = screenOffsetY + sy * this.VP.S;

        const compiledMeta = getCompiledAssetMeta(label);
        const logicalW = compiledMeta?.logicalWidth || w;
        const logicalH = compiledMeta?.logicalHeight || h;
        const template = getGrayscaleTemplate(label) || getGrayscaleTemplate('rock');
        const palette = getSceneryPalette(label);
        const colored = applyPalette(template, palette);
        const renderStyle = compiledMeta ? {
            heightTiles: compiledMeta.renderHeightTiles,
            yOffsetTiles: compiledMeta.renderYOffsetTiles,
        } : SCENERY_RENDER_STYLE[label];
        const drawH = (renderStyle?.heightTiles || logicalH) * this.VP.S;
        const drawY = py - ((renderStyle?.yOffsetTiles || 0) * this.VP.S);

        ctx.drawImage(colored, px, drawY, logicalW * this.VP.S, drawH);
    }
}
