/**
 * Trackstr Relay Configuration
 */
import { normalizeRelayUrl } from '@/utils/urls.js'
import { safeStorage } from '@/utils/storage.js'
import { logger } from '@/utils/logger.js'

export const DEFAULT_RELAYS = [
  'wss://relay.primal.net',
  'wss://nos.lol',
  'wss://relay.snort.social',
  'wss://purplerelay.com',
]

export const MAX_RELAYS = 12

const STORAGE_KEY = 'trackstr_relays'

/**
 * Sanitizes a raw relay list: trims, validates scheme, dedupes
 * (case-insensitive), caps the count.
 * @param {unknown} relays
 * @returns {string[]}
 */
export function sanitizeRelayList(relays) {
  if (!Array.isArray(relays)) return []
  const seen = new Set()
  const out = []
  for (const raw of relays) {
    const clean = normalizeRelayUrl(raw)
    if (!clean) continue
    const key = clean.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    out.push(clean)
    if (out.length >= MAX_RELAYS) break
  }
  return out
}

/**
 * Gets configured relays (custom or default)
 * @returns {string[]}
 */
export function getRelays() {
  try {
    const saved = safeStorage.getItem(STORAGE_KEY)
    if (saved) {
      const parsed = JSON.parse(saved)
      if (Array.isArray(parsed) && parsed.length > 0) {
        const clean = sanitizeRelayList(parsed)
        if (clean.length > 0) {
          return clean
        }
      }
      // Stored value is unusable — purge it so we stop warning every call.
      safeStorage.removeItem(STORAGE_KEY)
    }
  } catch (e) {
    logger.warn('Relays', 'Failed to parse saved relays, resetting to defaults.', e)
    safeStorage.removeItem(STORAGE_KEY)
  }
  return [...DEFAULT_RELAYS]
}

/**
 * Saves relays to localStorage
 * @param {string[]} relays
 */
export function saveRelays(relays) {
  try {
    const unique = sanitizeRelayList(relays)
    safeStorage.setItem(STORAGE_KEY, JSON.stringify(unique))
  } catch (e) {
    logger.error('Relays', 'Failed to save relays.', e)
  }
}

/**
 * Resets relays to default list
 * @returns {string[]}
 */
export function resetRelays() {
  safeStorage.removeItem(STORAGE_KEY)
  return [...DEFAULT_RELAYS]
}
