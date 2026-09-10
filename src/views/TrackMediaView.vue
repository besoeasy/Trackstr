<script setup>
import { ref, reactive, watch, onMounted } from 'vue'
import { useRouter, useRoute } from 'vue-router'
import { useMediaStore } from '@/stores/media.js'
import { useAuthStore } from '@/stores/auth.js'
import { computeContentId, buildDTag } from '@/utils/contentId.js'
import { formatStatus } from '@/utils/formatters.js'
import { resolveIpfsUrl } from '@/composables/useIpfsImage.js'
import { searchTmdb } from '@/services/api/tmdb.js'
import { searchMusic } from '@/services/api/music.js'
import RatingInput from '@/components/RatingInput.vue'

const router = useRouter()
const route = useRoute()
const mediaStore = useMediaStore()
const authStore = useAuthStore()

// Selected Media Type: 'movie' | 'show' | 'music'
const initialType = ['movie', 'show', 'music'].includes(route.query.type) ? route.query.type : 'movie'
const selectedType = ref(initialType)

// Form fields
const title = ref(route.query.title || '')
const artist = ref(route.query.artist || '')
const year = ref(route.query.year || new Date().getFullYear().toString())
const season = ref(route.query.season || '')
const episode = ref(route.query.episode || '')
const status = ref(selectedType.value === 'music' ? 'listening' : 'watching')
const rating = ref(null)
const note = ref('')
const posterUrl = ref('')

// Category-scoped autocomplete state
const showSuggestions = ref(false)
const suggestions = ref([])
const isSearchingSuggestions = ref(false)
const isSubmitting = ref(false)
const errorMsg = ref('')
let suggestDebounceTimer = null

const failedSuggestionPosters = reactive(new Set())

function suggestionPosterUrl(poster) {
  if (!poster || failedSuggestionPosters.has(poster)) return ''
  return resolveIpfsUrl(poster)
}

function onSuggestionPosterError(poster) {
  if (poster) failedSuggestionPosters.add(poster)
}

// Content ID & canonical string calculation
const canonicalString = ref('')
const contentId = ref('')
const currentDTag = ref('')

function goBack() {
  if (window.history.length > 1) {
    router.back()
  } else {
    router.push('/')
  }
}

async function fetchCategorySuggestions() {
  const q = title.value.trim()
  if (!q) {
    const eventMatches = mediaStore.searchEventAutocomplete(selectedType.value, '').slice(0, 5)
    suggestions.value = eventMatches.map((m) => ({ ...m, isNostrEvent: true }))
    return
  }

  isSearchingSuggestions.value = true
  try {
    const eventMatches = mediaStore.searchEventAutocomplete(selectedType.value, q).map((m) => ({
      ...m,
      isNostrEvent: true,
    }))

    let providerResults = []
    if (selectedType.value === 'movie') {
      providerResults = await searchTmdb(q, 'movies')
    } else if (selectedType.value === 'show') {
      providerResults = await searchTmdb(q, 'shows')
    } else if (selectedType.value === 'music') {
      providerResults = await searchMusic(q)
    }

    const seen = new Set()
    const merged = []

    for (const em of eventMatches) {
      const key = `${em.type}|${(em.title || em.name || '').toLowerCase()}|${em.year || ''}`
      if (!seen.has(key)) {
        seen.add(key)
        merged.push(em)
      }
    }

    for (const pr of providerResults) {
      const key = `${pr.type}|${(pr.title || pr.name || '').toLowerCase()}|${pr.year || ''}`
      if (!seen.has(key)) {
        seen.add(key)
        merged.push(pr)
      }
    }

    suggestions.value = merged.slice(0, 8)
  } catch (err) {
    console.warn('Category autocomplete fetch failed:', err)
  } finally {
    isSearchingSuggestions.value = false
  }
}

function onTitleInput() {
  showSuggestions.value = true
  clearTimeout(suggestDebounceTimer)
  suggestDebounceTimer = setTimeout(() => {
    fetchCategorySuggestions()
  }, 300)
}

