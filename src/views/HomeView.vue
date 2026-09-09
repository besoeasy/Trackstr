<script setup>
import { ref, watch, onMounted, computed } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useAuthStore } from '@/stores/auth.js'
import { useMediaStore } from '@/stores/media.js'
import { searchTmdb } from '@/services/api/tmdb.js'
import { searchMusicBrainz } from '@/services/api/musicbrainz.js'
import { computeContentId } from '@/utils/contentId.js'
import { formatRelativeTime } from '@/utils/formatters.js'
import MediaCard from '@/components/MediaCard.vue'
import AddMediaModal from '@/components/AddMediaModal.vue'

const route = useRoute()
const router = useRouter()
const authStore = useAuthStore()
const mediaStore = useMediaStore()

// Search state
const query = ref(route.query.q || '')
const activeTab = ref(route.query.tab || 'all') // 'all' | 'movies' | 'shows' | 'music'
const isSearching = ref(false)
const searchResults = ref([])
const hasSearched = ref(false)
const showAddModal = ref(false)

// Nostr Popular & Featured state
const popularItems = ref([])
const isLoadingPopular = ref(false)
const recentFeed = ref([])
const isLoadingFeed = ref(false)

let debounceTimer = null

// Tab to media type mapper
const activeTypeFilter = computed(() => {
  if (activeTab.value === 'movies') return 'movie'
  if (activeTab.value === 'shows') return 'show'
  if (activeTab.value === 'music') return 'music'
  return null
})

// Search execution
async function executeSearch() {
  const q = query.value.trim()
  if (!q) {
    searchResults.value = []
    hasSearched.value = false
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
        mediaStore.cacheMediaItem(fullItem)
      }
    }

    searchResults.value = uniqueEnriched
  } catch (err) {
    console.error('Search failed:', err)
  } finally {
    isSearching.value = false
  }
}

function onInput() {
  clearTimeout(debounceTimer)
  debounceTimer = setTimeout(() => {
    syncUrlQuery()
    executeSearch()
  }, 350)
}

function setTab(tab) {
  activeTab.value = tab
  syncUrlQuery()
  if (query.value.trim()) {
    executeSearch()
  } else {
    loadPopularFromNostr()
  }
}

function syncUrlQuery() {
  const newQuery = {}
  if (query.value.trim()) newQuery.q = query.value.trim()
  if (activeTab.value !== 'all') newQuery.tab = activeTab.value
  router.replace({ query: newQuery })
}

function clearSearch() {
  query.value = ''
  searchResults.value = []
  hasSearched.value = false
  syncUrlQuery()
}

// Load Popular & Featured titles dynamically from Nostr events
async function loadPopularFromNostr() {
  isLoadingPopular.value = true
  try {
    const items = await mediaStore.fetchPopularMediaFromEvents({
      type: activeTypeFilter.value,
      limit: 18,
    })
    popularItems.value = items
  } catch (err) {
    console.warn('Failed to load popular items from Nostr:', err)
  } finally {
    isLoadingPopular.value = false
  }
}

// Load live activity feed from Nostr relays
async function loadFeed() {
  isLoadingFeed.value = true
  try {
    recentFeed.value = await mediaStore.fetchRecentFeed(20)
  } catch (err) {
    console.warn('Feed load failed:', err)
  } finally {
    isLoadingFeed.value = false
  }
}

onMounted(async () => {
  if (query.value.trim()) {
    executeSearch()
  }
  loadPopularFromNostr()
  loadFeed()
})

watch(
  () => route.query.q,
  (newQ) => {
    if (newQ !== query.value) {
      query.value = newQ || ''
      if (query.value.trim()) {
        executeSearch()
      } else {
        searchResults.value = []
        hasSearched.value = false
      }
    }
  }
)
</script>

