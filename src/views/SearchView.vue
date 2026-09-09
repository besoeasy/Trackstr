<script setup>
import { ref, watch, onMounted } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { searchTmdb, SAMPLE_MEDIA, getTmdbApiKey } from '@/services/api/tmdb.js'
import { searchMusicBrainz, SAMPLE_MUSIC } from '@/services/api/musicbrainz.js'
import { computeContentId } from '@/utils/contentId.js'
import { useMediaStore } from '@/stores/media.js'
import MediaCard from '@/components/MediaCard.vue'
import AddMediaModal from '@/components/AddMediaModal.vue'

const route = useRoute()
const router = useRouter()
const mediaStore = useMediaStore()

const query = ref(route.query.q || '')
const activeTab = ref(route.query.tab || 'all') // 'all' | 'movies' | 'shows' | 'music'
const isSearching = ref(false)
const results = ref([])
const hasSearched = ref(false)
const hasTmdbKey = ref(!!getTmdbApiKey())
const showAddModal = ref(false)

let debounceTimer = null

async function executeSearch() {
  const q = query.value.trim()
  if (!q) {
    results.value = []
    hasSearched.value = false
    loadInitialSamples()
    return
  }

  isSearching.value = true
  hasSearched.value = true

  try {
    let items = []

    if (activeTab.value === 'all') {
      const [tmdbRes, mbRes] = await Promise.allSettled([
        searchTmdb(q, 'all'),
        searchMusicBrainz(q),
      ])

      const tmdbItems = tmdbRes.status === 'fulfilled' ? tmdbRes.value : []
      const mbItems = mbRes.status === 'fulfilled' ? mbRes.value : []
      items = [...tmdbItems, ...mbItems]
    } else if (activeTab.value === 'movies') {
      items = await searchTmdb(q, 'movies')
    } else if (activeTab.value === 'shows') {
      items = await searchTmdb(q, 'shows')
    } else if (activeTab.value === 'music') {
      items = await searchMusicBrainz(q)
    }

    // Attach computed canonical Content IDs to all results and deduplicate
    const seenContentIds = new Set()
    const uniqueEnriched = []

    for (const item of items) {
      const { contentId, canonicalString } = await computeContentId({
        type: item.type,
        title: item.title,
        year: item.year,
        artist: item.artist,
      })

      if (!seenContentIds.has(contentId)) {
        seenContentIds.add(contentId)
        const fullItem = {
          ...item,
          contentId,
          canonicalString,
        }
        uniqueEnriched.push(fullItem)
        // Cache in media store so detail view has instant data
        mediaStore.cacheMediaItem(fullItem)
      }
    }

    results.value = uniqueEnriched
  } catch (err) {
    console.error('Search failed:', err)
  } finally {
    isSearching.value = false
  }
}

function onInput() {
  clearTimeout(debounceTimer)
  debounceTimer = setTimeout(() => {
    executeSearch()
  }, 400)
}

function setTab(tab) {
  activeTab.value = tab
  executeSearch()
}

onMounted(() => {
  if (query.value) {
    executeSearch()
  } else {
    loadInitialSamples()
  }
})

async function loadInitialSamples() {
  const seenContentIds = new Set()
  const uniqueEnriched = []

  for (const item of [...SAMPLE_MEDIA, ...SAMPLE_MUSIC]) {
    const { contentId, canonicalString } = await computeContentId({
      type: item.type,
      title: item.title,
      year: item.year,
      artist: item.artist,
    })

    if (!seenContentIds.has(contentId)) {
      seenContentIds.add(contentId)
      const full = { ...item, contentId, canonicalString }
      uniqueEnriched.push(full)
      mediaStore.cacheMediaItem(full)
    }
  }
  results.value = uniqueEnriched
}
</script>

