/**
 * Trackstr Nostr Event Definitions and Builders
 * Strictly follows the schema in AGENTS.md
 */

import { buildDTag, assertContentId } from '../../utils/contentId.js'

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

export const MEDIA_TYPES = ['movie', 'show', 'episode', 'music']
export const VIDEO_STATUSES = ['plan-to-watch', 'watching', 'completed', 'on-hold', 'dropped']
export const MUSIC_STATUSES = ['plan-to-listen', 'listening', 'completed']
export const LOG_STATUSES = ['watching', 'completed', 'listening']

function assertMediaRef(media) {
  assertContentId(media?.contentId)
  if (!MEDIA_TYPES.includes(media?.type)) {
    throw new Error(`Media type must be one of ${MEDIA_TYPES.join(', ')}.`)
  }
  if (!media?.name && !media?.title) {
    throw new Error('Media name/title is required on Nostr events.')
  }
}

function assertRating(rating) {
  const n = Number(rating)
  if (!Number.isFinite(n) || n < 1 || n > 10) {
    throw new Error('Rating must be a number from 1 to 10 (half-steps like 8.5 allowed).')
  }
  return n
}

function assertIpfsUri(value, label) {
  if (!value) return ''
  if (typeof value !== 'string' || !value.startsWith('ipfs://') || value.length <= 'ipfs://'.length) {
    throw new Error(`${label} must be an ipfs://<CID> URI — centralized URLs are not allowed in event tags.`)
  }
  return value
}

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
  assertMediaRef(media)
  const tags = [
    ['trackstr', APP_ID],
    ['contentid', media.contentId.toLowerCase()],
    ['type', media.type],
    ['name', media.name || media.title || ''],
    ['year', String(media.year || '')],
  ]

  // Music identity hashes the artist, so readers must be able to recompute it.
  if (media.type === 'music' && media.artist) {
    tags.push(['artist', String(media.artist)])
  }
  // Collision-split qualifier must travel with the event so others hash identically.
  if (media.qualifier) {
    tags.push(['qualifier', String(media.qualifier)])
  }

  // season + episode travel only on episode-anchored records.
  if (media.type === 'episode') {
    if (media.season === undefined || media.season === null || media.season === '') {
      throw new Error('Episode records require a season number.')
    }
    if (media.episode === undefined || media.episode === null || media.episode === '') {
      throw new Error('Episode records require an episode number.')
    }
    tags.push(['season', String(Number(media.season))])
    tags.push(['episode', String(Number(media.episode))])
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
  assertRating(rating)
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
  const allowed = media?.type === 'music' ? MUSIC_STATUSES : VIDEO_STATUSES
  if (!allowed.includes(status)) {
    throw new Error(`Invalid status "${status}" — allowed: ${allowed.join(', ')}.`)
  }
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
  const dTag = buildDTag({
    contentId: assertContentId(media?.contentId),
    season: media?.season,
    episode: media?.episode,
  })
  const tags = [
    ['d', dTag],
    ...buildBaseMediaTags(media),
  ]

  const poster = assertIpfsUri(metadata.poster, 'Poster')
  const banner = assertIpfsUri(metadata.banner, 'Banner')
  if (poster) {
    tags.push(['poster', poster])
  }
  if (banner) {
    tags.push(['banner', banner])
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
  if (!body || !String(body).trim()) {
    throw new Error('Review body is required.')
  }
  const tags = [
    ['d', assertContentId(media?.contentId)], // Relay-indexed lookup tag (#d)
    ...buildBaseMediaTags(media),
  ]

  if (options.rating !== undefined && options.rating !== null && options.rating !== '') {
    tags.push(['rating', String(assertRating(options.rating))])
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
  if (!LOG_STATUSES.includes(status)) {
    throw new Error(`Invalid log status "${status}" — allowed: ${LOG_STATUSES.join(', ')}.`)
  }
  const tags = [
    ['d', assertContentId(media?.contentId)], // Relay-indexed lookup tag (#d)
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
  if ((eventId && coordinate) || (!eventId && !coordinate)) {
    throw new Error('Deletion requires exactly one of eventId (regular kinds) or coordinate (NIP-33 kinds).')
  }
  const tags = []
  if (eventId) {
    if (!/^[0-9a-f]{64}$/i.test(eventId)) {
      throw new Error('Deletion eventId must be a 64-hex event ID.')
    }
    tags.push(['e', eventId])
  }
  if (coordinate) {
    // "<kind>:<pubkey>:<d-tag>" — d-tag itself may contain colons (episode suffix).
    const parts = String(coordinate).split(':')
    const [kind, pubkey, ...dParts] = parts
    const dTag = dParts.join(':')
    if (!/^\d+$/.test(kind || '') || !/^[0-9a-f]{64}$/i.test(pubkey || '') || !dTag) {
      throw new Error('Deletion coordinate must look like "<kind>:<64-hex pubkey>:<d-tag>".')
    }
    tags.push(['a', coordinate])
  }

  return {
    kind: KINDS.DELETION,
    created_at: Math.floor(Date.now() / 1000),
    tags,
    content: reason,
  }
}
