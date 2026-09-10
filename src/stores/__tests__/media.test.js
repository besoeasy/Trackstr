import { describe, it, expect, beforeEach, vi } from 'vitest'

const stubs = vi.hoisted(() => ({
  queryEvents: vi.fn(),
  publish: vi.fn(),
  signEvent: vi.fn(),
  resetConnections: vi.fn(),
  getRelays: vi.fn(() => []),
  getDiagnostics: vi.fn(() => ({})),
}))

vi.mock('@/services/nostr/client.js', () => ({
  nostrClient: {
    queryEvents: stubs.queryEvents,
    publish: stubs.publish,
    signEvent: stubs.signEvent,
    resetConnections: stubs.resetConnections,
    getRelays: stubs.getRelays,
    getDiagnostics: stubs.getDiagnostics,
  },
}))

import { createPinia, setActivePinia } from 'pinia'
import { useAuthStore } from '@/stores/auth.js'
import { useMediaStore } from '@/stores/media.js'
import { KINDS } from '@/services/nostr/events.js'

const OWN = 'aa'.repeat(32)
const STRANGER = 'bb'.repeat(32)
const FOLLOWED = 'cc'.repeat(32)
const CID = 'dd'.repeat(32)

function baseTags(overrides = {}) {
  return [
    ['d', CID],
    ['contentid', CID],
    ['trackstr', 'web'],
    ['type', 'movie'],
    ['name', 'Fight Club'],
    ['year', '1999'],
    ...Object.entries(overrides).map(([k, v]) => [k, v]),
  ]
}

function statusEvent({ pubkey = OWN, status = 'watching', at = 1000, id = 'e1', dTag = CID }) {
  const tags = baseTags({ status })
  tags[0] = ['d', dTag]
  return { id, pubkey, created_at: at, kind: KINDS.STATUS, tags, content: '' }
}

function ratingEvent({ pubkey = OWN, rating = '8', at = 1000, id = 'e1' }) {
  return { id, pubkey, created_at: at, kind: KINDS.RATING, tags: baseTags({ rating }), content: '' }
}


function setupStores() {
  localStorage.clear()
  setActivePinia(createPinia())
  stubs.queryEvents.mockReset().mockResolvedValue([])
  stubs.publish.mockReset().mockResolvedValue({ publishedTo: ['wss://relay.test'], errors: [] })
  stubs.signEvent
    .mockReset()
    .mockImplementation(async (t) => ({ ...t, id: 'ff'.repeat(32), pubkey: OWN, sig: 'ee'.repeat(32) }))
  const auth = useAuthStore()
  auth.pubkey = OWN
  auth.authType = 'extension'
  return { auth, media: useMediaStore() }
}

