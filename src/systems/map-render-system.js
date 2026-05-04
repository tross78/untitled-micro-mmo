// @ts-check

import { Component } from '../domain/components.js';
import { drawTile, zoneTileType, applyPalette, getGrayscaleTemplate, getSceneryPalette, drawLargeTree, getCompiledAssetMeta } from '../graphics/graphics.js';
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
        const locKey = `${loc.name}:${loc.width}:${loc.height}:${worldState.day}`;

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

        // 4. Draw Exits — portals glow, stairs get sprite, door/edge are invisible (wall gap is the visual)
        (loc.exitTiles || []).forEach(ex => {
            const sx = ex.x - camX;
            const sy = ex.y - camY;
            if (sx < -(ex.w || 1) || sx >= this.VP.W || sy < -(ex.h || 1) || sy >= this.VP.H) return;
            if (ex.type === 'portal') {
                drawTile(ctx, 'exit', screenOffsetX + sx * this.VP.S, screenOffsetY + sy * this.VP.S, 0, this.VP.S);
            } else if (ex.type === 'stairs' || ex.type === 'up' || ex.type === 'down') {
                this.drawScenery(ctx, sx, sy, 'stairs', screenOffsetX, screenOffsetY);
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

    drawScenery(ctx, sx, sy, label, screenOffsetX = 0, screenOffsetY = 0, w = 1, h = 1, wx = 0, wy = 0) {
        const px = screenOffsetX + sx * this.VP.S;
        const py = screenOffsetY + sy * this.VP.S;
        if (label === 'tree' && w > 1) {
            drawLargeTree(ctx, px, py, w * this.VP.S, h * this.VP.S, hashStr(`t${wx}_${wy}`));
            return;
        }
        const template = getGrayscaleTemplate(label) || getGrayscaleTemplate('rock');
        const palette = getSceneryPalette(label);
        const colored = applyPalette(template, palette);
        const compiledMeta = getCompiledAssetMeta(label);
        const renderStyle = compiledMeta ? {
            heightTiles: compiledMeta.renderHeightTiles,
            yOffsetTiles: compiledMeta.renderYOffsetTiles,
        } : SCENERY_RENDER_STYLE[label];
        const drawH = (renderStyle?.heightTiles || h) * this.VP.S;
        const drawY = py - ((renderStyle?.yOffsetTiles || 0) * this.VP.S);

        ctx.drawImage(colored, px, drawY, w * this.VP.S, drawH);
    }
}
