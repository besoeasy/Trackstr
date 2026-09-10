import { ref, computed, watch, onScopeDispose } from 'vue'
import { resolveIpfsUrl, IPFS_GATEWAYS } from '@/services/originless.js'

/**
 * Resolves an ipfs:// URI (or raw CID / http URL) to a gateway URL with
 * automatic multi-gateway fallback.
 *
 * The Originless instance is tried first (content uploaded via Trackstr is
 * pinned there and served directly), then public gateways. When the <img>
 * fires its `error` event, `onError()` advances to the next gateway. Once
 * every gateway has failed, `@helia/verified-fetch` is lazy-loaded to fetch
 * the content trustlessly (hash-verified) directly from the IPFS network and
 * present it via a blob object URL.
 *
 * @param {() => string} getRawUri getter returning the raw ipfs:// URI (reactive)
 * @returns {{ src: import('vue').ComputedRef<string>, onError: () => void }}
 */
export function useIpfsImage(getRawUri) {
  const gatewayIndex = ref(0)
  const objectUrl = ref('')

  const src = computed(() => {
    const raw = getRawUri()
    if (!raw) return ''
    if (objectUrl.value) return objectUrl.value
    if (gatewayIndex.value >= IPFS_GATEWAYS.length) return ''
    return resolveIpfsUrl(raw, IPFS_GATEWAYS[gatewayIndex.value])
  })

  function revokeObjectUrl() {
    if (objectUrl.value) {
      URL.revokeObjectURL(objectUrl.value)
      objectUrl.value = ''
    }
  }

  // Reset fallback state whenever the underlying URI changes
  watch(getRawUri, () => {
    gatewayIndex.value = 0
    revokeObjectUrl()
  })

  // Clean up the blob URL when the component unmounts
  onScopeDispose(revokeObjectUrl)

  async function onError() {
    if (gatewayIndex.value < IPFS_GATEWAYS.length) {
      gatewayIndex.value++
      return
    }
    // All gateways failed — fetch trustlessly from the IPFS network.
    const raw = getRawUri()
    if (!raw || !raw.startsWith('ipfs://')) return
    try {
      const { verifiedFetch } = await import('@helia/verified-fetch')
      const resp = await verifiedFetch(raw)
      const blob = await resp.blob()
      revokeObjectUrl()
      objectUrl.value = URL.createObjectURL(blob)
    } catch (err) {
      console.warn('verified-fetch fallback failed for', raw, err)
    }
  }

  return { src, onError }
}