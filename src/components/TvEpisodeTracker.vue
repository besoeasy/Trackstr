<script setup>
import { ref, computed, onMounted, watch } from 'vue'
import { useMediaStore } from '@/stores/media.js'
import { useAuthStore } from '@/stores/auth.js'
import { fetchShowEpisodes } from '@/services/api/tv.js'
import { buildDTag, cleanShowTitle } from '@/utils/contentId.js'
import { safeMediaUrl } from '@/utils/urls.js'
import RatingInput from '@/components/RatingInput.vue'

const props = defineProps({
  media: {
    type: Object,
    required: true,
  },
  contentId: {
    type: String,
    required: true,
  },
  targetSeason: {
    type: [Number, String],
    default: null,
  },
  targetEpisode: {
    type: [Number, String],
    default: null,
  },
})

const mediaStore = useMediaStore()
const authStore = useAuthStore()

const isLoading = ref(true)
const episodesData = ref({ seasons: [], totalEpisodes: 0, source: '' })
const selectedSeasonNumber = ref(1)
const inFlightMap = ref({})
const isBatchOperating = ref(false)
const expandedSummaries = ref(new Set())
const activeRatingEpisode = ref(null)

// Quick Log Dialog State
const showQuickLog = ref(false)
const quickSeason = ref(1)
const quickEpisode = ref(1)
const quickTitle = ref('')
const isLoggingQuickEp = ref(false)

const seasons = computed(() => episodesData.value.seasons || [])

const currentSeason = computed(() => {
  return seasons.value.find((s) => s.seasonNumber === selectedSeasonNumber.value) || seasons.value[0] || null
})

const currentSeasonEpisodes = computed(() => currentSeason.value?.episodes || [])

// Season Progress
const seasonStats = computed(() => {
  const eps = currentSeasonEpisodes.value
  if (!eps.length) return { total: 0, watched: 0, percent: 0 }

  const watched = eps.filter((ep) => isEpisodeWatched(ep.season, ep.episode)).length
  const percent = Math.round((watched / eps.length) * 100)
  return { total: eps.length, watched, percent }
})

// Overall Show Progress across all seasons (including specials)
const totalShowStats = computed(() => {
  let total = 0
  let watched = 0
  for (const s of seasons.value) {
    for (const ep of s.episodes) {
      total++
      if (isEpisodeWatched(ep.season, ep.episode)) {
        watched++
      }
    }
  }
  const percent = total ? Math.round((watched / total) * 100) : 0
  return { total, watched, percent }
})

// "Up Next" Episode Computation (checks regular seasons first in order, then specials)
const upNextEpisode = computed(() => {
  if (!seasons.value.length) return null

  // 1. Check regular seasons in ascending order (Season 1, Season 2...)
  const regularSeasons = seasons.value
    .filter((s) => s.seasonNumber > 0)
    .slice()
    .sort((a, b) => a.seasonNumber - b.seasonNumber)

  for (const s of regularSeasons) {
    for (const ep of s.episodes) {
      if (!isEpisodeWatched(ep.season, ep.episode)) {
        return ep
      }
    }
  }

  // 2. If all regular seasons completed, check Specials (Season 0)
  const specialsSeason = seasons.value.find((s) => s.seasonNumber === 0)
  if (specialsSeason) {
    for (const ep of specialsSeason.episodes) {
      if (!isEpisodeWatched(ep.season, ep.episode)) {
        return ep
      }
    }
  }

  return null
})

function saveCustomEpisode(ep) {
  try {
    const key = `trackstr_custom_episodes_${props.contentId}`
    const raw = localStorage.getItem(key)
    const list = raw ? JSON.parse(raw) : []
    const idx = list.findIndex((x) => x.season === ep.season && x.episode === ep.episode)
    if (idx >= 0) {
      list[idx] = { season: ep.season, episode: ep.episode, name: ep.name }
    } else {
      list.push({ season: ep.season, episode: ep.episode, name: ep.name })
    }
    localStorage.setItem(key, JSON.stringify(list))
  } catch {}
}

function getNextEpisodeNumber(seasonObj) {
  if (!seasonObj || !seasonObj.episodes.length) return 1
  return Math.max(...seasonObj.episodes.map((e) => e.episode)) + 1
}

function getNextSeasonOptionValue() {
  const reg = seasons.value.filter((s) => s.seasonNumber > 0)
  return reg.length > 0 ? Math.max(...reg.map((s) => s.seasonNumber)) + 1 : 1
}

function addNextEpisode(seasonObj = currentSeason.value) {
  if (!seasonObj) return
  const sNum = seasonObj.seasonNumber
  const nextNum = getNextEpisodeNumber(seasonObj)
  const newEp = {
    id: `custom-s${sNum}e${nextNum}`,
    season: sNum,
    episode: nextNum,
    name: sNum === 0 ? `Special ${nextNum}` : `Episode ${nextNum}`,
    airDate: '',
    runtime: null,
    summary: '',
    still: '',
    rating: null,
    source: 'user',
  }
  seasonObj.episodes.push(newEp)
  seasonObj.episodes.sort((a, b) => a.episode - b.episode)
  seasonObj.episodeCount = seasonObj.episodes.length
  episodesData.value.totalEpisodes = seasons.value.reduce((acc, s) => acc + s.episodes.length, 0)
  saveCustomEpisode(newEp)
}

