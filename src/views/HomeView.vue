<script setup>
import { ref, watch, onMounted, computed } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useMediaStore } from '@/stores/media.js'
import { useAuthStore } from '@/stores/auth.js'
import { searchTmdb, getTmdbDetails } from '@/services/api/tmdb.js'
import { searchMusic, getMusicDetails } from '@/services/api/music.js'
import { fetchShowEpisodes } from '@/services/api/tv.js'
import { computeContentId } from '@/utils/contentId.js'
import MediaCard from '@/components/MediaCard.vue'
import RecommendationCard from '@/components/RecommendationCard.vue'

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

// Personalized Recommendation state (weighted 3-row engine)
const MAX_RECOMMENDATIONS_PER_CATEGORY = 5
const recommendations = ref({ movies: [], series: [], music: [] })
const isLoadingRecommendations = ref(false)
const recentlyShownContentIds = ref(new Set())
const categoryCandidatePools = ref({ movies: [], series: [], music: [] })

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
      const itemTitle = (item?.title || item?.name || '').trim()
      const itemYear = String(item?.year || '').trim()
      if (!itemTitle || !itemYear) continue
      if (item.type === 'music' && !(item.artist || '').trim()) continue

      let contentId = ''
      let canonicalString = ''
      try {
        ;({ contentId, canonicalString } = await computeContentId({
          type: item.type,
          title: itemTitle,
          year: itemYear,
          artist: item.artist,
        }))
      } catch {
        continue // unidentifiable result (e.g. music without artist or missing year) — skip it
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

// Enrichment cache: contentId -> in-flight/settled promise. Nostr events
// carry no poster, so grids lazily fetch provider details (same path as the
// detail page) and cache them via mediaStore for instant repeat renders.
const enrichmentCache = new Map()

async function enrichMediaItem(item) {
  if (!item?.contentId || item.poster) return item
  const title = item.title || item.name || ''
  if (!title || title === 'Loading...') return item
  if (enrichmentCache.has(item.contentId)) {
    return enrichmentCache.get(item.contentId)
  }
  const promise = (async () => {
    try {
      let details = null
      if (item.type === 'music') {
        details = await getMusicDetails({ title, artist: item.artist || '', year: item.year || '' })
      } else if (item.type === 'movie' || item.type === 'show') {
        details = await getTmdbDetails(item.type, item.tmdbId || item.id, title, item.year || '')
      }
      if (details?.poster) {
        const enriched = { ...item, ...details, contentId: item.contentId }
        mediaStore.cacheMediaItem(enriched)
        return enriched
      }
    } catch (err) {
      console.warn('Failed to enrich grid item:', title, err)
    }
    return item
  })()
  enrichmentCache.set(item.contentId, promise)
  return promise
}

// Background-enrich a grid row without blocking first paint: render Nostr
// titles immediately, then patch posters in as provider lookups resolve.
function enrichGridItems(items, apply) {
  const targets = (items || []).filter((it) => it?.contentId && !it.poster)
  if (!targets.length) return
  // Small concurrency keeps Wikipedia/TVMaze happy on an 18-card grid.
  const CONCURRENCY = 4
  let cursor = 0
  const worker = async () => {
    while (cursor < targets.length) {
      const item = targets[cursor++]
      const enriched = await enrichMediaItem(item)
      if (enriched !== item) apply(enriched)
    }
  }
  Promise.all(Array.from({ length: Math.min(CONCURRENCY, targets.length) }, worker)).catch(() => {})
}

function applyEnrichedPopular(enriched) {
  const idx = popularItems.value.findIndex((it) => it.contentId === enriched.contentId)
  if (idx !== -1) popularItems.value[idx] = { ...popularItems.value[idx], ...enriched }
}

function applyEnrichedRecommendation(enriched) {
  for (const row of ['movies', 'series', 'music']) {
    const idx = recommendations.value[row].findIndex((it) => it.contentId === enriched.contentId)
    if (idx !== -1) recommendations.value[row][idx] = { ...recommendations.value[row][idx], ...enriched }
  }
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
    enrichGridItems(items, applyEnrichedPopular)
  } catch (err) {
    console.warn('Failed to load popular items from Nostr:', err)
  } finally {
    isLoadingPopular.value = false
  }
}

