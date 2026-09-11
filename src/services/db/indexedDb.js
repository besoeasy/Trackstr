/**
 * Trackstr IndexedDB Service
 *
 * Provides persistent, scalable browser storage for imported media libraries
 * and the asynchronous relay trickle queue. Unlike localStorage (capped at 5MB),
 * IndexedDB can easily store tens of thousands of media records.
 *
 * Includes an in-memory fallback for test environments or browsers without IndexedDB.
 */

const DB_NAME = 'trackstr_db'
const DB_VERSION = 2
const STORE_QUEUE = 'sync_queue'
const STORE_ITEMS = 'imported_items'
const STORE_MEDIA_CACHE = 'media_cache'
const STORE_EVENT_CACHE = 'event_cache'
const STORE_APP_META = 'app_meta'

export const CACHE_EXPIRY_DAYS = 30
export const CACHE_EXPIRY_MS = CACHE_EXPIRY_DAYS * 24 * 60 * 60 * 1000 // 30 days in ms (2,592,000,000)

// In-memory fallback for headless or mock environments
const memoryQueue = new Map()
const memoryItems = new Map()
const memoryMediaCache = new Map()
const memoryEventCache = new Map()
const memoryAppMeta = new Map()

function hasIndexedDb() {
  return typeof window !== 'undefined' && typeof window.indexedDB !== 'undefined' && window.indexedDB !== null
}

/**
 * Opens or upgrades the IndexedDB database
 * @returns {Promise<IDBDatabase|null>}
 */
export function openDb() {
  if (!hasIndexedDb()) {
    return Promise.resolve(null)
  }

  return new Promise((resolve, reject) => {
    const request = window.indexedDB.open(DB_NAME, DB_VERSION)

    request.onupgradeneeded = (event) => {
      const db = event.target.result

      // 1. Sync Queue Object Store
      if (!db.objectStoreNames.contains(STORE_QUEUE)) {
        const queueStore = db.createObjectStore(STORE_QUEUE, { keyPath: 'id' })
        queueStore.createIndex('by_status', 'syncStatus', { unique: false })
        queueStore.createIndex('by_contentId', 'contentId', { unique: false })
        queueStore.createIndex('by_createdAt', 'createdAt', { unique: false })
      }

      // 2. Imported Items Object Store
      if (!db.objectStoreNames.contains(STORE_ITEMS)) {
        const itemStore = db.createObjectStore(STORE_ITEMS, { keyPath: 'contentId' })
        itemStore.createIndex('by_title', 'name', { unique: false })
        itemStore.createIndex('by_status', 'status', { unique: false })
      }

      // 3. Media Cache Object Store (30-day expiry via by_cachedAt)
      if (!db.objectStoreNames.contains(STORE_MEDIA_CACHE)) {
        const mediaStore = db.createObjectStore(STORE_MEDIA_CACHE, { keyPath: 'contentId' })
        mediaStore.createIndex('by_cachedAt', 'cachedAt', { unique: false })
        mediaStore.createIndex('by_title', 'name', { unique: false })
        mediaStore.createIndex('by_type', 'type', { unique: false })
      }

      // 4. Event Cache Object Store (30-day expiry via by_cachedAt)
      if (!db.objectStoreNames.contains(STORE_EVENT_CACHE)) {
        const eventStore = db.createObjectStore(STORE_EVENT_CACHE, { keyPath: 'key' })
        eventStore.createIndex('by_category', 'category', { unique: false })
        eventStore.createIndex('by_cachedAt', 'cachedAt', { unique: false })
        eventStore.createIndex('by_contentId', 'contentId', { unique: false })
      }

      // 5. App Meta Object Store (for follows, sync timestamps, etc.)
      if (!db.objectStoreNames.contains(STORE_APP_META)) {
        db.createObjectStore(STORE_APP_META, { keyPath: 'key' })
      }
    }

    request.onsuccess = (event) => {
      resolve(event.target.result)
    }

    request.onerror = (event) => {
      console.warn('Failed to open IndexedDB:', event.target.error)
      resolve(null)
    }
  })
}

/**
 * Safely converts any value (including Vue reactive proxies) into a cloneable plain object/array.
 * Prevents "DOMException: Failed to execute 'put' on 'IDBObjectStore': #<Object> could not be cloned".
 * @param {*} val
 * @returns {*}
 */
