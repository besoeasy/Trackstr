import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import { nostrClient } from '@/services/nostr/client.js'
import { bunkerService } from '@/services/nostr/bunker.js'
import { logger } from '@/utils/logger.js'
import { isValidPubkey } from '@/utils/urls.js'
import { nip19 } from 'nostr-tools'

function loadStoredIdentity() {
  try {
    const storedPubkey = localStorage.getItem('trackstr_pubkey') || ''
    if (storedPubkey && !isValidPubkey(storedPubkey)) {
      // Corrupted or tampered storage must never yield a fake session.
      localStorage.removeItem('trackstr_pubkey')
      localStorage.removeItem('trackstr_auth_type')
      return { pubkey: '', authType: null }
    }
    const storedType = localStorage.getItem('trackstr_auth_type')
    const authType = storedType === 'bunker' || storedType === 'extension' ? storedType : storedPubkey ? 'extension' : null
    return { pubkey: storedPubkey, authType }
  } catch {
    return { pubkey: '', authType: null }
  }
}

export const useAuthStore = defineStore('auth', () => {
  const stored = loadStoredIdentity()
  const pubkey = ref(stored.pubkey)
  const authType = ref(stored.authType)
  const showLoginModal = ref(false)
  const bunkerPointer = ref(bunkerService.getBunkerPointer())
  const profile = ref(null)
  const isLoggingIn = ref(false)
  const loginStatusMessage = ref('')
  const loginError = ref('')
  const lastErrorDetails = ref(null)
  const diagnostics = ref(nostrClient.getDiagnostics())

  const isAuthenticated = computed(() => !!pubkey.value)

  const npub = computed(() => {
    if (!pubkey.value) return ''
    try {
      return nip19.npubEncode(pubkey.value)
    } catch {
      return ''
    }
  })

  const displayName = computed(() => {
    if (profile.value?.display_name) return profile.value.display_name
    if (profile.value?.name) return profile.value.name
    if (npub.value) return `${npub.value.slice(0, 9)}...${npub.value.slice(-5)}`
    return 'Anonymous'
  })

  const avatarUrl = computed(() => {
    return profile.value?.picture || ''
  })

  function refreshDiagnostics() {
    diagnostics.value = nostrClient.getDiagnostics()
    return diagnostics.value
  }

  async function openLoginModal(returnTo) {
    showLoginModal.value = true
    if (typeof window !== 'undefined') {
      try {
        const { default: router } = await import('@/router/index.js')
        const query = returnTo ? { returnTo } : {}
        router.push({ path: '/connect', query }).catch(() => {})
      } catch {
        // Fallback in test/headless environments
      }
    }
  }

  function closeLoginModal() {
    showLoginModal.value = false
    loginError.value = ''
    loginStatusMessage.value = ''
  }

  /**
   * Log in using NIP-07 browser extension (Alby, nos2x, etc.)
   */
  async function loginWithExtension() {
    isLoggingIn.value = true
    loginError.value = ''
    loginStatusMessage.value = 'Connecting to browser extension...'
    lastErrorDetails.value = null
    refreshDiagnostics()

    logger.info('AuthStore', 'User triggered loginWithExtension()')

    try {
      // A lingering Bunker signer would keep signing (client prefers it),
      // attributing events to the wrong identity — disconnect it first.
      if (bunkerService.isConnected()) {
        await bunkerService.disconnectBunker()
      }
      const hex = await nostrClient.getPublicKeyFromExtension()
      if (!hex) {
        throw new Error('No public key returned by extension.')
      }

      pubkey.value = hex
      authType.value = 'extension'
      localStorage.setItem('trackstr_pubkey', hex)
      localStorage.setItem('trackstr_auth_type', 'extension')
      logger.info('AuthStore', `Stored authenticated pubkey: ${hex} (extension)`)

      // Close modal on successful connection
      closeLoginModal()

      // Fetch Kind 0 profile in background
      fetchUserProfile(hex)
      return hex
    } catch (err) {
      const msg = err?.message || String(err)
      logger.error('AuthStore', `Login failed: ${msg}`, { error: err, diagnostics: diagnostics.value })
      loginError.value = msg
      lastErrorDetails.value = {
        message: msg,
        stack: err?.stack || null,
        diagnostics: diagnostics.value,
        timestamp: new Date().toISOString(),
      }
      throw err
    } finally {
      isLoggingIn.value = false
      loginStatusMessage.value = ''
    }
  }

  /**
   * Log in using NIP-46 Bunker (bunker://... or username@domain.com)
   * @param {string} bunkerInput
   * @param {Object} [options]
   */
  async function loginWithBunker(bunkerInput, options = {}) {
    isLoggingIn.value = true
    loginError.value = ''
    loginStatusMessage.value = 'Resolving Bunker connection...'
    lastErrorDetails.value = null

    logger.info('AuthStore', 'User triggered loginWithBunker()')

    try {
      const result = await bunkerService.connectBunker(bunkerInput, {
        pool: nostrClient.pool,
        onStatus: (msg) => {
          loginStatusMessage.value = msg
        },
        onAuthUrl: options.onAuthUrl,
      })

      pubkey.value = result.pubkey
      authType.value = 'bunker'
      bunkerPointer.value = result.pointer

      logger.info('AuthStore', `Bunker login successful! Pubkey: ${result.pubkey}`)

      // Close modal on successful connection
      closeLoginModal()

      // Fetch Kind 0 profile in background
      fetchUserProfile(result.pubkey)
      return result.pubkey
    } catch (err) {
      const msg = err?.message || String(err)
      logger.error('AuthStore', `Bunker login failed: ${msg}`, err)
      loginError.value = msg
      lastErrorDetails.value = {
        message: msg,
        stack: err?.stack || null,
        diagnostics: diagnostics.value,
        timestamp: new Date().toISOString(),
      }
      throw err
    } finally {
      isLoggingIn.value = false
      loginStatusMessage.value = ''
    }
  }

  /**
   * Log in using Nostr Connect QR code URI
   * @param {string} uri nostrconnect:// URI
   * @param {Object} [options]
   */
  async function loginWithNostrConnectUri(uri, options = {}) {
    isLoggingIn.value = true
    loginError.value = ''
    loginStatusMessage.value = 'Waiting for signer connection...'
    lastErrorDetails.value = null

    try {
      const result = await bunkerService.listenForNostrConnect(uri, {
        pool: nostrClient.pool,
        abortSignal: options.abortSignal,
        onStatus: (msg) => {
          loginStatusMessage.value = msg
        },
        onAuthUrl: options.onAuthUrl,
      })

      pubkey.value = result.pubkey
      authType.value = 'bunker'
      bunkerPointer.value = result.pointer

      logger.info('AuthStore', `Bunker QR login successful! Pubkey: ${result.pubkey}`)

      closeLoginModal()
      fetchUserProfile(result.pubkey)
      return result.pubkey
    } catch (err) {
      if (options.abortSignal?.aborted) {
        return null
      }
      const msg = err?.message || String(err)
      logger.error('AuthStore', `Bunker QR login failed: ${msg}`, err)
      loginError.value = msg
      lastErrorDetails.value = {
        message: msg,
        stack: err?.stack || null,
        diagnostics: diagnostics.value,
        timestamp: new Date().toISOString(),
      }
      throw err
    } finally {
      isLoggingIn.value = false
      loginStatusMessage.value = ''
    }
  }

  /**
   * Fetch profile metadata (kind 0)
   */
  async function fetchUserProfile(hex) {
    try {
      const p = await nostrClient.fetchProfile(hex || pubkey.value)
      if (p) {
        profile.value = p
      }
    } catch (e) {
      logger.warn('AuthStore', 'Failed to fetch profile metadata:', e)
    }
  }

  /**
   * Log out
   */
  async function logout() {
    if (authType.value === 'bunker') {
      await bunkerService.disconnectBunker()
    }
    pubkey.value = ''
    authType.value = null
    bunkerPointer.value = null
    profile.value = null
    localStorage.removeItem('trackstr_pubkey')
    localStorage.removeItem('trackstr_auth_type')
    // Drop live sockets and pending callbacks so nothing keeps ingesting
    // into the shared stores across accounts.
    try {
      nostrClient.resetConnections()
    } catch {}
    logger.info('AuthStore', 'User logged out')
  }

  // Restore session on initial load
  if (authType.value === 'bunker') {
    bunkerService.restoreBunkerSigner({ pool: nostrClient.pool }).catch((err) => {
      logger.warn('AuthStore', 'Failed to restore Bunker signer session:', err)
    })
  }

  if (pubkey.value) {
    fetchUserProfile(pubkey.value)
  }

  return {
    pubkey,
    npub,
    authType,
    showLoginModal,
    bunkerPointer,
    profile,
    displayName,
    avatarUrl,
    isAuthenticated,
    isLoggingIn,
    loginStatusMessage,
    loginError,
    lastErrorDetails,
    diagnostics,
    openLoginModal,
    closeLoginModal,
    loginWithExtension,
    loginWithBunker,
    loginWithNostrConnectUri,
    refreshDiagnostics,
    fetchUserProfile,
    logout,
  }
})