// ---- Recommendation Engine ----
// Weighted categories so the recommendations feel like a real recommendation
// engine: continue-watching episodes rank highest, followed by Kind 35401
// community suggestions (personalized based on titles you loved/tracked),
// then popular unwatched items, and random community picks.
// Weighted categories so the recommendations feel like a real recommendation
// engine: continue-watching episodes rank highest, followed by followed picks,
// Kind 35401 community suggestions, unwatched popular items, and random picks.
const SUGGESTION_WEIGHTS = {
  'missed-episode': 6.0,
  'followed-pick': 4.5,
  'community-suggestion': 3.5,
  unwatched: 2.0,
  random: 1.0,
}

// A movie counts as "already watched / excluded" when the viewer has marked it
// completed/watching/dropped/on-hold, rated it, or dismissed it.
function isWatchedByUser(item) {
  if (!item?.contentId) return false
  if (mediaStore.isRecommendationDismissed && mediaStore.isRecommendationDismissed(item.contentId)) return true
  // Episode candidates are judged by their own episode state, never the
  // parent show's (a "watching" show must not hide its unwatched episodes).
  if (item.type === 'episode' && item.season && item.episode) {
    return isEpisodeWatched(item.contentId, item.season, item.episode)
  }
  const status = mediaStore.getMediaStatus(item.contentId)
  if (status && ['completed', 'watching', 'dropped', 'on-hold'].includes(status.status)) return true
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
        console.warn('Failed to build missed-episode recommendation:', err)
      }
    })
  )
  return candidates
}

// Gathers the viewer's tracked and highly rated items to seed Kind 35401 recommendations.
// Excludes low ratings (<= 5) and dropped/on-hold statuses to prevent negative seeding.
function getUserSeedMedia() {
  if (!authStore.pubkey) return []
  const userPubkey = authStore.pubkey
  const seeds = new Map()

  // 1. User ratings (higher rating = stronger recommendation seed; ignore <= 5)
  Object.values(mediaStore.ratings).forEach((r) => {
    if (r && r.pubkey === userPubkey && r.contentId) {
      const rating = Number(r.rating) || 0
      if (rating <= 5) return
      const weight = rating >= 8 ? 2.5 : 1.8
      const title = r.media?.name || r.media?.title || ''
      seeds.set(r.contentId, {
        contentId: r.contentId,
        title,
        name: title,
        type: r.media?.type || 'movie',
        rating,
        weight,
        createdAt: r.createdAt || 0,
      })
    }
  })

  // 2. User statuses (completed, watching, listening; strictly exclude dropped / on-hold)
  Object.values(mediaStore.statuses).forEach((s) => {
    if (s && s.pubkey === userPubkey && s.contentId) {
      if (s.status === 'dropped' || s.status === 'on-hold') return
      const isCompleted = s.status === 'completed'
      const isWatching = ['watching', 'listening'].includes(s.status)
      if (!isCompleted && !isWatching) return

      const baseWeight = isCompleted ? 2.0 : 1.8
      const existing = seeds.get(s.contentId)
      const title = s.media?.name || s.media?.title || existing?.title || ''
      seeds.set(s.contentId, {
        contentId: s.contentId,
        title,
        name: title,
        type: s.media?.type || existing?.type || 'movie',
        rating: existing?.rating ?? null,
        weight: Math.max(existing?.weight || 0, baseWeight),
        createdAt: Math.max(existing?.createdAt || 0, s.createdAt || 0),
      })
    }
  })

  return Array.from(seeds.values()).sort((a, b) => {
    if (b.weight !== a.weight) return b.weight - a.weight
    return (b.createdAt || 0) - (a.createdAt || 0)
  })
}

// Identifies titles the user explicitly disliked (rated <= 5 or dropped)
function getDislikedContentIds() {
  if (!authStore.pubkey) return new Set()
  const userPubkey = authStore.pubkey
  const disliked = new Set()

  Object.values(mediaStore.ratings).forEach((r) => {
    if (r && r.pubkey === userPubkey && r.contentId) {
      const rating = Number(r.rating) || 0
      if (rating > 0 && rating <= 5) {
        disliked.add(String(r.contentId).split(':')[0].toLowerCase())
      }
    }
  })

  Object.values(mediaStore.statuses).forEach((s) => {
    if (s && s.pubkey === userPubkey && s.contentId) {
      if (s.status === 'dropped') {
        disliked.add(String(s.contentId).split(':')[0].toLowerCase())
      }
    }
  })

  return disliked
}

