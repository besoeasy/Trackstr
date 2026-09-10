import { describe, it, expect } from 'vitest'
import {
  isValidContentId,
  isValidPubkey,
  isSafeHttpUrl,
  isSafeMediaUrl,
  safeMediaUrl,
  normalizeRelayUrl,
} from '@/utils/urls.js'

describe('identity validators', () => {
  it('accepts 64-hex and rejects the rest', () => {
    expect(isValidContentId('a'.repeat(64))).toBe(true)
    expect(isValidPubkey('F'.repeat(64))).toBe(true)
    expect(isValidContentId('a'.repeat(63))).toBe(false)
    expect(isValidContentId('undefined')).toBe(false)
    expect(isValidPubkey(null)).toBe(false)
  })
})

describe('isSafeHttpUrl()', () => {
  it('allows http(s) page URLs', () => {
    expect(isSafeHttpUrl('https://trackstr.besoeasy.com/')).toBe(true)
    expect(isSafeHttpUrl('http://localhost:5173/x')).toBe(true)
  })

  it('blocks dangerous and non-web schemes', () => {
    expect(isSafeHttpUrl('javascript:alert(1)')).toBe(false)
    expect(isSafeHttpUrl('data:text/html,<h1>x</h1>')).toBe(false)
    expect(isSafeHttpUrl('vbscript:msgbox(1)')).toBe(false)
    expect(isSafeHttpUrl('ftp://example.com/f')).toBe(false)
    expect(isSafeHttpUrl('not a url')).toBe(false)
    expect(isSafeHttpUrl('')).toBe(false)
  })
})

describe('media URL helpers', () => {
  it('allows https and site-relative art', () => {
    expect(isSafeMediaUrl('https://image.tmdb.org/t/p/w500/x.jpg')).toBe(true)
    expect(isSafeMediaUrl('/favicon.ico')).toBe(true)
  })

  it('blocks executable/data/ipfs URLs', () => {
    expect(isSafeMediaUrl('javascript:alert(1)')).toBe(false)
    expect(isSafeMediaUrl('data:image/svg+xml,<svg onload=alert(1)>')).toBe(false)
    expect(isSafeMediaUrl('blob:https://x/y')).toBe(false)
    expect(isSafeMediaUrl('ipfs://bafybei123')).toBe(false)
    expect(isSafeMediaUrl('')).toBe(false)
  })

  it('safeMediaUrl() returns a blank for unsafe input', () => {
    expect(safeMediaUrl('  https://x.com/a.png  ')).toBe('https://x.com/a.png')
    expect(safeMediaUrl('javascript:alert(1)')).toBe('')
  })
})

describe('normalizeRelayUrl()', () => {
  it('trims and strips trailing slashes', () => {
    expect(normalizeRelayUrl('  wss://relay.primal.net/ ')).toBe('wss://relay.primal.net')
  })

  it('requires a websocket scheme', () => {
    expect(normalizeRelayUrl('https://relay.primal.net')).toBeNull()
    expect(normalizeRelayUrl('relay.primal.net')).toBeNull()
    expect(normalizeRelayUrl('')).toBeNull()
    expect(normalizeRelayUrl(null)).toBeNull()
  })

  it('allows ws:// only for local hosts', () => {
    expect(normalizeRelayUrl('ws://localhost:7777')).toBe('ws://localhost:7777')
    expect(normalizeRelayUrl('ws://evil.example.com')).toBeNull()
  })
})
