/**
 * Trickle Sync Queue Service
 *
 * Implements a paced background worker that syncs imported media items to Nostr relays.
 * Paces requests (e.g. 1 event / sec) to prevent hitting relay rate limits,
 * anti-spam filters, or socket drops. Automatically backs off when rate-limited.
 */
import {
  saveImportedItems,
  queueSyncItems,
  getPendingQueue,
  updateQueueItem,
  getQueueStats,
  resetFailedItems,
  clearImportData,
} from '@/services/db/indexedDb.js'
import {
  buildStatusEvent,
  buildRatingEvent,
  buildReviewEvent,
} from '@/services/nostr/events.js'
import { nostrClient } from '@/services/nostr/client.js'
import { logger } from '@/utils/logger.js'

class TrickleQueue {
  constructor() {
    this.isRunning = false
    this.isPaused = false
    this.paceMs = 1000 // 1 item per second by default
    this.backoffMs = 5000 // 5 second backoff on rate-limiting
    this.timer = null
    this.listeners = new Set()
    this.stats = {
      total: 0,
      pending: 0,
      syncing: 0,
      synced: 0,
      failed: 0,
      lastSyncedName: '',
      lastError: null,
    }
  }

  /**
   * Subscribe to queue state updates
   * @param {Function} cb
   * @returns {Function} unsubscribe function
   */
  subscribe(cb) {
    this.listeners.add(cb)
    cb(this.getState())
    return () => this.listeners.delete(cb)
  }

  notify() {
    const state = this.getState()
    this.listeners.forEach((cb) => {
      try {
        cb(state)
      } catch (err) {
        console.warn('Queue listener error:', err)
      }
    })
  }

  getState() {
    return {
      isRunning: this.isRunning,
      isPaused: this.isPaused,
      paceMs: this.paceMs,
      stats: { ...this.stats },
    }
  }

  /**
   * Refreshes stats from IndexedDB
   */
  async refreshStats() {
    const s = await getQueueStats()
    this.stats = {
      ...this.stats,
      ...s,
    }
    this.notify()
    return this.stats
  }

  /**
   * Enqueues consolidated media items into IndexedDB
   * Creates discrete actions: status (35402), rating (35400), review (5401)
   * @param {Array<Object>} items Consolidated media items
   * @returns {Promise<{ enqueuedCount: number }>}
   */
  async enqueueItems(items) {
    if (!Array.isArray(items) || items.length === 0) {
      return { enqueuedCount: 0 }
    }

    // Save full items to browser database
    await saveImportedItems(items)

    const queueEntries = []
    const now = Date.now()

    for (const item of items) {
      if (!item.contentId) continue

      const mediaRef = {
        contentId: item.contentId,
        type: item.type || 'movie',
        name: item.name,
        title: item.name,
        year: item.year || '',
      }

      // 1. Status action (Kind 35402)
      if (item.status) {
        queueEntries.push({
          id: `status:${item.contentId}`,
          contentId: item.contentId,
          actionType: 'status',
          media: mediaRef,
          payload: {
            status: item.status,
            watchedDate: item.watchedDate,
          },
          syncStatus: 'pending',
          attempts: 0,
          error: null,
          createdAt: now,
        })
      }

      // 2. Rating action (Kind 35400)
      if (item.rating !== null && item.rating !== undefined && item.rating > 0) {
        queueEntries.push({
          id: `rating:${item.contentId}`,
          contentId: item.contentId,
          actionType: 'rating',
          media: mediaRef,
          payload: {
            rating: item.rating,
          },
          syncStatus: 'pending',
          attempts: 0,
          error: null,
          createdAt: now,
        })
      }

      // 3. Written Review action (Kind 5401)
      if (item.review && item.review.trim()) {
        queueEntries.push({
          id: `review:${item.contentId}`,
          contentId: item.contentId,
          actionType: 'review',
          media: mediaRef,
          payload: {
            review: item.review.trim(),
            rating: item.rating,
            spoiler: item.spoiler || false,
            watchedDate: item.watchedDate,
          },
          syncStatus: 'pending',
          attempts: 0,
          error: null,
          createdAt: now,
        })
      }
    }

    await queueSyncItems(queueEntries)
    await this.refreshStats()
    return { enqueuedCount: queueEntries.length }
  }

  /**
   * Starts or resumes processing the queue
   * @param {Object} [options]
   * @param {Object} [options.mediaStore] Optional mediaStore to ingest synced events into UI
   */
  async start(options = {}) {
    if (this.isRunning && !this.isPaused) return
    this.isRunning = true
    this.isPaused = false
    this.notify()

    this.processLoop(options)
  }

  pause() {
    this.isPaused = true
    if (this.timer) {
      clearTimeout(this.timer)
      this.timer = null
    }
    this.notify()
  }

  resume(options = {}) {
    if (!this.isRunning) {
      return this.start(options)
    }
    this.isPaused = false
    this.notify()
    this.processLoop(options)
  }

