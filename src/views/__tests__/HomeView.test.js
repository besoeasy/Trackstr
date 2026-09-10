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
}))

vi.mock('@/services/api/music.js', () => ({
  searchMusic: vi.fn().mockResolvedValue([]),
}))

vi.mock('@/services/api/tv.js', () => ({
  fetchShowEpisodes: vi.fn().mockResolvedValue({ seasons: [] }),
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
})
