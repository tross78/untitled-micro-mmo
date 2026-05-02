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
   * @param {() => void} options.render - Render function.
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
  }

  start() {
    if (!this.stopped) return;
    this.stopped = false;
    this.last = performance.now();
    this.frame = (now) => {
      if (this.stopped) return;
      
      const dt = (now - this.last) / 1000;
      this.last = now;

      // Cap dt to prevent "spiral of death" after long pauses
      const cappedDt = Math.min(dt, 0.25);
      this.accumulator += cappedDt;

      while (this.accumulator >= this.delta) {
        this.update(this.delta);
        this.accumulator -= this.delta;
      }

      this.render();
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
  }
}
