<script setup>
import { ref, computed, onMounted, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useAuthStore } from '@/stores/auth.js'
import { useMediaStore } from '@/stores/media.js'
import { useIpfsImage } from '@/composables/useIpfsImage.js'
import { buildDTag, cleanShowTitle, computeContentId } from '@/utils/contentId.js'
import { safeMediaUrl } from '@/utils/urls.js'
import { formatRelativeTime, formatStatus, getStatusColorClass } from '@/utils/formatters.js'
import { getTmdbDetails, searchTmdb } from '@/services/api/tmdb.js'
import { getMusicDetails, searchMusic } from '@/services/api/music.js'
import RatingInput from '@/components/RatingInput.vue'
import StatusPicker from '@/components/StatusPicker.vue'
import TvEpisodeTracker from '@/components/TvEpisodeTracker.vue'
import { getRandomReviewSuggestions } from '@/utils/reviewSuggestions.js'

const route = useRoute()
const router = useRouter()
const authStore = useAuthStore()
const mediaStore = useMediaStore()

const contentId = computed(() => route.params.contentId)
// Route IDs that aren't 64-hex can never match a Nostr record — fail fast
// instead of querying relays with garbage.
const isValidContentId = computed(() => /^[0-9a-f]{64}$/i.test(contentId.value || ''))

const targetSeason = computed(() => {
  if (route.query.season) return Number(route.query.season)
  const match = (route.query.title || '').match(/S(\d+)E(\d+)/i)
  return match ? Number(match[1]) : null
})

const targetEpisode = computed(() => {
  if (route.query.episode) return Number(route.query.episode)
  const match = (route.query.title || '').match(/S(\d+)E(\d+)/i)
  return match ? Number(match[2]) : null
})

function getInitialType() {
  const t = route.query.type || 'movie'
  if (t === 'episode' || /S\d+E\d+/i.test(route.query.title || '') || route.query.season) {
    return 'show'
  }
  return t
}

function getInitialTitle() {
  const t = route.query.title || ''
  if (!t) return 'Loading...'
  if (route.query.type === 'episode' || /S\d+E\d+/i.test(t) || route.query.season) {
    return cleanShowTitle(t)
  }
  return t
}

