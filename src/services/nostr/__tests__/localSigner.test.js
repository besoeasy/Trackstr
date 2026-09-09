import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { generateSecretKey, getPublicKey, nip19 } from 'nostr-tools'
import {
  localSigner,
  parseSecretKey,
  bytesToHex,
  hexToBytes,
} from '@/services/nostr/localSigner.js'

const NSEC_KEY = 'trackstr_nsec'
const PUBKEY_KEY = 'trackstr_pubkey'
const AUTH_TYPE_KEY = 'trackstr_auth_type'

function freshKey() {
  const sk = generateSecretKey()
  return {
    sk,
    hex: bytesToHex(sk),
    nsec: nip19.nsecEncode(sk),
    pubkey: getPublicKey(sk),
  }
}

beforeEach(() => {
  localStorage.clear()
  localSigner.disconnect()
})

afterEach(() => {
  localStorage.clear()
  localSigner.disconnect()
})

describe('parseSecretKey()', () => {
  it('accepts nsec1... bech32 keys', () => {
    const { sk, nsec, pubkey } = freshKey()
    const parsed = parseSecretKey(nsec)
    expect(parsed.hex).toBe(bytesToHex(sk))
    expect(parsed.nsec).toBe(nsec)
    expect(getPublicKey(parsed.secretKey)).toBe(pubkey)
  })

  it('accepts nostr:nsec1... URIs', () => {
    const { sk, nsec } = freshKey()
    const parsed = parseSecretKey(`nostr:${nsec}`)
    expect(parsed.hex).toBe(bytesToHex(sk))
  })

  it('accepts 64-char hex keys', () => {
    const { sk, hex } = freshKey()
    const parsed = parseSecretKey(hex)
    expect(parsed.hex).toBe(hex)
    expect(parsed.nsec).toBe(nip19.nsecEncode(sk))
  })

  it('rejects empty, malformed, and non-nsec inputs', () => {
    expect(() => parseSecretKey('')).toThrow()
    expect(() => parseSecretKey('   ')).toThrow()
    expect(() => parseSecretKey('nsec1invalid')).toThrow()
    expect(() => parseSecretKey('not-a-key')).toThrow()
    expect(() => parseSecretKey('ab'.repeat(31))).toThrow() // 62 hex chars
    expect(() => parseSecretKey('zz'.repeat(32))).toThrow() // non-hex
  })

  it('rejects npub codes (not a private key)', () => {
    const { pubkey } = freshKey()
    const npub = nip19.npubEncode(pubkey)
    expect(() => parseSecretKey(npub)).toThrow()
  })
})

describe('loginWithNsec()', () => {
  it('derives the correct pubkey and persists the session', async () => {
    const { nsec, pubkey } = freshKey()
    const result = await localSigner.loginWithNsec(nsec)

    expect(result.pubkey).toBe(pubkey)
    expect(result.nsec).toBe(nsec)
    expect(localSigner.isConnected()).toBe(true)
    expect(localSigner.getPublicKey()).toBe(pubkey)
    expect(localStorage.getItem(PUBKEY_KEY)).toBe(pubkey)
    expect(localStorage.getItem(AUTH_TYPE_KEY)).toBe('nsec')
    expect(localStorage.getItem(NSEC_KEY)).toBe(nsec)
  })

  it('accepts hex input and stores the nsec form', async () => {
    const { hex, nsec, pubkey } = freshKey()
    const result = await localSigner.loginWithNsec(hex)
    expect(result.pubkey).toBe(pubkey)
    expect(localStorage.getItem(NSEC_KEY)).toBe(nsec)
  })

  it('rejects invalid keys without mutating state', async () => {
    await expect(localSigner.loginWithNsec('nsec1garbage')).rejects.toThrow()
    expect(localSigner.isConnected()).toBe(false)
    expect(localStorage.getItem(PUBKEY_KEY)).toBeNull()
  })
})

describe('createDisposableAccount()', () => {
  it('generates a fresh random identity and persists it', async () => {
    const result = await localSigner.createDisposableAccount()

    expect(result.pubkey).toMatch(/^[0-9a-f]{64}$/)
    expect(result.nsec).toMatch(/^nsec1/)
    expect(localSigner.isConnected()).toBe(true)
    expect(localSigner.getPublicKey()).toBe(result.pubkey)
    expect(localStorage.getItem(AUTH_TYPE_KEY)).toBe('nsec')

    // Derived pubkey must match the generated nsec
    const parsed = parseSecretKey(result.nsec)
    expect(getPublicKey(parsed.secretKey)).toBe(result.pubkey)
  })

  it('generates a different key each time', async () => {
    const a = await localSigner.createDisposableAccount()
    localSigner.disconnect()
    const b = await localSigner.createDisposableAccount()
    expect(a.pubkey).not.toBe(b.pubkey)
    expect(a.nsec).not.toBe(b.nsec)
  })
})

