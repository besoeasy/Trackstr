<script setup>
import { ref, computed, onMounted, watch } from 'vue'
import { useMediaStore } from '@/stores/media.js'
import { useAuthStore } from '@/stores/auth.js'
import { fetchShowEpisodes } from '@/services/api/tv.js'
import { buildDTag } from '@/utils/contentId.js'
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

// Overall Show Progress across all seasons
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

    const data = await fetchShowEpisodes({
      title,
      tmdbId,
      tvmazeId,
      numberOfSeasons,
    })

    episodesData.value = data
    if (data.seasons.length > 0) {
      // Default to season 1, or the first season in list
      const s1 = data.seasons.find((s) => s.seasonNumber === 1)
      selectedSeasonNumber.value = s1 ? 1 : data.seasons[0].seasonNumber
    }
  } catch (err) {
    console.warn('Failed to load episodes for show:', err)
  } finally {
    isLoading.value = false
  }
}

function isEpisodeWatched(season, episode) {
  const status = mediaStore.getMediaStatus(props.contentId, season, episode)
  return status?.status === 'completed'
}

function getEpisodeRating(season, episode) {
  return mediaStore.getMediaRating(props.contentId, season, episode)
}

function makeEpisodeMedia(ep) {
  return {
    ...props.media,
    contentId: props.contentId,
    type: 'episode',
    season: ep.season,
    episode: ep.episode,
    name: `${props.media.title || props.media.name} - S${ep.season}E${ep.episode}: ${ep.name}`,
    title: `${props.media.title || props.media.name} - S${ep.season}E${ep.episode}: ${ep.name}`,
    year: ep.airDate ? ep.airDate.slice(0, 4) : props.media.year,
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
      <p class="empty-text">No episode list available for this series.</p>
    </div>

    <!-- Loaded Content -->
    <div v-else class="tracker-content">
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
          :class="{ watched: isEpisodeWatched(ep.season, ep.episode) }"
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
  .episode-card {
    grid-template-columns: 1fr;
    gap: 12px;
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
  }
}
</style>