function addNextSeason() {
  const regular = seasons.value.filter((s) => s.seasonNumber > 0)
  const nextSeasonNum = regular.length > 0 ? Math.max(...regular.map((s) => s.seasonNumber)) + 1 : 1
  const newSeason = {
    seasonNumber: nextSeasonNum,
    name: `Season ${nextSeasonNum}`,
    episodeCount: 1,
    episodes: [
      {
        id: `custom-s${nextSeasonNum}e1`,
        season: nextSeasonNum,
        episode: 1,
        name: 'Episode 1',
        airDate: '',
        runtime: null,
        summary: '',
        still: '',
        rating: null,
        source: 'user',
      },
    ],
  }
  episodesData.value.seasons.push(newSeason)
  episodesData.value.totalEpisodes = seasons.value.reduce((acc, s) => acc + s.episodes.length, 0)
  selectedSeasonNumber.value = nextSeasonNum
  saveCustomEpisode(newSeason.episodes[0])
}

function addSpecialsSeason() {
  let specials = seasons.value.find((s) => s.seasonNumber === 0)
  if (specials) {
    selectedSeasonNumber.value = 0
    return
  }
  specials = {
    seasonNumber: 0,
    name: 'Specials',
    episodeCount: 1,
    episodes: [
      {
        id: 'custom-s0e1',
        season: 0,
        episode: 1,
        name: 'Special 1',
        airDate: '',
        runtime: null,
        summary: '',
        still: '',
        rating: null,
        source: 'user',
      },
    ],
  }
  episodesData.value.seasons.push(specials)
  episodesData.value.totalEpisodes = seasons.value.reduce((acc, s) => acc + s.episodes.length, 0)
  selectedSeasonNumber.value = 0
  saveCustomEpisode(specials.episodes[0])
}

async function submitQuickLog() {
  if (!authStore.isAuthenticated) {
    authStore.openLoginModal()
    return
  }
  const s = Number(quickSeason.value)
  const e = Number(quickEpisode.value)
  if (!Number.isFinite(s) || !Number.isFinite(e) || s < 0 || e < 1) return

  isLoggingQuickEp.value = true
  try {
    let targetSeasonObj = seasons.value.find((season) => season.seasonNumber === s)
    if (!targetSeasonObj) {
      targetSeasonObj = {
        seasonNumber: s,
        name: s === 0 ? 'Specials' : `Season ${s}`,
        episodeCount: 0,
        episodes: [],
      }
      episodesData.value.seasons.push(targetSeasonObj)
    }

    let epObj = targetSeasonObj.episodes.find((ep) => ep.episode === e)
    if (!epObj) {
      epObj = {
        id: `custom-s${s}e${e}`,
        season: s,
        episode: e,
        name: quickTitle.value.trim() || (s === 0 ? `Special ${e}` : `Episode ${e}`),
        airDate: '',
        runtime: null,
        summary: '',
        still: '',
        rating: null,
        source: 'user',
      }
      targetSeasonObj.episodes.push(epObj)
      targetSeasonObj.episodes.sort((a, b) => a.episode - b.episode)
      targetSeasonObj.episodeCount = targetSeasonObj.episodes.length
      episodesData.value.totalEpisodes = seasons.value.reduce((acc, s) => acc + s.episodes.length, 0)
      saveCustomEpisode(epObj)
    } else if (quickTitle.value.trim()) {
      epObj.name = quickTitle.value.trim()
      saveCustomEpisode(epObj)
    }

    const epMedia = makeEpisodeMedia(epObj)
    await mediaStore.setStatus(epMedia, 'completed', `s${s}e${e}`)
    await autoPromoteShowStatus()

    selectedSeasonNumber.value = s
    showQuickLog.value = false
    quickTitle.value = ''
  } catch (err) {
    console.error('Failed to quick log episode:', err)
  } finally {
    isLoggingQuickEp.value = false
  }
}

onMounted(() => {
  loadEpisodes()
})

watch(
  () => props.contentId,
  () => {
    loadEpisodes()
  }
)

// The detail page starts with a 'Loading...' placeholder title when the item
// isn't cached (direct URL / bookmark navigation). Reload once the real title
// arrives so we never query TVMaze for the placeholder.
watch(
  () => props.media.title || props.media.name,
  (newTitle, oldTitle) => {
    if (newTitle && newTitle !== oldTitle && newTitle !== 'Loading...') {
      loadEpisodes()
    }
  }
)

