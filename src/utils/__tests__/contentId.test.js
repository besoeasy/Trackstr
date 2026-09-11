import { describe, it, expect } from 'vitest'
import {
  norm,
  buildCanonicalString,
  sha256Hex,
  computeContentId,
  buildDTag,
  assertContentId,
  cleanShowTitle,
} from '@/utils/contentId.js'

describe('cleanShowTitle()', () => {
  it('strips episode prefixes and suffixes', () => {
    expect(cleanShowTitle('Stranger Things - S1E6: Chapter Six: The Monster')).toBe('Stranger Things')
    expect(cleanShowTitle('Breaking Bad - Season 1')).toBe('Breaking Bad')
    expect(cleanShowTitle('The Office (US) - S02E01')).toBe('The Office (US)')
    expect(cleanShowTitle('Lost (S01E01)')).toBe('Lost')
    expect(cleanShowTitle('Dark')).toBe('Dark')
  })
})

describe('norm() — byte-exact normalization', () => {
  it('lowercases, trims and collapses whitespace', () => {
    expect(norm('  Fight   Club\n')).toBe('fight club')
  })

  it('applies Unicode NFKC normalization', () => {
    expect(norm('ﬁlm')).toBe('film') // ﬁ ligature decomposes under NFKC
  })

  it('escapes literal pipe delimiters', () => {
    expect(norm('a|b')).toBe('a\\|b')
  })

  it('returns empty string for nullish input', () => {
    expect(norm(null)).toBe('')
    expect(norm(undefined)).toBe('')
  })
})

describe('buildCanonicalString()', () => {
  it('builds movie canonical strings', () => {
    expect(buildCanonicalString({ type: 'movie', title: 'Fight Club', year: '1999' })).toBe(
      'movie|fight club|1999'
    )
  })

  it('builds music canonical strings with artist', () => {
    expect(
      buildCanonicalString({ type: 'music', title: 'Nevermind', artist: 'Nirvana', year: '1991' })
    ).toBe('music|nirvana|nevermind|1991')
  })

  it('anchors episodes to the parent show identity even with full episode titles', () => {
    const episode = buildCanonicalString({
      type: 'episode',
      title: 'Stranger Things - S1E6: Chapter Six: The Monster',
      year: '2016',
    })
    const show = buildCanonicalString({ type: 'show', title: 'Stranger Things', year: '2016' })
    expect(episode).toBe(show)
    expect(episode).toBe('show|stranger things|2016')
  })

  it('appends a normalized qualifier when present', () => {
    expect(
      buildCanonicalString({ type: 'movie', title: 'Dune', year: '1984', qualifier: 'Lynch' })
    ).toBe('movie|dune|1984|lynch')
  })

  it('throws when title, year, or music artist is missing', () => {
    expect(() => buildCanonicalString({ type: 'movie', title: '', year: '1999' })).toThrow()
    expect(() => buildCanonicalString({ type: 'movie', title: 'Fight Club', year: '' })).toThrow()
    expect(() => buildCanonicalString({ type: 'music', title: 'X', year: '2000', artist: '' })).toThrow()
    expect(() => buildCanonicalString({ type: 'music', title: 'X', year: '', artist: 'Artist' })).toThrow()
  })
})

describe('sha256Hex() / computeContentId()', () => {
  it('matches the known SHA-256 test vector', async () => {
    expect(await sha256Hex('abc')).toBe(
      'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad'
    )
  })

  it('produces deterministic 64-hex ids', async () => {
    const a = await computeContentId({ type: 'movie', title: 'Fight Club', year: '1999' })
    const b = await computeContentId({ type: 'movie', title: '  FIGHT  club ', year: '1999' })
    expect(a.contentId).toBe(b.contentId)
    expect(a.contentId).toMatch(/^[0-9a-f]{64}$/)
    expect(a.canonicalString).toBe('movie|fight club|1999')
  })
})

describe('buildDTag()', () => {
  const cid = 'a'.repeat(64)

  it('returns the bare contentid for movies/shows/music', () => {
    expect(buildDTag({ contentId: cid })).toBe(cid)
  })

  it('suffixes episode positions and normalizes padding', () => {
    expect(buildDTag({ contentId: cid, season: '01', episode: '03' })).toBe(`${cid}:s1e3`)
    expect(buildDTag({ contentId: cid, season: 1, episode: 3 })).toBe(`${cid}:s1e3`)
  })

  it('treats empty-string season/episode as absent', () => {
    expect(buildDTag({ contentId: cid, season: '', episode: '' })).toBe(cid)
  })

  it('allows season 0 (specials)', () => {
    expect(buildDTag({ contentId: cid, season: 0, episode: 2 })).toBe(`${cid}:s0e2`)
  })

  it('ignores incomplete or non-numeric positions', () => {
    expect(buildDTag({ contentId: cid, season: 1 })).toBe(cid)
    expect(buildDTag({ contentId: cid, season: 'x', episode: 2 })).toBe(cid)
  })
})

describe('assertContentId()', () => {
  it('lowercases valid ids and rejects the rest', () => {
    expect(assertContentId('A'.repeat(64))).toBe('a'.repeat(64))
    expect(() => assertContentId('xyz')).toThrow()
    expect(() => assertContentId(undefined)).toThrow()
  })
})
