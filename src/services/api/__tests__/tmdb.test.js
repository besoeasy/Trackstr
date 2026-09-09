// @vitest-environment happy-dom
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { getTmdbApiKey } from '@/services/api/tmdb.js'

beforeEach(() => {
  localStorage.clear()
  vi.unstubAllEnvs()
})

describe('getTmdbApiKey()', () => {
  it('returns an empty string when nothing is configured (TMDB is optional)', () => {
    vi.stubEnv('VITE_TMDB_API_KEY', '')
    expect(getTmdbApiKey()).toBe('')
  })

  it('prefers the user-stored key', () => {
    vi.stubEnv('VITE_TMDB_API_KEY', 'env-key')
    localStorage.setItem('trackstr_tmdb_api_key', 'user-key')
    expect(getTmdbApiKey()).toBe('user-key')
  })

  it('falls back to the environment key', () => {
    vi.stubEnv('VITE_TMDB_API_KEY', 'env-key')
    expect(getTmdbApiKey()).toBe('env-key')
  })
})