async function loadEpisodes() {
  isLoading.value = true
  try {
    const title = props.media.title || props.media.name || ''
    // Never query providers with the placeholder title.
    if (!title || title === 'Loading...') {
      episodesData.value = { seasons: [], totalEpisodes: 0, source: '' }
      return
    }
    const rawId = props.media.tmdbId || props.media.id
    // A tvmaze-<id> string must only go to TVMaze, never TMDB.
    const tmdbId = rawId && !String(rawId).startsWith('tvmaze-') ? rawId : null
    const tvmazeId = props.media.id && String(props.media.id).startsWith('tvmaze-') ? props.media.id : null
    const numberOfSeasons = props.media.seasons || null

    let rawData = null
    try {
      rawData = await fetchShowEpisodes({
        title,
        tmdbId,
        tvmazeId,
        numberOfSeasons,
      })
    } catch {
      rawData = { seasons: [], totalEpisodes: 0, source: '' }
    }

    // Discover episodes from Nostr events, local store, and custom user-added episodes
    const discovered = mediaStore.getDiscoveredEpisodesForMedia(props.contentId)

    const seasonsMap = new Map()

    // 1. Add catalog seasons and episodes if returned
    if (rawData?.seasons?.length) {
      for (const s of rawData.seasons) {
        seasonsMap.set(s.seasonNumber, {
          seasonNumber: s.seasonNumber,
          name: s.seasonNumber === 0 ? 'Specials' : (s.name || `Season ${s.seasonNumber}`),
          episodeCount: s.episodeCount || (s.episodes?.length || 0),
          episodes: [...(s.episodes || [])],
        })
      }
    }

    // 2. Merge discovered episodes from Nostr and local store
    for (const disc of discovered) {
      if (!seasonsMap.has(disc.season)) {
        seasonsMap.set(disc.season, {
          seasonNumber: disc.season,
          name: disc.season === 0 ? 'Specials' : `Season ${disc.season}`,
          episodeCount: 0,
          episodes: [],
        })
      }
      const seasonObj = seasonsMap.get(disc.season)
      const exists = seasonObj.episodes.some((e) => e.episode === disc.episode)
      if (!exists) {
        seasonObj.episodes.push({
          id: `ep-s${disc.season}e${disc.episode}`,
          season: disc.season,
          episode: disc.episode,
          name: disc.name || (disc.season === 0 ? `Special ${disc.episode}` : `Episode ${disc.episode}`),
          airDate: '',
          runtime: null,
          summary: '',
          still: '',
          rating: null,
          source: disc.source || 'nostr',
        })
      }
    }

    // 3. If still completely empty (e.g. show sourced from Wikipedia without episodes),
    // initialize Season 1 so the user can start tracking immediately!
    if (seasonsMap.size === 0) {
      seasonsMap.set(1, {
        seasonNumber: 1,
        name: 'Season 1',
        episodeCount: 1,
        episodes: [
          {
            id: 'custom-s1e1',
            season: 1,
            episode: 1,
            name: 'Episode 1',
            airDate: '',
            runtime: null,
            summary: '',
            still: '',
            rating: null,
            source: 'user',
          },
        ],
      })
    }

    for (const s of seasonsMap.values()) {
      s.episodes.sort((a, b) => a.episode - b.episode)
      s.episodeCount = s.episodes.length
    }

    const sortedSeasons = Array.from(seasonsMap.values()).sort((a, b) => {
      // Main seasons 1, 2, 3... first, Specials (Season 0) placed at the end
      if (a.seasonNumber === 0) return 1
      if (b.seasonNumber === 0) return -1
      return a.seasonNumber - b.seasonNumber
    })

    const totalEpisodes = sortedSeasons.reduce((acc, s) => acc + s.episodes.length, 0)
    const sourceLabel = rawData?.source || (discovered.length ? 'Nostr & Community' : 'User-driven')

    episodesData.value = {
      seasons: sortedSeasons,
      totalEpisodes,
      source: sourceLabel,
    }

    if (sortedSeasons.length > 0) {
      const targetS = props.targetSeason !== null && props.targetSeason !== undefined ? Number(props.targetSeason) : null
      const foundTarget = targetS !== null ? sortedSeasons.find((s) => s.seasonNumber === targetS) : null
      if (foundTarget) {
        selectedSeasonNumber.value = targetS
      } else {
        const s1 = sortedSeasons.find((s) => s.seasonNumber === 1)
        selectedSeasonNumber.value = s1 ? 1 : sortedSeasons[0].seasonNumber
      }
    }
  } catch (err) {
    console.warn('Failed to load episodes for show:', err)
  } finally {
    isLoading.value = false
  }
}

watch(
  () => props.targetSeason,
  (newTarget) => {
    if (newTarget !== null && newTarget !== undefined && seasons.value.some((s) => s.seasonNumber === Number(newTarget))) {
      selectedSeasonNumber.value = Number(newTarget)
    }
  }
)

function isEpisodeWatched(season, episode) {
  const status = mediaStore.getMediaStatus(props.contentId, season, episode)
  return status?.status === 'completed'
}

function getEpisodeRating(season, episode) {
  return mediaStore.getMediaRating(props.contentId, season, episode)
}

function makeEpisodeMedia(ep) {
  const cleanTitle = cleanShowTitle(props.media.title || props.media.name)
  return {
    ...props.media,
    contentId: props.contentId,
    type: 'episode',
    season: ep.season,
    episode: ep.episode,
    name: `${cleanTitle} - S${ep.season}E${ep.episode}: ${ep.name}`,
    title: `${cleanTitle} - S${ep.season}E${ep.episode}: ${ep.name}`,
    year: ep.airDate ? ep.airDate.slice(0, 4) : props.media.year,
  }
}

async function autoPromoteShowStatus() {
  const currentParentStatus = mediaStore.getMediaStatus(props.contentId)
  if (!currentParentStatus || currentParentStatus.status === 'plan-to-watch') {
    const cleanTitle = cleanShowTitle(props.media.title || props.media.name)
    const parentShowMedia = {
      ...props.media,
      type: 'show',
      season: undefined,
      episode: undefined,
      name: cleanTitle,
      title: cleanTitle,
    }
    await mediaStore.setStatus(parentShowMedia, 'watching').catch((err) => {
      console.warn('Could not auto-promote show status:', err)
    })
  }
}

async function toggleWatched(ep) {
  if (!authStore.isAuthenticated) {
    authStore.openLoginModal()
    return
  }

  const key = `s${ep.season}e${ep.episode}`
  if (inFlightMap.value[key]) return

  inFlightMap.value = { ...inFlightMap.value, [key]: true }
  try {
    const watched = isEpisodeWatched(ep.season, ep.episode)
    if (watched) {
      // Unwatch via NIP-09 deletion of addressable coordinate
      const dTag = buildDTag({
        contentId: props.contentId,
        season: ep.season,
        episode: ep.episode,
      })
      await mediaStore.deleteTrackstrEvent({
        coordinate: `35402:${authStore.pubkey}:${dTag}`,
        reason: 'Untracked episode',
      })
    } else {
      // Mark as completed
      const epMedia = makeEpisodeMedia(ep)
      await mediaStore.setStatus(epMedia, 'completed', `s${ep.season}e${ep.episode}`)
      await autoPromoteShowStatus()
    }
  } catch (err) {
    console.error('Failed to toggle episode status:', err)
  } finally {
    const next = { ...inFlightMap.value }
    delete next[key]
    inFlightMap.value = next
  }
}

