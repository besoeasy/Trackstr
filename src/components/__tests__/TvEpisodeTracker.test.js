// @vitest-environment happy-dom
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import TvEpisodeTracker from '@/components/TvEpisodeTracker.vue'
import { useAuthStore } from '@/stores/auth.js'
import { useMediaStore } from '@/stores/media.js'

const mockEpisodesData = {
  source: 'TVMaze',
  totalEpisodes: 3,
  seasons: [
    {
      seasonNumber: 1,
      name: 'Season 1',
      episodeCount: 2,
      episodes: [
        {
          id: 'tvmaze-ep-1',
          season: 1,
          episode: 1,
          name: 'Pilot',
          airDate: '2022-02-18',
          runtime: 57,
          summary: 'Episode 1 summary',
          still: '',
          rating: 8.0,
        },
        {
          id: 'tvmaze-ep-2',
          season: 1,
          episode: 2,
          name: 'Half Loop',
          airDate: '2022-02-25',
          runtime: 53,
          summary: 'Episode 2 summary',
          still: '',
          rating: 8.5,
        },
      ],
    },
    {
      seasonNumber: 2,
      name: 'Season 2',
      episodeCount: 1,
      episodes: [
        {
          id: 'tvmaze-ep-3',
          season: 2,
          episode: 1,
          name: 'S2 Premiere',
          airDate: '2024-01-01',
          runtime: 60,
          summary: 'Season 2 summary',
          still: '',
          rating: 9.0,
        },
      ],
    },
  ],
}

vi.mock('@/services/api/tv.js', () => ({
  fetchShowEpisodes: vi.fn(() => Promise.resolve(mockEpisodesData)),
}))

vi.mock('@/services/nostr/client.js', () => ({
  nostrClient: {
    queryEvents: vi.fn(() => Promise.resolve([])),
    publish: vi.fn(() => Promise.resolve({ publishedTo: ['wss://relay.example.com'] })),
    signEvent: vi.fn((template) => Promise.resolve({ ...template, id: 'mock-signed-id', sig: 'mock-sig' })),
    getDiagnostics: vi.fn(() => ({})),
    getRelays: vi.fn(() => []),
    resetConnections: vi.fn(),
  },
}))