export function toPlainObject(val) {
  if (val === null || typeof val !== 'object') return val
  try {
    return JSON.parse(JSON.stringify(val))
  } catch {
    if (Array.isArray(val)) {
      return val.map((item) => toPlainObject(item))
    }
    const clean = {}
    for (const key of Object.keys(val)) {
      const v = val[key]
      if (typeof v !== 'function' && typeof v !== 'symbol') {
        clean[key] = typeof v === 'object' && v !== null ? toPlainObject(v) : v
      }
    }
    return clean
  }
}

/**
 * Saves imported media items into the browser database
 * @param {Array<Object>} items
 * @returns {Promise<void>}
 */
export async function saveImportedItems(items) {
  if (!Array.isArray(items) || items.length === 0) return

  const cleanItems = toPlainObject(items)

  const db = await openDb()
  if (!db) {
    cleanItems.forEach((it) => {
      if (it.contentId) memoryItems.set(it.contentId, it)
    })
    return
  }

  return new Promise((resolve, reject) => {
    const tx = db.transaction([STORE_ITEMS], 'readwrite')
    const store = tx.objectStore(STORE_ITEMS)

    for (const item of cleanItems) {
      if (item.contentId) {
        store.put(toPlainObject(item))
      }
    }

    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error)
  })
}

/**
 * Retrieves all imported media items from the database
 * @returns {Promise<Array<Object>>}
 */
export async function getImportedItems() {
  const db = await openDb()
  if (!db) {
    return Array.from(memoryItems.values())
  }

  return new Promise((resolve, reject) => {
    const tx = db.transaction([STORE_ITEMS], 'readonly')
    const store = tx.objectStore(STORE_ITEMS)
    const request = store.getAll()

    request.onsuccess = () => resolve(request.result || [])
    request.onerror = () => reject(request.error)
  })
}

/**
 * Adds entries into the background relay sync queue
 * @param {Array<Object>} queueEntries
 * @returns {Promise<void>}
 */
export async function queueSyncItems(queueEntries) {
  if (!Array.isArray(queueEntries) || queueEntries.length === 0) return

  const cleanEntries = toPlainObject(queueEntries)

  const db = await openDb()
  if (!db) {
    cleanEntries.forEach((entry) => {
      memoryQueue.set(entry.id, entry)
    })
    return
  }

  return new Promise((resolve, reject) => {
    const tx = db.transaction([STORE_QUEUE], 'readwrite')
    const store = tx.objectStore(STORE_QUEUE)

    for (const entry of cleanEntries) {
      store.put(toPlainObject(entry))
    }

    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error)
  })
}

/**
 * Retrieves the next batch of pending queue items
 * @param {number} [limit=10]
 * @returns {Promise<Array<Object>>}
 */
export async function getPendingQueue(limit = 10) {
  const db = await openDb()
  if (!db) {
    const pending = Array.from(memoryQueue.values())
      .filter((e) => e.syncStatus === 'pending')
      .slice(0, limit)
    return pending
  }

  return new Promise((resolve, reject) => {
    const tx = db.transaction([STORE_QUEUE], 'readonly')
    const store = tx.objectStore(STORE_QUEUE)
    const index = store.index('by_status')
    const request = index.getAll('pending', limit)

    request.onsuccess = () => resolve(request.result || [])
    request.onerror = () => reject(request.error)
  })
}

/**
 * Updates a queue item status or fields
 * @param {string} id
 * @param {Object} updates
 * @returns {Promise<void>}
 */
export async function updateQueueItem(id, updates) {
  const db = await openDb()
  if (!db) {
    const existing = memoryQueue.get(id)
    if (existing) {
      memoryQueue.set(id, { ...existing, ...updates, updatedAt: Date.now() })
    }
    return
  }

  return new Promise((resolve, reject) => {
    const tx = db.transaction([STORE_QUEUE], 'readwrite')
    const store = tx.objectStore(STORE_QUEUE)
    const getReq = store.get(id)

    getReq.onsuccess = () => {
      const existing = getReq.result
      if (existing) {
        store.put(toPlainObject({ ...existing, ...updates, updatedAt: Date.now() }))
      }
      resolve()
    }
    getReq.onerror = () => reject(getReq.error)
  })
}

/**
 * Returns overall queue statistics
 * @returns {Promise<{ total: number, pending: number, syncing: number, synced: number, failed: number }>}
 */