async function markSeasonWatched() {
  if (!authStore.isAuthenticated) {
    authStore.openLoginModal()
    return
  }
  if (!currentSeason.value || isBatchOperating.value) return

  isBatchOperating.value = true
  try {
    const unwatched = currentSeason.value.episodes.filter(
      (ep) => !isEpisodeWatched(ep.season, ep.episode)
    )
    for (const ep of unwatched) {
      const epMedia = makeEpisodeMedia(ep)
      await mediaStore.setStatus(epMedia, 'completed', `s${ep.season}e${ep.episode}`)
    }
    await autoPromoteShowStatus()
  } catch (err) {
    console.error('Failed to batch mark season watched:', err)
  } finally {
    isBatchOperating.value = false
  }
}

async function unmarkSeasonWatched() {
  if (!authStore.isAuthenticated) {
    authStore.openLoginModal()
    return
  }
  if (!currentSeason.value || isBatchOperating.value) return

  isBatchOperating.value = true
  try {
    const watchedEps = currentSeason.value.episodes.filter(
      (ep) => isEpisodeWatched(ep.season, ep.episode)
    )
    for (const ep of watchedEps) {
      const dTag = buildDTag({
        contentId: props.contentId,
        season: ep.season,
        episode: ep.episode,
      })
      await mediaStore.deleteTrackstrEvent({
        coordinate: `35402:${authStore.pubkey}:${dTag}`,
        reason: 'Untracked season batch',
      })
    }
  } catch (err) {
    console.error('Failed to batch unmark season:', err)
  } finally {
    isBatchOperating.value = false
  }
}

async function handleEpisodeRating(ep, newRating) {
  if (!authStore.isAuthenticated) {
    authStore.openLoginModal()
    return
  }
  try {
    const epMedia = makeEpisodeMedia(ep)
    if (newRating === null) {
      const dTag = buildDTag({
        contentId: props.contentId,
        season: ep.season,
        episode: ep.episode,
      })
      await mediaStore.deleteTrackstrEvent({
        coordinate: `35400:${authStore.pubkey}:${dTag}`,
        reason: 'Rating cleared',
      })
    } else {
      await mediaStore.setRating(epMedia, newRating)
    }
  } catch (err) {
    console.error('Failed to set episode rating:', err)
  } finally {
    activeRatingEpisode.value = null
  }
}

function toggleOverview(epId) {
  const next = new Set(expandedSummaries.value)
  if (next.has(epId)) {
    next.delete(epId)
  } else {
    next.add(epId)
  }
  expandedSummaries.value = next
}

function formatEpCode(s, e) {
  const sStr = String(s).padStart(2, '0')
  const eStr = String(e).padStart(2, '0')
  return `S${sStr}E${eStr}`
}
</script>