// Checks if a suggestion stems solely from sources the user disliked
function isSuggestedOnlyFromDisliked(targetCid, disliked) {
  if (!disliked || !disliked.size) return false
  const targetBase = String(targetCid).split(':')[0].toLowerCase()
  let hasValidSource = false
  let hasDislikedSource = false

  for (const entry of Object.values(mediaStore.suggestions)) {
    if (!entry || !Array.isArray(entry.items)) continue
    const sourceBase = String(entry.contentId || entry.dTag || '').split(':')[0].toLowerCase()
    const matchesTarget = entry.items.some((it) => it && String(it.contentId).split(':')[0].toLowerCase() === targetBase)
    if (matchesTarget) {
      if (disliked.has(sourceBase)) {
        hasDislikedSource = true
      } else {
        hasValidSource = true
      }
    }
  }

  return hasDislikedSource && !hasValidSource
}

// Builds personalized Kind 35401 community suggestion candidates matching the specified media type
async function buildCommunitySuggestionCandidates(type, userSeeds = []) {
  const candidates = []
  const seenTargets = new Set()
  const dislikedSeeds = getDislikedContentIds()

  const typeMatches = (mType) => {
    if (!type) return true
    if (type === 'show') return mType === 'show' || mType === 'episode'
    return mType === type
  }

  // 1. Personalized suggestions for items the user liked or tracked
  for (const seed of userSeeds) {
    const suggestionsForSeed = mediaStore.getSimilarSuggestionsForMedia(seed.contentId)
    for (const sugg of suggestionsForSeed) {
      if (!sugg?.contentId || seenTargets.has(sugg.contentId)) continue
      if (!typeMatches(sugg.type)) continue
      if (isWatchedByUser(sugg)) continue
      if (dislikedSeeds.has(String(sugg.contentId).split(':')[0].toLowerCase())) continue

      seenTargets.add(sugg.contentId)
      const seedTitle = seed.title || seed.name || 'a title you tracked'
      const reason = seed.rating && seed.rating >= 7
        ? `Because you liked ${seedTitle}`
        : `Similar to ${seedTitle}`

      const followEngagement = mediaStore.getFollowEngagement ? mediaStore.getFollowEngagement(sugg.contentId) : {}
      const libMedia = mediaStore.getMediaMetadata(sugg.contentId)

      candidates.push({
        ...sugg,
        title: sugg.title || sugg.name,
        name: sugg.name || sugg.title,
        poster: libMedia?.poster || sugg.poster || '',
        category: 'community-suggestion',
        reason,
        seedWeight: (seed.weight || 1) * 1.5,
        followEngagement,
        latestActivityAt: sugg.latestCreatedAt || 0,
      })
    }
  }

  // 2. Global community suggestions (Community consensus picks & followed picks)
  const allSuggestions = mediaStore.getAllCommunitySuggestions ? mediaStore.getAllCommunitySuggestions() : []
  for (const sugg of allSuggestions) {
    if (!sugg?.contentId || seenTargets.has(sugg.contentId)) continue
    if (!typeMatches(sugg.type)) continue
    if (isWatchedByUser(sugg)) continue
    if (dislikedSeeds.has(String(sugg.contentId).split(':')[0].toLowerCase())) continue
    if (isSuggestedOnlyFromDisliked(sugg.contentId, dislikedSeeds)) continue

    seenTargets.add(sugg.contentId)
    const followEngagement = mediaStore.getFollowEngagement ? mediaStore.getFollowEngagement(sugg.contentId) : {}
    const libMedia = mediaStore.getMediaMetadata(sugg.contentId)

    let category = 'community-suggestion'
    let reason = sugg.voteCount > 1 ? `Community consensus (${sugg.voteCount})` : 'Community pick'
    if (followEngagement.isFollowedPick && followEngagement.reason) {
      category = 'followed-pick'
      reason = followEngagement.reason
    }

    candidates.push({
      ...sugg,
      title: sugg.title || sugg.name,
      name: sugg.name || sugg.title,
      poster: libMedia?.poster || sugg.poster || '',
      category,
      reason,
      seedWeight: 0.5,
      followEngagement,
      latestActivityAt: sugg.latestCreatedAt || 0,
    })
  }

  return candidates
}

