<script setup>
import { ref, computed, onMounted, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useAuthStore } from '@/stores/auth.js'
import { useMediaStore } from '@/stores/media.js'
import { resolveIpfsUrl } from '@/services/originless.js'
import { computeContentId } from '@/utils/contentId.js'
import { formatRelativeTime, formatStatus, getStatusColorClass } from '@/utils/formatters.js'
import { SAMPLE_MEDIA, getTmdbDetails } from '@/services/api/tmdb.js'
import { SAMPLE_MUSIC } from '@/services/api/musicbrainz.js'
import RatingInput from '@/components/RatingInput.vue'
import StatusPicker from '@/components/StatusPicker.vue'
import ReviewModal from '@/components/ReviewModal.vue'
import CheckInModal from '@/components/CheckInModal.vue'
import SeedMetadataModal from '@/components/SeedMetadataModal.vue'

const route = useRoute()
const router = useRouter()
const authStore = useAuthStore()
const mediaStore = useMediaStore()

const contentId = computed(() => route.params.contentId)

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
const showCheckInModal = ref(false)
const showSeedModal = ref(false)
const copied = ref(false)

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
  if (communityMeta.value?.poster) {
    return resolveIpfsUrl(communityMeta.value.poster)
  }
  return resolveIpfsUrl(media.value.poster)
})

const effectiveBanner = computed(() => {
  if (communityMeta.value?.banner) {
    return resolveIpfsUrl(communityMeta.value.banner)
  }
  return resolveIpfsUrl(media.value.banner)
})

onMounted(async () => {
  await loadMediaData()
  // Fetch Nostr state for this contentId
  mediaStore.fetchMediaDetails(contentId.value)
})

watch(() => route.params.contentId, async () => {
  await loadMediaData()
  mediaStore.fetchMediaDetails(contentId.value)
})

async function loadMediaData() {
  // Check if we already have it in media library store
  const stored = mediaStore.mediaLibrary[contentId.value]
  if (stored) {
    media.value = { ...media.value, ...stored }
  }

  // Look up in sample data
  const sample = [...SAMPLE_MEDIA, ...SAMPLE_MUSIC].find((s) => {
    return s.title.toLowerCase() === (route.query.title || media.value.title || '').toLowerCase()
  })

  if (sample) {
    media.value = {
      ...media.value,
      ...sample,
      contentId: contentId.value,
      title: sample.title,
      name: sample.title,
    }
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
    alert('Please connect your Nostr extension to track status.')
    return
  }
  if (!newStatus) return

  try {
    await mediaStore.setStatus(media.value, newStatus)
  } catch (err) {
    alert(err.message || 'Failed to update status.')
  }
}

async function handleRatingChange(newRating) {
  if (!authStore.isAuthenticated) {
    alert('Please connect your Nostr extension to submit a rating.')
    return
  }
  if (newRating === null) return

  try {
    await mediaStore.setRating(media.value, newRating)
  } catch (err) {
    alert(err.message || 'Failed to submit rating.')
  }
}

function copyContentId() {
  navigator.clipboard.writeText(contentId.value)
  copied.value = true
  setTimeout(() => {
    copied.value = false
  }, 2000)
}
</script>

<template>
  <div class="media-detail-view">
    <!-- Banner Backdrop -->
    <div
      class="backdrop-banner"
      :style="effectiveBanner ? { backgroundImage: `url(${effectiveBanner})` } : {}"
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
              @click="showSeedModal = true"
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
              <button class="btn btn-secondary" type="button" @click="showCheckInModal = true">
                ⏱️ Log Check-in / Scrobble
              </button>
              <button class="btn btn-primary" type="button" @click="showReviewModal = true">
                ✍️ Write Review
              </button>
            </div>
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
                  :src="actor.profile"
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
              <button class="btn btn-outline btn-sm" type="button" @click="showReviewModal = true">
                Be the first to review
              </button>
            </div>

            <div v-else class="reviews-list">
              <div v-for="rev in mediaReviews" :key="rev.id" class="review-card card">
                <div class="review-header">
                  <div class="review-author">
                    <span class="contentid-chip">{{ rev.pubkey.slice(0, 8) }}...{{ rev.pubkey.slice(-4) }}</span>
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
                <span class="activity-user">{{ act.pubkey.slice(0, 8) }}...</span>
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

    <CheckInModal
      v-if="showCheckInModal"
      :media="media"
      @close="showCheckInModal = false"
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
}

.backdrop-banner {
  position: relative;
  width: 100%;
  height: 320px;
  background-size: cover;
  background-position: center;
  background-color: var(--bg-surface);
}

.backdrop-gradient {
  position: absolute;
  inset: 0;
  background: linear-gradient(to bottom, rgba(9, 11, 16, 0.4) 0%, var(--bg-app) 100%);
}

