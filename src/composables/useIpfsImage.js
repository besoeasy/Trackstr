import { computed } from 'vue'
import { isSafeMediaUrl } from '@/utils/urls.js'

/**
 * Resolves an image URI safely.
 * If the URI is an ipfs:// URI, it is resolved via a public IPFS gateway.
 * Direct HTTP/HTTPS URLs (from Wikipedia, TVMaze, TMDB, MusicBrainz) pass through directly if safe.
 *
 * @param {string} raw
 * @returns {string}
 */
export function resolveIpfsUrl(raw) {
  const trimmed = (raw || '').trim()
  if (!trimmed) return ''

  if (trimmed.startsWith('ipfs://')) {
    const cid = trimmed.replace(/^ipfs:\/\//, '').replace(/^\/+/, '')
    return `https://ipfs.io/ipfs/${cid}`
  }

  return isSafeMediaUrl(trimmed) ? trimmed : ''
}

/**
 * Resolves an image URL safely for Vue components.
 *
 * @param {() => string} getRawUri getter returning the raw image URI (reactive)
 * @returns {{ src: import('vue').ComputedRef<string>, onError: () => void }}
 */
export function useIpfsImage(getRawUri) {
  const src = computed(() => resolveIpfsUrl(getRawUri()))

  function onError() {
    // Graceful fallback for broken or unreachable remote image URLs
  }

  return { src, onError }
}