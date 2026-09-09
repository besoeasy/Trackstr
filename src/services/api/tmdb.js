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

export function getTmdbApiKey() {
  if (typeof window !== 'undefined') {
    const saved = localStorage.getItem('trackstr_tmdb_api_key')
    if (saved && saved.trim()) return saved.trim()
  }
  return (typeof import.meta !== 'undefined' && import.meta?.env?.VITE_TMDB_API_KEY) || ''
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
export async function searchTmdb(query, filter = 'all') {
  if (!query || !query.trim()) return []
  const apiKey = getTmdbApiKey()

  // 1. If user provided a TMDB API key, use TMDB directly
  if (apiKey) {
    try {
      let endpoint = `${TMDB_BASE_URL}/search/multi?api_key=${encodeURIComponent(apiKey)}&query=${encodeURIComponent(query)}&include_adult=false`
      if (filter === 'movies') {
        endpoint = `${TMDB_BASE_URL}/search/movie?api_key=${encodeURIComponent(apiKey)}&query=${encodeURIComponent(query)}&include_adult=false`
      } else if (filter === 'shows') {
        endpoint = `${TMDB_BASE_URL}/search/tv?api_key=${encodeURIComponent(apiKey)}&query=${encodeURIComponent(query)}&include_adult=false`
      }

      const res = await fetch(endpoint)
      if (res.ok) {
        const data = await res.json()
        const results = (data.results || []).filter((item) => {
          if (filter === 'movies') return true
          if (filter === 'shows') return true
          return item.media_type === 'movie' || item.media_type === 'tv'
        })

        if (results.length > 0) {
          return results.map((item) => {
            const isMovie = filter === 'movies' ? true : filter === 'shows' ? false : item.media_type === 'movie'
            const title = isMovie ? item.title : item.name
            const releaseDate = isMovie ? item.release_date : item.first_air_date
            const year = releaseDate ? releaseDate.slice(0, 4) : ''

            return {
              type: isMovie ? 'movie' : 'show',
              id: item.id,
              title: title || 'Untitled',
              year,
              overview: item.overview || '',
              poster: getTmdbImageUrl(item.poster_path, 'w500'),
              banner: getTmdbImageUrl(item.backdrop_path, 'original'),
              genres: [],
            }
          })
        }
      }
    } catch (err) {
      console.warn('TMDB search failed, falling back to open providers:', err)
    }
  }

  // 2. Open Free Providers (No API key needed)
  const openPromises = []
  if (filter === 'all' || filter === 'shows') {
    openPromises.push(searchTVMaze(query))
  }
  if (filter === 'all' || filter === 'movies') {
    openPromises.push(searchWikipediaMovies(query))
  }

  const [tvResults, movieResults] = await Promise.all([
    (filter === 'all' || filter === 'shows') ? searchTVMaze(query) : Promise.resolve([]),
    (filter === 'all' || filter === 'movies') ? searchWikipediaMovies(query) : Promise.resolve([]),
  ])

  let combined = [...tvResults, ...movieResults]

  // Also check local curated sample items
  const q = query.toLowerCase()
  const sampleMatches = SAMPLE_MEDIA.filter(
    (item) => item.title.toLowerCase().includes(q) || item.genres.some((g) => g.toLowerCase().includes(q))
  )

  // Prepend sample matches if not already in combined
  for (const sample of sampleMatches) {
    if (!combined.some((c) => c.title.toLowerCase() === sample.title.toLowerCase())) {
      combined.unshift(sample)
    }
  }

  return combined
}

/**
 * Fetches full details for a movie or show by ID
 * @param {'movie'|'show'} type
 * @param {number|string} id
 */
export async function getTmdbDetails(type, id) {
  const apiKey = getTmdbApiKey()
  if (apiKey && typeof id === 'number') {
    try {
      const endpoint = type === 'movie' ? 'movie' : 'tv'
      const url = `${TMDB_BASE_URL}/${endpoint}/${id}?api_key=${encodeURIComponent(apiKey)}&append_to_response=credits`
      const res = await fetch(url)
      if (res.ok) {
        const data = await res.json()
        const isMovie = type === 'movie'
        const title = isMovie ? data.title : data.name
        const releaseDate = isMovie ? data.release_date : data.first_air_date
        const year = releaseDate ? releaseDate.slice(0, 4) : ''

        return {
          type,
          id: data.id,
          title,
          year,
          overview: data.overview || '',
          poster: getTmdbImageUrl(data.poster_path, 'w500'),
          banner: getTmdbImageUrl(data.backdrop_path, 'original'),
          genres: (data.genres || []).map((g) => g.name),
          status: data.status,
          tagline: data.tagline,
        }
      }
    } catch {}
  }

  const found = SAMPLE_MEDIA.find((m) => m.type === type && (m.title.toLowerCase() === String(id).toLowerCase() || m.id === id))
  return found || null
}
