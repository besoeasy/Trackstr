/**
 * MusicBrainz API Service
 * 100% free open public REST API for music albums, artists, and releases.
 * Uses Cover Art Archive for album art.
 */

const USER_AGENT = 'Trackstr/1.0.0 (https://github.com/besoeasy/Trackstr)'

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
    console.warn('MusicBrainz live search failed:', err)
    return []
  }
}
