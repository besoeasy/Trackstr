/**
 * Nostr Remote Signing (NIP-46 Bunker) Service
 * Supports bunker:// URIs and NIP-05 addresses (e.g. user@nsec.app, Amber, Keystr)
 */
import { BunkerSigner, parseBunkerInput } from 'nostr-tools/nip46'
import { generateSecretKey } from 'nostr-tools'
import { logger } from '@/utils/logger.js'

// Default fallback relays if none specified in bunker pointer
const DEFAULT_BUNKER_RELAYS = [
  'wss://relay.nsec.app',
  'wss://relay.damus.io',
  'wss://nos.lol',
]

/**
 * Converts Uint8Array to hex string
 * @param {Uint8Array} bytes
 * @returns {string}
 */
export function bytesToHex(bytes) {
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('')
}

/**
 * Converts hex string to Uint8Array
 * @param {string} hex
 * @returns {Uint8Array}
 */
export function hexToBytes(hex) {
  if (typeof hex !== 'string') return new Uint8Array(0)
  const clean = hex.trim()
  const bytes = new Uint8Array(clean.length / 2)
  for (let i = 0; i < clean.length; i += 2) {
    bytes[i / 2] = parseInt(clean.substring(i, i + 2), 16)
  }
  return bytes
}

/**
 * Retrieves existing client secret key or generates and stores a new one
 * @returns {Uint8Array}
 */
export function getOrCreateClientSecretKey() {
  const STORAGE_KEY = 'trackstr_bunker_client_secret'
  try {
    const existingHex = localStorage.getItem(STORAGE_KEY)
    if (existingHex && existingHex.length === 64) {
      return hexToBytes(existingHex)
    }
  } catch (err) {
    logger.warn('BunkerService', 'Could not read client secret key from storage:', err)
  }

  const sk = generateSecretKey()
  try {
    localStorage.setItem(STORAGE_KEY, bytesToHex(sk))
  } catch (err) {
    logger.warn('BunkerService', 'Could not persist client secret key:', err)
  }
  return sk
}

class BunkerService {
  constructor() {
    /** @type {BunkerSigner|null} */
    this.signer = null
    this.bunkerPointer = null
    this.activePubkey = null
    this.lastAuthUrl = null
  }

  /**
   * Checks whether Bunker signer is currently connected and ready
   * @returns {boolean}
   */
  isConnected() {
    return !!this.signer
  }

  /**
   * Returns current active user pubkey from Bunker session
   * @returns {string|null}
   */
  getStoredPubkey() {
    return this.activePubkey || localStorage.getItem('trackstr_pubkey') || null
  }

  /**
   * Returns current active bunker pointer
   * @returns {Object|null}
   */
  getBunkerPointer() {
    if (this.bunkerPointer) return this.bunkerPointer
    try {
      const raw = localStorage.getItem('trackstr_bunker_pointer')
      return raw ? JSON.parse(raw) : null
    } catch {
      return null
    }
  }

  /**
   * Handles remote authentication URL from Bunker (e.g. nsec.app approval link)
   * @param {string} authUrl
   * @param {Function} [onAuthUrl]
   */
  handleAuthUrl(authUrl, onAuthUrl) {
    this.lastAuthUrl = authUrl
    logger.info('BunkerService', `Remote signer requires authorization: ${authUrl}`)

    if (typeof onAuthUrl === 'function') {
      try {
        onAuthUrl(authUrl)
      } catch (e) {
        logger.warn('BunkerService', 'Error in onAuthUrl callback:', e)
      }
    }

    if (typeof window !== 'undefined') {
      window.dispatchEvent(
        new CustomEvent('trackstr:bunker-auth', {
          detail: { url: authUrl },
        })
      )

      window.dispatchEvent(
        new CustomEvent('trackstr:extension-action', {
          detail: {
            active: true,
            type: 'bunker-auth',
            title: 'Remote Signer Authorization Required',
            message: 'Your Bunker signer requires one-time approval. Click to open authorization:',
            authUrl: authUrl,
          },
        })
      )

      // Attempt automatic pop-up window
      try {
        const popup = window.open(authUrl, '_blank', 'width=620,height=750,noopener,noreferrer')
        if (!popup || popup.closed || typeof popup.closed === 'undefined') {
          logger.warn('BunkerService', 'Browser popup was blocked; user can click the banner or modal link.')
        }
      } catch (err) {
        logger.warn('BunkerService', 'Could not open auth popup:', err)
      }
    }
  }

