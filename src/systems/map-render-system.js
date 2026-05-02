// @ts-check

import { drawTile, zoneTileType } from '../graphics/graphics.js';
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
     * @param {object} state - { localPlayer, worldState }
     * @param {number} camX
     * @param {number} camY
     */
    draw(ctx, state, camX, camY) {
        const { localPlayer, worldState } = state;
        const locId = localPlayer.location;
        const loc = worldState.rooms?.[locId];
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
        ctx.drawImage(this.tileCache.canvas, -offsetX, -offsetY);

        // 3. Draw Static Scenery
        (loc.scenery || []).forEach(sc => {
            const sx = sc.x - camX;
            const sy = sc.y - camY;
            if (sx < -1 || sx >= this.VP.W || sy < -1 || sy >= this.VP.H) return;
            this.drawScenery(ctx, sx, sy, sc.label);
        });

        // 4. Draw Scattered Content
        const scattered = getScatteredContent(locId, worldState.day, loc);
        scattered.forEach(sc => {
            const sx = sc.x - camX;
            const sy = sc.y - camY;
            if (sx < -1 || sx >= this.VP.W || sy < -1 || sy >= this.VP.H) return;
            this.drawScenery(ctx, sx, sy, sc.label);
        });
    }

    rebuildCache(loc, locKey, floorX, floorY, tileType) {
        const off = new OffscreenCanvas(this.VP.CW + this.VP.S, this.VP.CH + this.VP.S);
        const octx = off.getContext('2d');
        if (!octx) return;
        octx.imageSmoothingEnabled = false;

        for (let ty = 0; ty <= this.VP.H; ty++) {
            for (let tx = 0; tx <= this.VP.W; tx++) {
                const wx = floorX + tx;
                const wy = floorY + ty;
                
                if (wx >= loc.width || wy >= loc.height || wx < 0 || wy < 0) {
                    octx.fillStyle = '#0a0a0a';
                    octx.fillRect(tx * this.VP.S, ty * this.VP.S, this.VP.S, this.VP.S);
                    continue;
                }

                const override = (loc.tileOverrides || []).find(o => o.x === wx && o.y === wy);
                const seed = hashStr(locKey) ^ (wx * 7919) ^ (wy * 6271);
                drawTile(octx, override?.type || tileType, tx * this.VP.S, ty * this.VP.S, seed, this.VP.S);
            }
        }
        this.tileCache = { locKey, camX: floorX, camY: floorY, canvas: off };
    }

    drawScenery(ctx, sx, sy, label) {
        ctx.fillStyle = '#2a3a2a';
        ctx.fillRect(sx * this.VP.S + 2, sy * this.VP.S + 2, this.VP.S - 4, this.VP.S - 4);
        ctx.fillStyle = '#668855';
        ctx.font = `${Math.floor(this.VP.S * 0.55)}px monospace`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(label || '■', sx * this.VP.S + this.VP.S / 2, sy * this.VP.S + this.VP.S / 2);
    }
}