const media = ref({
  contentId: contentId.value,
  type: getInitialType(),
  title: getInitialTitle(),
  name: getInitialTitle(),
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

// Similar suggestions modal state (Kind 35401)
const showSuggestionModal = ref(false)
const suggestionQuery = ref('')
const isSearchingSuggestions = ref(false)
const suggestionResults = ref([])
const selectedSimilarMedia = ref(null)
const suggestionNote = ref('')
const isSubmittingSuggestion = ref(false)
const suggestionError = ref('')

// Inline review modal state
const showReviewModal = ref(false)
const reviewBody = ref('')
const reviewSpoiler = ref(false)
const isSubmittingReview = ref(false)
const reviewError = ref('')
const reviewSuggestions = ref([])

// User's current tracking status (Kind 35402)
const userStatus = computed(() => {
  return mediaStore.getMediaStatus(contentId.value)
})

// User's current rating (Kind 35400)
const userRating = computed(() => {
  return mediaStore.getMediaRating(contentId.value)
})


// Reviews for this media (Kind 35400)
const mediaReviews = computed(() => {
  return mediaStore.getReviewsForMedia(contentId.value)
})

// Similar suggestions for this media (Kind 35401)
const mediaSimilarSuggestions = computed(() => {
  return mediaStore.getSimilarSuggestionsForMedia(contentId.value)
})

// Community average score from Nostr signals (Kind 35400 ratings)
const nostrAvgRating = computed(() => {
  return mediaStore.getAverageRatingForMedia(contentId.value)
})

// External search shortcuts: title + year → Google, title + year + trailer → YouTube
const searchQueryBase = computed(() => {
  const title = (media.value.title || media.value.name || route.query.title || '').trim()
  const year = (media.value.year || route.query.year || '').toString().trim()
  const artist = (media.value.artist || route.query.artist || '').trim()
  const parts = [title]
  // Music identity includes the artist — keep it so searches disambiguate covers.
  if (media.value.type === 'music' && artist) parts.push(artist)
  if (year) parts.push(year)
  return parts.filter(Boolean).join(' ').trim()
})

const googleSearchUrl = computed(() => {
  if (!searchQueryBase.value) return ''
  return `https://www.google.com/search?q=${encodeURIComponent(searchQueryBase.value)}`
})

const youtubeSearchUrl = computed(() => {
  if (!searchQueryBase.value) return ''
  return `https://www.youtube.com/results?search_query=${encodeURIComponent(`${searchQueryBase.value} trailer`)}`
})

const { src: posterSrc, onError: onPosterError } = useIpfsImage(() => {
  return media.value.poster || ''
})
const { src: bannerSrc, onError: onBannerError } = useIpfsImage(() => {
  return media.value.banner || ''
})

const effectivePoster = computed(() => safeMediaUrl(posterSrc.value))

const effectiveBanner = computed(() => {
  const safe = safeMediaUrl(bannerSrc.value)
  return safe ? `url("${safe}")` : ''
})

// CSS background-image has no @error event — preload the banner so a failed
// gateway still advances the fallback chain.
watch(bannerSrc, (url) => {
  if (!url) return
  const img = new Image()
  img.onerror = onBannerError
  img.src = url
})

function safeImg(url) {
  return safeMediaUrl(url)
}

let loadToken = 0 // latest navigation wins; stale responses are discarded

onMounted(async () => {
  if (!isValidContentId.value) return
  await loadMediaData()
  // Fetch Nostr state for this contentId
  await mediaStore.fetchMediaDetails(contentId.value).catch(() => {})
})

watch(
  () => [route.params.contentId, route.query.type, route.query.title],
  async () => {
    if (!isValidContentId.value) return
    media.value.contentId = contentId.value
    media.value.type = getInitialType()
    if (route.query.title) {
      const clean = getInitialTitle()
      media.value.title = clean
      media.value.name = clean
    }
    await loadMediaData()
    await mediaStore.fetchMediaDetails(contentId.value).catch(() => {})
  }
)

// Direct URL / bookmark navigation starts with a 'Loading...' placeholder
// title. When fetchMediaDetails() populates the library from Nostr events,
// merge the real name/title in so the page (and TvEpisodeTracker) can render.
watch(
  () => mediaStore.mediaLibrary[contentId.value],
  (stored) => {
    if (!stored || (!stored.name && !stored.title)) return
    const isStoredEp = stored.type === 'episode' || /S\d+E\d+/i.test(stored.name || stored.title || '')
    const cleanTitle = cleanShowTitle(stored.title || stored.name || '')
    const storedView = isStoredEp
      ? {
          ...stored,
          type: 'show',
          title: cleanTitle,
          name: cleanTitle,
        }
      : stored
    if (media.value.title === 'Loading...' || !media.value.title) {
      media.value = { ...media.value, ...storedView }
    }
  }
)

async function loadMediaData() {
  const myToken = ++loadToken
  // Check if we already have it in media library store
  const stored = mediaStore.mediaLibrary[contentId.value]
  if (stored) {
    // Episode records fold into their parent show; a stale type 'episode'
    // cache entry must never hide the show's episode tracker or type badge.
    const isStoredEp = stored.type === 'episode' || /S\d+E\d+/i.test(stored.name || stored.title || '')
    const cleanTitle = cleanShowTitle(stored.title || stored.name || '')
    const storedView = isStoredEp
      ? {
          ...stored,
          type: 'show',
          title: cleanTitle,
          name: cleanTitle,
        }
      : stored
    media.value = { ...media.value, ...storedView }
  }

  // Ensure media.type and title are normalized if an episode was passed in
  if (media.value.type === 'episode' || /S\d+E\d+/i.test(media.value.title || '') || route.query.season) {
    media.value.type = 'show'
    media.value.title = cleanShowTitle(media.value.title)
    media.value.name = cleanShowTitle(media.value.name)
  }

  // Fetch Multi-Source Rich Details (TMDB + TVMaze) for movies & shows
  const mediaType = media.value.type || getInitialType()
  const mediaTitle = media.value.type === 'show' ? cleanShowTitle(media.value.title || route.query.title || '') : (media.value.title || route.query.title || '')
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
  } else if (mediaType === 'music' && mediaTitle && mediaTitle !== 'Loading...') {
    try {
      const richMusic = await getMusicDetails({
        title: mediaTitle,
        artist: media.value.artist || route.query.artist || '',
        year: mediaYear,
      })
      if (myToken !== loadToken) return
      if (richMusic) {
        media.value = {
          ...media.value,
          contentId: contentId.value,
          title: media.value.title || richMusic.title,
          name: media.value.name || richMusic.name || richMusic.title,
          artist: media.value.artist || richMusic.artist,
          album: media.value.album || richMusic.album,
          poster: richMusic.poster || media.value.poster,
          banner: richMusic.banner || media.value.banner,
          overview: richMusic.overview || media.value.overview,
          genres: richMusic.genres?.length ? richMusic.genres : media.value.genres,
          sources: richMusic.sources || media.value.sources,
          previewUrl: richMusic.previewUrl || media.value.previewUrl,
        }
        mediaStore.cacheMediaItem(media.value)
      }
    } catch (err) {
      console.warn('Failed to load rich music details:', err)
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
    // After rating, offer to attach a quick review comment.
    openReviewModal()
  } catch (err) {
    console.error('Failed to submit rating:', err)
  }
}

function refreshReviewSuggestions() {
  reviewSuggestions.value = getRandomReviewSuggestions(5, media.value?.type || 'movie', reviewSuggestions.value)
}

function applyReviewSuggestion(suggestion) {
  const clean = suggestion.trim()
  if (!reviewBody.value.trim()) {
    reviewBody.value = clean
  } else {
    const current = reviewBody.value.trim()
    const needsPunctuation = !/[.!?]$/.test(current)
    reviewBody.value = `${current}${needsPunctuation ? '.' : ''} ${clean}`
  }
}

function openReviewModal() {
  if (!authStore.isAuthenticated) {
    authStore.openLoginModal()
    return
  }
  const existing = mediaStore.getMediaReview(contentId.value)
  reviewBody.value = existing?.content || ''
  reviewSpoiler.value = existing?.spoiler || false
  reviewError.value = ''
  refreshReviewSuggestions()
  showReviewModal.value = true
}

function closeReviewModal() {
  if (isSubmittingReview.value) return
  showReviewModal.value = false
}

async function submitReview() {
  if (!authStore.isAuthenticated) {
    authStore.openLoginModal()
    return
  }

  const body = reviewBody.value.trim()

  isSubmittingReview.value = true
  reviewError.value = ''

  try {
    await mediaStore.addReview(media.value, body, {
      rating: userRating.value,
      spoiler: reviewSpoiler.value,
    })
    showReviewModal.value = false
  } catch (err) {
    console.error('Failed to submit review:', err)
    reviewError.value = err.message || 'Failed to publish review to Nostr.'
  } finally {
    isSubmittingReview.value = false
  }
}

function openSuggestionModal() {
  showSuggestionModal.value = true
  suggestionQuery.value = ''
  suggestionResults.value = []
  selectedSimilarMedia.value = null
  suggestionNote.value = ''
  suggestionError.value = ''
}

async function searchSimilarMedia() {
  const q = (suggestionQuery.value || '').trim()
  if (!q) {
    suggestionResults.value = []
    return
  }
  isSearchingSuggestions.value = true
  suggestionError.value = ''
  try {
    let results = []
    if (media.value.type === 'music') {
      const musicRes = await searchMusic(q)
      results = (musicRes || []).map((item) => ({
        contentId: item.contentId || computeContentId('music', item.title, item.year, item.artist),
        type: 'music',
        name: item.title,
        title: item.title,
        artist: item.artist,
        year: item.year,
        poster: item.poster,
      }))
    } else {
      const tmdbRes = await searchTmdb(q, media.value.type === 'show' ? 'tv' : 'multi')
      results = (tmdbRes || []).map((item) => ({
        contentId: item.contentId || computeContentId(item.type || 'movie', item.title || item.name, item.year),
        type: item.type || 'movie',
        name: item.title || item.name,
        title: item.title || item.name,
        year: item.year,
        poster: item.poster,
      }))
    }
    // Exclude current media
    suggestionResults.value = results.filter((r) => r.contentId !== contentId.value)
  } catch (err) {
    console.error('Failed to search similar media:', err)
    suggestionError.value = 'Failed to search media.'
  } finally {
    isSearchingSuggestions.value = false
  }
}

function selectSimilarItem(item) {
  selectedSimilarMedia.value = item
}

async function submitSimilarSuggestion() {
  if (!authStore.isAuthenticated) {
    authStore.openLoginModal()
    return
  }
  if (!selectedSimilarMedia.value) {
    suggestionError.value = 'Please select a title to suggest.'
    return
  }
  isSubmittingSuggestion.value = true
  suggestionError.value = ''
  try {
    await mediaStore.addSimilarSuggestion(
      media.value,
      selectedSimilarMedia.value,
      suggestionNote.value
    )
    showSuggestionModal.value = false
    selectedSimilarMedia.value = null
    suggestionNote.value = ''
    suggestionQuery.value = ''
  } catch (err) {
    suggestionError.value = err.message || 'Failed to submit suggestion to Nostr.'
  } finally {
    isSubmittingSuggestion.value = false
  }
}

function navigateToMedia(item) {
  if (!item?.contentId) return
  router.push({
    name: 'media-detail',
    params: { contentId: item.contentId },
    query: {
      type: item.type || 'movie',
      title: item.name || item.title || '',
      year: item.year || '',
      artist: item.artist || '',
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
  <div v-else class="media-detail-view" :class="{ 'has-banner': !!effectiveBanner, 'no-banner': !effectiveBanner }">
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

    <!-- Banner Backdrop (rendered only when banner image is present) -->
    <div
      v-if="effectiveBanner"
      class="backdrop-banner"
      :style="{ backgroundImage: effectiveBanner }"
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
              @error="onPosterError"
            />
            <div v-else class="poster-placeholder">
              <span v-if="media.type === 'movie'">🎬</span>
              <span v-else-if="media.type === 'show'">📺</span>
              <span v-else>🎵</span>
            </div>
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

          <!-- Community average score from Nostr events (Kind 35400) -->
          <div class="nostr-avg-row">
            <span
              v-if="nostrAvgRating"
              class="badge badge-nostr-avg"
              :title="`Nostr community average from ${nostrAvgRating.ratingsCount} rating${nostrAvgRating.ratingsCount === 1 ? '' : 's'} (Kind 35400)${nostrAvgRating.reviewsCount > 0 ? ` including ${nostrAvgRating.reviewsCount} written review${nostrAvgRating.reviewsCount === 1 ? '' : 's'}` : ''}`"
            >
              ★ {{ nostrAvgRating.average }}/10 Nostr Avg · {{ nostrAvgRating.count }} vote{{ nostrAvgRating.count === 1 ? '' : 's' }}
            </span>
            <span v-else class="nostr-avg-empty">
              No Nostr ratings yet — be the first to score it above.
            </span>
          </div>

          <!-- External search shortcuts -->
          <div v-if="searchQueryBase" class="external-search-row">
            <a
              class="btn btn-outline btn-sm"
              :href="googleSearchUrl"
              target="_blank"
              rel="noopener noreferrer"
              :title="`Search Google for ${searchQueryBase}`"
            >
              🔍 Google
            </a>
            <a
              class="btn btn-outline btn-sm"
              :href="youtubeSearchUrl"
              target="_blank"
              rel="noopener noreferrer"
              :title="`Search YouTube for ${searchQueryBase} trailer`"
            >
              ▶️ Trailer
            </a>
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
                <div class="rating-row">
                  <RatingInput
                    :model-value="userRating"
                    @change="handleRatingChange"
                  />
                  <button
                    class="btn btn-icon btn-sm add-review-btn"
                    type="button"
                    title="Write a review"
                    @click="openReviewModal"
                  >
                    ✍️
                  </button>
                </div>
              </div>
            </div>
          </div>

          <!-- Inline Review Modal -->
          <transition name="fade">
            <div v-if="showReviewModal" class="modal-overlay" @click.self="closeReviewModal">
              <div class="review-modal card" role="dialog" aria-modal="true" aria-label="Write a review">
                <div class="review-modal-header">
                  <div class="review-modal-title">
                    <span class="review-modal-icon">✍️</span>
                    <div>
                      <h3 class="review-modal-heading">Write a Review</h3>
                      <p class="review-modal-sub">
                        {{ media.title || media.name }}
                        <template v-if="media.year"> · {{ media.year }}</template>
                        <template v-if="userRating"> · ★ {{ userRating }}/10</template>
                      </p>
                    </div>
                  </div>
                  <button class="btn btn-icon btn-sm" type="button" aria-label="Close" @click="closeReviewModal">
                    ✕
                  </button>
                </div>

                <div v-if="reviewError" class="badge badge-danger error-banner">
                  {{ reviewError }}
                </div>

                <!-- 1-Click Suggestions from pool of 100+ noun & verb combinations -->
                <div class="review-suggestions-container">
                  <div class="review-suggestions-header">
                    <span class="review-suggestions-label">💡 1-Click Suggestions</span>
                    <button
                      type="button"
                      class="btn-refresh-suggestions"
                      title="Generate 5 new random suggestions"
                      @click="refreshReviewSuggestions"
                    >
                      🔄 Shuffle
                    </button>
                  </div>
                  <div class="review-suggestions-chips" role="group" aria-label="Review suggestions">
                    <button
                      v-for="(suggestion, idx) in reviewSuggestions"
                      :key="idx + '-' + suggestion"
                      type="button"
                      class="suggestion-chip"
                      :class="{ 'chip-selected': reviewBody.includes(suggestion) }"
                      :title="`Add '${suggestion}' to review`"
                      @click="applyReviewSuggestion(suggestion)"
                    >
                      {{ suggestion }}
                    </button>
                  </div>
                </div>

                <textarea
                  v-model="reviewBody"
                  class="input review-modal-textarea"
                  rows="5"
                  placeholder="What did you think? Share your commentary, analysis, or thoughts (optional)..."
                ></textarea>

                <label class="spoiler-toggle">
                  <input v-model="reviewSpoiler" type="checkbox" />
                  <span>Mark review as containing spoilers</span>
                </label>

                <p class="form-hint">
                  Ratings and reviews are published as mutable Nostr events (Kind 35400) referencing this media's canonical Content ID.
                </p>

                <div class="review-modal-actions">
                  <button class="btn btn-secondary btn-sm" type="button" :disabled="isSubmittingReview" @click="closeReviewModal">
                    Cancel
                  </button>
                  <button
                    class="btn btn-primary btn-sm"
                    type="button"
                    :disabled="isSubmittingReview"
                    @click="submitReview"
                  >
                    {{ isSubmittingReview ? 'Signing & Broadcasting...' : '⚡ Sign & Post Review' }}
                  </button>
                </div>
              </div>
            </div>
          </transition>

          <!-- Interactive TV Seasons & Episodes Tracker -->
          <TvEpisodeTracker
            v-if="media.type === 'show'"
            :media="media"
            :content-id="contentId"
            :target-season="targetSeason"
            :target-episode="targetEpisode"
          />

          <!-- Overview / Synopsis -->
          <div class="overview-section">
            <h3 class="section-heading">Overview</h3>
            <p class="overview-text">
              {{ media.overview || 'No synopsis provided yet.' }}
            </p>

            <div v-if="(media.genres || []).length > 0" class="genres-row">
              <span
                v-for="g in media.genres"
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

          <!-- Community Reviews (Kind 35400) -->
          <div class="community-section">
            <div class="community-header">
              <h3 class="section-heading">
                Nostr Reviews (Kind 35400)
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
                <p v-if="rev.content" class="review-content">{{ rev.content }}</p>
              </div>
            </div>
          </div>

          <!-- Similar Suggestions (Kind 35401) -->
          <div class="community-section">
            <div class="community-header">
              <div>
                <h3 class="section-heading">
                  💡 Similar Suggestions
                  <span class="count-badge">{{ mediaSimilarSuggestions.length }}</span>
                </h3>
                <p class="section-subtext">Community recommendations for fans of this {{ media.type === 'music' ? 'music' : (media.type === 'show' ? 'show' : 'movie') }}</p>
              </div>
              <button
                class="btn btn-outline btn-sm"
                type="button"
                @click="openSuggestionModal"
              >
                💡 + Suggest Similar
              </button>
            </div>

            <div v-if="mediaSimilarSuggestions.length === 0" class="empty-community card">
              <p>No similar titles suggested yet by the community.</p>
              <button class="btn btn-outline btn-sm" type="button" @click="openSuggestionModal">
                Suggest the first similar title
              </button>
            </div>

            <div v-else class="similar-suggestions-grid">
              <div
                v-for="sug in mediaSimilarSuggestions"
                :key="sug.contentId"
                class="similar-card card"
                @click="navigateToMedia(sug)"
              >
                <div class="similar-card-poster">
                  <img
                    v-if="sug.poster"
                    :src="sug.poster"
                    :alt="sug.name || sug.title"
                    loading="lazy"
                    class="similar-poster-img"
                  />
                  <div v-else class="similar-poster-placeholder">
                    <span>{{ sug.type === 'music' ? '🎵' : (sug.type === 'show' ? '📺' : '🎬') }}</span>
                  </div>
                </div>
                <div class="similar-card-info">
                  <div class="similar-card-top">
                    <span class="badge badge-accent badge-sm">{{ sug.type }}</span>
                    <span class="badge badge-success badge-sm">
                      👍 {{ sug.voteCount }} {{ sug.voteCount === 1 ? 'vote' : 'votes' }}
                    </span>
                  </div>
                  <h4 class="similar-title">{{ sug.name || sug.title }}</h4>
                  <div class="similar-meta">
                    <span v-if="sug.year">{{ sug.year }}</span>
                    <span v-if="sug.artist" class="similar-artist">• {{ sug.artist }}</span>
                  </div>
                  <div v-if="sug.notes && sug.notes.length > 0" class="similar-notes">
                    <p class="similar-note-text">"{{ sug.notes[0] }}"</p>
                  </div>
                </div>
              </div>
            </div>
          </div>

          <!-- Similar Suggestion Modal -->
          <transition name="fade">
            <div v-if="showSuggestionModal" class="modal-overlay" @click.self="showSuggestionModal = false">
              <div class="suggestion-modal card" role="dialog" aria-modal="true" aria-label="Suggest similar title">
                <div class="suggestion-modal-header">
                  <div class="suggestion-modal-title">
                    <span class="suggestion-modal-icon">💡</span>
                    <div>
                      <h3 class="suggestion-modal-heading">Suggest Similar Title</h3>
                      <p class="suggestion-modal-sub">
                        Recommend a title similar to <strong>{{ media.title || media.name }}</strong>
                      </p>
                    </div>
                  </div>
                  <button class="btn btn-icon btn-sm" type="button" aria-label="Close" @click="showSuggestionModal = false">
                    ✕
                  </button>
                </div>

                <div v-if="suggestionError" class="badge badge-danger error-banner">
                  {{ suggestionError }}
                </div>

                <div class="suggestion-search-box">
                  <label class="action-label">Find a title to suggest</label>
                  <div class="suggestion-search-input-wrap">
                    <input
                      v-model="suggestionQuery"
                      type="text"
                      class="input"
                      placeholder="Search movie, show, or music..."
                      @keyup.enter="searchSimilarMedia"
                    />
                    <button
                      type="button"
                      class="btn btn-primary btn-sm"
                      :disabled="isSearchingSuggestions || !suggestionQuery.trim()"
                      @click="searchSimilarMedia"
                    >
                      {{ isSearchingSuggestions ? 'Searching...' : 'Search' }}
                    </button>
                  </div>
                </div>

                <div v-if="suggestionResults.length > 0" class="suggestion-results-list">
                  <div
                    v-for="item in suggestionResults"
                    :key="item.contentId"
                    class="suggestion-result-row"
                    :class="{ 'selected': selectedSimilarMedia?.contentId === item.contentId }"
                    @click="selectSimilarItem(item)"
                  >
                    <div class="suggestion-row-poster">
                      <img v-if="item.poster" :src="item.poster" :alt="item.name || item.title" />
                      <span v-else>{{ item.type === 'music' ? '🎵' : (item.type === 'show' ? '📺' : '🎬') }}</span>
                    </div>
                    <div class="suggestion-row-meta">
                      <div class="suggestion-row-title">{{ item.name || item.title }}</div>
                      <div class="suggestion-row-detail">
                        <span class="badge badge-sm badge-accent">{{ item.type }}</span>
                        <span v-if="item.year">{{ item.year }}</span>
                        <span v-if="item.artist">• {{ item.artist }}</span>
                      </div>
                    </div>
                    <div class="suggestion-row-check">
                      {{ selectedSimilarMedia?.contentId === item.contentId ? '✓ Selected' : 'Select' }}
                    </div>
                  </div>
                </div>

                <div v-if="selectedSimilarMedia" class="selected-similar-box">
                  <span class="selected-label">Selected:</span>
                  <strong>{{ selectedSimilarMedia.name || selectedSimilarMedia.title }}</strong>
                  <span v-if="selectedSimilarMedia.year">({{ selectedSimilarMedia.year }})</span>
                </div>

                <div class="suggestion-note-field">
                  <label class="action-label">Why is it similar? (Optional)</label>
                  <input
                    v-model="suggestionNote"
                    type="text"
                    class="input"
                    placeholder="e.g. Similar vibe, same director, shared atmosphere..."
                  />
                </div>

                <div class="suggestion-modal-footer">
                  <button class="btn btn-secondary btn-sm" type="button" @click="showSuggestionModal = false">
                    Cancel
                  </button>
                  <button
                    class="btn btn-primary btn-sm"
                    type="button"
                    :disabled="isSubmittingSuggestion || !selectedSimilarMedia"
                    @click="submitSimilarSuggestion"
                  >
                    {{ isSubmittingSuggestion ? 'Publishing...' : 'Publish Suggestion (Kind 35401)' }}
                  </button>
                </div>
              </div>
            </div>
          </transition>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.media-detail-view {
  position: relative;
}

.media-detail-view.has-banner {
  margin-top: -40px;
}

.media-detail-view.no-banner {
  margin-top: 0;
  padding-top: 48px;
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
  padding: 0 24px;
  position: relative;
  z-index: 10;
}

.has-banner .detail-container {
  margin: -140px auto 0;
}

.no-banner .detail-container {
  margin: 0 auto;
}

.detail-grid {
  display: grid;
  grid-template-columns: 280px 1fr;
  gap: 48px;
}

@media (max-width: 880px) {
  .media-detail-view.no-banner {
    padding-top: 40px;
  }

  .backdrop-banner {
    height: 240px;
  }

  .has-banner .detail-container {
    margin: -90px auto 0;
    padding: 0 16px;
  }

  .no-banner .detail-container {
    margin: 0 auto;
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
  margin-bottom: 12px;
  flex-wrap: wrap;
}

.nostr-avg-row {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-bottom: 32px;
  flex-wrap: wrap;
}

.badge-nostr-avg {
  background: rgba(245, 166, 35, 0.08);
  color: var(--accent-amber);
  border: 1px solid rgba(245, 166, 35, 0.25);
  font-weight: 600;
}

.nostr-avg-empty {
  font-size: 0.82rem;
  color: var(--text-muted);
}

.external-search-row {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-bottom: 32px;
  margin-top: -20px;
  flex-wrap: wrap;
}

.external-search-row .btn {
  text-decoration: none;
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

.rating-row {
  display: flex;
  align-items: center;
  gap: 8px;
}

.add-review-btn {
  flex-shrink: 0;
  border: 1px solid var(--border-subtle);
  background: var(--bg-surface);
}

.add-review-btn:hover {
  border-color: var(--border-hover);
  background: var(--bg-card-hover);
}

.action-label {
  font-family: var(--font-mono);
  font-size: 0.72rem;
  font-weight: 500;
  color: var(--text-muted);
  text-transform: uppercase;
  letter-spacing: 0.05em;
}

/* Inline review modal */
.modal-overlay {
  position: fixed;
  inset: 0;
  z-index: 1000;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 20px;
  background: rgba(0, 0, 0, 0.7);
  backdrop-filter: blur(4px);
}

.review-modal {
  width: 100%;
  max-width: 560px;
  padding: 24px;
  display: flex;
  flex-direction: column;
  gap: 16px;
  max-height: 90vh;
  overflow-y: auto;
}

.review-modal-header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
}

.review-modal-title {
  display: flex;
  align-items: flex-start;
  gap: 12px;
}

.review-modal-icon {
  font-size: 1.4rem;
  line-height: 1.2;
}

.review-modal-heading {
  font-size: 1.15rem;
  font-weight: 700;
  letter-spacing: -0.03em;
  color: var(--text-main);
}

.review-modal-sub {
  font-size: 0.85rem;
  color: var(--text-secondary);
}

.review-suggestions-container {
  display: flex;
  flex-direction: column;
  gap: 8px;
  margin-top: 2px;
}

.review-suggestions-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.review-suggestions-label {
  font-size: 0.78rem;
  font-weight: 600;
  color: var(--text-secondary);
  display: flex;
  align-items: center;
  gap: 6px;
  text-transform: uppercase;
  letter-spacing: 0.04em;
}

.btn-refresh-suggestions {
  background: transparent;
  border: 1px solid var(--border-color, #2d3748);
  color: var(--text-secondary);
  font-size: 0.74rem;
  border-radius: var(--radius-sm, 6px);
  padding: 3px 8px;
  cursor: pointer;
  display: inline-flex;
  align-items: center;
  gap: 4px;
  transition: all var(--transition-fast, 0.15s ease);
}

.btn-refresh-suggestions:hover {
  background: var(--bg-hover, rgba(255, 255, 255, 0.05));
  color: var(--text-main);
  border-color: var(--text-muted);
}

.review-suggestions-chips {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

.suggestion-chip {
  background: var(--bg-secondary, #1a202c);
  color: var(--text-secondary, #cbd5e0);
  border: 1px solid var(--border-color, #2d3748);
  border-radius: 9999px;
  padding: 5px 12px;
  font-size: 0.82rem;
  font-weight: 500;
  cursor: pointer;
  line-height: 1.3;
  transition: all var(--transition-fast, 0.15s ease);
  user-select: none;
  text-align: center;
}

.suggestion-chip:hover {
  background: var(--bg-hover, rgba(255, 255, 255, 0.08));
  color: var(--text-main, #ffffff);
  border-color: var(--primary-color, #6366f1);
  transform: translateY(-1px);
}

.suggestion-chip.chip-selected {
  background: rgba(99, 102, 241, 0.18);
  border-color: var(--primary-color, #6366f1);
  color: var(--primary-color, #6366f1);
  font-weight: 600;
}

.review-modal-textarea {
  width: 100%;
  resize: vertical;
  min-height: 120px;
  font-family: inherit;
  line-height: 1.6;
}

.spoiler-toggle {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 0.85rem;
  color: var(--text-secondary);
  cursor: pointer;
  user-select: none;
}

.review-modal-actions {
  display: flex;
  justify-content: flex-end;
  gap: 10px;
  padding-top: 4px;
}

.fade-enter-active,
.fade-leave-active {
  transition: opacity 0.15s ease;
}

.fade-enter-from,
.fade-leave-to {
  opacity: 0;
}

@media (max-width: 640px) {
  .poster-col {
    max-width: 180px;
    margin: 0 auto;
  }

  .media-title {
    font-size: 1.75rem;
    line-height: 1.15;
    word-break: break-word;
  }

  .contentid-row {
    flex-wrap: wrap;
    gap: 8px;
    max-width: 100%;
  }

  .contentid-chip {
    max-width: 100%;
    font-size: 0.72rem;
    word-break: break-all;
  }

  .action-panel {
    padding: 16px;
  }

  .action-row {
    flex-direction: column;
    gap: 16px;
  }

  .action-item {
    min-width: 100%;
    width: 100%;
  }

  .rating-row {
    flex-wrap: wrap;
    gap: 10px;
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

.similar-suggestions-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
  gap: 16px;
}

.similar-card {
  display: flex;
  gap: 14px;
  padding: 14px;
  background: var(--bg-card);
  border: 1px solid var(--border-subtle);
  border-radius: var(--radius-md);
  cursor: pointer;
  transition: transform var(--transition-fast), border-color var(--transition-fast);
}

.similar-card:hover {
  transform: translateY(-2px);
  border-color: var(--border-hover);
}

.similar-card-poster {
  width: 60px;
  height: 90px;
  flex-shrink: 0;
  border-radius: var(--radius-sm);
  overflow: hidden;
  background: var(--bg-surface);
}

.similar-poster-img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}

.similar-poster-placeholder {
  width: 100%;
  height: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 1.5rem;
}

.similar-card-info {
  display: flex;
  flex-direction: column;
  gap: 4px;
  min-width: 0;
  flex: 1;
}

.similar-card-top {
  display: flex;
  align-items: center;
  gap: 8px;
}

.similar-title {
  font-size: 0.95rem;
  font-weight: 600;
  color: var(--text-main);
  margin: 2px 0 0;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.similar-meta {
  font-size: 0.8rem;
  color: var(--text-muted);
}

.similar-notes {
  margin-top: 4px;
}

.similar-note-text {
  font-size: 0.8rem;
  font-style: italic;
  color: var(--text-secondary);
  line-height: 1.4;
  margin: 0;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
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

/* Suggestion Modal */
.suggestion-modal {
  width: 100%;
  max-width: 540px;
  padding: 24px;
  display: flex;
  flex-direction: column;
  gap: 16px;
  max-height: 90vh;
  overflow-y: auto;
}

.suggestion-modal-header {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
}

.suggestion-modal-title {
  display: flex;
  gap: 12px;
  align-items: center;
}

.suggestion-modal-icon {
  font-size: 1.6rem;
}

.suggestion-modal-heading {
  font-size: 1.15rem;
  font-weight: 700;
  margin: 0;
}

.suggestion-modal-sub {
  font-size: 0.85rem;
  color: var(--text-muted);
  margin: 4px 0 0;
}

.suggestion-search-box {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.suggestion-search-input-wrap {
  display: flex;
  gap: 8px;
}

.suggestion-results-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
  max-height: 220px;
  overflow-y: auto;
  border: 1px solid var(--border-subtle);
  border-radius: var(--radius-md);
  padding: 6px;
  background: var(--bg-surface);
}

.suggestion-result-row {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 8px;
  border-radius: var(--radius-sm);
  cursor: pointer;
  transition: background var(--transition-fast);
}

.suggestion-result-row:hover {
  background: var(--bg-card);
}

.suggestion-result-row.selected {
  background: rgba(230, 0, 103, 0.12);
  border: 1px solid var(--accent-primary);
}

.suggestion-row-poster {
  width: 36px;
  height: 50px;
  flex-shrink: 0;
  border-radius: 4px;
  overflow: hidden;
  background: var(--bg-card);
  display: flex;
  align-items: center;
  justify-content: center;
}

.suggestion-row-poster img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}

.suggestion-row-meta {
  flex: 1;
  min-width: 0;
}

.suggestion-row-title {
  font-size: 0.9rem;
  font-weight: 600;
  color: var(--text-main);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.suggestion-row-detail {
  font-size: 0.75rem;
  color: var(--text-muted);
  display: flex;
  gap: 6px;
  align-items: center;
  margin-top: 2px;
}

.suggestion-row-check {
  font-size: 0.8rem;
  font-weight: 600;
  color: var(--accent-primary);
}

.selected-similar-box {
  padding: 10px 14px;
  background: rgba(230, 0, 103, 0.08);
  border: 1px solid rgba(230, 0, 103, 0.3);
  border-radius: var(--radius-sm);
  font-size: 0.88rem;
  display: flex;
  gap: 8px;
  align-items: center;
}

.selected-label {
  color: var(--text-muted);
  font-size: 0.8rem;
}

.suggestion-note-field {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.suggestion-modal-footer {
  display: flex;
  justify-content: flex-end;
  gap: 10px;
  margin-top: 8px;
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