  /**
   * Connect to Bunker using URI (bunker://...) or NIP-05 (user@domain.com)
   * @param {string} bunkerInput
   * @param {Object} [options]
   * @param {SimplePool} [options.pool]
   * @param {Function} [options.onAuthUrl]
   * @param {Function} [options.onStatus]
   * @returns {Promise<{ pubkey: string, pointer: Object }>}
   */
  async connectBunker(bunkerInput, options = {}) {
    const rawInput = (bunkerInput || '').trim()
    if (!rawInput) {
      throw new Error('Please enter a Bunker URI (bunker://...) or NIP-05 address (e.g. name@nsec.app).')
    }

    options.onStatus?.('Parsing Bunker connection details...')
    logger.info('BunkerService', `Resolving bunker input: ${rawInput}`)

    let bp
    try {
      bp = await parseBunkerInput(rawInput)
    } catch (parseErr) {
      logger.error('BunkerService', 'parseBunkerInput failed:', parseErr)
      throw new Error(`Failed to parse bunker input: ${parseErr.message || 'Invalid format'}`)
    }

    if (!bp || !bp.pubkey) {
      throw new Error(
        'Could not find a valid Bunker provider from the input. Make sure the bunker URI is valid (bunker://<pubkey>?relay=...) or the NIP-05 address provides NIP-46 relays.'
      )
    }

    // Ensure relays exist
    if (!Array.isArray(bp.relays) || bp.relays.length === 0) {
      logger.warn('BunkerService', 'No relays specified in bunker pointer, using default fallbacks:', DEFAULT_BUNKER_RELAYS)
      bp.relays = [...DEFAULT_BUNKER_RELAYS]
    }

    const clientSecretKey = getOrCreateClientSecretKey()

    options.onStatus?.('Subscribing to Bunker relay channels...')
    logger.info('BunkerService', 'Initializing BunkerSigner with relays:', bp.relays)

    // Clean up any existing active signer
    if (this.signer) {
      try {
        await this.signer.close()
      } catch {}
      this.signer = null
    }

    const signer = BunkerSigner.fromBunker(clientSecretKey, bp, {
      pool: options.pool,
      onauth: (authUrl) => this.handleAuthUrl(authUrl, options.onAuthUrl),
    })

    options.onStatus?.('Sending handshake connection request...')
    const origin = typeof window !== 'undefined' ? window.location.origin : 'https://trackstr.app'
    const clientMetadata = {
      name: 'Trackstr',
      url: origin,
      image: `${origin}/favicon.ico`,
    }

    const connectPromise = signer.connect(clientMetadata)
    const connectTimeout = new Promise((_, reject) => {
      setTimeout(() => {
        reject(
          new Error(
            'Connection timed out after 60s. Please ensure your Bunker signer (nsec.app, Amber, Keystr) is online, connected, and approved the request.'
          )
        )
      }, 60000)
    })

    try {
      await Promise.race([connectPromise, connectTimeout])
      logger.info('BunkerService', 'Bunker connection handshake acknowledged!')
    } catch (connErr) {
      logger.error('BunkerService', 'signer.connect() error:', connErr)
      try {
        await signer.close()
      } catch {}
      throw connErr
    }

    options.onStatus?.('Retrieving public key from Bunker...')
    const pkPromise = signer.getPublicKey()
    const pkTimeout = new Promise((_, reject) => {
      setTimeout(() => {
        reject(new Error('Timed out waiting for public key from Bunker.'))
      }, 30000)
    })

    let userPubkey
    try {
      userPubkey = await Promise.race([pkPromise, pkTimeout])
      if (!userPubkey || typeof userPubkey !== 'string') {
        throw new Error('Signer returned an empty or invalid public key.')
      }
    } catch (pkErr) {
      logger.error('BunkerService', 'signer.getPublicKey() error:', pkErr)
      try {
        await signer.close()
      } catch {}
      throw pkErr
    }

    this.signer = signer
    this.bunkerPointer = bp
    this.activePubkey = userPubkey

    // Persist credentials
    try {
      localStorage.setItem('trackstr_auth_type', 'bunker')
      localStorage.setItem('trackstr_bunker_pointer', JSON.stringify(bp))
      localStorage.setItem('trackstr_bunker_input', rawInput)
      localStorage.setItem('trackstr_pubkey', userPubkey)
    } catch (storageErr) {
      logger.warn('BunkerService', 'Could not save bunker credentials to localStorage:', storageErr)
    }

    logger.info('BunkerService', `Successfully connected to Bunker! Pubkey: ${userPubkey}`)
    return { pubkey: userPubkey, pointer: bp, signer }
  }

