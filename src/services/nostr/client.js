/**
 * Nostr Client Service
 * Manages relay pool connections, event subscription, querying, and NIP-07 signing.
 */
import { SimplePool } from 'nostr-tools/pool'
import { getRelays } from './relays.js'

class NostrClient {
  constructor() {
    this.pool = new SimplePool()
  }

  /**
   * Returns current active relays
   * @returns {string[]}
   */
  getRelays() {
    return getRelays()
  }

  /**
   * Checks whether NIP-07 browser extension (e.g. Alby, nos2x) is available
   * @returns {boolean}
   */
  hasExtension() {
    return typeof window !== 'undefined' && typeof window.nostr !== 'undefined'
  }

  /**
   * Prompts NIP-07 extension for public key
   * @returns {Promise<string>} Hex public key
   */
  async getPublicKeyFromExtension() {
    if (!this.hasExtension()) {
      throw new Error('No Nostr browser extension detected (e.g. Alby, nos2x).')
    }
    return await window.nostr.getPublicKey()
  }

  /**
   * Signs an event using NIP-07 extension
   * @param {Object} eventTemplate Unsigned event
   * @returns {Promise<Object>} Signed event with id, pubkey, sig
   */
  async signEvent(eventTemplate) {
    if (!this.hasExtension()) {
      throw new Error('No Nostr browser extension available for signing.')
    }
    return await window.nostr.signEvent(eventTemplate)
  }

  /**
   * Publishes an event to configured relays
   * @param {Object} signedEvent
   * @param {string[]} [customRelays]
   * @returns {Promise<{ publishedTo: string[], errors: Array<{ relay: string, error: any }> }>}
   */
  async publish(signedEvent, customRelays) {
    const relays = customRelays || this.getRelays()
    const results = await Promise.allSettled(this.pool.publish(relays, signedEvent))

    const publishedTo = []
    const errors = []

    results.forEach((res, i) => {
      const relay = relays[i]
      if (res.status === 'fulfilled') {
        publishedTo.push(relay)
      } else {
        errors.push({ relay, error: res.reason })
      }
    })

    return { publishedTo, errors }
  }

  /**
   * Subscribes to events across relays until EOSE
   * @param {Array<Object>} filters
   * @param {Object} callbacks
   * @param {Function} callbacks.onEvent
   * @param {Function} [callbacks.onEose]
   * @param {string[]} [customRelays]
   * @returns {() => void} Unsubscribe function
   */
  subscribe(filters, callbacks, customRelays) {
    const relays = customRelays || this.getRelays()
    const sub = this.pool.subscribeMany(relays, filters, {
      onevent(evt) {
        callbacks.onEvent?.(evt)
      },
      oneose() {
        callbacks.onEose?.()
      },
    })

    return () => {
      try {
        sub.close()
      } catch (e) {
        console.warn('Error closing subscription:', e)
      }
    }
  }

  /**
   * Queries events matching filter and collects them until EOSE / timeout
   * @param {Object|Array<Object>} filter
   * @param {string[]} [customRelays]
   * @param {number} [timeoutMs=5000]
   * @returns {Promise<Array<Object>>}
   */
  async queryEvents(filter, customRelays, timeoutMs = 5000) {
    const relays = customRelays || this.getRelays()
    const filters = Array.isArray(filter) ? filter : [filter]
    const events = []
    const seenIds = new Set()

    return new Promise((resolve) => {
      let isDone = false
      let timer = null

      const done = () => {
        if (isDone) return
        isDone = true
        if (timer) clearTimeout(timer)
        sub.close()
        resolve(events)
      }

      timer = setTimeout(done, timeoutMs)

      const sub = this.pool.subscribeMany(relays, filters, {
        onevent(evt) {
          if (!seenIds.has(evt.id)) {
            seenIds.add(evt.id)
            events.push(evt)
          }
        },
        oneose() {
          done()
        },
      })
    })
  }

  /**
   * Fetches user profile metadata (Kind 0)
   * @param {string} pubkey Hex pubkey
   * @returns {Promise<Object|null>}
   */
  async fetchProfile(pubkey) {
    if (!pubkey) return null
    const events = await this.queryEvents(
      {
        kinds: [0],
        authors: [pubkey],
        limit: 1,
      },
      undefined,
      4000
    )

    if (events.length === 0) return null

    // Sort by created_at desc to get latest
    events.sort((a, b) => b.created_at - a.created_at)
    try {
      return JSON.parse(events[0].content)
    } catch {
      return null
    }
  }
}

export const nostrClient = new NostrClient()
