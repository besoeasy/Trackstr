import { describe, it, expect } from 'vitest'
import {
  KINDS,
  APP_ID,
  buildBaseMediaTags,
  buildRatingEvent,
  buildStatusEvent,
  buildSimilarSuggestionEvent,
  buildDeletionEvent,
} from '@/services/nostr/events.js'

const CID = 'ab'.repeat(32)
const MOVIE = { contentId: CID, type: 'movie', name: 'Fight Club', year: '1999' }
const TRACK = { contentId: 'cd'.repeat(32), type: 'music', name: 'Nevermind', year: '1991', artist: 'Nirvana' }

function appTags(tags) {
  return tags.filter((t) => t[0] === 'trackstr')
}

describe('event envelope rules', () => {
  it('carries exactly one app tag and no t/expiration tags', () => {
    const evt = buildRatingEvent(MOVIE, 8)
    expect(evt.kind).toBe(KINDS.RATING)
    expect(appTags(evt.tags)).toEqual([['trackstr', APP_ID]])
    expect(evt.tags.some((t) => t[0] === 't')).toBe(false)
    expect(evt.tags.some((t) => t[0] === 'expiration')).toBe(false)
  })

  it('rejects missing/invalid media references', () => {
    expect(() => buildStatusEvent(null, 'watching')).toThrow()
    expect(() => buildStatusEvent({ contentId: 'not-hex' }, 'watching')).toThrow()
    expect(() => buildStatusEvent({ contentId: CID, type: 'book', name: 'Dune' }, 'watching')).toThrow()
    expect(() => buildStatusEvent({ contentId: CID, type: 'movie' }, 'watching')).toThrow()
  })
})

describe('buildRatingEvent()', () => {
  it('accepts the 1–10 scale including half-steps', () => {
    expect(buildRatingEvent(MOVIE, 1).tags).toContainEqual(['rating', '1'])
    expect(buildRatingEvent(MOVIE, '8.5').tags).toContainEqual(['rating', '8.5'])
    expect(buildRatingEvent(MOVIE, 10).tags).toContainEqual(['rating', '10'])
  })

  it('rejects off-scale ratings', () => {
    expect(() => buildRatingEvent(MOVIE, 0)).toThrow()
    expect(() => buildRatingEvent(MOVIE, 11)).toThrow()
    expect(() => buildRatingEvent(MOVIE, 'great')).toThrow()
  })
})

describe('buildStatusEvent()', () => {
  it('enforces the video status enum on movies/shows', () => {
    expect(buildStatusEvent(MOVIE, 'watching').tags).toContainEqual(['status', 'watching'])
    expect(() => buildStatusEvent(MOVIE, 'listening')).toThrow()
    expect(() => buildStatusEvent(MOVIE, 'WATCHING')).toThrow()
  })

  it('enforces the music status enum', () => {
    expect(buildStatusEvent(TRACK, 'listening').tags).toContainEqual(['status', 'listening'])
    expect(() => buildStatusEvent(TRACK, 'watching')).toThrow()
  })

})

describe('buildSimilarSuggestionEvent()', () => {
  const MATRIX_CID = 'ba'.repeat(32)
  const MATRIX = { contentId: MATRIX_CID, type: 'movie', name: 'The Matrix', year: '1999' }

  it('builds a Kind 35401 event with target d-tag and similar tags', () => {
    const evt = buildSimilarSuggestionEvent(MOVIE, MATRIX, { note: 'Great mind bender' })
    expect(evt.kind).toBe(KINDS.SIMILAR_SUGGESTION)
    expect(evt.tags).toContainEqual(['d', CID])
    expect(evt.tags).toContainEqual(['contentid', CID])
    expect(evt.tags).toContainEqual(['similar', MATRIX_CID, 'movie', 'The Matrix', '1999'])
    expect(evt.tags).toContainEqual(['s', MATRIX_CID])
    expect(evt.content).toBe('Great mind bender')
  })

  it('accepts multiple similar items and validates references', () => {
    const SHOW_CID = 'cc'.repeat(32)
    const SHOW = { contentId: SHOW_CID, type: 'show', name: 'Mr. Robot', year: '2015' }
    const evt = buildSimilarSuggestionEvent(MOVIE, [MATRIX, SHOW])
    expect(evt.tags).toContainEqual(['similar', MATRIX_CID, 'movie', 'The Matrix', '1999'])
    expect(evt.tags).toContainEqual(['similar', SHOW_CID, 'show', 'Mr. Robot', '2015'])
    expect(() => buildSimilarSuggestionEvent(MOVIE, [])).toThrow()
  })
})