describe('signEvent()', () => {
  it('signs an event locally with the active nsec', async () => {
    const { nsec, pubkey } = freshKey()
    await localSigner.loginWithNsec(nsec)

    const template = {
      kind: 35400,
      created_at: 1788900000,
      tags: [
        ['d', 'ab'.repeat(32)],
        ['contentid', 'ab'.repeat(32)],
        ['trackstr', 'web'],
        ['type', 'movie'],
        ['name', 'Fight Club'],
        ['year', '1999'],
        ['rating', '8'],
      ],
      content: 'Rewatched director\'s cut.',
    }

    const signed = await localSigner.signEvent(template)

    expect(signed.id).toMatch(/^[0-9a-f]{64}$/)
    expect(signed.sig).toMatch(/^[0-9a-f]{128}$/)
    expect(signed.pubkey).toBe(pubkey)
    expect(signed.kind).toBe(35400)
    expect(signed.tags).toEqual(template.tags)
    expect(signed.content).toBe(template.content)
  })

  it('fills missing pubkey/created_at/tags/content', async () => {
    const { nsec, pubkey } = freshKey()
    await localSigner.loginWithNsec(nsec)

    const signed = await localSigner.signEvent({ kind: 5402, tags: [], content: '' })
    expect(signed.pubkey).toBe(pubkey)
    expect(signed.created_at).toBeGreaterThan(0)
    expect(Array.isArray(signed.tags)).toBe(true)
  })

  it('throws when no nsec account is active', async () => {
    await expect(localSigner.signEvent({ kind: 35400, tags: [], content: '' })).rejects.toThrow()
  })
})

describe('restoreSession()', () => {
  it('restores a valid stored nsec session', () => {
    const { nsec, pubkey } = freshKey()
    localStorage.setItem(NSEC_KEY, nsec)
    localStorage.setItem(PUBKEY_KEY, pubkey)
    localStorage.setItem(AUTH_TYPE_KEY, 'nsec')

    expect(localSigner.restoreSession()).toBe(true)
    expect(localSigner.isConnected()).toBe(true)
    expect(localSigner.getPublicKey()).toBe(pubkey)
  })

  it('rejects a mismatched pubkey/nsec pair and wipes storage', () => {
    const { nsec } = freshKey()
    const other = freshKey()
    localStorage.setItem(NSEC_KEY, nsec)
    localStorage.setItem(PUBKEY_KEY, other.pubkey)
    localStorage.setItem(AUTH_TYPE_KEY, 'nsec')

    expect(localSigner.restoreSession()).toBe(false)
    expect(localSigner.isConnected()).toBe(false)
    expect(localStorage.getItem(NSEC_KEY)).toBeNull()
    expect(localStorage.getItem(PUBKEY_KEY)).toBeNull()
  })

  it('ignores non-nsec auth types', () => {
    const { nsec, pubkey } = freshKey()
    localStorage.setItem(NSEC_KEY, nsec)
    localStorage.setItem(PUBKEY_KEY, pubkey)
    localStorage.setItem(AUTH_TYPE_KEY, 'extension')

    expect(localSigner.restoreSession()).toBe(false)
    expect(localSigner.isConnected()).toBe(false)
  })
})

describe('disconnect()', () => {
  it('clears the session and stored credentials', async () => {
    const { nsec } = freshKey()
    await localSigner.loginWithNsec(nsec)
    expect(localSigner.isConnected()).toBe(true)

    localSigner.disconnect()

    expect(localSigner.isConnected()).toBe(false)
    expect(localStorage.getItem(NSEC_KEY)).toBeNull()
    expect(localStorage.getItem(PUBKEY_KEY)).toBeNull()
    expect(localStorage.getItem(AUTH_TYPE_KEY)).toBeNull()
  })
})

describe('getNsec()', () => {
  it('returns the active nsec for backup display', async () => {
    const { nsec } = freshKey()
    await localSigner.loginWithNsec(nsec)
    expect(localSigner.getNsec()).toBe(nsec)
  })

  it('returns empty string when no session is active', () => {
    expect(localSigner.getNsec()).toBe('')
  })
})

describe('hex helpers', () => {
  it('round-trips bytes <-> hex', () => {
    const sk = generateSecretKey()
    const hex = bytesToHex(sk)
    expect(hex).toMatch(/^[0-9a-f]{64}$/)
    expect(hexToBytes(hex)).toEqual(sk)
  })

  it('returns empty bytes for malformed hex', () => {
    expect(hexToBytes('zz')).toEqual(new Uint8Array(0))
    expect(hexToBytes('abc')).toEqual(new Uint8Array(0))
    expect(hexToBytes('')).toEqual(new Uint8Array(0))
  })
})