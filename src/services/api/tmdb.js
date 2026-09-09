/**
 * Media Metadata Service for Movies and TV Shows
 * Supports:
 * 1. TMDB API (when free API key is provided in settings or env)
 * 2. Open Public Free Providers (no API key required):
 *    - TV Shows: TVMaze API (100% free, public, high-res posters & summaries)
 *    - Movies: Wikipedia/Wikimedia REST API (100% free, public theatrical posters & synopses)
 */

const TMDB_BASE_URL = 'https://api.themoviedb.org/3'
const TMDB_IMAGE_BASE = 'https://image.tmdb.org/t/p'

// Sample curated items available out-of-the-box
export const SAMPLE_MEDIA = [
  {
    type: 'movie',
    title: 'Fight Club',
    year: '1999',
    overview: 'A ticking-time-bomb insomniac and a slippery soap salesman channel primal male aggression into a shocking new form of therapy.',
    poster: 'https://image.tmdb.org/t/p/w500/pB8BM7pdSp6B6Ih7QZ4DrQ3PmJK.jpg',
    banner: 'https://image.tmdb.org/t/p/original/hZkgoQYus5vegHoetLkCJzb17zJ.jpg',
    genres: ['Drama', 'Thriller'],
  },
  {
    type: 'movie',
    title: 'Inception',
    year: '2010',
    overview: 'Cobb, a skilled thief who commits corporate espionage by infiltrating the subconscious of his targets is offered a chance to regain his old life as payment for a task considered to be impossible: "inception".',
    poster: 'https://image.tmdb.org/t/p/w500/ljsZTbVsrQSqZgWeep2B1QiDKuh.jpg',
    banner: 'https://image.tmdb.org/t/p/original/8ZTVqvKDQ8emSGUEMjsS4yHAwrp.jpg',
    genres: ['Action', 'Sci-Fi', 'Adventure'],
  },
  {
    type: 'show',
    title: 'Breaking Bad',
    year: '2008',
    overview: 'A chemistry teacher diagnosed with inoperable lung cancer turns to manufacturing and selling methamphetamine with a former student in order to secure his family\'s future.',
    poster: 'https://image.tmdb.org/t/p/w500/ztkUQFLlC19CCMYHW9o1zWhJRNq.jpg',
    banner: 'https://image.tmdb.org/t/p/original/tsRy63Mu5cu8etL1X7ZLyf7UP1M.jpg',
    genres: ['Drama', 'Crime'],
  },
  {
    type: 'show',
    title: 'Stranger Things',
    year: '2016',
    overview: 'When a young boy vanishes, a small town uncovers a mystery involving secret experiments, terrifying supernatural forces and one strange little girl.',
    poster: 'https://image.tmdb.org/t/p/w500/49WJfeN0moxb9IPfGn8AIqMGskD.jpg',
    banner: 'https://image.tmdb.org/t/p/original/56v2KjBlU4XaOv9rVYEQypROD7P.jpg',
    genres: ['Drama', 'Fantasy', 'Horror'],
  },
  {
    type: 'movie',
    title: 'The Matrix',
    year: '1999',
    overview: 'Set in the 22nd century, The Matrix tells the story of a computer hacker who joins a group of underground insurgents fighting the vast and powerful computers who now rule the earth.',
    poster: 'https://image.tmdb.org/t/p/w500/f89U3ADr1oiB1s9GkdPOEpXUk5H.jpg',
    banner: 'https://image.tmdb.org/t/p/original/7u3XmlizLY02525hS3xJc4j5i0N.jpg',
    genres: ['Action', 'Sci-Fi'],
  },
]

export const DEFAULT_TMDB_KEY = 'db55323b8d3e4154498498a75642b381'

export function getTmdbApiKey() {
  if (typeof window !== 'undefined') {
    const saved = localStorage.getItem('trackstr_tmdb_api_key')
    if (saved && saved.trim()) return saved.trim()
  }
  const envKey = typeof import.meta !== 'undefined' && import.meta?.env?.VITE_TMDB_API_KEY
  return (envKey && envKey.trim()) || DEFAULT_TMDB_KEY
}

export function getTmdbImageUrl(path, size = 'w500') {
  if (!path) return ''
  if (path.startsWith('http://') || path.startsWith('https://') || path.startsWith('ipfs://')) {
    return path
  }
  return `${TMDB_IMAGE_BASE}/${size}${path}`
}

