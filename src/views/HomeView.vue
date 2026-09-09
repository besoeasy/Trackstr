<script setup>
import { ref, watch, onMounted, computed } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useMediaStore } from '@/stores/media.js'
import { searchTmdb } from '@/services/api/tmdb.js'
import { searchMusicBrainz } from '@/services/api/musicbrainz.js'
import { computeContentId } from '@/utils/contentId.js'
import { formatRelativeTime } from '@/utils/formatters.js'
import MediaCard from '@/components/MediaCard.vue'

const route = useRoute()
const router = useRouter()
const mediaStore = useMediaStore()

const searchInputRef = ref(null)

// Search state - strictly category based (no global search)
const validTabs = ['movies', 'shows', 'music']
const initialTab = validTabs.includes(route.query.tab) ? route.query.tab : 'movies'
const query = ref(route.query.q || '')
const activeTab = ref(initialTab) // 'movies' | 'shows' | 'music'
const isSearching = ref(false)
const searchResults = ref([])
const hasSearched = ref(false)

// Nostr Popular & Featured state
const popularItems = ref([])
const isLoadingPopular = ref(false)
const recentFeed = ref([])
const isLoadingFeed = ref(false)

let debounceTimer = null
let searchSeq = 0 // latest search wins; stale responses are discarded

// Tab to media type mapper
const activeTypeFilter = computed(() => {
  if (activeTab.value === 'movies') return 'movie'
  if (activeTab.value === 'shows') return 'show'
  if (activeTab.value === 'music') return 'music'
  return 'movie'
})

// Dynamic placeholder based on selected category
const searchPlaceholder = computed(() => {
  if (activeTab.value === 'movies') return 'Search movies by title (e.g. Fight Club, Inception)...'
  if (activeTab.value === 'shows') return 'Search series & TV shows (e.g. Breaking Bad, Stranger Things)...'
  if (activeTab.value === 'music') return 'Search music albums, tracks & artists (e.g. Nevermind, Radiohead)...'
  return 'Search movies...'
})

