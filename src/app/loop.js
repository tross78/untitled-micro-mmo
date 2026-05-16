// @ts-check

/**
 * A fixed-timestep game loop inspired by Kontra.js and industry standards.
 * Decouples logic updates from rendering frequency.
 */
export class GameLoop {
  /**
   * @param {object} options
   * @param {number} [options.fps=60] - Target updates per second.
   * @param {(dt: number) => void} options.update - Logic update function.
   * @param {(gameTime: number) => void} options.render - Render function.
   */
  constructor({ fps = 60, update, render }) {
    this.fps = fps;
    this.delta = 1 / fps;
    this.update = update;
    this.render = render;

    this.accumulator = 0;
    this.last = 0;
    this.rafId = null;
    this.stopped = true;
    /** Monotonically increasing game time in seconds, advances only on fixed steps */
    this.gameTime = 0;
  }

  start() {
    if (!this.stopped) return;
    this.stopped = false;
    this.last = performance.now();

    // Reset timestamp on tab resume so we don't accumulate a large dt spike.
    this._visHandler = () => {
      if (document.visibilityState === 'visible') this.last = performance.now();
    };
    document.addEventListener('visibilitychange', this._visHandler);

    this.frame = (now) => {
      if (this.stopped) return;
      
      const dt = (now - this.last) / 1000;
      this.last = now;

      // Cap dt to prevent "spiral of death" after long pauses
      const cappedDt = Math.min(dt, 0.25);
      this.accumulator += cappedDt;

      while (this.accumulator >= this.delta) {
        this.update(this.delta);
        this.gameTime += this.delta;
        this.accumulator -= this.delta;
      }

      this.render(this.gameTime);
      this.rafId = requestAnimationFrame(this.frame);
    };
    this.rafId = requestAnimationFrame(this.frame);
  }

  stop() {
    this.stopped = true;
    if (this.rafId) {
      cancelAnimationFrame(this.rafId);
      this.rafId = null;
    }
    if (this._visHandler) {
      document.removeEventListener('visibilitychange', this._visHandler);
      this._visHandler = null;
    }
  }
}
