<script setup>
import { ref, computed, onMounted, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useAuthStore } from '@/stores/auth.js'
import { useMediaStore } from '@/stores/media.js'
import { resolveIpfsUrl } from '@/services/originless.js'
import { buildDTag } from '@/utils/contentId.js'
import { safeMediaUrl } from '@/utils/urls.js'
import { formatRelativeTime, formatStatus, getStatusColorClass } from '@/utils/formatters.js'
import { getTmdbDetails } from '@/services/api/tmdb.js'
import RatingInput from '@/components/RatingInput.vue'
import StatusPicker from '@/components/StatusPicker.vue'

const route = useRoute()
const router = useRouter()
const authStore = useAuthStore()
const mediaStore = useMediaStore()

const contentId = computed(() => route.params.contentId)
// Route IDs that aren't 64-hex can never match a Nostr record — fail fast
// instead of querying relays with garbage.
const isValidContentId = computed(() => /^[0-9a-f]{64}$/i.test(contentId.value || ''))

const media = ref({
  contentId: contentId.value,
  type: route.query.type || 'movie',
  title: route.query.title || 'Loading...',
  name: route.query.title || 'Loading...',
  year: route.query.year || '',
  artist: route.query.artist || '',
  overview: '',
  poster: '',
  banner: '',
  genres: [],
  tagline: '',
  voteAverage: null,
  runtime: null,
  director: '',
  network: '',
  cast: [],
  sources: [],
})

const copied = ref(false)

// Inline check-in / scrobble panel state
const showCheckIn = ref(false)
const checkInStatus = ref('watching')
const checkInProgress = ref('')
const checkInNote = ref('')
const isLoggingCheckIn = ref(false)
const checkInError = ref('')

// User's current tracking status (Kind 35402)
const userStatus = computed(() => {
  return mediaStore.getMediaStatus(contentId.value)
})

// User's current rating (Kind 35400)
const userRating = computed(() => {
  return mediaStore.getMediaRating(contentId.value)
})

// Community metadata (Kind 35403)
const communityMeta = computed(() => {
  return mediaStore.getMediaMetadata(contentId.value)
})

// Reviews for this media (Kind 5401)
const mediaReviews = computed(() => {
  return mediaStore.getReviewsForMedia(contentId.value)
})

// Scrobbles / Check-ins for this media (Kind 5402)
const mediaActivity = computed(() => {
  return mediaStore.getActivityForMedia(contentId.value)
})

const effectivePoster = computed(() => {
  const raw = communityMeta.value?.poster || media.value.poster || ''
  return safeMediaUrl(resolveIpfsUrl(raw))
})

const effectiveBanner = computed(() => {
  const raw = communityMeta.value?.banner || media.value.banner || ''
  const safe = safeMediaUrl(resolveIpfsUrl(raw))
  return safe ? `url("${safe}")` : ''
})

function safeImg(url) {
  return safeMediaUrl(url)
}

let loadToken = 0 // latest navigation wins; stale responses are discarded

onMounted(async () => {
  if (!isValidContentId.value) return
  await loadMediaData()
  // Fetch Nostr state for this contentId
  mediaStore.fetchMediaDetails(contentId.value)
})

watch(() => route.params.contentId, async () => {
  if (!isValidContentId.value) return
  await loadMediaData()
  mediaStore.fetchMediaDetails(contentId.value)
})

async function loadMediaData() {
  const myToken = ++loadToken
  // Check if we already have it in media library store
  const stored = mediaStore.mediaLibrary[contentId.value]
  if (stored) {
    media.value = { ...media.value, ...stored }
  }

  // Fetch Multi-Source Rich Details (TMDB + TVMaze) for movies & shows
  const mediaType = media.value.type || route.query.type || 'movie'
  const mediaTitle = media.value.title || route.query.title || ''
  const mediaYear = media.value.year || route.query.year || ''

  if (['movie', 'show'].includes(mediaType) && mediaTitle && mediaTitle !== 'Loading...') {
    try {
      const richDetails = await getTmdbDetails(
        mediaType,
        stored?.tmdbId || stored?.id,
        mediaTitle,
        mediaYear
      )
      if (myToken !== loadToken) return // stale navigation — discard
      if (richDetails) {
        media.value = {
          ...media.value,
          ...richDetails,
          contentId: contentId.value,
          title: richDetails.title || media.value.title,
          name: richDetails.title || media.value.name,
          poster: richDetails.poster || media.value.poster,
          banner: richDetails.banner || media.value.banner,
          overview: richDetails.overview || media.value.overview,
          genres: richDetails.genres?.length ? richDetails.genres : media.value.genres,
        }
        mediaStore.cacheMediaItem(media.value)
      }
    } catch (err) {
      console.warn('Failed to load rich multi-source details:', err)
    }
  }
}

