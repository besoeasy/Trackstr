import { describe, it, expect } from 'vitest'
import {
  REVIEW_SUGGESTIONS_POOL,
  MUSIC_SUGGESTIONS_POOL,
  getReviewSuggestionsPool,
  getRandomReviewSuggestions,
  MODAL_VERB_SUGGESTIONS
} from '../reviewSuggestions'

describe('Review Suggestions', () => {
  it('contains over 100 combinations of nouns and verbs in the pool', () => {
    expect(REVIEW_SUGGESTIONS_POOL.length).toBeGreaterThanOrEqual(100)
    // Check uniqueness
    const set = new Set(REVIEW_SUGGESTIONS_POOL)
    expect(set.size).toBe(REVIEW_SUGGESTIONS_POOL.length)
  })

  it('includes key modal and verb examples like "Must watch", "Must see", "Must follow"', () => {
    expect(REVIEW_SUGGESTIONS_POOL).toContain('Must watch')
    expect(REVIEW_SUGGESTIONS_POOL).toContain('Must see')
    expect(REVIEW_SUGGESTIONS_POOL).toContain('Must follow')
    expect(MODAL_VERB_SUGGESTIONS).toContain('Must watch')
    expect(MODAL_VERB_SUGGESTIONS).toContain('Must see')
    expect(MODAL_VERB_SUGGESTIONS).toContain('Must follow')
  })

  it('returns 5 distinct suggestions by default', () => {
    const suggestions = getRandomReviewSuggestions()
    expect(suggestions).toHaveLength(5)
    const unique = new Set(suggestions)
    expect(unique.size).toBe(5)
    for (const item of suggestions) {
      expect(REVIEW_SUGGESTIONS_POOL).toContain(item)
    }
  })

  it('supports custom counts', () => {
    const three = getRandomReviewSuggestions(3)
    expect(three).toHaveLength(3)

    const eight = getRandomReviewSuggestions(8)
    expect(eight).toHaveLength(8)
    expect(new Set(eight).size).toBe(8)
  })

  it('excludes previously selected suggestions when possible', () => {
    const initial = getRandomReviewSuggestions(5)
    const next = getRandomReviewSuggestions(5, 'movie', initial)
    expect(next).toHaveLength(5)
    // None of next should be in initial (since pool > 100)
    for (const item of next) {
      expect(initial).not.toContain(item)
    }
  })

  it('tailors suggestions for music media type', () => {
    const musicPool = getReviewSuggestionsPool('music')
    expect(musicPool.length).toBeGreaterThanOrEqual(100)
    expect(musicPool).toContain('Must listen')
    expect(musicPool).toContain('Soundtrack hits')
  })
})