// Search execution - strictly category based
async function executeSearch() {
  const q = query.value.trim()
  if (!q) {
    searchResults.value = []
    hasSearched.value = false
    return
  }

  isSearching.value = true
  hasSearched.value = true
  const mySeq = ++searchSeq

  try {
    let items = []

    if (activeTab.value === 'movies') {
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
      let contentId = ''
      let canonicalString = ''
      try {
        ;({ contentId, canonicalString } = await computeContentId({
          type: item.type,
          title: item.title,
          year: item.year,
          artist: item.artist,
        }))
      } catch {
        continue // unidentifiable result (e.g. music without artist) — skip it
      }

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

    if (mySeq === searchSeq) {
      searchResults.value = uniqueEnriched
    }
  } catch (err) {
    console.error('Search failed:', err)
  } finally {
    if (mySeq === searchSeq) {
      isSearching.value = false
    }
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
  newQuery.tab = activeTab.value
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

  if (route.query.focus === 'search' || route.query.track === 'true') {
    setTimeout(() => {
      searchInputRef.value?.focus()
    }, 150)
  }
})

watch(
  () => [route.query.focus, route.query.track],
  () => {
    if (route.query.focus === 'search' || route.query.track === 'true') {
      searchInputRef.value?.focus()
    }
  }
)

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
          Select a category (movie, series, music) to search without name collisions, or explore popular media and scrobbles on Nostr.
        </p>

        <!-- Fluid Search Bar -->
        <div class="search-box-wrap">
          <div class="search-input-group">
            <span class="search-icon">🔍</span>
            <input
              ref="searchInputRef"
              v-model="query"
              type="search"
              class="input search-input"
              :placeholder="searchPlaceholder"
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
        </div>

        <!-- Strict Category Tabs (No Global Search) -->
        <div class="tabs-bar search-tabs">
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
            📺 Series
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
        <div class="empty-icon">🔍</div>
        <h3>No {{ activeTab }} found for "{{ query }}"</h3>
        <p>Try refining your query or switch categories above. Click any result to view its showcase page and track it on Nostr.</p>
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
          <div class="empty-icon">⚡</div>
          <p>No media tracked on connected Nostr relays yet.</p>
          <p class="form-hint">Search for your favorite movie, show, or artist above to open its showcase page and track it!</p>
        </div>

        <div v-else class="grid grid-media">
          <MediaCard
            v-for="item in popularItems"
            :key="item.contentId"
            :media="item"
          />
        </div>
      </section>

      <!-- Architecture Bento Grid -->
      <section class="arch-section">
        <div class="arch-grid">
          <div class="arch-card card">
            <div class="arch-badge-row">
              <span class="badge badge-primary">NIP-33</span>
              <span class="arch-tag">Kind 35400 / 35402</span>
            </div>
            <h3 class="arch-title">Mutable State</h3>
            <p class="arch-desc">Parameterized replaceable events overwrite older states per item. Zero relay bloat, no renewal jobs required.</p>
          </div>
          <div class="arch-card card">
            <div class="arch-badge-row">
              <span class="badge badge-primary">Logs</span>
              <span class="arch-tag">Kind 5401 / 5402</span>
            </div>
            <h3 class="arch-title">Permanent History</h3>
            <p class="arch-desc">Historical diary entries for reviews and scrobbles live forever on relays without artificial expiration tags.</p>
          </div>
          <div class="arch-card card">
            <div class="arch-badge-row">
              <span class="badge badge-primary">IPFS</span>
              <span class="arch-tag">Originless Node</span>
            </div>
            <h3 class="arch-title">Content Addressing</h3>
            <p class="arch-desc">Decentralized posters and banners addressed by IPFS CIDs via public Originless instance at originless.gupt.app.</p>
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
                {{ (act.pubkey || '').slice(0, 8) }}...{{ (act.pubkey || '').slice(-4) }}
              </span>
              <span class="activity-time">{{ formatRelativeTime(act.created_at) }}</span>
            </div>

            <div class="activity-body">
              <div class="activity-badge-row">
                <span v-if="act.kind === 5401" class="badge badge-info">Review</span>
                <span v-else-if="act.kind === 5402" class="badge badge-success">Check-in</span>
                <span class="activity-media-name">{{ (act.tags || []).find((t) => t[0] === 'name')?.[1] || 'Media' }}</span>
              </div>
              <p v-if="act.content" class="activity-content-text">{{ act.content }}</p>
            </div>
          </div>
        </div>
      </section>
    </template>
  </div>
</template>

<style scoped>
.hero-search-section {
  padding: 64px 0 48px;
  text-align: center;
  position: relative;
  max-width: 860px;
  margin: 0 auto;
}

.hero-badge {
  margin-bottom: 20px;
  font-family: var(--font-mono);
  font-size: 0.72rem;
  letter-spacing: 0.05em;
  text-transform: uppercase;
  background: #111111;
  color: #888888;
  border: 1px solid #262626;
  padding: 4px 10px;
}

.hero-title {
  font-size: clamp(2.75rem, 6.5vw, 4.5rem);
  font-weight: 800;
  line-height: 1.05;
  letter-spacing: -0.05em;
  margin-bottom: 16px;
  color: #ededed;
}

[data-theme='light'] .hero-title {
  color: #000000;
}

.hero-subtitle {
  font-size: clamp(1.05rem, 2vw, 1.2rem);
  color: var(--text-secondary);
  max-width: 680px;
  margin: 0 auto 36px;
  line-height: 1.6;
  letter-spacing: -0.01em;
}

/* Fluid Minimal Search Bar */
.search-box-wrap {
  display: flex;
  justify-content: center;
  margin: 0 auto 24px;
  max-width: 680px;
  width: 100%;
}

.search-input-group {
  position: relative;
  width: 100%;
}

.search-icon {
  position: absolute;
  left: 16px;
  top: 50%;
  transform: translateY(-50%);
  font-size: 1rem;
  color: var(--text-muted);
  pointer-events: none;
  opacity: 0.7;
}

.search-input {
  height: 52px;
  padding: 0 48px 0 48px;
  font-size: 1.02rem;
  border-radius: var(--radius-sm);
  background: #000000;
  border: 1px solid #262626;
  color: var(--text-main);
  width: 100%;
  transition: border-color var(--transition-fast), box-shadow var(--transition-fast);
}

.search-input:focus {
  border-color: #ffffff;
  box-shadow: 0 0 0 1px #ffffff;
}

[data-theme='light'] .search-input {
  background: #ffffff;
  border-color: #eaeaea;
}

[data-theme='light'] .search-input:focus {
  border-color: #000000;
  box-shadow: 0 0 0 1px #000000;
}

.clear-search-btn {
  position: absolute;
  right: 14px;
  top: 50%;
  transform: translateY(-50%);
  background: #141414;
  border: 1px solid #262626;
  border-radius: 4px;
  width: 26px;
  height: 26px;
  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--text-muted);
  cursor: pointer;
  font-size: 0.75rem;
  transition: all var(--transition-fast);
}

.clear-search-btn:hover {
  color: var(--text-main);
  border-color: #444444;
}

