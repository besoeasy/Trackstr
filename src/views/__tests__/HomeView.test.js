// @vitest-environment happy-dom
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import HomeView from '@/views/HomeView.vue'
import { useAuthStore } from '@/stores/auth.js'
import { useMediaStore } from '@/stores/media.js'

vi.mock('vue-router', async (importOriginal) => {
  const actual = await importOriginal()
  return {
    ...actual,
    useRoute: () => ({ query: {} }),
    useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
    RouterLink: {
      template: '<a><slot /></a>',
    },
  }
})

vi.mock('@/services/api/tmdb.js', () => ({
  searchTmdb: vi.fn().mockResolvedValue([]),
  getTmdbDetails: vi.fn().mockResolvedValue(null),
}))

vi.mock('@/services/api/music.js', () => ({
  searchMusic: vi.fn().mockResolvedValue([]),
  getMusicDetails: vi.fn().mockResolvedValue(null),
}))

vi.mock('@/services/api/tv.js', () => ({
  fetchShowEpisodes: vi.fn().mockResolvedValue({ seasons: [] }),
}))

vi.mock('@/services/nostr/client.js', () => ({
  nostrClient: {
    queryEvents: vi.fn().mockResolvedValue([]),
    publish: vi.fn().mockResolvedValue({ publishedTo: [], errors: [] }),
    signEvent: vi.fn(),
    resetConnections: vi.fn(),
    getRelays: vi.fn(() => []),
    getDiagnostics: vi.fn(() => ({})),
  },
}))