export async function getQueueStats() {
  const db = await openDb()
  if (!db) {
    const all = Array.from(memoryQueue.values())
    const stats = { total: all.length, pending: 0, syncing: 0, synced: 0, failed: 0 }
    all.forEach((e) => {
      if (stats[e.syncStatus] !== undefined) stats[e.syncStatus]++
    })
    return stats
  }

  return new Promise((resolve, reject) => {
    const tx = db.transaction([STORE_QUEUE], 'readonly')
    const store = tx.objectStore(STORE_QUEUE)
    const request = store.getAll()

    request.onsuccess = () => {
      const all = request.result || []
      const stats = { total: all.length, pending: 0, syncing: 0, synced: 0, failed: 0 }
      all.forEach((e) => {
        if (stats[e.syncStatus] !== undefined) stats[e.syncStatus]++
      })
      resolve(stats)
    }
    request.onerror = () => reject(request.error)
  })
}

/**
 * Resets all failed queue items back to 'pending'
 * @returns {Promise<number>} count of reset items
 */
export async function resetFailedItems() {
  const db = await openDb()
  if (!db) {
    let count = 0
    memoryQueue.forEach((entry, key) => {
      if (entry.syncStatus === 'failed') {
        entry.syncStatus = 'pending'
        entry.error = null
        entry.attempts = 0
        memoryQueue.set(key, entry)
        count++
      }
    })
    return count
  }

  return new Promise((resolve, reject) => {
    const tx = db.transaction([STORE_QUEUE], 'readwrite')
    const store = tx.objectStore(STORE_QUEUE)
    const index = store.index('by_status')
    const request = index.getAll('failed')

    request.onsuccess = () => {
      const failed = request.result || []
      failed.forEach((entry) => {
        entry.syncStatus = 'pending'
        entry.error = null
        entry.attempts = 0
        store.put(toPlainObject(entry))
      })
      resolve(failed.length)
    }
    request.onerror = () => reject(request.error)
  })
}

/**
 * Clears both the queue and imported items
 * @returns {Promise<void>}
 */
export async function clearImportData() {
  memoryQueue.clear()
  memoryItems.clear()

  const db = await openDb()
  if (!db) return

  return new Promise((resolve, reject) => {
    const tx = db.transaction([STORE_QUEUE, STORE_ITEMS], 'readwrite')
    tx.objectStore(STORE_QUEUE).clear()
    tx.objectStore(STORE_ITEMS).clear()
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error)
  })
}

/**
 * Saves media library items into the 30-day media cache
 * @param {Object|Array<Object>} mediaMap
 * @returns {Promise<void>}
 */
export async function saveMediaCache(mediaMap) {
  if (!mediaMap || typeof mediaMap !== 'object') return

  const items = Array.isArray(mediaMap) ? mediaMap : Object.values(mediaMap)
  if (items.length === 0) return

  const now = Date.now()
  const cleanItems = items
    .filter((it) => it && (it.contentId || it.contentid))
    .map((it) => {
      const plain = toPlainObject(it)
      const contentId = plain.contentId || plain.contentid
      plain.contentId = contentId
      if (!plain.cachedAt) plain.cachedAt = now
      return plain
    })

  if (cleanItems.length === 0) return

  const db = await openDb()
  if (!db) {
    cleanItems.forEach((it) => memoryMediaCache.set(it.contentId, it))
    return
  }

  return new Promise((resolve, reject) => {
    const tx = db.transaction([STORE_MEDIA_CACHE], 'readwrite')
    const store = tx.objectStore(STORE_MEDIA_CACHE)
    for (const item of cleanItems) {
      store.put(item)
    }
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error)
  })
}

/**
 * Loads all non-expired media items from the media cache (30-day TTL)
 * Automatically cleans up expired records.
 * @param {Object} [options]
 * @param {number} [options.now] custom timestamp for testing expiry
 * @returns {Promise<Record<string, Object>>}
 */
export async function loadMediaCache(options = {}) {
  const now = typeof options.now === 'number' ? options.now : Date.now()
  const threshold = now - CACHE_EXPIRY_MS
  const db = await openDb()

  if (!db) {
    const result = {}
    const expiredKeys = []
    for (const [cid, item] of memoryMediaCache.entries()) {
      if (item.cachedAt && item.cachedAt < threshold) {
        expiredKeys.push(cid)
      } else {
        result[cid] = item
      }
    }
    expiredKeys.forEach((k) => memoryMediaCache.delete(k))
    return result
  }

  return new Promise((resolve, reject) => {
    const tx = db.transaction([STORE_MEDIA_CACHE], 'readwrite')
    const store = tx.objectStore(STORE_MEDIA_CACHE)
    const request = store.getAll()

    request.onsuccess = () => {
      const all = request.result || []
      const result = {}
      const expiredKeys = []

      for (const item of all) {
        if (!item.contentId) continue
        if (item.cachedAt && item.cachedAt < threshold) {
          expiredKeys.push(item.contentId)
        } else {
          result[item.contentId] = item
        }
      }

      for (const key of expiredKeys) {
        store.delete(key)
      }

      resolve(result)
    }
    request.onerror = () => reject(request.error)
  })
}

