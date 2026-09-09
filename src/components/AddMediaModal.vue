<script setup>
import { ref, computed, watch } from 'vue'
import { useRouter } from 'vue-router'
import { useMediaStore } from '@/stores/media.js'
import { useAuthStore } from '@/stores/auth.js'
import { computeContentId, buildDTag } from '@/utils/contentId.js'
import { formatStatus, getStatusColorClass } from '@/utils/formatters.js'
import { resolveIpfsUrl } from '@/services/originless.js'
import RatingInput from './RatingInput.vue'

const emit = defineEmits(['close', 'saved'])
const router = useRouter()
const mediaStore = useMediaStore()
const authStore = useAuthStore()

// Selected Media Type: 'movie' | 'show' | 'music'
const selectedType = ref('movie')

// Form fields
const title = ref('')
const artist = ref('')
const year = ref(new Date().getFullYear().toString())
const season = ref('')
const episode = ref('')
const status = ref('watching')
const rating = ref(null)
const note = ref('')
const posterUrl = ref('')

// Autocomplete state
const showSuggestions = ref(false)
const isSubmitting = ref(false)
const errorMsg = ref('')

// Content ID & canonical string calculation
const canonicalString = ref('')
const contentId = ref('')
const currentDTag = ref('')

// Compute autocomplete suggestions from Nostr events
const eventSuggestions = computed(() => {
  if (!title.value) {
    return mediaStore.searchEventAutocomplete(selectedType.value, '').slice(0, 5)
  }
  return mediaStore.searchEventAutocomplete(selectedType.value, title.value)
})

// Update status options when type changes
watch(selectedType, (newType) => {
  if (newType === 'music') {
    status.value = 'listening'
  } else {
    status.value = 'watching'
  }
  updateCanonicalHash()
})

// Recompute canonical hash and content ID whenever fields change
watch([selectedType, title, year, artist, season, episode], () => {
  updateCanonicalHash()
})

async function updateCanonicalHash() {
  if (!title.value.trim()) {
    canonicalString.value = ''
    contentId.value = ''
    currentDTag.value = ''
    return
  }

  try {
    const res = await computeContentId({
      type: selectedType.value,
      title: title.value.trim(),
      year: year.value.trim(),
      artist: selectedType.value === 'music' ? artist.value.trim() : '',
    })

    canonicalString.value = res.canonicalString
    contentId.value = res.contentId

    currentDTag.value = buildDTag({
      contentId: res.contentId,
      season: season.value ? Number(season.value) : undefined,
      episode: episode.value ? Number(episode.value) : undefined,
    })
  } catch (err) {
    console.warn('Content ID calculation error:', err)
  }
}

function selectSuggestion(item) {
  title.value = item.title || item.name || ''
  if (item.year) year.value = String(item.year)
  if (item.artist) artist.value = item.artist
  if (item.poster) posterUrl.value = item.poster
  if (item.type) selectedType.value = item.type

  showSuggestions.value = false
  updateCanonicalHash()
}

async function handleSave() {
  if (!title.value.trim()) {
    errorMsg.value = 'Please enter a title.'
    return
  }

  if (!authStore.isAuthenticated) {
    errorMsg.value = 'Please connect your Nostr extension to save media.'
    return
  }

  isSubmitting.value = true
  errorMsg.value = ''

  try {
    await updateCanonicalHash()

    const mediaObj = {
      contentId: contentId.value,
      type: selectedType.value,
      title: title.value.trim(),
      name: title.value.trim(),
      year: year.value.trim(),
      artist: selectedType.value === 'music' ? artist.value.trim() : '',
      poster: posterUrl.value,
      season: season.value ? Number(season.value) : undefined,
      episode: episode.value ? Number(episode.value) : undefined,
    }

    // Cache locally
    mediaStore.cacheMediaItem(mediaObj)

    // 1. Publish Status (Kind 35402) & Activity check-in (Kind 5402)
    const progressStr = season.value && episode.value ? `s${season.value}e${episode.value}` : ''
    await mediaStore.setStatus(mediaObj, status.value, progressStr, note.value)

    // 2. Publish Rating (Kind 35400) if selected
    if (rating.value !== null && rating.value !== undefined && Number(rating.value) > 0) {
      await mediaStore.setRating(mediaObj, Number(rating.value), note.value)
    }

    emit('saved', mediaObj)
    emit('close')

    // Navigate to media detail view
    router.push({
      name: 'media-detail',
      params: { contentId: contentId.value },
      query: {
        type: mediaObj.type,
        title: mediaObj.title,
        year: mediaObj.year,
        artist: mediaObj.artist,
      },
    })
  } catch (err) {
    console.error('Failed to save media to Nostr:', err)
    errorMsg.value = err.message || 'Failed to publish event to Nostr.'
  } finally {
    isSubmitting.value = false
  }
}
</script>

