import { describe, it, expect, beforeEach } from 'vitest'
import {
  saveMediaCache,
  loadMediaCache,
  saveEventCache,
  loadEventCache,
  saveAppMeta,
  getAppMeta,
  pruneExpiredCache,
  migrateLocalStorageToIndexedDb,
  clearMediaAndEventCache,
  CACHE_EXPIRY_MS,
  CACHE_EXPIRY_DAYS,
} from '../indexedDb.js'

describe('IndexedDB Media & Event Cache (30-day expiry)', () => {
  beforeEach(async () => {
    await clearMediaAndEventCache()
    if (typeof localStorage !== 'undefined') {
      localStorage.clear()
    }
  })

  it('has a 30-day TTL constant', () => {
    expect(CACHE_EXPIRY_DAYS).toBe(30)
    expect(CACHE_EXPIRY_MS).toBe(30 * 24 * 60 * 60 * 1000)
  })

  describe('Media Cache', () => {
    it('saves and loads non-expired media items', async () => {
      const cid = 'aa'.repeat(32)
      const media = {
        contentId: cid,
        title: 'Fight Club',
        name: 'Fight Club',
        year: 1999,
        type: 'movie',
      }

      await saveMediaCache({ [cid]: media })
      const cached = await loadMediaCache()

      expect(cached[cid]).toBeDefined()
      expect(cached[cid].title).toBe('Fight Club')
      expect(cached[cid].year).toBe(1999)
      expect(cached[cid].cachedAt).toBeDefined()
    })

    it('expires media cached more than 30 days ago', async () => {
      const cidFresh = '11'.repeat(32)
      const cidExpired = '22'.repeat(32)
      const now = Date.now()
      const thirtyOneDaysAgo = now - (31 * 24 * 60 * 60 * 1000)

      const freshItem = {
        contentId: cidFresh,
        title: 'Fresh Movie',
        year: 2023,
        type: 'movie',
        cachedAt: now,
      }
      const expiredItem = {
        contentId: cidExpired,
        title: 'Old Movie',
        year: 1995,
        type: 'movie',
        cachedAt: thirtyOneDaysAgo,
      }

      await saveMediaCache({
        [cidFresh]: freshItem,
        [cidExpired]: expiredItem,
      })

      const loaded = await loadMediaCache({ now })
      expect(loaded[cidFresh]).toBeDefined()
      expect(loaded[cidExpired]).toBeUndefined()
    })
  })

  describe('Event Cache', () => {
    it('saves and loads statuses, ratings, and suggestions with category filtering', async () => {
      const statusKey = 'status_dtag_1'
      const ratingKey = 'rating_dtag_1'

      await saveEventCache('status', {
        [statusKey]: {
          contentId: 'cc'.repeat(32),
          status: 'completed',
        },
      })

      await saveEventCache('rating', {
        [ratingKey]: {
          contentId: 'cc'.repeat(32),
          rating: 9,
          content: 'Amazing',
        },
      })

      const statuses = await loadEventCache('status')
      const ratings = await loadEventCache('rating')

      expect(statuses[statusKey]).toBeDefined()
      expect(statuses[statusKey].status).toBe('completed')
      expect(statuses[ratingKey]).toBeUndefined()

      expect(ratings[ratingKey]).toBeDefined()
      expect(ratings[ratingKey].rating).toBe(9)
      expect(ratings[statusKey]).toBeUndefined()
    })

    it('expires events older than 30 days', async () => {
      const key = 'status_old'
      const now = Date.now()
      const thirtyOneDaysAgo = now - (31 * 24 * 60 * 60 * 1000)

      await saveEventCache('status', {
        [key]: {
          contentId: 'cc'.repeat(32),
          status: 'dropped',
          cachedAt: thirtyOneDaysAgo,
        },
      })

      const loaded = await loadEventCache('status', { now })
      expect(loaded[key]).toBeUndefined()
    })
  })

  describe('App Metadata', () => {
    it('saves and retrieves arbitrary metadata', async () => {
      await saveAppMeta('lastSyncedAt', 1700000000)
      await saveAppMeta('follows', { ['pubkey1']: 1 })

      const sync = await getAppMeta('lastSyncedAt')
      const follows = await getAppMeta('follows')
      const missing = await getAppMeta('nonExistent', 'defaultVal')

      expect(sync).toBe(1700000000)
      expect(follows).toEqual({ pubkey1: 1 })
      expect(missing).toBe('defaultVal')
    })
  })

  describe('pruneExpiredCache()', () => {
    it('purges records older than 30 days from media and event caches', async () => {
      const now = Date.now()
      const thirtyOneDaysAgo = now - (31 * 24 * 60 * 60 * 1000)

      await saveMediaCache({
        'expired_cid': { contentId: 'expired_cid', title: 'Old', year: 2000, type: 'movie', cachedAt: thirtyOneDaysAgo },
        'valid_cid': { contentId: 'valid_cid', title: 'New', year: 2024, type: 'movie', cachedAt: now },
      })

      await saveEventCache('status', {
        'expired_event': { contentId: 'expired_cid', status: 'completed', cachedAt: thirtyOneDaysAgo },
        'valid_event': { contentId: 'valid_cid', status: 'watching', cachedAt: now },
      })

      const { prunedMedia, prunedEvents } = await pruneExpiredCache(now)
      expect(prunedMedia).toBeGreaterThanOrEqual(1)
      expect(prunedEvents).toBeGreaterThanOrEqual(1)

      const remainingMedia = await loadMediaCache({ now })
      const remainingEvents = await loadEventCache('status', { now })

      expect(remainingMedia['expired_cid']).toBeUndefined()
      expect(remainingMedia['valid_cid']).toBeDefined()
      expect(remainingEvents['expired_event']).toBeUndefined()
      expect(remainingEvents['valid_event']).toBeDefined()
    })
  })

  describe('migrateLocalStorageToIndexedDb()', () => {
    it('migrates legacy localStorage cache into IndexedDB and deletes the localStorage key', async () => {
      const legacyPayload = {
        mediaLibrary: {
          'cid_migrated': { contentId: 'cid_migrated', title: 'Matrix', name: 'Matrix', year: 1999, type: 'movie' },
        },
        statuses: {
          'status_migrated': { contentId: 'cid_migrated', status: 'completed' },
        },
        ratings: {
          'rating_migrated': { contentId: 'cid_migrated', rating: 10 },
        },
        follows: { 'pubkey_xyz': 1 },
        lastSyncedAt: 1699999999,
        nostrContentIds: { 'cid_migrated': 1 },
      }

      localStorage.setItem('trackstr_media_cache', JSON.stringify(legacyPayload))

      const result = await migrateLocalStorageToIndexedDb()
      expect(result.migrated).toBe(true)

      // Verified migrated data in IndexedDB
      const media = await loadMediaCache()
      expect(media['cid_migrated']).toBeDefined()
      expect(media['cid_migrated'].title).toBe('Matrix')

      const statuses = await loadEventCache('status')
      expect(statuses['status_migrated']).toBeDefined()
      expect(statuses['status_migrated'].status).toBe('completed')

      const sync = await getAppMeta('lastSyncedAt')
      expect(sync).toBe(1699999999)

      // Verified localStorage is wiped to preserve 5MB limit
      expect(localStorage.getItem('trackstr_media_cache')).toBeNull()
    })
  })
})
