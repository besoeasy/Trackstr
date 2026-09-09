<script setup>
import { ref, watch, onMounted, computed } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useMediaStore } from '@/stores/media.js'
import { useAuthStore } from '@/stores/auth.js'
import { searchTmdb } from '@/services/api/tmdb.js'
import { searchMusic } from '@/services/api/music.js'
import { fetchShowEpisodes } from '@/services/api/tv.js'
import { computeContentId } from '@/utils/contentId.js'
import { resolveIpfsUrl } from '@/services/originless.js'
import MediaCard from '@/components/MediaCard.vue'

const route = useRoute()
const router = useRouter()
const mediaStore = useMediaStore()
const authStore = useAuthStore()

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

// Personalized Suggestion state (random unwatched movie from Nostr events)
const suggestion = ref(null)
const suggestionPool = ref([])
const isLoadingSuggestion = ref(false)
const suggestionError = ref('')

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
      items = await searchMusic(q)
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

// ---- Recommendation Engine ----
// Weighted categories so the suggestion feels like a real recommendation
// engine: continue-watching episodes rank highest, then popular unwatched
// movies, then random community picks. Popularity + recency add boost, and
// a jitter term keeps picks from being deterministic.
const SUGGESTION_WEIGHTS = {
  'missed-episode': 5,
  'unwatched-movie': 3,
  'random-movie': 1,
}

// A movie counts as "already watched" when the viewer has marked it
// completed/watching or rated it — those are the states that mean "seen".
function isWatchedByUser(item) {
  if (!item?.contentId) return false
  // Episode candidates are judged by their own episode state, never the
  // parent show's (a "watching" show must not hide its unwatched episodes).
  if (item.type === 'episode' && item.season && item.episode) {
    return isEpisodeWatched(item.contentId, item.season, item.episode)
  }
  const status = mediaStore.getMediaStatus(item.contentId)
  if (status && ['completed', 'watching'].includes(status.status)) return true
  const rating = mediaStore.getMediaRating(item.contentId)
  return rating !== null && rating !== undefined
}

// Check whether the viewer has watched a specific episode of a show.
function isEpisodeWatched(contentId, season, episode) {
  const status = mediaStore.getMediaStatus(contentId, season, episode)
  if (status && ['completed', 'watching'].includes(status.status)) return true
  const rating = mediaStore.getMediaRating(contentId, season, episode)
  return rating !== null && rating !== undefined
}

// "Continue watching": for every show the viewer is currently watching, find
// the next episode they haven't seen yet. These are the strongest signal.
async function buildMissedEpisodeCandidates() {
  const candidates = []
  if (!authStore.pubkey) return candidates

  const watchingShows = Object.values(mediaStore.statuses).filter(
    (s) => s.pubkey === authStore.pubkey && s.status === 'watching' && s.media?.type === 'show'
  )

  // Cap the number of shows we query so the home page stays snappy.
  const shows = watchingShows.slice(0, 5)

  await Promise.all(
    shows.map(async (show) => {
      try {
        const data = await fetchShowEpisodes({
          title: show.media.title || show.media.name,
          tmdbId: show.media.tmdbId,
          tvmazeId: show.media.tvmazeId,
          numberOfSeasons: show.media.seasons,
        })
        const unwatched = []
        for (const season of data.seasons || []) {
          for (const ep of season.episodes || []) {
            if (!isEpisodeWatched(show.contentId, ep.season, ep.episode)) {
              unwatched.push(ep)
            }
          }
        }
        unwatched.sort((a, b) => a.season - b.season || a.episode - b.episode)
        if (unwatched.length > 0) {
          const ep = unwatched[0]
          const showTitle = show.media.title || show.media.name || 'Show'
          candidates.push({
            category: 'missed-episode',
            contentId: show.contentId,
            type: 'episode',
            title: showTitle,
            name: showTitle,
            showTitle,
            episodeName: ep.name,
            season: ep.season,
            episode: ep.episode,
            year: show.media.year,
            poster: show.media.poster,
            overview: ep.summary || show.media.overview || '',
            reason: `Continue watching ${showTitle}`,
            latestActivityAt: show.createdAt || 0,
          })
        }
      } catch (err) {
        console.warn('Failed to build missed-episode suggestion:', err)
      }
    })
  )
  return candidates
}

