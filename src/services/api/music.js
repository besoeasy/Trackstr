/**
 * Multi-Provider Music API Service
 * Combines iTunes (Apple Music), MusicBrainz, and Audius
 * for high-speed, reliable, global music search and metadata retrieval
 * without requiring mandatory API keys.
 */

const MUSICBRAINZ_USER_AGENT = 'Trackstr/1.0.0 (https://github.com/besoeasy/Trackstr)'
const DEFAULT_TIMEOUT_MS = 3800

/**
 * Executes a fetch with a timeout fallback
 * @param {string} url
 * @param {RequestInit} options
 * @param {number} timeoutMs
 * @returns {Promise<Response>}
 */
async function fetchWithTimeout(url, options = {}, timeoutMs = DEFAULT_TIMEOUT_MS) {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const res = await fetch(url, {
      ...options,
      signal: controller.signal,
    })
    clearTimeout(timer)
    return res
  } catch (err) {
    clearTimeout(timer)
    throw err
  }
}

/**
/**
 * Normalizes an iTunes raw track object to the standard Trackstr format
 */
export function normalizeItunesTrack(r) {
  const rawArtwork = r.artworkUrl100 || r.artworkUrl60 || ''
  const poster = rawArtwork ? rawArtwork.replace(/100x100bb\./, '600x600bb.') : ''
  const banner = rawArtwork ? rawArtwork.replace(/100x100bb\./, '1000x1000bb.') : ''
  const year = (r.releaseDate || '').slice(0, 4)

  return {
    type: 'music',
    id: `itunes-track-${r.trackId}`,
    title: r.trackName,
    name: r.trackName,
    artist: r.artistName,
    album: r.collectionName || '',
    year,
    overview: r.collectionName
      ? `Track from album "${r.collectionName}" by ${r.artistName}`
      : `Song by ${r.artistName}`,
    poster,
    banner,
    genres: r.primaryGenreName ? [r.primaryGenreName] : [],
    sources: ['iTunes'],
    previewUrl: r.previewUrl || '',
    popularity: 85,
  }
}

/**
 * Searches iTunes / Apple Music for tracks (songs)
 * @param {string} query
 * @returns {Promise<Array<Object>>}
 */
export async function searchItunesTracks(query) {
  if (!query || !query.trim()) return []
  const trimmed = query.trim()

  const termsToSearch = [trimmed]
  if (/\s+by\s+/i.test(trimmed)) {
    const parts = trimmed.split(/\s+by\s+/i)
    if (parts[0]) termsToSearch.push(parts[0].trim())
  }
  if (/\s+-\s+/.test(trimmed)) {
    const parts = trimmed.split(/\s+-\s+/)
    if (parts[1]) termsToSearch.push(parts[1].trim())
  }

  const results = []
  const seenTrackIds = new Set()

  for (const term of termsToSearch) {
    try {
      const url = `https://itunes.apple.com/search?term=${encodeURIComponent(term)}&entity=song&limit=30`
      const res = await fetchWithTimeout(url)
      if (!res.ok) continue

      const data = await res.json()
      const list = data.results || []

      for (const r of list) {
        if (!r.trackId || seenTrackIds.has(r.trackId) || !r.trackName || !r.artistName) continue
        seenTrackIds.add(r.trackId)
        results.push(normalizeItunesTrack(r))
      }
    } catch (err) {
      console.warn('iTunes track search failed:', err?.message || err)
    }
  }

  return results
}

/**
 * Discovers tracks by first identifying artist candidates via iTunes musicArtist search,
 * then looking up their discography and matching track titles.
 * Bypasses iTunes fuzzy search failures on multi-token indie queries (e.g. "no guts no glory addy nagar").
 * @param {string} query
 * @returns {Promise<Array<Object>>}
 */
