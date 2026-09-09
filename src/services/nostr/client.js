/**
 * Nostr Client Service
 * Manages relay pool connections, event subscription, querying, and NIP-07 signing.
 * Includes comprehensive debug logging for extension detection and troubleshooting.
 */
import { SimplePool } from 'nostr-tools/pool'
import { nip19 } from 'nostr-tools'
import { getRelays } from './relays.js'
import { logger } from '@/utils/logger.js'
import { bunkerService } from './bunker.js'

class NostrClient {
  constructor() {
    this.pool = new SimplePool()
    logger.info('NostrClient', 'Initialized NostrClient with SimplePool')
  }

  /**
   * Returns current active relays
   * @returns {string[]}
   */
  getRelays() {
    return getRelays()
  }

  /**
   * Inspects extension status and returns detailed diagnostic report
   * @returns {Object}
   */
  getDiagnostics() {
    if (typeof window === 'undefined') {
      return { environment: 'server', hasWindow: false }
    }

    const hasNostr = typeof window.nostr !== 'undefined'
    const nostrType = typeof window.nostr
    let methods = []
    let properties = []

    if (hasNostr && window.nostr) {
      try {
        properties = Object.keys(window.nostr)
        methods = Object.getOwnPropertyNames(Object.getPrototypeOf(window.nostr) || {})
          .concat(properties)
          .filter((key) => typeof window.nostr[key] === 'function')
      } catch (err) {
        logger.warn('NostrClient', 'Error reading window.nostr properties', err)
      }
    }

    return {
      hasWindow: true,
      hasNostr,
      nostrType,
      methods: Array.from(new Set(methods)),
      properties: Array.from(new Set(properties)),
      documentReady: document.readyState,
      activeRelays: this.getRelays(),
      location: window.location.href,
      bunkerConnected: bunkerService.isConnected(),
      bunkerPointer: bunkerService.getBunkerPointer(),
    }
  }

  /**
   * Checks whether any signing method (Bunker or NIP-07 extension) is active
   * @returns {boolean}
   */
  hasSigner() {
    return bunkerService.isConnected() || this.hasExtension()
  }

  /**
   * Checks whether NIP-07 browser extension (e.g. Alby, nos2x) is currently available
   * @returns {boolean}
   */
  hasExtension() {
    const available = typeof window !== 'undefined' && typeof window.nostr !== 'undefined' && !!window.nostr
    logger.debug('NostrClient', `hasExtension check: ${available}`)
    return available
  }

  /**
   * Asynchronously waits for NIP-07 extension to be injected by browser
   * @param {number} timeoutMs
   * @returns {Promise<boolean>}
   */
  async waitForExtension(timeoutMs = 1500) {
    if (typeof window === 'undefined') return false
    if (window.nostr && typeof window.nostr.getPublicKey === 'function') {
      logger.info('NostrClient', 'NIP-07 extension is immediately available on window.nostr')
      return true
    }

    logger.info('NostrClient', `Waiting up to ${timeoutMs}ms for extension injection...`)

    return new Promise((resolve) => {
      let resolved = false

      const check = () => {
        if (window.nostr && typeof window.nostr.getPublicKey === 'function') {
          if (!resolved) {
            resolved = true
            cleanup()
            logger.info('NostrClient', 'Extension detected during injection wait polling!')
            resolve(true)
          }
        }
      }

      const onReady = () => {
        logger.info('NostrClient', 'Received nostr:ready DOM event from extension')
        check()
      }

      window.addEventListener('nostr:ready', onReady)
      const interval = setInterval(check, 100)

      const timer = setTimeout(() => {
        if (!resolved) {
          resolved = true
          cleanup()
          const finalState = !!(window.nostr && typeof window.nostr.getPublicKey === 'function')
          logger.warn('NostrClient', `Wait for extension timed out after ${timeoutMs}ms. Detected: ${finalState}`)
          resolve(finalState)
        }
      }, timeoutMs)

      const cleanup = () => {
        clearTimeout(timer)
        clearInterval(interval)
        window.removeEventListener('nostr:ready', onReady)
      }
    })
  }

