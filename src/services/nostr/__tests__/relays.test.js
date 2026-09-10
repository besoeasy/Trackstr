import { describe, it, expect, beforeEach } from 'vitest'
import { sanitizeRelayList, getRelays, saveRelays, DEFAULT_RELAYS } from '@/services/nostr/relays.js'

beforeEach(() => {
  localStorage.clear()
})

describe('sanitizeRelayList()', () => {
  it('drops invalid and duplicate relays and caps the count', () => {
    const list = sanitizeRelayList([
      'https://not-a-relay.example.com',
      '  wss://nos.lol/ ',
      'WSS://NOS.LOL',
      'garbage',
      '',
      null,
      'ws://evil.example.com',
    ])
    expect(list).toEqual(['wss://nos.lol'])
  })

  it('caps the list at twelve relays', () => {
    const many = Array.from({ length: 20 }, (_, i) => `wss://relay${i}.example.com`)
    expect(sanitizeRelayList(many)).toHaveLength(12)
  })
})

describe('getRelays()', () => {
  it('returns defaults when nothing is stored', () => {
    expect(getRelays()).toEqual(DEFAULT_RELAYS)
  })

  it('purges corrupt storage instead of warning forever', () => {
    localStorage.setItem('trackstr_relays', '{not json')
    expect(getRelays()).toEqual(DEFAULT_RELAYS)
    expect(localStorage.getItem('trackstr_relays')).toBeNull()
  })

  it('returns sanitized stored relays', () => {
    saveRelays(['wss://nos.lol', 'wss://relay.primal.net'])
    const relays = getRelays()
    expect(relays).toEqual(['wss://nos.lol', 'wss://relay.primal.net'])
  })
})