/* Category Tabs (Minimal Segmented Pill) */
.search-tabs {
  justify-content: center;
  border-bottom: none;
  gap: 4px;
  margin-bottom: 12px;
  padding: 4px;
  background: #0c0c0c;
  border-radius: var(--radius-sm);
  display: inline-flex;
  border: 1px solid #222222;
  max-width: 100%;
  overflow-x: auto;
  scrollbar-width: none;
}

.search-tabs::-webkit-scrollbar {
  display: none;
}

.search-tabs .tab-btn {
  padding: 7px 16px;
  font-size: 0.86rem;
  font-weight: 500;
  border-radius: var(--radius-xs);
  border: none;
  transition: all var(--transition-fast);
  color: var(--text-secondary);
  white-space: nowrap;
  flex-shrink: 0;
}

.search-tabs .tab-btn:hover {
  color: var(--text-main);
}

.search-tabs .tab-btn.is-active {
  background: #222222;
  color: #ffffff;
}

[data-theme='light'] .search-tabs {
  background: #f5f5f5;
  border-color: #eaeaea;
}

[data-theme='light'] .search-tabs .tab-btn.is-active {
  background: #ffffff;
  color: #000000;
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.08);
}

@media (max-width: 640px) {
  .hero-search-section {
    padding: 36px 0 24px;
  }

  .hero-title {
    font-size: 2.25rem;
  }

  .hero-subtitle {
    font-size: 0.95rem;
    margin-bottom: 24px;
  }

  .search-input {
    height: 48px;
    font-size: 0.95rem;
  }
}

.title-with-badge {
  display: flex;
  align-items: center;
  gap: 12px;
}

.nostr-live-tag {
  font-size: 0.7rem;
  font-weight: 500;
  background: #111111;
  color: var(--accent-emerald);
  border: 1px solid rgba(80, 227, 194, 0.3);
}

.results-count {
  font-size: 1rem;
  color: var(--text-muted);
  font-weight: 400;
  margin-left: 6px;
}

.loading-state,
.empty-state {
  padding: 60px 20px;
  text-align: center;
  color: var(--text-secondary);
}

.empty-state {
  border-radius: var(--radius-md);
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 12px;
  max-width: 520px;
  margin: 24px auto;
  border: 1px dashed var(--border-subtle);
  background: var(--bg-surface);
}

.empty-icon {
  font-size: 2rem;
  opacity: 0.7;
}

.spinner {
  width: 28px;
  height: 28px;
  border: 2px solid #262626;
  border-top-color: #ffffff;
  border-radius: 50%;
  margin: 0 auto 16px;
  animation: spin 0.6s linear infinite;
}

@keyframes spin {
  to {
    transform: rotate(360deg);
  }
}

/* Architecture Bento Grid */
.arch-section {
  margin: 48px 0 64px;
}

.arch-grid {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 20px;
}

@media (max-width: 840px) {
  .arch-grid {
    grid-template-columns: 1fr;
    gap: 14px;
  }
}

.arch-card {
  display: flex;
  flex-direction: column;
  padding: 24px;
  border-radius: var(--radius-md);
  border: 1px solid var(--border-subtle);
  background: var(--bg-card);
  transition: border-color var(--transition-fast);
}

.arch-card:hover {
  border-color: var(--border-hover);
}

.arch-badge-row {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-bottom: 16px;
}

.arch-tag {
  font-family: var(--font-mono);
  font-size: 0.72rem;
  color: var(--text-muted);
}

.arch-title {
  font-size: 1.15rem;
  font-weight: 700;
  letter-spacing: -0.03em;
  margin-bottom: 8px;
  color: var(--text-main);
}

.arch-desc {
  font-size: 0.88rem;
  color: var(--text-secondary);
  line-height: 1.55;
}

.empty-feed {
  padding: 40px 20px;
  text-align: center;
  color: var(--text-secondary);
  border-radius: var(--radius-md);
  border: 1px dashed var(--border-subtle);
  background: var(--bg-surface);
  max-width: 560px;
  margin: 0 auto;
}

.activity-feed-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(320px, 1fr));
  gap: 18px;
}

.activity-feed-card {
  display: flex;
  flex-direction: column;
  gap: 10px;
  padding: 18px 20px;
  border-radius: var(--radius-md);
  border: 1px solid var(--border-subtle);
  background: var(--bg-card);
  transition: border-color var(--transition-fast);
}

.activity-feed-card:hover {
  border-color: var(--border-hover);
}

.activity-card-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.activity-time {
  font-size: 0.75rem;
  color: var(--text-muted);
}

.activity-badge-row {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 4px;
}

.activity-media-name {
  font-weight: 600;
  font-size: 0.95rem;
  letter-spacing: -0.02em;
}

.activity-content-text {
  font-size: 0.88rem;
  color: var(--text-secondary);
  line-height: 1.5;
}
</style>
