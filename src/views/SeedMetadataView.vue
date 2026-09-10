<script setup>
import { ref, computed, onMounted } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { mirrorRemoteUrlToOriginless, uploadToOriginless, resolveIpfsUrl } from '@/services/originless.js'
import { useIpfsImage } from '@/composables/useIpfsImage.js'
import { safeMediaUrl } from '@/utils/urls.js'
import { useMediaStore } from '@/stores/media.js'
import { useSettingsStore } from '@/stores/settings.js'
import { useAuthStore } from '@/stores/auth.js'

const route = useRoute()
const router = useRouter()
const mediaStore = useMediaStore()
const settingsStore = useSettingsStore()
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

const { src: posterSrc, onError: onPosterError } = useIpfsImage(() => {
  return communityMeta.value?.poster || cachedMedia.value.poster || ''
})
const effectivePoster = computed(() => safeMediaUrl(posterSrc.value))

const isProcessing = ref(false)
const stepStatus = ref('')
const errorMsg = ref('')
const warnMsg = ref('')

const customPosterFile = ref(null)
const overviewText = ref('')
const genreInput = ref('')

function goBack() {
  if (contentId.value) {
    router.push(`/media/${contentId.value}`)
  } else if (window.history.length > 1) {
    router.back()
  } else {
    router.push('/')
  }
}

async function handleSeed() {
  if (!authStore.isAuthenticated) {
    router.push({
      path: '/connect',
      query: { returnTo: `/media/${contentId.value}/seed` },
    })
    return
  }

  isProcessing.value = true
  errorMsg.value = ''
  warnMsg.value = ''

  try {
    let posterCidUri = ''
    let bannerCidUri = ''
    const currentPoster = cachedMedia.value.poster || ''
    const currentBanner = cachedMedia.value.banner || ''

    // 1. Upload or mirror poster to Originless IPFS node
    if (customPosterFile.value) {
      stepStatus.value = 'Uploading custom poster to Originless IPFS...'
      const res = await uploadToOriginless(customPosterFile.value, {
        instanceUrl: settingsStore.originlessUrl,
        anonymize: true,
      })
      posterCidUri = res.ipfsUri
    } else if (currentPoster && currentPoster.startsWith('ipfs://')) {
      posterCidUri = currentPoster
    } else if (currentPoster && currentPoster.startsWith('http')) {
      stepStatus.value = 'Pinning poster to Originless IPFS swarm...'
      try {
        const res = await mirrorRemoteUrlToOriginless(
          currentPoster,
          `${contentId.value}-poster.jpg`,
          settingsStore.originlessUrl
        )
        posterCidUri = res.ipfsUri
      } catch (err) {
        console.warn('Failed to mirror poster to IPFS, continuing without poster CID:', err)
        warnMsg.value = 'Poster could not be pinned to IPFS — seeding metadata without poster art.'
      }
    }

    // 2. Mirror banner if present
    if (currentBanner && currentBanner.startsWith('http')) {
      stepStatus.value = 'Pinning backdrop to Originless IPFS swarm...'
      try {
        const res = await mirrorRemoteUrlToOriginless(
          currentBanner,
          `${contentId.value}-banner.jpg`,
          settingsStore.originlessUrl
        )
        bannerCidUri = res.ipfsUri
      } catch (err) {
        console.warn('Failed to mirror banner to IPFS:', err)
        warnMsg.value = warnMsg.value
          ? `${warnMsg.value} Backdrop could not be pinned either.`
          : 'Backdrop could not be pinned to IPFS — seeding metadata without backdrop art.'
      }
    }

    // 3. Construct and sign Kind 35403 event
    stepStatus.value = 'Signing and publishing Kind 35403 event via Nostr...'
    const genres = genreInput.value
      .split(',')
      .map((g) => g.trim())
      .filter(Boolean)

    const mediaObj = {
      contentId: contentId.value,
      title: mediaTitle.value,
      name: mediaTitle.value,
      year: mediaYear.value,
      type: mediaType.value,
      poster: posterCidUri || currentPoster,
      banner: bannerCidUri || currentBanner,
    }

    await mediaStore.seedMetadata(mediaObj, {
      poster: posterCidUri,
      banner: bannerCidUri,
      genres,
      lang: 'en',
      overview: overviewText.value,
    })

    // Return to media details
    router.push(`/media/${contentId.value}`)
  } catch (err) {
    console.error('Seeding failed:', err)
    errorMsg.value = err.message || 'Failed to seed metadata to Nostr.'
  } finally {
    isProcessing.value = false
    stepStatus.value = ''
  }
}

function onFileSelect(e) {
  const file = e.target.files[0]
  if (file) {
    customPosterFile.value = file
  }
}

onMounted(async () => {
  if (contentId.value && !cachedMedia.value.title) {
    await mediaStore.fetchMediaDetails(contentId.value).catch(() => {})
  }
  overviewText.value = communityMeta.value?.overview || cachedMedia.value.overview || ''
  genreInput.value = (communityMeta.value?.genres || cachedMedia.value.genres || []).join(', ')
})
</script>