async function handleStatusChange(newStatus) {
  if (!authStore.isAuthenticated) {
    authStore.openLoginModal()
    return
  }

  try {
    if (!newStatus) {
      // Toggle-off = untrack: NIP-09 deletion of the viewer's status address.
      if (userStatus.value?.dTag) {
        await mediaStore.deleteTrackstrEvent({
          coordinate: `35402:${authStore.pubkey}:${userStatus.value.dTag}`,
          reason: 'Untracked by user',
        })
      }
      return
    }
    await mediaStore.setStatus(media.value, newStatus)
  } catch (err) {
    console.error('Failed to update status:', err)
  }
}

async function handleRatingChange(newRating) {
  if (!authStore.isAuthenticated) {
    authStore.openLoginModal()
    return
  }

  try {
    if (newRating === null) {
      // Rating cleared = NIP-09 deletion of the viewer's rating address.
      if (userRating.value !== null && userRating.value !== undefined) {
        await mediaStore.deleteTrackstrEvent({
          coordinate: `35400:${authStore.pubkey}:${buildDTag({ contentId: contentId.value })}`,
          reason: 'Rating cleared by user',
        })
      }
      return
    }
    await mediaStore.setRating(media.value, newRating)
  } catch (err) {
    console.error('Failed to submit rating:', err)
  }
}

function openReviewModal() {
  if (!authStore.isAuthenticated) {
    authStore.openLoginModal(`/media/${contentId.value}/review`)
    return
  }
  router.push({
    name: 'write-review',
    params: { contentId: contentId.value },
    query: {
      title: media.value.title || media.value.name,
      year: media.value.year,
      type: media.value.type,
      artist: media.value.artist,
    },
  })
}

function openCheckInModal() {
  showCheckIn.value = !showCheckIn.value
  if (showCheckIn.value) {
    checkInStatus.value = media.value.type === 'music' ? 'listening' : 'watching'
    checkInError.value = ''
  }
}

/**
 * Parses "S01E03" / "s1e3" into numbers so episode check-ins land on the
 * addressable episode d-tag instead of clobbering the parent show.
 */
function parseEpisodeProgress(text) {
  const m = /^\s*s?(\d{1,2})\s*e\s*(\d{1,3})\s*$/i.exec(text || '')
  if (!m) return null
  return { season: Number(m[1]), episode: Number(m[2]) }
}

async function submitCheckIn() {
  if (!authStore.isAuthenticated) {
    authStore.openLoginModal()
    return
  }
  isLoggingCheckIn.value = true
  checkInError.value = ''
  try {
    let entry = media.value
    let progressText = checkInProgress.value
    if (media.value.type === 'show') {
      const ep = parseEpisodeProgress(checkInProgress.value)
      if (ep) {
        entry = { ...media.value, type: 'episode', season: ep.season, episode: ep.episode }
        progressText = `s${ep.season}e${ep.episode}`
      }
    }
    await mediaStore.setStatus(entry, checkInStatus.value, progressText, checkInNote.value)
    showCheckIn.value = false
    checkInProgress.value = ''
    checkInNote.value = ''
  } catch (err) {
    checkInError.value = err.message || 'Failed to log check-in to Nostr.'
  } finally {
    isLoggingCheckIn.value = false
  }
}

function openSeedModal() {
  if (!authStore.isAuthenticated) {
    authStore.openLoginModal(`/media/${contentId.value}/seed`)
    return
  }
  router.push({
    name: 'seed-metadata',
    params: { contentId: contentId.value },
    query: {
      title: media.value.title || media.value.name,
      year: media.value.year,
      type: media.value.type,
      artist: media.value.artist,
    },
  })
}