describe('HomeView - Recommended for You', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
  })

  it('limits recommended items to maximum 5 items per category', async () => {
    const authStore = useAuthStore()
    const mediaStore = useMediaStore()

    // Simulate logged in user
    authStore.pubkey = '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef'

    // Generate 10 mock items per category
    const mockMovies = Array.from({ length: 10 }, (_, i) => ({
      contentId: `movie-${i}`,
      type: 'movie',
      name: `Movie ${i}`,
      year: 2020 + i,
      eventCount: 10 - i,
    }))
    const mockShows = Array.from({ length: 10 }, (_, i) => ({
      contentId: `show-${i}`,
      type: 'show',
      name: `Show ${i}`,
      year: 2020 + i,
      eventCount: 10 - i,
    }))
    const mockMusic = Array.from({ length: 10 }, (_, i) => ({
      contentId: `music-${i}`,
      type: 'music',
      name: `Song ${i}`,
      year: 2020 + i,
      eventCount: 10 - i,
    }))

    vi.spyOn(mediaStore, 'fetchPopularMediaFromEvents').mockImplementation(async ({ type }) => {
      if (type === 'movie') return mockMovies
      if (type === 'show') return mockShows
      if (type === 'music') return mockMusic
      return []
    })

    const wrapper = mount(HomeView, {
      global: {
        stubs: {
          MediaCard: true,
          RecommendationCard: {
            props: ['item'],
            template: '<div class="recommendation-card-stub">{{ item.name }}</div>',
          },
          RouterLink: true,
        },
      },
    })

    await flushPromises()

    // Find all recommendation rows
    const rows = wrapper.findAll('.recommendation-row')
    expect(rows.length).toBe(3)

    // Verify each category row renders at most 5 items
    for (const row of rows) {
      const cards = row.findAll('.recommendation-card-stub')
      expect(cards.length).toBeLessThanOrEqual(5)
      expect(cards.length).toBe(5)
    }
  })

  it('feeds Kind 35401 community suggestions into recommendations based on user-liked media', async () => {
    const authStore = useAuthStore()
    const mediaStore = useMediaStore()

    const USER_PUBKEY = '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef'
    const SEED_CID = 'aa'.repeat(32)
    const SUGGESTED_CID = 'bb'.repeat(32)
    const WATCHED_CID = 'cc'.repeat(32)

    authStore.pubkey = USER_PUBKEY

    // User rated Fight Club 9/10
    mediaStore.ratings[`${USER_PUBKEY}:${SEED_CID}`] = {
      contentId: SEED_CID,
      dTag: SEED_CID,
      pubkey: USER_PUBKEY,
      rating: 9,
      media: { contentId: SEED_CID, type: 'movie', name: 'Fight Club', title: 'Fight Club', year: '1999' },
    }

    // Community suggested The Matrix and WatchedMovie for Fight Club
    mediaStore.suggestions[`stranger:${SEED_CID}`] = {
      contentId: SEED_CID,
      dTag: SEED_CID,
      pubkey: 'stranger',
      items: [
        { contentId: SUGGESTED_CID, type: 'movie', name: 'The Matrix', title: 'The Matrix', year: '1999' },
        { contentId: WATCHED_CID, type: 'movie', name: 'Watched Movie', title: 'Watched Movie', year: '2000' },
      ],
      media: { contentId: SEED_CID, type: 'movie', name: 'Fight Club', title: 'Fight Club', year: '1999' },
      createdAt: 1000,
    }

    // User already watched WatchedMovie
    mediaStore.statuses[`${USER_PUBKEY}:${WATCHED_CID}`] = {
      contentId: WATCHED_CID,
      dTag: WATCHED_CID,
      pubkey: USER_PUBKEY,
      status: 'completed',
      media: { contentId: WATCHED_CID, type: 'movie', name: 'Watched Movie', title: 'Watched Movie', year: '2000' },
    }

    vi.spyOn(mediaStore, 'fetchPopularMediaFromEvents').mockResolvedValue([])

    const wrapper = mount(HomeView, {
      global: {
        stubs: {
          MediaCard: true,
          RecommendationCard: {
            props: ['item'],
            template: '<div class="rec-card-stub" :data-cid="item.contentId" :data-category="item.category" :data-reason="item.reason">{{ item.name }}</div>',
          },
          RouterLink: true,
        },
      },
    })

    await flushPromises()

    const cards = wrapper.findAll('.rec-card-stub')
    const matrixCard = cards.find((c) => c.attributes('data-cid') === SUGGESTED_CID)

    // The Matrix should be recommended
    expect(matrixCard).toBeDefined()
    expect(matrixCard?.attributes('data-category')).toBe('community-suggestion')
    expect(matrixCard?.attributes('data-reason')).toContain('Because you liked Fight Club')

    // Watched Movie should NOT be recommended since user already completed it
    const watchedCard = cards.find((c) => c.attributes('data-cid') === WATCHED_CID)
    expect(watchedCard).toBeUndefined()
  })

  it('excludes dropped or low-rated titles from seeding recommendations', async () => {
    const authStore = useAuthStore()
    const mediaStore = useMediaStore()

    const USER_PUBKEY = '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef'
    const DISLIKED_CID = '11'.repeat(32)
    const SUGGESTED_CID = '22'.repeat(32)

    authStore.pubkey = USER_PUBKEY

    // User rated movie 3/10 (disliked)
    mediaStore.ratings[`${USER_PUBKEY}:${DISLIKED_CID}`] = {
      contentId: DISLIKED_CID,
      dTag: DISLIKED_CID,
      pubkey: USER_PUBKEY,
      rating: 3,
      media: { contentId: DISLIKED_CID, type: 'movie', name: 'Bad Movie', title: 'Bad Movie', year: '2005' },
    }

    // Community suggestion attached to the disliked movie
    mediaStore.suggestions[`stranger:${DISLIKED_CID}`] = {
      contentId: DISLIKED_CID,
      dTag: DISLIKED_CID,
      pubkey: 'stranger',
      items: [
        { contentId: SUGGESTED_CID, type: 'movie', name: 'Similar To Bad', title: 'Similar To Bad', year: '2006' },
      ],
      media: { contentId: DISLIKED_CID, type: 'movie', name: 'Bad Movie', title: 'Bad Movie', year: '2005' },
      createdAt: 1000,
    }

    vi.spyOn(mediaStore, 'fetchPopularMediaFromEvents').mockResolvedValue([])

    const wrapper = mount(HomeView, {
      global: {
        stubs: {
          MediaCard: true,
          RecommendationCard: {
            props: ['item'],
            template: '<div class="rec-card-stub" :data-cid="item.contentId">{{ item.name }}</div>',
          },
          RouterLink: true,
        },
      },
    })

    await flushPromises()

    const cards = wrapper.findAll('.rec-card-stub')
    const card = cards.find((c) => c.attributes('data-cid') === SUGGESTED_CID)
    // Should NOT be recommended because it stems from a seed rated <= 5
    expect(card).toBeUndefined()
  })

  it('removes dismissed items and prevents them from showing in recommendations', async () => {
    const authStore = useAuthStore()
    const mediaStore = useMediaStore()

    const USER_PUBKEY = '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef'
    const DISMISSED_CID = '33'.repeat(32)
    const OTHER_CID = '44'.repeat(32)

    authStore.pubkey = USER_PUBKEY

    // Pre-dismiss DISMISSED_CID
    mediaStore.dismissRecommendation(DISMISSED_CID)

    vi.spyOn(mediaStore, 'fetchPopularMediaFromEvents').mockResolvedValue([
      { contentId: DISMISSED_CID, type: 'movie', name: 'Dismissed Movie', year: 2021, nostrEventCount: 10 },
      { contentId: OTHER_CID, type: 'movie', name: 'Good Movie', year: 2021, nostrEventCount: 5 },
    ])

    const wrapper = mount(HomeView, {
      global: {
        stubs: {
          MediaCard: true,
          RecommendationCard: {
            props: ['item'],
            template: '<div class="rec-card-stub" :data-cid="item.contentId">{{ item.name }}</div>',
          },
          RouterLink: true,
        },
      },
    })

    await flushPromises()

    const cards = wrapper.findAll('.rec-card-stub')
    const dismissedCard = cards.find((c) => c.attributes('data-cid') === DISMISSED_CID)
    expect(dismissedCard).toBeUndefined()

    const otherCard = cards.find((c) => c.attributes('data-cid') === OTHER_CID)
    expect(otherCard).toBeDefined()
  })
})
