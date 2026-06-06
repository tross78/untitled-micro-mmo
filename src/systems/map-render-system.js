// @ts-check

import { Component } from '../domain/components.js';
import { shapePool } from '../content/define.js';
import { drawTile, zoneTileType, applyPalette, getGrayscaleTemplate, getSceneryPalette, getCompiledAssetMeta, usesCompiledShape, isIndexedAsset, getIndexedTemplate } from '../graphics/graphics.js';
import { SCENERY_RENDER_SCALE } from '../infra/graphics-constants.js';
import { SCENERY_RENDER_STYLE, SCENERY_DIMENSIONS } from '../infra/graphics-constants.js';
import { hashStr } from '../rules/index.js';

// Module-level cache for colored scenery sprites. Key: "label:frameIdx".
// applyPalette allocates an OffscreenCanvas + ImageData every call; without this
// cache each frame re-allocates O(scenery-count) canvases causing GC jank on mobile.
const _sceneryColorCache = new Map();
const getColoredScenery = (label, frameIdx) => {
    const key = `${label}:${frameIdx}`;
    let cached = _sceneryColorCache.get(key);
    if (!cached) {
        if (isIndexedAsset(label)) {
            // Authored multi-slot asset — colors are baked, no recolor.
            cached = getIndexedTemplate(label, frameIdx) || getGrayscaleTemplate('rock');
        } else {
            const template = getGrayscaleTemplate(label, 0, frameIdx) || getGrayscaleTemplate('rock');
            cached = applyPalette(template, getSceneryPalette(label));
        }
        _sceneryColorCache.set(key, cached);
    }
    return cached;
};

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
        const locKey = `${locId}:${loc.width}:${loc.height}:${worldState.day}:${this.VP.S}`;

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

        // 5. Draw Movement Target (Affordance Phase 8.5a)
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
        const poolTiles = new Set(
            Array.isArray(loc.terrain?.pools) && loc.terrain.pools.length
                ? loc.terrain.pools.flatMap((pool, index) => shapePool(pool, loc.id, index).map((tile) => `${tile.x},${tile.y}`))
                : []
        );
        const getTileAt = (x, y) => {
            if (x < 0 || y < 0 || x >= loc.width || y >= loc.height) return null;
            return overrideMap.get(`${x},${y}`) || tileType;
        };

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
                const type = getTileAt(wx, wy);
                const seed = baseHash ^ (wx * 7919) ^ (wy * 6271);
                if (poolTiles.has(`${wx},${wy}`)) continue;
                drawTile(octx, type, wx * this.VP.S, wy * this.VP.S, seed, this.VP.S, {
                    north: getTileAt(wx, wy - 1),
                    south: getTileAt(wx, wy + 1),
                    west: getTileAt(wx - 1, wy),
                    east: getTileAt(wx + 1, wy),
                });
            }
        }

        if (Array.isArray(loc.terrain?.pools) && loc.terrain.pools.length) {
            this.drawTerrainPools(octx, loc, poolTiles, baseHash);
        }
        this.tileCache = { locKey, canvas: off };
    }

    drawTerrainPools(ctx, loc, poolTiles, baseHash) {
        const S = this.VP.S;
        const seeded = (x, y, salt) => {
            let v = (baseHash ^ (x * 374761393) ^ (y * 668265263) ^ salt) >>> 0;
            v ^= v >>> 13;
            v = Math.imul(v, 1274126177) >>> 0;
            return v >>> 0;
        };

            const drawContour = (tiles, paletteSeed, type = 'water') => {
                const occupied = new Set(tiles.map((t) => `${t.x},${t.y}`));
                const edges = [];
            const pushEdge = (sx, sy, ex, ey) => {
                edges.push({ sx, sy, ex, ey, start: `${sx},${sy}`, end: `${ex},${ey}` });
            };

            for (const tile of tiles) {
                const { x, y } = tile;
                if (!occupied.has(`${x},${y - 1}`)) pushEdge(x, y, x + 1, y);
                if (!occupied.has(`${x + 1},${y}`)) pushEdge(x + 1, y, x + 1, y + 1);
                if (!occupied.has(`${x},${y + 1}`)) pushEdge(x + 1, y + 1, x, y + 1);
                if (!occupied.has(`${x - 1},${y}`)) pushEdge(x, y + 1, x, y);
            }

            const starts = new Map();
            edges.forEach((edge, idx) => {
                if (!starts.has(edge.start)) starts.set(edge.start, []);
                starts.get(edge.start).push(idx);
            });

            const used = new Set();
            const loops = [];
            const pickNext = (startKey) => {
                const list = starts.get(startKey) || [];
                for (const idx of list) {
                    if (!used.has(idx)) return idx;
                }
                return null;
            };

            for (let i = 0; i < edges.length; i++) {
                if (used.has(i)) continue;
                const loop = [];
                let current = edges[i];
                used.add(i);
                loop.push([current.sx, current.sy]);
                let guard = 0;
                while (guard++ < edges.length + 8) {
                    loop.push([current.ex, current.ey]);
                    const nextIndex = pickNext(current.end);
                    if (nextIndex == null) break;
                    current = edges[nextIndex];
                    if (used.has(nextIndex)) break;
                    used.add(nextIndex);
                    if (current.end === `${loop[0][0]},${loop[0][1]}`) {
                        loop.push([current.ex, current.ey]);
                        break;
                    }
                }
                if (loop.length > 3) loops.push(loop);
            }

            const pathForLoop = (loop, inset = 0) => {
                const pts = loop.map(([gx, gy]) => ({
                    x: gx * S + inset,
                    y: gy * S + inset,
                }));
                if (pts.length < 3) return;
                ctx.beginPath();
                ctx.moveTo(pts[0].x, pts[0].y);
                for (let i = 1; i < pts.length - 1; i++) {
                    const prev = pts[i - 1];
                    const cur = pts[i];
                    const next = pts[i + 1];
                    const m1x = (prev.x + cur.x) / 2;
                    const m1y = (prev.y + cur.y) / 2;
                    const m2x = (cur.x + next.x) / 2;
                    const m2y = (cur.y + next.y) / 2;
                    ctx.lineTo(m1x, m1y);
                    ctx.quadraticCurveTo(cur.x, cur.y, m2x, m2y);
                }
                ctx.lineTo(pts[pts.length - 1].x, pts[pts.length - 1].y);
                ctx.closePath();
            };

            const renderLayer = (fillStyle, inset, alpha = 1, blur = 0) => {
                ctx.save();
                ctx.globalAlpha = alpha;
                ctx.fillStyle = fillStyle;
                ctx.strokeStyle = fillStyle;
                ctx.lineJoin = 'round';
                ctx.lineCap = 'round';
                ctx.lineWidth = Math.max(1, S * 0.08);
                for (const loop of loops) {
                    pathForLoop(loop, inset);
                    ctx.fill();
                    ctx.stroke();
                }
                if (blur > 0) {
                    ctx.globalAlpha = alpha * 0.5;
                    ctx.fillStyle = '#60c0e8';
                    for (const loop of loops) {
                        pathForLoop(loop, inset + 1);
                        ctx.fill();
                    }
                }
                ctx.restore();
            };

            const paletteForType = (type) => {
                if (type === 'ice') {
                    return [
                        { fillStyle: '#6fa8c8', inset: 0, alpha: 1.0, blur: 0 },
                        { fillStyle: '#9bd0ea', inset: 1, alpha: 0.92, blur: 0 },
                        { fillStyle: '#e9fbff', inset: 2, alpha: 0.76, blur: 1 },
                    ];
                }
                if (type === 'sand') {
                    return [
                        { fillStyle: '#a88840', inset: 0, alpha: 1.0, blur: 0 },
                        { fillStyle: '#d8bc70', inset: 1, alpha: 0.92, blur: 0 },
                        { fillStyle: '#f8eebc', inset: 2, alpha: 0.78, blur: 0 },
                    ];
                }
                return [
                    { fillStyle: '#0c2c68', inset: 0, alpha: 1.0, blur: 0 },
                    { fillStyle: '#1848a8', inset: 1, alpha: 0.94, blur: 0 },
                    { fillStyle: '#2870c8', inset: 2, alpha: 0.82, blur: 1 },
                ];
            };

            for (const layer of paletteForType(type)) {
                renderLayer(layer.fillStyle, layer.inset, layer.alpha, layer.blur);
            }

            // Shoreline sparkle and soft variation over the room-level blob.
            ctx.save();
            ctx.fillStyle = type === 'ice' ? '#ffffff' : (type === 'sand' ? '#f8eebc' : '#60c0e8');
            for (const tile of tiles) {
                const px = tile.x * S + S / 2;
                const py = tile.y * S + S / 2;
                const seed = seeded(tile.x, tile.y, paletteSeed ^ 0x9e3779b9);
                if ((seed & 3) === 0) ctx.fillRect(px - 2, py - 5, 5, 1);
                if ((seed & 7) === 0) ctx.fillRect(px + 1, py - 1, 2, 1);
            }
            ctx.restore();
        };

        const byPool = Array.isArray(loc.terrain?.pools) ? loc.terrain.pools : [];
        byPool.forEach((pool, index) => {
            const tiles = shapePool(pool, loc.id, index);
            if (!tiles.length) return;
            drawContour(tiles, index * 101, pool.type || 'water');
        });
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
        const dims = SCENERY_DIMENSIONS[label];
        const logicalW = usingCompiledShape ? compiledMeta.logicalWidth : (dims ? dims[0] : w);
        const logicalH = usingCompiledShape ? compiledMeta.logicalHeight : (dims ? dims[1] : h);
        const colored = getColoredScenery(label, frameIdx);
        const renderStyle = usingCompiledShape ? {
            heightTiles: compiledMeta.renderHeightTiles,
            yOffsetTiles: compiledMeta.renderYOffsetTiles,
        } : SCENERY_RENDER_STYLE[label];
        const fullW = logicalW * this.VP.S;
        const fullH = (renderStyle?.heightTiles || logicalH) * this.VP.S;
        const baseY = py - ((renderStyle?.yOffsetTiles || 0) * this.VP.S);

        // Small ground clutter is drawn smaller than a full tile, centered and seated on the ground,
        // so rocks/stones/etc. don't render as tile-sized boulders.
        const scale = SCENERY_RENDER_SCALE[label] ?? 1;
        const drawW = fullW * scale;
        const drawH = fullH * scale;
        const drawX = px + (fullW - drawW) / 2;
        const drawY = baseY + (fullH - drawH);

        ctx.drawImage(colored, drawX, drawY, drawW, drawH);
    }
}
