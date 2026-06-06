// @ts-check

import { Component } from '../domain/components.js';
import { generateCharacterSprite, applyPalette, getGrayscaleTemplate, getCompiledAssetMeta, getSpriteBounds, PALETTES, getSceneryPalette, isIndexedAsset, getIndexedTemplate } from '../graphics/graphics.js';

const NPC_WALK_SPRITES = new Set(['guard']);
const NPC_IDLE_SPRITES = new Set(['barkeep', 'merchant', 'herbalist', 'bard', 'sage']);

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

    invalidate() {
        this.spriteCache.clear();
    }

    /**
     * @param {CanvasRenderingContext2D} ctx
     * @param {number} camX
     * @param {number} camY
     * @param {number} screenOffsetX
     * @param {number} screenOffsetY
     * @param {number} gameTime - Monotonic game time in seconds from the loop
     */
    draw(ctx, camX, camY, screenOffsetX = 0, screenOffsetY = 0, gameTime = 0) {
        const entities = this.world.query([Component.Transform, Component.Sprite]);

        // Cap cache growth (Phase 8.76 P0)
        if (this.spriteCache.size > 64) {
            const firstKey = this.spriteCache.keys().next().value;
            this.spriteCache.delete(firstKey);
        }

        for (const id of entities) {
            const transform = this.world.getComponent(id, Component.Transform);
            const spriteDef = this.world.getComponent(id, Component.Sprite);
            const tween = this.world.getComponent(id, Component.Tweenable);
            const health = this.world.getComponent(id, Component.Health);
            const fx = this.world.getComponent(id, Component.VisualEffect);
            const attack = this.world.getComponent(id, Component.AttackAnimation);

            let drawX = transform.x;
            let drawY = transform.y;
            let walkPose = { legOffset: 0, bodyY: 0 };

            // Apply Tweening & Animation (Zelda-style) — ease-out quad for snappy feel
            if (tween) {
                const t = 1 - (1 - tween.progress) * (1 - tween.progress); // ease-out quad
                drawX = tween.startX + (tween.targetX - tween.startX) * t;
                drawY = tween.startY + (tween.targetY - tween.startY) * t;
                if (spriteDef.palette !== 'enemy') {
                    // Snap to integer pixels — fractional coords anti-alias pixel art and cause visible tearing
                    const bounceAmp = Math.max(2, Math.floor(this.VP.S * 0.06));
                    const bodyY = Math.round(Math.abs(Math.sin(gameTime * Math.PI * 3.5)) * bounceAmp);
                    walkPose = { legOffset: 0, bodyY };
                }
            } else if (NPC_IDLE_SPRITES.has(spriteDef.type)) {
                // Minimal bob — just 1px at any scale, keeps feet grounded
                walkPose = { legOffset: 0, bodyY: Math.round(Math.abs(Math.sin(gameTime * 1.0))) };
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

            // Floor to integer pixels — camera follows the player tween so sx/sy are floats.
            // Drawing pixel art at fractional screen coords anti-aliases across rows and causes the
            // "torn feet" visual (body and legs at different sub-pixel offsets).
            const pxX = Math.floor(screenOffsetX + sx * this.VP.S);
            const pxY = Math.floor(screenOffsetY + sy * this.VP.S);
            const bounceY = walkPose.bodyY; // already an integer (Math.round)

            // 1. Draw Drop Shadow
            ctx.fillStyle = 'rgba(0,0,0,0.3)';
            ctx.beginPath();
            ctx.ellipse(
                pxX + this.VP.S / 2,
                pxY + this.VP.S - 2,
                this.VP.S / 3,
                this.VP.S / 8,
                0, 0, Math.PI * 2
            );
            ctx.fill();

            // 2. Pick Sprite Template based on Facing
            const facing = transform.facing || 's';
            let variant = spriteDef.type;
            if (spriteDef.type === 'player' || spriteDef.type === 'peer') {
                const isHurt = fx?.type === 'hit_flash';
                const isAttacking = !!attack;

                if (isHurt) {
                    variant = 'player_hurt';
                } else if (isAttacking) {
                    if (attack.dir === 'n') variant = 'player_attack_back';
                    else if (attack.dir === 'e' || attack.dir === 'w') variant = 'player_attack_side';
                    else variant = 'player_attack';
                } else if (facing === 'n') variant = 'player_back';
                else if (facing === 'e' || facing === 'w') variant = 'player_side';
                else variant = 'player';
            }

            // Directional variants for guards
            if (NPC_WALK_SPRITES.has(spriteDef.type)) {
                if (facing === 'n') variant = 'guard_back';
                else if (facing === 'e' || facing === 'w') variant = 'guard_side';
                else variant = 'guard';
            }

            // Directional + attack variants for enemies
            if (spriteDef.palette === 'enemy') {
                const base = spriteDef.type;
                if (attack) {
                    variant = `${base}_attack`;
                } else if (facing === 'n') {
                    variant = `${base}_back`;
                } else if (facing === 'e' || facing === 'w') {
                    variant = `${base}_side`;
                } else {
                    variant = base;
                }
            }

            // Phase 8.76 P3: Animation frame cycling
            const meta = getCompiledAssetMeta(variant);
            let frameIdx = 0;
            if (meta?.frames?.length > 1 && meta.frameRate) {
                if (spriteDef.type === 'player' || spriteDef.type === 'peer') {
                    frameIdx = tween ? Math.floor(gameTime * meta.frameRate) % meta.frames.length : 0;
                } else if (NPC_WALK_SPRITES.has(spriteDef.type)) {
                    frameIdx = tween ? Math.floor(gameTime * meta.frameRate) % meta.frames.length : 0;
                } else if (NPC_IDLE_SPRITES.has(spriteDef.type)) {
                    frameIdx = Math.floor(gameTime * meta.frameRate) % meta.frames.length;
                } else {
                frameIdx = Math.floor(gameTime * meta.frameRate) % meta.frames.length;
                }
            }

            // 3. Draw Sprite
            const sprite = this.getSprite(spriteDef.seed, spriteDef.palette, variant, frameIdx);
            const spriteBounds = getSpriteBounds(variant, frameIdx);
            // Every character with known bounds draws at the uniform tile scale (S/16 per source
            // pixel) so player, peers, NPCs, and enemies share the same square "block" pixels as the
            // tiles and scenery — no per-type squish. Enemies keep a minimum size so small/short
            // sprites stay readable. Sprites without bounds fall back to the legacy tile-fit draw.
            let drawW, drawH;
            if (spriteBounds) {
                const isEnemy = spriteDef.palette === 'enemy';
                const natW = Math.floor(this.VP.S * (spriteBounds.sourceWidth / spriteBounds.canvasWidth));
                const natH = Math.floor(this.VP.S * (spriteBounds.sourceHeight / spriteBounds.canvasHeight));
                drawW = isEnemy ? Math.max(Math.floor(this.VP.S * 0.42), natW) : natW;
                drawH = isEnemy ? Math.max(Math.floor(this.VP.S * 0.62), natH) : natH;
            } else {
                drawW = Math.floor(this.VP.S * 0.7);
                drawH = this.VP.S;
            }
            const drawLeft = Math.floor((this.VP.S - drawW) / 2);
            const drawTop = pxY + bounceY + (this.VP.S - drawH);

            ctx.save();
            // Stale peers (presence dropped past the stale threshold but still tracked)
            // render dim so the player can tell they're out of comms, not gone.
            if (spriteDef.stale) ctx.globalAlpha = 0.4;
            if (facing === 'w') {
                ctx.translate(pxX + this.VP.S, 0);
                ctx.scale(-1, 1);
                if (spriteBounds) {
                    ctx.drawImage(sprite, spriteBounds.sourceX, spriteBounds.sourceY, spriteBounds.sourceWidth, spriteBounds.sourceHeight, drawLeft, drawTop, drawW, drawH);
                } else {
                    ctx.drawImage(sprite, drawLeft, drawTop, drawW, drawH);
                }
            } else {
                if (spriteBounds) {
                    ctx.drawImage(sprite, spriteBounds.sourceX, spriteBounds.sourceY, spriteBounds.sourceWidth, spriteBounds.sourceHeight, pxX + drawLeft, drawTop, drawW, drawH);
                } else {
                    ctx.drawImage(sprite, pxX + drawLeft, drawTop, drawW, drawH);
                }
            }

            // 4. Combat Effects (Phase 8.1)
            if (fx && fx.type === 'hit_flash') {
                ctx.globalCompositeOperation = 'source-atop';
                ctx.fillStyle = 'rgba(255,255,255,0.8)';
                const flashX = facing === 'w' ? drawLeft : pxX + drawLeft;
                ctx.fillRect(flashX, drawTop, drawW, drawH);
            }
            ctx.restore();

            // 5. Attack Swipe
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
                ctx.fillText('You', pxX + this.VP.S / 2, pxY + bounceY);

                // Selection indicator
                ctx.strokeStyle = '#00ff44';
                ctx.lineWidth = 2;
                ctx.strokeRect(pxX + 1, pxY + bounceY + 1, this.VP.S - 2, this.VP.S - 2);
            } else {
                if (spriteDef.stale) ctx.fillStyle = '#888';
                else ctx.fillStyle = spriteDef.palette === 'enemy' ? '#ff4444' : '#00aaff';
                ctx.fillText(name, pxX + this.VP.S / 2, pxY + bounceY);

                // Health Bar (for enemies)
                if (health && health.current < health.max) {
                    this.drawHealthBar(ctx, sx, sy + bounceY / this.VP.S, health.current / health.max, screenOffsetX, screenOffsetY);
                }
            }
        }
    }

    getSprite(seed, palette, type = null, frameIdx = 0) {
        const key = `${seed}:${palette}:${type}:${frameIdx}`;
        if (this.spriteCache.has(key)) return this.spriteCache.get(key);

        let palKey = palette;
        if (palette === 'peer') {
            let h = 0;
            const s = String(seed);
            for (let i = 0; i < s.length; i++) h = (Math.imul(h, 31) + s.charCodeAt(i)) >>> 0;
            palKey = `peer${h % 6}`;
        } else if (typeof palette === 'string' && palette.startsWith('resource:') && type) {
            palKey = null;
        } else if (palette === 'enemy' && type) {
            // Use per-enemy palette when available for visual distinctiveness
            const specific = `enemy_${type}`;
            if (PALETTES[specific]) palKey = specific;
        }
        const pal = palKey
            ? (PALETTES[palKey] || PALETTES.peer)
            : getSceneryPalette(type) || PALETTES.peer;

        // Authored multi-slot asset — colors baked, bypass the 5-role recolor.
        let indexedCanvas = type && isIndexedAsset(type) ? getIndexedTemplate(type, frameIdx) : null;

        // Use type override if provided (for directional posing)
        let template = null;
        if (!indexedCanvas) {
            if (type) {
                template = getGrayscaleTemplate(type, seed, frameIdx);
            } else {
                // Standard detection if no override
                let sType = null;
                if (palette === 'self' || palette === 'peer') sType = 'player';
                else if (palette === 'enemy') sType = 'wolf';
                else if (palette === 'npc') sType = 'guard';

                if (sType) template = getGrayscaleTemplate(sType, seed, frameIdx);
            }
        }

        const canvas = indexedCanvas || (template ? applyPalette(template, pal) : generateCharacterSprite(seed, palette));
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
        const centerLen = S * 0.9 * (1 - progress * 0.25);
        const flankLen = S * 0.7 * (1 - progress * 0.25);
        const angleMap = { s: Math.PI / 2, n: -Math.PI / 2, e: 0, w: Math.PI };
        const baseAngle = angleMap[dir] || 0;
        const swing = [0, Math.PI / 12, -Math.PI / 12];
        const lengths = [centerLen, flankLen, flankLen];
        const widths = [2, 1, 1];

        swing.forEach((offset, idx) => {
            const angle = baseAngle + offset;
            const length = lengths[idx];
            const startX = cx + Math.cos(angle) * (S * 0.18);
            const startY = cy + Math.sin(angle) * (S * 0.18);
            const endX = startX + Math.cos(angle) * length;
            const endY = startY + Math.sin(angle) * length;

            ctx.beginPath();
            ctx.strokeStyle = `rgba(255,255,180,${1 - progress})`;
            ctx.lineWidth = widths[idx];
            ctx.moveTo(startX, startY);
            ctx.lineTo(endX, endY);
            ctx.stroke();
        });
    }
}
