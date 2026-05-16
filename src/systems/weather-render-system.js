// @ts-check

import { world as worldData } from '../content/data.js';

/**
 * WeatherRenderSystem draws storm and fog overlays based on worldState.weather.
 */
export class WeatherRenderSystem {
    /**
     * @param {object} vp - Viewport metrics
     */
    constructor(vp) {
        this.VP = vp;
        this.overlayAlpha = 0;
        this.currentWeather = null; // weather currently being shown at full alpha
        this.targetWeather = null;  // weather we are transitioning toward
    }

    /**
     * @param {CanvasRenderingContext2D} ctx
     * @param {object} worldState
     * @param {string} roomId
     * @param {number} gameTime - Monotonic game time in seconds from the loop
     */
    draw(ctx, worldState, roomId, gameTime = 0) {
        const room = worldData[roomId];
        if (!room || room.zone === 'town' || room.zone === 'interior' || room.zone === 'dungeon') return;

        const weather = worldState.weather || 'clear';

        if (weather !== this.targetWeather) {
            // New target — reset alpha so we fade in from 0
            this.targetWeather = weather;
            this.overlayAlpha = 0;
        }

        if (this.overlayAlpha < 1) {
            this.overlayAlpha = Math.min(1, this.overlayAlpha + 1 / 90);
        }

        if (this.targetWeather === 'storm') {
            this.drawStorm(ctx, this.overlayAlpha, gameTime);
        } else if (this.targetWeather === 'fog') {
            this.drawFog(ctx, room.zone, this.overlayAlpha, gameTime);
        }
    }

    drawStorm(ctx, alpha = 1, gameTime = 0) {
        // Dark blue tint
        ctx.fillStyle = `rgba(20, 30, 80, ${0.15 * alpha})`;
        ctx.fillRect(0, 0, this.VP.CW, this.VP.CH);

        if (gameTime % 8 < 0.05) {
            ctx.fillStyle = `rgba(255, 255, 255, ${0.12 * alpha})`;
            ctx.fillRect(0, 0, this.VP.CW, this.VP.CH);
        }

        // Rain streaks — scroll position driven by game time, not wall clock
        ctx.strokeStyle = `rgba(200, 220, 255, ${0.55 * alpha})`;
        ctx.lineWidth = 2;
        ctx.beginPath();
        for (let i = 0; i < 80; i++) {
            const offset = i * 137.5; // Golden angle-ish distribution
            const x = (offset + gameTime * 100) % this.VP.CW;
            const y = (offset * 1.5 + gameTime * 500) % this.VP.CH;

            ctx.moveTo(x, y);
            ctx.lineTo(x - 3, y + 6); // 30 degree diagonal
        }
        ctx.stroke();
    }

    drawFog(ctx, zone, alpha = 1, gameTime = 0) {
        const maxAlpha = zone === 'wilderness' ? 0.4 : 0.2;
        const pulse = Math.sin(gameTime / 3) * 0.05;
        const effectiveAlpha = (maxAlpha + pulse) * alpha;
        const patch = 8;
        for (let y = 0; y < this.VP.CH; y += patch) {
            for (let x = 0; x < this.VP.CW; x += patch) {
                const wave = Math.sin(gameTime / 2 + x * 0.06 + y * 0.09);
                const visible = wave > 0.15;
                if (!visible) continue;
                const localAlpha = effectiveAlpha * (0.7 + ((x + y) % 16 === 0 ? 0.2 : 0));
                ctx.fillStyle = `rgba(220, 230, 240, ${localAlpha})`;
                ctx.fillRect(x, y, patch, patch);
            }
        }
    }
}