// Score a candidate: base category weight + popularity + recency + jitter.
function scoreCandidate(candidate) {
  const base = SUGGESTION_WEIGHTS[candidate.category] || 1
  const popularity = Math.min(candidate.nostrEventCount || 0, 10) * 0.3
  const ageDays = Math.max(0, (Date.now() / 1000 - (candidate.latestActivityAt || 0)) / 86400)
  const recency = Math.max(0, 1 - ageDays / 7) * 1.5
  const jitter = Math.random() * 1.5
  return base + popularity + recency + jitter
}

// Weighted random pick — higher-scoring candidates surface more often, but
// the jitter keeps every shuffle fresh.
function pickWeightedSuggestion() {
  const pool = suggestionPool.value
  if (pool.length === 0) {
    suggestion.value = null
    return
  }
  const scored = pool.map((c) => ({ c, score: scoreCandidate(c) }))
  const total = scored.reduce((sum, s) => sum + s.score, 0)
  let roll = Math.random() * total
  for (const { c, score } of scored) {
    roll -= score
    if (roll <= 0) {
      suggestion.value = c
      return
    }
  }
  suggestion.value = scored[scored.length - 1].c
}

// Builds the weighted recommendation pool:
//  1. Missed episodes of shows you're watching (continue watching)
//  2. Popular movies on Nostr you haven't watched
//  3. A few random community picks (even ones you've seen — rewatch nudge)
async function loadSuggestions() {
  isLoadingSuggestion.value = true
  suggestionError.value = ''
  try {
    const [popular, missedEpisodes] = await Promise.all([
      mediaStore.fetchPopularMediaFromEvents({ type: 'movie', limit: 60 }),
      buildMissedEpisodeCandidates(),
    ])

    const pool = []
    pool.push(...missedEpisodes)

    const unwatched = popular.filter((item) => !isWatchedByUser(item))
    pool.push(
      ...unwatched.map((item) => ({
        ...item,
        category: 'unwatched-movie',
        reason: "Popular on Nostr you haven't seen",
      }))
    )

    // Random community picks — low weight, high jitter, occasionally a
    // rewatch nudge for something you've already seen.
    const randomCount = Math.min(5, popular.length)
    for (let i = 0; i < randomCount; i++) {
      const pick = popular[Math.floor(Math.random() * popular.length)]
      if (pick) {
        pool.push({
          ...pick,
          category: 'random-movie',
          reason: 'Random pick from the Nostr community',
        })
      }
    }

    // Deduplicate by contentId (a movie can appear in multiple categories).
    const seen = new Set()
    suggestionPool.value = pool.filter((c) => {
      if (!c?.contentId || seen.has(c.contentId)) return false
      seen.add(c.contentId)
      return true
    })

    pickWeightedSuggestion()
  } catch (err) {
    console.warn('Failed to load suggestions:', err)
    suggestionError.value = 'Could not load suggestions from Nostr relays.'
  } finally {
    isLoadingSuggestion.value = false
  }
}

function shuffleSuggestion() {
  pickWeightedSuggestion()
}

function openSuggestion() {
  const item = suggestion.value
  if (!item?.contentId) return
  mediaStore.cacheMediaItem(item)
  router.push({
    name: 'media-detail',
    params: { contentId: item.contentId },
    query: {
      type: item.type === 'episode' ? 'show' : item.type,
      title: item.showTitle || item.title || item.name,
      year: item.year,
      artist: item.artist,
    },
  })
}