  /**
   * Prompts NIP-07 extension for public key
   * @returns {Promise<string>} Hex public key
   */
  async getPublicKeyFromExtension() {
    logger.info('NostrClient', 'Initiating getPublicKeyFromExtension()...')

    // First attempt quick wait if not already injected
    const available = await this.waitForExtension(1200)
    const diagnostics = this.getDiagnostics()

    logger.debug('NostrClient', 'Diagnostic state at login:', diagnostics)

    if (!available || !window.nostr) {
      const errMessage = 'No Nostr browser extension detected (e.g. Alby, nos2x). Please ensure an extension is installed and enabled for this site.'
      logger.error('NostrClient', errMessage, diagnostics)
      throw new Error(errMessage)
    }

    if (typeof window.nostr.getPublicKey !== 'function') {
      const errMessage = `window.nostr exists (${typeof window.nostr}), but window.nostr.getPublicKey is not a function.`
      logger.error('NostrClient', errMessage, diagnostics)
      throw new Error(errMessage)
    }

    // Some extensions support or require enable()
    if (typeof window.nostr.enable === 'function') {
      try {
        logger.debug('NostrClient', 'Calling window.nostr.enable()...')
        await window.nostr.enable()
      } catch (enableErr) {
        logger.warn('NostrClient', 'window.nostr.enable() threw an error or was declined:', enableErr)
      }
    }

    try {
      logger.info('NostrClient', 'Calling window.nostr.getPublicKey()... (check for extension approval prompt)')
      if (typeof window !== 'undefined') {
        window.dispatchEvent(
          new CustomEvent('trackstr:extension-action', {
            detail: {
              active: true,
              type: 'auth',
              title: 'Extension Authorization Required',
              message:
                'Check for the extension prompt window (e.g. nos2x, Alby). If not visible, check behind your browser window, your taskbar, or click your extension icon in the toolbar.',
            },
          })
        )
      }

      const getPkPromise = window.nostr.getPublicKey()
      const timeoutPromise = new Promise((_, reject) => {
        setTimeout(() => {
          reject(
            new Error(
              'Extension authorization request timed out after 45s. Please check if your browser blocked an extension popup window, or click the nos2x/Alby icon in your toolbar.'
            )
          )
        }, 45000)
      })

      const hex = await Promise.race([getPkPromise, timeoutPromise])

      if (!hex || typeof hex !== 'string') {
        throw new Error(`Extension returned empty or invalid public key: ${JSON.stringify(hex)}`)
      }

      let npub = ''
      try {
        npub = nip19.npubEncode(hex)
      } catch {}

      logger.info('NostrClient', `Successfully retrieved public key: ${hex} (${npub})`)
      return hex
    } catch (err) {
      logger.error('NostrClient', 'window.nostr.getPublicKey() failed:', {
        message: err.message || String(err),
        stack: err.stack,
        raw: err,
      })
      throw err
    } finally {
      if (typeof window !== 'undefined') {
        window.dispatchEvent(
          new CustomEvent('trackstr:extension-action', {
            detail: { active: false },
          })
        )
      }
    }
  }

  /**
   * Retrieves user's public key from either active Bunker or browser extension
   * @returns {Promise<string>}
   */
  async getPublicKey() {
    if (bunkerService.isConnected()) {
      return await bunkerService.getPublicKey()
    }
    return await this.getPublicKeyFromExtension()
  }

