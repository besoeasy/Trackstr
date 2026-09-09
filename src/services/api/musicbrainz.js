/**
 * MusicBrainz API Service
 * 100% free open public REST API for music albums, artists, and releases.
 * Uses Cover Art Archive for album art.
 */

const USER_AGENT = 'Trackstr/1.0.0 (https://github.com/besoeasy/Trackstr)'

export const SAMPLE_MUSIC = [
  {
    type: 'music',
    title: 'Nevermind',
    artist: 'Nirvana',
    year: '1991',
    overview: 'Nevermind is the second studio album by American rock band Nirvana, released on September 24, 1991 by DGC Records.',
    poster: 'https://coverartarchive.org/release-group/1b022e01-a683-32e8-83eb-ee09825b7a08/front-500',
    banner: '',
    genres: ['Grunge', 'Alternative Rock'],
  },
  {
    type: 'music',
    title: 'The Dark Side of the Moon',
    artist: 'Pink Floyd',
    year: '1973',
    overview: 'The Dark Side of the Moon is the eighth studio album by the English rock band Pink Floyd, released on 1 March 1973.',
    poster: 'https://coverartarchive.org/release-group/a11d7f4e-e178-360e-b79e-c8e4268e3ef4/front-500',
    banner: '',
    genres: ['Progressive Rock', 'Psychedelic Rock'],
  },
  {
    type: 'music',
    title: 'OK Computer',
    artist: 'Radiohead',
    year: '1997',
    overview: 'OK Computer is the third studio album by the English alternative rock band Radiohead, released on 21 May 1997.',
    poster: 'https://coverartarchive.org/release-group/b9d4e1eb-e772-3511-b0db-6e69315570fe/front-500',
    banner: '',
    genres: ['Alternative Rock', 'Art Rock'],
  },
]

/**
 * Searches MusicBrainz for albums / releases
 * @param {string} query
 * @returns {Promise<Array<Object>>}
 */
export async function searchMusicBrainz(query) {
  if (!query || !query.trim()) return []

  try {
    const url = `https://musicbrainz.org/ws/2/release-group/?query=${encodeURIComponent(query)}&fmt=json&limit=15`
    const res = await fetch(url, {
      headers: {
        'User-Agent': USER_AGENT,
        Accept: 'application/json',
      },
    })

    if (!res.ok) {
      throw new Error(`MusicBrainz search error: ${res.statusText}`)
    }

    const data = await res.json()
    const releaseGroups = data['release-groups'] || []

    return releaseGroups.map((rg) => {
      const artistCredit = rg['artist-credit']?.[0]?.name || rg['artist-credit']?.[0]?.artist?.name || 'Unknown Artist'
      const year = rg['first-release-date'] ? rg['first-release-date'].slice(0, 4) : ''
      const poster = `https://coverartarchive.org/release-group/${rg.id}/front-500`

      return {
        type: 'music',
        id: rg.id,
        title: rg.title,
        artist: artistCredit,
        year,
        overview: rg['primary-type'] ? `${rg['primary-type']} by ${artistCredit}` : `Music by ${artistCredit}`,
        poster,
        banner: '',
        genres: (rg.tags || []).slice(0, 4).map((t) => t.name),
      }
    })
  } catch (err) {
    console.warn('MusicBrainz live search failed, falling back to samples:', err)
    const q = query.toLowerCase()
    return SAMPLE_MUSIC.filter(
      (m) =>
        m.title.toLowerCase().includes(q) ||
        m.artist.toLowerCase().includes(q) ||
        m.genres.some((g) => g.toLowerCase().includes(q))
    )
  }
}