export async function searchItunesByArtist(query) {
  if (!query || !query.trim()) return []
  const trimmed = query.trim()

  const candidates = [trimmed]
  if (/\s+by\s+/i.test(trimmed)) {
    const parts = trimmed.split(/\s+by\s+/i)
    if (parts[1]) candidates.push(parts[1].trim())
  }
  if (/\s+-\s+/.test(trimmed)) {
    const parts = trimmed.split(/\s+-\s+/)
    if (parts[0]) candidates.push(parts[0].trim())
    if (parts[1]) candidates.push(parts[1].trim())
  }

  const results = []
  const seenArtistIds = new Set()
  const seenTrackIds = new Set()

  for (const cand of candidates) {
    if (!cand) continue
    try {
      const url = `https://itunes.apple.com/search?term=${encodeURIComponent(cand)}&entity=musicArtist&limit=3`
      const res = await fetchWithTimeout(url)
      if (!res.ok) continue
      const data = await res.json()
      const artists = data.results || []

      for (const artist of artists) {
        if (!artist.artistId || seenArtistIds.has(artist.artistId)) continue
        seenArtistIds.add(artist.artistId)

        const lookupUrl = `https://itunes.apple.com/lookup?id=${artist.artistId}&entity=song&limit=100`
        const lookupRes = await fetchWithTimeout(lookupUrl)
        if (!lookupRes.ok) continue
        const lookupData = await lookupRes.json()
        const tracks = (lookupData.results || []).filter((r) => r.wrapperType === 'track' && r.trackName)

        // Tokens in query excluding the artist's name
        const aTokens = artist.artistName.toLowerCase().split(/\s+/).filter(Boolean)
        const qTokens = trimmed.toLowerCase().split(/\s+/).filter((tok) => !aTokens.includes(tok))

        for (const t of tracks) {
          if (!t.trackId || seenTrackIds.has(t.trackId)) continue
          const tLower = t.trackName.toLowerCase()
          if (qTokens.length > 0) {
            const hasMatch = qTokens.some((tok) => tLower.includes(tok))
            if (!hasMatch) continue
          }
          seenTrackIds.add(t.trackId)
          results.push(normalizeItunesTrack(t))
        }
      }
    } catch (err) {
      console.warn('iTunes artist-driven search failed:', err?.message || err)
    }
  }

  return results
}

/**
 * Searches iTunes / Apple Music for albums
 * @param {string} query
 * @returns {Promise<Array<Object>>}
 */
export async function searchItunesAlbums(query) {
  if (!query || !query.trim()) return []

  try {
    const url = `https://itunes.apple.com/search?term=${encodeURIComponent(query.trim())}&entity=album&limit=10`
    const res = await fetchWithTimeout(url)
    if (!res.ok) return []

    const data = await res.json()
    const results = data.results || []

    return results
      .filter((r) => r.collectionName && r.artistName)
      .map((r) => {
        const rawArtwork = r.artworkUrl100 || r.artworkUrl60 || ''
        const poster = rawArtwork ? rawArtwork.replace(/100x100bb\./, '600x600bb.') : ''
        const banner = rawArtwork ? rawArtwork.replace(/100x100bb\./, '1000x1000bb.') : ''
        const year = (r.releaseDate || '').slice(0, 4)

        return {
          type: 'music',
          id: `itunes-album-${r.collectionId}`,
          title: r.collectionName,
          name: r.collectionName,
          artist: r.artistName,
          album: r.collectionName,
          year,
          overview: `Album by ${r.artistName}${r.trackCount ? ` (${r.trackCount} tracks)` : ''}`,
          poster,
          banner,
          genres: r.primaryGenreName ? [r.primaryGenreName] : [],
          sources: ['iTunes'],
          popularity: 90,
        }
      })
  } catch (err) {
    console.warn('iTunes album search failed:', err?.message || err)
    return []
  }
}

/**
 * Searches MusicBrainz for release groups (albums) and recordings (tracks)
 * @param {string} query
 * @returns {Promise<Array<Object>>}
 */