<template>
  <section class="episodes-tracker-section card">
    <div class="tracker-header">
      <div class="tracker-title-group">
        <h3 class="tracker-heading">Seasons & Episodes</h3>
        <span v-if="episodesData.totalEpisodes" class="total-ep-badge font-mono">
          {{ totalShowStats.watched }} / {{ totalShowStats.total }} watched ({{ totalShowStats.percent }}%)
        </span>
      </div>
      <span v-if="episodesData.source" class="source-tag font-mono">
        Catalog: {{ episodesData.source }}
      </span>
    </div>

    <!-- Loading State -->
    <div v-if="isLoading" class="tracker-loading">
      <div class="season-tabs-skeleton">
        <div class="skeleton-pill" />
        <div class="skeleton-pill" />
        <div class="skeleton-pill" />
      </div>
      <div class="episodes-list-skeleton">
        <div v-for="i in 3" :key="i" class="skeleton-ep-row" />
      </div>
    </div>

    <!-- Empty State -->
    <div v-else-if="!seasons.length" class="tracker-empty">
      <p class="empty-text">No episodes cataloged for this series yet.</p>
      <div class="empty-actions">
        <button type="button" class="btn btn-primary btn-sm" @click="addNextSeason">
          <span>+ Start Season 1</span>
        </button>
        <button type="button" class="btn btn-secondary btn-sm" @click="addSpecialsSeason">
          <span>+ Add Specials</span>
        </button>
      </div>
    </div>

    <!-- Loaded Content -->
    <div v-else class="tracker-content">
      <!-- Up Next Hero & Quick Log -->
      <div class="tracker-hero-bar">
        <!-- Up Next Card -->
        <div v-if="upNextEpisode" class="up-next-card">
          <div class="up-next-info">
            <span class="up-next-badge font-mono">⚡ UP NEXT</span>
            <div class="up-next-title-group">
              <span class="up-next-code font-mono">{{ formatEpCode(upNextEpisode.season, upNextEpisode.episode) }}</span>
              <span class="up-next-name">{{ upNextEpisode.name }}</span>
            </div>
            <span class="up-next-sub">
              {{ upNextEpisode.season === 0 ? 'Specials' : `Season ${upNextEpisode.season}` }} · Episode {{ upNextEpisode.episode }}
            </span>
          </div>
          <button
            class="btn btn-primary btn-sm up-next-action-btn"
            type="button"
            :disabled="inFlightMap[`s${upNextEpisode.season}e${upNextEpisode.episode}`]"
            @click="toggleWatched(upNextEpisode)"
          >
            <span>✓ Watched</span>
          </button>
        </div>

        <div v-else-if="totalShowStats.total > 0 && totalShowStats.watched >= totalShowStats.total" class="all-caught-up-card">
          <span>🎉 You're all caught up with this series!</span>
        </div>

        <!-- Quick Log Episode Opener -->
        <button
          class="btn btn-secondary btn-sm quick-log-toggle-btn"
          type="button"
          @click="showQuickLog = !showQuickLog"
        >
          <span>{{ showQuickLog ? '✕ Close' : '⏩ Quick Log / Jump to Ep' }}</span>
        </button>
      </div>

      <!-- Quick Log Episode Form Panel -->
      <transition name="slide-fade">
        <div v-if="showQuickLog" class="quick-log-panel card">
          <h4 class="quick-log-heading">Log Episode or Special</h4>
          <p class="quick-log-desc">
            Watching ahead, a special, or an unlisted episode? Specify the season and episode number below to log it on Nostr and update your progress.
          </p>
          <div class="quick-log-form">
            <div class="quick-log-field">
              <label class="form-label">Season</label>
              <select v-model.number="quickSeason" class="input quick-log-select">
                <option :value="0">Specials (Season 0)</option>
                <option
                  v-for="s in seasons.filter((x) => x.seasonNumber > 0)"
                  :key="s.seasonNumber"
                  :value="s.seasonNumber"
                >
                  Season {{ s.seasonNumber }}
                </option>
                <option :value="getNextSeasonOptionValue()">+ Next Season</option>
              </select>
            </div>

            <div class="quick-log-field">
              <label class="form-label">Episode #</label>
              <input
                v-model.number="quickEpisode"
                type="number"
                min="1"
                class="input quick-log-input"
              />
            </div>

            <div class="quick-log-field ep-title-field">
              <label class="form-label">Title (Optional)</label>
              <input
                v-model="quickTitle"
                type="text"
                placeholder="e.g. Christmas Special"
                class="input quick-log-input"
              />
            </div>

            <button
              class="btn btn-primary btn-sm quick-log-submit-btn"
              type="button"
              :disabled="isLoggingQuickEp"
              @click="submitQuickLog"
            >
              <span>{{ isLoggingQuickEp ? 'Saving...' : '✓ Log & Mark Watched' }}</span>
            </button>
          </div>
        </div>
      </transition>

      <!-- Season Switcher Tabs -->
      <div class="season-tabs" role="tablist">
        <button
          v-for="s in seasons"
          :key="s.seasonNumber"
          type="button"
          role="tab"
          class="season-pill-btn"
          :class="{ active: selectedSeasonNumber === s.seasonNumber }"
          :aria-selected="selectedSeasonNumber === s.seasonNumber"
          @click="selectedSeasonNumber = s.seasonNumber"
        >
          <span class="season-pill-name">{{ s.name }}</span>
          <span class="season-pill-count font-mono">{{ s.episodeCount }}</span>
        </button>

        <!-- Actions to add Season or Specials -->
        <button
          v-if="!seasons.some((s) => s.seasonNumber === 0)"
          type="button"
          class="season-action-btn"
          title="Add Specials (Season 0)"
          @click="addSpecialsSeason"
        >
          <span>+ Specials</span>
        </button>
        <button
          type="button"
          class="season-action-btn"
          title="Add next Season"
          @click="addNextSeason"
        >
          <span>+ Season</span>
        </button>
      </div>

      <!-- Season Progress Card -->
      <div class="season-progress-panel">
        <div class="progress-info-row">
          <div class="progress-label-group">
            <span class="progress-season-name">{{ currentSeason?.name }}</span>
            <span class="progress-stats font-mono">
              {{ seasonStats.watched }} of {{ seasonStats.total }} watched ({{ seasonStats.percent }}%)
            </span>
          </div>
          <div class="progress-actions">
            <button
              v-if="seasonStats.watched < seasonStats.total"
              type="button"
              class="btn btn-secondary btn-sm batch-btn"
              :disabled="isBatchOperating"
              @click="markSeasonWatched"
            >
              {{ isBatchOperating ? 'Updating...' : '✓ Mark Season Watched' }}
            </button>
            <button
              v-else-if="seasonStats.watched > 0"
              type="button"
              class="btn btn-outline btn-sm batch-btn"
              :disabled="isBatchOperating"
              @click="unmarkSeasonWatched"
            >
              {{ isBatchOperating ? 'Updating...' : '✕ Unmark Season' }}
            </button>
          </div>
        </div>

        <div class="progress-bar-track">
          <div
            class="progress-bar-fill"
            :style="{ width: `${seasonStats.percent}%` }"
          />
        </div>
      </div>

      <!-- Episode Cards Grid / List -->
      <div class="episodes-list">
        <div
          v-for="ep in currentSeasonEpisodes"
          :key="ep.id"
          class="episode-card"
          :class="{
            watched: isEpisodeWatched(ep.season, ep.episode),
            'is-target-episode': targetSeason && targetEpisode && Number(targetSeason) === ep.season && Number(targetEpisode) === ep.episode,
          }"
        >
          <!-- Left: Thumbnail Still -->
          <div class="ep-thumbnail-box">
            <img
              v-if="ep.still"
              :src="safeMediaUrl(ep.still)"
              :alt="ep.name"
              class="ep-thumbnail-img"
              loading="lazy"
            />
            <div v-else class="ep-thumbnail-fallback font-mono">
              {{ formatEpCode(ep.season, ep.episode) }}
            </div>
            <span class="ep-code-chip font-mono">
              {{ formatEpCode(ep.season, ep.episode) }}
            </span>
          </div>

          <!-- Center: Episode Meta & Synopsis -->
          <div class="ep-body">
            <div class="ep-title-row">
              <h4 class="ep-title">
                {{ ep.episode }}. {{ ep.name }}
              </h4>
            </div>

            <div class="ep-meta-row">
              <span v-if="ep.airDate" class="ep-meta-item font-mono">{{ ep.airDate }}</span>
              <span v-if="ep.runtime" class="ep-meta-item font-mono">{{ ep.runtime }} min</span>
              <span v-if="ep.rating" class="ep-meta-item ep-rating-badge font-mono">★ {{ ep.rating }}</span>
              <span
                v-if="getEpisodeRating(ep.season, ep.episode) !== null"
                class="ep-meta-item user-score-badge font-mono"
              >
                Your Score: {{ getEpisodeRating(ep.season, ep.episode) }}
              </span>
            </div>

            <p v-if="ep.summary" class="ep-summary" :class="{ expanded: expandedSummaries.has(ep.id) }">
              {{ ep.summary }}
            </p>
            <button
              v-if="ep.summary && ep.summary.length > 140"
              type="button"
              class="ep-more-btn"
              @click="toggleOverview(ep.id)"
            >
              {{ expandedSummaries.has(ep.id) ? 'Show less' : 'Read more' }}
            </button>
          </div>

          <!-- Right: Interactive Actions -->
          <div class="ep-actions">
            <button
              type="button"
              class="ep-watch-toggle-btn"
              :class="{
                watched: isEpisodeWatched(ep.season, ep.episode),
                loading: inFlightMap[`s${ep.season}e${ep.episode}`],
              }"
              :disabled="inFlightMap[`s${ep.season}e${ep.episode}`]"
              @click="toggleWatched(ep)"
            >
              <span v-if="inFlightMap[`s${ep.season}e${ep.episode}`]">...</span>
              <span v-else-if="isEpisodeWatched(ep.season, ep.episode)">✓ Watched</span>
              <span v-else>○ Watch</span>
            </button>

            <!-- Quick Rating Popover / Button -->
            <div class="ep-rating-action">
              <button
                type="button"
                class="ep-rate-btn"
                :title="getEpisodeRating(ep.season, ep.episode) ? `Rated ${getEpisodeRating(ep.season, ep.episode)}/10` : 'Rate episode'"
                @click="activeRatingEpisode = activeRatingEpisode?.id === ep.id ? null : ep"
              >
                ★ {{ getEpisodeRating(ep.season, ep.episode) ?? 'Rate' }}
              </button>

              <div
                v-if="activeRatingEpisode?.id === ep.id"
                class="ep-rating-popover"
              >
                <div class="popover-header">
                  <span class="popover-title">Rate {{ formatEpCode(ep.season, ep.episode) }}</span>
                  <button type="button" class="popover-close" @click="activeRatingEpisode = null">✕</button>
                </div>
                <RatingInput
                  :model-value="getEpisodeRating(ep.season, ep.episode)"
                  @change="(val) => handleEpisodeRating(ep, val)"
                />
              </div>
            </div>
          </div>
        </div>

        <!-- Add Next Episode affordance -->
        <div class="add-episode-bar">
          <button
            type="button"
            class="btn btn-outline btn-sm add-ep-btn"
            @click="addNextEpisode(currentSeason)"
          >
            <span>+ Add {{ currentSeason?.seasonNumber === 0 ? 'Special' : 'Episode' }} {{ getNextEpisodeNumber(currentSeason) }}</span>
          </button>
        </div>
      </div>
    </div>
  </section>
