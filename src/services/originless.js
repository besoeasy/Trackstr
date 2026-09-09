/**
 * Originless IPFS Service
 * Interacts with Originless public/private node for decentralized media storage.
 * Default instance: https://originless.gupt.app/
 */

export const DEFAULT_ORIGINLESS_INSTANCE = 'https://originless.gupt.app'
export const DEFAULT_IPFS_RESOLVE_GATEWAY = 'https://dweb.link'

/**
 * Resolves an ipfs:// URI or CID to a gateway HTTP URL for presentation
 * Defaults to dweb.link/ipfs/<CID>
 * @param {string} ipfsUri ipfs://<CID> or raw CID or HTTP URL
 * @param {string} [customGateway] Optional gateway URL base (defaults to https://dweb.link)
 * @returns {string} HTTP URL for rendering
 */
export function resolveIpfsUrl(ipfsUri, customGateway = DEFAULT_IPFS_RESOLVE_GATEWAY) {
  if (!ipfsUri) return ''

  // If already an HTTP/HTTPS URL
  if (ipfsUri.startsWith('http://') || ipfsUri.startsWith('https://')) {
    return ipfsUri
  }

  // Handle ipfs:// prefix
  let cid = ipfsUri
  if (cid.startsWith('ipfs://')) {
    cid = cid.replace(/^ipfs:\/\//, '')
  }

  // Strip leading slashes if any
  cid = cid.replace(/^\/+/, '')

  // Clean gateway base
  const gateway = (customGateway || DEFAULT_IPFS_RESOLVE_GATEWAY).replace(/\/+$/, '')

  return `${gateway}/ipfs/${cid}`
}

/**
 * Uploads a File or Blob to Originless
 * @param {File|Blob} file File or Blob object
 * @param {Object} options
 * @param {boolean} [options.anonymize=true] Use /media to strip EXIF and metadata for images
 * @param {string} [options.instanceUrl] Originless node URL
 * @param {string} [options.filename] Optional filename fallback
 * @returns {Promise<{ cid: string, ipfsUri: string, gatewayUrl: string, size: number, filename: string }>}
 */
export async function uploadToOriginless(file, options = {}) {
  const instanceUrl = (options.instanceUrl || DEFAULT_ORIGINLESS_INSTANCE).replace(/\/+$/, '')
  const anonymize = options.anonymize !== false
  const filename = options.filename || file.name || 'file'

  const endpoint = anonymize ? `${instanceUrl}/media` : `${instanceUrl}/upload`

  const formData = new FormData()
  formData.append('file', file, filename)

  const response = await fetch(endpoint, {
    method: 'POST',
    body: formData,
  })

  if (!response.ok) {
    const errorText = await response.text().catch(() => '')
    throw new Error(`Failed to upload to Originless (${response.status}): ${errorText || response.statusText}`)
  }

  const data = await response.json()
  if (data.status !== 'success' || !data.cid) {
    throw new Error(data.message || data.error || 'Originless upload did not return a valid CID')
  }

  return {
    cid: data.cid,
    ipfsUri: `ipfs://${data.cid}`,
    gatewayUrl: resolveIpfsUrl(data.cid),
    size: data.size || file.size || 0,
    filename: data.filename || filename,
  }
}

/**
 * Fetches an image or file from a URL (e.g. external TMDB / MusicBrainz poster)
 * and uploads it to Originless to obtain a decentralized IPFS CID
 * @param {string} remoteUrl External image URL
 * @param {string} filename Suggested filename
 * @param {string} [instanceUrl] Originless node instance
 * @returns {Promise<{ cid: string, ipfsUri: string, gatewayUrl: string }>}
 */
export async function mirrorRemoteUrlToOriginless(remoteUrl, filename = 'poster.jpg', instanceUrl = DEFAULT_ORIGINLESS_INSTANCE) {
  if (!remoteUrl) {
    throw new Error('Remote URL is required to mirror to Originless')
  }

  // Fetch the remote asset as a blob
  const res = await fetch(remoteUrl)
  if (!res.ok) {
    throw new Error(`Failed to fetch remote asset: ${res.statusText}`)
  }

  const blob = await res.blob()
  return await uploadToOriginless(blob, {
    filename,
    anonymize: true,
    instanceUrl,
  })
}