  setPace(paceMs) {
    this.paceMs = Math.max(300, Number(paceMs) || 1000)
    this.notify()
  }

  async clear() {
    this.pause()
    this.isRunning = false
    await clearImportData()
    this.stats = {
      total: 0,
      pending: 0,
      syncing: 0,
      synced: 0,
      failed: 0,
      lastSyncedName: '',
      lastError: null,
    }
    this.notify()
  }

  async retryFailed(options = {}) {
    await resetFailedItems()
    await this.refreshStats()
    this.start(options)
  }

  /**
   * Processes a single pending item from the queue
   * @returns {Promise<boolean>} true if an item was processed, false if queue is empty
   */
  async processNext(options = {}) {
    // Verify signer availability
    if (!nostrClient.hasSigner()) {
      logger.warn('TrickleQueue', 'No signer connected. Pausing queue until account is connected.')
      this.stats.lastError = 'Connect a Nostr account to sync items to relays.'
      this.pause()
      return false
    }

    const pendingBatch = await getPendingQueue(1)
    if (!pendingBatch || pendingBatch.length === 0) {
      this.isRunning = false
      await this.refreshStats()
      logger.info('TrickleQueue', 'All pending items have been synced to relays.')
      return false
    }

    const item = pendingBatch[0]
    await this.processItem(item, options)
    return true
  }

  /**
   * Internal paced worker loop
   */
  async processLoop(options = {}) {
    if (!this.isRunning || this.isPaused) return

    try {
      const hasMore = await this.processNext(options)
      if (!hasMore) return
    } catch (err) {
      logger.error('TrickleQueue', 'Error in trickle worker step:', err)
      this.stats.lastError = err.message || String(err)
    }

    // Schedule next item if still running
    if (this.isRunning && !this.isPaused) {
      this.timer = setTimeout(() => {
        this.processLoop(options)
      }, this.paceMs)
    }
  }

  /**
   * Processes a single queue item
   */
  async processItem(entry, options = {}) {
    await updateQueueItem(entry.id, { syncStatus: 'syncing' })
    this.stats.syncing = 1
    this.notify()

    try {
      let eventTemplate = null

      if (entry.actionType === 'status') {
        eventTemplate = buildStatusEvent(entry.media, entry.payload.status)
      } else if (entry.actionType === 'rating') {
        eventTemplate = buildRatingEvent(entry.media, entry.payload.rating)
      } else if (entry.actionType === 'review') {
        eventTemplate = buildReviewEvent(entry.media, entry.payload.review, {
          rating: entry.payload.rating,
          spoiler: entry.payload.spoiler,
        })
      }

      if (!eventTemplate) {
        throw new Error(`Unsupported action type: ${entry.actionType}`)
      }

      // If a historical watch date is available, respect it for event timestamping
      if (entry.payload.watchedDate) {
        const parsedTime = Math.floor(new Date(entry.payload.watchedDate).getTime() / 1000)
        if (parsedTime > 0 && parsedTime <= Math.floor(Date.now() / 1000)) {
          eventTemplate.created_at = parsedTime
        }
      }

      // Sign event
      const signed = await nostrClient.signEvent(eventTemplate)

      // Publish event to relays
      const pubResult = await nostrClient.publish(signed)

      // Check for rate-limiting
      const rateLimited = pubResult.errors?.some((e) =>
        String(e.error || '').toLowerCase().includes('rate-limited')
      )

      if (rateLimited) {
        logger.warn('TrickleQueue', 'Relay reported rate-limit. Backing off 5 seconds...')
        await updateQueueItem(entry.id, {
          syncStatus: 'pending',
          error: 'Rate-limited by relay. Retrying automatically...',
        })
        // Backoff pause
        this.paceMs = Math.max(this.paceMs, 2000)
        const delay = options.backoffMs ?? this.backoffMs
        if (delay > 0) {
          await new Promise((resolve) => setTimeout(resolve, delay))
        }
        return
      }

      // Ingest into mediaStore if passed
      if (options.mediaStore && typeof options.mediaStore.ingestEvent === 'function') {
        options.mediaStore.ingestEvent(signed)
      }

      // Mark success
      await updateQueueItem(entry.id, {
        syncStatus: 'synced',
        syncedAt: Date.now(),
        error: null,
      })

      this.stats.lastSyncedName = `${entry.media.name} (${entry.actionType})`
      this.stats.lastError = null
      await this.refreshStats()
    } catch (err) {
      const errMsg = err?.message || String(err)
      logger.error('TrickleQueue', `Failed to sync item ${entry.id}:`, errMsg)

      await updateQueueItem(entry.id, {
        syncStatus: 'failed',
        attempts: (entry.attempts || 0) + 1,
        error: errMsg,
      })
      this.stats.lastError = errMsg
      await this.refreshStats()
    }
  }
}

export const trickleQueue = new TrickleQueue()
