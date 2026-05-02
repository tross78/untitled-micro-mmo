// @ts-check

import { Component } from '../domain/components.js';
import { generateCharacterSprite } from '../graphics/graphics.js';

/**
 * EntityRenderSystem draws all spatial entities (Players, NPCs, Enemies).
 */
export class EntityRenderSystem {
    /**
     * @param {import('../domain/ecs.js').WorldStore} world
     * @param {object} vp - Viewport metrics
     */
    constructor(world, vp) {
        this.world = world;
        this.VP = vp;
        this.spriteCache = new Map(); // seed:type -> canvas
    }

    /**
     * @param {CanvasRenderingContext2D} ctx
     * @param {number} camX
     * @param {number} camY
     */
    draw(ctx, camX, camY) {
        const entities = this.world.query([Component.Transform, Component.Sprite]);

        for (const id of entities) {
            const transform = this.world.getComponent(id, Component.Transform);
            const spriteDef = this.world.getComponent(id, Component.Sprite);
            const tween = this.world.getComponent(id, Component.Tweenable);
            const health = this.world.getComponent(id, Component.Health);

            let drawX = transform.x;
            let drawY = transform.y;

            // Apply Tweening
            if (tween) {
                drawX = tween.startX + (tween.targetX - tween.startX) * tween.progress;
                drawY = tween.startY + (tween.targetY - tween.startY) * tween.progress;
            }

            const sx = drawX - camX;
            const sy = drawY - camY;

            // Viewport culling
            if (sx < -1 || sx >= this.VP.W || sy < -1 || sy >= this.VP.H) continue;

            // Draw Sprite
            const sprite = this.getSprite(spriteDef.seed, spriteDef.palette);
            ctx.drawImage(sprite, sx * this.VP.S + Math.floor(this.VP.S * 0.15), sy * this.VP.S, Math.floor(this.VP.S * 0.7), this.VP.S);

            // Health Bar
            if (health && health.current < health.max) {
                this.drawHealthBar(ctx, sx, sy, health.current / health.max);
            }

            // Selection indicator for player
            if (this.world.getComponent(id, Component.PlayerControlled)) {
                ctx.strokeStyle = '#00ff44';
                ctx.lineWidth = 2;
                ctx.strokeRect(sx * this.VP.S + 1, sy * this.VP.S + 1, this.VP.S - 2, this.VP.S - 2);
            }
        }
    }

    getSprite(seed, palette) {
        const key = `${seed}:${palette}`;
        if (this.spriteCache.has(key)) return this.spriteCache.get(key);
        const canvas = generateCharacterSprite(seed, palette);
        this.spriteCache.set(key, canvas);
        return canvas;
    }

    drawHealthBar(ctx, sx, sy, pct) {
        const bw = this.VP.S - 4;
        const x = sx * this.VP.S + 2;
        const y = sy * this.VP.S - 5;
        ctx.fillStyle = '#440000';
        ctx.fillRect(x, y, bw, 3);
        ctx.fillStyle = pct > 0.5 ? '#00cc00' : pct > 0.25 ? '#aaaa00' : '#cc0000';
        ctx.fillRect(x, y, Math.round(bw * pct), 3);
    }
}