// Score a candidate: base category weight + popularity + seed boost + recency + follow graph boost + rotation penalty.
function scoreCandidate(candidate) {
  const base = SUGGESTION_WEIGHTS[candidate.category] || 1
  const votes = candidate.voteCount || candidate.nostrEventCount || 0
  const popularity = Math.min(votes, 10) * 0.35
  const ageDays = Math.max(0, (Date.now() / 1000 - (candidate.latestActivityAt || 0)) / 86400)
  const recency = Math.max(0, 1 - ageDays / 7) * 1.5
  const seedBoost = candidate.seedWeight || 0

  // Follow boost: prioritized if someone you follow loved/suggested/watched it
  let followBoost = 0
  if (candidate.followEngagement?.isFollowedPick) {
    followBoost = 2.5 + Math.min(candidate.followEngagement.followedCount || 1, 3) * 0.5
  }

  let totalScore = base + popularity + seedBoost + recency + followBoost

  // Session rotation penalty: if displayed in the current batch, heavily deprioritize so fresh titles rotate in
  if (recentlyShownContentIds.value.has(candidate.contentId)) {
    totalScore *= 0.15
  }

  return Math.max(0.1, totalScore)
}

/**
 * Weighted random sampling without replacement using the Efraimidis-Spirakis algorithm
 * (key = random() ^ (1 / weight)). Higher scored items are much more likely to be chosen,
 * while allowing candidate diversity across refreshes.
 */
function sampleWeightedCandidates(candidates, count = 5) {
  if (!candidates || candidates.length <= count) return candidates ? [...candidates] : []

  const keyed = candidates.map((c) => ({
    item: c,
    key: Math.pow(Math.random(), 1 / Math.max(0.01, c.score || 0.1)),
  }))

  keyed.sort((a, b) => b.key - a.key)
  return keyed.slice(0, count).map((k) => k.item)
}

// Builds a scored candidate pool for one media type
async function buildCategoryRecommendations(type, userSeeds = []) {
  const [popular, communitySuggestions] = await Promise.all([
    mediaStore.fetchPopularMediaFromEvents({ type, limit: 60 }),
    buildCommunitySuggestionCandidates(type, userSeeds),
  ])
  const pool = []

  // 1. Kind 35401 community suggestions
  pool.push(...communitySuggestions)

  // 2. Unwatched popular items (with follow graph recognition)
  const unwatched = popular.filter((item) => !isWatchedByUser(item))
  const label = type === 'show' ? 'Popular series' : type === 'music' ? 'Popular music' : 'Popular movie'
  for (const item of unwatched) {
    const followEngagement = mediaStore.getFollowEngagement ? mediaStore.getFollowEngagement(item.contentId) : {}
    let category = 'unwatched'
    let reason = label
    if (followEngagement.isFollowedPick && followEngagement.reason) {
      category = 'followed-pick'
      reason = followEngagement.reason
    }
    pool.push({
      ...item,
      category,
      reason,
      followEngagement,
    })
  }

  // 3. Random community picks — low weight
  const randomCount = Math.min(4, popular.length)
  for (let i = 0; i < randomCount; i++) {
    const pick = popular[Math.floor(Math.random() * popular.length)]
    if (pick && !isWatchedByUser(pick)) {
      pool.push({
        ...pick,
        category: 'random',
        reason: 'Random pick',
      })
    }
  }

  // Deduplicate by contentId
  const seen = new Set()
  const deduped = pool.filter((c) => {
    if (!c?.contentId || seen.has(c.contentId)) return false
    seen.add(c.contentId)
    return true
  })

  return deduped.map((c) => ({ ...c, score: scoreCandidate(c) }))
}

