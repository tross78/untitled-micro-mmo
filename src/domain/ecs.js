// @ts-check

/**
 * Minimal hybrid-ECS store. Runtime-only state lives here; canonical save data stays separate.
 */
export class WorldStore {
  constructor() {
    /** @type {number} */
    this.nextId = 1;
    /** @type {Map<string, Map<number, Record<string, unknown>>>} */
    this.components = new Map();
  }

  createEntity() {
    const id = this.nextId;
    this.nextId += 1;
    return id;
  }

  /**
   * @param {number} entityId
   * @param {string} componentName
   * @param {Record<string, unknown>} value
   */
  setComponent(entityId, componentName, value) {
    if (!this.components.has(componentName)) {
      this.components.set(componentName, new Map());
    }
    this.components.get(componentName).set(entityId, value);
  }

  /**
   * @template T
   * @param {number} entityId
   * @param {string} componentName
   * @returns {T | undefined}
   */
  getComponent(entityId, componentName) {
    return /** @type {T | undefined} */ (this.components.get(componentName)?.get(entityId));
  }

  /**
   * @param {string[]} componentNames
   * @returns {number[]}
   */
  query(componentNames) {
    if (componentNames.length === 0) return [];
    const [first, ...rest] = componentNames;
    const seed = this.components.get(first);
    if (!seed) return [];
    return Array.from(seed.keys()).filter((entityId) =>
      rest.every((name) => this.components.get(name)?.has(entityId))
    );
  }

  /**
   * @param {number} entityId
   */
  deleteEntity(entityId) {
    for (const store of this.components.values()) {
      store.delete(entityId);
    }
  }
}