function copyContentId() {
  if (!contentId.value) return
  navigator.clipboard?.writeText(contentId.value)?.catch?.(() => {})
  copied.value = true
  setTimeout(() => {
    copied.value = false
  }, 2000)
}

function goBack() {
  if (window.history.length > 1) {
    router.back()
  } else {
    router.push('/')
  }
}
</script>

<template>
  <div v-if="!isValidContentId" class="empty-community card invalid-id">
    <div class="empty-icon">⚠️</div>
    <h3>Invalid media ID</h3>
    <p>This link doesn't point to a valid Trackstr media record.</p>
    <router-link to="/" class="btn btn-primary btn-sm">Back to Explore</router-link>
  </div>
  <div v-else class="media-detail-view">
    <!-- Floating Native Back Button -->
    <button
      class="back-nav-btn"
      type="button"
      title="Back to previous page"
      @click="goBack"
    >
      <span class="back-icon">‹</span>
      <span class="back-text">Back</span>
    </button>

    <!-- Banner Backdrop -->
    <div
      class="backdrop-banner"
      :style="effectiveBanner ? { backgroundImage: effectiveBanner } : {}"
    >
      <div class="backdrop-gradient"></div>
    </div>

    <!-- Main Media Details -->
    <div class="detail-container">
      <div class="detail-grid">
        <!-- Poster Column -->
        <div class="poster-col">
          <div class="poster-card">
            <img
              v-if="effectivePoster"
              :src="effectivePoster"
              :alt="media.title || media.name"
              class="poster-img"
            />
            <div v-else class="poster-placeholder">
              <span v-if="media.type === 'movie'">🎬</span>
              <span v-else-if="media.type === 'show'">📺</span>
              <span v-else>🎵</span>
            </div>
          </div>

          <!-- Quick Seed to Nostr Prompt (Per AGENTS.md bootstrapping) -->
          <div class="seed-box card">
            <div class="seed-header">
              <span class="seed-icon">🌱</span>
              <span class="seed-title">IPFS Metadata (Originless)</span>
            </div>
            <p v-if="communityMeta?.poster" class="seed-desc">
              Pinned on IPFS: <span class="contentid-chip">{{ communityMeta.poster.slice(0, 16) }}...</span>
            </p>
            <p v-else class="seed-desc">
              No decentralized metadata event (Kind 35403) on relays yet.
            </p>
            <button
              class="btn btn-outline btn-sm seed-btn"
              type="button"
              @click="openSeedModal"
            >
              {{ communityMeta ? 'Update Nostr Metadata' : 'Seed to Nostr (Originless)' }}
            </button>
          </div>
        </div>

        <!-- Info Column -->
        <div class="info-col">
          <div class="header-badges">
            <span class="badge badge-primary">{{ media.type }}</span>
            <span v-if="media.year" class="badge badge-neutral">{{ media.year }}</span>
            <span v-if="media.voteAverage" class="badge badge-tmdb-score" title="TMDB Community Score">
              ★ {{ media.voteAverage }} TMDB
            </span>
            <span v-if="media.runtime" class="badge badge-neutral">
              {{ media.runtime }} min
            </span>
            <span v-if="media.network" class="badge badge-neutral">
              {{ media.network }}
            </span>
            <span v-if="media.seasons" class="badge badge-neutral">
              {{ media.seasons }} Seasons ({{ media.episodes }} eps)
            </span>
            <span v-if="userStatus" class="badge" :class="getStatusColorClass(userStatus.status)">
              {{ formatStatus(userStatus.status) }}
            </span>
            <!-- Multi-Source Badges -->
            <span
              v-for="src in (media.sources || [])"
              :key="src"
              class="badge badge-source"
              :title="`Data enriched from ${src}`"
            >
              {{ src }}
            </span>
          </div>

          <h1 class="media-title">{{ media.title || media.name }}</h1>
          <p v-if="media.tagline" class="media-tagline">"{{ media.tagline }}"</p>
          <h3 v-if="media.artist" class="media-artist">by {{ media.artist }}</h3>
          <p v-if="media.director" class="media-director">
            Director: <strong>{{ media.director }}</strong>
          </p>

          <!-- Canonical Content ID Chip -->
          <div class="contentid-row">
            <span class="contentid-chip" title="Byte-exact canonical SHA-256 Content ID">
              ID: {{ contentId }}
            </span>
            <button class="btn btn-icon btn-sm" type="button" @click="copyContentId">
              {{ copied ? '✓ Copied' : '📋 Copy' }}
            </button>
          </div>

          <!-- Interactive Tracking Action Bar -->
          <div class="action-panel card">
            <div class="action-row">
              <div class="action-item">
                <span class="action-label">Your Status (Kind 35402)</span>
                <StatusPicker
                  :model-value="userStatus?.status || ''"
                  :media-type="media.type"
                  @change="handleStatusChange"
                />
              </div>

              <div class="action-item">
                <span class="action-label">Your Score (Kind 35400)</span>
                <RatingInput
                  :model-value="userRating"
                  @change="handleRatingChange"
                />
              </div>
            </div>

            <div class="action-buttons-row">
              <button
                class="btn btn-secondary"
                type="button"
                :aria-expanded="showCheckIn"
                @click="openCheckInModal"
              >
                ⏱️ Log Check-in / Scrobble
              </button>
              <button class="btn btn-primary" type="button" @click="openReviewModal">
                ✍️ Write Review
              </button>
            </div>

            <transition name="expand">
              <div v-if="showCheckIn" class="checkin-inline">
                <div v-if="checkInError" class="badge badge-danger error-banner">
                  {{ checkInError }}
                </div>
                <div class="checkin-fields">
                  <label class="checkin-field">
                    <span class="action-label">Activity</span>
                    <select v-model="checkInStatus" class="select">
                      <option v-if="media.type === 'music'" value="listening">Listening Now</option>
                      <option v-if="media.type === 'music'" value="completed">Finished Album / Track</option>
                      <option v-if="media.type !== 'music'" value="watching">Watching Now</option>
                      <option v-if="media.type !== 'music'" value="completed">Finished Watching</option>
                    </select>
                  </label>
                  <label v-if="media.type === 'show'" class="checkin-field">
                    <span class="action-label">Progress (S01E03)</span>
                    <input v-model="checkInProgress" type="text" class="input" placeholder="e.g. S01E03" />
                  </label>
                  <label class="checkin-field checkin-note">
                    <span class="action-label">Note (Optional)</span>
                    <input v-model="checkInNote" type="text" class="input" placeholder="e.g. Rewatched in 4K" />
                  </label>
                </div>
                <p class="form-hint">
                  Emits a Mutable Status update (Kind 35402) and an Immutable check-in log (Kind 5402).
                </p>
                <div class="checkin-actions">
                  <button class="btn btn-secondary btn-sm" type="button" @click="showCheckIn = false">
                    Cancel
                  </button>
                  <button
                    class="btn btn-primary btn-sm"
                    type="button"
                    :disabled="isLoggingCheckIn"
                    @click="submitCheckIn"
                  >
                    {{ isLoggingCheckIn ? 'Logging...' : 'Sign & Log Check-in' }}
                  </button>
                </div>
              </div>
            </transition>
          </div>

          <!-- Overview / Synopsis -->
          <div class="overview-section">
            <h3 class="section-heading">Overview</h3>
            <p class="overview-text">
              {{ communityMeta?.overview || media.overview || 'No synopsis provided yet.' }}
            </p>

            <div v-if="(communityMeta?.genres || media.genres || []).length > 0" class="genres-row">
              <span
                v-for="g in (communityMeta?.genres || media.genres)"
                :key="g"
                class="badge badge-neutral"
              >
                {{ g }}
              </span>
            </div>
          </div>

          <!-- Top Cast Section -->
          <div v-if="media.cast && media.cast.length > 0" class="cast-section">
            <h3 class="section-heading">Top Cast</h3>
            <div class="cast-grid">
              <div v-for="actor in media.cast" :key="actor.name" class="cast-card card">
                <img
                  v-if="actor.profile"
                  :src="safeImg(actor.profile)"
                  :alt="actor.name"
                  class="cast-photo"
                  loading="lazy"
                />
                <div v-else class="cast-photo-fallback">👤</div>
                <div class="cast-names">
                  <span class="cast-actor">{{ actor.name }}</span>
                  <span class="cast-char">{{ actor.character }}</span>
                </div>
              </div>
            </div>
          </div>

          <!-- Community Reviews (Kind 5401) -->
          <div class="community-section">
            <div class="community-header">
              <h3 class="section-heading">
                Nostr Reviews (Kind 5401)
                <span class="count-badge">{{ mediaReviews.length }}</span>
              </h3>
            </div>

            <div v-if="mediaReviews.length === 0" class="empty-community card">
              <p>No reviews written for this title on connected relays yet.</p>
              <button class="btn btn-outline btn-sm" type="button" @click="openReviewModal">
                Be the first to review
              </button>
            </div>

            <div v-else class="reviews-list">
              <div v-for="rev in mediaReviews" :key="rev.id" class="review-card card">
                <div class="review-header">
                  <div class="review-author">
                    <span class="contentid-chip">{{ (rev.pubkey || '').slice(0, 8) }}...{{ (rev.pubkey || '').slice(-4) }}</span>
                    <span v-if="rev.rating" class="review-rating">★ {{ rev.rating }}/10</span>
                  </div>
                  <span class="review-time">{{ formatRelativeTime(rev.createdAt) }}</span>
                </div>
                <div v-if="rev.spoiler" class="badge badge-warning spoiler-tag">Contains Spoilers</div>
                <p class="review-content">{{ rev.content }}</p>
              </div>
            </div>
          </div>

          <!-- Scrobbles / Diary (Kind 5402) -->
          <div class="community-section">
            <div class="community-header">
              <h3 class="section-heading">
                Activity Logs & Scrobbles (Kind 5402)
                <span class="count-badge">{{ mediaActivity.length }}</span>
              </h3>
            </div>

            <div v-if="mediaActivity.length === 0" class="empty-community card">
              <p>No activity logs recorded yet for this title.</p>
            </div>

            <div v-else class="activity-list">
              <div v-for="act in mediaActivity" :key="act.id" class="activity-log-item">
                <span class="badge" :class="getStatusColorClass(act.status)">{{ formatStatus(act.status) }}</span>
                <span v-if="act.progress" class="activity-progress">[{{ act.progress }}]</span>
                <span class="activity-user">{{ (act.pubkey || '').slice(0, 8) }}...</span>
                <span v-if="act.content" class="activity-note">"{{ act.content }}"</span>
                <span class="activity-date">{{ formatRelativeTime(act.createdAt) }}</span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.media-detail-view {
  position: relative;
  margin-top: -40px;
}

