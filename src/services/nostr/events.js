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
  SIMILAR_SUGGESTION: 35401,
  STATUS: 35402,
}

export const APP_ID = 'web'

export const MEDIA_TYPES = ['movie', 'show', 'episode', 'music']
export const VIDEO_STATUSES = ['plan-to-watch', 'watching', 'completed', 'on-hold', 'dropped']
export const MUSIC_STATUSES = ['plan-to-listen', 'listening', 'completed']

function assertMediaRef(media) {
  assertContentId(media?.contentId)
  if (!MEDIA_TYPES.includes(media?.type)) {
    throw new Error(`Media type must be one of ${MEDIA_TYPES.join(', ')}.`)
  }
  const name = (media?.name || media?.title || '').trim()
  if (!name) {
    throw new Error('Media name is required on Nostr events.')
  }
  const year = media?.year !== undefined && media?.year !== null ? String(media.year).trim() : ''
  if (!year) {
    throw new Error('Media year is required on Nostr events.')
  }
  if (media?.type === 'music' && !(media?.artist || '').trim()) {
    throw new Error('Artist is required on music Nostr events.')
  }
}

function assertRating(rating) {
  const n = Number(rating)
  if (!Number.isFinite(n) || n < 1 || n > 10) {
    throw new Error('Rating must be a number from 1 to 10 (half-steps like 8.5 allowed).')
  }
  return n
}

/**
 * Builds standard base tags common to all Trackstr media events:
 * trackstr, contentid, type, name, year, [season, episode], [artist], [qualifier]
 * @param {Object} media
 * @returns {Array<Array<string>>}
 */
export function buildBaseMediaTags(media) {
  assertMediaRef(media)
  const tags = [
    ['trackstr', APP_ID],
    ['contentid', media.contentId],
    ['type', media.type],
    ['name', (media.name || media.title).trim()],
    ['year', String(media.year).trim()],
  ]

  // Episode records MUST carry both season and episode position tags so
  // clients can aggregate show activity under a single contentid query.
  if (media.type === 'episode') {
    if (media.season === undefined || media.season === null || media.season === '') {
      throw new Error('Episode records must specify a season number (0 for specials).')
    }
    if (media.episode === undefined || media.episode === null || media.episode === '') {
      throw new Error('Episode records must specify an episode number.')
    }
    tags.push(['season', String(media.season)])
    tags.push(['episode', String(media.episode)])
  }

  // Music records emit the artist tag so readers can independently
  // recompute the music contentid (music|<artist>|<title>|<year>).
  if (media.type === 'music' && media.artist) {
    tags.push(['artist', String(media.artist)])
  }

  // When a qualifier was used to split a collision, tag it so the
  // hash is reproducible by other clients.
  if (media.qualifier) {
    tags.push(['qualifier', String(media.qualifier)])
  }

  return tags
}

/**
 * Builds a Mutable Rating & Review Event (kind: 35400)
 * NIP-33 Parameterized Replaceable Event
 * @param {Object} media
 * @param {number|string|null} [rating] 1 to 10 scale (optional if content/review is present)
 * @param {string} [content] Optional review body / commentary / note
 * @param {Object} [options]
 * @param {boolean} [options.spoiler] Whether contains spoilers
 * @returns {Object} Unsigned event template
 */
export function buildRatingEvent(media, rating = null, content = '', options = {}) {
  assertMediaRef(media)
  const dTag = buildDTag({
    contentId: media.contentId,
    season: media.season,
    episode: media.episode,
  })

  const tags = [
    ['d', dTag],
    ...buildBaseMediaTags(media),
  ]

  const hasRating = rating !== undefined && rating !== null && rating !== ''
  const trimmedContent = content ? String(content).trim() : ''

  if (hasRating) {
    const num = assertRating(rating)
    tags.push(['rating', String(num)])
  }

  if (options.spoiler) {
    tags.push(['spoiler', '1'])
  }

  return {
    kind: KINDS.RATING,
    created_at: Math.floor(Date.now() / 1000),
    tags,
    content: trimmedContent,
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
 * Builds a Mutable Similar Suggestion Event (kind: 35401, NIP-33)
 * Lets users recommend similar movies, shows, or music for any media item.
 * @param {Object} sourceMedia The media item being compared against
 * @param {Array<Object>|Object} similarItems One or more similar media objects
 * @param {Object} [options]
 * @param {string} [options.content] Commentary or rationale for the suggestion
 * @param {string} [options.note] Alias for options.content
 * @returns {Object} Unsigned event template
 */
export function buildSimilarSuggestionEvent(sourceMedia, similarItems, options = {}) {
  assertMediaRef(sourceMedia)
  const dTag = assertContentId(sourceMedia?.contentId)

  const tags = [
    ['d', dTag],
    ...buildBaseMediaTags(sourceMedia),
  ]

  const items = Array.isArray(similarItems) ? similarItems : (similarItems ? [similarItems] : [])
  if (!items.length) {
    throw new Error('At least one similar media item is required.')
  }

  items.forEach((item) => {
    if (!item) return
    const cid = assertContentId(item.contentId)
    const type = item.type || 'movie'
    const name = (item.name || item.title || '').trim()
    const year = item.year !== undefined && item.year !== null ? String(item.year).trim() : ''
    if (!name) {
      throw new Error('Similar media item must have a name.')
    }
    if (!year) {
      throw new Error('Similar media item must have a year.')
    }
    // Standard similar suggestion tag
    tags.push(['similar', cid, type, name, year])
    // Single-letter lookup tag for Nostr relay filtering
    tags.push(['s', cid])
  })

  return {
    kind: KINDS.SIMILAR_SUGGESTION,
    created_at: Math.floor(Date.now() / 1000),
    tags,
    content: options.content || options.note || '',
  }
}

/**
 * Builds a standard NIP-09 Deletion Event (kind: 5)
 * @param {Object} target
 * @param {string} target.coordinate For parameterized replaceable events: "<kind>:<pubkey>:<d-tag>"
 * @param {string} [target.reason]
 * @returns {Object} Unsigned event template
 */
export function buildDeletionEvent({ coordinate, reason = 'Deleted by user' }) {
  if (!coordinate) {
    throw new Error('Deletion coordinate is required.')
  }
  // "<kind>:<pubkey>:<d-tag>" — d-tag itself may contain colons (episode suffix).
  const parts = String(coordinate).split(':')
  const [kind, pubkey, ...dParts] = parts
  const dTag = dParts.join(':')
  if (!/^\d+$/.test(kind || '') || !/^[0-9a-f]{64}$/i.test(pubkey || '') || !dTag) {
    throw new Error('Deletion coordinate must look like "<kind>:<64-hex pubkey>:<d-tag>".')
  }
  const tags = [
    ['a', coordinate],
    ['k', kind],
  ]

  return {
    kind: KINDS.DELETION,
    created_at: Math.floor(Date.now() / 1000),
    tags,
    content: reason,
  }
}
