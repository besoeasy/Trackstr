// @vitest-environment happy-dom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import {
  searchMusic,
  searchItunesTracks,
  searchItunesAlbums,
  searchItunesByArtist,
  searchMusicBrainz,
  searchAudius,
  getMusicDetails,
} from '@/services/api/music.js'

describe('Music API multi-provider service', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  describe('searchMusic() input validation', () => {
    it('returns an empty array when query is empty or whitespace', async () => {
      expect(await searchMusic('')).toEqual([])
      expect(await searchMusic('   ')).toEqual([])
      expect(await searchMusic(null)).toEqual([])
    })
  })

  describe('searchItunesTracks()', () => {
    it('fetches and maps tracks from iTunes API with 600x600 artwork', async () => {
      const mockResponse = {
        resultCount: 1,
        results: [
          {
            wrapperType: 'track',
            kind: 'song',
            trackId: 1829591986,
            artistName: 'Karan Aujla & Ikky',
            trackName: 'Boyfriend',
            collectionName: 'P-POP CULTURE',
            artworkUrl100: 'https://is1-ssl.mzstatic.com/image/thumb/Music221/100x100bb.jpg',
            releaseDate: '2025-08-22T12:00:00Z',
            primaryGenreName: 'Pop',
            previewUrl: 'https://audio-ssl.itunes.apple.com/preview.m4a',
          },
        ],
      }

      vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
        ok: true,
        json: async () => mockResponse,
      }))

      const results = await searchItunesTracks('karan aujla boyfriend')
      expect(results).toHaveLength(1)
      expect(results[0].title).toBe('Boyfriend')
      expect(results[0].artist).toBe('Karan Aujla & Ikky')
      expect(results[0].album).toBe('P-POP CULTURE')
      expect(results[0].year).toBe('2025')
      expect(results[0].poster).toBe('https://is1-ssl.mzstatic.com/image/thumb/Music221/600x600bb.jpg')
      expect(results[0].sources).toContain('iTunes')
      expect(results[0].previewUrl).toBe('https://audio-ssl.itunes.apple.com/preview.m4a')
    })
  })

  describe('searchMusic() multi-provider aggregation & deduplication', () => {
    it('combines results from multiple providers and merges sources on duplicates', async () => {
      vi.stubGlobal('fetch', vi.fn().mockImplementation(async (url) => {
        const u = String(url)
        if (u.includes('itunes.apple.com') && u.includes('entity=song')) {
          return {
            ok: true,
            json: async () => ({
              resultCount: 1,
              results: [
                {
                  trackId: 101,
                  artistName: 'Karan Aujla',
                  trackName: 'Boyfriend',
                  collectionName: 'Single',
                  releaseDate: '2025-08-22T00:00:00Z',
                  artworkUrl100: 'https://img.itunes.com/100x100bb.jpg',
                },
              ],
            }),
          }
        }
        if (u.includes('itunes.apple.com') && u.includes('entity=album')) {
          return {
            ok: true,
            json: async () => ({
              resultCount: 1,
              results: [
                {
                  collectionId: 202,
                  artistName: 'Karan Aujla',
                  collectionName: 'Making Memories',
                  releaseDate: '2023-08-18T00:00:00Z',
                  trackCount: 9,
                  artworkUrl100: 'https://img.itunes.com/album100x100bb.jpg',
                },
              ],
            }),
          }
        }
        if (u.includes('musicbrainz.org')) {
          return {
            ok: true,
            json: async () => ({
              'release-groups': [
                {
                  id: 'mb-1',
                  title: 'Making Memories',
                  'artist-credit': [{ name: 'Karan Aujla' }],
                  'first-release-date': '2023-08-18',
                },
              ],
              recordings: [],
            }),
          }
        }
        return {
          ok: true,
          json: async () => ({ data: [] }),
        }
      }))

      const results = await searchMusic('karan aujla')
      expect(results.length).toBeGreaterThanOrEqual(2)

      // Boyfriend track found
      const boyfriend = results.find((r) => r.title === 'Boyfriend')
      expect(boyfriend).toBeDefined()
      expect(boyfriend.artist).toBe('Karan Aujla')
      expect(boyfriend.sources).toContain('iTunes')

      // Making Memories album found and sources merged with MusicBrainz
      const album = results.find((r) => r.title === 'Making Memories')
      expect(album).toBeDefined()
      expect(album.sources).toContain('iTunes')
      expect(album.sources).toContain('MusicBrainz')
    })

    it('resiliently handles MusicBrainz 503 error without failing other providers', async () => {
      vi.stubGlobal('fetch', vi.fn().mockImplementation(async (url) => {
        const u = String(url)
        if (u.includes('musicbrainz.org')) {
          return {
            ok: false,
            status: 503,
            statusText: 'Service Unavailable',
          }
        }
        if (u.includes('itunes.apple.com') && u.includes('entity=song')) {
          return {
            ok: true,
            json: async () => ({
              resultCount: 1,
              results: [
                {
                  trackId: 101,
                  artistName: 'Karan Aujla',
                  trackName: 'Boyfriend',
                  releaseDate: '2025-08-22T00:00:00Z',
                },
              ],
            }),
          }
        }
        return {
          ok: true,
          json: async () => ({ results: [], data: [] }),
        }
      }))

      const results = await searchMusic('karan aujla boyfriend')
      expect(results).toHaveLength(1)
      expect(results[0].title).toBe('Boyfriend')
      expect(results[0].sources).toContain('iTunes')
    })
  })

  describe('searchItunesByArtist()', () => {
    it('discovers tracks by resolving artist first then matching discography', async () => {
      vi.stubGlobal('fetch', vi.fn().mockImplementation(async (url) => {
        const u = String(url)
        if (u.includes('entity=musicArtist')) {
          return {
            ok: true,
            json: async () => ({
              resultCount: 1,
              results: [
                {
                  wrapperType: 'artist',
                  artistName: 'Addy Nagar',
                  artistId: 1123627240,
                },
              ],
            }),
          }
        }
        if (u.includes('lookup?id=1123627240')) {
          return {
            ok: true,
            json: async () => ({
              resultCount: 2,
              results: [
                {
                  wrapperType: 'track',
                  trackId: 1783301802,
                  artistName: 'Addy Nagar',
                  trackName: 'No Guts No Glory',
                  collectionName: 'No Guts No Glory - Single',
                  artworkUrl100: 'https://img.itunes.com/100x100bb.jpg',
                  releaseDate: '2024-12-10T00:00:00Z',
                  primaryGenreName: 'Alternative Rap',
                },
                {
                  wrapperType: 'track',
                  trackId: 1640457326,
                  artistName: 'Addy Nagar',
                  trackName: 'Naach',
                  collectionName: 'Naach - Single',
                  artworkUrl100: 'https://img.itunes.com/100x100bb.jpg',
                  releaseDate: '2019-11-12T00:00:00Z',
                  primaryGenreName: 'Indian Pop',
                },
              ],
            }),
          }
        }
        return { ok: true, json: async () => ({ results: [] }) }
      }))

      const results = await searchItunesByArtist('no guts no glory addy nagar')
      expect(results.length).toBeGreaterThanOrEqual(1)
      expect(results[0].title).toBe('No Guts No Glory')
      expect(results[0].artist).toBe('Addy Nagar')
      expect(results[0].sources).toContain('iTunes')
    })
  })

  describe('getMusicDetails()', () => {
    it('retrieves matching item details by artist and title', async () => {
      vi.stubGlobal('fetch', vi.fn().mockImplementation(async (url) => {
        const u = String(url)
        if (u.includes('itunes.apple.com')) {
          return {
            ok: true,
            json: async () => ({
              resultCount: 1,
              results: [
                {
                  trackId: 555,
                  artistName: 'Karan Aujla',
                  trackName: 'Boyfriend',
                  collectionName: 'P-POP CULTURE',
                  releaseDate: '2025-08-22T00:00:00Z',
                  primaryGenreName: 'Pop',
                  artworkUrl100: 'https://img.itunes.com/100x100bb.jpg',
                },
              ],
            }),
          }
        }
        return { ok: true, json: async () => ({ results: [], data: [] }) }
      }))

      const details = await getMusicDetails({ title: 'Boyfriend', artist: 'Karan Aujla' })
      expect(details).toBeDefined()
      expect(details.title).toBe('Boyfriend')
      expect(details.artist).toBe('Karan Aujla')
      expect(details.album).toBe('P-POP CULTURE')
    })
  })
})