/* Cinematic Minimal Backdrop */
.backdrop-banner {
  position: relative;
  width: 100%;
  height: 380px;
  background-size: cover;
  background-position: center;
  background-color: #050505;
  overflow: hidden;
}

.backdrop-gradient {
  position: absolute;
  inset: 0;
  background: linear-gradient(
    to bottom,
    rgba(0, 0, 0, 0.25) 0%,
    rgba(0, 0, 0, 0.75) 60%,
    #000000 100%
  );
}

.detail-container {
  max-width: 1240px;
  margin: -140px auto 0;
  padding: 0 24px;
  position: relative;
  z-index: 10;
}

.detail-grid {
  display: grid;
  grid-template-columns: 280px 1fr;
  gap: 48px;
}

@media (max-width: 880px) {
  .backdrop-banner {
    height: 240px;
  }

  .detail-container {
    margin: -90px auto 0;
    padding: 0 16px;
  }

  .detail-grid {
    grid-template-columns: 1fr;
    gap: 28px;
  }

  .poster-col {
    max-width: 220px;
    margin: 0 auto;
  }
}

/* Minimalist Poster Card */
.poster-card {
  aspect-ratio: 2 / 3;
  border-radius: var(--radius-md);
  overflow: hidden;
  box-shadow: var(--shadow-lg);
  border: 1px solid var(--border-subtle);
  background: #0a0a0a;
  position: relative;
}