/**
 * Open TV show search via TVMaze (100% free, no key needed)
 */
async function searchTVMaze(query) {
  try {
    const res = await fetch(`https://api.tvmaze.com/search/shows?q=${encodeURIComponent(query)}`)
    if (!res.ok) return []
    const data = await res.json()

    return data.slice(0, 10).map((item) => {
      const s = item.show
      return {
        type: 'show',
        id: `tvmaze-${s.id}`,
        title: s.name,
        year: s.premiered ? s.premiered.slice(0, 4) : '',
        overview: s.summary ? s.summary.replace(/<[^>]+>/g, '').trim() : '',
        poster: s.image?.original || s.image?.medium || '',
        banner: s.image?.original || '',
        genres: s.genres || [],
      }
    })
  } catch (err) {
    console.warn('TVMaze search failed:', err)
    return []
  }
}

/**
 * Open Movie search via Wikipedia REST API (100% free, no key needed)
 */
async function searchWikipediaMovies(query) {
  try {
    const searchUrl = `https://en.wikipedia.org/w/rest.php/v1/search/page?q=${encodeURIComponent(query + ' film')}&limit=6`
    const res = await fetch(searchUrl, {
      headers: { 'User-Agent': 'Trackstr/1.0 (https://github.com/besoeasy/Trackstr)' },
    })
    if (!res.ok) return []

    const data = await res.json()
    const pages = data.pages || []
    const results = []

    for (const p of pages.slice(0, 6)) {
      const isLikelyFilm = /film|movie/i.test(p.description || '') || /film|movie/i.test(p.title || '')
      if (!isLikelyFilm && p.thumbnail == null) continue

      try {
        const sumRes = await fetch(`https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(p.key)}`, {
          headers: { 'User-Agent': 'Trackstr/1.0' },
        })
        if (sumRes.ok) {
          const sum = await sumRes.json()
          const yearMatch = (sum.description || sum.extract || '').match(/\b(19\d\d|20\d\d)\b/)
          const cleanTitle = sum.title.replace(/\s*\([^)]*film[^)]*\)/i, '').trim()

          // Prefer higher resolution image if available
          const poster = sum.originalimage?.source || sum.thumbnail?.source || ''

          results.push({
            type: 'movie',
            id: `wiki-${p.id}`,
            title: cleanTitle,
            year: yearMatch ? yearMatch[1] : '',
            overview: sum.extract || '',
            poster,
            banner: sum.originalimage?.source || '',
            genres: ['Movie'],
          })
        }
      } catch {}
    }

    return results
  } catch (err) {
    console.warn('Wikipedia movie search failed:', err)
    return []
  }
}

/**
 * Searches TMDB (if key available) or fallback to Free Open Providers (TVMaze + Wikipedia)
 * @param {string} query
 * @param {'all'|'movies'|'shows'} [filter='all']
 * @returns {Promise<Array<Object>>}
 */
/**
 * Searches across Multiple Sources (TMDB + TVMaze + Wikipedia) concurrently and merges results
 * @param {string} query
 * @param {'all'|'movies'|'shows'} [filter='all']
 * @returns {Promise<Array<Object>>}
 */