</template>

<style scoped>
.episodes-tracker-section {
  margin-top: 32px;
  background: var(--bg-surface);
  border: 1px solid var(--border-subtle);
  border-radius: var(--radius-lg);
  padding: 24px;
}

.tracker-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 20px;
  flex-wrap: wrap;
  gap: 12px;
}

.tracker-title-group {
  display: flex;
  align-items: center;
  gap: 12px;
  flex-wrap: wrap;
}

.tracker-heading {
  font-size: 1.25rem;
  font-weight: 700;
  letter-spacing: -0.02em;
  color: var(--text-main);
}

.total-ep-badge {
  font-size: 0.75rem;
  padding: 3px 8px;
  background: rgba(255, 255, 255, 0.06);
  border: 1px solid var(--border-subtle);
  border-radius: var(--radius-full);
  color: var(--text-secondary);
}

.source-tag {
  font-size: 0.7rem;
  color: var(--text-muted);
  text-transform: uppercase;
  letter-spacing: 0.05em;
}

/* Up Next & Quick Log Hero Bar */
.tracker-hero-bar {
  display: flex;
  gap: 12px;
  align-items: stretch;
  margin-bottom: 20px;
  flex-wrap: wrap;
}

.up-next-card {
  display: flex;
  justify-content: space-between;
  align-items: center;
  flex: 1;
  min-width: 280px;
  padding: 12px 16px;
  background: rgba(99, 102, 241, 0.08);
  border: 1px solid rgba(99, 102, 241, 0.28);
  border-radius: var(--radius-md);
  gap: 16px;
}

