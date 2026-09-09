<script setup>
import { ref, computed, onMounted, watch } from 'vue'
import { useRoute } from 'vue-router'
import { useAuthStore } from '@/stores/auth.js'
import { useMediaStore } from '@/stores/media.js'
import { resolveIpfsUrl } from '@/services/originless.js'
import { buildDTag } from '@/utils/contentId.js'
import { safeMediaUrl } from '@/utils/urls.js'
import { formatRelativeTime, formatStatus, getStatusColorClass } from '@/utils/formatters.js'
import { getTmdbDetails } from '@/services/api/tmdb.js'
import RatingInput from '@/components/RatingInput.vue'
import StatusPicker from '@/components/StatusPicker.vue'
import ReviewModal from '@/components/ReviewModal.vue'
import SeedMetadataModal from '@/components/SeedMetadataModal.vue'

const route = useRoute()
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

const showReviewModal = ref(false)
const showSeedModal = ref(false)
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
    authStore.openLoginModal()
    return
  }
  showReviewModal.value = true
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
    authStore.openLoginModal()
    return
  }
  showSeedModal.value = true
}

function copyContentId() {
  if (!contentId.value) return
  navigator.clipboard?.writeText(contentId.value)?.catch?.(() => {})
  copied.value = true
  setTimeout(() => {
    copied.value = false
  }, 2000)
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

    <!-- Modals -->
    <ReviewModal
      v-if="showReviewModal"
      :media="media"
      :initial-rating="userRating"
      @close="showReviewModal = false"
    />

    <SeedMetadataModal
      v-if="showSeedModal"
      :media="media"
      @close="showSeedModal = false"
    />
  </div>
</template>

<style scoped>
.media-detail-view {
  position: relative;
  margin-top: -24px;
  animation: viewEntrance 0.5s var(--ease-spring) both;
}

@keyframes viewEntrance {
  from {
    opacity: 0;
    transform: translateY(18px);
  }
  to {
    opacity: 1;
    transform: translateY(0);
  }
}

/* Ambient Cinematic Backdrop with Breathing Parallax */
.backdrop-banner {
  position: relative;
  width: 100%;
  height: 380px;
  background-size: cover;
  background-position: center;
  background-color: var(--bg-surface);
  overflow: hidden;
}

.backdrop-banner::before {
  content: '';
  position: absolute;
  inset: -10px;
  background-image: inherit;
  background-size: cover;
  background-position: center;
  filter: blur(2px);
  animation: backdropBreathe 20s ease-in-out infinite alternate;
}

@keyframes backdropBreathe {
  0% {
    transform: scale(1) translateY(0);
  }
  100% {
    transform: scale(1.08) translateY(-8px);
  }
}

.backdrop-gradient {
  position: absolute;
  inset: 0;
  background: linear-gradient(
    to bottom,
    rgba(9, 11, 16, 0.3) 0%,
    rgba(9, 11, 16, 0.75) 60%,
    var(--bg-app) 100%
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
  grid-template-columns: 290px 1fr;
  gap: 40px;
}

@media (max-width: 880px) {
  .detail-grid {
    grid-template-columns: 1fr;
    gap: 28px;
  }
}

/* 3D Floating Poster Card */
.poster-card {
  aspect-ratio: 2 / 3;
  border-radius: var(--radius-lg);
  overflow: hidden;
  box-shadow: 0 24px 50px -10px rgba(0, 0, 0, 0.8), 0 0 35px var(--primary-glow);
  border: 1px solid rgba(139, 92, 246, 0.3);
  background: var(--bg-card);
  transition: transform 0.4s var(--ease-spring), box-shadow 0.4s var(--ease-spring);
  position: relative;
}

.poster-card:hover {
  transform: translateY(-8px) scale(1.02);
  box-shadow: 0 32px 65px -10px rgba(0, 0, 0, 0.9), 0 0 45px rgba(139, 92, 246, 0.55);
}

.poster-img {
  width: 100%;
  height: 100%;
  object-fit: cover;
  transition: transform 0.5s var(--ease-spring);
}

.poster-card:hover .poster-img {
  transform: scale(1.04);
}

.poster-placeholder {
  width: 100%;
  height: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 3.5rem;
  background: linear-gradient(135deg, var(--bg-surface), var(--bg-card-hover));
}

/* IPFS Seed Box */
.seed-box {
  margin-top: 24px;
  padding: 16px;
  background: var(--bg-surface);
  border-radius: var(--radius-md);
  border: 1px solid var(--border-subtle);
  transition: border-color 0.25s ease, box-shadow 0.25s var(--ease-spring);
}

.seed-box:hover {
  border-color: rgba(16, 185, 129, 0.4);
  box-shadow: 0 0 20px rgba(16, 185, 129, 0.15);
}

.seed-header {
  display: flex;
  align-items: center;
  gap: 8px;
  font-weight: 700;
  font-size: 0.9rem;
  margin-bottom: 6px;
}

.seed-icon {
  font-size: 1.2rem;
  animation: seedPulse 2.5s infinite alternate;
}

@keyframes seedPulse {
  0% {
    transform: scale(1);
  }
  100% {
    transform: scale(1.18);
  }
}

.seed-desc {
  font-size: 0.82rem;
  color: var(--text-secondary);
  line-height: 1.45;
  margin-bottom: 14px;
}

.seed-btn {
  width: 100%;
  font-weight: 600;
}

.header-badges {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  margin-bottom: 14px;
}

.media-title {
  font-size: clamp(2.1rem, 4.2vw, 3.1rem);
  font-weight: 800;
  letter-spacing: -0.03em;
  line-height: 1.12;
  margin-bottom: 8px;
  background: linear-gradient(135deg, #ffffff 40%, var(--primary) 90%, #ec4899 100%);
  -webkit-background-clip: text;
  -webkit-text-fill-color: transparent;
  text-shadow: 0 0 40px rgba(139, 92, 246, 0.15);
}

[data-theme='light'] .media-title {
  background: linear-gradient(135deg, #0f172a 40%, var(--primary) 90%);
  -webkit-background-clip: text;
  -webkit-text-fill-color: transparent;
}

.media-artist {
  font-size: 1.25rem;
  color: var(--text-secondary);
  font-weight: 600;
  margin-bottom: 12px;
}

.contentid-row {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-bottom: 26px;
  flex-wrap: wrap;
}

/* Glassmorphism Interactive Action Panel */
.action-panel {
  padding: 24px;
  margin-bottom: 34px;
  background: rgba(22, 27, 42, 0.78);
  backdrop-filter: blur(16px);
  -webkit-backdrop-filter: blur(16px);
  border: 1px solid rgba(139, 92, 246, 0.28);
  border-radius: var(--radius-lg);
  box-shadow: 0 12px 35px rgba(0, 0, 0, 0.45), 0 0 24px rgba(139, 92, 246, 0.15);
  transition: border-color 0.3s ease, box-shadow 0.3s var(--ease-spring);
}

.action-panel:hover {
  border-color: rgba(139, 92, 246, 0.5);
  box-shadow: 0 16px 45px rgba(0, 0, 0, 0.55), 0 0 32px rgba(139, 92, 246, 0.25);
}

.action-row {
  display: flex;
  gap: 28px;
  flex-wrap: wrap;
  margin-bottom: 20px;
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
  font-size: 0.8rem;
  font-weight: 700;
  color: var(--text-secondary);
  text-transform: uppercase;
  letter-spacing: 0.05em;
}

.action-buttons-row {
  display: flex;
  gap: 12px;
  padding-top: 18px;
  border-top: 1px solid rgba(255, 255, 255, 0.08);
  flex-wrap: wrap;
}

.section-heading {
  font-size: 1.25rem;
  font-weight: 700;
  margin-bottom: 14px;
  display: flex;
  align-items: center;
  gap: 10px;
}

.count-badge {
  font-size: 0.8rem;
  background: var(--bg-surface);
  border: 1px solid var(--border-subtle);
  padding: 2px 9px;
  border-radius: var(--radius-full);
  color: var(--text-secondary);
}

.overview-section {
  margin-bottom: 34px;
}

.overview-text {
  font-size: 0.98rem;
  color: var(--text-secondary);
  line-height: 1.65;
  margin-bottom: 16px;
}

.genres-row {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
}

.community-section {
  margin-bottom: 40px;
}

.empty-community {
  padding: 28px;
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
  font-size: 2.2rem;
}

.checkin-inline {
  margin-top: 14px;
  padding-top: 14px;
  border-top: 1px dashed var(--border-subtle);
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.checkin-inline .error-banner {
  display: block;
  padding: 8px 12px;
}

.checkin-fields {
  display: grid;
  grid-template-columns: 1fr 1fr 2fr;
  gap: 10px;
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
  transition: opacity 0.25s ease, transform 0.25s ease;
}

.expand-enter-from,
.expand-leave-to {
  opacity: 0;
  transform: translateY(-6px);
}

.reviews-list {
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.review-card {
  padding: 18px;
  transition: transform 0.3s var(--ease-spring), border-color 0.25s ease, box-shadow 0.3s var(--ease-spring);
}

.review-card:hover {
  transform: translateY(-3px);
  border-color: var(--border-hover);
  box-shadow: 0 10px 24px rgba(0, 0, 0, 0.35);
}

.review-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 10px;
}

.review-author {
  display: flex;
  align-items: center;
  gap: 10px;
}

.review-rating {
  font-weight: 800;
  color: var(--accent-amber);
  font-size: 0.95rem;
}

.review-time {
  font-size: 0.78rem;
  color: var(--text-muted);
}

.spoiler-tag {
  margin-bottom: 10px;
}

.review-content {
  font-size: 0.93rem;
  line-height: 1.55;
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
  padding: 12px 16px;
  background: var(--bg-surface);
  border: 1px solid var(--border-subtle);
  border-radius: var(--radius-md);
  font-size: 0.86rem;
  transition: transform 0.25s var(--ease-spring), border-color 0.2s ease;
}

.activity-log-item:hover {
  transform: translateX(4px);
  border-color: var(--border-hover);
}

.activity-progress {
  font-family: var(--font-mono);
  color: var(--accent-sky);
  font-weight: 700;
}

.activity-user {
  color: var(--text-muted);
}

.activity-note {
  color: var(--text-secondary);
  font-style: italic;
}

.activity-date {
  margin-left: auto;
  font-size: 0.78rem;
  color: var(--text-muted);
}

.badge-tmdb-score {
  background: rgba(245, 158, 11, 0.15);
  color: var(--accent-amber);
  border: 1px solid rgba(245, 158, 11, 0.35);
  font-weight: 700;
}

.badge-source {
  background: rgba(56, 189, 248, 0.12);
  color: var(--accent-sky);
  border: 1px solid rgba(56, 189, 248, 0.28);
  font-size: 0.72rem;
  letter-spacing: 0.02em;
}

.media-tagline {
  font-style: italic;
  color: var(--text-secondary);
  font-size: 1.08rem;
  margin-bottom: 8px;
  line-height: 1.4;
}

.media-director {
  font-size: 0.9rem;
  color: var(--text-secondary);
  margin-bottom: 14px;
}

.cast-section {
  margin-bottom: 34px;
}

.cast-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(130px, 1fr));
  gap: 14px;
}

.cast-card {
  display: flex;
  flex-direction: column;
  align-items: center;
  text-align: center;
  padding: 12px 10px;
  background: var(--bg-surface);
  border-radius: var(--radius-md);
  border: 1px solid var(--border-subtle);
  transition: transform 0.3s var(--ease-spring), border-color 0.25s ease, box-shadow 0.3s var(--ease-spring);
}

.cast-card:hover {
  transform: translateY(-5px);
  border-color: var(--primary);
  box-shadow: 0 10px 24px rgba(0, 0, 0, 0.35), 0 0 16px var(--primary-light);
}

.cast-photo {
  width: 64px;
  height: 64px;
  border-radius: 50%;
  object-fit: cover;
  margin-bottom: 10px;
  border: 2px solid var(--border-hover);
  transition: transform 0.3s var(--ease-spring), border-color 0.3s ease;
}

.cast-card:hover .cast-photo {
  transform: scale(1.08);
  border-color: var(--primary);
}

.cast-photo-fallback {
  width: 64px;
  height: 64px;
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 1.6rem;
  background: var(--bg-card);
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
  font-weight: 700;
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
