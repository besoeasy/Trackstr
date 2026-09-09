// @vitest-environment happy-dom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import {
  stripHtml,
  normalizeEpisode,
  groupEpisodesBySeason,
  fetchShowEpisodes,
  clearEpisodeCache,
} from '@/services/api/tv.js'

describe('TV Seasons and Episodes API Service', () => {
  beforeEach(() => {
    clearEpisodeCache()
    vi.restoreAllMocks()
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  describe('stripHtml()', () => {
    it('strips html tags from summaries and trims output', () => {
      expect(stripHtml('<p>Hello <b>World</b></p>')).toBe('Hello World')
      expect(stripHtml('<div>   Episode synopsis   </div>')).toBe('Episode synopsis')
      expect(stripHtml('')).toBe('')
      expect(stripHtml(null)).toBe('')
    })
  })

  describe('normalizeEpisode()', () => {
    it('normalizes TVMaze episode format', () => {
      const raw = {
        id: 1234,
        season: 1,
        number: 3,
        name: 'Declaration of Principles',
        airdate: '2022-03-04',
        runtime: 55,
        rating: { average: 8.5 },
        image: {
          medium: 'https://tvmaze.com/med.jpg',
          original: 'https://tvmaze.com/orig.jpg',
        },
        summary: '<p>A deep look into the principles.</p>',
      }

      const ep = normalizeEpisode(raw, 'tvmaze')
      expect(ep.id).toBe('tvmaze-ep-1234')
      expect(ep.season).toBe(1)
      expect(ep.episode).toBe(3)
      expect(ep.title).toBe('Declaration of Principles')
      expect(ep.airDate).toBe('2022-03-04')
      expect(ep.runtime).toBe(55)
      expect(ep.rating).toBe(8.5)
      expect(ep.still).toBe('https://tvmaze.com/orig.jpg')
      expect(ep.summary).toBe('A deep look into the principles.')
    })

    it('normalizes TMDB episode format', () => {
      const raw = {
        id: 5678,
        season_number: 2,
        episode_number: 1,
        name: 'The Return',
        air_date: '2024-01-10',
        runtime: 48,
        vote_average: 7.9,
        still_path: '/still123.jpg',
        overview: 'The crew returns.',
      }

      const ep = normalizeEpisode(raw, 'tmdb')
      expect(ep.id).toBe('tmdb-ep-5678')
      expect(ep.season).toBe(2)
      expect(ep.episode).toBe(1)
      expect(ep.title).toBe('The Return')
      expect(ep.airDate).toBe('2024-01-10')
      expect(ep.runtime).toBe(48)
      expect(ep.rating).toBe(7.9)
      expect(ep.still).toContain('/still123.jpg')
      expect(ep.summary).toBe('The crew returns.')
    })
  })

  describe('groupEpisodesBySeason()', () => {
    it('groups flat episodes into ordered seasons with specials at the end', () => {
      const episodes = [
        { season: 2, episode: 2, name: 'S2E2' },
        { season: 1, episode: 2, name: 'S1E2' },
        { season: 1, episode: 1, name: 'S1E1' },
        { season: 0, episode: 1, name: 'Special 1' },
        { season: 2, episode: 1, name: 'S2E1' },
      ]

      const grouped = groupEpisodesBySeason(episodes)
      expect(grouped).toHaveLength(3)

      // Season 1
      expect(grouped[0].seasonNumber).toBe(1)
      expect(grouped[0].name).toBe('Season 1')
      expect(grouped[0].episodeCount).toBe(2)
      expect(grouped[0].episodes[0].name).toBe('S1E1')
      expect(grouped[0].episodes[1].name).toBe('S1E2')

      // Season 2
      expect(grouped[1].seasonNumber).toBe(2)
      expect(grouped[1].name).toBe('Season 2')
      expect(grouped[1].episodeCount).toBe(2)
      expect(grouped[1].episodes[0].name).toBe('S2E1')

      // Specials (Season 0)
      expect(grouped[2].seasonNumber).toBe(0)
      expect(grouped[2].name).toBe('Specials')
      expect(grouped[2].episodeCount).toBe(1)
      expect(grouped[2].episodes[0].name).toBe('Special 1')
    })
  })

  describe('fetchShowEpisodes()', () => {
    it('fetches episodes via TVMaze singlesearch with embedded episodes', async () => {
      const mockTvMaze = {
        id: 44933,
        name: 'Severance',
        _embedded: {
          episodes: [
            {
              id: 101,
              season: 1,
              number: 1,
              name: 'Good News About Hell',
              airdate: '2022-02-18',
              summary: '<p>Mark is promoted.</p>',
            },
            {
              id: 102,
              season: 1,
              number: 2,
              name: 'Half Loop',
              airdate: '2022-02-18',
              summary: '<p>Helly arrives.</p>',
            },
          ],
        },
      }

      vi.stubGlobal(
        'fetch',
        vi.fn().mockResolvedValue({
          ok: true,
          json: async () => mockTvMaze,
        })
      )

      const result = await fetchShowEpisodes({ title: 'Severance' })
      expect(result.source).toBe('TVMaze')
      expect(result.totalEpisodes).toBe(2)
      expect(result.seasons).toHaveLength(1)
      expect(result.seasons[0].name).toBe('Season 1')
      expect(result.seasons[0].episodes).toHaveLength(2)
      expect(result.seasons[0].episodes[0].name).toBe('Good News About Hell')
    })

    it('returns empty result gracefully when fetch fails', async () => {
      vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('Network error')))

      const result = await fetchShowEpisodes({ title: 'Unknown Nonexistent Show' })
      expect(result.totalEpisodes).toBe(0)
      expect(result.seasons).toEqual([])
    })
  })
})
