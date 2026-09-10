import { describe, it, expect, beforeEach, vi } from 'vitest'

const nostrStubs = vi.hoisted(() => ({
  signEvent: vi.fn((tmpl) => Promise.resolve({ ...tmpl, id: 'sig123', sig: 'sig456' })),
  publish: vi.fn(() => Promise.resolve({ publishedTo: ['wss://relay.example.com'], errors: [] })),
  hasSigner: vi.fn(() => true),
}))

vi.mock('@/services/nostr/client.js', () => ({
  nostrClient: nostrStubs,
}))

import { trickleQueue } from '../trickleQueue.js'
import { clearImportData, getQueueStats } from '@/services/db/indexedDb.js'

describe('TrickleQueue Service', () => {
  beforeEach(async () => {
    vi.clearAllMocks()
    nostrStubs.hasSigner.mockReturnValue(true)
    nostrStubs.publish.mockResolvedValue({ publishedTo: ['wss://relay.example.com'], errors: [] })
    await clearImportData()
    trickleQueue.pause()
    trickleQueue.isRunning = false
  })

  it('enqueues status, rating, and review actions from consolidated items', async () => {
    const items = [
      {
        contentId: '11'.repeat(32),
        type: 'movie',
        name: 'Inception',
        year: 2010,
        status: 'completed',
        rating: 9,
        review: 'Mind bending masterpiece',
        spoiler: false,
      },
    ]

    const res = await trickleQueue.enqueueItems(items)
    // Should produce 3 actions: status, rating, review
    expect(res.enqueuedCount).toBe(3)

    const stats = await getQueueStats()
    expect(stats.total).toBe(3)
    expect(stats.pending).toBe(3)
  })

  it('processes an item and marks it as synced', async () => {
    const items = [
      {
        contentId: '22'.repeat(32),
        type: 'movie',
        name: 'Dune',
        year: 2021,
        status: 'completed',
        rating: null,
      },
    ]

    await trickleQueue.enqueueItems(items)

    // Process single step
    const hasMore = await trickleQueue.processNext()
    expect(hasMore).toBe(true)

    expect(nostrStubs.signEvent).toHaveBeenCalled()
    expect(nostrStubs.publish).toHaveBeenCalled()

    const stats = await getQueueStats()
    expect(stats.synced).toBe(1)
    expect(stats.pending).toBe(0)
  })

  it('pauses when no signer is active', async () => {
    nostrStubs.hasSigner.mockReturnValue(false)

    const items = [
      {
        contentId: '33'.repeat(32),
        type: 'movie',
        name: 'Interstellar',
        year: 2014,
        status: 'completed',
      },
    ]

    await trickleQueue.enqueueItems(items)
    const processed = await trickleQueue.processNext()

    expect(processed).toBe(false)
    expect(nostrStubs.signEvent).not.toHaveBeenCalled()
    expect(trickleQueue.isPaused).toBe(true)
  })

  it('handles rate-limited response by backing off', async () => {
    nostrStubs.publish.mockResolvedValueOnce({
      publishedTo: [],
      errors: [{ relay: 'wss://nos.lol', error: 'rate-limited: slow down' }],
    })

    const items = [
      {
        contentId: '44'.repeat(32),
        type: 'movie',
        name: 'Arrival',
        year: 2016,
        status: 'completed',
      },
    ]

    await trickleQueue.enqueueItems(items)
    await trickleQueue.processNext({ backoffMs: 5 })

    // Item should be put back to pending with retry notice
    const stats = await getQueueStats()
    expect(stats.synced).toBe(0)
    expect(stats.pending).toBe(1)
  })
})