  /**
   * Restores Bunker session on page refresh if previously connected
   * @param {Object} [options]
   * @param {SimplePool} [options.pool]
   * @param {Function} [options.onAuthUrl]
   * @returns {Promise<BunkerSigner|null>}
   */
  async restoreBunkerSigner(options = {}) {
    try {
      const authType = localStorage.getItem('trackstr_auth_type')
      if (authType !== 'bunker') return null

      const rawPointer = localStorage.getItem('trackstr_bunker_pointer')
      if (!rawPointer) return null

      const bp = JSON.parse(rawPointer)
      if (!bp || !bp.pubkey || !bp.relays || bp.relays.length === 0) return null

      logger.info('BunkerService', 'Restoring Bunker signer session from localStorage...')
      const clientSecretKey = getOrCreateClientSecretKey()

      const signer = BunkerSigner.fromBunker(clientSecretKey, bp, {
        pool: options.pool,
        onauth: (authUrl) => this.handleAuthUrl(authUrl, options.onAuthUrl),
      })

      this.signer = signer
      this.bunkerPointer = bp
      this.activePubkey = localStorage.getItem('trackstr_pubkey') || null

      // Fire off background verification without blocking UI
      signer
        .ping()
        .then(() => {
          logger.info('BunkerService', 'Bunker session ping successfully acknowledged.')
        })
        .catch((pingErr) => {
          logger.warn('BunkerService', 'Background ping to Bunker signer pending or unacknowledged:', pingErr?.message || pingErr)
        })

      return signer
    } catch (err) {
      logger.error('BunkerService', 'Failed to restore Bunker signer session:', err)
      return null
    }
  }

  /**
   * Retrieves public key
   * @returns {Promise<string>}
   */
  async getPublicKey() {
    if (this.activePubkey) return this.activePubkey
    if (!this.signer) {
      throw new Error('Bunker signer is not connected.')
    }
    const pk = await this.signer.getPublicKey()
    this.activePubkey = pk
    return pk
  }

  /**
   * Signs an event using remote Bunker signer
   * @param {Object} eventTemplate
   * @returns {Promise<Object>} Signed Nostr event
   */
  async signEvent(eventTemplate) {
    if (!this.signer) {
      throw new Error('Bunker signer is not connected. Please log in via Bunker.')
    }

    const fullTemplate = { ...eventTemplate }
    if (!fullTemplate.pubkey) {
      fullTemplate.pubkey = this.activePubkey || (await this.getPublicKey())
    }
    if (!fullTemplate.created_at) {
      fullTemplate.created_at = Math.floor(Date.now() / 1000)
    }
    if (!Array.isArray(fullTemplate.tags)) {
      fullTemplate.tags = []
    }
    if (typeof fullTemplate.content !== 'string') {
      fullTemplate.content = ''
    }

    logger.info('BunkerService', `Requesting signature for kind ${fullTemplate.kind} from Bunker...`, fullTemplate)

    if (typeof window !== 'undefined') {
      window.dispatchEvent(
        new CustomEvent('trackstr:extension-action', {
          detail: {
            active: true,
            type: 'bunker-sign',
            kind: fullTemplate.kind,
            title: `Approve Event (Kind ${fullTemplate.kind}) on Bunker`,
            message: 'Please approve the signature request in your remote signer app (e.g. nsec.app, Amber, Keystr).',
          },
        })
      )
      window.dispatchEvent(new CustomEvent('trackstr:signing', { detail: { active: true, kind: fullTemplate.kind } }))
    }

    const signPromise = this.signer.signEvent(fullTemplate)
    const timeoutPromise = new Promise((_, reject) => {
      setTimeout(() => {
        reject(
          new Error(
            'Bunker signing request timed out after 60s. Please ensure your remote signer is online and approves the request.'
          )
        )
      }, 60000)
    })

    try {
      const signed = await Promise.race([signPromise, timeoutPromise])
      logger.info('BunkerService', `✓ Event successfully signed via Bunker! ID: ${signed.id}`, signed)
      return signed
    } catch (err) {
      logger.error('BunkerService', 'Bunker signEvent failed or was rejected:', {
        message: err?.message || String(err),
        template: fullTemplate,
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
   * Disconnects Bunker session and clears credentials
   */
  async disconnectBunker() {
    if (this.signer) {
      try {
        await this.signer.close()
      } catch (err) {
        logger.warn('BunkerService', 'Error while closing Bunker connection:', err)
      }
    }

    this.signer = null
    this.bunkerPointer = null
    this.activePubkey = null
    this.lastAuthUrl = null

    try {
      localStorage.removeItem('trackstr_bunker_pointer')
      localStorage.removeItem('trackstr_bunker_input')
      if (localStorage.getItem('trackstr_auth_type') === 'bunker') {
        localStorage.removeItem('trackstr_auth_type')
        localStorage.removeItem('trackstr_pubkey')
      }
    } catch {}

    logger.info('BunkerService', 'Bunker signer disconnected and cleared')
  }
}

export const bunkerService = new BunkerService()
