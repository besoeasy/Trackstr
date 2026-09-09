/**
 * Vitest global setup: minimal browser shims for unit tests.
 * Component tests opt into happy-dom per-file via
 * `// @vitest-environment happy-dom`.
 */

class MemoryStorage {
  constructor() {
    this.store = new Map()
  }
  getItem(key) {
    return this.store.has(String(key)) ? this.store.get(String(key)) : null
  }
  setItem(key, value) {
    this.store.set(String(key), String(value))
  }
  removeItem(key) {
    this.store.delete(String(key))
  }
  clear() {
    this.store.clear()
  }
  get length() {
    return this.store.size
  }
  key(index) {
    return [...this.store.keys()][index] ?? null
  }
}

if (typeof globalThis.localStorage === 'undefined') {
  globalThis.localStorage = new MemoryStorage()
}

if (typeof globalThis.window === 'undefined') {
  globalThis.window = undefined
}