export async function searchTmdb(query, filter = 'all') {
  if (!query || !query.trim()) return []
  const apiKey = getTmdbApiKey()
  const q = query.trim()

  // 1. Prepare parallel requests across multiple providers
  const promises = []

  // Source 1: TMDB API
  if (apiKey) {
    let endpoint = `${TMDB_BASE_URL}/search/multi?api_key=${encodeURIComponent(apiKey)}&query=${encodeURIComponent(q)}&include_adult=false`
    if (filter === 'movies') {
      endpoint = `${TMDB_BASE_URL}/search/movie?api_key=${encodeURIComponent(apiKey)}&query=${encodeURIComponent(q)}&include_adult=false`
    } else if (filter === 'shows') {
      endpoint = `${TMDB_BASE_URL}/search/tv?api_key=${encodeURIComponent(apiKey)}&query=${encodeURIComponent(q)}&include_adult=false`
    }

    promises.push(
      fetch(endpoint)
        .then((res) => (res.ok ? res.json() : { results: [] }))
        .then((data) => {
          return (data.results || [])
            .filter((item) => {
              if (filter === 'movies') return true
              if (filter === 'shows') return true
              return item.media_type === 'movie' || item.media_type === 'tv'
            })
            .map((item) => {
              const isMovie = filter === 'movies' ? true : filter === 'shows' ? false : item.media_type === 'movie'
              const title = isMovie ? item.title : item.name
              const releaseDate = isMovie ? item.release_date : item.first_air_date
              const year = releaseDate ? releaseDate.slice(0, 4) : ''

              return {
                type: isMovie ? 'movie' : 'show',
                tmdbId: item.id,
                id: item.id,
                title: title || 'Untitled',
                year,
                overview: item.overview || '',
                poster: getTmdbImageUrl(item.poster_path, 'w500'),
                banner: getTmdbImageUrl(item.backdrop_path, 'original'),
                genres: [],
                voteAverage: item.vote_average ? Number(item.vote_average.toFixed(1)) : null,
                sources: ['TMDB'],
              }
            })
        })
        .catch((err) => {
          console.warn('TMDB search failed:', err)
          return []
        })
    )
  } else {
    promises.push(Promise.resolve([]))
  }

  // Source 2: TVMaze (TV Shows)
  if (filter === 'all' || filter === 'shows') {
    promises.push(
      searchTVMaze(q).then((results) =>
        results.map((r) => ({ ...r, sources: ['TVMaze'], tvmazeId: r.id }))
      )
    )
  } else {
    promises.push(Promise.resolve([]))
  }

  // Source 3: Wikipedia (Theatrical Movies)
  if (filter === 'all' || filter === 'movies') {
    promises.push(
      searchWikipediaMovies(q).then((results) =>
        results.map((r) => ({ ...r, sources: ['Wikipedia'], wikiId: r.id }))
      )
    )
  } else {
    promises.push(Promise.resolve([]))
  }

  // Await all sources concurrently
  const [tmdbRes, tvmazeRes, wikiRes] = await Promise.allSettled(promises)
  const tmdbItems = tmdbRes.status === 'fulfilled' ? tmdbRes.value : []
  const tvmazeItems = tvmazeRes.status === 'fulfilled' ? tvmazeRes.value : []
  const wikiItems = wikiRes.status === 'fulfilled' ? wikiRes.value : []

  // 2. Intelligent Multi-Source Merge by normalized title & type
  const mergedMap = new Map()

  function getNormKey(item) {
    const t = (item.title || item.name || '').toLowerCase().trim()
    return `${item.type || 'movie'}|${t}`
  }

  // First insert TMDB items (high baseline quality)
  for (const item of tmdbItems) {
    const key = getNormKey(item)
    mergedMap.set(key, item)
  }

  // Merge TVMaze items
  for (const item of tvmazeItems) {
    const key = getNormKey(item)
    if (mergedMap.has(key)) {
      const existing = mergedMap.get(key)
      if (!existing.sources.includes('TVMaze')) existing.sources.push('TVMaze')
      if (!existing.poster && item.poster) existing.poster = item.poster
      if (!existing.overview && item.overview) existing.overview = item.overview
      if (item.genres && item.genres.length > 0) {
        existing.genres = Array.from(new Set([...(existing.genres || []), ...item.genres]))
      }
      existing.tvmazeId = item.id
    } else {
      mergedMap.set(key, item)
    }
  }

  // Merge Wikipedia items
  for (const item of wikiItems) {
    const key = getNormKey(item)
    if (mergedMap.has(key)) {
      const existing = mergedMap.get(key)
      if (!existing.sources.includes('Wikipedia')) existing.sources.push('Wikipedia')
      if (!existing.overview && item.overview) existing.overview = item.overview
      if (!existing.poster && item.poster) existing.poster = item.poster
      existing.wikiId = item.id
    } else {
      mergedMap.set(key, item)
    }
  }

  const combined = Array.from(mergedMap.values())

  // Also check local curated sample items
  const qLower = q.toLowerCase()
  const sampleMatches = SAMPLE_MEDIA.filter(
    (item) => item.title.toLowerCase().includes(qLower) || item.genres.some((g) => g.toLowerCase().includes(qLower))
  )

  for (const sample of sampleMatches) {
    const key = getNormKey(sample)
    if (!mergedMap.has(key)) {
      combined.unshift({ ...sample, sources: ['Curated'] })
    }
  }

  return combined
}

/**
 * Fetches rich details for a movie or show across multiple sources (TMDB + TVMaze)
 * @param {'movie'|'show'} type
 * @param {number|string} [id]
 * @param {string} [title]
 * @param {string} [year]
 * @returns {Promise<Object|null>}
 */
