/**
 * TV Show Seasons and Episodes API Service
 * Fetches episode catalogs via TVMaze (100% free, public, keyless, CORS-enabled)
 * with optional TMDB enrichment.
 */

import { getTmdbApiKey, getTmdbImageUrl } from './tmdb.js'
import { cleanShowTitle } from '@/utils/contentId.js'

const episodeCache = new Map()

/**
 * Strips HTML tags from overview/summary strings.
 * @param {string} html
 * @returns {string}
 */
export function stripHtml(html) {
  if (!html || typeof html !== 'string') return ''
  return html.replace(/<[^>]+>/g, '').trim()
}

/**
 * Normalizes an episode payload into a standard Trackstr Episode object.
 * @param {Object} raw
 * @param {'tvmaze'|'tmdb'} source
 * @returns {Object}
 */
export function normalizeEpisode(raw, source = 'tvmaze') {
  if (source === 'tvmaze') {
    const season = typeof raw.season === 'number' ? raw.season : Number(raw.season) || 1
    const episode = typeof raw.number === 'number' ? raw.number : Number(raw.number) || 1
    return {
      id: raw.id ? `tvmaze-ep-${raw.id}` : `s${season}e${episode}`,
      season,
      episode,
      name: raw.name || `Episode ${episode}`,
      title: raw.name || `Episode ${episode}`,
      airDate: raw.airdate || raw.air_date || '',
      runtime: raw.runtime || null,
      still: raw.image?.original || raw.image?.medium || '',
      summary: stripHtml(raw.summary || ''),
      rating: raw.rating?.average ? Number(raw.rating.average) : null,
    }
  }

  // TMDB format
  const season = typeof raw.season_number === 'number' ? raw.season_number : Number(raw.season_number) || 1
  const episode = typeof raw.episode_number === 'number' ? raw.episode_number : Number(raw.episode_number) || 1
  return {
    id: raw.id ? `tmdb-ep-${raw.id}` : `s${season}e${episode}`,
    season,
    episode,
    name: raw.name || `Episode ${episode}`,
    title: raw.name || `Episode ${episode}`,
    airDate: raw.air_date || '',
    runtime: raw.runtime || null,
    still: raw.still_path ? getTmdbImageUrl(raw.still_path, 'w500') : '',
    summary: raw.overview || '',
    rating: raw.vote_average ? Number(raw.vote_average.toFixed(1)) : null,
  }
}

/**
 * Groups a flat array of normalized episodes by season.
 * Regular seasons are ordered 1..N, followed by Season 0 (Specials) if present.
 * @param {Array<Object>} episodes
 * @returns {Array<Object>}
 */
export function groupEpisodesBySeason(episodes) {
  if (!Array.isArray(episodes) || episodes.length === 0) return []

  const seasonMap = new Map()

  for (const ep of episodes) {
    const sNum = ep.season ?? 1
    if (!seasonMap.has(sNum)) {
      seasonMap.set(sNum, {
        seasonNumber: sNum,
        name: sNum === 0 ? 'Specials' : `Season ${sNum}`,
        episodeCount: 0,
        episodes: [],
      })
    }
    const group = seasonMap.get(sNum)
    group.episodes.push(ep)
    group.episodeCount += 1
  }

  // Sort episodes within each season by episode number ascending
  for (const group of seasonMap.values()) {
    group.episodes.sort((a, b) => a.episode - b.episode)
  }

  // Sort seasons: 1, 2, 3... and place 0 (Specials) at the end
  const sorted = Array.from(seasonMap.values()).sort((a, b) => {
    if (a.seasonNumber === 0) return 1
    if (b.seasonNumber === 0) return -1
    return a.seasonNumber - b.seasonNumber
  })

  return sorted
}

/**
 * Fetches episodes from TVMaze.
 * @param {Object} params
 * @param {string} params.title
 * @param {string|number} [params.tvmazeId]
 * @returns {Promise<Array<Object>|null>}
 */
