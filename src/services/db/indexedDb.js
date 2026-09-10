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
const DB_VERSION = 1
const STORE_QUEUE = 'sync_queue'
const STORE_ITEMS = 'imported_items'

// In-memory fallback for headless or mock environments
const memoryQueue = new Map()
const memoryItems = new Map()

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
