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
    authStore.openLoginModal()
    return
  }
  if (!newStatus) return

  try {
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
  if (newRating === null) return

  try {
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
  if (!authStore.isAuthenticated) {
    authStore.openLoginModal()
    return
  }
  showCheckInModal.value = true
}

function openSeedModal() {
  if (!authStore.isAuthenticated) {
    authStore.openLoginModal()
    return
  }
  showSeedModal.value = true
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
              <button class="btn btn-secondary" type="button" @click="openCheckInModal">
                ⏱️ Log Check-in / Scrobble
              </button>
              <button class="btn btn-primary" type="button" @click="openReviewModal">
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