export async function searchMusicBrainz(query) {
  if (!query || !query.trim()) return []

  try {
    const enc = encodeURIComponent(query.trim())
    const releaseGroupsPromise = fetchWithTimeout(
      `https://musicbrainz.org/ws/2/release-group/?query=${enc}&fmt=json&limit=8`,
      {
        headers: {
          'User-Agent': MUSICBRAINZ_USER_AGENT,
          Accept: 'application/json',
        },
      }
    )
      .then(async (res) => {
        if (!res.ok) return []
        const data = await res.json()
        const rgs = data['release-groups'] || []
        return rgs.map((rg) => {
          const artist =
            rg['artist-credit']?.[0]?.name ||
            rg['artist-credit']?.[0]?.artist?.name ||
            'Unknown Artist'
          const year = rg['first-release-date'] ? rg['first-release-date'].slice(0, 4) : ''
          const poster = `https://coverartarchive.org/release-group/${rg.id}/front-500`

          return {
            type: 'music',
            id: `mb-rg-${rg.id}`,
            title: rg.title,
            name: rg.title,
            artist,
            year,
            overview: rg['primary-type'] ? `${rg['primary-type']} by ${artist}` : `Music by ${artist}`,
            poster,
            banner: '',
            genres: (rg.tags || []).slice(0, 4).map((t) => t.name),
            sources: ['MusicBrainz'],
            popularity: 70,
          }
        })
      })
      .catch(() => [])

    const recordingsPromise = fetchWithTimeout(
      `https://musicbrainz.org/ws/2/recording/?query=${enc}&fmt=json&limit=8`,
      {
        headers: {
          'User-Agent': MUSICBRAINZ_USER_AGENT,
          Accept: 'application/json',
        },
      }
    )
      .then(async (res) => {
        if (!res.ok) return []
        const data = await res.json()
        const recs = data.recordings || []
        return recs.map((rec) => {
          const artist =
            rec['artist-credit']?.[0]?.name ||
            rec['artist-credit']?.[0]?.artist?.name ||
            'Unknown Artist'
          const year =
            rec['first-release-date']?.slice(0, 4) ||
            rec.releases?.[0]?.date?.slice(0, 4) ||
            ''
          const release = rec.releases?.[0]
          const poster = release?.id ? `https://coverartarchive.org/release/${release.id}/front-500` : ''

          return {
            type: 'music',
            id: `mb-rec-${rec.id}`,
            title: rec.title,
            name: rec.title,
            artist,
            album: release?.title || '',
            year,
            overview: release?.title ? `Track on "${release.title}" by ${artist}` : `Recording by ${artist}`,
            poster,
            banner: '',
            genres: (rec.tags || []).slice(0, 4).map((t) => t.name),
            sources: ['MusicBrainz'],
            popularity: 65,
          }
        })
      })
      .catch(() => [])

    const [releaseGroups, recordings] = await Promise.all([
      releaseGroupsPromise,
      recordingsPromise,
    ])
    return [...releaseGroups, ...recordings]
  } catch (err) {
    console.warn('MusicBrainz live search failed:', err?.message || err)
    return []
  }
}

/**
 * Searches Audius decentralized music catalog
 * @param {string} query
 * @returns {Promise<Array<Object>>}
 */
export async function searchAudius(query) {
  if (!query || !query.trim()) return []

  try {
    const url = `https://discoveryprovider.audius.co/v1/tracks/search?query=${encodeURIComponent(query.trim())}&limit=8&app_name=Trackstr`
    const res = await fetchWithTimeout(url)
    if (!res.ok) return []

    const data = await res.json()
    const tracks = data.data || []

    return tracks
      .filter((t) => t.title && (t.user?.name || t.user?.handle))
      .map((t) => {
        const artist = t.user?.name || t.user?.handle || 'Unknown Artist'
        const year = (t.release_date || t.created_at || '').slice(0, 4)
        const poster = t.artwork?.['480x480'] || t.artwork?.['1000x1000'] || t.artwork?.['150x150'] || ''

        return {
          type: 'music',
          id: `audius-${t.id || t.track_id}`,
          title: t.title,
          name: t.title,
          artist,
          year,
          overview: t.description ? t.description.slice(0, 280) : `Track by ${artist} on Audius`,
          poster,
          banner: '',
          genres: t.genre ? [t.genre] : [],
          sources: ['Audius'],
          popularity: 60,
        }
      })
  } catch (err) {
    console.warn('Audius search failed:', err?.message || err)
    return []
  }
}

/**
 * Normalize title and artist for fuzzy matching & deduplication
 */
function cleanKey(str) {
  return (str || '')
    .toLowerCase()
    .normalize('NFKC')
    .replace(/[^\w\s]/g, '')
    .trim()
    .replace(/\s+/g, ' ')
}

/**
 * Unified Multi-Provider Music Search
 * Runs queries against iTunes Songs, iTunes Albums, MusicBrainz, and Audius in parallel,
 * merges matching items, deduplicates, and aggregates sources.
 *
 * @param {string} query
 * @returns {Promise<Array<Object>>}
 */