<template>
  <div class="modal-overlay" @click.self="$emit('close')">
    <div class="modal-dialog modal-add">
      <div class="modal-header">
        <div>
          <h2 class="modal-title">Track New Media</h2>
          <p class="modal-sub">Add movies, series, or music to your Nostr library</p>
        </div>
        <button class="btn btn-icon" type="button" @click="$emit('close')">✕</button>
      </div>

      <div class="modal-body">
        <div v-if="errorMsg" class="badge badge-danger error-banner">
          {{ errorMsg }}
        </div>

        <!-- 3 Minimal Cards Selector -->
        <div class="type-cards-grid">
          <!-- Movie Card -->
          <div
            class="minimal-type-card"
            :class="{ 'is-selected': selectedType === 'movie' }"
            @click="selectedType = 'movie'"
          >
            <div class="type-icon-wrap">
              <span class="type-icon">🎬</span>
            </div>
            <div class="type-info">
              <span class="type-name">Movie</span>
              <span class="type-desc">Feature films</span>
            </div>
            <div v-if="selectedType === 'movie'" class="active-dot"></div>
          </div>

          <!-- Series Card -->
          <div
            class="minimal-type-card"
            :class="{ 'is-selected': selectedType === 'show' }"
            @click="selectedType = 'show'"
          >
            <div class="type-icon-wrap">
              <span class="type-icon">📺</span>
            </div>
            <div class="type-info">
              <span class="type-name">Series</span>
              <span class="type-desc">TV shows & anime</span>
            </div>
            <div v-if="selectedType === 'show'" class="active-dot"></div>
          </div>

          <!-- Music Card -->
          <div
            class="minimal-type-card"
            :class="{ 'is-selected': selectedType === 'music' }"
            @click="selectedType = 'music'"
          >
            <div class="type-icon-wrap">
              <span class="type-icon">🎵</span>
            </div>
            <div class="type-info">
              <span class="type-name">Music</span>
              <span class="type-desc">Albums & tracks</span>
            </div>
            <div v-if="selectedType === 'music'" class="active-dot"></div>
          </div>
        </div>

        <!-- Showcase Form Fields -->
        <div class="showcase-fields-container card">
          <!-- Title with Autocomplete from Nostr Events -->
          <div class="form-group autocomplete-group">
            <label class="form-label">
              {{ selectedType === 'music' ? 'Album / Track Title' : 'Title' }}
              <span class="badge badge-info autocomplete-badge">Events Autocomplete</span>
            </label>
            <div class="input-relative">
              <input
                v-model="title"
                type="text"
                class="input"
                :placeholder="selectedType === 'music' ? 'e.g. Nevermind' : selectedType === 'show' ? 'e.g. Breaking Bad' : 'e.g. Fight Club'"
                autocomplete="off"
                @focus="showSuggestions = true"
                @input="showSuggestions = true"
              />
              <span v-if="title" class="clear-btn" @click="title = ''; updateCanonicalHash()">✕</span>
            </div>

            <!-- Autocomplete Dropdown List -->
            <div
              v-if="showSuggestions && eventSuggestions.length > 0"
              class="autocomplete-dropdown card"
            >
              <div class="dropdown-category-title">
                Matches from Nostr Events & Library:
              </div>
              <div
                v-for="sug in eventSuggestions"
                :key="sug.contentId"
                class="suggestion-item"
                @mousedown.prevent="selectSuggestion(sug)"
              >
                <img
                  v-if="sug.poster"
                  :src="resolveIpfsUrl(sug.poster)"
                  class="sug-poster"
                  alt=""
                  @error="$event.target.style.display = 'none'"
                />
                <div v-else class="sug-poster-fallback">
                  {{ sug.type === 'music' ? '🎵' : sug.type === 'show' ? '📺' : '🎬' }}
                </div>

                <div class="sug-details">
                  <span class="sug-title">{{ sug.title || sug.name }}</span>
                  <span class="sug-sub">
                    <span v-if="sug.artist">{{ sug.artist }} · </span>
                    <span v-if="sug.year">{{ sug.year }}</span>
                    <span v-if="sug.userStatus" class="sug-status"> ({{ formatStatus(sug.userStatus) }})</span>
                  </span>
                </div>

                <span class="badge badge-neutral sug-chip">Nostr Event</span>
              </div>
            </div>
          </div>

          <!-- Artist (Music only) -->
          <div v-if="selectedType === 'music'" class="form-group">
            <label class="form-label">Artist / Band</label>
            <input
              v-model="artist"
              type="text"
              class="input"
              placeholder="e.g. Nirvana"
            />
          </div>

          <!-- Year -->
          <div class="form-row">
            <div class="form-group flex-1">
              <label class="form-label">Release Year</label>
              <input
                v-model="year"
                type="text"
                class="input"
                placeholder="YYYY"
                maxlength="4"
              />
            </div>

            <!-- Season & Episode (Series only) -->
            <template v-if="selectedType === 'show'">
              <div class="form-group flex-1">
                <label class="form-label">Season (Optional)</label>
                <input
                  v-model="season"
                  type="number"
                  min="0"
                  class="input"
                  placeholder="e.g. 1"
                />
              </div>
              <div class="form-group flex-1">
                <label class="form-label">Episode (Optional)</label>
                <input
                  v-model="episode"
                  type="number"
                  min="1"
                  class="input"
                  placeholder="e.g. 3"
                />
              </div>
            </template>
          </div>

          <!-- Status & Rating in Columns -->
          <div class="form-row">
            <div class="form-group flex-1">
              <label class="form-label">Status (Kind 35402)</label>
              <select v-model="status" class="select">
                <template v-if="selectedType === 'music'">
                  <option value="listening">Listening</option>
                  <option value="plan-to-listen">Plan to Listen</option>
                  <option value="completed">Completed</option>
                </template>
                <template v-else>
                  <option value="watching">Watching</option>
                  <option value="completed">Completed</option>
                  <option value="plan-to-watch">Plan to Watch</option>
                  <option value="on-hold">On Hold</option>
                  <option value="dropped">Dropped</option>
                </template>
              </select>
            </div>

            <div class="form-group flex-1">
              <label class="form-label">Rating Score (Kind 35400)</label>
              <RatingInput v-model="rating" />
            </div>
          </div>

          <!-- Note -->
          <div class="form-group">
            <label class="form-label">Note / Check-in comment (Optional)</label>
            <input
              v-model="note"
              type="text"
              class="input"
              placeholder="e.g. Starting season 2"
            />
          </div>

          <!-- Real-Time Protocol Preview -->
          <div v-if="canonicalString" class="protocol-preview card">
            <div class="preview-header">
              <span class="preview-title">Nostr Protocol Schema (AGENTS.md)</span>
              <span class="badge badge-success">Valid Canonical Hash</span>
            </div>

            <div class="preview-row">
              <span class="preview-label">Canonical:</span>
              <code class="preview-code">{{ canonicalString }}</code>
            </div>

            <div class="preview-row">
              <span class="preview-label">contentid:</span>
              <span class="contentid-chip">{{ contentId }}</span>
            </div>

            <div v-if="season && episode" class="preview-row">
              <span class="preview-label">d-tag (NIP-33):</span>
              <span class="contentid-chip">{{ currentDTag }}</span>
            </div>
          </div>
        </div>
      </div>

      <div class="modal-footer">
        <button class="btn btn-secondary" type="button" :disabled="isSubmitting" @click="$emit('close')">
          Cancel
        </button>
        <button
          class="btn btn-primary"
          type="button"
          :disabled="isSubmitting || !title.trim()"
          @click="handleSave"
        >
          {{ isSubmitting ? 'Signing & Broadcasting...' : '⚡ Save & Publish to Nostr' }}
        </button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.modal-add {
  max-width: 640px;
}

