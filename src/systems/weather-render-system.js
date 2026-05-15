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
        if (!room || room.zone === 'town' || room.zone === 'interior') return;

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
        ctx.fillStyle = `rgba(20, 30, 80, ${0.08 * alpha})`;
        ctx.fillRect(0, 0, this.VP.CW, this.VP.CH);

        // Rain streaks — scroll position driven by game time, not wall clock
        ctx.strokeStyle = `rgba(200, 220, 255, ${0.35 * alpha})`;
        ctx.lineWidth = 1;
        ctx.beginPath();
        for (let i = 0; i < 40; i++) {
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
        const pulse = Math.sin(gameTime * (1000 / 3000)) * 0.05;
        const effectiveAlpha = (maxAlpha + pulse) * alpha;

        const grad = ctx.createRadialGradient(
            this.VP.CW / 2, this.VP.CH / 2, this.VP.CH / 4,
            this.VP.CW / 2, this.VP.CH / 2, this.VP.CH / 1.2
        );
        grad.addColorStop(0, 'rgba(200, 210, 220, 0)');
        grad.addColorStop(1, `rgba(200, 210, 220, ${effectiveAlpha})`);

        ctx.fillStyle = grad;
        ctx.fillRect(0, 0, this.VP.CW, this.VP.CH);
    }
}