export async function getTmdbDetails(type, id, title = '', year = '') {
  const apiKey = getTmdbApiKey()
  let result = null
  const sources = []

  // 1. Fetch from TMDB if apiKey is available
  if (apiKey) {
    try {
      let numericId = typeof id === 'number' ? id : null

      // If id is not numeric, search TMDB for the title first
      if (!numericId && title) {
        const searchEndpoint = type === 'movie' ? 'search/movie' : 'search/tv'
        const sRes = await fetch(
          `${TMDB_BASE_URL}/${searchEndpoint}?api_key=${encodeURIComponent(apiKey)}&query=${encodeURIComponent(title)}&include_adult=false`
        )
        if (sRes.ok) {
          const sData = await sRes.json()
          if (sData.results && sData.results.length > 0) {
            numericId = sData.results[0].id
          }
        }
      }

      if (numericId) {
        const endpoint = type === 'movie' ? 'movie' : 'tv'
        const url = `${TMDB_BASE_URL}/${endpoint}/${numericId}?api_key=${encodeURIComponent(apiKey)}&append_to_response=credits`
        const res = await fetch(url)
        if (res.ok) {
          const data = await res.json()
          const isMovie = type === 'movie'
          const itemTitle = isMovie ? data.title : data.name
          const releaseDate = isMovie ? data.release_date : data.first_air_date
          const itemYear = releaseDate ? releaseDate.slice(0, 4) : year

          // Extract Director from crew
          const director = (data.credits?.crew || []).find((c) => c.job === 'Director')?.name || ''

          // Extract top 8 cast members with character and photos
          const cast = (data.credits?.cast || []).slice(0, 8).map((c) => ({
            name: c.name,
            character: c.character,
            profile: c.profile_path ? getTmdbImageUrl(c.profile_path, 'w185') : '',
          }))

          sources.push('TMDB')

          result = {
            type,
            id: data.id,
            tmdbId: data.id,
            title: itemTitle,
            name: itemTitle,
            year: itemYear,
            overview: data.overview || '',
            poster: getTmdbImageUrl(data.poster_path, 'w500'),
            banner: getTmdbImageUrl(data.backdrop_path, 'original'),
            genres: (data.genres || []).map((g) => g.name),
            status: data.status,
            tagline: data.tagline,
            voteAverage: data.vote_average ? Number(data.vote_average.toFixed(1)) : null,
            runtime: isMovie ? data.runtime : (data.episode_run_time?.[0] || null),
            director,
            cast,
            seasons: data.number_of_seasons || null,
            episodes: data.number_of_episodes || null,
            sources,
          }
        }
      }
    } catch (tmdbErr) {
      console.warn('Failed to fetch TMDB details:', tmdbErr)
    }
  }

  // 2. Fetch from TVMaze for series to enrich network and schedule
  if (type === 'show' && (title || result?.title)) {
    try {
      const showTitle = title || result?.title
      const tvRes = await fetch(`https://api.tvmaze.com/singlesearch/shows?q=${encodeURIComponent(showTitle)}`)
      if (tvRes.ok) {
        const tvData = await tvRes.json()
        if (!result) {
          result = {
            type: 'show',
            id: `tvmaze-${tvData.id}`,
            title: tvData.name,
            name: tvData.name,
            year: tvData.premiered ? tvData.premiered.slice(0, 4) : year,
            overview: tvData.summary ? tvData.summary.replace(/<[^>]+>/g, '').trim() : '',
            poster: tvData.image?.original || tvData.image?.medium || '',
            banner: tvData.image?.original || '',
            genres: tvData.genres || [],
            sources: ['TVMaze'],
          }
        } else {
          if (!result.sources.includes('TVMaze')) result.sources.push('TVMaze')
          if (!result.poster && tvData.image?.original) result.poster = tvData.image.original
        }

        result.network = tvData.network?.name || tvData.webChannel?.name || null
        result.status = tvData.status || result.status
      }
    } catch (tvErr) {
      console.warn('TVMaze enrichment failed:', tvErr)
    }
  }

  // 3. Fallback to sample items if nothing was found
  if (!result) {
    const lookupKey = (title || String(id)).toLowerCase()
    const found = SAMPLE_MEDIA.find(
      (m) => m.type === type && (m.title.toLowerCase() === lookupKey || m.id === id)
    )
    if (found) {
      result = { ...found, sources: ['Curated'] }
    }
  }

  return result
}