.modal-sub {
  font-size: 0.82rem;
  color: var(--text-secondary);
  margin-top: 2px;
}

.error-banner {
  display: block;
  padding: 8px 12px;
  margin-bottom: 14px;
}

/* 3 Minimal Cards Grid */
.type-cards-grid {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 12px;
  margin-bottom: 18px;
}

.minimal-type-card {
  position: relative;
  background: var(--bg-card);
  border: 1px solid var(--border-subtle);
  border-radius: var(--radius-md);
  padding: 14px 12px;
  display: flex;
  flex-direction: column;
  align-items: center;
  text-align: center;
  cursor: pointer;
  transition: all var(--transition-normal);
}

.minimal-type-card:hover {
  background: var(--bg-card-hover);
  border-color: var(--border-hover);
  transform: translateY(-2px);
}

.minimal-type-card.is-selected {
  border-color: var(--primary);
  background: var(--primary-light);
  box-shadow: 0 0 16px var(--primary-glow);
}

.type-icon-wrap {
  width: 40px;
  height: 40px;
  border-radius: var(--radius-sm);
  background: var(--bg-surface);
  display: flex;
  align-items: center;
  justify-content: center;
  margin-bottom: 8px;
}

.type-icon {
  font-size: 1.4rem;
}

.type-name {
  font-weight: 700;
  font-size: 0.95rem;
  color: var(--text-main);
}