watch(selectedType, (newType) => {
  if (newType === 'music') {
    status.value = 'listening'
  } else {
    status.value = 'watching'
  }
  suggestions.value = []
  if (title.value.trim()) {
    fetchCategorySuggestions()
  }
  updateCanonicalHash()
})

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
    canonicalString.value = ''
    contentId.value = ''
    currentDTag.value = ''
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

  if (selectedType.value === 'music' && !artist.value.trim()) {
    errorMsg.value = 'Artist is required for music — it is part of the canonical content ID.'
    return
  }

  if (!authStore.isAuthenticated) {
    router.push({ path: '/connect', query: { returnTo: '/track' } })
    return
  }

  isSubmitting.value = true
  errorMsg.value = ''

  try {
    await updateCanonicalHash()
    if (!contentId.value) {
      throw new Error('Could not compute a content ID from these fields.')
    }

    const seasonNum = season.value === '' || season.value === null ? undefined : Number(season.value)
    const episodeNum = episode.value === '' || episode.value === null ? undefined : Number(episode.value)
    const mediaObj = {
      contentId: contentId.value,
      type: selectedType.value === 'show' && seasonNum !== undefined && episodeNum !== undefined ? 'episode' : selectedType.value,
      title: title.value.trim(),
      name: title.value.trim(),
      year: year.value.trim(),
      artist: selectedType.value === 'music' ? artist.value.trim() : '',
      poster: posterUrl.value,
      season: seasonNum,
      episode: episodeNum,
    }

    mediaStore.cacheMediaItem(mediaObj)

    // 1. Publish Status (Kind 35402)
    const progressStr = season.value && episode.value ? `s${season.value}e${episode.value}` : ''
    await mediaStore.setStatus(mediaObj, status.value, progressStr, note.value)

    // 2. Publish Rating (Kind 35400) if selected
    if (rating.value !== null && rating.value !== undefined && Number(rating.value) > 0) {
      await mediaStore.setRating(mediaObj, Number(rating.value), note.value)
    }

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

onMounted(() => {
  if (title.value.trim()) {
    updateCanonicalHash()
  }
})
</script>

<template>
  <div class="track-page-wrap">
    <div class="page-top-nav">
      <button class="btn-back" type="button" @click="goBack">
        <span class="back-arrow">‹</span>
        <span>Back</span>
      </button>
    </div>

    <div class="track-card card">
      <header class="track-header">
        <div class="brand-badge-row">
          <span class="track-icon-badge">⚡</span>
          <span class="badge badge-primary">Media Tracking</span>
        </div>
        <h1 class="track-title">Track Media</h1>
        <p class="track-subtitle">
          Log movies, series, or music to your personal Nostr library with canonical content addressing.
        </p>
      </header>

      <div v-if="errorMsg" class="badge badge-danger error-banner">
        {{ errorMsg }}
      </div>

      <!-- 3 Minimal Type Cards Selector -->
      <div class="type-cards-grid">
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

      <!-- Fields Box -->
      <div class="fields-box">
        <!-- Title with Autocomplete -->
        <div class="form-group autocomplete-group">
          <label class="form-label">
            {{ selectedType === 'music' ? 'Album / Track Title' : 'Title' }}
            <span class="badge badge-neutral autocomplete-badge">
              {{ selectedType === 'movie' ? '🎬 Movies' : selectedType === 'show' ? '📺 Series' : '🎵 Music' }}
            </span>
          </label>
          <div class="input-relative">
            <input
              v-model="title"
              type="text"
              class="input"
              :placeholder="selectedType === 'music' ? 'Search music (e.g. Nevermind, OK Computer)...' : selectedType === 'show' ? 'Search series (e.g. Breaking Bad, Stranger Things)...' : 'Search movies (e.g. Fight Club, Inception)...'"
              autocomplete="off"
              @focus="showSuggestions = true; fetchCategorySuggestions()"
              @input="onTitleInput"
            />
            <span v-if="title" class="clear-btn" @click="title = ''; updateCanonicalHash()">✕</span>
          </div>

          <!-- Dropdown List -->
          <div
            v-if="showSuggestions && (suggestions.length > 0 || isSearchingSuggestions)"
            class="autocomplete-dropdown card"
          >
            <div class="dropdown-category-title">
              {{ isSearchingSuggestions ? 'Searching...' : `Results for ${selectedType === 'movie' ? 'Movies only' : selectedType === 'show' ? 'Series only' : 'Music only'}:` }}
            </div>
            <div
              v-for="sug in suggestions"
              :key="sug.id || sug.contentId"
              class="suggestion-item"
              @mousedown.prevent="selectSuggestion(sug)"
            >
              <img
                v-if="suggestionPosterUrl(sug.poster)"
                :src="suggestionPosterUrl(sug.poster)"
                class="sug-poster"
                alt=""
                @error="onSuggestionPosterError(sug.poster)"
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

              <span v-if="sug.isNostrEvent" class="badge badge-neutral sug-chip">Nostr</span>
              <span v-else-if="sug.sources && sug.sources.length" class="badge badge-info sug-chip">
                {{ sug.sources.join('/') }}
              </span>
              <span v-else class="badge badge-info sug-chip">
                {{ selectedType === 'music' ? 'MusicBrainz' : 'TMDB' }}
              </span>
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

        <!-- Year & Series Season/Episode -->
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

        <!-- Status & Rating -->
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
          <label class="form-label">Check-in Note (Optional)</label>
          <input
            v-model="note"
            type="text"
            class="input"
            placeholder="e.g. Re-watched with director's commentary"
          />
        </div>

        <!-- Protocol Preview -->
        <div v-if="canonicalString" class="protocol-preview">
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

      <!-- Action Footer -->
      <footer class="track-footer">
        <button class="btn btn-secondary btn-sm" type="button" :disabled="isSubmitting" @click="goBack">
          Cancel
        </button>
        <button
          class="btn btn-primary btn-sm"
          type="button"
          :disabled="isSubmitting || !title.trim()"
          @click="handleSave"
        >
          <span v-if="isSubmitting" class="btn-spinner"></span>
          <span>{{ isSubmitting ? 'Signing & Broadcasting...' : '⚡ Save & Publish to Nostr' }}</span>
        </button>
      </footer>
    </div>
  </div>
</template>

<style scoped>
.track-page-wrap {
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

.track-card {
  padding: 32px 28px;
  background: var(--bg-surface);
  border: 1px solid var(--border-subtle);
  border-radius: var(--radius-lg);
  box-shadow: var(--shadow-lg);
}

.track-header {
  margin-bottom: 24px;
}

.brand-badge-row {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 12px;
}

.track-icon-badge {
  font-size: 1rem;
}

.track-title {
  font-size: 1.75rem;
  font-weight: 700;
  letter-spacing: -0.03em;
  margin: 0 0 8px 0;
  color: var(--text-main);
}

.track-subtitle {
  font-size: 0.9rem;
  color: var(--text-muted);
  line-height: 1.5;
  margin: 0;
}

.error-banner {
  display: block;
  padding: 10px 14px;
  margin-bottom: 20px;
}

.type-cards-grid {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 12px;
  margin-bottom: 24px;
}

.minimal-type-card {
  position: relative;
  background: var(--bg-card);
  border: 1px solid var(--border-subtle);
  border-radius: var(--radius-md);
  padding: 16px 12px;
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
}

.minimal-type-card.is-selected {
  border-color: #ffffff;
  background: #141414;
}

[data-theme='light'] .minimal-type-card.is-selected {
  border-color: #000000;
  background: #f5f5f5;
}

.type-icon-wrap {
  width: 44px;
  height: 44px;
  border-radius: var(--radius-sm);
  background: var(--bg-surface);
  display: flex;
  align-items: center;
  justify-content: center;
  margin-bottom: 8px;
}

.type-icon {
  font-size: 1.5rem;
}

.type-name {
  font-weight: 600;
  font-size: 0.95rem;
  color: var(--text-main);
}

.type-desc {
  font-size: 0.74rem;
  color: var(--text-muted);
  margin-top: 2px;
}

.active-dot {
  position: absolute;
  top: 8px;
  right: 8px;
  width: 7px;
  height: 7px;
  border-radius: 50%;
  background: #ffffff;
}

[data-theme='light'] .active-dot {
  background: #000000;
}

.fields-box {
  background: var(--bg-card);
  border: 1px solid var(--border-subtle);
  border-radius: var(--radius-md);
  padding: 22px;
  margin-bottom: 24px;
}

.autocomplete-group {
  position: relative;
}

.autocomplete-badge {
  font-size: 0.7rem;
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
  top: calc(100% + 6px);
  left: 0;
  right: 0;
  z-index: 50;
  max-height: 260px;
  overflow-y: auto;
  padding: 6px;
  box-shadow: var(--shadow-lg);
  border-color: var(--border-hover);
  background: #0a0a0a;
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
  gap: 12px;
  padding: 8px 10px;
  border-radius: var(--radius-xs);
  cursor: pointer;
  transition: background var(--transition-fast);
}

.suggestion-item:hover {
  background: #171717;
}

.sug-poster {
  width: 32px;
  height: 46px;
  object-fit: cover;
  border-radius: 4px;
}

.sug-poster-fallback {
  width: 32px;
  height: 46px;
  display: flex;
  align-items: center;
  justify-content: center;
  background: var(--bg-card);
  border-radius: 4px;
  font-size: 1.1rem;
}

.sug-details {
  flex: 1;
  display: flex;
  flex-direction: column;
}

.sug-title {
  font-weight: 600;
  font-size: 0.88rem;
  color: var(--text-main);
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
  gap: 14px;
}

.flex-1 {
  flex: 1;
}

.protocol-preview {
  margin-top: 18px;
  padding: 14px;
  background: #000000;
  border: 1px solid var(--border-subtle);
  border-radius: var(--radius-sm);
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
  font-size: 0.74rem;
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
  min-width: 84px;
  font-size: 0.76rem;
}

.preview-code {
  font-family: var(--font-mono);
  color: var(--accent-amber);
  background: #111111;
  padding: 2px 6px;
  border-radius: 4px;
  word-break: break-all;
  font-size: 0.78rem;
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

.track-footer {
  display: flex;
  align-items: center;
  justify-content: space-between;
  border-top: 1px solid var(--border-subtle);
  padding-top: 20px;
}

@media (max-width: 640px) {
  .track-page-wrap {
    padding: 4px 0 80px;
  }

  .track-card {
    padding: 20px 16px;
    border-radius: var(--radius-md);
  }

  .track-title {
    font-size: 1.45rem;
  }

  .type-cards-grid {
    gap: 6px;
  }

  .minimal-type-card {
    padding: 10px 6px;
  }

  .type-desc {
    display: none;
  }

  .form-row {
    flex-direction: column;
    gap: 10px;
  }

  .track-footer {
    flex-direction: column-reverse;
    gap: 10px;
  }

  .track-footer .btn {
    width: 100%;
    justify-content: center;
    min-height: 42px;
  }

  .preview-row {
    flex-direction: column;
    align-items: flex-start;
    gap: 4px;
  }

  .preview-code,
  .contentid-chip {
    width: 100%;
    word-break: break-all;
    white-space: normal;
  }
}
</style>