describe('TvEpisodeTracker.vue', () => {
  const CID = '11'.repeat(32)
  const mockMedia = {
    contentId: CID,
    type: 'show',
    title: 'Severance',
    name: 'Severance',
    year: '2022',
  }

  let pinia
  let authStore
  let mediaStore

  beforeEach(() => {
    pinia = createPinia()
    setActivePinia(pinia)
    authStore = useAuthStore()
    mediaStore = useMediaStore()

    authStore.pubkey = 'aa'.repeat(32)
  })

  it('renders season pills and episodes after loading', async () => {
    const wrapper = mount(TvEpisodeTracker, {
      props: {
        media: mockMedia,
        contentId: CID,
      },
    })

    await flushPromises()

    // Season pills
    const seasonPills = wrapper.findAll('.season-pill-btn')
    expect(seasonPills.length).toBe(2)
    expect(seasonPills[0].text()).toContain('Season 1')
    expect(seasonPills[1].text()).toContain('Season 2')

    // Current season episodes
    const episodeCards = wrapper.findAll('.episode-card')
    expect(episodeCards.length).toBe(2)
    expect(episodeCards[0].text()).toContain('1. Pilot')
    expect(episodeCards[1].text()).toContain('2. Half Loop')

    // Progress
    expect(wrapper.find('.progress-stats').text()).toContain('0 of 2 watched (0%)')
  })

  it('switches seasons when clicking another season pill', async () => {
    const wrapper = mount(TvEpisodeTracker, {
      props: {
        media: mockMedia,
        contentId: CID,
      },
    })

    await flushPromises()

    const seasonPills = wrapper.findAll('.season-pill-btn')
    await seasonPills[1].trigger('click')

    const episodeCards = wrapper.findAll('.episode-card')
    expect(episodeCards.length).toBe(1)
    expect(episodeCards[0].text()).toContain('1. S2 Premiere')
  })

  it('toggles an unwatched episode to watched (calls mediaStore.setStatus)', async () => {
    const setStatusSpy = vi.spyOn(mediaStore, 'setStatus').mockResolvedValue({})

    const wrapper = mount(TvEpisodeTracker, {
      props: {
        media: mockMedia,
        contentId: CID,
      },
    })

    await flushPromises()

    const watchBtn = wrapper.findAll('.ep-watch-toggle-btn')[0]
    expect(watchBtn.text()).toContain('Watch')

    await watchBtn.trigger('click')
    await flushPromises()

    expect(setStatusSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        contentId: CID,
        type: 'episode',
        season: 1,
        episode: 1,
      }),
      'completed',
      's1e1'
    )
  })

  it('toggles a watched episode to unwatched (calls deleteTrackstrEvent)', async () => {
    // Pre-populate store with watched status
    const authorKey = `${authStore.pubkey}:${CID}:s1e1`
    mediaStore.statuses[authorKey] = {
      dTag: `${CID}:s1e1`,
      contentId: CID,
      status: 'completed',
      eventId: 'evt-s1e1',
      createdAt: 1000,
      pubkey: authStore.pubkey,
    }

    const deleteSpy = vi.spyOn(mediaStore, 'deleteTrackstrEvent').mockResolvedValue({})

    const wrapper = mount(TvEpisodeTracker, {
      props: {
        media: mockMedia,
        contentId: CID,
      },
    })

    await flushPromises()

    expect(wrapper.find('.progress-stats').text()).toContain('1 of 2 watched (50%)')

    const watchBtn = wrapper.findAll('.ep-watch-toggle-btn')[0]
    expect(watchBtn.text()).toContain('✓ Watched')

    await watchBtn.trigger('click')
    await flushPromises()

    expect(deleteSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        coordinate: `35402:${authStore.pubkey}:${CID}:s1e1`,
        reason: 'Untracked episode',
      })
    )
  })

  it('batch marks an entire season as watched and auto-promotes show', async () => {
    const setStatusSpy = vi.spyOn(mediaStore, 'setStatus').mockResolvedValue({})

    const wrapper = mount(TvEpisodeTracker, {
      props: {
        media: mockMedia,
        contentId: CID,
      },
    })

    await flushPromises()

    const batchBtn = wrapper.find('.batch-btn')
    expect(batchBtn.text()).toContain('✓ Mark Season Watched')

    await batchBtn.trigger('click')
    await flushPromises()

    // 2 episodes marked completed, plus auto-promoting the parent show to 'watching'
    expect(setStatusSpy).toHaveBeenCalledTimes(3)
    expect(setStatusSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        contentId: CID,
        type: 'show',
      }),
      'watching'
    )
  })

  it('honors targetSeason and targetEpisode props', async () => {
    const wrapper = mount(TvEpisodeTracker, {
      props: {
        media: mockMedia,
        contentId: CID,
        targetSeason: 2,
        targetEpisode: 1,
      },
    })

    await flushPromises()

    // Season 2 should be active
    const activePill = wrapper.find('.season-pill-btn.active')
    expect(activePill.text()).toContain('Season 2')

    // S2E1 episode card should have is-target-episode class
    const targetCard = wrapper.find('.episode-card.is-target-episode')
    expect(targetCard.exists()).toBe(true)
    expect(targetCard.text()).toContain('1. S2 Premiere')
  })

  it('displays Up Next banner and allows one-click completion', async () => {
    const setStatusSpy = vi.spyOn(mediaStore, 'setStatus').mockResolvedValue({})

    const wrapper = mount(TvEpisodeTracker, {
      props: {
        media: mockMedia,
        contentId: CID,
      },
    })

    await flushPromises()

    const upNextCard = wrapper.find('.up-next-card')
    expect(upNextCard.exists()).toBe(true)
    expect(upNextCard.text()).toContain('S01E01')
    expect(upNextCard.text()).toContain('Pilot')

    // Click "✓ Watched" on the Up Next card
    const upNextBtn = wrapper.find('.up-next-action-btn')
    await upNextBtn.trigger('click')
    await flushPromises()

    expect(setStatusSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        contentId: CID,
        type: 'episode',
        season: 1,
        episode: 1,
      }),
      'completed',
      's1e1'
    )
  })

  it('supports Specials (Season 0) and adding custom specials', async () => {
    const wrapper = mount(TvEpisodeTracker, {
      props: {
        media: mockMedia,
        contentId: CID,
      },
    })

    await flushPromises()

    // Click "+ Specials" to add Season 0
    const specialsBtn = wrapper.findAll('.season-action-btn').find((btn) => btn.text().includes('+ Specials'))
    expect(specialsBtn).toBeDefined()
    await specialsBtn.trigger('click')
    await flushPromises()

    // Active season should now be Specials
    const activePill = wrapper.find('.season-pill-btn.active')
    expect(activePill.text()).toContain('Specials')

    // An episode card for Special 1 should exist
    const epCards = wrapper.findAll('.episode-card')
    expect(epCards.length).toBe(1)
    expect(epCards[0].text()).toContain('Special 1')
    expect(epCards[0].text()).toContain('S00E01')
  })
})