describe('author-scoped mutable state', () => {
  it("a stranger's newer event never overwrites your status", async () => {
    const { media } = setupStores()
    stubs.queryEvents.mockResolvedValueOnce([statusEvent({ status: 'watching', at: 1000, id: 'e1' })])
    await media.syncUserData(OWN)
    expect(media.getMediaStatus(CID)?.status).toBe('watching')

    stubs.queryEvents.mockResolvedValueOnce([
      statusEvent({ pubkey: STRANGER, status: 'completed', at: 2000, id: 'e2' }),
    ])
    await media.fetchMediaDetails(CID)

    expect(media.getMediaStatus(CID)?.status).toBe('watching')
    expect(media.getMediaStatus(CID, undefined, undefined, STRANGER)?.status).toBe('completed')
  })

  it('ties on created_at break deterministically on event id', async () => {
    for (const order of [
      ['zz', 'aa'],
      ['aa', 'zz'],
    ]) {
      const { media } = setupStores()
      const [first, second] = order.map((id) =>
        statusEvent({ status: id === 'aa' ? 'watching' : 'dropped', at: 1000, id })
      )
      stubs.queryEvents.mockResolvedValueOnce([first, second])
      await media.syncUserData(OWN)
      expect(media.getMediaStatus(CID)?.status).toBe('watching')
    }
  })

  it('drops malformed state but keeps genuine relay mentions', async () => {
    const { media } = setupStores()
    stubs.queryEvents.mockResolvedValueOnce([
      { id: 'm1', pubkey: OWN, created_at: 1, kind: KINDS.STATUS, tags: [['d', CID]], content: '' },
      { id: 'm2', pubkey: OWN, created_at: 1, kind: KINDS.STATUS, tags: [['d', 'garbage']], content: '' },
      { id: 'm3', pubkey: OWN, created_at: 1, kind: KINDS.STATUS, tags: null, content: '' },
    ])
    await media.syncUserData(OWN)
    // No status with an undefined value may exist…
    expect(Object.keys(media.statuses)).toHaveLength(0)
    // …but m1 is still a genuine relay event mentioning CID, so the
    // mention itself is indexed while its missing state is not.
    expect(Object.keys(media.mediaLibrary)).toEqual([CID])
    expect(media.getMediaStatus(CID)).toBeNull()
  })

  it('stores null (not 0) for missing ratings', async () => {
    const { media } = setupStores()
    const evt = ratingEvent({ at: 1000, id: 'e1' })
    evt.tags = evt.tags.filter((t) => t[0] !== 'rating')
    stubs.queryEvents.mockResolvedValueOnce([evt])
    await media.syncUserData(OWN)
    expect(media.getMediaRating(CID)).toBeNull()
  })
})

describe('verified publishing', () => {
  const movie = { contentId: CID, type: 'movie', name: 'Fight Club', year: '1999' }

  it('throws and ingests nothing when every relay rejects', async () => {
    const { media } = setupStores()
    stubs.publish.mockResolvedValue({ publishedTo: [], errors: [{ relay: 'wss://x', error: 'nope' }] })
    await expect(media.setStatus(movie, 'watching')).rejects.toThrow(/every configured relay/)
    expect(Object.keys(media.statuses)).toHaveLength(0)
  })

  it('publishes and ingests on success', async () => {
    const { media } = setupStores()
    await media.setStatus(movie, 'watching')
    expect(media.getMediaStatus(CID)?.status).toBe('watching')
    expect(stubs.publish).toHaveBeenCalledTimes(1) // 35402 mutable status
  })
})

describe('NIP-09 local echo', () => {
  it('deletes kind-aware: status delete keeps the rating', async () => {
    const { media } = setupStores()
    stubs.queryEvents.mockResolvedValueOnce([
      statusEvent({ status: 'watching', at: 1000, id: 'e1' }),
      ratingEvent({ rating: '8', at: 1000, id: 'e2' }),
    ])
    await media.syncUserData(OWN)
    expect(media.getMediaStatus(CID)).not.toBeNull()
    expect(media.getMediaRating(CID)).toBe(8)

    await media.deleteTrackstrEvent({ coordinate: `35402:${OWN}:${CID}`, reason: 't' })
    expect(media.getMediaStatus(CID)).toBeNull()
    expect(media.getMediaRating(CID)).toBe(8)

    await media.deleteTrackstrEvent({ coordinate: `35400:${OWN}:${CID}`, reason: 't' })
    expect(media.getMediaRating(CID)).toBeNull()
  })

  it('handles episode coordinates with colons in the d-tag', async () => {
    const { media } = setupStores()
    const dTag = `${CID}:s1e3`
    stubs.queryEvents.mockResolvedValueOnce([statusEvent({ status: 'watching', at: 1000, id: 'e1', dTag })])
    await media.syncUserData(OWN)
    expect(media.getMediaStatus(CID, 1, 3)?.status).toBe('watching')

    await media.deleteTrackstrEvent({ coordinate: `35402:${OWN}:${dTag}`, reason: 't' })
    expect(media.getMediaStatus(CID, 1, 3)).toBeNull()
  })
})