.poster-img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}

.poster-placeholder {
  width: 100%;
  height: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 3rem;
  background: #0f0f0f;
  color: var(--text-muted);
}

/* IPFS Seed Box */
.seed-box {
  margin-top: 24px;
  padding: 18px;
  background: #0a0a0a;
  border-radius: var(--radius-md);
  border: 1px solid var(--border-subtle);
  transition: border-color var(--transition-fast);
}

.seed-box:hover {
  border-color: var(--border-hover);
}

.seed-header {
  display: flex;
  align-items: center;
  gap: 8px;
  font-weight: 600;
  font-size: 0.88rem;
  margin-bottom: 6px;
}

.seed-icon {
  font-size: 1.1rem;
}

.seed-desc {
  font-size: 0.8rem;
  color: var(--text-secondary);
  line-height: 1.5;
  margin-bottom: 14px;
}

.seed-btn {
  width: 100%;
  font-weight: 500;
}

.header-badges {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  margin-bottom: 16px;
}

.media-title {
  font-size: clamp(2.4rem, 5vw, 3.8rem);
  font-weight: 800;
  letter-spacing: -0.05em;
  line-height: 1.08;
  margin-bottom: 8px;
  color: #ededed;
}

[data-theme='light'] .media-title {
  color: #000000;
}