async function fetchTvMazeEpisodes({ title, tvmazeId }) {
  try {
    let url = ''
    const clean = cleanShowTitle(title)
    if (tvmazeId) {
      const cleanId = String(tvmazeId).replace(/^tvmaze-/, '')
      url = `https://api.tvmaze.com/shows/${cleanId}/episodes`
    } else if (clean) {
      url = `https://api.tvmaze.com/singlesearch/shows?q=${encodeURIComponent(clean)}&embed=episodes`
    } else {
      return null
    }

    let res = await fetch(url)

    // Fallback if singlesearch 404s: search /search/shows and use first result
    if (!res.ok && !tvmazeId && clean) {
      try {
        const sRes = await fetch(`https://api.tvmaze.com/search/shows?q=${encodeURIComponent(clean)}`)
        if (sRes.ok) {
          const sList = await sRes.json()
          if (sList && sList.length > 0 && sList[0].show?.id) {
            res = await fetch(`https://api.tvmaze.com/shows/${sList[0].show.id}/episodes`)
          }
        }
      } catch {}
    }

    if (!res.ok) return null

    const data = await res.json()
    let rawList = []

    if (Array.isArray(data)) {
      rawList = data
    } else if (data && data._embedded && Array.isArray(data._embedded.episodes)) {
      rawList = data._embedded.episodes
    }

    if (!rawList.length) return null

    return rawList.map((item) => normalizeEpisode(item, 'tvmaze'))
  } catch (err) {
    console.warn('TVMaze episode fetch failed:', err)
    return null
  }
}

/**
 * Fetches episodes from TMDB if apiKey and tmdbId are present.
 * @param {Object} params
 * @param {number|string} params.tmdbId
 * @param {number} params.numberOfSeasons
 * @returns {Promise<Array<Object>|null>}
 */
async function fetchTmdbEpisodes({ tmdbId, numberOfSeasons }) {
  const apiKey = getTmdbApiKey()
  if (!apiKey || !tmdbId) return null

  try {
    const seasonsToFetch = numberOfSeasons || 1
    const promises = []

    for (let s = 1; s <= seasonsToFetch; s++) {
      promises.push(
        fetch(`https://api.themoviedb.org/3/tv/${tmdbId}/season/${s}?api_key=${encodeURIComponent(apiKey)}`)
          .then((r) => (r.ok ? r.json() : null))
          .catch(() => null)
      )
    }

    const results = await Promise.all(promises)
    const episodes = []

    for (const data of results) {
      if (data && Array.isArray(data.episodes)) {
        for (const ep of data.episodes) {
          episodes.push(normalizeEpisode(ep, 'tmdb'))
        }
      }
    }

    return episodes.length ? episodes : null
  } catch (err) {
    console.warn('TMDB episode fetch failed:', err)
    return null
  }
}

/**
 * Primary entry point: fetches, normalizes, and groups episodes for a TV series.
 * @param {Object} params
 * @param {string} params.title
 * @param {string|number} [params.tmdbId]
 * @param {string|number} [params.tvmazeId]
 * @param {number} [params.numberOfSeasons]
 * @returns {Promise<{ seasons: Array<Object>, totalEpisodes: number, source: string }>}
 */
export async function fetchShowEpisodes({ title = '', tmdbId = null, tvmazeId = null, numberOfSeasons = null } = {}) {
  const cacheKey = `${title.toLowerCase()}_${tmdbId || ''}_${tvmazeId || ''}`
  if (episodeCache.has(cacheKey)) {
    return episodeCache.get(cacheKey)
  }

  let episodes = null
  let source = 'TVMaze'

  // 1. Try TVMaze first (instant, free, keyless, all seasons in one call)
  episodes = await fetchTvMazeEpisodes({ title, tvmazeId })

  // 2. If TVMaze returned no episodes and TMDB info is available, try TMDB
  if (!episodes && tmdbId) {
    episodes = await fetchTmdbEpisodes({ tmdbId, numberOfSeasons })
    if (episodes) source = 'TMDB'
  }

  if (!episodes || episodes.length === 0) {
    const emptyResult = { seasons: [], totalEpisodes: 0, source: 'None' }
    return emptyResult
  }

  const seasons = groupEpisodesBySeason(episodes)
  const totalEpisodes = episodes.length

  const result = { seasons, totalEpisodes, source }
  episodeCache.set(cacheKey, result)
  return result
}

/**
 * Clears the in-memory episode cache (useful for testing or cache refresh).
 */
export function clearEpisodeCache() {
  episodeCache.clear()
}
