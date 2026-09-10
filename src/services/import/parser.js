/**
 * Media Importer Parsers
 * Supports:
 *  - Letterboxd CSVs (watched.csv, ratings.csv, diary.csv, reviews.csv, watchlist.csv)
 *  - Trakt JSON / CSV
 *  - Generic CSV with Title, Year, Rating, Status
 */
import { computeContentId } from '@/utils/contentId.js'

/**
 * Robust RFC 4180 compliant CSV parser
 * Correctly handles:
 *  - Quoted fields with commas: "Everything Everywhere All at Once, The Sequel"
 *  - Escaped quotes: "He said ""Hello"""
 *  - Newlines inside quoted fields (common in reviews)
 *  - Carriage returns \r\n and \n
 * @param {string} csvText
 * @returns {Array<Array<string>>} 2D array of rows and columns
 */
export function parseCsv(csvText) {
  if (!csvText || typeof csvText !== 'string') return []

  const rows = []
  let currentRow = []
  let currentField = ''
  let inQuotes = false
  let i = 0
  const len = csvText.length

  while (i < len) {
    const char = csvText[i]
    const nextChar = i + 1 < len ? csvText[i + 1] : null

    if (inQuotes) {
      if (char === '"') {
        if (nextChar === '"') {
          // Escaped quote: "" -> "
          currentField += '"'
          i += 2
          continue
        } else {
          // Closing quote
          inQuotes = false
          i++
          continue
        }
      } else {
        currentField += char
        i++
        continue
      }
    } else {
      if (char === '"') {
        inQuotes = true
        i++
        continue
      } else if (char === ',') {
        currentRow.push(currentField)
        currentField = ''
        i++
        continue
      } else if (char === '\r') {
        if (nextChar === '\n') {
          i++ // skip \r, next will be handled
        }
        currentRow.push(currentField)
        rows.push(currentRow)
        currentRow = []
        currentField = ''
        i++
        continue
      } else if (char === '\n') {
        currentRow.push(currentField)
        rows.push(currentRow)
        currentRow = []
        currentField = ''
        i++
        continue
      } else {
        currentField += char
        i++
        continue
      }
    }
  }

  // Push last field and row if any content remains
  if (currentField !== '' || currentRow.length > 0) {
    currentRow.push(currentField)
    rows.push(currentRow)
  }

  // Filter out any completely empty trailing rows
  return rows.filter((r) => r.some((field) => field.trim() !== ''))
}

/**
 * Converts a Letterboxd 0.5 to 5.0 star rating to Trackstr 1 to 10 rating
 * Letterboxd scale: 0.5, 1.0, 1.5 ... 5.0
 * Trackstr scale: 1 to 10 (half steps supported)
 * @param {string|number} rawRating
 * @returns {number|null} 1-10 rating, or null if invalid
 */
export function convertLetterboxdRating(rawRating) {
  if (rawRating === undefined || rawRating === null || rawRating === '') return null
  const num = Number(rawRating)
  if (!Number.isFinite(num) || num <= 0) return null

  // If already on a 1-10 scale (some third party exports)
  if (num > 5 && num <= 10) {
    return Math.round(num * 10) / 10
  }

  // Letterboxd standard: 0.5 to 5.0 -> multiply by 2
  const scaled = num * 2
  const clamped = Math.max(1, Math.min(10, scaled))
  return Math.round(clamped * 10) / 10
}

/**
 * Normalizes date string to YYYY-MM-DD
 * @param {string} dateStr
 * @returns {string}
 */
export function normalizeDate(dateStr) {
  if (!dateStr) return ''
  const trimmed = String(dateStr).trim()
  if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) return trimmed

  const d = new Date(trimmed)
  if (Number.isNaN(d.getTime())) return ''
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

/**
 * Detects the Letterboxd file type based on headers or filename
 * @param {Array<string>} headers
 * @param {string} [filename]
 * @returns {'watched'|'ratings'|'reviews'|'diary'|'watchlist'|'generic'}
 */
export function detectLetterboxdFileType(headers, filename = '') {
  const normHeaders = headers.map((h) => h.toLowerCase().trim())
  const normFilename = (filename || '').toLowerCase()

  if (normHeaders.includes('review') || normFilename.includes('reviews')) {
    return 'reviews'
  }
  if (normHeaders.includes('rating') && normHeaders.includes('watched date')) {
    return 'diary'
  }
  if (normHeaders.includes('rating') || normFilename.includes('ratings')) {
    return 'ratings'
  }
  if (normFilename.includes('watchlist')) {
    return 'watchlist'
  }
  if (normHeaders.includes('letterboxd uri') && (normFilename.includes('watched') || normHeaders.includes('date'))) {
    return 'watched'
  }
  return 'generic'
}

/**
 * Parses a single Letterboxd or generic CSV file into intermediate records
 * @param {string} csvText
 * @param {string} [filename]
 * @returns {Array<Object>}
 */