/**
 * Saves state event records (statuses, ratings, suggestions) into event_cache with 30-day TTL
 * @param {'status'|'rating'|'suggestion'} category
 * @param {Record<string, Object>} eventsMap
 * @returns {Promise<void>}
 */
export async function saveEventCache(category, eventsMap) {
  if (!eventsMap || typeof eventsMap !== 'object') return

  const entries = Object.entries(eventsMap)
  if (entries.length === 0) return

  const now = Date.now()
  const cleanEntries = entries
    .filter(([key, val]) => key && val)
    .map(([key, val]) => {
      const plainVal = toPlainObject(val)
      const cachedAt = plainVal.cachedAt || now
      plainVal.cachedAt = cachedAt
      return {
        key,
        category,
        contentId: plainVal.contentId || plainVal.media?.contentId || '',
        data: plainVal,
        cachedAt,
      }
    })

  if (cleanEntries.length === 0) return

  const db = await openDb()
  if (!db) {
    cleanEntries.forEach((entry) => memoryEventCache.set(entry.key, entry))
    return
  }

  return new Promise((resolve, reject) => {
    const tx = db.transaction([STORE_EVENT_CACHE], 'readwrite')
    const store = tx.objectStore(STORE_EVENT_CACHE)
    for (const entry of cleanEntries) {
      store.put(entry)
    }
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error)
  })
}

/**
 * Loads non-expired events from event_cache (30-day TTL)
 * @param {'status'|'rating'|'suggestion'} [category]
 * @param {Object} [options]
 * @param {number} [options.now]
 * @returns {Promise<Record<string, Object>>}
 */
export async function loadEventCache(category = null, options = {}) {
  const now = typeof options.now === 'number' ? options.now : Date.now()
  const threshold = now - CACHE_EXPIRY_MS
  const db = await openDb()

  if (!db) {
    const result = {}
    const expiredKeys = []
    for (const [key, entry] of memoryEventCache.entries()) {
      if (category && entry.category !== category) continue
      if (entry.cachedAt && entry.cachedAt < threshold) {
        expiredKeys.push(key)
      } else {
        result[key] = entry.data || entry
      }
    }
    expiredKeys.forEach((k) => memoryEventCache.delete(k))
    return result
  }

  return new Promise((resolve, reject) => {
    const tx = db.transaction([STORE_EVENT_CACHE], 'readwrite')
    const store = tx.objectStore(STORE_EVENT_CACHE)

    let request
    if (category) {
      const index = store.index('by_category')
      request = index.getAll(category)
    } else {
      request = store.getAll()
    }

    request.onsuccess = () => {
      const all = request.result || []
      const result = {}
      const expiredKeys = []

      for (const entry of all) {
        if (!entry.key) continue
        if (entry.cachedAt && entry.cachedAt < threshold) {
          expiredKeys.push(entry.key)
        } else {
          result[entry.key] = entry.data || entry
        }
      }

      for (const key of expiredKeys) {
        store.delete(key)
      }

      resolve(result)
    }
    request.onerror = () => reject(request.error)
  })
}

/**
 * Saves metadata into app_meta
 * @param {string} key
 * @param {*} value
 * @returns {Promise<void>}
 */
export async function saveAppMeta(key, value) {
  if (!key) return
  const record = { key, value: toPlainObject(value), updatedAt: Date.now() }

  const db = await openDb()
  if (!db) {
    memoryAppMeta.set(key, record)
    return
  }

  return new Promise((resolve, reject) => {
    const tx = db.transaction([STORE_APP_META], 'readwrite')
    tx.objectStore(STORE_APP_META).put(record)
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error)
  })
}

/**
 * Reads metadata from app_meta
 * @param {string} key
 * @param {*} [defaultValue=null]
 * @returns {Promise<*>}
 */
export async function getAppMeta(key, defaultValue = null) {
  if (!key) return defaultValue

  const db = await openDb()
  if (!db) {
    const item = memoryAppMeta.get(key)
    return item && item.value !== undefined ? item.value : defaultValue
  }

  return new Promise((resolve, reject) => {
    const tx = db.transaction([STORE_APP_META], 'readonly')
    const request = tx.objectStore(STORE_APP_META).get(key)

    request.onsuccess = () => {
      const result = request.result
      resolve(result && result.value !== undefined ? result.value : defaultValue)
    }
    request.onerror = () => reject(request.error)
  })
}