export async function searchMusic(query) {
  if (!query || !query.trim()) return []

  const searchPromises = [
    searchItunesTracks(query),
    searchItunesAlbums(query),
    searchItunesByArtist(query),
    searchMusicBrainz(query),
    searchAudius(query),
  ]

  const settled = await Promise.allSettled(searchPromises)
  const allResults = []

  for (const s of settled) {
    if (s.status === 'fulfilled' && Array.isArray(s.value)) {
      allResults.push(...s.value)
    }
  }

  // Deduplicate and aggregate sources
  const mergedMap = new Map()

  for (const item of allResults) {
    if (!item.title || !item.artist || !item.year) continue

    const artistKey = cleanKey(item.artist)
    const titleKey = cleanKey(item.title)
    // Group primarily on normalized (artist, title)
    const key = `${artistKey}|${titleKey}`

    if (mergedMap.has(key)) {
      const existing = mergedMap.get(key)
      // Merge sources without duplicates
      existing.sources = [...new Set([...(existing.sources || []), ...(item.sources || [])])]

      // If existing item lacks a reliable poster, upgrade from the new item
      if (
        (!existing.poster || existing.poster.includes('coverartarchive')) &&
        item.poster &&
        !item.poster.includes('coverartarchive')
      ) {
        existing.poster = item.poster
      }

      if (!existing.banner && item.banner) {
        existing.banner = item.banner
      }

      if (!existing.year && item.year) {
        existing.year = item.year
      }

      if (!existing.previewUrl && item.previewUrl) {
        existing.previewUrl = item.previewUrl
      }

      if ((!existing.genres || existing.genres.length === 0) && item.genres?.length) {
        existing.genres = item.genres
      }

      if ((!existing.overview || existing.overview.startsWith('Recording by')) && item.overview) {
        existing.overview = item.overview
      }
    } else {
      mergedMap.set(key, { ...item })
    }
  }

  // Calculate query relevance to ensure multi-token song+artist queries (e.g. "no guts no glory addy nagar")
  // place exact track+artist matches at the top of results.
  const qClean = cleanKey(query)
  const qTokens = qClean.split(' ').filter(Boolean)

  function calculateRelevance(item) {
    if (!qTokens.length) return 0
    const aClean = cleanKey(item.artist)
    const tClean = cleanKey(item.title)

    let score = 0
    let matchedArtistTokens = 0
    let matchedTitleTokens = 0

    for (const tok of qTokens) {
      if (aClean.includes(tok)) matchedArtistTokens += 1
      if (tClean.includes(tok)) matchedTitleTokens += 1
      if (aClean.includes(tok) || tClean.includes(tok)) score += 10
    }

    // High boost when both artist and title are found in query tokens
    if (matchedArtistTokens > 0 && matchedTitleTokens > 0) {
      score += 1000
    }

    // Exact full query match
    if (`${tClean} ${aClean}` === qClean || `${aClean} ${tClean}` === qClean) {
      score += 1500
    }

    // Exact title or artist match
    if (tClean === qClean) score += 500
    if (aClean === qClean) score += 300

    return score
  }

  return Array.from(mergedMap.values())
    .filter((item) => {
      const title = (item.title || item.name || '').trim()
      const artist = (item.artist || '').trim()
      const year = String(item.year || '').trim()
      return Boolean(title && artist && year)
    })
    .sort((a, b) => {
    const relDiff = calculateRelevance(b) - calculateRelevance(a)
    if (relDiff !== 0) return relDiff
    return (b.popularity || 0) - (a.popularity || 0)
  })
}

/**
 * Fetches rich details for a music track or album by title, artist, and year
 * @param {Object} params
 * @param {string} params.title
 * @param {string} [params.artist]
 * @param {string} [params.year]
 * @returns {Promise<Object|null>}
 */
export async function getMusicDetails({ title, artist = '', year = '' }) {
  if (!title) return null
  const query = artist ? `${artist} ${title}` : title
  const results = await searchMusic(query)

  if (!results.length) return null

  // Prioritize exact artist + title match
  const tKey = cleanKey(title)
  const aKey = cleanKey(artist)

  const exactMatch = results.find((r) => {
    const rT = cleanKey(r.title)
    const rA = cleanKey(r.artist)
    return rT === tKey && (!aKey || rA.includes(aKey) || aKey.includes(rA))
  })

  return exactMatch || results[0]
}
