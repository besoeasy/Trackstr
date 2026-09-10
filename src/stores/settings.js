import { defineStore } from 'pinia'
import { ref } from 'vue'
import { getRelays, saveRelays, resetRelays, DEFAULT_RELAYS, MAX_RELAYS } from '@/services/nostr/relays.js'
import { getTmdbApiKey } from '@/services/api/tmdb.js'
import { normalizeRelayUrl } from '@/utils/urls.js'
import { nostrClient } from '@/services/nostr/client.js'

export const useSettingsStore = defineStore('settings', () => {
  const relays = ref(getRelays())
  const tmdbApiKey = ref(getTmdbApiKey())
  const theme = ref(localStorage.getItem('trackstr_theme') || 'dark')
  const settingsError = ref('')

  function refreshRelayConnections() {
    try {
      nostrClient.resetConnections()
    } catch {}
  }

  function addRelay(url) {
    settingsError.value = ''
    const clean = normalizeRelayUrl(url)
    if (!clean) {
      settingsError.value = 'Relay URL must look like wss://relay.example.com'
      return false
    }
    if (relays.value.some((r) => r.toLowerCase() === clean.toLowerCase())) {
      return true
    }
    if (relays.value.length >= MAX_RELAYS) {
      settingsError.value = `Relay limit reached (max ${MAX_RELAYS}). Remove one first.`
      return false
    }
    relays.value.push(clean)
    saveRelays(relays.value)
    refreshRelayConnections()
    return true
  }

  function removeRelay(url) {
    relays.value = relays.value.filter((r) => r !== url)
    saveRelays(relays.value)
    refreshRelayConnections()
  }

  function restoreDefaultRelays() {
    relays.value = resetRelays()
    refreshRelayConnections()
  }

  function setTmdbApiKey(key) {
    const clean = key.trim()
    tmdbApiKey.value = clean
    localStorage.setItem('trackstr_tmdb_api_key', clean)
  }

  function toggleTheme() {
    theme.value = theme.value === 'dark' ? 'light' : 'dark'
    localStorage.setItem('trackstr_theme', theme.value)
    document.documentElement.setAttribute('data-theme', theme.value)
  }

  return {
    relays,
    defaultRelays: DEFAULT_RELAYS,
    maxRelays: MAX_RELAYS,
    tmdbApiKey,
    theme,
    settingsError,
    addRelay,
    removeRelay,
    restoreDefaultRelays,
    setTmdbApiKey,
    toggleTheme,
  }
})