<template>
  <div class="home-view">
    <!-- Hero & Unified Search Header -->
    <section class="hero-search-section">
      <div class="hero-content">
        <span class="badge badge-primary hero-badge">Nostr-Powered Media Social</span>
        <h1 class="hero-title">Track everything you love. Own your taste.</h1>
        <p class="hero-subtitle">
          Search movies, series & music across open providers, or explore popular media and scrobbles living on Nostr.
        </p>

        <!-- Search Bar with Actions -->
        <div class="search-box-wrap">
          <div class="search-input-group">
            <span class="search-icon">🔍</span>
            <input
              v-model="query"
              type="search"
              class="input search-input"
              placeholder="Search movies, TV shows, music albums, artists across providers..."
              @input="onInput"
              @keyup.enter="executeSearch"
            />
            <button
              v-if="query"
              class="clear-search-btn"
              type="button"
              title="Clear search"
              @click="clearSearch"
            >
              ✕
            </button>
          </div>

          <button
            class="btn btn-primary btn-track-quick"
            type="button"
            title="Track Movie, Series, or Music by canonical fields"
            @click="showAddModal = true"
          >
            <span>+</span> Track (Minimal)
          </button>
        </div>

        <!-- Filter Category Tabs -->
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
      </div>
    </section>

    <!-- CASE 1: SEARCH ACTIVE -->
    <section v-if="query.trim()" class="section search-results-section">
      <div class="section-header">
        <div>
          <h2 class="section-title">
            Search Results
            <span v-if="!isSearching" class="results-count">({{ searchResults.length }})</span>
          </h2>
          <p class="section-subtitle">
            Found across TMDB, TVMaze, Wikipedia & MusicBrainz for "{{ query }}"
          </p>
        </div>

        <button
          v-if="query"
          class="btn btn-outline btn-sm"
          type="button"
          @click="clearSearch"
        >
          ✕ Clear Search
        </button>
      </div>

      <div v-if="isSearching" class="loading-state">
        <div class="spinner"></div>
        <p>Querying multiple metadata providers and calculating canonical Content IDs...</p>
      </div>

      <div v-else-if="searchResults.length === 0 && hasSearched" class="empty-state card">
        <h3>No matches found</h3>
        <p>Try refining your search terms or track manually with the minimal 3-card form.</p>
        <button class="btn btn-primary btn-sm" type="button" @click="showAddModal = true">
          + Track Manually
        </button>
      </div>

      <div v-else class="grid grid-media">
        <MediaCard
          v-for="item in searchResults"
          :key="item.contentId"
          :media="item"
        />
      </div>
    </section>

    <!-- CASE 2: DEFAULT HOME VIEW (POPULAR ON NOSTR + LIVE FEED) -->
    <template v-else>
      <!-- Popular & Featured Titles on Nostr -->
      <section class="section">
        <div class="section-header">
          <div>
            <div class="title-with-badge">
              <h2 class="section-title">Popular & Featured Titles</h2>
              <span class="badge badge-primary nostr-live-tag">⚡ Live on Nostr</span>
            </div>
            <p class="section-subtitle">
              Ranked dynamically by Nostr relay activity, community reviews, and scrobbles
            </p>
          </div>

          <button
            class="btn btn-secondary btn-sm"
            type="button"
            :disabled="isLoadingPopular"
            @click="loadPopularFromNostr"
          >
            {{ isLoadingPopular ? 'Refreshing...' : '🔄 Refresh from Relays' }}
          </button>
        </div>

        <div v-if="isLoadingPopular" class="loading-state">
          <div class="spinner"></div>
          <p>Querying Nostr relays for tracked media events...</p>
        </div>

        <div v-else-if="popularItems.length === 0" class="empty-feed card">
          <p>No media tracked on connected Nostr relays yet.</p>
          <button class="btn btn-primary btn-sm" type="button" @click="showAddModal = true">
            + Be the first to track a title
          </button>
        </div>

        <div v-else class="grid grid-media">
          <MediaCard
            v-for="item in popularItems"
            :key="item.contentId"
            :media="item"
          />
        </div>
      </section>

      <!-- Architecture Highlight Banner -->
      <section class="arch-banner card">
        <div class="arch-col">
          <div class="arch-icon">⚡</div>
          <div class="arch-info">
            <h4>Mutable State (Kinds 35400, 35402)</h4>
            <p>NIP-33 parameterized replaceable events. Relays overwrite old states per item. Zero bloat.</p>
          </div>
        </div>
        <div class="arch-col">
          <div class="arch-icon">📜</div>
          <div class="arch-info">
            <h4>Permanent Historical Logs (Kinds 5401, 5402)</h4>
            <p>Reviews and scrobbles are permanent diary entries without artificial expiration tags.</p>
          </div>
        </div>
        <div class="arch-col">
          <div class="arch-icon">📦</div>
          <div class="arch-info">
            <h4>Decentralized IPFS (Originless)</h4>
            <p>Artwork addressed with IPFS CIDs via public instance at originless.gupt.app.</p>
          </div>
        </div>
      </section>

      <!-- Recent Nostr Activity Feed -->
      <section class="section">
        <div class="section-header">
          <div>
            <h2 class="section-title">Recent Activity Feed</h2>
            <p class="section-subtitle">Real-time check-ins and reviews across configured relays</p>
          </div>
          <button
            class="btn btn-secondary btn-sm"
            type="button"
            :disabled="isLoadingFeed"
            @click="loadFeed"
          >
            {{ isLoadingFeed ? 'Refreshing...' : '🔄 Refresh Feed' }}
          </button>
        </div>

        <div v-if="isLoadingFeed" class="empty-feed">
          <p>Connecting to Nostr relays and loading activity...</p>
        </div>

        <div v-else-if="recentFeed.length === 0" class="empty-feed card">
          <p>No recent activity received yet on the active relays.</p>
          <p class="form-hint">Connect your extension and track a movie or album to create the first entry!</p>
        </div>

        <div v-else class="activity-feed-grid">
          <div v-for="act in recentFeed" :key="act.id" class="activity-feed-card card">
            <div class="activity-card-header">
              <span class="activity-author contentid-chip">
                {{ act.pubkey.slice(0, 8) }}...{{ act.pubkey.slice(-4) }}
              </span>
              <span class="activity-time">{{ formatRelativeTime(act.created_at) }}</span>
            </div>

            <div class="activity-body">
              <div class="activity-badge-row">
                <span v-if="act.kind === 5401" class="badge badge-info">Review</span>
                <span v-else-if="act.kind === 5402" class="badge badge-success">Check-in</span>
                <span class="activity-media-name">{{ act.tags.find((t) => t[0] === 'name')?.[1] || 'Media' }}</span>
              </div>
              <p v-if="act.content" class="activity-content-text">{{ act.content }}</p>
            </div>
          </div>
        </div>
      </section>
    </template>

    <AddMediaModal v-if="showAddModal" @close="showAddModal = false" @saved="loadPopularFromNostr" />
  </div>