  /**
   * Signs an event using NIP-07 extension or NIP-46 Bunker
   * @param {Object} eventTemplate Unsigned event
   * @returns {Promise<Object>} Signed event with id, pubkey, sig
   */
  async signEvent(eventTemplate) {
    // If Bunker signer is active, delegate directly to BunkerService
    if (bunkerService.isConnected()) {
      return await bunkerService.signEvent(eventTemplate)
    }

    if (!this.hasExtension() || typeof window.nostr.signEvent !== 'function') {
      const msg = 'No Nostr browser extension or Bunker signer available for signing.'
      logger.error('NostrClient', msg)
      throw new Error(msg)
    }

    // Ensure pubkey is attached to the event template
    const fullTemplate = { ...eventTemplate }
    if (!fullTemplate.pubkey) {
      try {
        const pk = await this.getPublicKeyFromExtension()
        if (pk) fullTemplate.pubkey = pk
      } catch (pkErr) {
        logger.warn('NostrClient', 'Could not obtain pubkey prior to signing:', pkErr)
      }
    }

    logger.info('NostrClient', `Requesting signature for kind ${fullTemplate.kind} event from extension... (Check your browser extension prompt/badge)`, fullTemplate)

    // Wrap with a 45-second timeout so requests don't hang silently if a popup was blocked
    const signPromise = window.nostr.signEvent(fullTemplate)
    const timeoutPromise = new Promise((_, reject) => {
      setTimeout(() => {
        reject(
          new Error(
            'Extension signature request timed out after 45s. Please check if your browser blocked an extension popup or check the extension icon in your toolbar for a pending confirmation.'
          )
        )
      }, 45000)
    })

    try {
      if (typeof window !== 'undefined') {
        window.dispatchEvent(
          new CustomEvent('trackstr:extension-action', {
            detail: {
              active: true,
              type: 'sign',
              kind: fullTemplate.kind,
              title: `Approve Event (Kind ${fullTemplate.kind})`,
              message: `Please approve the Kind ${fullTemplate.kind} signing request in your browser extension. If the popup didn't appear in front, check behind your browser window or in your taskbar.`,
            },
          })
        )
        window.dispatchEvent(new CustomEvent('trackstr:signing', { detail: { active: true, kind: fullTemplate.kind } }))
      }
      const signed = await Promise.race([signPromise, timeoutPromise])
      logger.info('NostrClient', `✓ Event successfully signed! ID: ${signed.id}`, signed)
      return signed
    } catch (err) {
      logger.error('NostrClient', 'window.nostr.signEvent() failed or was rejected:', {
        message: err.message || String(err),
        event: fullTemplate,
      })
      throw err
    } finally {
      if (typeof window !== 'undefined') {
        window.dispatchEvent(
          new CustomEvent('trackstr:extension-action', {
            detail: { active: false },
          })
        )
        window.dispatchEvent(new CustomEvent('trackstr:signing', { detail: { active: false } }))
      }
    }
  }

  /**
   * Publishes an event to configured relays
   * @param {Object} signedEvent
   * @param {string[]} [customRelays]
   * @returns {Promise<{ publishedTo: string[], errors: Array<{ relay: string, error: any }> }>}
   */
  async publish(signedEvent, customRelays) {
    const relays = customRelays || this.getRelays()
    logger.info('NostrClient', `Publishing event ${signedEvent.id} (kind: ${signedEvent.kind}) to ${relays.length} relays...`, relays)

    const results = await Promise.allSettled(this.pool.publish(relays, signedEvent))

    const publishedTo = []
    const errors = []

    results.forEach((res, i) => {
      const relay = relays[i]
      if (res.status === 'fulfilled') {
        publishedTo.push(relay)
        logger.debug('NostrClient', `✓ Published to ${relay}`)
      } else {
        errors.push({ relay, error: res.reason })
        logger.warn('NostrClient', `✗ Failed to publish to ${relay}:`, res.reason)
      }
    })

    logger.info('NostrClient', `Publish result: ${publishedTo.length}/${relays.length} successful`, {
      publishedTo,
      failed: errors.map((e) => e.relay),
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
    logger.debug('NostrClient', 'Starting subscription with filters:', filters)

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

    logger.debug('NostrClient', `Querying relays (${relays.length}) with timeout ${timeoutMs}ms...`, filters)

    return new Promise((resolve) => {
      let isDone = false
      let timer = null

      const done = () => {
        if (isDone) return
        isDone = true
        if (timer) clearTimeout(timer)
        sub.close()
        logger.debug('NostrClient', `Query completed with ${events.length} unique events`)
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
    logger.info('NostrClient', `Fetching Kind 0 profile for ${pubkey}...`)

    const events = await this.queryEvents(
      {
        kinds: [0],
        authors: [pubkey],
        limit: 1,
      },
      undefined,
      4000
    )

    if (events.length === 0) {
      logger.info('NostrClient', `No Kind 0 event found on relays for ${pubkey}`)
      return null
    }

    events.sort((a, b) => b.created_at - a.created_at)
    try {
      const parsed = JSON.parse(events[0].content)
      logger.info('NostrClient', 'Successfully parsed Kind 0 profile metadata:', parsed)
      return parsed
    } catch (e) {
      logger.warn('NostrClient', 'Failed to parse Kind 0 JSON content:', e)
      return null
    }
  }
}

export const nostrClient = new NostrClient()
