/**
 * Trackstr Relay Configuration
 */

export const DEFAULT_RELAYS = [
  'wss://relay.primal.net',
  'wss://nos.lol',
  'wss://relay.snort.social',
  'wss://purplerelay.com',
]

const STORAGE_KEY = 'trackstr_relays'

/**
 * Gets configured relays (custom or default)
 * @returns {string[]}
 */
export function getRelays() {
  try {
    const saved = localStorage.getItem(STORAGE_KEY)
    if (saved) {
      let parsed = JSON.parse(saved)
      if (Array.isArray(parsed) && parsed.length > 0) {
        // Automatically migrate users away from down/503 damus.io default
        if (parsed[0] === 'wss://relay.damus.io') {
          parsed = parsed.filter((r) => r !== 'wss://relay.damus.io')
          if (!parsed.includes('wss://relay.snort.social')) {
            parsed.push('wss://relay.snort.social')
          }
          saveRelays(parsed)
        }
        return parsed
      }
    }
  } catch (e) {
    console.warn('Failed to parse saved relays:', e)
  }
  return [...DEFAULT_RELAYS]
}

/**
 * Saves relays to localStorage
 * @param {string[]} relays
 */
export function saveRelays(relays) {
  try {
    const unique = Array.from(new Set(relays.map((r) => r.trim()).filter(Boolean)))
    localStorage.setItem(STORAGE_KEY, JSON.stringify(unique))
  } catch (e) {
    console.error('Failed to save relays:', e)
  }
}

/**
 * Resets relays to default list
 * @returns {string[]}
 */
export function resetRelays() {
  localStorage.removeItem(STORAGE_KEY)
  return [...DEFAULT_RELAYS]
}