// Builds all three recommendation rows (movies, series, music) in parallel.
async function loadRecommendations() {
  isLoadingRecommendations.value = true
  try {
    // 1. Fetch recent activity from followed users in parallel if available
    if (typeof mediaStore.fetchFollowedActivity === 'function') {
      await mediaStore.fetchFollowedActivity(50)
    }

    // 2. Gather user seeds from statuses and ratings
    const userSeeds = getUserSeedMedia()
    const seedContentIds = userSeeds.map((s) => s.contentId)

    // 3. Query Nostr relays for Kind 35401 suggestions matching seed items
    if (typeof mediaStore.fetchCommunitySuggestions === 'function') {
      await mediaStore.fetchCommunitySuggestions(seedContentIds)
    }

    // 4. Build category candidate pools in parallel
    const [moviePool, showPool, musicPool, missedEpisodes] = await Promise.all([
      buildCategoryRecommendations('movie', userSeeds),
      buildCategoryRecommendations('show', userSeeds),
      buildCategoryRecommendations('music', userSeeds),
      buildMissedEpisodeCandidates(),
    ])

    categoryCandidatePools.value.movies = moviePool
    categoryCandidatePools.value.music = musicPool

    const seenSeries = new Set()
    const dedupedSeries = [...missedEpisodes, ...showPool].filter((c) => {
      const key = c?.contentId ? `${c.contentId}:s${c.season || 0}e${c.episode || 0}` : null
      if (!key || seenSeries.has(key)) return false
      seenSeries.add(key)
      return true
    })

    const scoredSeries = dedupedSeries.map((c) => ({ ...c, score: scoreCandidate(c) }))
    categoryCandidatePools.value.series = scoredSeries

    // Sample top items per category using weighted sampling
    const movies = sampleWeightedCandidates(moviePool, MAX_RECOMMENDATIONS_PER_CATEGORY)
    const seriesRow = sampleWeightedCandidates(scoredSeries, MAX_RECOMMENDATIONS_PER_CATEGORY)
    const music = sampleWeightedCandidates(musicPool, MAX_RECOMMENDATIONS_PER_CATEGORY)

    // Update recently shown set so clicking "Refresh Picks" immediately rotates in new candidates
    const currentShown = new Set()
    ;[...movies, ...seriesRow, ...music].forEach((c) => {
      if (c?.contentId) currentShown.add(c.contentId)
    })
    recentlyShownContentIds.value = currentShown

    recommendations.value = { movies, series: seriesRow, music }
    enrichGridItems([...movies, ...seriesRow, ...music], applyEnrichedRecommendation)
  } catch (err) {
    console.warn('Failed to load recommendations:', err)
  } finally {
    isLoadingRecommendations.value = false
  }
}

// Handles user dismissal of an unwanted recommendation
function handleDismiss(category, item) {
  if (!item?.contentId) return
  mediaStore.dismissRecommendation(item.contentId)

  const isMatchingItem = (it) => {
    if (it.contentId !== item.contentId) return false
    if (it.type === 'episode' && item.type === 'episode') {
      return it.season === item.season && it.episode === item.episode
    }
    return true
  }

  if (recommendations.value[category]) {
    recommendations.value[category] = recommendations.value[category].filter(
      (it) => !isMatchingItem(it)
    )
  }

  // Draw a fresh replacement from the candidate pool if available
  const pool = categoryCandidatePools.value[category] || []
  const activeIds = new Set(recommendations.value[category].map((it) => it.contentId))
  activeIds.add(item.contentId)

  const available = pool.filter(
    (c) => !activeIds.has(c.contentId) && !mediaStore.isRecommendationDismissed(c.contentId)
  )
  if (available.length > 0) {
    const replacement = sampleWeightedCandidates(available, 1)[0]
    if (replacement) {
      recommendations.value[category].push(replacement)
      enrichGridItems([replacement], applyEnrichedRecommendation)
    }
  }
}

onMounted(async () => {
  if (query.value.trim()) {
    executeSearch()
  }
  loadPopularFromNostr()
  if (authStore.isAuthenticated) {
    loadRecommendations()
  }

  if (route.query.focus === 'search' || route.query.track === 'true') {
    setTimeout(() => {
      searchInputRef.value?.focus()
    }, 150)
  }
})

watch(
  () => authStore.isAuthenticated,
  (isAuth) => {
    if (isAuth) {
      loadRecommendations()
    } else {
      recommendations.value = { movies: [], series: [], music: [] }
    }
  }
)

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