.up-next-info {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.up-next-badge {
  font-size: 0.65rem;
  font-weight: 700;
  color: #818cf8;
  letter-spacing: 0.06em;
}

.up-next-title-group {
  display: flex;
  align-items: baseline;
  gap: 8px;
}

.up-next-code {
  font-size: 0.95rem;
  font-weight: 700;
  color: #ffffff;
}

.up-next-name {
  font-size: 0.95rem;
  font-weight: 600;
  color: var(--text-main);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  max-width: 280px;
}

.up-next-sub {
  font-size: 0.75rem;
  color: var(--text-secondary);
}

.up-next-action-btn {
  white-space: nowrap;
  padding: 8px 16px;
  font-weight: 600;
  flex-shrink: 0;
}

.all-caught-up-card {
  display: flex;
  align-items: center;
  flex: 1;
  padding: 12px 16px;
  background: rgba(16, 185, 129, 0.08);
  border: 1px solid rgba(16, 185, 129, 0.25);
  border-radius: var(--radius-md);
  font-size: 0.9rem;
  font-weight: 600;
  color: #34d399;
}

.quick-log-toggle-btn {
  white-space: nowrap;
  align-self: center;
}

/* Quick Log Episode Panel */
.quick-log-panel {
  padding: 16px 20px;
  background: #080808;
  border: 1px solid var(--border-subtle);
  border-radius: var(--radius-md);
  margin-bottom: 20px;
}

.quick-log-heading {
  font-size: 1rem;
  font-weight: 700;
  margin-bottom: 4px;
  color: var(--text-main);
}

.quick-log-desc {
  font-size: 0.8rem;
  color: var(--text-secondary);
  margin-bottom: 14px;
}

.quick-log-form {
  display: flex;
  gap: 12px;
  align-items: flex-end;
  flex-wrap: wrap;
}

.quick-log-field {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.quick-log-field label {
  font-size: 0.75rem;
  color: var(--text-muted);
  font-weight: 600;
}

.quick-log-select,
.quick-log-input {
  height: 36px;
  padding: 6px 12px;
  font-size: 0.85rem;
  background: #121212;
}

.ep-title-field {
  flex: 1;
  min-width: 160px;
}

.quick-log-submit-btn {
  height: 36px;
  white-space: nowrap;
}

.season-action-btn {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 8px 14px;
  border-radius: var(--radius-full);
  background: transparent;
  border: 1px dashed var(--border-subtle);
  color: var(--text-muted);
  font-size: 0.8rem;
  font-weight: 500;
  cursor: pointer;
  white-space: nowrap;
  transition: all var(--transition-fast);
}

.season-action-btn:hover {
  border-color: var(--primary);
  color: var(--text-main);
  background: rgba(99, 102, 241, 0.08);
}

.add-episode-bar {
  display: flex;
  justify-content: center;
  margin-top: 16px;
  padding-top: 16px;
  border-top: 1px dashed var(--border-subtle);
}

.add-ep-btn {
  border-style: dashed;
  padding: 8px 18px;
}

/* Season Tabs */
.season-tabs {
  display: flex;
  gap: 8px;
  overflow-x: auto;
  padding-bottom: 8px;
  margin-bottom: 20px;
  scrollbar-width: thin;
}

.season-pill-btn {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  padding: 8px 14px;
  border-radius: var(--radius-full);
  background: #121212;
  border: 1px solid var(--border-subtle);
  color: var(--text-secondary);
  font-size: 0.85rem;
  font-weight: 500;
  cursor: pointer;
  white-space: nowrap;
  transition: all var(--transition-fast);
}

.season-pill-btn:hover {
  border-color: var(--border-hover);
  color: var(--text-main);
  background: #1a1a1a;
}

.season-pill-btn.active {
  background: var(--primary);
  color: var(--text-inverse);
  border-color: var(--primary);
  font-weight: 600;
}

.season-pill-count {
  font-size: 0.7rem;
  opacity: 0.8;
}

/* Season Progress */
.season-progress-panel {
  background: #000000;
  border: 1px solid var(--border-subtle);
  border-radius: var(--radius-md);
  padding: 16px;
  margin-bottom: 24px;
}

.progress-info-row {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 12px;
  flex-wrap: wrap;
  gap: 12px;
}

.progress-label-group {
  display: flex;
  align-items: baseline;
  gap: 10px;
  flex-wrap: wrap;
}

.progress-season-name {
  font-size: 0.95rem;
  font-weight: 600;
  color: var(--text-main);
}

.progress-stats {
  font-size: 0.8rem;
  color: var(--text-secondary);
}

.progress-bar-track {
  width: 100%;
  height: 6px;
  background: #1a1a1a;
  border-radius: var(--radius-full);
  overflow: hidden;
}

.progress-bar-fill {
  height: 100%;
  background: #10b981;
  transition: width 0.3s var(--ease-spring);
}

/* Episode Cards List */
.episodes-list {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.episode-card {
  display: grid;
  grid-template-columns: 140px 1fr auto;
  gap: 16px;
  background: #000000;
  border: 1px solid var(--border-subtle);
  border-radius: var(--radius-md);
  padding: 14px;
  align-items: start;
  transition: all var(--transition-fast);
}

.episode-card:hover {
  border-color: var(--border-hover);
}

.episode-card.watched {
  border-color: rgba(16, 185, 129, 0.25);
  background: rgba(16, 185, 129, 0.02);
}

.episode-card.is-target-episode {
  border-color: rgba(99, 102, 241, 0.6);
  box-shadow: 0 0 0 1px rgba(99, 102, 241, 0.4);
  background: rgba(99, 102, 241, 0.05);
}

/* Thumbnail Box */
.ep-thumbnail-box {
  position: relative;
  width: 140px;
  aspect-ratio: 16 / 9;
  border-radius: var(--radius-sm);
  overflow: hidden;
  background: #141414;
  flex-shrink: 0;
}

.ep-thumbnail-img {
  width: 100%;
  height: 100%;
  object-fit: cover;
  display: block;
}

.ep-thumbnail-fallback {
  width: 100%;
  height: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 0.85rem;
  color: var(--text-muted);
  font-weight: 600;
}

.ep-code-chip {
  position: absolute;
  bottom: 4px;
  left: 4px;
  background: rgba(0, 0, 0, 0.85);
  color: #ededed;
  font-size: 0.65rem;
  padding: 2px 5px;
  border-radius: var(--radius-xs);
  backdrop-filter: blur(4px);
}

/* Body */
.ep-body {
  min-width: 0;
}

.ep-title-row {
  display: flex;
  align-items: baseline;
  gap: 8px;
  margin-bottom: 6px;
}

.ep-title {
  font-size: 0.95rem;
  font-weight: 600;
  color: var(--text-main);
  line-height: 1.3;
}

.ep-meta-row {
  display: flex;
  gap: 8px;
  font-size: 0.75rem;
  color: var(--text-muted);
  margin-bottom: 8px;
  flex-wrap: wrap;
  align-items: center;
}

.ep-rating-badge {
  color: #f5a623;
}

.user-score-badge {
  color: #10b981;
  background: rgba(16, 185, 129, 0.1);
  padding: 1px 6px;
  border-radius: var(--radius-xs);
}

.ep-summary {
  font-size: 0.8rem;
  color: var(--text-secondary);
  line-height: 1.45;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
}

.ep-summary.expanded {
  display: block;
  -webkit-line-clamp: unset;
}

.ep-more-btn {
  background: none;
  border: none;
  color: var(--text-muted);
  font-size: 0.75rem;
  cursor: pointer;
  padding: 2px 0;
  margin-top: 4px;
  text-decoration: underline;
}

.ep-more-btn:hover {
  color: var(--text-main);
}

/* Actions */
.ep-actions {
  display: flex;
  flex-direction: column;
  align-items: flex-end;
  gap: 8px;
  position: relative;
}

.ep-watch-toggle-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 100px;
  padding: 8px 14px;
  font-size: 0.85rem;
  font-weight: 600;
  border-radius: var(--radius-full);
  border: 1px solid var(--border-subtle);
  background: #141414;
  color: var(--text-secondary);
  cursor: pointer;
  transition: all var(--transition-fast);
}

.ep-watch-toggle-btn:hover {
  border-color: var(--border-hover);
  color: var(--text-main);
  background: #1c1c1c;
}

.ep-watch-toggle-btn.watched {
  background: #10b981;
  color: #000000;
  border-color: #10b981;
}

.ep-watch-toggle-btn.watched:hover {
  background: #059669;
  border-color: #059669;
}

.ep-rate-btn {
  background: none;
  border: 1px solid var(--border-subtle);
  color: var(--text-secondary);
  border-radius: var(--radius-sm);
  padding: 4px 8px;
  font-size: 0.75rem;
  cursor: pointer;
  transition: all var(--transition-fast);
}

.ep-rate-btn:hover {
  border-color: var(--border-hover);
  color: #f5a623;
}

.ep-rating-popover {
  position: absolute;
  top: 100%;
  right: 0;
  margin-top: 6px;
  background: #111111;
  border: 1px solid var(--border-subtle);
  border-radius: var(--radius-md);
  padding: 12px;
  z-index: 10;
  box-shadow: var(--shadow-md);
  min-width: 220px;
}

.popover-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 8px;
}

.popover-title {
  font-size: 0.75rem;
  font-weight: 600;
  color: var(--text-main);
}

.popover-close {
  background: none;
  border: none;
  color: var(--text-muted);
  cursor: pointer;
  font-size: 0.8rem;
}

/* Skeleton Loading */
.tracker-loading {
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.season-tabs-skeleton {
  display: flex;
  gap: 8px;
}

.skeleton-pill {
  width: 90px;
  height: 34px;
  background: #141414;
  border-radius: var(--radius-full);
  animation: pulse 1.5s infinite;
}

.episodes-list-skeleton {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.skeleton-ep-row {
  height: 80px;
  background: #121212;
  border-radius: var(--radius-md);
  animation: pulse 1.5s infinite;
}

@keyframes pulse {
  0%, 100% { opacity: 0.6; }
  50% { opacity: 0.3; }
}

/* Responsive */
@media (max-width: 640px) {
  .episodes-tracker-section {
    padding: 16px;
  }

  .tracker-header {
    flex-direction: column;
    align-items: flex-start;
    gap: 6px;
  }

  .tracker-hero-bar {
    flex-direction: column;
    gap: 10px;
  }

  .up-next-card {
    min-width: 100%;
    flex-direction: column;
    align-items: stretch;
    gap: 12px;
  }

  .up-next-name {
    max-width: 100%;
  }

  .up-next-action-btn {
    width: 100%;
    justify-content: center;
  }

  .quick-log-toggle-btn {
    width: 100%;
    justify-content: center;
  }

  .quick-log-panel {
    padding: 14px;
  }

  .quick-log-form {
    flex-direction: column;
    align-items: stretch;
    gap: 10px;
  }

  .quick-log-field {
    width: 100%;
  }

  .quick-log-submit-btn {
    width: 100%;
    justify-content: center;
  }

  .progress-info-row {
    flex-direction: column;
    align-items: flex-start;
    gap: 10px;
  }

  .progress-actions {
    width: 100%;
  }

  .progress-actions .batch-btn {
    width: 100%;
    justify-content: center;
  }

  .episode-card {
    grid-template-columns: 1fr;
    gap: 12px;
    padding: 14px;
  }

  .ep-thumbnail-box {
    width: 100%;
    aspect-ratio: 16 / 9;
  }

  .ep-actions {
    flex-direction: row;
    justify-content: space-between;
    width: 100%;
  }

  .ep-watch-toggle-btn {
    flex: 1;
    min-height: 40px;
  }

  .season-tabs {
    scrollbar-width: none;
    -webkit-overflow-scrolling: touch;
    width: 100%;
    max-width: 100%;
  }

  .season-tabs::-webkit-scrollbar {
    display: none;
  }
}
</style>