.media-artist {
  font-size: 1.2rem;
  color: var(--text-secondary);
  font-weight: 500;
  margin-bottom: 12px;
  letter-spacing: -0.02em;
}

.contentid-row {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-bottom: 32px;
  flex-wrap: wrap;
}

/* Minimalist Action Panel */
.action-panel {
  padding: 24px;
  margin-bottom: 40px;
  background: #0a0a0a;
  border: 1px solid var(--border-subtle);
  border-radius: var(--radius-md);
  transition: border-color var(--transition-fast);
}

.action-panel:hover {
  border-color: var(--border-hover);
}

.action-row {
  display: flex;
  gap: 32px;
  flex-wrap: wrap;
  margin-bottom: 24px;
  align-items: flex-start;
}

.action-item {
  display: flex;
  flex-direction: column;
  gap: 10px;
  flex: 1;
  min-width: 240px;
}

.action-label {
  font-family: var(--font-mono);
  font-size: 0.72rem;
  font-weight: 500;
  color: var(--text-muted);
  text-transform: uppercase;
  letter-spacing: 0.05em;
}

.action-buttons-row {
  display: flex;
  gap: 12px;
  padding-top: 20px;
  border-top: 1px solid var(--border-subtle);
  flex-wrap: wrap;
}

@media (max-width: 640px) {
  .action-panel {
    padding: 18px;
  }

  .action-row {
    flex-direction: column;
    gap: 18px;
  }

  .action-item {
    min-width: 100%;
  }

  .action-buttons-row {
    flex-direction: column;
    gap: 10px;
  }

  .action-buttons-row .btn {
    width: 100%;
    justify-content: center;
  }

  .media-title {
    font-size: 2rem;
  }
}

.section-heading {
  font-size: 1.25rem;
  font-weight: 700;
  letter-spacing: -0.03em;
  margin-bottom: 18px;
  display: flex;
  align-items: center;
  gap: 10px;
}

.count-badge {
  font-family: var(--font-mono);
  font-size: 0.72rem;
  background: #141414;
  border: 1px solid var(--border-subtle);
  padding: 2px 8px;
  border-radius: var(--radius-xs);
  color: var(--text-secondary);
}

.overview-section {
  margin-bottom: 40px;
}

.overview-text {
  font-size: 1rem;
  color: var(--text-secondary);
  line-height: 1.7;
  margin-bottom: 20px;
}

.genres-row {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
}

.community-section {
  margin-bottom: 48px;
}

.empty-community {
  padding: 32px;
  text-align: center;
  color: var(--text-secondary);
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 12px;
  border-radius: var(--radius-md);
  border: 1px dashed var(--border-subtle);
  background: var(--bg-surface);
}

.invalid-id {
  max-width: 520px;
  margin: 60px auto;
}

.invalid-id .empty-icon {
  font-size: 2rem;
}

.checkin-inline {
  margin-top: 18px;
  padding-top: 18px;
  border-top: 1px dashed var(--border-subtle);
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.checkin-inline .error-banner {
  display: block;
  padding: 8px 12px;
}

.checkin-fields {
  display: grid;
  grid-template-columns: 1fr 1fr 2fr;
  gap: 12px;
}

@media (max-width: 640px) {
  .checkin-fields {
    grid-template-columns: 1fr;
  }
}

.checkin-field {
  display: flex;
  flex-direction: column;
  gap: 6px;
  min-width: 0;
}

.checkin-actions {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
}

.expand-enter-active,
.expand-leave-active {
  transition: opacity 0.15s ease, transform 0.15s ease;
}

.expand-enter-from,
.expand-leave-to {
  opacity: 0;
  transform: translateY(-4px);
}

.reviews-list {
  display: flex;
  flex-direction: column;
  gap: 14px;
}

.review-card {
  padding: 20px 24px;
  border-radius: var(--radius-md);
  border: 1px solid var(--border-subtle);
  background: var(--bg-card);
  transition: border-color var(--transition-fast);
}

.review-card:hover {
  border-color: var(--border-hover);
}

.review-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 12px;
}