</template>

<style scoped>
.hero-search-section {
  padding: 36px 0 28px;
  text-align: center;
  position: relative;
  max-width: 820px;
  margin: 0 auto;
}

.hero-badge {
  margin-bottom: 14px;
}

.hero-title {
  font-size: 2.6rem;
  font-weight: 800;
  line-height: 1.15;
  letter-spacing: -0.03em;
  margin-bottom: 12px;
  background: linear-gradient(135deg, #ffffff 40%, var(--primary) 100%);
  -webkit-background-clip: text;
  -webkit-text-fill-color: transparent;
}

[data-theme='light'] .hero-title {
  background: linear-gradient(135deg, #0f172a 40%, var(--primary) 100%);
  -webkit-background-clip: text;
  -webkit-text-fill-color: transparent;
}

.hero-subtitle {
  font-size: 1.05rem;
  color: var(--text-secondary);
  max-width: 620px;
  margin: 0 auto 24px;
  line-height: 1.5;
}

/* Search Box & Quick Track */
.search-box-wrap {
  display: flex;
  gap: 12px;
  margin-bottom: 20px;
  align-items: center;
}

@media (max-width: 640px) {
  .search-box-wrap {
    flex-direction: column;
  }
}

.search-input-group {
  position: relative;
  flex: 1;
  width: 100%;
}

.search-icon {
  position: absolute;
  left: 16px;
  top: 50%;
  transform: translateY(-50%);
  font-size: 1.1rem;
}

.search-input {
  padding: 14px 44px 14px 48px;
  font-size: 1.05rem;
  border-radius: var(--radius-md);
  box-shadow: var(--shadow-sm);
  width: 100%;
}

.clear-search-btn {
  position: absolute;
  right: 14px;
  top: 50%;
  transform: translateY(-50%);
  background: none;
  border: none;
  color: var(--text-muted);
  cursor: pointer;
  font-size: 1rem;
  padding: 4px;
}

.clear-search-btn:hover {
  color: var(--text-main);
}

.btn-track-quick {
  white-space: nowrap;
  padding: 14px 20px;
  font-size: 0.95rem;
  display: flex;
  align-items: center;
  gap: 6px;
}

.search-tabs {
  justify-content: center;
  margin-bottom: 8px;
}

.title-with-badge {
  display: flex;
  align-items: center;
  gap: 12px;
}

.nostr-live-tag {
  font-size: 0.72rem;
  animation: pulse 1.5s infinite alternate;
}

.results-count {
  font-size: 1rem;
  color: var(--text-muted);
  font-weight: 400;
  margin-left: 6px;
}

.loading-state,
.empty-state {
  padding: 48px 20px;
  text-align: center;
  color: var(--text-secondary);
}

.spinner {
  width: 28px;
  height: 28px;
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

@keyframes pulse {
  from {
    opacity: 0.8;
  }
  to {
    opacity: 1;
  }
}

.arch-banner {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 20px;
  margin: 32px 0 48px;
  background: var(--bg-surface);
}

@media (max-width: 800px) {
  .arch-banner {
    grid-template-columns: 1fr;
  }
}

.arch-col {
  display: flex;
  align-items: flex-start;
  gap: 14px;
}

.arch-icon {
  font-size: 1.8rem;
  line-height: 1;
}

.arch-info h4 {
  font-size: 0.95rem;
  font-weight: 600;
  margin-bottom: 4px;
}

.arch-info p {
  font-size: 0.82rem;
  color: var(--text-secondary);
  line-height: 1.4;
}

.section {
  margin-bottom: 48px;
}

.section-header {
  display: flex;
  align-items: flex-end;
  justify-content: space-between;
  margin-bottom: 20px;
}

.section-title {
  font-size: 1.5rem;
  font-weight: 700;
  letter-spacing: -0.02em;
}

.section-subtitle {
  font-size: 0.9rem;
  color: var(--text-secondary);
  margin-top: 2px;
}

.empty-feed {
  padding: 32px;
  text-align: center;
  color: var(--text-secondary);
}

.activity-feed-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(320px, 1fr));
  gap: 16px;
}

.activity-feed-card {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.activity-card-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.activity-time {
  font-size: 0.78rem;
  color: var(--text-muted);
}

.activity-badge-row {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 6px;
}

.activity-media-name {
  font-weight: 600;
  font-size: 0.95rem;
}

.activity-content-text {
  font-size: 0.88rem;
  color: var(--text-secondary);
  line-height: 1.4;
}
</style>
