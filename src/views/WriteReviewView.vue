<script setup>
import { ref, computed, onMounted } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useMediaStore } from '@/stores/media.js'
import { useAuthStore } from '@/stores/auth.js'
import { resolveIpfsUrl } from '@/services/originless.js'
import { safeMediaUrl } from '@/utils/urls.js'
import RatingInput from '@/components/RatingInput.vue'

const route = useRoute()
const router = useRouter()
const mediaStore = useMediaStore()
const authStore = useAuthStore()

const contentId = computed(() => route.params.contentId || '')

// Media resolution from cache or route query
const cachedMedia = computed(() => mediaStore.mediaLibrary[contentId.value] || {})
const communityMeta = computed(() => mediaStore.getMediaMetadata(contentId.value) || {})

const mediaTitle = computed(() => {
  return cachedMedia.value.title || cachedMedia.value.name || route.query.title || 'Media'
})

const mediaYear = computed(() => {
  return cachedMedia.value.year || route.query.year || ''
})

const mediaType = computed(() => {
  return cachedMedia.value.type || route.query.type || 'movie'
})

const mediaArtist = computed(() => {
  return cachedMedia.value.artist || route.query.artist || ''
})

const effectivePoster = computed(() => {
  const raw = communityMeta.value?.poster || cachedMedia.value.poster || ''
  return safeMediaUrl(resolveIpfsUrl(raw))
})

const existingRating = computed(() => {
  const r = mediaStore.getMediaRating(contentId.value)
  return r ? r.rating : null
})

const reviewBody = ref('')
const rating = ref(null)
const containsSpoiler = ref(false)
const isSubmitting = ref(false)
const errorMsg = ref('')

function goBack() {
  if (contentId.value) {
    router.push(`/media/${contentId.value}`)
  } else if (window.history.length > 1) {
    router.back()
  } else {
    router.push('/')
  }
}

async function handleSubmit() {
  if (!authStore.isAuthenticated) {
    router.push({
      path: '/connect',
      query: { returnTo: `/media/${contentId.value}/review` },
    })
    return
  }

  if (!reviewBody.value.trim()) {
    errorMsg.value = 'Please enter your review text.'
    return
  }

  isSubmitting.value = true
  errorMsg.value = ''

  try {
    const mediaObj = {
      contentId: contentId.value,
      title: mediaTitle.value,
      name: mediaTitle.value,
      year: mediaYear.value,
      type: mediaType.value,
      artist: mediaArtist.value,
    }

    await mediaStore.addReview(mediaObj, reviewBody.value.trim(), {
      rating: rating.value,
      spoiler: containsSpoiler.value,
    })

    // Return to media details
    router.push(`/media/${contentId.value}`)
  } catch (err) {
    console.error('Failed to submit review:', err)
    errorMsg.value = err.message || 'Failed to publish review to Nostr.'
  } finally {
    isSubmitting.value = false
  }
}

onMounted(async () => {
  if (existingRating.value) {
    rating.value = existingRating.value
  }
  if (contentId.value && !cachedMedia.value.title) {
    mediaStore.fetchMediaDetails(contentId.value).catch(() => {})
  }
})
</script>

<template>
  <div class="review-page-wrap">
    <div class="page-top-nav">
      <button class="btn-back" type="button" @click="goBack">
        <span class="back-arrow">‹</span>
        <span>Back to Media</span>
      </button>
    </div>

    <div class="review-card card">
      <header class="review-header">
        <div class="brand-badge-row">
          <span class="review-icon-badge">✍️</span>
          <span class="badge badge-info">Kind 5401 Review</span>
        </div>
        <h1 class="review-title">Write Review</h1>
        <p class="review-subtitle">
          Share your review as an immutable historical diary log on Nostr, signed and owned by your identity.
        </p>
      </header>

      <!-- Media Summary Header Card -->
      <div class="media-summary-card">
        <img
          v-if="effectivePoster"
          :src="effectivePoster"
          :alt="mediaTitle"
          class="summary-poster"
        />
        <div v-else class="summary-poster-fallback">
          {{ mediaType === 'music' ? '🎵' : mediaType === 'show' ? '📺' : '🎬' }}
        </div>

        <div class="summary-meta">
          <h2 class="summary-title">{{ mediaTitle }}</h2>
          <div class="summary-details">
            <span v-if="mediaArtist" class="summary-artist">{{ mediaArtist }} · </span>
            <span v-if="mediaYear" class="summary-year">{{ mediaYear }} · </span>
            <span class="summary-type">{{ mediaType }}</span>
          </div>
          <span class="contentid-chip summary-cid">{{ contentId }}</span>
        </div>
      </div>

      <div v-if="errorMsg" class="badge badge-danger error-banner">
        {{ errorMsg }}
      </div>

      <!-- Review Form -->
      <div class="form-group">
        <label class="form-label">Score Rating (1 to 10 scale)</label>
        <RatingInput v-model="rating" />
      </div>

      <div class="form-group">
        <label class="form-label">Review Content</label>
        <textarea
          v-model="reviewBody"
          class="textarea"
          rows="6"
          placeholder="What did you think? Share your commentary, analysis, or thoughts..."
        ></textarea>
      </div>

      <div class="checkbox-row">
        <label class="checkbox-label">
          <input v-model="containsSpoiler" type="checkbox" />
          <span>Mark review as containing spoilers</span>
        </label>
      </div>

      <div class="protocol-hint-box">
        <span class="hint-icon">ℹ️</span>
        <span class="hint-text">
          Reviews are published as permanent, append-only Nostr events (Kind 5401) referencing this media's canonical Content ID.
        </span>
      </div>

      <!-- Actions -->
      <footer class="review-footer">
        <button class="btn btn-secondary btn-sm" type="button" :disabled="isSubmitting" @click="goBack">
          Cancel
        </button>
        <button
          class="btn btn-primary btn-sm"
          type="button"
          :disabled="isSubmitting || !reviewBody.trim()"
          @click="handleSubmit"
        >
          <span v-if="isSubmitting" class="btn-spinner"></span>
          <span>{{ isSubmitting ? 'Signing & Broadcasting...' : '⚡ Sign & Post Review' }}</span>
        </button>
      </footer>
    </div>
  </div>