<template>
  <div class="seed-page-wrap">
    <div class="page-top-nav">
      <button class="btn-back" type="button" @click="goBack">
        <span class="back-arrow">‹</span>
        <span>Back to Media</span>
      </button>
    </div>

    <div class="seed-card card">
      <header class="seed-header">
        <div class="brand-badge-row">
          <span class="seed-icon-badge">🌱</span>
          <span class="badge badge-success">Kind 35403 Curation</span>
        </div>
        <h1 class="seed-title">Seed Metadata to Nostr</h1>
        <p class="seed-subtitle">
          Decentralize this media's metadata on Nostr. Media artwork is pinned to IPFS via
          <a :href="settingsStore.originlessUrl" target="_blank" rel="noopener" class="link">Originless</a>,
          and published as a <strong>NIP-33 Parameterized Replaceable Event</strong>.
        </p>
      </header>

      <!-- Media Summary Header Card -->
      <div class="media-summary-card">
        <img
          v-if="effectivePoster"
          :src="effectivePoster"
          :alt="mediaTitle"
          class="summary-poster"
          @error="onPosterError"
        />
        <div v-else class="summary-poster-fallback">
          {{ mediaType === 'music' ? '🎵' : mediaType === 'show' ? '📺' : '🎬' }}
        </div>

        <div class="summary-meta">
          <h2 class="summary-title">{{ mediaTitle }}</h2>
          <div class="summary-details">
            <span v-if="mediaYear" class="summary-year">{{ mediaYear }} · </span>
            <span class="summary-type">{{ mediaType }}</span>
          </div>
          <span class="contentid-chip summary-cid">{{ contentId }}</span>
        </div>
      </div>

      <div v-if="errorMsg" class="badge badge-danger error-banner">
        {{ errorMsg }}
      </div>

      <div v-if="warnMsg" class="badge badge-warning warn-banner">
        {{ warnMsg }}
      </div>

      <!-- Form Inputs -->
      <div class="form-group">
        <label class="form-label">Synopsis / Overview</label>
        <textarea
          v-model="overviewText"
          class="textarea"
          rows="4"
          placeholder="Enter media synopsis or description..."
        ></textarea>
      </div>

      <div class="form-group">
        <label class="form-label">Genres (comma-separated)</label>
        <input
          v-model="genreInput"
          type="text"
          class="input"
          placeholder="e.g. Drama, Thriller, Mystery"
        />
      </div>

      <div class="form-group">
        <label class="form-label">Custom Poster Artwork (Optional)</label>
        <input type="file" accept="image/*" class="input" @change="onFileSelect" />
        <p class="form-hint">
          Image will be anonymized and pinned directly to the Originless IPFS swarm.
        </p>
      </div>

      <div v-if="stepStatus" class="step-status">
        <span class="loading-spinner"></span>
        {{ stepStatus }}
      </div>

      <!-- Action Footer -->
      <footer class="seed-footer">
        <button class="btn btn-secondary btn-sm" type="button" :disabled="isProcessing" @click="goBack">
          Cancel
        </button>
        <button
          class="btn btn-primary btn-sm"
          type="button"
          :disabled="isProcessing"
          @click="handleSeed"
        >
          <span v-if="isProcessing" class="btn-spinner"></span>
          <span>{{ isProcessing ? 'Seeding...' : '⚡ Sign & Seed to Nostr' }}</span>
        </button>
      </footer>
    </div>
  </div>
</template>

<style scoped>
.seed-page-wrap {
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

.seed-card {
  padding: 32px 28px;
  background: var(--bg-surface);
  border: 1px solid var(--border-subtle);
  border-radius: var(--radius-lg);
  box-shadow: var(--shadow-lg);
}

.seed-header {
  margin-bottom: 24px;
}

.brand-badge-row {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 12px;
}

.seed-icon-badge {
  font-size: 1rem;
}

.seed-title {
  font-size: 1.75rem;
  font-weight: 700;
  letter-spacing: -0.03em;
  margin: 0 0 8px 0;
  color: var(--text-main);
}

.seed-subtitle {
  font-size: 0.9rem;
  color: var(--text-muted);
  line-height: 1.5;
  margin: 0;
}

.link {
  color: var(--primary);
  text-decoration: underline;
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

.warn-banner {
  display: block;
  padding: 10px 14px;
  margin-bottom: 20px;
}

.step-status {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 12px 14px;
  background: #000000;
  border: 1px solid var(--border-subtle);
  border-radius: var(--radius-sm);
  font-size: 0.85rem;
  color: var(--accent-emerald);
  margin-bottom: 20px;
}

.loading-spinner {
  width: 14px;
  height: 14px;
  border: 2px solid var(--accent-emerald);
  border-top-color: transparent;
  border-radius: 50%;
  animation: spin 0.7s linear infinite;
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

.seed-footer {
  display: flex;
  align-items: center;
  justify-content: space-between;
  border-top: 1px solid var(--border-subtle);
  padding-top: 20px;
}

@media (max-width: 640px) {
  .seed-page-wrap {
    padding: 4px 0 80px;
  }

  .seed-card {
    padding: 20px 16px;
    border-radius: var(--radius-md);
  }

  .seed-title {
    font-size: 1.45rem;
  }

  .media-summary-card {
    flex-direction: column;
    align-items: center;
    text-align: center;
    gap: 12px;
  }

  .summary-cid {
    max-width: 100%;
    word-break: break-all;
    white-space: normal;
  }

  .seed-footer {
    flex-direction: column-reverse;
    gap: 10px;
  }

  .seed-footer .btn {
    width: 100%;
    justify-content: center;
    min-height: 42px;
  }
}
</style>
