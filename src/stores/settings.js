import { defineStore } from 'pinia'
import { ref } from 'vue'
import { getRelays, saveRelays, resetRelays, DEFAULT_RELAYS } from '@/services/nostr/relays.js'
import { DEFAULT_ORIGINLESS_INSTANCE } from '@/services/originless.js'
import { getTmdbApiKey } from '@/services/api/tmdb.js'

export const useSettingsStore = defineStore('settings', () => {
  const relays = ref(getRelays())
  const originlessUrl = ref(localStorage.getItem('trackstr_originless_url') || DEFAULT_ORIGINLESS_INSTANCE)
  const tmdbApiKey = ref(getTmdbApiKey())
  const theme = ref(localStorage.getItem('trackstr_theme') || 'dark')

  function addRelay(url) {
    const clean = url.trim()
    if (!clean) return
    if (!relays.value.includes(clean)) {
      relays.value.push(clean)
      saveRelays(relays.value)
    }
  }

  function removeRelay(url) {
    relays.value = relays.value.filter((r) => r !== url)
    saveRelays(relays.value)
  }

  function restoreDefaultRelays() {
    relays.value = resetRelays()
  }

  function setOriginlessUrl(url) {
    const clean = url.trim() || DEFAULT_ORIGINLESS_INSTANCE
    originlessUrl.value = clean
    localStorage.setItem('trackstr_originless_url', clean)
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
    originlessUrl,
    tmdbApiKey,
    theme,
    addRelay,
    removeRelay,
    restoreDefaultRelays,
    setOriginlessUrl,
    setTmdbApiKey,
    toggleTheme,
  }
})