.review-author {
  display: flex;
  align-items: center;
  gap: 10px;
}

.review-rating {
  font-weight: 600;
  color: var(--accent-amber);
  font-size: 0.9rem;
}

.review-time {
  font-size: 0.75rem;
  color: var(--text-muted);
}

.spoiler-tag {
  margin-bottom: 10px;
}

.review-content {
  font-size: 0.93rem;
  line-height: 1.6;
  color: var(--text-main);
  white-space: pre-line;
}

.activity-list {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.activity-log-item {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 14px 18px;
  background: var(--bg-card);
  border: 1px solid var(--border-subtle);
  border-radius: var(--radius-md);
  font-size: 0.86rem;
  transition: border-color var(--transition-fast);
}

.activity-log-item:hover {
  border-color: var(--border-hover);
}

.activity-progress {
  font-family: var(--font-mono);
  color: var(--text-secondary);
  font-size: 0.78rem;
}

.activity-user {
  color: var(--text-muted);
  font-family: var(--font-mono);
  font-size: 0.78rem;
}

.activity-note {
  color: var(--text-secondary);
  font-style: italic;
}

.activity-date {
  margin-left: auto;
  font-size: 0.75rem;
  color: var(--text-muted);
}

@media (max-width: 640px) {
  .activity-log-item {
    flex-wrap: wrap;
    gap: 8px;
  }

  .activity-date {
    width: 100%;
    margin-left: 0;
    font-size: 0.72rem;
  }
}

.badge-tmdb-score {
  background: rgba(245, 166, 35, 0.08);
  color: var(--accent-amber);
  border: 1px solid rgba(245, 166, 35, 0.25);
  font-weight: 600;
}

.badge-source {
  background: #111111;
  color: var(--text-secondary);
  border: 1px solid var(--border-subtle);
  font-size: 0.68rem;
}

.media-tagline {
  font-style: italic;
  color: var(--text-secondary);
  font-size: 1.05rem;
  margin-bottom: 8px;
  line-height: 1.5;
}

.media-director {
  font-size: 0.9rem;
  color: var(--text-secondary);
  margin-bottom: 14px;
}

.cast-section {
  margin-bottom: 40px;
}

.cast-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(130px, 1fr));
  gap: 12px;
}

@media (max-width: 768px) {
  .cast-grid {
    display: flex;
    overflow-x: auto;
    scroll-snap-type: x mandatory;
    gap: 12px;
    padding-bottom: 8px;
    scrollbar-width: none;
  }

  .cast-grid::-webkit-scrollbar {
    display: none;
  }

  .cast-card {
    flex: 0 0 115px;
    scroll-snap-align: start;
  }
}

.cast-card {
  display: flex;
  flex-direction: column;
  align-items: center;
  text-align: center;
  padding: 14px 10px;
  background: var(--bg-card);
  border-radius: var(--radius-md);
  border: 1px solid var(--border-subtle);
  transition: border-color var(--transition-fast);
}

.cast-card:hover {
  border-color: var(--border-hover);
}

.cast-photo {
  width: 56px;
  height: 56px;
  border-radius: 50%;
  object-fit: cover;
  margin-bottom: 10px;
  border: 1px solid var(--border-subtle);
}

.cast-photo-fallback {
  width: 56px;
  height: 56px;
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 1.4rem;
  background: #141414;
  margin-bottom: 10px;
  border: 1px solid var(--border-subtle);
}

.cast-names {
  display: flex;
  flex-direction: column;
  width: 100%;
}

.cast-actor {
  font-size: 0.82rem;
  font-weight: 600;
  color: var(--text-main);
  line-height: 1.25;
}

.cast-char {
  font-size: 0.72rem;
  color: var(--text-muted);
  line-height: 1.2;
  margin-top: 2px;
}
</style>