const suggestionTitle = computed(() => {
  const item = suggestion.value
  if (!item) return ''
  if (item.category === 'missed-episode') return item.showTitle || item.title || item.name
  return item.title || item.name || ''
})

const suggestionEpisodeLabel = computed(() => {
  const item = suggestion.value
  if (!item || item.category !== 'missed-episode') return ''
  return `S${item.season}E${item.episode}${item.episodeName ? `: ${item.episodeName}` : ''}`
})

const suggestionPoster = computed(() => {
  const item = suggestion.value
  if (!item) return ''
  if (item.poster) return resolveIpfsUrl(item.poster)
  const meta = mediaStore.getMediaMetadata(item.contentId)
  return meta?.poster ? resolveIpfsUrl(meta.poster) : ''
})

onMounted(async () => {
  if (query.value.trim()) {
    executeSearch()
  }
  loadPopularFromNostr()
  loadSuggestions()

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

// Keep the suggestion honest: if the viewer just watched/rated the current
// suggestion (or anything in the pool), drop it and pick a fresh one.
watch(
  () => [mediaStore.statuses, mediaStore.ratings],
  () => {
    if (suggestionPool.value.length === 0) return
    suggestionPool.value = suggestionPool.value.filter((item) => !isWatchedByUser(item))
    if (suggestion.value && isWatchedByUser(suggestion.value)) {
      pickWeightedSuggestion()
    }
  },
  { deep: true }
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

    <!-- CASE 2: DEFAULT HOME VIEW (SUGGESTION + POPULAR ON NOSTR + LIVE FEED) -->
    <template v-else>
      <!-- Personalized Recommendation (weighted engine) -->
      <section class="section suggestion-section">
        <div class="section-header">
          <div>
            <div class="title-with-badge">
              <h2 class="section-title">🎯 Recommended for You</h2>
              <span class="badge badge-primary nostr-live-tag">⚡ Powered by Nostr</span>
            </div>
            <p class="section-subtitle">
              Continue watching, popular unwatched movies, and random community finds — weighted by your taste
            </p>
          </div>

          <button
            class="btn btn-secondary btn-sm"
            type="button"
            :disabled="isLoadingSuggestion || suggestionPool.length === 0"
            @click="shuffleSuggestion"
          >
            🎲 Shuffle
          </button>
        </div>

        <div v-if="isLoadingSuggestion" class="loading-state">
          <div class="spinner"></div>
          <p>Querying Nostr relays and building your recommendations...</p>
        </div>

        <div v-else-if="suggestion" class="suggestion-card card">
          <div class="suggestion-poster">
            <img
              v-if="suggestionPoster"
              :src="suggestionPoster"
              :alt="suggestionTitle"
              class="suggestion-poster-img"
              loading="lazy"
              @error="$event.target.style.display = 'none'"
            />
            <div v-else class="suggestion-poster-fallback">🎬</div>
          </div>

          <div class="suggestion-info">
            <div class="suggestion-meta">
              <span class="badge badge-primary suggestion-type-tag">
                {{ suggestion.category === 'missed-episode' ? 'Continue Watching' : suggestion.type }}
              </span>
              <span v-if="suggestion.category === 'missed-episode'" class="suggestion-episode-tag">
                S{{ suggestion.season }}E{{ suggestion.episode }}
              </span>
              <span v-if="suggestion.year" class="suggestion-year">{{ suggestion.year }}</span>
              <span v-if="suggestion.nostrEventCount" class="suggestion-stats">
                ⚡ {{ suggestion.nostrEventCount }} Nostr event{{ suggestion.nostrEventCount === 1 ? '' : 's' }}
              </span>
            </div>

            <h3 class="suggestion-title">{{ suggestionTitle }}</h3>
            <p v-if="suggestionEpisodeLabel" class="suggestion-episode-label">{{ suggestionEpisodeLabel }}</p>
            <p v-if="suggestion.overview" class="suggestion-overview">{{ suggestion.overview }}</p>
            <p v-if="suggestion.reason" class="suggestion-reason">{{ suggestion.reason }}</p>

            <div class="suggestion-actions">
              <button class="btn btn-primary" type="button" @click="openSuggestion">
                {{ suggestion.category === 'missed-episode' ? '▶ Watch Episode' : '▶ Track This Movie' }}
              </button>
              <button
                class="btn btn-outline btn-sm"
                type="button"
                :disabled="suggestionPool.length <= 1"
                @click="shuffleSuggestion"
              >
                🎲 Another
              </button>
            </div>
          </div>
        </div>

        <div v-else class="empty-feed card">
          <div class="empty-icon">🎲</div>
          <p v-if="suggestionError">{{ suggestionError }}</p>
          <p v-else-if="popularItems.length > 0">You've watched everything on the connected relays! 🎉</p>
          <p v-else>No media tracked on connected Nostr relays yet.</p>
          <p class="form-hint">Search for a movie above and track it — or wait for the community to add more!</p>
        </div>
      </section>

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

/* Personalized Suggestion Card */
.suggestion-card {
  display: flex;
  gap: 24px;
  padding: 20px;
  border-radius: var(--radius-md);
  border: 1px solid var(--border-subtle);
  background: var(--bg-card);
  overflow: hidden;
}

.suggestion-poster {
  flex-shrink: 0;
  width: 180px;
  aspect-ratio: 2 / 3;
  border-radius: var(--radius-sm);
  overflow: hidden;
  background: #0c0c0c;
  border: 1px solid var(--border-subtle);
}

.suggestion-poster-img {
  width: 100%;
  height: 100%;
  object-fit: cover;
  display: block;
}

.suggestion-poster-fallback {
  width: 100%;
  height: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 3rem;
  opacity: 0.5;
}

.suggestion-info {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.suggestion-meta {
  display: flex;
  align-items: center;
  gap: 10px;
  flex-wrap: wrap;
}

.suggestion-type-tag {
  font-size: 0.68rem;
  text-transform: uppercase;
  letter-spacing: 0.04em;
}

.suggestion-episode-tag {
  font-size: 0.72rem;
  font-family: var(--font-mono);
  color: var(--accent-emerald);
  background: rgba(16, 185, 129, 0.12);
  border: 1px solid rgba(16, 185, 129, 0.3);
  padding: 2px 8px;
  border-radius: var(--radius-full);
}

.suggestion-year {
  font-size: 0.85rem;
  color: var(--text-muted);
  font-family: var(--font-mono);
}

.suggestion-stats {
  font-size: 0.75rem;
  color: var(--accent-emerald);
  font-family: var(--font-mono);
}

.suggestion-title {
  font-size: 1.6rem;
  font-weight: 700;
  letter-spacing: -0.03em;
  line-height: 1.15;
  color: var(--text-main);
}

.suggestion-episode-label {
  font-size: 1rem;
  font-weight: 600;
  color: var(--accent-emerald);
  letter-spacing: -0.01em;
}

.suggestion-reason {
  font-size: 0.78rem;
  color: var(--text-muted);
  font-family: var(--font-mono);
  letter-spacing: 0.02em;
}

.suggestion-overview {
  font-size: 0.92rem;
  color: var(--text-secondary);
  line-height: 1.55;
  display: -webkit-box;
  -webkit-line-clamp: 4;
  -webkit-box-orient: vertical;
  overflow: hidden;
}

.suggestion-actions {
  display: flex;
  align-items: center;
  gap: 12px;
  margin-top: auto;
  padding-top: 8px;
}

@media (max-width: 640px) {
  .suggestion-card {
    flex-direction: column;
    gap: 16px;
  }

  .suggestion-poster {
    width: 100%;
    max-width: 220px;
    margin: 0 auto;
  }

  .suggestion-title {
    font-size: 1.3rem;
  }
}
</style>
