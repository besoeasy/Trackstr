/**
 * Trackstr Nostr Event Definitions and Builders
 * Strictly follows the schema in AGENTS.md
 */

import { buildDTag } from '../../utils/contentId.js'

export const KINDS = {
  METADATA: 0,
  CONTACTS: 3,
  DELETION: 5,
  RATING: 35400,
  STATUS: 35402,
  MEDIA_METADATA: 35403,
  REVIEW: 5401,
  ACTIVITY_LOG: 5402,
}

export const APP_ID = 'web'

/**
 * Builds base media tags common to all Trackstr events
 * @param {Object} media
 * @param {string} media.contentId
 * @param {'movie'|'show'|'music'|'episode'} media.type
 * @param {string} media.name
 * @param {string|number} media.year
 * @param {string|number} [media.season]
 * @param {string|number} [media.episode]
 * @returns {Array<[string, string]>}
 */
export function buildBaseMediaTags(media) {
  const tags = [
    ['trackstr', APP_ID],
    ['contentid', media.contentId],
    ['type', media.type],
    ['name', media.name || ''],
    ['year', String(media.year || '')],
  ]

  if (media.type === 'episode' || (media.season !== undefined && media.episode !== undefined)) {
    if (media.season !== undefined && media.season !== null) {
      tags.push(['season', String(media.season)])
    }
    if (media.episode !== undefined && media.episode !== null) {
      tags.push(['episode', String(media.episode)])
    }
  }

  return tags
}

/**
 * Builds a Mutable Rating Event (kind: 35400)
 * @param {Object} media
 * @param {number|string} rating 1 to 10 scale
 * @param {string} [content] Optional note/json
 * @returns {Object} Unsigned event template
 */
export function buildRatingEvent(media, rating, content = '') {
  const dTag = buildDTag({
    contentId: media.contentId,
    season: media.season,
    episode: media.episode,
  })

  const tags = [
    ['d', dTag],
    ...buildBaseMediaTags(media),
    ['rating', String(rating)],
  ]

  return {
    kind: KINDS.RATING,
    created_at: Math.floor(Date.now() / 1000),
    tags,
    content: content || '',
  }
}

/**
 * Builds a Mutable Status Event (kind: 35402)
 * @param {Object} media
 * @param {string} status 'plan-to-watch'|'watching'|'completed'|'on-hold'|'dropped'|'listening'|'plan-to-listen'
 * @param {string} [progress] Optional progress info (e.g. 's1e4')
 * @param {string} [content] Optional JSON/detail
 * @returns {Object} Unsigned event template
 */
export function buildStatusEvent(media, status, progress = '', content = '') {
  const dTag = buildDTag({
    contentId: media.contentId,
    season: media.season,
    episode: media.episode,
  })

  const tags = [
    ['d', dTag],
    ...buildBaseMediaTags(media),
    ['status', status],
  ]

  if (progress) {
    tags.push(['progress', String(progress)])
  }

  return {
    kind: KINDS.STATUS,
    created_at: Math.floor(Date.now() / 1000),
    tags,
    content: content || '',
  }
}

/**
 * Builds a Community Media Metadata Event (kind: 35403)
 * @param {Object} media
 * @param {Object} metadata
 * @param {string} [metadata.poster] ipfs://<CID>
 * @param {string} [metadata.banner] ipfs://<CID>
 * @param {string[]} [metadata.genres]
 * @param {string} [metadata.lang='en']
 * @param {string} [metadata.overview] Synopsis or JSON
 * @returns {Object} Unsigned event template
 */
export function buildMediaMetadataEvent(media, metadata = {}) {
  const tags = [
    ['d', media.contentId],
    ...buildBaseMediaTags(media),
  ]

  if (metadata.poster) {
    tags.push(['poster', metadata.poster])
  }
  if (metadata.banner) {
    tags.push(['banner', metadata.banner])
  }
  if (Array.isArray(metadata.genres)) {
    metadata.genres.forEach((genre) => {
      if (genre) tags.push(['genre', genre])
    })
  }
  tags.push(['lang', metadata.lang || 'en'])

  return {
    kind: KINDS.MEDIA_METADATA,
    created_at: Math.floor(Date.now() / 1000),
    tags,
    content: metadata.overview || '',
  }
}

/**
 * Builds an Immutable Review Event (kind: 5401)
 * Permanent historical diary entry - NO expiration tag
 * @param {Object} media
 * @param {string} body Review text
 * @param {Object} [options]
 * @param {number|string} [options.rating] Optional rating at time of review
 * @param {boolean} [options.spoiler] Whether contains spoilers
 * @returns {Object} Unsigned event template
 */
export function buildReviewEvent(media, body, options = {}) {
  const tags = [
    ['d', media.contentId], // Relay-indexed lookup tag (#d)
    ...buildBaseMediaTags(media),
  ]

  if (options.rating !== undefined && options.rating !== null && options.rating !== '') {
    tags.push(['rating', String(options.rating)])
  }
  if (options.spoiler) {
    tags.push(['spoiler', '1'])
  }

  return {
    kind: KINDS.REVIEW,
    created_at: Math.floor(Date.now() / 1000),
    tags,
    content: body || '',
  }
}

/**
 * Builds an Immutable Activity Log / Scrobble / Check-in Event (kind: 5402)
 * Permanent historical diary entry - NO expiration tag
 * @param {Object} media
 * @param {string} status 'watching'|'completed'|'listening'
 * @param {string} [progress] Optional progress
 * @param {string} [content] Optional note
 * @returns {Object} Unsigned event template
 */
export function buildActivityLogEvent(media, status, progress = '', content = '') {
  const tags = [
    ['d', media.contentId], // Relay-indexed lookup tag (#d)
    ...buildBaseMediaTags(media),
    ['status', status],
  ]

  if (progress) {
    tags.push(['progress', String(progress)])
  }

  return {
    kind: KINDS.ACTIVITY_LOG,
    created_at: Math.floor(Date.now() / 1000),
    tags,
    content: content || '',
  }
}

/**
 * Builds a standard NIP-09 Deletion Event (kind: 5)
 * @param {Object} target
 * @param {string} [target.eventId] For regular events (5401, 5402)
 * @param {string} [target.coordinate] For parameterized replaceable events: "<kind>:<pubkey>:<d-tag>"
 * @param {string} [target.reason]
 * @returns {Object} Unsigned event template
 */
export function buildDeletionEvent({ eventId, coordinate, reason = 'Deleted by user' }) {
  const tags = []
  if (eventId) {
    tags.push(['e', eventId])
  }
  if (coordinate) {
    tags.push(['a', coordinate])
  }

  return {
    kind: KINDS.DELETION,
    created_at: Math.floor(Date.now() / 1000),
    tags,
    content: reason,
  }
}