describe('inbound NIP-09 deletions', () => {
  const deletionById = (pubkey, targetId, id = 'del1') => ({
    id,
    pubkey,
    created_at: 3000,
    kind: 5,
    tags: [['e', targetId]],
    content: 'deleted',
  })
  const deletionByCoord = (pubkey, coordinate, id = 'del1') => ({
    id,
    pubkey,
    created_at: 3000,
    kind: 5,
    tags: [['a', coordinate]],
    content: 'deleted',
  })

  it('removes your review when your own e-deletion arrives', async () => {
    const { media } = setupStores()
    stubs.queryEvents.mockResolvedValueOnce([
      { id: 'r1', pubkey: OWN, created_at: 1000, kind: KINDS.RATING, tags: baseTags({ rating: '8' }), content: 'great' },
    ])
    await media.syncUserData(OWN)
    expect(media.getReviewsForMedia(CID)).toHaveLength(1)

    stubs.queryEvents.mockResolvedValueOnce([deletionById(OWN, 'r1')])
    await media.syncUserData(OWN)
    expect(media.getReviewsForMedia(CID)).toHaveLength(0)
  })

  it('ignores forged deletions for somebody else’s records', async () => {
    const { media } = setupStores()
    stubs.queryEvents.mockResolvedValueOnce([
      { id: 'r1', pubkey: OWN, created_at: 1000, kind: KINDS.RATING, tags: baseTags({ rating: '8' }), content: 'great' },
      statusEvent({ status: 'watching', at: 1000, id: 'e1' }),
    ])
    await media.syncUserData(OWN)

    stubs.queryEvents.mockResolvedValueOnce([
      deletionById(STRANGER, 'r1', 'del1'),
      deletionByCoord(STRANGER, `35402:${OWN}:${CID}`, 'del2'),
    ])
    await media.syncUserData(OWN)

    expect(media.getReviewsForMedia(CID)).toHaveLength(1)
    expect(media.getMediaStatus(CID)?.status).toBe('watching')
  })

  it('applies deletions even when they arrive ahead of their target', async () => {
    const { media } = setupStores()
    stubs.queryEvents.mockResolvedValueOnce([
      deletionByCoord(OWN, `35402:${OWN}:${CID}`, 'del1'),
      statusEvent({ status: 'watching', at: 1000, id: 'e1' }),
    ])
    await media.syncUserData(OWN)
    expect(media.getMediaStatus(CID)).toBeNull()
  })

  it('never renders deletion notices as feed items', async () => {
    const { media } = setupStores()
    stubs.queryEvents.mockResolvedValueOnce([
      { id: 'r1', pubkey: OWN, created_at: 1000, kind: KINDS.RATING, tags: baseTags({ rating: '8' }), content: 'great' },
      deletionById(OWN, 'r9', 'del1'),
    ])
    const feed = await media.fetchRecentFeed(10)
    expect(feed.map((e) => e.id).sort()).toEqual(['r1'])
    expect(media.getReviewsForMedia(CID)).toHaveLength(1)
  })
})

describe('Nostr-only popular surface', () => {
  it('excludes provider-cached items without event provenance', async () => {
    const { media } = setupStores()
    media.cacheMediaItem({ contentId: CID, type: 'movie', title: 'Fight Club', year: '1999', tmdbId: 42 })
    expect(media.getKnownMediaFromEvents()).toHaveLength(0)

    stubs.queryEvents.mockResolvedValueOnce([statusEvent({ at: 1000, id: 'e1' })])
    await media.syncUserData(OWN)
    expect(media.getKnownMediaFromEvents().map((m) => m.contentId)).toEqual([CID])
  })

  it('counts every event exactly once (no local double-count)', async () => {
    const { media } = setupStores()
    stubs.queryEvents.mockResolvedValue([statusEvent({ at: 1000, id: 'e1' })])
    await media.syncUserData(OWN)
    const [item] = await media.fetchPopularMediaFromEvents({ limit: 10 })
    expect(item.contentId).toBe(CID)
    expect(item.nostrEventCount).toBe(1)
  })
})