export function parseCsvFile(csvText, filename = '') {
  const rows = parseCsv(csvText)
  if (rows.length < 2) return []

  const rawHeaders = rows[0]
  const headers = rawHeaders.map((h) => h.toLowerCase().trim())
  const fileType = detectLetterboxdFileType(rawHeaders, filename)

  const nameIdx = headers.findIndex((h) => ['name', 'title', 'movie', 'film'].includes(h))
  const yearIdx = headers.findIndex((h) => ['year', 'release year'].includes(h))
  const dateIdx = headers.findIndex((h) => ['watched date', 'date', 'watched_at', 'logged date'].includes(h))
  const ratingIdx = headers.findIndex((h) => ['rating', 'score', 'stars'].includes(h))
  const reviewIdx = headers.findIndex((h) => ['review', 'review text', 'notes'].includes(h))
  const spoilerIdx = headers.findIndex((h) => ['spoiler', 'is_spoiler'].includes(h))

  if (nameIdx === -1) {
    return []
  }

  const results = []

  for (let r = 1; r < rows.length; r++) {
    const row = rows[r]
    const name = (row[nameIdx] || '').trim()
    if (!name) continue

    const yearStr = yearIdx !== -1 ? (row[yearIdx] || '').trim() : ''
    const yearNum = parseInt(yearStr, 10)
    const year = Number.isFinite(yearNum) ? yearNum : ''

    const rawDate = dateIdx !== -1 ? (row[dateIdx] || '').trim() : ''
    const watchedDate = normalizeDate(rawDate)

    const rawRating = ratingIdx !== -1 ? (row[ratingIdx] || '').trim() : null
    const rating = convertLetterboxdRating(rawRating)

    const review = reviewIdx !== -1 ? (row[reviewIdx] || '').trim() : ''
    const rawSpoiler = spoilerIdx !== -1 ? (row[spoilerIdx] || '').trim().toLowerCase() : ''
    const spoiler = rawSpoiler === 'yes' || rawSpoiler === 'true' || rawSpoiler === '1'

    let status = 'completed'
    if (fileType === 'watchlist') {
      status = 'plan-to-watch'
    }

    results.push({
      type: 'movie',
      name,
      title: name,
      year,
      status,
      rating,
      review,
      spoiler,
      watchedDate,
      sourceFile: filename || fileType,
    })
  }

  return results
}

/**
 * Parses Trakt JSON export data
 * @param {string|Array} jsonData JSON string or parsed array
 * @returns {Array<Object>}
 */
export function parseTraktJson(jsonData) {
  let data = jsonData
  if (typeof jsonData === 'string') {
    try {
      data = JSON.parse(jsonData)
    } catch {
      return []
    }
  }

  if (!Array.isArray(data)) return []

  const results = []

  for (const item of data) {
    const movie = item.movie || (item.type === 'movie' ? item : null)
    const show = item.show || (item.type === 'show' ? item : null)

    const target = movie || show
    if (!target || !target.title) continue

    const type = movie ? 'movie' : 'show'
    const name = target.title.trim()
    const year = target.year || ''
    const watchedDate = normalizeDate(item.watched_at || item.last_watched_at || item.created_at || '')
    const rating = item.rating && item.rating >= 1 && item.rating <= 10 ? Number(item.rating) : null

    results.push({
      type,
      name,
      title: name,
      year,
      status: 'completed',
      rating,
      review: item.comment || '',
      spoiler: !!item.spoiler,
      watchedDate,
      sourceFile: 'trakt.json',
    })
  }

  return results
}

/**
 * Merges multiple parsed file results into a unified list of media items.
 * If a movie appears in both watched.csv and ratings.csv and reviews.csv,
 * its rating, status, and review are merged into a single cohesive item.
 * Also computes canonical contentId for each item.
 * @param {Array<Object>} parsedItems
 * @returns {Promise<Array<Object>>}
 */
export async function consolidateMediaItems(parsedItems) {
  const mergedMap = new Map()

  for (const item of parsedItems) {
    if (!item?.name) continue

    // Key by lowercased title and year for deduplication
    const normKey = `${item.type || 'movie'}|${item.name.toLowerCase().trim()}|${item.year || ''}`

    if (!mergedMap.has(normKey)) {
      mergedMap.set(normKey, {
        type: item.type || 'movie',
        name: item.name.trim(),
        title: item.name.trim(),
        year: item.year || '',
        status: item.status || 'completed',
        rating: item.rating || null,
        review: item.review || '',
        spoiler: item.spoiler || false,
        watchedDate: item.watchedDate || '',
      })
    } else {
      const existing = mergedMap.get(normKey)
      // Merge rating if not already set
      if (item.rating !== null && existing.rating === null) {
        existing.rating = item.rating
      }
      // If one entry is completed and another is plan-to-watch, completed wins
      if (item.status === 'completed' && existing.status !== 'completed') {
        existing.status = 'completed'
      }
      // Merge review if not set
      if (item.review && !existing.review) {
        existing.review = item.review
        existing.spoiler = item.spoiler
      }
      // Pick most recent watchedDate if available
      if (item.watchedDate && (!existing.watchedDate || item.watchedDate > existing.watchedDate)) {
        existing.watchedDate = item.watchedDate
      }
    }
  }

  // Compute canonical contentId for each unified item
  const finalized = []
  for (const item of mergedMap.values()) {
    try {
      const { contentId } = await computeContentId({
        type: item.type,
        title: item.name,
        year: item.year || '',
      })
      finalized.push({
        ...item,
        contentId,
      })
    } catch (err) {
      // Fallback if computation fails
      console.warn('Failed to compute contentId for item:', item.name, err)
    }
  }

  return finalized
}
