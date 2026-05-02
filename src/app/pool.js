// @ts-check

/**
 * Generic object pool for performance-critical entities (particles, floating text).
 * Reuses objects to minimize GC pressure.
 */
export class Pool {
  /**
   * @param {object} options
   * @param {() => any} options.create - Factory function for new objects.
   * @param {number} [options.maxSize=1024] - Max number of objects in the pool.
   */
  constructor({ create, maxSize = 1024 }) {
    this.create = create;
    this.maxSize = maxSize;
    this.objects = [];
  }

  /**
   * Get an inactive object from the pool or create a new one.
   * @param {Record<string, any>} [props] - Properties to initialize the object with.
   * @returns {any}
   */
  get(props = {}) {
    let obj = this.objects.find(o => !o.isAlive || !o.isAlive());

    if (!obj && this.objects.length < this.maxSize) {
      obj = this.create();
      this.objects.push(obj);
    }

    if (obj && typeof obj.init === 'function') {
      obj.init(props);
    }

    return obj;
  }

  /**
   * Update all active objects in the pool.
   * @param {number} dt
   */
  update(dt) {
    for (const obj of this.objects) {
      if (!obj.isAlive || obj.isAlive()) {
        if (typeof obj.update === 'function') obj.update(dt);
      }
    }
  }

  /**
   * Render all active objects in the pool.
   */
  render() {
    for (const obj of this.objects) {
      if (!obj.isAlive || obj.isAlive()) {
        if (typeof obj.render === 'function') obj.render();
      }
    }
  }
}
