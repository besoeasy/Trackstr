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

  if (normType === 'music') {
    const normArtist = norm(artist)
    let canonical = `music|${normArtist}|${normTitle}|${normYear}`
    if (normQualifier) {
      canonical += `|${normQualifier}`
    }
    return canonical
  }

  // movie or show (episodes anchor to their parent show contentid)
  let canonical = `${normType}|${normTitle}|${normYear}`
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
 * - Episodes: `${contentId}:s${season}e${episode}`
 * @param {Object} params
 * @param {string} params.contentId
 * @param {string|number} [params.season]
 * @param {string|number} [params.episode]
 * @returns {string}
 */
export function buildDTag({ contentId, season, episode }) {
  if (season !== undefined && episode !== undefined && season !== null && episode !== null) {
    return `${contentId}:s${season}e${episode}`
  }
  return contentId
}