.type-desc {
  font-size: 0.72rem;
  color: var(--text-muted);
  margin-top: 2px;
}

.active-dot {
  position: absolute;
  top: 8px;
  right: 8px;
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: var(--primary);
}

/* Showcase Form */
.showcase-fields-container {
  background: var(--bg-surface);
  padding: 18px;
}

.autocomplete-group {
  position: relative;
}

.autocomplete-badge {
  font-size: 0.68rem;
  margin-left: 8px;
}

.input-relative {
  position: relative;
}

.clear-btn {
  position: absolute;
  right: 12px;
  top: 50%;
  transform: translateY(-50%);
  color: var(--text-muted);
  cursor: pointer;
  font-size: 0.85rem;
}

.clear-btn:hover {
  color: var(--text-main);
}

.autocomplete-dropdown {
  position: absolute;
  top: calc(100% + 4px);
  left: 0;
  right: 0;
  z-index: 50;
  max-height: 240px;
  overflow-y: auto;
  padding: 6px;
  box-shadow: var(--shadow-lg);
  border-color: var(--border-hover);
}

.dropdown-category-title {
  font-size: 0.72rem;
  text-transform: uppercase;
  color: var(--text-muted);
  padding: 6px 10px;
  font-weight: 600;
  letter-spacing: 0.04em;
}

.suggestion-item {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 8px 10px;
  border-radius: var(--radius-xs);
  cursor: pointer;
  transition: background var(--transition-fast);
}

.suggestion-item:hover {
  background: var(--primary-light);
}

.sug-poster {
  width: 30px;
  height: 42px;
  object-fit: cover;
  border-radius: 4px;
}

.sug-poster-fallback {
  width: 30px;
  height: 42px;
  display: flex;
  align-items: center;
  justify-content: center;
  background: var(--bg-card);
  border-radius: 4px;
  font-size: 1rem;
}

.sug-details {
  flex: 1;
  display: flex;
  flex-direction: column;
}

.sug-title {
  font-weight: 600;
  font-size: 0.88rem;
}

.sug-sub {
  font-size: 0.76rem;
  color: var(--text-secondary);
}

.sug-status {
  color: var(--accent-emerald);
}

.sug-chip {
  font-size: 0.65rem;
}

.form-row {
  display: flex;
  gap: 12px;
}

.flex-1 {
  flex: 1;
}

/* Protocol Preview */
.protocol-preview {
  margin-top: 14px;
  padding: 12px;
  background: var(--bg-card);
  border: 1px solid var(--border-subtle);
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.preview-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 2px;
}

.preview-title {
  font-size: 0.78rem;
  font-weight: 700;
  text-transform: uppercase;
  color: var(--text-muted);
  letter-spacing: 0.04em;
}

.preview-row {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 0.82rem;
  overflow: hidden;
}

.preview-label {
  color: var(--text-secondary);
  min-width: 80px;
}

.preview-code {
  font-family: var(--font-mono);
  color: var(--accent-amber);
  background: var(--bg-input);
  padding: 2px 6px;
  border-radius: 4px;
  word-break: break-all;
}
</style>
