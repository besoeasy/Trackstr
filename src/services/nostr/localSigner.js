/**
 * Trackstr Local Signer Service
 *
 * Signs events directly in the browser with a locally-stored nsec (NIP-19
 * private key). Supports two flows:
 *   1. nsec login — user pastes an existing nsec (e.g. from a Nostr client).
 *   2. Disposable account — a fresh nsec is generated for one-time use.
 *
 * SECURITY NOTE: the nsec is stored in localStorage so the app can sign
 * without a browser extension. This is convenient but means anyone with
 * access to the browser profile can spend the key. Disposable accounts are
 * the safe default; for long-lived keys prefer a NIP-07 extension.
 */
import { generateSecretKey, getPublicKey, finalizeEvent, nip19 } from 'nostr-tools'
import { logger } from '@/utils/logger.js'

const NSEC_STORAGE_KEY = 'trackstr_nsec'
const PUBKEY_STORAGE_KEY = 'trackstr_pubkey'
const AUTH_TYPE_STORAGE_KEY = 'trackstr_auth_type'

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
  if (!/^[0-9a-f]*$/i.test(clean) || clean.length === 0 || clean.length % 2 !== 0) {
    return new Uint8Array(0)
  }
  const bytes = new Uint8Array(clean.length / 2)
  for (let i = 0; i < clean.length; i += 2) {
    bytes[i / 2] = parseInt(clean.substring(i, i + 2), 16)
  }
  return bytes
}

/**
 * Parses a user-supplied private key. Accepts:
 *   - nsec1... (NIP-19 bech32)
 *   - nostr:nsec1... (NIP-19 URI)
 *   - 64-char lowercase hex
 * @param {string} input
 * @returns {{ secretKey: Uint8Array, hex: string, nsec: string }}
 */
export function parseSecretKey(input) {
  const raw = String(input || '').trim()
  if (!raw) {
    throw new Error('Please enter your nsec private key.')
  }

  let secretKey = null

  // NIP-19 nsec (optionally wrapped in a nostr: URI)
  if (/^nostr:nsec1/i.test(raw)) {
    const decoded = nip19.decode(raw.slice('nostr:'.length))
    if (decoded.type !== 'nsec') {
      throw new Error('That NIP-19 code is not an nsec private key.')
    }
    secretKey = decoded.data
  } else if (/^nsec1/i.test(raw)) {
    const decoded = nip19.decode(raw)
    if (decoded.type !== 'nsec') {
      throw new Error('That NIP-19 code is not an nsec private key.')
    }
    secretKey = decoded.data
  } else if (/^[0-9a-f]{64}$/i.test(raw)) {
    secretKey = hexToBytes(raw.toLowerCase())
  }

  if (!secretKey || secretKey.length !== 32) {
    throw new Error(
      'Invalid private key. Expected an nsec1... key (e.g. nsec1qyf...) or a 64-character hex key.'
    )
  }

  const hex = bytesToHex(secretKey)
  return { secretKey, hex, nsec: nip19.nsecEncode(secretKey) }
}

class LocalSigner {
  constructor() {
    /** @type {Uint8Array|null} */
    this.secretKey = null
    this.activePubkey = null
  }

  /**
   * Whether a local nsec is loaded and ready to sign
   * @returns {boolean}
   */
  isConnected() {
    return !!this.secretKey
  }

  /**
   * Loads a stored nsec session from localStorage (called on app boot).
   * @returns {boolean} true if a valid session was restored
   */
  restoreSession() {
    try {
      const authType = localStorage.getItem(AUTH_TYPE_STORAGE_KEY)
      if (authType !== 'nsec') return false

      const rawNsec = localStorage.getItem(NSEC_STORAGE_KEY)
      const storedPubkey = localStorage.getItem(PUBKEY_STORAGE_KEY)
      if (!rawNsec || !storedPubkey) return false

      const parsed = parseSecretKey(rawNsec)
      const derived = getPublicKey(parsed.secretKey)
      if (derived !== storedPubkey) {
        // Tampered or mismatched storage — never trust it.
        this.disconnect()
        return false
      }

      this.secretKey = parsed.secretKey
      this.activePubkey = derived
      logger.info('LocalSigner', 'Restored local nsec session.')
      return true
    } catch (err) {
      logger.warn('LocalSigner', 'Could not restore nsec session:', err?.message || err)
      this.disconnect()
      return false
    }
  }