describe('importLocalMedia()', () => {
  it('instantly populates statuses, ratings, reviews, and media library locally', () => {
    const { media } = setupStores()
    const items = [
      {
        contentId: CID,
        type: 'movie',
        name: 'Fight Club',
        year: 1999,
        status: 'completed',
        rating: 9,
        review: 'Incredible film',
        spoiler: false,
        watchedDate: '2023-01-15',
      },
    ]

    media.importLocalMedia(items, OWN)

    expect(media.mediaLibrary[CID]).toBeDefined()
    expect(media.mediaLibrary[CID].name).toBe('Fight Club')
    expect(media.statuses[`${OWN}:${CID}`]).toBeDefined()
    expect(media.statuses[`${OWN}:${CID}`].status).toBe('completed')
    expect(media.ratings[`${OWN}:${CID}`]).toBeDefined()
    expect(media.ratings[`${OWN}:${CID}`].rating).toBe(9)
    expect(media.reviews.length).toBe(1)
    expect(media.reviews[0].content).toBe('Incredible film')
  })

  it('normalizes episode imports into clean show-level records', () => {
    const { media } = setupStores()
    const items = [
      {
        contentId: CID,
        type: 'episode',
        name: 'Stranger Things - S01E06: Chapter Six',
        year: 2016,
        status: 'completed',
        rating: 8,
      },
    ]

    media.importLocalMedia(items, OWN)

    expect(media.mediaLibrary[CID].type).toBe('show')
    expect(media.mediaLibrary[CID].name).toBe('Stranger Things')
  })
})

describe('trackedItemsList episode folding', () => {
  it('folds multiple episode statuses for the same show into a single show row', async () => {
    const { media } = setupStores()

    function makeEp(id, at, s, e, name) {
      return {
        id,
        pubkey: OWN,
        created_at: at,
        kind: KINDS.STATUS,
        tags: [
          ['d', `${CID}:s${s}e${e}`],
          ['contentid', CID],
          ['trackstr', 'web'],
          ['type', 'episode'],
          ['name', name],
          ['year', '2016'],
          ['status', 'completed'],
          ['season', String(s)],
          ['episode', String(e)],
        ],
        content: '',
      }
    }

    const ep1 = makeEp('ep1', 1000, 1, 1, 'Stranger Things - S01E01: Chapter One')
    const ep2 = makeEp('ep2', 1050, 1, 2, 'Stranger Things - S01E02: The Weirdo')
    const ep3 = makeEp('ep3', 1100, 1, 3, 'Stranger Things - S01E03: Holly, Jolly')

    stubs.queryEvents.mockResolvedValueOnce([ep1, ep2, ep3])
    await media.syncUserData(OWN)

    const tracked = media.trackedItemsList
    expect(tracked).toHaveLength(1)
    expect(tracked[0].contentId).toBe(CID)
    expect(tracked[0].media.type).toBe('show')
    expect(tracked[0].media.name).toBe('Stranger Things')
    expect(tracked[0].status).toBe('watching')
    expect(tracked[0].progress).toBe('3 eps watched')
    expect(tracked[0].episodeDTags).toEqual([`${CID}:s1e1`, `${CID}:s1e2`, `${CID}:s1e3`])
  })

  it('aggregates episodes when an explicit show status is also tracked', async () => {
    const { media } = setupStores()

    const show = statusEvent({
      pubkey: OWN,
      status: 'watching',
      at: 1000,
      id: 'show1',
      dTag: CID,
    })
    show.tags.find((t) => t[0] === 'type')[1] = 'show'

    const ep1 = statusEvent({
      pubkey: OWN,
      status: 'completed',
      at: 1100,
      id: 'ep1',
      dTag: `${CID}:s1e1`,
    })
    ep1.tags.push(['season', '1'], ['episode', '1'], ['type', 'episode'])

    stubs.queryEvents.mockResolvedValueOnce([show, ep1])
    await media.syncUserData(OWN)

    const tracked = media.trackedItemsList
    expect(tracked).toHaveLength(1)
    expect(tracked[0].contentId).toBe(CID)
    expect(tracked[0].media.type).toBe('show')
    expect(tracked[0].episodeCount).toBe(1)
    expect(tracked[0].progress).toBe('1 ep watched')
  })
})

