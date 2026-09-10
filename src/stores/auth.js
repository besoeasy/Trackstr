import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import { nostrClient } from '@/services/nostr/client.js'
import { localSigner } from '@/services/nostr/localSigner.js'
import { logger } from '@/utils/logger.js'
import { isValidPubkey } from '@/utils/urls.js'
import { nip19 } from 'nostr-tools'
import router from '@/router/index.js'

function loadStoredIdentity() {
  try {
    const storedPubkey = localStorage.getItem('trackstr_pubkey') || ''
    if (storedPubkey && !isValidPubkey(storedPubkey)) {
      // Corrupted or tampered storage must never yield a fake session.
      localStorage.removeItem('trackstr_pubkey')
      localStorage.removeItem('trackstr_auth_type')
      localStorage.removeItem('trackstr_nsec')
      return { pubkey: '', authType: null }
    }
    const storedType = localStorage.getItem('trackstr_auth_type')
    const authType = storedType === 'nsec' || storedType === 'extension' ? storedType : storedPubkey ? 'extension' : null
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

  function openLoginModal(returnTo) {
    showLoginModal.value = true
    if (typeof window !== 'undefined' && router) {
      try {
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
      // A lingering local nsec signer would keep signing (client prefers it),
      // attributing events to the wrong identity — disconnect it first.
      if (localSigner.isConnected()) {
        localSigner.disconnect()
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
   * Log in using an existing nsec private key (NIP-19).
   * The key is stored locally so events can be signed in the browser.
   * @param {string} nsecInput nsec1... / nostr:nsec1... / hex
   */
  async function loginWithNsec(nsecInput) {
    isLoggingIn.value = true
    loginError.value = ''
    loginStatusMessage.value = 'Validating nsec key...'
    lastErrorDetails.value = null

    logger.info('AuthStore', 'User triggered loginWithNsec()')

    try {
      // A lingering extension signer would keep signing (client prefers it),
      // attributing events to the wrong identity — disconnect it first.
      const result = await localSigner.loginWithNsec(nsecInput)

      pubkey.value = result.pubkey
      authType.value = 'nsec'

      logger.info('AuthStore', `nsec login successful! Pubkey: ${result.pubkey}`)

      // Close modal on successful connection
      closeLoginModal()

      // Fetch Kind 0 profile in background
      fetchUserProfile(result.pubkey)
      return result.pubkey
    } catch (err) {
      const msg = err?.message || String(err)
      logger.error('AuthStore', `nsec login failed: ${msg}`, err)
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
   * Creates a fresh disposable account (new random nsec) and logs in.
   * @returns {Promise<{ pubkey: string, nsec: string }>}
   */
  async function createDisposableAccount() {
    isLoggingIn.value = true
    loginError.value = ''
    loginStatusMessage.value = 'Generating a fresh Nostr identity...'
    lastErrorDetails.value = null

    logger.info('AuthStore', 'User triggered createDisposableAccount()')

    try {
      const result = await localSigner.createDisposableAccount()

      pubkey.value = result.pubkey
      authType.value = 'nsec'

      logger.info('AuthStore', `Disposable account created! Pubkey: ${result.pubkey}`)

      // Close modal on successful connection
      closeLoginModal()

      // Fetch Kind 0 profile in background
      fetchUserProfile(result.pubkey)
      return result
    } catch (err) {
      const msg = err?.message || String(err)
      logger.error('AuthStore', `Disposable account creation failed: ${msg}`, err)
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
    if (authType.value === 'nsec') {
      localSigner.disconnect()
    }
    pubkey.value = ''
    authType.value = null
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
  if (authType.value === 'nsec') {
    localSigner.restoreSession()
  }

  if (pubkey.value) {
    fetchUserProfile(pubkey.value)
  }

  return {
    pubkey,
    npub,
    authType,
    showLoginModal,
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
    loginWithNsec,
    createDisposableAccount,
    refreshDiagnostics,
    fetchUserProfile,
    logout,
  }
})
