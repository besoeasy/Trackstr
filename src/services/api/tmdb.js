/**
 * TMDB API Service (Free API tier / free limits)
 * Supports client-side presentation metadata fetching.
 * Users can supply their free TMDB API key via VITE_TMDB_API_KEY or the in-app Settings modal.
 */

const TMDB_BASE_URL = 'https://api.themoviedb.org/3'
const TMDB_IMAGE_BASE = 'https://image.tmdb.org/t/p'

// Sample curated items available out-of-the-box so users can explore immediately
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
  return import.meta.env.VITE_TMDB_API_KEY || ''
}

export function getTmdbImageUrl(path, size = 'w500') {
  if (!path) return ''
  if (path.startsWith('http://') || path.startsWith('https://') || path.startsWith('ipfs://')) {
    return path
  }
  return `${TMDB_IMAGE_BASE}/${size}${path}`
}

/**
 * Searches TMDB for movies and TV shows
 * @param {string} query
 * @returns {Promise<Array<Object>>}
 */
export async function searchTmdb(query) {
  const apiKey = getTmdbApiKey()
  if (!apiKey) {
    // If no TMDB key is provided, filter sample items by search query
    const q = query.toLowerCase()
    return SAMPLE_MEDIA.filter(
      (item) => item.title.toLowerCase().includes(q) || item.genres.some((g) => g.toLowerCase().includes(q))
    )
  }

  const url = `${TMDB_BASE_URL}/search/multi?api_key=${encodeURIComponent(apiKey)}&query=${encodeURIComponent(query)}&include_adult=false`
  const res = await fetch(url)
  if (!res.ok) {
    throw new Error(`TMDB search error (${res.status}): ${res.statusText}`)
  }

  const data = await res.json()
  const results = (data.results || []).filter((item) => item.media_type === 'movie' || item.media_type === 'tv')

  return results.map((item) => {
    const isMovie = item.media_type === 'movie'
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

/**
 * Fetches full details for a movie or show by TMDB ID
 * @param {'movie'|'show'} type
 * @param {number|string} id
 */
export async function getTmdbDetails(type, id) {
  const apiKey = getTmdbApiKey()
  if (!apiKey) {
    const found = SAMPLE_MEDIA.find((m) => m.type === type && (m.title.toLowerCase() === String(id).toLowerCase() || m.id === id))
    return found || null
  }

  const endpoint = type === 'movie' ? 'movie' : 'tv'
  const url = `${TMDB_BASE_URL}/${endpoint}/${id}?api_key=${encodeURIComponent(apiKey)}&append_to_response=credits`
  const res = await fetch(url)
  if (!res.ok) {
    throw new Error(`TMDB details error (${res.status}): ${res.statusText}`)
  }

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
