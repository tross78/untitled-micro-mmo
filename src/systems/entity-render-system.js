// @ts-check

import { Component } from '../domain/components.js';
import { generateCharacterSprite, getWalkPose, applyPalette, getGrayscaleTemplate, PALETTES } from '../graphics/graphics.js';

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
    draw(ctx, camX, camY, screenOffsetX = 0, screenOffsetY = 0) {
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

            // Apply Bump Offset (Juice Phase 8.5a)
            const bump = this.world.getComponent(id, Component.CollisionBump);
            if (bump) {
                const amp = 0.15; // 15% of a tile
                const shift = Math.sin(bump.progress * Math.PI) * amp;
                if (bump.dir === 'e') drawX += shift;
                else if (bump.dir === 'w') drawX -= shift;
                else if (bump.dir === 's') drawY += shift;
                else if (bump.dir === 'n') drawY -= shift;
            }

            const sx = drawX - camX;
            const sy = drawY - camY;

            // Viewport culling
            if (sx < -1 || sx >= this.VP.W || sy < -1 || sy >= this.VP.H) continue;

            // 1. Draw Drop Shadow
            ctx.fillStyle = 'rgba(0,0,0,0.3)';
            ctx.beginPath();
            ctx.ellipse(
                screenOffsetX + sx * this.VP.S + this.VP.S / 2, 
                screenOffsetY + sy * this.VP.S + this.VP.S - 2, 
                this.VP.S / 3, 
                this.VP.S / 8, 
                0, 0, Math.PI * 2
            );
            ctx.fill();

            // 2. Pick Sprite Template based on Facing
            const facing = transform.facing || 's';
            let variant = spriteDef.type;
            if (spriteDef.type === 'player' || spriteDef.type === 'peer') {
                if (facing === 'n') variant = 'player_back';
                else if (facing === 'e' || facing === 'w') variant = 'player_side';
                else variant = 'player';
            }

            // 3. Draw Sprite
            const sprite = this.getSprite(spriteDef.seed, spriteDef.palette, variant);
            const bounceY = walkPose.bodyY;
            
            ctx.save();
            if (facing === 'w') {
                // Flip horizontally
                ctx.translate(screenOffsetX + sx * this.VP.S + this.VP.S, 0);
                ctx.scale(-1, 1);
                ctx.drawImage(sprite, Math.floor(this.VP.S * 0.15), screenOffsetY + sy * this.VP.S + bounceY, Math.floor(this.VP.S * 0.7), this.VP.S);
            } else {
                ctx.drawImage(sprite, screenOffsetX + sx * this.VP.S + Math.floor(this.VP.S * 0.15), screenOffsetY + sy * this.VP.S + bounceY, Math.floor(this.VP.S * 0.7), this.VP.S);
            }

            // 4. Combat Effects (Phase 8.1)
            const fx = this.world.getComponent(id, Component.VisualEffect);
            if (fx && fx.type === 'hit_flash') {
                ctx.globalCompositeOperation = 'source-atop';
                ctx.fillStyle = 'rgba(255,255,255,0.8)';
                // Use same coordinate space as the sprite draw above — the flip
                // transform is still active here, so west-facing must use the same
                // inset x as the drawImage call, not screen-space screenOffsetX.
                const flashX = facing === 'w'
                    ? Math.floor(this.VP.S * 0.15)
                    : screenOffsetX + sx * this.VP.S + Math.floor(this.VP.S * 0.15);
                ctx.fillRect(flashX, screenOffsetY + sy * this.VP.S + bounceY, Math.floor(this.VP.S * 0.7), this.VP.S);
            }
            ctx.restore();

            // 5. Attack Swipe
            const attack = this.world.getComponent(id, Component.AttackAnimation);
            if (attack) {
                this.drawAttackSwipe(ctx, sx, sy, attack.dir, attack.progress, screenOffsetX, screenOffsetY);
            }

            // Name Label
            ctx.font = `${Math.floor(this.VP.S * 0.28)}px monospace`;
            ctx.textAlign = 'center';
            ctx.textBaseline = 'bottom';
            
            const identity = this.world.getComponent(id, 'Identity');
            const name = identity?.name || '???';

            if (this.world.getComponent(id, Component.PlayerControlled)) {
                ctx.fillStyle = '#00ff44';
                ctx.fillText('You', screenOffsetX + sx * this.VP.S + this.VP.S / 2, screenOffsetY + sy * this.VP.S + bounceY);
                
                // Selection indicator
                ctx.strokeStyle = '#00ff44';
                ctx.lineWidth = 2;
                ctx.strokeRect(screenOffsetX + sx * this.VP.S + 1, screenOffsetY + sy * this.VP.S + bounceY + 1, this.VP.S - 2, this.VP.S - 2);
            } else {
                ctx.fillStyle = spriteDef.palette === 'enemy' ? '#ff4444' : '#00aaff';
                ctx.fillText(name, screenOffsetX + sx * this.VP.S + this.VP.S / 2, screenOffsetY + sy * this.VP.S + bounceY);

                // Health Bar (for enemies)
                if (health && health.current < health.max) {
                    this.drawHealthBar(ctx, sx, sy + bounceY/this.VP.S, health.current / health.max, screenOffsetX, screenOffsetY);
                }
            }
        }
    }

    getSprite(seed, palette, type = null) {
        const key = `${seed}:${palette}:${type}`;
        if (this.spriteCache.has(key)) return this.spriteCache.get(key);
        
        let palKey = palette;
        if (palette === 'peer') {
            let h = 0;
            const s = String(seed);
            for (let i = 0; i < s.length; i++) h = (Math.imul(h, 31) + s.charCodeAt(i)) >>> 0;
            palKey = `peer${h % 6}`;
        }
        const pal = PALETTES[palKey] || PALETTES.peer;

        // Use type override if provided (for directional posing)
        let template = null;
        if (type) {
            template = getGrayscaleTemplate(type, seed);
        } else {
            // Standard detection if no override
            let sType = null;
            if (palette === 'self' || palette === 'peer') sType = 'player';
            else if (palette === 'enemy') sType = 'wolf';
            else if (palette === 'npc') sType = 'guard';

            if (sType) template = getGrayscaleTemplate(sType, seed);
        }

        const canvas = template ? applyPalette(template, pal) : generateCharacterSprite(seed, palette);
        this.spriteCache.set(key, canvas);
        return canvas;
    }

    drawHealthBar(ctx, sx, sy, pct, screenOffsetX = 0, screenOffsetY = 0) {
        const bw = this.VP.S - 4;
        const x = screenOffsetX + sx * this.VP.S + 2;
        const y = screenOffsetY + sy * this.VP.S - 5;
        ctx.fillStyle = '#440000';
        ctx.fillRect(x, y, bw, 3);
        ctx.fillStyle = pct > 0.5 ? '#00cc00' : pct > 0.25 ? '#aaaa00' : '#cc0000';
        ctx.fillRect(x, y, Math.round(bw * pct), 3);
    }

    drawAttackSwipe(ctx, sx, sy, dir, progress, screenOffsetX = 0, screenOffsetY = 0) {
        const S = this.VP.S;
        const cx = screenOffsetX + sx * S + S / 2;
        const cy = screenOffsetY + sy * S + S / 2;
        const radius = S * 0.8;
        
        ctx.beginPath();
        ctx.strokeStyle = `rgba(255,255,255,${1 - progress})`;
        ctx.lineWidth = 3;
        
        const startAngles = { 's': 0, 'n': Math.PI, 'e': -Math.PI/2, 'w': Math.PI/2 };
        const start = startAngles[dir] || 0;
        const arc = Math.PI * 0.8;
        
        ctx.arc(cx, cy, radius, start - arc/2 + (progress * arc), start + arc/2);
        ctx.stroke();
    }
}
