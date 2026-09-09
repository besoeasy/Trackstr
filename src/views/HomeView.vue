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
  padding: 44px 0 32px;
  text-align: center;
  position: relative;
  max-width: 860px;
  margin: 0 auto;
  animation: heroEntrance 0.6s var(--ease-spring) both;
}

@keyframes heroEntrance {
  from {
    opacity: 0;
    transform: translateY(24px) scale(0.98);
  }
  to {
    opacity: 1;
    transform: translateY(0) scale(1);
  }
}

.hero-badge {
  margin-bottom: 16px;
  animation: badgeFloat 4s ease-in-out infinite alternate;
  box-shadow: 0 0 20px rgba(139, 92, 246, 0.35);
}

@keyframes badgeFloat {
  0% {
    transform: translateY(0);
  }
  100% {
    transform: translateY(-4px);
  }
}

.hero-title {
  font-size: clamp(2.2rem, 5vw, 3.4rem);
  font-weight: 800;
  line-height: 1.12;
  letter-spacing: -0.035em;
  margin-bottom: 14px;
  background: linear-gradient(135deg, #ffffff 40%, var(--primary) 90%, #ec4899 100%);
  -webkit-background-clip: text;
  -webkit-text-fill-color: transparent;
  text-shadow: 0 0 40px rgba(139, 92, 246, 0.2);
}

[data-theme='light'] .hero-title {
  background: linear-gradient(135deg, #0f172a 40%, var(--primary) 90%);
  -webkit-background-clip: text;
  -webkit-text-fill-color: transparent;
}

.hero-subtitle {
  font-size: clamp(0.95rem, 2vw, 1.08rem);
  color: var(--text-secondary);
  max-width: 650px;
  margin: 0 auto 28px;
  line-height: 1.55;
}

/* Fluid Centered Search Bar */
.search-box-wrap {
  display: flex;
  justify-content: center;
  margin: 0 auto 24px;
  max-width: 720px;
  width: 100%;
}

.search-input-group {
  position: relative;
  width: 100%;
}

.search-icon {
  position: absolute;
  left: 18px;
  top: 50%;
  transform: translateY(-50%);
  font-size: 1.15rem;
  pointer-events: none;
  transition: transform 0.25s var(--ease-spring);
}

.search-input-group:focus-within .search-icon {
  transform: translateY(-50%) scale(1.18);
  color: var(--primary);
}

.search-input {
  padding: 16px 50px 16px 52px;
  font-size: 1.08rem;
  border-radius: var(--radius-xl);
  background: var(--bg-surface);
  border: 1px solid var(--border-hover);
  box-shadow: 0 4px 20px rgba(0, 0, 0, 0.25);
  width: 100%;
  transition: border-color 0.3s ease, box-shadow 0.3s var(--ease-spring), transform 0.3s var(--ease-spring);
}

.search-input:focus {
  border-color: var(--primary);
  box-shadow: 0 0 0 4px var(--primary-light), 0 8px 32px rgba(139, 92, 246, 0.3);
  transform: scale(1.01);
}

.clear-search-btn {
  position: absolute;
  right: 16px;
  top: 50%;
  transform: translateY(-50%);
  background: var(--bg-card);
  border: 1px solid var(--border-subtle);
  border-radius: 50%;
  width: 26px;
  height: 26px;
  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--text-muted);
  cursor: pointer;
  font-size: 0.82rem;
  transition: all 0.2s var(--ease-spring);
}

.clear-search-btn:hover {
  color: var(--text-main);
  background: var(--bg-card-hover);
  border-color: var(--border-hover);
  transform: translateY(-50%) scale(1.15);
}

/* Category Tabs with Animated Pill Feedback */
.search-tabs {
  justify-content: center;
  border-bottom: none;
  gap: 10px;
  margin-bottom: 12px;
  padding: 6px;
  background: rgba(16, 20, 32, 0.55);
  backdrop-filter: blur(12px);
  border-radius: var(--radius-full);
  display: inline-flex;
  border: 1px solid var(--border-subtle);
}

.search-tabs .tab-btn {
  padding: 8px 20px;
  font-size: 0.92rem;
  font-weight: 600;
  border-radius: var(--radius-full);
  border: none;
  transition: all 0.25s var(--ease-spring);
  color: var(--text-secondary);
}

.search-tabs .tab-btn:hover {
  color: var(--text-main);
  transform: translateY(-2px);
}

.search-tabs .tab-btn:active {
  transform: scale(0.95);
}

.search-tabs .tab-btn.is-active {
  background: linear-gradient(135deg, var(--primary), #7c3aed);
  color: #ffffff;
  box-shadow: 0 4px 18px var(--primary-glow);
  transform: scale(1.03);
}

.title-with-badge {
  display: flex;
  align-items: center;
  gap: 12px;
}

.nostr-live-tag {
  font-size: 0.72rem;
  animation: livePulse 2.4s ease-in-out infinite alternate;
}

@keyframes livePulse {
  0% {
    box-shadow: 0 0 0 0 rgba(139, 92, 246, 0.4);
    transform: scale(1);
  }
  50% {
    box-shadow: 0 0 16px 4px rgba(139, 92, 246, 0.4);
    transform: scale(1.04);
  }
  100% {
    box-shadow: 0 0 0 0 rgba(139, 92, 246, 0);
    transform: scale(1);
  }
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

.empty-state {
  border-radius: var(--radius-lg);
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 12px;
  max-width: 520px;
  margin: 20px auto;
  border: 1px dashed var(--border-hover);
  background: var(--bg-surface);
}

.empty-icon {
  font-size: 2.2rem;
}

.spinner {
  width: 32px;
  height: 32px;
  border: 3px solid var(--border-hover);
  border-top-color: var(--primary);
  border-radius: 50%;
  margin: 0 auto 14px;
  animation: spin 0.7s linear infinite;
  box-shadow: 0 0 16px var(--primary-glow);
}

@keyframes spin {
  to {
    transform: rotate(360deg);
  }
}

/* Architecture Cards with 3D Hover Lift */
.arch-banner {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 20px;
  margin: 36px 0 54px;
  background: var(--bg-surface);
  border-radius: var(--radius-lg);
  padding: 24px;
  border: 1px solid var(--border-subtle);
  box-shadow: var(--shadow-sm);
}

@media (max-width: 840px) {
  .arch-banner {
    grid-template-columns: 1fr;
    gap: 18px;
  }
}

.arch-col {
  display: flex;
  align-items: flex-start;
  gap: 16px;
  padding: 12px;
  border-radius: var(--radius-md);
  transition: transform 0.3s var(--ease-spring), background 0.3s ease, box-shadow 0.3s var(--ease-spring);
}

.arch-col:hover {
  transform: translateY(-4px);
  background: rgba(255, 255, 255, 0.03);
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.25);
}

.arch-icon {
  font-size: 2rem;
  line-height: 1;
  animation: iconFloat 4s ease-in-out infinite alternate;
}

.arch-col:nth-child(2) .arch-icon {
  animation-delay: 1.2s;
}

.arch-col:nth-child(3) .arch-icon {
  animation-delay: 2.4s;
}

@keyframes iconFloat {
  0% {
    transform: translateY(0);
  }
  100% {
    transform: translateY(-5px);
  }
}

.arch-info h4 {
  font-size: 0.98rem;
  font-weight: 700;
  margin-bottom: 5px;
  color: var(--text-main);
}

.arch-info p {
  font-size: 0.83rem;
  color: var(--text-secondary);
  line-height: 1.45;
}

.section {
  margin-bottom: 52px;
}

.section-header {
  display: flex;
  align-items: flex-end;
  justify-content: space-between;
  margin-bottom: 22px;
}

.section-title {
  font-size: 1.55rem;
  font-weight: 800;
  letter-spacing: -0.025em;
}

.section-subtitle {
  font-size: 0.92rem;
  color: var(--text-secondary);
  margin-top: 3px;
}

.empty-feed {
  padding: 36px 20px;
  text-align: center;
  color: var(--text-secondary);
  border-radius: var(--radius-lg);
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
  transition: transform 0.3s var(--ease-spring), border-color 0.25s ease, box-shadow 0.3s var(--ease-spring);
}

.activity-feed-card:hover {
  transform: translateY(-4px);
  border-color: var(--border-hover);
  box-shadow: 0 12px 28px rgba(0, 0, 0, 0.4), 0 0 16px var(--primary-light);
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
  font-weight: 700;
  font-size: 0.96rem;
}

.activity-content-text {
  font-size: 0.88rem;
  color: var(--text-secondary);
  line-height: 1.45;
}
</style>
