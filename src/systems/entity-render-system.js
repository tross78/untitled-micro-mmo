// @ts-check

import { Component } from '../domain/components.js';
import { generateCharacterSprite, getWalkPose } from '../graphics/graphics.js';

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
            let walkPose = { legOffset: 0, bodyY: 0 };

            // Apply Tweening & Animation (Zelda-style)
            if (tween) {
                drawX = tween.startX + (tween.targetX - tween.startX) * tween.progress;
                drawY = tween.startY + (tween.targetY - tween.startY) * tween.progress;
                walkPose = getWalkPose(Date.now());
            }

            const sx = drawX - camX;
            const sy = drawY - camY;

            // Viewport culling
            if (sx < -1 || sx >= this.VP.W || sy < -1 || sy >= this.VP.H) continue;

            // Draw Sprite
            const sprite = this.getSprite(spriteDef.seed, spriteDef.palette);
            // Apply bounce during walk
            const bounceY = walkPose.bodyY;
            ctx.drawImage(sprite, sx * this.VP.S + Math.floor(this.VP.S * 0.15), sy * this.VP.S + bounceY, Math.floor(this.VP.S * 0.7), this.VP.S);

            // Name Label
            ctx.font = `${Math.floor(this.VP.S * 0.28)}px monospace`;
            ctx.textAlign = 'center';
            ctx.textBaseline = 'bottom';
            
            const identity = this.world.getComponent(id, 'Identity');
            const name = identity?.name || '???';

            if (this.world.getComponent(id, Component.PlayerControlled)) {
                ctx.fillStyle = '#00ff44';
                ctx.fillText('You', sx * this.VP.S + this.VP.S / 2, sy * this.VP.S + bounceY);
                
                // Selection indicator
                ctx.strokeStyle = '#00ff44';
                ctx.lineWidth = 2;
                ctx.strokeRect(sx * this.VP.S + 1, sy * this.VP.S + bounceY + 1, this.VP.S - 2, this.VP.S - 2);
            } else {
                ctx.fillStyle = spriteDef.palette === 'enemy' ? '#ff4444' : '#00aaff';
                ctx.fillText(name, sx * this.VP.S + this.VP.S / 2, sy * this.VP.S + bounceY);

                // Health Bar (for enemies)
                if (health && health.current < health.max) {
                    this.drawHealthBar(ctx, sx, sy + bounceY/this.VP.S, health.current / health.max);
                }
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