  /**
   * Logs in with an existing nsec private key.
   * @param {string} nsecInput nsec1... / nostr:nsec1... / hex
   * @returns {{ pubkey: string, nsec: string }}
   */
  async loginWithNsec(nsecInput) {
    const parsed = parseSecretKey(nsecInput)
    const pubkey = getPublicKey(parsed.secretKey)

    this.secretKey = parsed.secretKey
    this.activePubkey = pubkey

    try {
      localStorage.setItem(NSEC_STORAGE_KEY, parsed.nsec)
      localStorage.setItem(PUBKEY_STORAGE_KEY, pubkey)
      localStorage.setItem(AUTH_TYPE_STORAGE_KEY, 'nsec')
    } catch (storageErr) {
      logger.warn('LocalSigner', 'Could not persist nsec to localStorage:', storageErr)
    }

    logger.info('LocalSigner', `Logged in with nsec. Pubkey: ${pubkey}`)
    return { pubkey, nsec: parsed.nsec }
  }

  /**
   * Creates a fresh disposable account (new random nsec).
   * @returns {{ pubkey: string, nsec: string }}
   */
  async createDisposableAccount() {
    const secretKey = generateSecretKey()
    const pubkey = getPublicKey(secretKey)
    const nsec = nip19.nsecEncode(secretKey)

    this.secretKey = secretKey
    this.activePubkey = pubkey

    try {
      localStorage.setItem(NSEC_STORAGE_KEY, nsec)
      localStorage.setItem(PUBKEY_STORAGE_KEY, pubkey)
      localStorage.setItem(AUTH_TYPE_STORAGE_KEY, 'nsec')
    } catch (storageErr) {
      logger.warn('LocalSigner', 'Could not persist disposable nsec to localStorage:', storageErr)
    }

    logger.info('LocalSigner', `Created disposable account. Pubkey: ${pubkey}`)
    return { pubkey, nsec }
  }

  /**
   * Returns the active pubkey (hex).
   * @returns {string}
   */
  getPublicKey() {
    if (!this.activePubkey) {
      throw new Error('No local nsec account is active.')
    }
    return this.activePubkey
  }

  /**
   * Returns the stored nsec (for backup/export display).
   * @returns {string}
   */
  getNsec() {
    if (!this.secretKey) return ''
    return nip19.nsecEncode(this.secretKey)
  }

  /**
   * Signs an event locally with the stored nsec.
   * @param {Object} eventTemplate Unsigned event
   * @returns {Promise<Object>} Signed event with id, pubkey, sig
   */
  async signEvent(eventTemplate) {
    if (!this.secretKey) {
      throw new Error('No local nsec account is active. Please log in with an nsec or create a disposable account.')
    }

    const fullTemplate = { ...eventTemplate }
    if (!fullTemplate.pubkey) {
      fullTemplate.pubkey = this.getPublicKey()
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

    logger.info('LocalSigner', `Signing kind ${fullTemplate.kind} event locally...`, fullTemplate)

    try {
      const signed = finalizeEvent(fullTemplate, this.secretKey)
      logger.info('LocalSigner', `✓ Event signed locally! ID: ${signed.id}`)
      return signed
    } catch (err) {
      logger.error('LocalSigner', 'Local signing failed:', {
        message: err?.message || String(err),
        template: fullTemplate,
      })
      throw err
    }
  }

  /**
   * Clears the local nsec session and wipes stored credentials.
   */
  disconnect() {
    this.secretKey = null
    this.activePubkey = null
    try {
      localStorage.removeItem(NSEC_STORAGE_KEY)
      localStorage.removeItem(PUBKEY_STORAGE_KEY)
      localStorage.removeItem(AUTH_TYPE_STORAGE_KEY)
    } catch (err) {
      logger.warn('LocalSigner', 'Could not clear nsec from localStorage:', err)
    }
    logger.info('LocalSigner', 'Local nsec session disconnected.')
  }
}

export const localSigner = new LocalSigner()