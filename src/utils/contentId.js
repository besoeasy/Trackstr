/**
 * Trackstr Canonical Content ID Utilities
 * Strictly implements the specification defined in AGENTS.md:
 * - Unicode NFKC normalization
 * - lowercase
 * - trim, collapse multiple whitespace to single space
 * - escape literal '|' as '\|'
 * - sha256 lowercase hex
 */

/**
 * Normalizes a field according to Trackstr byte-exact specification
 * @param {string|number} value
 * @returns {string}
 */
export function norm(value) {
  if (value === null || value === undefined) return ''
  const str = String(value)
  // 1. Unicode NFKC normalize
  let normalized = str.normalize('NFKC')
  // 2. lowercase
  normalized = normalized.toLowerCase()
  // 3. trim, collapse internal whitespace runs to one space
  normalized = normalized.trim().replace(/\s+/g, ' ')
  // 4. literal '|' delimiter characters escaped as '\|'
  normalized = normalized.replace(/\|/g, '\\|')
  return normalized
}

/**
 * Strips episode/season suffixes from show titles to ensure clean canonical anchoring.
 * E.g. "Stranger Things - S1E6: Chapter Six: The Monster" -> "Stranger Things"
 *      "Breaking Bad - Season 1" -> "Breaking Bad"
 * @param {string} title
 * @returns {string}
 */
export function cleanShowTitle(title) {
  if (!title || typeof title !== 'string') return ''
  let clean = title.trim()
  clean = clean.replace(/\s+-\s+S\d+E\d+.*$/i, '')
  clean = clean.replace(/\s+-\s+Season\s+\d+.*$/i, '')
  clean = clean.replace(/\s+\(S\d+E\d+\).*$/i, '')
  clean = clean.replace(/:\s*S\d+E\d+.*$/i, '')
  return clean.trim()
}

/**
 * Builds the canonical string for a media item
 * @param {Object} params
 * @param {'movie'|'show'|'music'|'episode'} params.type
 * @param {string} params.title
 * @param {string|number} params.year
 * @param {string} [params.artist] - required for music
 * @param {string} [params.qualifier] - optional collision resolver
 * @returns {string} Canonical string representation
 */
export function buildCanonicalString({ type, title, year, artist = '', qualifier = '' }) {
  const normType = norm(type)
  const normTitle = norm(title)
  const normYear = norm(year)
  const normQualifier = qualifier ? norm(qualifier) : ''

  if (!normType) {
    throw new Error('Media type is required to compute a content ID.')
  }
  if (!normTitle) {
    throw new Error('Title is required to compute a content ID.')
  }
  if (!normYear) {
    throw new Error('Year is required to compute a content ID.')
  }

  if (normType === 'music') {
    const normArtist = norm(artist)
    if (!normArtist) {
      throw new Error('Artist is required to compute a music content ID.')
    }
    let canonical = `music|${normArtist}|${normTitle}|${normYear}`
    if (normQualifier) {
      canonical += `|${normQualifier}`
    }
    return canonical
  }

  // Episodes anchor directly to their parent show's contentid (spec):
  // position travels via season/episode tags + d-tag suffix, never the hash.
  const hashType = normType === 'episode' ? 'show' : normType
  const cleanTitle = hashType === 'show' ? cleanShowTitle(title) : title
  let canonical = `${hashType}|${norm(cleanTitle)}|${normYear}`
  if (normQualifier) {
    canonical += `|${normQualifier}`
  }
  return canonical
}

/**
 * Computes SHA-256 hash string (lowercase hex) using Web Crypto API
 * Compatible with modern browsers and Node.js
 * @param {string} str
 * @returns {Promise<string>}
 */
export async function sha256Hex(str) {
  if (typeof crypto === 'undefined' || !crypto.subtle) {
    throw new Error('WebCrypto (crypto.subtle) is unavailable — content IDs require a secure context (https or localhost).')
  }
  const encoder = new TextEncoder()
  const data = encoder.encode(str)
  const hashBuffer = await crypto.subtle.digest('SHA-256', data)
  const hashArray = Array.from(new Uint8Array(hashBuffer))
  return hashArray.map((b) => b.toString(16).padStart(2, '0')).join('')
}

/**
 * Computes the contentid and returns canonical string details
 * @param {Object} params
 * @returns {Promise<{ contentId: string, canonicalString: string }>}
 */
export async function computeContentId(params) {
  const canonicalString = buildCanonicalString(params)
  const contentId = await sha256Hex(canonicalString)
  return { contentId, canonicalString }
}

/**
 * Constructs the NIP-33 d-tag per AGENTS.md rules:
 * - Movies, shows, music: contentId
 * - Episodes: `${contentId}:s${season}e${episode}` (integers, season 0 = specials)
 * Empty-string season/episode are treated as absent. Non-hex contentIds pass
 * through untouched (validation lives in assertContentId / event builders).
 */
export function buildDTag({ contentId, season, episode }) {
  const s = season === '' || season === null || season === undefined ? null : Number(season)
  const e = episode === '' || episode === null || episode === undefined ? null : Number(episode)
  if (
    s !== null &&
    e !== null &&
    Number.isInteger(s) &&
    Number.isInteger(e) &&
    s >= 0 &&
    e >= 1 &&
    typeof contentId === 'string' &&
    contentId
  ) {
    return `${contentId}:s${s}e${e}`
  }
  return contentId
}

/**
 * Throws unless value is a valid 64-hex content ID.
 */
export function assertContentId(contentId) {
  if (typeof contentId !== 'string' || !/^[0-9a-f]{64}$/i.test(contentId)) {
    throw new Error('A valid 64-hex contentId is required.')
  }
  return contentId.toLowerCase()
}