describe('episode addressing', () => {
  const ep = { ...MOVIE, type: 'episode', season: 1, episode: 3 }

  it('suffixes the NIP-33 d-tag and tags the position', () => {
    const evt = buildStatusEvent(ep, 'watching')
    expect(evt.tags).toContainEqual(['d', `${CID}:s1e3`])
    expect(evt.tags).toContainEqual(['season', '1'])
    expect(evt.tags).toContainEqual(['episode', '3'])
  })

  it('never emits season/episode tags on non-episode records', () => {
    const withNumbers = { ...MOVIE, season: 1, episode: 2 }
    const tags = buildBaseMediaTags(withNumbers)
    expect(tags.some((t) => t[0] === 'season')).toBe(false)
    expect(tags.some((t) => t[0] === 'episode')).toBe(false)
  })

  it('requires both numbers on episode records', () => {
    expect(() => buildBaseMediaTags({ ...MOVIE, type: 'episode', season: 1 })).toThrow()
  })

  it('keeps episode rating off the show-level d-tag', () => {
    const evt = buildRatingEvent(ep, 8)
    expect(evt.tags).toContainEqual(['d', `${CID}:s1e3`])
  })
})

describe('music + qualifier tags', () => {
  it('emits artist so readers can recompute the music contentid', () => {
    expect(buildBaseMediaTags(TRACK)).toContainEqual(['artist', 'Nirvana'])
    expect(buildBaseMediaTags(MOVIE).some((t) => t[0] === 'artist')).toBe(false)
  })

  it('emits qualifier so hash splits are reproducible', () => {
    const tags = buildBaseMediaTags({ ...MOVIE, qualifier: 'Lynch' })
    expect(tags).toContainEqual(['qualifier', 'Lynch'])
  })
})

describe('buildRatingEvent() with written review commentary', () => {
  it('unifies review into Kind 35400 and validates rating / spoiler', () => {
    const evt = buildRatingEvent(MOVIE, 9, 'Still holds up.', { spoiler: true })
    expect(evt.kind).toBe(KINDS.RATING)
    expect(evt.content).toBe('Still holds up.')
    expect(evt.tags).toContainEqual(['rating', '9'])
    expect(evt.tags).toContainEqual(['spoiler', '1'])
    expect(evt.tags).toContainEqual(['d', CID])

    // Rating without review text
    const ratingOnlyEvt = buildRatingEvent(MOVIE, 8)
    expect(ratingOnlyEvt.kind).toBe(KINDS.RATING)
    expect(ratingOnlyEvt.content).toBe('')
    expect(ratingOnlyEvt.tags).toContainEqual(['rating', '8'])

    // Review text without rating
    const textOnlyEvt = buildRatingEvent(MOVIE, null, 'Great commentary.')
    expect(textOnlyEvt.kind).toBe(KINDS.RATING)
    expect(textOnlyEvt.content).toBe('Great commentary.')

    // Empty review / rating is allowed
    const emptyEvt = buildRatingEvent(MOVIE, null, '')
    expect(emptyEvt.kind).toBe(KINDS.RATING)
    expect(emptyEvt.content).toBe('')

    expect(() => buildRatingEvent(MOVIE, 42, 'ok')).toThrow()
  })
})

describe('buildDeletionEvent()', () => {
  it('builds coordinate a-refs carrying the NIP-09 k tag', () => {
    const coord = `35402:${'ab'.repeat(32)}:${CID}:s1e3`
    expect(buildDeletionEvent({ coordinate: coord }).tags).toEqual([
      ['a', coord],
      ['k', '35402'],
    ])
  })

  it('rejects malformed or missing coordinate targets', () => {
    expect(() => buildDeletionEvent({})).toThrow()
    expect(() => buildDeletionEvent({ coordinate: '35402:a:b' })).toThrow()
    expect(() => buildDeletionEvent({ coordinate: '35402:nothex:d' })).toThrow()
  })
})