/**
 * Scans media_cache and event_cache and purges records older than 30 days
 * @param {number} [now=Date.now()]
 * @returns {Promise<{ prunedMedia: number, prunedEvents: number }>}
 */
export async function pruneExpiredCache(now = Date.now()) {
  const threshold = now - CACHE_EXPIRY_MS
  let prunedMedia = 0
  let prunedEvents = 0

  const db = await openDb()
  if (!db) {
    for (const [k, v] of memoryMediaCache.entries()) {
      if (v.cachedAt && v.cachedAt < threshold) {
        memoryMediaCache.delete(k)
        prunedMedia++
      }
    }
    for (const [k, v] of memoryEventCache.entries()) {
      if (v.cachedAt && v.cachedAt < threshold) {
        memoryEventCache.delete(k)
        prunedEvents++
      }
    }
    return { prunedMedia, prunedEvents }
  }

  return new Promise((resolve, reject) => {
    const tx = db.transaction([STORE_MEDIA_CACHE, STORE_EVENT_CACHE], 'readwrite')
    const mediaStore = tx.objectStore(STORE_MEDIA_CACHE)
    const eventStore = tx.objectStore(STORE_EVENT_CACHE)

    const mediaReq = mediaStore.getAll()
    mediaReq.onsuccess = () => {
      for (const it of mediaReq.result || []) {
        if (it.cachedAt && it.cachedAt < threshold) {
          mediaStore.delete(it.contentId)
          prunedMedia++
        }
      }
    }

    const eventReq = eventStore.getAll()
    eventReq.onsuccess = () => {
      for (const it of eventReq.result || []) {
        if (it.cachedAt && it.cachedAt < threshold) {
          eventStore.delete(it.key)
          prunedEvents++
        }
      }
    }

    tx.oncomplete = () => resolve({ prunedMedia, prunedEvents })
    tx.onerror = () => reject(tx.error)
  })
}

/**
 * Automatically migrates legacy localStorage payload ('trackstr_media_cache')
 * into IndexedDB with a 30-day expiry stamp, then purges the localStorage key.
 * @returns {Promise<{ migrated: boolean, error?: string }>}
 */
export async function migrateLocalStorageToIndexedDb() {
  const storage = typeof window !== 'undefined' && window.localStorage
    ? window.localStorage
    : typeof globalThis.localStorage !== 'undefined'
      ? globalThis.localStorage
      : null

  if (!storage) return { migrated: false, reason: 'no-storage' }

  const raw = storage.getItem('trackstr_media_cache')
  if (!raw) return { migrated: false, reason: 'no-legacy-data' }

  try {
    const data = JSON.parse(raw)

    if (data.mediaLibrary && typeof data.mediaLibrary === 'object') {
      await saveMediaCache(data.mediaLibrary)
    }

    if (data.statuses && typeof data.statuses === 'object') {
      await saveEventCache('status', data.statuses)
    }

    if (data.ratings && typeof data.ratings === 'object') {
      await saveEventCache('rating', data.ratings)
    }

    if (data.suggestions && typeof data.suggestions === 'object') {
      await saveEventCache('suggestion', data.suggestions)
    }

    if (data.follows) {
      await saveAppMeta('follows', data.follows)
    }

    if (data.lastSyncedAt) {
      await saveAppMeta('lastSyncedAt', data.lastSyncedAt)
    }

    if (data.nostrContentIds) {
      await saveAppMeta('nostrContentIds', data.nostrContentIds)
    }

    // Free the 5MB localStorage space
    storage.removeItem('trackstr_media_cache')
    return { migrated: true }
  } catch (err) {
    console.warn('Failed to migrate localStorage to IndexedDB:', err)
    return { migrated: false, error: err.message }
  }
}

/**
 * Clears media_cache, event_cache, and app_meta
 * @returns {Promise<void>}
 */
export async function clearMediaAndEventCache() {
  memoryMediaCache.clear()
  memoryEventCache.clear()
  memoryAppMeta.clear()

  const db = await openDb()
  if (!db) return

  return new Promise((resolve, reject) => {
    const tx = db.transaction([STORE_MEDIA_CACHE, STORE_EVENT_CACHE, STORE_APP_META], 'readwrite')
    tx.objectStore(STORE_MEDIA_CACHE).clear()
    tx.objectStore(STORE_EVENT_CACHE).clear()
    tx.objectStore(STORE_APP_META).clear()
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error)
  })
}
