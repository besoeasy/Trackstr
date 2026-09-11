import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import { nostrClient } from '@/services/nostr/client.js'
import {
  KINDS,
  buildRatingEvent,
  buildStatusEvent,
  buildSimilarSuggestionEvent,
  buildDeletionEvent,
} from '@/services/nostr/events.js'
import { buildDTag, cleanShowTitle, assertContentId } from '@/utils/contentId.js'
import {
  saveMediaCache,
  loadMediaCache,
  saveEventCache,
  loadEventCache,
  saveAppMeta,
  getAppMeta,
  pruneExpiredCache,
  clearMediaAndEventCache,
} from '@/services/db/indexedDb.js'
import { useAuthStore } from './auth.js'

export const useMediaStore = defineStore('media', () => {
  const authStore = useAuthStore()

  // State
  const statuses = ref({}) // key: dTag -> { status, progress, eventId, createdAt, media, cachedAt }
  const ratings = ref({}) // key: dTag -> { rating, content, spoiler, eventId, createdAt, media, cachedAt }
  const suggestions = ref({}) // key: authorKey -> { dTag, contentId, items, note, eventId, createdAt, pubkey, media, cachedAt }
  const mediaLibrary = ref({}) // key: contentId -> base media object with cachedAt
  const follows = ref({}) // key: pubkey -> 1 (viewer's NIP-02 follow list, for metadata preference)
  // Nostr-event provenance: contentIds observed in ingested Nostr events.
  // mediaLibrary also caches provider search results (TMDB/MusicBrainz), so
  // Nostr-only surfaces must filter by this set. key: contentId -> 1
  const nostrContentIds = ref({})

  // Reviews are unified into Kind 35400 ratings carrying written commentary in `content`
  const reviews = computed(() => {
    return Object.values(ratings.value)
      .filter((r) => r && (r.isReview || (typeof r.content === 'string' && r.content.trim().length > 0)))
      .map((r) => ({
        id: r.eventId || r.id,
        eventId: r.eventId || r.id,
        dTag: r.dTag || r.contentId,
        contentId: r.contentId,
        content: r.content,
        rating: r.rating,
        spoiler: !!r.spoiler,
        createdAt: r.createdAt,
        pubkey: r.pubkey,
        media: r.media,
      }))
      .sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0))
  })

  const isSyncing = ref(false)
  const lastSyncedAt = ref(0)
  const isCacheLoaded = ref(false)

  // Asynchronous cache initialization (IndexedDB with 30-day expiry + legacy localStorage migration)
  const cacheInitPromise = initCache()

  function cleanseMemoryCache() {
    // Prune any legacy or corrupt cached items missing mandatory metadata (name/title, year, or artist for music)
    Object.keys(mediaLibrary.value).forEach((cid) => {
      const m = mediaLibrary.value[cid]
      if (!m || !(m.name || m.title) || !m.year || (m.type === 'music' && !m.artist)) {
        delete mediaLibrary.value[cid]
        delete nostrContentIds.value[cid]
      } else if (m.type === 'episode' || /S\d+E\d+/i.test(m.name || m.title || '')) {
        mediaLibrary.value[cid] = toShowLevel(m)
      }
    })

    Object.keys(statuses.value).forEach((k) => {
      const s = statuses.value[k]
      if (!s?.media || !(s.media.name || s.media.title) || !s.media.year || (s.media.type === 'music' && !s.media.artist)) {
        delete statuses.value[k]
      }
    })

    Object.keys(ratings.value).forEach((k) => {
      const r = ratings.value[k]
      if (!r?.media || !(r.media.name || r.media.title) || !r.media.year || (r.media.type === 'music' && !r.media.artist)) {
        delete ratings.value[k]
      }
    })

    Object.keys(suggestions.value).forEach((k) => {
      const sg = suggestions.value[k]
      if (!sg?.media || !(sg.media.name || sg.media.title) || !sg.media.year || (sg.media.type === 'music' && !sg.media.artist)) {
        delete suggestions.value[k]
      } else if (Array.isArray(sg.items)) {
        sg.items = sg.items.filter((it) => it && (it.name || it.title) && it.year && (it.type !== 'music' || it.artist))
      }
    })
  }

  async function initCache() {
    try {
      // 1. Load non-expired media and event cache from IndexedDB (30-day TTL)
      const [cachedMedia, cachedStatuses, cachedRatings, cachedSuggestions, savedFollows, savedLastSynced, savedNostrCids] = await Promise.all([
        loadMediaCache(),
        loadEventCache('status'),
        loadEventCache('rating'),
        loadEventCache('suggestion'),
        getAppMeta('follows', {}),
        getAppMeta('lastSyncedAt', 0),
        getAppMeta('nostrContentIds', {}),
      ])

      mediaLibrary.value = { ...(cachedMedia || {}), ...mediaLibrary.value }
      statuses.value = { ...(cachedStatuses || {}), ...statuses.value }
      ratings.value = { ...(cachedRatings || {}), ...ratings.value }
      suggestions.value = { ...(cachedSuggestions || {}), ...suggestions.value }
      follows.value = { ...(savedFollows || {}), ...follows.value }
      if (!lastSyncedAt.value) {
        lastSyncedAt.value = savedLastSynced || 0
      }
      nostrContentIds.value = { ...(savedNostrCids || {}), ...nostrContentIds.value }

      // 2. Cleanse any invalid or corrupt memory entries
      cleanseMemoryCache()

      // 3. Background purge of expired records (>30 days) from IndexedDB
      pruneExpiredCache().catch((err) => console.warn('Cache pruning warning:', err))

      isCacheLoaded.value = true
    } catch (err) {
      console.warn('Failed to load media & event cache from IndexedDB:', err)
      isCacheLoaded.value = true
    }
  }

  let saveDebounceTimer = null

  function saveToIndexedDb() {
    if (saveDebounceTimer) clearTimeout(saveDebounceTimer)
    saveDebounceTimer = setTimeout(() => {
      flushSaveToIndexedDb()
    }, 150)
  }

  async function flushSaveToIndexedDb() {
    try {
      await Promise.all([
        saveMediaCache(mediaLibrary.value),
        saveEventCache('status', statuses.value),
        saveEventCache('rating', ratings.value),
        saveEventCache('suggestion', suggestions.value),
        saveAppMeta('follows', follows.value),
        saveAppMeta('lastSyncedAt', lastSyncedAt.value),
        saveAppMeta('nostrContentIds', nostrContentIds.value),
      ])
    } catch (err) {
      console.warn('Failed to save media cache to IndexedDB:', err)
    }
  }

  async function clearCache() {
    statuses.value = {}
    ratings.value = {}
    suggestions.value = {}
    mediaLibrary.value = {}
    follows.value = {}
    nostrContentIds.value = {}
    lastSyncedAt.value = 0
    await clearMediaAndEventCache()
  }

  /**
   * Parses media attributes from event tags. Never defaults the type and
   * never mistakes an episode-suffixed d-tag for a contentid.
   */
  function parseMediaTags(tags) {
    const safeTags = Array.isArray(tags) ? tags : []
    const getTag = (name) => safeTags.find((t) => t[0] === name)?.[1]
    const rawCid = getTag('contentid') || ''
    const contentId = /^[0-9a-f]{64}$/i.test(rawCid) ? rawCid.toLowerCase() : ''
    const type = getTag('type') || ''
    const name = getTag('name') || ''
    const year = getTag('year') || ''
    const season = getTag('season')
    const episode = getTag('episode')
    const artist = getTag('artist') || ''
    const qualifier = getTag('qualifier') || ''

    return {
      contentId,
      type,
      name,
      year,
      season,
      episode,
      artist,
      qualifier,
    }
  }


  /**
   * Episode records fold into their parent show: they share the show's
   * contentId, so storing them raw in mediaLibrary would clobber the show's
   * type with 'episode' and break the show's detail page. Store a show-level
   * view instead, stripping the " - S01E01: ..." suffix from the name.
   */
  function toShowLevel(episodeMedia) {
    const raw = episodeMedia.name || ''
    const name = cleanShowTitle(raw)
    return {
      ...episodeMedia,
      type: 'show',
      name,
      title: name,
      season: undefined,
      episode: undefined,
    }
  }

  /**
   * Ingests a raw Nostr event into our state
   */
  function ingestEvent(evt, options = {}) {
    if (!evt || !Array.isArray(evt.tags)) return
    // Inbound NIP-09 deletion notices are applied, never stored.
    if (evt.kind === KINDS.DELETION) {
      applyDeletionEvent(evt)
      return
    }
    const media = parseMediaTags(evt.tags)
    // Drop malformed events missing mandatory metadata: contentId, type, name, year
    if (!media.contentId || !media.type || !(media.name || media.title) || !media.year) return
    if (media.type === 'music' && !media.artist) return
    const dTag = evt.tags.find((t) => t[0] === 'd')?.[1] || media.contentId
    // Mutable state is scoped per (author, d-tag): strangers' events never
    // overwrite the viewer's own status/rating.
    const authorKey = `${evt.pubkey || 'unknown'}:${dTag}`

    if (media.contentId) {
      const existing = mediaLibrary.value[media.contentId]
      if (!existing || existing.type === 'episode') {
        mediaLibrary.value[media.contentId] = media.type === 'episode' ? toShowLevel(media) : media
      }
    }
    if (media.contentId) {
      // Record Nostr provenance so Nostr-only surfaces can distinguish
      // event-sourced items from cached provider (TMDB/MusicBrainz) results.
      nostrContentIds.value[media.contentId] = 1
    }

    if (evt.kind === KINDS.STATUS) {
      const statusTag = evt.tags.find((t) => t[0] === 'status')?.[1]
      const progressTag = evt.tags.find((t) => t[0] === 'progress')?.[1]
      if (!statusTag) return // malformed: nothing to store
      const current = statuses.value[authorKey]

      // Mutable state: newer wins; equal timestamps tie-break on event id
      // so every client converges on the same winner.
      if (!current || evt.created_at > current.createdAt || (evt.created_at === current.createdAt && (evt.id || '') < (current.eventId || ''))) {
        statuses.value[authorKey] = {
          dTag,
          contentId: media.contentId,
          status: statusTag,
          progress: progressTag || '',
          eventId: evt.id,
          createdAt: evt.created_at,
          pubkey: evt.pubkey,
          media,
        }
      }
    } else if (evt.kind === KINDS.RATING) {
      const ratingTag = evt.tags.find((t) => t[0] === 'rating')?.[1]
      const ratingNum = ratingTag !== undefined && ratingTag !== null && ratingTag !== '' ? Number(ratingTag) : null
      const spoilerTag = evt.tags.find((t) => t[0] === 'spoiler')?.[1]
      const current = ratings.value[authorKey]

      // Mutable state: newer wins; equal timestamps tie-break on event id.
      if (!current || evt.created_at > current.createdAt || (evt.created_at === current.createdAt && (evt.id || '') < (current.eventId || ''))) {
        ratings.value[authorKey] = {
          dTag,
          contentId: media.contentId,
          rating: Number.isFinite(ratingNum) ? ratingNum : null,
          content: evt.content || '',
          spoiler: spoilerTag === '1',
          eventId: evt.id,
          id: evt.id,
          isReview: options?.isReview || !!(evt.content && evt.content.trim()) || !!current?.isReview,
          createdAt: evt.created_at,
          pubkey: evt.pubkey,
          media,
        }
      }
    } else if (evt.kind === KINDS.SIMILAR_SUGGESTION) {
      const current = suggestions.value[authorKey]
      const similarItems = []

      for (const tag of evt.tags) {
        if (!Array.isArray(tag)) continue
        if (tag[0] === 'similar' && tag[1]) {
          const simCid = /^[0-9a-f]{64}$/i.test(tag[1]) ? tag[1].toLowerCase() : ''
          const simType = tag[2] || 'movie'
          const simName = (tag[3] || '').trim()
          const simYear = (tag[4] || '').trim()
          if (!simCid || !simName || !simYear) continue
          similarItems.push({
            contentId: simCid,
            type: simType,
            name: simName,
            title: simName,
            year: simYear,
          })
          nostrContentIds.value[simCid] = 1
          if (!mediaLibrary.value[simCid] && simName && simYear) {
            mediaLibrary.value[simCid] = {
              contentId: simCid,
              type: simType,
              name: simName,
              title: simName,
              year: simYear,
            }
          }
        }
      }

      // Mutable state (NIP-33): newer wins; equal timestamps tie-break on event id.
      if (!current || evt.created_at > current.createdAt || (evt.created_at === current.createdAt && (evt.id || '') < (current.eventId || ''))) {
        suggestions.value[authorKey] = {
          dTag,
          contentId: media.contentId,
          items: similarItems,
          note: evt.content || '',
          eventId: evt.id,
          id: evt.id,
          createdAt: evt.created_at,
          pubkey: evt.pubkey,
          media,
        }
      }
    }
  }

  /**
   * Ingests a batch with deletions applied last, so a notice arriving
   * ahead of its target in the same response still takes effect.
   */
  function ingestBatch(events) {
    if (!Array.isArray(events)) return
    for (const evt of events) {
      if (evt && evt.kind !== KINDS.DELETION) ingestEvent(evt)
    }
    for (const evt of events) {
      if (evt && evt.kind === KINDS.DELETION) ingestEvent(evt)
    }
  }

  /**
   * Applies an inbound NIP-09 (kind 5) deletion notice to local state.
   * Only the author's own notices are honored, mirroring relay rules:
   * a forged notice for somebody else's records is ignored.
   */
  function applyDeletionEvent(evt) {
    const deleter = String(evt.pubkey || '').toLowerCase()
    if (!deleter) return
    for (const tag of evt.tags) {
      if (!Array.isArray(tag)) continue
      if (tag[0] === 'a' && typeof tag[1] === 'string') {
        const parts = tag[1].split(':')
        if (parts.length < 3) continue
        const [kindStr, targetPubkey, ...dParts] = parts
        if (!targetPubkey || targetPubkey.toLowerCase() !== deleter) continue
        const kind = Number(kindStr)
        const dTag = dParts.join(':')
        if (!dTag) continue
        const base = dTag.split(':')[0]
        if (kind === KINDS.RATING) {
          delete ratings.value[`${targetPubkey}:${dTag}`]
        } else if (kind === KINDS.STATUS) {
          delete statuses.value[`${targetPubkey}:${dTag}`]
        } else if (kind === KINDS.SIMILAR_SUGGESTION) {
          delete suggestions.value[`${targetPubkey}:${dTag}`]
        }
        pruneProvenance(base)
      }
    }
    saveToIndexedDb()
  }

  /**
   * Fetches the viewer's NIP-02 follow list for metadata preference.
   */
  async function fetchFollows(pubkey) {
    const userPubkey = pubkey || authStore.pubkey
    if (!userPubkey) return {}
    try {
      const events = await nostrClient.queryEvents(
        {
          authors: [userPubkey],
          kinds: [KINDS.CONTACTS],
          limit: 1,
        },
        undefined,
        4000
      )
      if (!events.length) return { ...follows.value }
      events.sort((a, b) => (b.created_at || 0) - (a.created_at || 0))
      const latest = events[0]
      const next = {}
      ;(Array.isArray(latest.tags) ? latest.tags : [])
        .filter((t) => t[0] === 'p' && /^[0-9a-f]{64}$/i.test(t[1] || ''))
        .forEach((t) => {
          next[t[1].toLowerCase()] = 1
        })
      follows.value = next
      saveToIndexedDb()
      return next
    } catch (err) {
      console.warn('Failed to fetch follow list:', err)
      return { ...follows.value }
    }
  }

  /**
   * Syncs user's mutable state and logs from Nostr relays (Delta Sync)
   */
  async function syncUserData(pubkey) {
    const userPubkey = pubkey || authStore.pubkey
    if (!userPubkey) return

    isSyncing.value = true
    try {
      const filter = {
        authors: [userPubkey],
        kinds: [KINDS.RATING, KINDS.STATUS, KINDS.SIMILAR_SUGGESTION, KINDS.DELETION],
        limit: 500,
      }

      // Delta sync if we already synced recently
      if (lastSyncedAt.value > 0) {
        filter.since = lastSyncedAt.value - 60 // 1 min buffer
      }

      const events = await nostrClient.queryEvents(filter)
      ingestBatch(events)

      // Advance the cursor only to what was actually observed — never to
      // wall-clock now — so slow-relay events can't fall into a sync gap.
      const maxSeen = events.reduce((m, e) => Math.max(m, e.created_at || 0), 0)
      if (maxSeen > lastSyncedAt.value) {
        lastSyncedAt.value = maxSeen
      }
      try {
        await fetchFollows(userPubkey)
      } catch {}
      saveToIndexedDb()
    } catch (err) {
      console.error('Failed to sync user data from relays:', err)
    } finally {
      isSyncing.value = false
    }
  }

  /**
   * Queries public media events and metadata by contentId
   */
  async function fetchMediaDetails(contentId) {
    if (!contentId) return

    try {
      // Match both the NIP-33 d-tag (#d) and the base contentid tag
      // (#contentid): episode mutables carry suffixed d-tags, so a bare-#d
      // query alone would miss all episode activity for a show.
      const kinds = [KINDS.STATUS, KINDS.RATING, KINDS.SIMILAR_SUGGESTION]
      const events = await nostrClient.queryEvents([
        { '#d': [contentId], kinds, limit: 50 },
        { '#contentid': [contentId], kinds, limit: 50 },
        // Deletion notices carry e/a refs (not media tags), so they need
        // their own unfiltered query to be honored on this page.
        { kinds: [KINDS.DELETION], limit: 50 },
      ])

      ingestBatch(events)
      saveToIndexedDb()
    } catch (err) {
      console.warn('Failed to fetch media details from relays:', err)
    }
  }

  /**
   * Queries recent global or feed activity
   */
  async function fetchRecentFeed(limit = 25) {
    try {
      // Query activity and deletion notices separately so a burst of
      // NIP-09 deletions never consumes the shared limit and crowds out
      // the actual ratings/suggestions the feed is meant to render.
      const [events, deletions] = await Promise.all([
        nostrClient.queryEvents({
          kinds: [KINDS.RATING, KINDS.STATUS, KINDS.SIMILAR_SUGGESTION],
          limit,
        }),
        nostrClient.queryEvents({
          kinds: [KINDS.DELETION],
          limit: 100,
        }),
      ])

      ingestBatch([...events, ...deletions])
      saveToIndexedDb()
      // Deletion notices are applied, never rendered as feed items.
      return events.filter((evt) => evt && evt.kind !== KINDS.DELETION)
    } catch (err) {
      console.warn('Failed to fetch recent activity feed:', err)
      return []
    }
  }

  /**
   * Fetches and ranks popular & featured media directly from Nostr events
   * @param {Object} [options]
   * @param {number} [options.limit=24]
   * @param {'movie'|'show'|'music'|null} [options.type=null]
   * @returns {Promise<Array<Object>>}
   */
  async function fetchPopularMediaFromEvents({ limit = 24, type = null } = {}) {
    try {
      // Query media events and deletion notices separately so a burst of
      // NIP-09 deletions never consumes the shared limit and crowds out
      // the status/rating/review/suggestion events that rank popularity.
      const [events, deletions] = await Promise.all([
        nostrClient.queryEvents(
          [
            {
              kinds: [
                KINDS.STATUS,
                KINDS.RATING,
                KINDS.SIMILAR_SUGGESTION,
              ],
              limit: 80,
            },
          ],
          undefined,
          4500
        ),
        nostrClient.queryEvents(
          [{ kinds: [KINDS.DELETION], limit: 100 }],
          undefined,
          4500
        ),
      ])

      ingestBatch([...events, ...deletions])
      saveToIndexedDb()

      // Aggregate mentions: every relay event counts exactly once, grouped
      // by base contentId (episode suffixes fold into their show). Local
      // entries whose events weren't in this relay response add one mention
      // each — never double-counted.
      const mentionCounts = new Map()
      const latestTimes = new Map()
      const seenEventIds = new Set()

      const countMention = (cId, at) => {
        if (!cId) return
        const baseContentId = String(cId).split(':')[0]
        if (!/^[0-9a-f]{64}$/i.test(baseContentId)) return
        mentionCounts.set(baseContentId, (mentionCounts.get(baseContentId) || 0) + 1)
        if (!latestTimes.has(baseContentId) || at > latestTimes.get(baseContentId)) {
          latestTimes.set(baseContentId, at)
        }
      }

      events.forEach((evt) => {
        if (!evt || evt.kind === KINDS.DELETION || seenEventIds.has(evt.id)) return
        seenEventIds.add(evt.id)
        const getTag = (name) => (Array.isArray(evt.tags) ? evt.tags.find((t) => t[0] === name)?.[1] : undefined)
        countMention(getTag('contentid'), evt.created_at || 0)
      })

      // Fold in local-only state (including ratings, previously uncounted)
      const foldLocal = (eventId, cId, at) => {
        if (!eventId || seenEventIds.has(eventId)) return
        seenEventIds.add(eventId)
        countMention(cId, at || 0)
      }
      Object.values(statuses.value).forEach((s) => foldLocal(s.eventId, s.contentId, s.createdAt))
      Object.values(ratings.value).forEach((r) => foldLocal(r.eventId, r.contentId, r.createdAt))
      reviews.value.forEach((r) => foldLocal(r.eventId || r.id, r.contentId, r.createdAt))
      Object.values(suggestions.value).forEach((sg) => foldLocal(sg.eventId || sg.id, sg.contentId, sg.createdAt))

      // Get all known media items from state
      const allKnown = getKnownMediaFromEvents(type)

      // Attach mentionCount and sort by popularity (then by latest time)
      const ranked = allKnown.map((item) => {
        const count = mentionCounts.get(item.contentId) || 0
        const latestTime = latestTimes.get(item.contentId) || 0
        return {
          ...item,
          nostrEventCount: count,
          latestActivityAt: latestTime,
        }
      })

      ranked.sort((a, b) => {
        if (b.nostrEventCount !== a.nostrEventCount) {
          return b.nostrEventCount - a.nostrEventCount
        }
        return (b.latestActivityAt || 0) - (a.latestActivityAt || 0)
      })

      // Nostr events only: never pad with hardcoded samples or provider
      // search results. A quiet relay yields a short (possibly empty) grid
      // and the UI already renders an empty state for that case.
      return ranked.slice(0, limit)
    } catch (err) {
      console.warn('Failed to fetch popular media from Nostr events:', err)
      return getKnownMediaFromEvents(type).slice(0, limit)
    }
  }

  /**
   * Publishes a signed event and throws unless at least one relay accepted
   * it. Callers ingest into local state only after this resolves, so the UI
   * never presents a failed broadcast as saved.
   */
  async function publishOrThrow(signedEvent) {
    const { publishedTo } = await nostrClient.publish(signedEvent)
    if (!publishedTo.length) {
      throw new Error('Publish failed on every configured relay — check your relay list in Settings and retry.')
    }
    return publishedTo
  }

  /**
   * Sets media watch/listening status (Kind 35402)
   */
  async function setStatus(media, status, progress = '', note = '') {
    if (!authStore.isAuthenticated) {
      throw new Error('Please connect your Nostr extension to track media.')
    }

    // Build Kind 35402 (Mutable State)
    const statusTemplate = buildStatusEvent(media, status, progress, note)
    const signedStatus = await nostrClient.signEvent(statusTemplate)
    await publishOrThrow(signedStatus)
    ingestEvent(signedStatus)

    saveToIndexedDb()
    return signedStatus
  }

  /**
   * Adds or updates a similar item suggestion (Kind 35401, NIP-33 Parameterized Replaceable)
   */
  async function addSimilarSuggestion(sourceMedia, similarMedia, note = '') {
    if (!authStore.isAuthenticated) {
      throw new Error('Please connect your Nostr extension to suggest similar titles.')
    }
    const dTag = assertContentId(sourceMedia?.contentId)
    const authorKey = `${authStore.pubkey || 'unknown'}:${dTag}`
    const existing = suggestions.value[authorKey]

    // Combine with existing items if author already suggested items for this title
    const existingItems = Array.isArray(existing?.items) ? [...existing.items] : []
    const newItems = Array.isArray(similarMedia) ? similarMedia : (similarMedia ? [similarMedia] : [])

    const combinedMap = new Map()
    existingItems.forEach((it) => {
      if (it?.contentId) combinedMap.set(it.contentId, it)
    })
    newItems.forEach((it) => {
      if (it?.contentId) combinedMap.set(it.contentId, it)
    })
    const allItems = Array.from(combinedMap.values())

    const suggestionTemplate = buildSimilarSuggestionEvent(sourceMedia, allItems, { note })
    const signed = await nostrClient.signEvent(suggestionTemplate)
    await publishOrThrow(signed)
    ingestEvent(signed)

    saveToIndexedDb()
    return signed
  }

  /**
   * Sets media rating and optional review note (Kind 35400)
   */
  async function setRating(media, rating, note = '', options = {}) {
    if (!authStore.isAuthenticated) {
      throw new Error('Please connect your Nostr extension to rate.')
    }

    const dTag = buildDTag({ contentId: media.contentId, season: media.season, episode: media.episode })
    const authorKey = `${authStore.pubkey || 'unknown'}:${dTag}`
    const existing = ratings.value[authorKey]

    // If note is not passed, preserve existing review text
    const reviewContent = note !== undefined && note !== '' ? note : (existing?.content || '')
    const spoiler = options.spoiler !== undefined ? options.spoiler : (existing?.spoiler || false)

    const ratingTemplate = buildRatingEvent(media, rating, reviewContent, { spoiler })
    const signedRating = await nostrClient.signEvent(ratingTemplate)
    await publishOrThrow(signedRating)
    ingestEvent(signedRating)

    saveToIndexedDb()
    return signedRating
  }

  /**
   * Adds or updates a written review and rating (Kind 35400)
   */
  async function addReview(media, body, options = {}) {
    if (!authStore.isAuthenticated) {
      throw new Error('Please connect your Nostr extension to review.')
    }

    const dTag = buildDTag({ contentId: media.contentId, season: media.season, episode: media.episode })
    const authorKey = `${authStore.pubkey || 'unknown'}:${dTag}`
    const existing = ratings.value[authorKey]

    const rating = options.rating !== undefined && options.rating !== null && options.rating !== ''
      ? options.rating
      : (existing?.rating ?? null)

    const spoiler = options.spoiler !== undefined ? options.spoiler : (existing?.spoiler || false)

    const reviewTemplate = buildRatingEvent(media, rating, body, { spoiler })
    const signedReview = await nostrClient.signEvent(reviewTemplate)
    await publishOrThrow(signedReview)
    ingestEvent(signedReview, { isReview: true })

    saveToIndexedDb()
    return signedReview
  }

  /**
   * Deletes a mutable or immutable event via NIP-09. Local state is echoed
   * kind-aware: NIP-33 identity is (kind, pubkey, d-tag), so a status delete
   * never wipes the rating sharing its d-tag (and vice versa).
   */
  async function deleteTrackstrEvent({ coordinate, reason }) {
    if (!authStore.isAuthenticated) {
      throw new Error('Please connect your Nostr extension.')
    }
    if (!coordinate) {
      throw new Error('Deletion coordinate is required.')
    }

    const deleteTemplate = buildDeletionEvent({ coordinate, reason })
    const signed = await nostrClient.signEvent(deleteTemplate)
    await publishOrThrow(signed)

    // Remove from local state
    const ownPubkey = authStore.pubkey || ''
    // Coordinate shape "<kind>:<pubkey>:<d-tag>"; d-tag may itself
    // contain colons (episode ":sNeM" suffix), so rejoin the tail.
    const [kindStr, , ...dParts] = String(coordinate).split(':')
    const kind = Number(kindStr)
    const dTag = dParts.join(':')
    const base = dTag.split(':')[0]
    if (kind === KINDS.RATING) {
      delete ratings.value[`${ownPubkey}:${dTag}`]
    } else if (kind === KINDS.STATUS) {
      delete statuses.value[`${ownPubkey}:${dTag}`]
    } else if (kind === KINDS.SIMILAR_SUGGESTION) {
      delete suggestions.value[`${ownPubkey}:${dTag}`]
    }
    pruneProvenance(base)

    saveToIndexedDb()
    return signed
  }

  /**
   * Drops a base contentId from the Nostr-provenance set once no local
   * event-derived state references it anymore.
   */
  function pruneProvenance(baseContentId) {
    if (!baseContentId) return
    const stillReferenced =
      Object.values(statuses.value).some((s) => (s.contentId || '').split(':')[0] === baseContentId) ||
      Object.values(ratings.value).some((r) => (r.contentId || '').split(':')[0] === baseContentId) ||
      reviews.value.some((r) => (r.contentId || '').split(':')[0] === baseContentId) ||
      Object.values(suggestions.value).some((sg) => (sg.contentId || '').split(':')[0] === baseContentId || (sg.items || []).some(it => (it.contentId || '').split(':')[0] === baseContentId))
    if (!stillReferenced) {
      delete nostrContentIds.value[baseContentId]
    }
  }

  // Computed helper getters (mutable state is per-author; they default to
  // the viewer's own entries so strangers' activity never leaks into "yours")
  function mediaStateKey(contentId, season, episode, pubkey) {
    const dTag = buildDTag({ contentId, season, episode })
    return `${pubkey || authStore.pubkey || 'unknown'}:${dTag}`
  }

  function getMediaStatus(contentId, season, episode, pubkey) {
    return statuses.value[mediaStateKey(contentId, season, episode, pubkey)] || null
  }

  function getMediaRating(contentId, season, episode, pubkey) {
    return ratings.value[mediaStateKey(contentId, season, episode, pubkey)]?.rating ?? null
  }

  function getMediaReview(contentId, season, episode, pubkey) {
    const r = ratings.value[mediaStateKey(contentId, season, episode, pubkey)]
    if (!r) return null
    return {
      rating: r.rating,
      content: r.content || '',
      spoiler: !!r.spoiler,
      eventId: r.eventId,
      createdAt: r.createdAt,
    }
  }

  function getMediaMetadata(_contentId) {
    return null
  }

  function getReviewsForMedia(contentId) {
    if (!contentId) return []
    const base = String(contentId).split(':')[0].toLowerCase()
    return reviews.value.filter((r) => String(r?.contentId || '').split(':')[0].toLowerCase() === base)
  }

  function getSimilarSuggestionsForMedia(contentId) {
    if (!contentId) return []
    const base = String(contentId).split(':')[0].toLowerCase()

    // Aggregate all suggestions matching this source media
    const aggregated = new Map()

    Object.values(suggestions.value).forEach((entry) => {
      if (!entry || !Array.isArray(entry.items)) return
      const entryBase = String(entry.contentId || entry.dTag || '').split(':')[0].toLowerCase()
      if (entryBase !== base) return

      entry.items.forEach((item) => {
        if (!item?.contentId) return
        const targetCid = item.contentId
        if (targetCid.toLowerCase() === base) return // Don't suggest self

        const existing = aggregated.get(targetCid) || {
          contentId: targetCid,
          type: item.type || 'movie',
          name: item.name || item.title || '',
          title: item.name || item.title || '',
          year: item.year || '',
          voteCount: 0,
          recommenders: [],
          notes: [],
          latestCreatedAt: 0,
        }

        if (!existing.recommenders.includes(entry.pubkey)) {
          existing.recommenders.push(entry.pubkey)
          existing.voteCount += 1
        }

        if (entry.note && !existing.notes.includes(entry.note)) {
          existing.notes.push(entry.note)
        }

        if ((entry.createdAt || 0) > existing.latestCreatedAt) {
          existing.latestCreatedAt = entry.createdAt || 0
        }

        aggregated.set(targetCid, existing)
      })
    })

    return Array.from(aggregated.values()).sort((a, b) => {
      if (b.voteCount !== a.voteCount) return b.voteCount - a.voteCount
      return (b.latestCreatedAt || 0) - (a.latestCreatedAt || 0)
    })
  }

  function getActivityForMedia(_contentId) {
    return []
  }

  /**
   * Community average score for a media item, computed from Kind 35400 Nostr signals:
   * Mutable current scores (one per author/d-tag, latest wins).
   * Episode-anchored records fold into their parent show via base contentId.
   * Math per AGENTS.md: sum(ratings) / count(ratings) on the 1–10 scale.
   * @param {string} contentId
   * @returns {{ average: number, count: number, ratingsCount: number, reviewsCount: number } | null}
   */
  function getAverageRatingForMedia(contentId) {
    if (!contentId) return null
    const base = String(contentId).split(':')[0].toLowerCase()
    if (!/^[0-9a-f]{64}$/.test(base)) return null
    const scores = []
    let ratingsCount = 0
    let reviewsCount = 0

    for (const entry of Object.values(ratings.value)) {
      const entryBase = String(entry?.contentId || entry?.dTag || '').split(':')[0].toLowerCase()
      if (entryBase !== base) continue
      const n = Number(entry?.rating)
      if (Number.isFinite(n) && n >= 1 && n <= 10) {
        scores.push(n)
        ratingsCount += 1
      }
      if (entry?.content && typeof entry.content === 'string' && entry.content.trim()) {
        reviewsCount += 1
      }
    }

    if (scores.length === 0) return null
    const sum = scores.reduce((a, b) => a + b, 0)
    return {
      average: Math.round((sum / scores.length) * 10) / 10,
      count: scores.length,
      ratingsCount,
      reviewsCount,
    }
  }

  /**
   * Discovers all known seasons & episodes for a media item from local state & Nostr events.
   * Includes Season 0 (Specials) and user-added episodes.
   * Enables decentralized crowd-sourced episode map without needing external catalog APIs.
   * @param {string} contentId
   * @returns {Array<{ season: number, episode: number, name: string, source: string }>}
   */
  function getDiscoveredEpisodesForMedia(contentId) {
    if (!contentId) return []
    const episodesMap = new Map() // key: `s${season}e${episode}` -> { season, episode, name }

    function addEp(seasonVal, epVal, nameVal, src = 'nostr') {
      if (seasonVal === undefined || seasonVal === null || epVal === undefined || epVal === null) return
      const s = Number(seasonVal)
      const e = Number(epVal)
      if (!Number.isFinite(s) || !Number.isFinite(e) || s < 0 || e < 1) return

      const key = `s${s}e${e}`
      const existing = episodesMap.get(key)
      const rawName = nameVal ? String(nameVal).trim() : ''

      let cleanEpTitle = rawName
      const epTitleMatch = rawName.match(/S\d+E\d+:\s*(.*)$/i)
      if (epTitleMatch && epTitleMatch[1]) {
        cleanEpTitle = epTitleMatch[1].trim()
      } else if (rawName.includes(' - ')) {
        const parts = rawName.split(' - ')
        cleanEpTitle = parts[parts.length - 1].trim()
      }

      const defaultName = s === 0 ? `Special ${e}` : `Episode ${e}`

      if (!existing) {
        episodesMap.set(key, {
          season: s,
          episode: e,
          name: cleanEpTitle || defaultName,
          source: src,
        })
      } else if (cleanEpTitle && (existing.name.startsWith('Episode ') || existing.name.startsWith('Special '))) {
        existing.name = cleanEpTitle
      }
    }

    function checkItem(item) {
      if (!item) return
      const baseId = (item.contentId || item.dTag?.split(':')[0] || '').toLowerCase()
      if (baseId !== contentId.toLowerCase()) return

      // 1. From media object
      if (item.media?.season !== undefined && item.media?.episode !== undefined) {
        addEp(item.media.season, item.media.episode, item.media.name || item.media.title)
      }

      // 2. From dTag `:s(\d+)e(\d+)`
      if (item.dTag) {
        const match = item.dTag.match(/:s(\d+)e(\d+)/i)
        if (match) {
          addEp(match[1], match[2], item.media?.name || item.media?.title)
        }
      }

      // 3. From progress `s(\d+)e(\d+)`
      if (item.progress) {
        const match = item.progress.match(/s(\d+)e(\d+)/i)
        if (match) {
          addEp(match[1], match[2], item.media?.name || item.media?.title)
        }
      }

      // 4. From tags if event object
      if (Array.isArray(item.tags)) {
        const sTag = item.tags.find((t) => t[0] === 'season')?.[1]
        const eTag = item.tags.find((t) => t[0] === 'episode')?.[1]
        const nTag = item.tags.find((t) => t[0] === 'name')?.[1]
        if (sTag !== undefined && eTag !== undefined) {
          addEp(sTag, eTag, nTag)
        }
      }
    }

    Object.values(statuses.value).forEach(checkItem)
    Object.values(ratings.value).forEach(checkItem)
    reviews.value.forEach(checkItem)
    Object.values(suggestions.value).forEach(checkItem)

    // Also check localStorage for any user-added custom episodes for this show
    try {
      const storedCustom = localStorage.getItem(`trackstr_custom_episodes_${contentId}`)
      if (storedCustom) {
        const customList = JSON.parse(storedCustom)
        if (Array.isArray(customList)) {
          customList.forEach((c) => addEp(c.season, c.episode, c.name, 'user'))
        }
      }
    } catch {}

    return Array.from(episodesMap.values()).sort((a, b) => {
      if (a.season !== b.season) return a.season - b.season
      return a.episode - b.episode
    })
  }

  function cacheMediaItem(item) {
    if (item && item.contentId) {
      const title = (item.title || item.name || '').trim()
      const year = String(item.year || '').trim()
      if (!title || !year) return
      if (item.type === 'music' && !(item.artist || '').trim()) return

      // Never let empty provider fields clobber previously cached values.
      const clean = {}
      for (const [k, v] of Object.entries(item)) {
        if (v !== undefined && v !== '' && v !== null) clean[k] = v
      }
      mediaLibrary.value[item.contentId] = {
        ...mediaLibrary.value[item.contentId],
        ...clean,
      }
      saveToIndexedDb()
    }
  }

  /**
   * Retrieves all unique media items indexed across Nostr events in our store.
   * Nostr-only: mediaLibrary entries cached from provider searches
   * (TMDB/MusicBrainz) without event provenance are excluded.
   */
  function getKnownMediaFromEvents(type = null) {
    const items = new Map()
    // Episode-anchored records aggregate under their parent show.
    const typeMatches = (mType) => !type || mType === type || (type === 'show' && mType === 'episode')

    // 1. From mediaLibrary cache (Nostr-sourced entries only)
    Object.values(mediaLibrary.value).forEach((m) => {
      if (m && m.contentId && nostrContentIds.value[m.contentId]) {
        if (typeMatches(m.type)) {
          items.set(m.contentId, { ...m })
        }
      }
    })

    // 2. From statuses (kind 35402, all authors — global activity)
    Object.values(statuses.value).forEach((s) => {
      if (s.media && s.contentId) {
        if (typeMatches(s.media.type)) {
          const existing = items.get(s.contentId) || {}
          items.set(s.contentId, {
            ...existing,
            ...s.media,
            contentId: s.contentId,
          })
        }
      }
    })

    // 3. From reviews (kind 35400)
    reviews.value.forEach((r) => {
      if (r.media && r.contentId) {
        if (typeMatches(r.media.type)) {
          const existing = items.get(r.contentId) || {}
          items.set(r.contentId, { ...existing, ...r.media, contentId: r.contentId })
        }
      }
    })

    // 4. From similar suggestions (kind 35401)
    Object.values(suggestions.value).forEach((sg) => {
      if (sg.media && sg.contentId && typeMatches(sg.media.type)) {
        const existing = items.get(sg.contentId) || {}
        items.set(sg.contentId, { ...existing, ...sg.media, contentId: sg.contentId })
      }
      if (Array.isArray(sg.items)) {
        sg.items.forEach((it) => {
          if (it && it.contentId && typeMatches(it.type)) {
            const existing = items.get(it.contentId) || {}
            items.set(it.contentId, { ...existing, ...it, contentId: it.contentId })
          }
        })
      }
    })

    // Annotate the viewer's OWN status only — never a stranger's.
    if (authStore.pubkey) {
      Object.values(statuses.value).forEach((s) => {
        if (s.pubkey === authStore.pubkey && items.has(s.contentId)) {
          items.get(s.contentId).userStatus = s.status
        }
      })
    }

    return Array.from(items.values()).filter((item) => {
      const hasTitle = Boolean((item.title || item.name)?.trim())
      const hasYear = Boolean(String(item.year || '').trim())
      const hasArtist = item.type !== 'music' || Boolean(item.artist?.trim())
      return hasTitle && hasYear && hasArtist
    })
  }

  /**
   * Searches known Nostr events for title/artist autocomplete
   */
  function searchEventAutocomplete(type, query = '') {
    const all = getKnownMediaFromEvents(type)
    const q = query.trim().toLowerCase()
    if (!q) return all.slice(0, 10)
    return all
      .filter((item) => {
        const title = (item.title || item.name || '').toLowerCase()
        const artist = (item.artist || '').toLowerCase()
        return title.includes(q) || artist.includes(q)
      })
      .slice(0, 10)
  }

  /**
   * Directly ingests imported media items into local state for instant rendering.
   * Enables zero-latency display on /library without waiting for Nostr relay sync.
   * @param {Array<Object>} items Consolidated media items
   * @param {string} [pubkey] User pubkey to anchor statuses and ratings
   */
  function importLocalMedia(items, pubkey) {
    const author = pubkey || authStore.pubkey || 'local'
    const now = Math.floor(Date.now() / 1000)

    for (const item of items) {
      if (!item?.contentId) continue
      const rawName = (item.name || item.title || '').trim()
      const year = String(item.year || '').trim()
      if (!rawName || !year) continue
      if (item.type === 'music' && !(item.artist || '').trim()) continue

      const contentId = item.contentId
      const isEp = item.type === 'episode' || /S\d+E\d+/i.test(rawName)
      const mediaType = isEp ? 'show' : (item.type || 'movie')
      const cleanName = mediaType === 'show' ? cleanShowTitle(rawName) : rawName
      const mediaRef = {
        contentId,
        type: mediaType,
        name: cleanName,
        title: cleanName,
        year,
      }

      mediaLibrary.value[contentId] = mediaRef
      nostrContentIds.value[contentId] = 1

      const authorKey = `${author}:${contentId}`
      const createdAt = item.watchedDate
        ? Math.floor(new Date(item.watchedDate).getTime() / 1000) || now
        : now

      if (item.status) {
        statuses.value[authorKey] = {
          dTag: contentId,
          contentId,
          status: item.status,
          progress: '',
          eventId: `import_status_${contentId}`,
          createdAt,
          pubkey: author,
          media: mediaRef,
        }
      }

      const hasRating = item.rating !== null && item.rating !== undefined
      const hasReview = item.review && item.review.trim()

      if (hasRating || hasReview) {
        ratings.value[authorKey] = {
          dTag: contentId,
          contentId,
          rating: hasRating ? item.rating : null,
          content: hasReview ? item.review.trim() : '',
          spoiler: !!item.spoiler,
          eventId: `import_rating_${contentId}`,
          createdAt,
          pubkey: author,
          media: mediaRef,
        }
      }
    }

    saveToIndexedDb()
  }

  const trackedItemsList = computed(() => {
    // The library is the viewer's own tracking — never strangers' events.
    if (!authStore.pubkey) return []
    const userStatuses = Object.values(statuses.value).filter((s) => s.pubkey === authStore.pubkey)

    // Group items by base contentId so multiple episodes don't clutter the library as separate rows
    const groups = new Map()

    for (const item of userStatuses) {
      const baseContentId = (item.contentId || item.dTag?.split(':')[0] || '').toLowerCase()
      if (!baseContentId) continue

      if (!groups.has(baseContentId)) {
        groups.set(baseContentId, [])
      }
      groups.get(baseContentId).push(item)
    }

    const result = []

    for (const [baseId, items] of groups.entries()) {
      // Find explicit show-level status (dTag === baseId or not containing ':s')
      const showItem = items.find((i) => i.dTag === baseId || (!i.media?.season && i.media?.type !== 'episode' && !i.dTag?.includes(':s')))
      const episodeItems = items.filter((i) => i !== showItem && (i.media?.type === 'episode' || i.dTag?.includes(':s') || i.media?.season !== undefined))

      const libMedia = mediaLibrary.value[baseId]

      if (showItem) {
        if (episodeItems.length > 0) {
          const epCount = episodeItems.filter((e) => e.status === 'completed').length
          const episodeDTags = episodeItems.map((e) => e.dTag)
          const progressText = showItem.progress || (epCount > 0 ? `${epCount} ep${epCount === 1 ? '' : 's'} watched` : '')

          const showTitle = cleanShowTitle(showItem.media?.name || showItem.media?.title || libMedia?.name || libMedia?.title || '')
          const showMedia = {
            ...(showItem.media || {}),
            ...(libMedia || {}),
            type: showItem.media?.type === 'episode' ? 'show' : (showItem.media?.type || libMedia?.type || 'show'),
            name: showTitle,
            title: showTitle,
            season: undefined,
            episode: undefined,
          }

          result.push({
            ...showItem,
            media: showMedia,
            progress: progressText,
            episodeDTags,
            episodeCount: epCount,
          })
        } else {
          const showMedia = showItem.media ? {
            ...showItem.media,
            ...(libMedia || {}),
            name: showItem.media.type === 'show' ? cleanShowTitle(showItem.media.name || libMedia?.name || '') : (showItem.media.name || libMedia?.name || ''),
            title: showItem.media.type === 'show' ? cleanShowTitle(showItem.media.title || libMedia?.title || '') : (showItem.media.title || libMedia?.title || ''),
          } : libMedia

          result.push({
            ...showItem,
            media: showMedia || showItem.media,
          })
        }
      } else if (episodeItems.length > 0) {
        // Only episode statuses exist for this show; fold into a consolidated show row
        const epCount = episodeItems.filter((e) => e.status === 'completed').length
        const newest = episodeItems.reduce((a, b) => ((b.createdAt || 0) > (a.createdAt || 0) ? b : a), episodeItems[0])
        const rawMedia = newest.media || libMedia || {}
        const showTitle = cleanShowTitle(rawMedia.name || rawMedia.title || libMedia?.name || libMedia?.title || 'TV Series')

        const showMedia = {
          ...rawMedia,
          ...(libMedia || {}),
          type: 'show',
          name: showTitle,
          title: showTitle,
          season: undefined,
          episode: undefined,
        }

        result.push({
          dTag: baseId,
          contentId: baseId,
          status: 'watching',
          progress: epCount > 0 ? `${epCount} ep${epCount === 1 ? '' : 's'} watched` : '',
          eventId: newest.eventId,
          createdAt: newest.createdAt,
          pubkey: authStore.pubkey,
          media: showMedia,
          episodeDTags: episodeItems.map((e) => e.dTag),
          episodeCount: epCount,
        })
      }
    }

    return result.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0))
  })

  return {
    statuses,
    ratings,
    reviews,
    suggestions,
    activityLogs: computed(() => []),
    mediaLibrary,
    follows,
    isSyncing,
    syncUserData,
    fetchFollows,
    fetchMediaDetails,
    fetchRecentFeed,
    fetchPopularMediaFromEvents,
    setStatus,
    setRating,
    addReview,
    addSimilarSuggestion,
    deleteTrackstrEvent,
    getMediaStatus,
    getMediaRating,
    getMediaReview,
    getMediaMetadata,
    getReviewsForMedia,
    getSimilarSuggestionsForMedia,
    getActivityForMedia,
    getAverageRatingForMedia,
    getDiscoveredEpisodesForMedia,
    cacheMediaItem,
    getKnownMediaFromEvents,
    searchEventAutocomplete,
    importLocalMedia,
    trackedItemsList,
    isCacheLoaded,
    cacheInitPromise,
    initCache,
    saveToIndexedDb,
    flushSaveToIndexedDb,
    clearCache,
  }
})