<template>
  <div class="search-view">
    <div class="search-header">
      <h1 class="page-title">Search & Track</h1>
      <p class="page-subtitle">
        Find movies, shows, and albums to rate, review, and seed to Nostr
      </p>

      <div class="search-input-wrap">
        <span class="search-icon">🔍</span>
        <input
          v-model="query"
          type="search"
          class="input search-input"
          placeholder="Search movies, TV shows, music albums, artists..."
          autofocus
          @input="onInput"
          @keyup.enter="executeSearch"
        />
      </div>

      <!-- Tab filter -->
      <div class="tabs-bar search-tabs">
        <button
          class="tab-btn"
          :class="{ 'is-active': activeTab === 'all' }"
          type="button"
          @click="setTab('all')"
        >
          All Media
        </button>
        <button
          class="tab-btn"
          :class="{ 'is-active': activeTab === 'movies' }"
          type="button"
          @click="setTab('movies')"
        >
          🎬 Movies
        </button>
        <button
          class="tab-btn"
          :class="{ 'is-active': activeTab === 'shows' }"
          type="button"
          @click="setTab('shows')"
        >
          📺 TV Shows
        </button>
        <button
          class="tab-btn"
          :class="{ 'is-active': activeTab === 'music' }"
          type="button"
          @click="setTab('music')"
        >
          🎵 Music
        </button>
      </div>

      <!-- Provider info badge -->
      <div class="free-limit-tip card">
        <span class="tip-icon">🌐</span>
        <div class="tip-text">
          <strong>Open Decentralized Metadata:</strong> TV shows (TVMaze), movies (open encyclopedia), and music (MusicBrainz) work out-of-the-box with zero API keys required. You can also configure an optional free TMDB key in Settings (⚙️).
        </div>
      </div>
    </div>

    <!-- Results -->
    <div class="search-results-section">
      <div v-if="isSearching" class="loading-state">
        <div class="spinner"></div>
        <p>Searching metadata providers and calculating content IDs...</p>
      </div>

      <div v-else-if="results.length === 0 && hasSearched" class="empty-state card">
        <h3>No matches found</h3>
        <p>Try refining your search terms or switch categories above.</p>
      </div>

      <div v-else>
        <div class="results-meta">
          <span>{{ results.length }} {{ hasSearched ? 'results' : 'featured titles' }}</span>
          <button class="btn btn-outline btn-sm" type="button" @click="showAddModal = true">
            <span>+</span> Track by Fields (Minimal)
          </button>
        </div>

        <div class="grid grid-media">
          <MediaCard
            v-for="item in results"
            :key="item.contentId"
            :media="item"
          />
        </div>
      </div>
    </div>

    <AddMediaModal v-if="showAddModal" @close="showAddModal = false" />
  </div>
</template>

<style scoped>
.search-header {
  max-width: 780px;
  margin: 0 auto 36px;
  text-align: center;
}

.page-title {
  font-size: 2.2rem;
  font-weight: 800;
  margin-bottom: 8px;
}

.page-subtitle {
  color: var(--text-secondary);
  font-size: 0.95rem;
  margin-bottom: 24px;
}

.search-input-wrap {
  position: relative;
  margin-bottom: 20px;
}

.search-icon {
  position: absolute;
  left: 16px;
  top: 50%;
  transform: translateY(-50%);
  font-size: 1.1rem;
}

.search-input {
  padding: 14px 16px 14px 48px;
  font-size: 1.05rem;
  border-radius: var(--radius-md);
  box-shadow: var(--shadow-sm);
}

.search-tabs {
  justify-content: center;
  margin-bottom: 16px;
}

.free-limit-tip {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 12px 16px;
  text-align: left;
  background: var(--bg-surface);
  border-color: rgba(139, 92, 246, 0.2);
}

.tip-icon {
  font-size: 1.25rem;
}

.tip-text {
  font-size: 0.82rem;
  color: var(--text-secondary);
  line-height: 1.4;
}

.results-meta {
  font-size: 0.85rem;
  color: var(--text-muted);
  margin-bottom: 16px;
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.loading-state, .empty-state {
  padding: 48px 20px;
  text-align: center;
  color: var(--text-secondary);
}

.spinner {
  width: 24px;
  height: 24px;
  border: 3px solid var(--border-hover);
  border-top-color: var(--primary);
  border-radius: 50%;
  margin: 0 auto 12px;
  animation: spin 0.7s linear infinite;
}

@keyframes spin {
  to {
    transform: rotate(360deg);
  }
}
</style>
