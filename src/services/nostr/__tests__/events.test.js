import { describe, it, expect } from 'vitest'
import {
  KINDS,
  APP_ID,
  buildBaseMediaTags,
  buildRatingEvent,
  buildStatusEvent,
  buildReviewEvent,
  buildActivityLogEvent,
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
    expect(() => buildRatingEvent({ type: 'movie', name: 'X' }, 8)).toThrow()
    expect(() => buildRatingEvent({ contentId: 'nope', type: 'movie', name: 'X' }, 8)).toThrow()
    expect(() => buildRatingEvent({ contentId: CID, type: 'podcast', name: 'X' }, 8)).toThrow()
    expect(() => buildRatingEvent({ contentId: CID, type: 'movie' }, 8)).toThrow()
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

describe('buildStatusEvent() / buildActivityLogEvent()', () => {
  it('enforces the video status enum on movies/shows', () => {
    expect(buildStatusEvent(MOVIE, 'watching').tags).toContainEqual(['status', 'watching'])
    expect(() => buildStatusEvent(MOVIE, 'listening')).toThrow()
    expect(() => buildStatusEvent(MOVIE, 'WATCHING')).toThrow()
  })

  it('enforces the music status enum', () => {
    expect(buildStatusEvent(TRACK, 'listening').tags).toContainEqual(['status', 'listening'])
    expect(() => buildStatusEvent(TRACK, 'watching')).toThrow()
  })

  it('restricts immutable logs to watching/completed/listening', () => {
    expect(buildActivityLogEvent(MOVIE, 'completed').kind).toBe(KINDS.ACTIVITY_LOG)
    expect(() => buildActivityLogEvent(MOVIE, 'plan-to-watch')).toThrow()
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

describe('buildReviewEvent()', () => {
  it('allows optional body and validates an optional rating', () => {
    const evt = buildReviewEvent(MOVIE, 'Still holds up.', { rating: 9, spoiler: true })
    expect(evt.kind).toBe(KINDS.REVIEW)
    expect(evt.content).toBe('Still holds up.')
    expect(evt.tags).toContainEqual(['rating', '9'])
    expect(evt.tags).toContainEqual(['spoiler', '1'])

    // Review body is not compulsory: empty or whitespace body produces empty content
    const emptyEvt = buildReviewEvent(MOVIE, '   ')
    expect(emptyEvt.content).toBe('')

    const omittedEvt = buildReviewEvent(MOVIE)
    expect(omittedEvt.content).toBe('')

    expect(() => buildReviewEvent(MOVIE, 'ok', { rating: 42 })).toThrow()
  })
})

describe('buildDeletionEvent()', () => {
  const eid = 'ef'.repeat(32)

  it('builds e-refs and a-refs (a-refs carry the NIP-09 k tag)', () => {
    expect(buildDeletionEvent({ eventId: eid }).tags).toEqual([['e', eid]])
    const coord = `35402:${'ab'.repeat(32)}:${CID}:s1e3`
    expect(buildDeletionEvent({ coordinate: coord }).tags).toEqual([
      ['a', coord],
      ['k', '35402'],
    ])
  })

  it('rejects ambiguous or malformed targets', () => {
    expect(() => buildDeletionEvent({ eventId: eid, coordinate: '35402:a:b' })).toThrow()
    expect(() => buildDeletionEvent({})).toThrow()
    expect(() => buildDeletionEvent({ eventId: 'nope' })).toThrow()
    expect(() => buildDeletionEvent({ coordinate: '35402:nothex:d' })).toThrow()
  })
})
