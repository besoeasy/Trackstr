import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import { nostrClient } from '@/services/nostr/client.js'
import { logger } from '@/utils/logger.js'
import { nip19 } from 'nostr-tools'

export const useAuthStore = defineStore('auth', () => {
  const pubkey = ref(localStorage.getItem('trackstr_pubkey') || '')
  const profile = ref(null)
  const isLoggingIn = ref(false)
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

  /**
   * Log in using NIP-07 browser extension (Alby, nos2x, etc.)
   */
  async function loginWithExtension() {
    isLoggingIn.value = true
    loginError.value = ''
    lastErrorDetails.value = null
    refreshDiagnostics()

    logger.info('AuthStore', 'User triggered loginWithExtension()')

    try {
      const hex = await nostrClient.getPublicKeyFromExtension()
      if (!hex) {
        throw new Error('No public key returned by extension.')
      }

      pubkey.value = hex
      localStorage.setItem('trackstr_pubkey', hex)
      logger.info('AuthStore', `Stored authenticated pubkey: ${hex}`)

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
  function logout() {
    pubkey.value = ''
    profile.value = null
    localStorage.removeItem('trackstr_pubkey')
    logger.info('AuthStore', 'User logged out')
  }

  // Restore profile on initial load if pubkey exists
  if (pubkey.value) {
    fetchUserProfile(pubkey.value)
  }

  return {
    pubkey,
    npub,
    profile,
    displayName,
    avatarUrl,
    isAuthenticated,
    isLoggingIn,
    loginError,
    lastErrorDetails,
    diagnostics,
    loginWithExtension,
    refreshDiagnostics,
    fetchUserProfile,
    logout,
  }
})
