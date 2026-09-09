<script setup>
import { ref } from 'vue'
import { mirrorRemoteUrlToOriginless, uploadToOriginless } from '@/services/originless.js'
import { useMediaStore } from '@/stores/media.js'
import { useSettingsStore } from '@/stores/settings.js'
import { useAuthStore } from '@/stores/auth.js'

const props = defineProps({
  media: {
    type: Object,
    required: true,
  },
})

const emit = defineEmits(['close', 'seeded'])

const mediaStore = useMediaStore()
const settingsStore = useSettingsStore()
const authStore = useAuthStore()

const isProcessing = ref(false)
const stepStatus = ref('')
const errorMsg = ref('')
const warnMsg = ref('')

const customPosterFile = ref(null)
const overviewText = ref(props.media.overview || '')
const genreInput = ref((props.media.genres || []).join(', '))

async function handleSeed() {
  if (!authStore.isAuthenticated) {
    authStore.openLoginModal()
    emit('close')
    return
  }

  isProcessing.value = true
  errorMsg.value = ''
  warnMsg.value = ''

  try {
    let posterCidUri = ''
    let bannerCidUri = ''

    // 1. Upload or mirror poster to Originless IPFS node
    if (customPosterFile.value) {
      stepStatus.value = 'Uploading poster to Originless IPFS...'
      const res = await uploadToOriginless(customPosterFile.value, {
        instanceUrl: settingsStore.originlessUrl,
        anonymize: true,
      })
      posterCidUri = res.ipfsUri
    } else if (props.media.poster && props.media.poster.startsWith('ipfs://')) {
      posterCidUri = props.media.poster
    } else if (props.media.poster && props.media.poster.startsWith('http')) {
      stepStatus.value = 'Pinning poster to Originless IPFS swarm...'
      try {
        const res = await mirrorRemoteUrlToOriginless(
          props.media.poster,
          `${props.media.contentId}-poster.jpg`,
          settingsStore.originlessUrl
        )
        posterCidUri = res.ipfsUri
      } catch (err) {
        console.warn('Failed to mirror poster to IPFS, continuing without poster CID:', err)
        warnMsg.value = 'Poster could not be pinned to IPFS — seeding metadata without poster art.'
      }
    }

    // 2. Mirror banner if present
    if (props.media.banner && props.media.banner.startsWith('http')) {
      stepStatus.value = 'Pinning backdrop to Originless IPFS swarm...'
      try {
        const res = await mirrorRemoteUrlToOriginless(
          props.media.banner,
          `${props.media.contentId}-banner.jpg`,
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
    stepStatus.value = 'Signing and publishing Kind 35403 event via Nostr extension...'
    const genres = genreInput.value
      .split(',')
      .map((g) => g.trim())
      .filter(Boolean)

    await mediaStore.seedMetadata(props.media, {
      poster: posterCidUri,
      banner: bannerCidUri,
      genres,
      lang: 'en',
      overview: overviewText.value,
    })

    emit('seeded')
    emit('close')
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
</script>

<template>
  <div class="modal-overlay" @click.self="$emit('close')">
    <div class="modal-dialog">
      <div class="sheet-drag-handle"></div>
      <div class="modal-header">
        <h2 class="modal-title">Seed Metadata to Nostr (Kind 35403)</h2>
        <button class="btn btn-icon" type="button" @click="$emit('close')">✕</button>
      </div>

      <div class="modal-body">
        <p class="intro-text">
          Decentralize this media's metadata! Artwork is pinned to IPFS via
          <a :href="settingsStore.originlessUrl" target="_blank" rel="noopener" class="link">Originless</a>,
          and published as a <strong>NIP-33 Parameterized Replaceable Event</strong> on Nostr without centralized tracking.
        </p>

        <div v-if="errorMsg" class="badge badge-danger error-banner">
          {{ errorMsg }}
        </div>

        <div v-if="warnMsg" class="badge badge-warning warn-banner">
          {{ warnMsg }}
        </div>

        <div class="form-group">
          <label class="form-label">Content ID (Canonical)</label>
          <div class="contentid-chip">{{ media.contentId }}</div>
        </div>

        <div class="form-group">
          <label class="form-label">Synopsis / Overview</label>
          <textarea v-model="overviewText" class="textarea" rows="3"></textarea>
        </div>

        <div class="form-group">
          <label class="form-label">Genres (comma-separated)</label>
          <input v-model="genreInput" type="text" class="input" />
        </div>

        <div class="form-group">
          <label class="form-label">Custom Poster Artwork (Optional)</label>
          <input type="file" accept="image/*" class="input" @change="onFileSelect" />
          <p class="form-hint">
            Will be anonymized and pinned directly to the Originless IPFS swarm.
          </p>
        </div>

        <div v-if="stepStatus" class="step-status">
          <span class="loading-spinner"></span>
          {{ stepStatus }}
        </div>
      </div>

      <div class="modal-footer">
        <button class="btn btn-secondary" type="button" :disabled="isProcessing" @click="$emit('close')">
          Cancel
        </button>
        <button class="btn btn-primary" type="button" :disabled="isProcessing" @click="handleSeed">
          {{ isProcessing ? 'Seeding...' : 'Sign & Seed to Nostr' }}
        </button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.intro-text {
  font-size: 0.88rem;
  color: var(--text-secondary);
  margin-bottom: 16px;
  line-height: 1.4;
}

.link {
  color: var(--primary);
  text-decoration: underline;
}

.error-banner {
  display: block;
  padding: 8px 12px;
  margin-bottom: 14px;
}

.warn-banner {
  display: block;
  padding: 8px 12px;
  margin-bottom: 14px;
}

.step-status {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 10px 14px;
  background: var(--bg-card);
  border-radius: var(--radius-sm);
  font-size: 0.85rem;
  color: var(--primary);
  margin-top: 12px;
}

.loading-spinner {
  width: 14px;
  height: 14px;
  border: 2px solid var(--primary);
  border-top-color: transparent;
  border-radius: 50%;
  animation: spin 0.7s linear infinite;
}

@keyframes spin {
  to {
    transform: rotate(360deg);
  }
}
</style>
