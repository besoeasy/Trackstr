/**
 * Shared URL and identity validators.
 * Centralizes trust-boundary checks so no component hand-rolls them.
 */

/**
 * Valid 64-char lowercase/uppercase hex content ID.
 */
export function isValidContentId(value) {
  return typeof value === 'string' && /^[0-9a-f]{64}$/i.test(value)
}

/**
 * Valid 64-char hex Nostr public key.
 */
export function isValidPubkey(value) {
  return typeof value === 'string' && /^[0-9a-f]{64}$/i.test(value)
}

/**
 * Safe for navigation / :href / window.open: http(s) only.
 * Blocks javascript:, data:, vbscript:, file:, blob: etc.
 */
export function isSafeHttpUrl(value) {
  if (typeof value !== 'string') return false
  const v = value.trim()
  if (!v || /\s/.test(v)) return false
  return /^https?:\/\/[^/]+\.[^/]+/i.test(v) || /^https?:\/\/localhost(:\d+)?(\/|$)/i.test(v)
}

/**
 * Safe for <img src> / CSS url(): site-relative or http(s).
 * Blocks javascript:, data:, vbscript:, blob:, file:, ipfs: schemes.
 */
export function isSafeMediaUrl(value) {
  if (typeof value !== 'string') return false
  const v = value.trim()
  if (!v || /\s/.test(v)) return false
  if (/^[a-z0-9+.-]+:/i.test(v)) {
    // Has an explicit scheme: allow only http(s).
    return /^https?:\/\//i.test(v)
  }
  // No scheme: allow site-relative paths only.
  return v.startsWith('/')
}

/**
 * Returns the trimmed URL if safe for media rendering, else ''.
 */
export function safeMediaUrl(value) {
  if (typeof value !== 'string') return ''
  const v = value.trim()
  return isSafeMediaUrl(v) ? v : ''
}

/**
 * Normalizes a relay URL, or returns null when invalid.
 * Requires wss:// (ws:// only for local development hosts).
 */
export function normalizeRelayUrl(value) {
  if (typeof value !== 'string') return null
  const v = value.trim().replace(/\/+$/, '')
  if (!v || /\s/.test(v)) return null
  const match = /^(wss?):\/\/([^/]+)(\/.*)?$/i.exec(v)
  if (!match) return null
  const scheme = match[1].toLowerCase()
  const host = match[2].split('@').pop().split(':')[0].toLowerCase()
  if (scheme === 'ws' && host !== 'localhost' && host !== '127.0.0.1' && host !== '[::1]') {
    return null
  }
  return `${scheme}://${match[2]}${match[3] || ''}`
}