// Keep recommendations honest: if the viewer just watched/rated something,
// drop it from its row so it stops being suggested.
watch(
  () => [mediaStore.statuses, mediaStore.ratings],
  () => {
    const filterRow = (row) => row.filter((item) => !isWatchedByUser(item))
    recommendations.value = {
      movies: filterRow(recommendations.value.movies),
      series: filterRow(recommendations.value.series),
      music: filterRow(recommendations.value.music),
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

    <!-- CASE 2: DEFAULT HOME VIEW (POPULAR ON NOSTR + RECOMMENDATIONS) -->
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

      <!-- Recommended for You (3 rows: movies, series, music) -->
      <section v-if="authStore.isAuthenticated" class="section recommendations-section">
        <div class="section-header">
          <div>
            <div class="title-with-badge">
              <h2 class="section-title">🎯 Recommended for You</h2>
              <span class="badge badge-primary nostr-live-tag">⚡ Powered by Nostr</span>
            </div>
            <p class="section-subtitle">
              Personalized picks weighted by your taste — continue watching, community suggestions, popular, and random finds
            </p>
          </div>

          <button
            class="btn btn-secondary btn-sm"
            type="button"
            :disabled="isLoadingRecommendations"
            @click="loadRecommendations"
          >
            {{ isLoadingRecommendations ? 'Refreshing...' : '🎲 Refresh Picks' }}
          </button>
        </div>

        <div v-if="isLoadingRecommendations" class="loading-state">
          <div class="spinner"></div>
          <p>Building your recommendations from Nostr relays...</p>
        </div>

        <template v-else>
          <div v-if="recommendations.movies.length" class="recommendation-row">
            <h3 class="recommendation-row-title">🎬 Movies</h3>
            <div class="recommendation-grid">
              <RecommendationCard
                v-for="item in recommendations.movies.slice(0, 5)"
                :key="item.contentId"
                :item="item"
                @dismiss="(it) => handleDismiss('movies', it)"
              />
            </div>
          </div>

          <div v-if="recommendations.series.length" class="recommendation-row">
            <h3 class="recommendation-row-title">📺 Series</h3>
            <div class="recommendation-grid">
              <RecommendationCard
                v-for="item in recommendations.series.slice(0, 5)"
                :key="`${item.contentId}:s${item.season || 0}e${item.episode || 0}`"
                :item="item"
                @dismiss="(it) => handleDismiss('series', it)"
              />
            </div>
          </div>

          <div v-if="recommendations.music.length" class="recommendation-row">
            <h3 class="recommendation-row-title">🎵 Music</h3>
            <div class="recommendation-grid">
              <RecommendationCard
                v-for="item in recommendations.music.slice(0, 5)"
                :key="item.contentId"
                :item="item"
                @dismiss="(it) => handleDismiss('music', it)"
              />
            </div>
          </div>

          <div
            v-if="!recommendations.movies.length && !recommendations.series.length && !recommendations.music.length"
            class="empty-feed card"
          >
            <div class="empty-icon">🎯</div>
            <p>No recommendations available yet.</p>
            <p class="form-hint">Track media or wait for the community to add more on Nostr!</p>
          </div>
        </template>
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
    padding: 20px 0 16px;
  }

  .hero-title {
    font-size: clamp(1.6rem, 6vw, 2.1rem);
    line-height: 1.15;
  }

  .hero-subtitle {
    font-size: 0.88rem;
    margin-bottom: 20px;
    line-height: 1.5;
  }

  .search-input {
    height: 46px;
    font-size: 0.92rem;
  }

  .search-tabs {
    display: flex;
    width: 100%;
  }

  .search-tabs .tab-btn {
    flex: 1;
    text-align: center;
    padding: 8px 4px;
    font-size: 0.8rem;
  }

  .section-header {
    flex-direction: column;
    align-items: flex-start;
    gap: 12px;
    margin-bottom: 18px;
  }

  .section-header .btn {
    width: 100%;
    justify-content: center;
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

/* Recommended for You (3 rows) */
.recommendation-row {
  margin-bottom: 32px;
  width: 100%;
}

.recommendation-row:last-child {
  margin-bottom: 0;
}

.recommendation-row-title {
  font-size: 1.05rem;
  font-weight: 700;
  letter-spacing: -0.02em;
  color: var(--text-main);
  margin-bottom: 14px;
}

.recommendation-grid,
.recommendation-scroll {
  display: grid;
  grid-template-columns: repeat(5, minmax(0, 1fr));
  gap: 20px;
  width: 100%;
}

@media (max-width: 960px) {
  .recommendation-grid,
  .recommendation-scroll {
    grid-template-columns: repeat(3, minmax(0, 1fr));
    gap: 14px;
  }
}

@media (max-width: 600px) {
  .recommendation-grid,
  .recommendation-scroll {
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 12px;
  }
}
</style>