</template>

<style scoped>
.review-page-wrap {
  max-width: 680px;
  margin: 0 auto;
  padding: 12px 0 60px;
}

.page-top-nav {
  margin-bottom: 16px;
}

.btn-back {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  background: transparent;
  border: none;
  color: var(--text-secondary);
  font-size: 0.9rem;
  font-weight: 500;
  cursor: pointer;
  padding: 4px 0;
  transition: color var(--transition-fast);
}

.btn-back:hover {
  color: var(--text-main);
}

.back-arrow {
  font-size: 1.25rem;
  line-height: 1;
}

.review-card {
  padding: 32px 28px;
  background: var(--bg-surface);
  border: 1px solid var(--border-subtle);
  border-radius: var(--radius-lg);
  box-shadow: var(--shadow-lg);
}

.review-header {
  margin-bottom: 24px;
}

.brand-badge-row {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 12px;
}

.review-icon-badge {
  font-size: 1rem;
}

.review-title {
  font-size: 1.75rem;
  font-weight: 700;
  letter-spacing: -0.03em;
  margin: 0 0 8px 0;
  color: var(--text-main);
}

.review-subtitle {
  font-size: 0.9rem;
  color: var(--text-muted);
  line-height: 1.5;
  margin: 0;
}

.media-summary-card {
  display: flex;
  align-items: center;
  gap: 16px;
  background: var(--bg-card);
  border: 1px solid var(--border-subtle);
  border-radius: var(--radius-md);
  padding: 16px;
  margin-bottom: 24px;
}

.summary-poster {
  width: 56px;
  height: 80px;
  object-fit: cover;
  border-radius: var(--radius-xs);
  flex-shrink: 0;
}

.summary-poster-fallback {
  width: 56px;
  height: 80px;
  display: flex;
  align-items: center;
  justify-content: center;
  background: var(--bg-surface);
  border-radius: var(--radius-xs);
  font-size: 1.5rem;
  flex-shrink: 0;
}

.summary-meta {
  display: flex;
  flex-direction: column;
  gap: 4px;
  min-width: 0;
}

.summary-title {
  font-size: 1.15rem;
  font-weight: 700;
  margin: 0;
  color: var(--text-main);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.summary-details {
  font-size: 0.82rem;
  color: var(--text-secondary);
  text-transform: capitalize;
}

.summary-cid {
  margin-top: 4px;
  font-size: 0.72rem;
  max-width: 280px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.error-banner {
  display: block;
  padding: 10px 14px;
  margin-bottom: 20px;
}

.checkbox-row {
  margin: 16px 0;
}

.checkbox-label {
  display: flex;
  align-items: center;
  gap: 10px;
  font-size: 0.88rem;
  color: var(--text-secondary);
  cursor: pointer;
}

.protocol-hint-box {
  display: flex;
  align-items: flex-start;
  gap: 10px;
  background: #000000;
  border: 1px solid var(--border-subtle);
  border-radius: var(--radius-sm);
  padding: 12px 14px;
  margin-bottom: 24px;
}

.hint-icon {
  font-size: 0.95rem;
}

.hint-text {
  font-size: 0.8rem;
  color: var(--text-muted);
  line-height: 1.4;
}

.btn-spinner {
  width: 14px;
  height: 14px;
  border: 2px solid rgba(0, 0, 0, 0.3);
  border-top-color: #000;
  border-radius: 50%;
  animation: spin 0.8s linear infinite;
  display: inline-block;
}

@keyframes spin {
  to {
    transform: rotate(360deg);
  }
}

.review-footer {
  display: flex;
  align-items: center;
  justify-content: space-between;
  border-top: 1px solid var(--border-subtle);
  padding-top: 20px;
}

@media (max-width: 640px) {
  .review-card {
    padding: 24px 18px;
  }
}
</style>
