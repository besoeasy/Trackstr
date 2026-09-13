/**
 * Crash-safe web storage wrapper.
 * localStorage throws in SSR, private mode, or when quota is exceeded —
 * never let a theme/episode read crash the app.
 */

const memoryFallback = new Map()

function getBackend() {
  try {
    if (typeof window !== 'undefined' && window.localStorage) return window.localStorage
    if (typeof globalThis !== 'undefined' && globalThis.localStorage) return globalThis.localStorage
  } catch {}
  return null
}

export const safeStorage = {
  getItem(key) {
    const backend = getBackend()
    try {
      if (backend) return backend.getItem(key)
    } catch {}
    return memoryFallback.has(key) ? memoryFallback.get(key) : null
  },
  setItem(key, value) {
    const backend = getBackend()
    try {
      if (backend) {
        backend.setItem(key, String(value))
        return true
      }
    } catch {}
    try {
      memoryFallback.set(key, String(value))
      return true
    } catch {
      return false
    }
  },
  removeItem(key) {
    const backend = getBackend()
    try {
      if (backend) backend.removeItem(key)
    } catch {}
    memoryFallback.delete(key)
  },
  clear() {
    const backend = getBackend()
    try {
      if (backend) backend.clear()
    } catch {}
    memoryFallback.clear()
  },
}
