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

function metadataEvent({ pubkey = OWN, at = 1000, id = 'e1', poster = '', overview = '' }) {
  const tags = baseTags()
  if (poster) tags.push(['poster', poster])
  return { id, pubkey, created_at: at, kind: KINDS.MEDIA_METADATA, tags, content: overview }
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
    expect(stubs.publish).toHaveBeenCalledTimes(2) // 35402 + 5402 log
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
      { id: 'r1', pubkey: OWN, created_at: 1000, kind: 5401, tags: baseTags(), content: 'great' },
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
      { id: 'r1', pubkey: OWN, created_at: 1000, kind: 5401, tags: baseTags(), content: 'great' },
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

  it('clears community metadata only when the deleter owns the winning version', async () => {
    const { media } = setupStores()
    stubs.queryEvents.mockResolvedValueOnce([
      metadataEvent({ pubkey: OWN, at: 1000, id: 'm1', poster: 'ipfs://mine' }),
    ])
    await media.syncUserData(OWN)
    expect(media.getMediaMetadata(CID)?.poster).toBe('ipfs://mine')

    // Stranger's notice for their own (non-winning) version changes nothing.
    stubs.queryEvents.mockResolvedValueOnce([
      deletionByCoord(STRANGER, `35403:${STRANGER}:${CID}`, 'del1'),
    ])
    await media.syncUserData(OWN)
    expect(media.getMediaMetadata(CID)?.poster).toBe('ipfs://mine')

    // Your own notice clears it.
    stubs.queryEvents.mockResolvedValueOnce([
      deletionByCoord(OWN, `35403:${OWN}:${CID}`, 'del2'),
    ])
    await media.syncUserData(OWN)
    expect(media.getMediaMetadata(CID)).toBeNull()
  })

  it('never renders deletion notices as feed items', async () => {
    const { media } = setupStores()
    stubs.queryEvents.mockResolvedValueOnce([
      { id: 'r1', pubkey: OWN, created_at: 1000, kind: 5401, tags: baseTags(), content: 'great' },
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

describe('follow-preferred community metadata', () => {
  it('prefers a followed author over a newer stranger and merges sparse updates', async () => {
    const { media } = setupStores()
    // Follow list contains FOLLOWED.
    stubs.queryEvents.mockResolvedValueOnce([
      { id: 'f1', pubkey: OWN, created_at: 10, kind: 3, tags: [['p', FOLLOWED]], content: '' },
    ])
    await media.fetchFollows(OWN)

    // Newer stranger seed with rich poster.
    stubs.queryEvents.mockResolvedValueOnce([
      metadataEvent({ pubkey: STRANGER, at: 2000, id: 'm1', poster: 'ipfs://stranger', overview: 'rich' }),
    ])
    await media.syncUserData(OWN)
    expect(media.getMediaMetadata(CID)?.poster).toBe('ipfs://stranger')

    // Older followed seed wins the tier but keeps fields the sparse event lacks.
    stubs.queryEvents.mockResolvedValueOnce([
      metadataEvent({ pubkey: FOLLOWED, at: 1000, id: 'm2', overview: 'followed take' }),
    ])
    await media.syncUserData(OWN)
    const meta = media.getMediaMetadata(CID)
    expect(meta?.author).toBe(FOLLOWED)
    expect(meta?.overview).toBe('followed take')
    expect(meta?.poster).toBe('ipfs://stranger')
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
})