describe('getDiscoveredEpisodesForMedia()', () => {
  it('discovers episodes and specials from ingested Nostr events', async () => {
    const { media } = setupStores()

    const ep1 = {
      id: 'ep1',
      pubkey: OWN,
      created_at: 1000,
      kind: KINDS.STATUS,
      tags: [
        ['d', `${CID}:s1e1`],
        ['contentid', CID],
        ['season', '1'],
        ['episode', '1'],
        ['name', 'Stranger Things - S01E01: Pilot'],
        ['type', 'episode'],
        ['status', 'completed'],
      ],
      content: '',
    }

    const special1 = {
      id: 'sp1',
      pubkey: OWN,
      created_at: 1100,
      kind: KINDS.STATUS,
      tags: [
        ['d', `${CID}:s0e1`],
        ['contentid', CID],
        ['season', '0'],
        ['episode', '1'],
        ['name', 'Stranger Things - S00E01: Beyond Stranger Things'],
        ['type', 'episode'],
        ['status', 'completed'],
      ],
      content: '',
    }

    stubs.queryEvents.mockResolvedValueOnce([ep1, special1])
    await media.syncUserData(OWN)

    const discovered = media.getDiscoveredEpisodesForMedia(CID)
    expect(discovered).toHaveLength(2)

    // Season 0 (Special)
    expect(discovered[0].season).toBe(0)
    expect(discovered[0].episode).toBe(1)
    expect(discovered[0].name).toBe('Beyond Stranger Things')

    // Season 1 (Episode 1)
    expect(discovered[1].season).toBe(1)
    expect(discovered[1].episode).toBe(1)
    expect(discovered[1].name).toBe('Pilot')
  })

  describe('Unified Ratings and Reviews (Kind 35400)', () => {
    it('stores rating and written review together in Kind 35400', async () => {
      const { media } = setupStores()
      stubs.queryEvents.mockResolvedValueOnce([
        {
          id: 'rate-rev-1',
          pubkey: OWN,
          created_at: 1200,
          kind: KINDS.RATING,
          tags: [
            ['d', CID],
            ['contentid', CID],
            ['trackstr', 'web'],
            ['type', 'movie'],
            ['name', 'Fight Club'],
            ['year', '1999'],
            ['rating', '9'],
            ['spoiler', '1'],
          ],
          content: 'A classic mind-bender.',
        },
      ])
      await media.syncUserData(OWN)

      const rating = media.getMediaRating(CID)
      expect(rating).toBe(9)

      const reviews = media.getReviewsForMedia(CID)
      expect(reviews).toHaveLength(1)
      expect(reviews[0].content).toBe('A classic mind-bender.')
      expect(reviews[0].rating).toBe(9)
      expect(reviews[0].spoiler).toBe(true)

      const userReview = media.getMediaReview(CID, null, null, OWN)
      expect(userReview).not.toBeNull()
      expect(userReview.content).toBe('A classic mind-bender.')
      expect(userReview.rating).toBe(9)
      expect(userReview.spoiler).toBe(true)
    })

    it('folds legacy Kind 5401 reviews into ratings state', async () => {
      const { media } = setupStores()
      stubs.queryEvents.mockResolvedValueOnce([
        {
          id: 'legacy-rev-1',
          pubkey: OWN,
          created_at: 900,
          kind: 5401,
          tags: [
            ['d', CID],
            ['contentid', CID],
            ['trackstr', 'web'],
            ['type', 'movie'],
            ['name', 'Fight Club'],
            ['year', '1999'],
            ['rating', '8.5'],
          ],
          content: 'Legacy review text.',
        },
      ])
      await media.syncUserData(OWN)

      const reviews = media.getReviewsForMedia(CID)
      expect(reviews).toHaveLength(1)
      expect(reviews[0].content).toBe('Legacy review text.')
      expect(reviews[0].rating).toBe(8.5)
    })
  })

  describe('Similar Suggestions (Kind 35401)', () => {
    const movie = { contentId: CID, type: 'movie', name: 'Fight Club', year: '1999' }
    const TARGET_CID = 'b'.repeat(64)
    const TARGET_MEDIA = {
      contentId: TARGET_CID,
      type: 'movie',
      title: 'The Matrix',
      year: 1999,
    }

    it('publishes a Kind 35401 event and stores suggestion', async () => {
      const { media } = setupStores()
      await media.addSimilarSuggestion(movie, TARGET_MEDIA, 'Mind-bending cyberpunk thriller')

      expect(stubs.publish).toHaveBeenCalledTimes(1)
      const publishedEvt = stubs.publish.mock.calls[0][0]
      expect(publishedEvt.kind).toBe(35401)
      expect(publishedEvt.tags).toContainEqual(['d', CID])
      expect(publishedEvt.tags).toContainEqual(['contentid', CID])
      expect(publishedEvt.tags).toContainEqual([
        'similar',
        TARGET_CID,
        'movie',
        'The Matrix',
        '1999',
      ])

      const suggestions = media.getSimilarSuggestionsForMedia(CID)
      expect(suggestions).toHaveLength(1)
      expect(suggestions[0].contentId).toBe(TARGET_CID)
      expect(suggestions[0].name).toBe('The Matrix')
      expect(suggestions[0].voteCount).toBe(1)
      expect(suggestions[0].notes).toContain('Mind-bending cyberpunk thriller')
    })

    it('aggregates suggestions from multiple users and ranks by voteCount', async () => {
      const { media } = setupStores()
      const THIRD_CID = 'c'.repeat(64)

      stubs.queryEvents.mockResolvedValueOnce([
        {
          id: 'sug-user1',
          pubkey: OWN,
          created_at: 1000,
          kind: 35401,
          tags: [
            ['d', CID],
            ['contentid', CID],
            ['trackstr', 'web'],
            ['type', 'movie'],
            ['name', 'Fight Club'],
            ['year', '1999'],
            ['similar', TARGET_CID, 'movie', 'The Matrix', '1999'],
            ['s', TARGET_CID],
          ],
          content: 'Dark and psychological.',
        },
        {
          id: 'sug-user2',
          pubkey: STRANGER,
          created_at: 1005,
          kind: 35401,
          tags: [
            ['d', CID],
            ['contentid', CID],
            ['trackstr', 'web'],
            ['type', 'movie'],
            ['name', 'Fight Club'],
            ['year', '1999'],
            ['similar', TARGET_CID, 'movie', 'The Matrix', '1999'],
            ['s', TARGET_CID],
            ['similar', THIRD_CID, 'movie', 'Memento', '2000'],
            ['s', THIRD_CID],
          ],
          content: 'Must watch.',
        },
      ])

      await media.fetchMediaDetails(CID)

      const suggestions = media.getSimilarSuggestionsForMedia(CID)
      expect(suggestions).toHaveLength(2)
      // The Matrix has 2 votes, Memento has 1 vote
      expect(suggestions[0].contentId).toBe(TARGET_CID)
      expect(suggestions[0].voteCount).toBe(2)
      expect(suggestions[1].contentId).toBe(THIRD_CID)
      expect(suggestions[1].voteCount).toBe(1)
    })
  })
})

