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
        this.targetWeather = null;   // weather we are fading in
        this.previousWeather = null; // weather we are fading out
        this.previousAlpha = 0;      // current fade-out alpha for previousWeather

        // Phase 8.76: Precomputed fog alpha palette to avoid thousands of string allocations per frame
        this._fogPalette = [];
        for (let i = 0; i <= 100; i++) {
            this._fogPalette.push(`rgba(210, 225, 235, ${(i / 100).toFixed(3)})`);
        }
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
            // Capture the outgoing weather and its current alpha for fade-out
            this.previousWeather = this.targetWeather;
            this.previousAlpha = this.overlayAlpha;
            this.targetWeather = weather;
            this.overlayAlpha = 0;
        }

        if (this.overlayAlpha < 1) {
            this.overlayAlpha = Math.min(1, this.overlayAlpha + 1 / 90);
        }

        const topY = this.VP.topChrome ?? 0;

        // Fade out the previous weather while fading in the new one
        if (this.previousWeather && this.previousAlpha > 0) {
            this.previousAlpha = Math.max(0, this.previousAlpha - 1 / 90);
            if (this.previousWeather === 'storm') {
                this.drawStorm(ctx, this.previousAlpha, gameTime, topY);
            } else if (this.previousWeather === 'fog') {
                this.drawFog(ctx, room.zone, this.previousAlpha, gameTime, topY);
            }
            if (this.previousAlpha === 0) this.previousWeather = null;
        }

        if (this.targetWeather === 'storm') {
            this.drawStorm(ctx, this.overlayAlpha, gameTime, topY);
        } else if (this.targetWeather === 'fog') {
            this.drawFog(ctx, room.zone, this.overlayAlpha, gameTime, topY);
        }
    }

    drawStorm(ctx, alpha = 1, gameTime = 0, topY = 0) {
        const h = this.VP.CH;
        ctx.fillStyle = `rgba(20, 30, 80, ${0.15 * alpha})`;
        ctx.fillRect(0, topY, this.VP.CW, h);

        if (gameTime % 8 < 0.05) {
            ctx.fillStyle = `rgba(255, 255, 255, ${0.12 * alpha})`;
            ctx.fillRect(0, topY, this.VP.CW, h);
        }

        ctx.strokeStyle = `rgba(200, 220, 255, ${0.55 * alpha})`;
        ctx.lineWidth = 2;
        ctx.beginPath();
        for (let i = 0; i < 80; i++) {
            const offset = i * 137.5;
            const x = (offset + gameTime * 100) % this.VP.CW;
            const y = topY + (offset * 1.5 + gameTime * 500) % h;
            ctx.moveTo(x, y);
            ctx.lineTo(x - 3, y + 6);
        }
        ctx.stroke();
    }

    drawFog(ctx, zone, alpha = 1, gameTime = 0, topY = 0) {
        const maxAlpha = zone === 'wilderness' ? 0.38 : 0.18;
        // 24px patches (vs 12px) halves iteration count with imperceptible quality loss on mobile
        const patch = 24;
        // Only iterate the visible world rows — bottom chrome is clipped and wastes CPU
        const worldH = (this.VP.worldPxH ?? this.VP.CH) + patch;
        for (let row = 0; row < worldH; row += patch) {
            for (let x = 0; x < this.VP.CW; x += patch) {
                // Three incommensurate waves at different speeds/directions — breaks up banding
                const w1 = Math.sin(gameTime * 0.31 + x * 0.071 + row * 0.113);
                const w2 = Math.sin(gameTime * 0.19 - x * 0.053 + row * 0.079 + 2.1);
                const w3 = Math.sin(gameTime * 0.47 + x * 0.097 - row * 0.061 + 4.7);
                // Per-patch static noise via cheap integer hash
                const hash = ((x * 1619 + row * 31337) ^ (x >> 3)) & 0xffff;
                const staticNoise = (hash / 0xffff) * 0.4 - 0.2; // -0.2..+0.2
                const combined = (w1 + w2 + w3) / 3 + staticNoise;
                if (combined <= 0.05) continue;
                const patchAlpha = maxAlpha * alpha * Math.min(1, (combined - 0.05) * 1.5);
                const paletteIdx = Math.min(100, Math.max(0, Math.round(patchAlpha * 100)));
                ctx.fillStyle = this._fogPalette[paletteIdx];
                ctx.fillRect(x, topY + row, patch, patch);
            }
        }
    }
}
