/**
 * Trackstr formatting utilities
 */
import { nip19 } from 'nostr-tools'

/**
 * Formats a hex pubkey to npub (or short form)
 * @param {string} hex
 * @param {boolean} short
 * @returns {string}
 */
export function formatPubkey(hex, short = true) {
  if (!hex) return ''
  try {
    const npub = nip19.npubEncode(hex)
    if (!short) return npub
    return `${npub.slice(0, 9)}...${npub.slice(-5)}`
  } catch {
    return short ? `${hex.slice(0, 8)}...${hex.slice(-4)}` : hex
  }
}

/**
 * Truncate a CID for display
 * @param {string} cid
 * @returns {string}
 */
export function formatCid(cid) {
  if (!cid) return ''
  if (cid.length <= 16) return cid
  return `${cid.slice(0, 8)}...${cid.slice(-6)}`
}

/**
 * Formats relative time (e.g. '2 hours ago')
 * @param {number|Date} timestamp Unix timestamp in seconds or Date object
 * @returns {string}
 */
export function formatRelativeTime(timestamp) {
  if (!timestamp) return ''
  const unixSec = typeof timestamp === 'number' ? timestamp : Math.floor(timestamp.getTime() / 1000)
  const diffSec = Math.floor(Date.now() / 1000) - unixSec

  if (diffSec < 60) return 'just now'
  if (diffSec < 3600) return `${Math.floor(diffSec / 60)}m ago`
  if (diffSec < 86400) return `${Math.floor(diffSec / 3600)}h ago`
  if (diffSec < 2592000) return `${Math.floor(diffSec / 86400)}d ago`
  return new Date(unixSec * 1000).toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  })
}

/**
 * Formats canonical activity status to human-readable string
 * @param {string} status
 * @returns {string}
 */
export function formatStatus(status) {
  const map = {
    'plan-to-watch': 'Plan to Watch',
    watching: 'Watching',
    completed: 'Completed',
    'on-hold': 'On Hold',
    dropped: 'Dropped',
    'plan-to-listen': 'Plan to Listen',
    listening: 'Listening',
  }
  return map[status] || status || 'Not Tracked'
}

/**
 * Returns color badge class for a status
 * @param {string} status
 * @returns {string}
 */
export function getStatusColorClass(status) {
  switch (status) {
    case 'completed':
      return 'badge-success'
    case 'watching':
    case 'listening':
      return 'badge-primary'
    case 'plan-to-watch':
    case 'plan-to-listen':
      return 'badge-info'
    case 'on-hold':
      return 'badge-warning'
    case 'dropped':
      return 'badge-danger'
    default:
      return 'badge-neutral'
  }
}
