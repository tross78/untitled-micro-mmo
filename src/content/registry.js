// @ts-check

/**
 * @template {{ id: string }} T
 */
export class Registry {
  /**
   * @param {string} name
   */
  constructor(name) {
    this.name = name;
    /** @type {Map<string, T>} */
    this.entries = new Map();
  }

  /**
   * @param {T[]} entries
   */
  registerAll(entries) {
    for (const entry of entries) {
      if (this.entries.has(entry.id)) {
        throw new Error(`[Registry:${this.name}] Duplicate id "${entry.id}"`);
      }
      this.entries.set(entry.id, entry);
    }
    return this;
  }

  /**
   * @param {string} id
   */
  get(id) {
    return this.entries.get(id);
  }

  all() {
    return Array.from(this.entries.values());
  }

  toObject() {
    return Object.fromEntries(this.entries.entries());
  }
}