.detail-container {
  max-width: 1200px;
  margin: -120px auto 0;
  padding: 0 20px;
  position: relative;
  z-index: 10;
}

.detail-grid {
  display: grid;
  grid-template-columns: 280px 1fr;
  gap: 36px;
}

@media (max-width: 860px) {
  .detail-grid {
    grid-template-columns: 1fr;
  }
}

.poster-card {
  aspect-ratio: 2 / 3;
  border-radius: var(--radius-md);
  overflow: hidden;
  box-shadow: var(--shadow-lg);
  border: 1px solid var(--border-subtle);
  background: var(--bg-card);
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
}

.seed-box {
  margin-top: 20px;
  padding: 14px;
  background: var(--bg-surface);
}

.seed-header {
  display: flex;
  align-items: center;
  gap: 8px;
  font-weight: 600;
  font-size: 0.88rem;
  margin-bottom: 6px;
}

.seed-desc {
  font-size: 0.8rem;
  color: var(--text-secondary);
  line-height: 1.4;
  margin-bottom: 12px;
}

.seed-btn {
  width: 100%;
}

.header-badges {
  display: flex;
  gap: 8px;
  margin-bottom: 12px;
}

.media-title {
  font-size: 2.4rem;
  font-weight: 800;
  letter-spacing: -0.02em;
  line-height: 1.15;
  margin-bottom: 4px;
}

.media-artist {
  font-size: 1.2rem;
  color: var(--text-secondary);
  font-weight: 500;
  margin-bottom: 12px;
}

.contentid-row {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 24px;
  flex-wrap: wrap;
}

.action-panel {
  padding: 20px;
  margin-bottom: 32px;
  background: var(--bg-card);
}

.action-row {
  display: flex;
  gap: 24px;
  flex-wrap: wrap;
  margin-bottom: 16px;
}

.action-item {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.action-label {
  font-size: 0.82rem;
  font-weight: 600;
  color: var(--text-secondary);
  text-transform: uppercase;
  letter-spacing: 0.04em;
}

.action-buttons-row {
  display: flex;
  gap: 12px;
  padding-top: 14px;
  border-top: 1px solid var(--border-subtle);
  flex-wrap: wrap;
}

.section-heading {
  font-size: 1.2rem;
  font-weight: 700;
  margin-bottom: 12px;
  display: flex;
  align-items: center;
  gap: 8px;
}

.count-badge {
  font-size: 0.8rem;
  background: var(--bg-surface);
  border: 1px solid var(--border-subtle);
  padding: 2px 8px;
  border-radius: var(--radius-full);
  color: var(--text-secondary);
}

.overview-section {
  margin-bottom: 32px;
}

.overview-text {
  font-size: 0.95rem;
  color: var(--text-secondary);
  line-height: 1.6;
  margin-bottom: 14px;
}

.genres-row {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
}

.community-section {
  margin-bottom: 36px;
}

.empty-community {
  padding: 24px;
  text-align: center;
  color: var(--text-secondary);
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 12px;
}

.reviews-list {
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.review-card {
  padding: 16px;
}

.review-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 8px;
}

.review-author {
  display: flex;
  align-items: center;
  gap: 10px;
}

.review-rating {
  font-weight: 700;
  color: var(--accent-amber);
  font-size: 0.9rem;
}

.review-time {
  font-size: 0.78rem;
  color: var(--text-muted);
}

.spoiler-tag {
  margin-bottom: 8px;
}

.review-content {
  font-size: 0.92rem;
  line-height: 1.5;
  color: var(--text-main);
  white-space: pre-line;
}

.activity-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.activity-log-item {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 10px 14px;
  background: var(--bg-surface);
  border: 1px solid var(--border-subtle);
  border-radius: var(--radius-sm);
  font-size: 0.85rem;
}

.activity-progress {
  font-family: var(--font-mono);
  color: var(--accent-sky);
  font-weight: 600;
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
  font-size: 1.05rem;
  margin-bottom: 6px;
  line-height: 1.4;
}

.media-director {
  font-size: 0.88rem;
  color: var(--text-secondary);
  margin-bottom: 12px;
}

.cast-section {
  margin-bottom: 32px;
}

.cast-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(125px, 1fr));
  gap: 12px;
}

.cast-card {
  display: flex;
  flex-direction: column;
  align-items: center;
  text-align: center;
  padding: 10px 8px;
  background: var(--bg-surface);
}

.cast-photo {
  width: 58px;
  height: 58px;
  border-radius: 50%;
  object-fit: cover;
  margin-bottom: 8px;
  border: 1px solid var(--border-subtle);
}

.cast-photo-fallback {
  width: 58px;
  height: 58px;
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 1.5rem;
  background: var(--bg-card);
  margin-bottom: 8px;
  border: 1px solid var(--border-subtle);
}

.cast-names {
  display: flex;
  flex-direction: column;
  width: 100%;
}

.cast-actor {
  font-size: 0.8rem;
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
