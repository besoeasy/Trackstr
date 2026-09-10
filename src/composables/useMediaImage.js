import { computed } from 'vue'
import { isSafeMediaUrl } from '@/utils/urls.js'

/**
 * Resolves an image URI safely.
 * Direct HTTP/HTTPS URLs (from Wikipedia, TVMaze, TMDB, MusicBrainz) pass through directly if safe.
 *
 * @param {string} raw
 * @returns {string}
 */
export function resolveMediaUrl(raw) {
  const trimmed = (raw || '').trim()
  if (!trimmed) return ''
  return isSafeMediaUrl(trimmed) ? trimmed : ''
}

/**
 * Resolves an image URL safely for Vue components.
 *
 * @param {() => string} getRawUri getter returning the raw image URI (reactive)
 * @returns {{ src: import('vue').ComputedRef<string>, onError: () => void }}
 */
export function useMediaImage(getRawUri) {
  const src = computed(() => resolveMediaUrl(getRawUri()))

  function onError() {
    // Graceful fallback for broken or unreachable remote image URLs
  }

  return { src, onError }
}
