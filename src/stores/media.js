import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import { nostrClient } from '@/services/nostr/client.js'
import {
  KINDS,
  buildRatingEvent,
  buildStatusEvent,
  buildMediaMetadataEvent,
  buildReviewEvent,
  buildActivityLogEvent,
  buildDeletionEvent,
} from '@/services/nostr/events.js'
import { buildDTag } from '@/utils/contentId.js'
import { useAuthStore } from './auth.js'

const LOCAL_STORAGE_KEY = 'trackstr_media_cache'

export const useMediaStore = defineStore('media', () => {
  const authStore = useAuthStore()

  // State
  const statuses = ref({}) // key: dTag -> { status, progress, eventId, createdAt, media }
  const ratings = ref({}) // key: dTag -> { rating, eventId, createdAt, media }
  const reviews = ref([]) // Array of kind 5401 events
  const activityLogs = ref([]) // Array of kind 5402 events
  const communityMetadata = ref({}) // key: contentId -> { poster, banner, genres, overview, lang, author, createdAt }
  const mediaLibrary = ref({}) // key: contentId -> base media object
  const follows = ref({}) // key: pubkey -> 1 (viewer's NIP-02 follow list, for metadata preference)
  // Nostr-event provenance: contentIds observed in ingested Nostr events.
  // mediaLibrary also caches provider search results (TMDB/MusicBrainz), so
  // Nostr-only surfaces must filter by this set. key: contentId -> 1
  const nostrContentIds = ref({})

  const isSyncing = ref(false)
  const lastSyncedAt = ref(0)

  // Load from local storage for local-first instant rendering
  loadFromLocalStorage()

  function loadFromLocalStorage() {
    try {
      const raw = localStorage.getItem(LOCAL_STORAGE_KEY)
      if (raw) {
        const data = JSON.parse(raw)
        statuses.value = data.statuses || {}
        ratings.value = data.ratings || {}
        reviews.value = data.reviews || []
        activityLogs.value = data.activityLogs || []
        communityMetadata.value = data.communityMetadata || {}
        mediaLibrary.value = data.mediaLibrary || {}
        follows.value = data.follows || {}
        lastSyncedAt.value = data.lastSyncedAt || 0
        nostrContentIds.value = data.nostrContentIds || {}
        // Heal provenance for caches written before provenance tracking:
        // anything referenced by persisted event-derived state is Nostr-sourced.
        Object.values(statuses.value).forEach((s) => {
          if (s?.contentId) nostrContentIds.value[s.contentId] = 1
        })
        Object.values(ratings.value).forEach((r) => {
          if (r?.contentId) nostrContentIds.value[r.contentId] = 1
        })
        reviews.value.forEach((r) => {
          if (r?.contentId) nostrContentIds.value[r.contentId] = 1
        })
        activityLogs.value.forEach((a) => {
          if (a?.contentId) nostrContentIds.value[a.contentId] = 1
        })
        Object.keys(communityMetadata.value).forEach((cId) => {
          nostrContentIds.value[cId] = 1
        })
      }
    } catch (err) {
      console.warn('Failed to load media cache from localStorage:', err)
    }
  }

  function saveToLocalStorage() {
    try {
      const data = {
        statuses: statuses.value,
        ratings: ratings.value,
        reviews: reviews.value.slice(0, 500),
        activityLogs: activityLogs.value.slice(0, 500),
        communityMetadata: communityMetadata.value,
        mediaLibrary: mediaLibrary.value,
        follows: follows.value,
        lastSyncedAt: lastSyncedAt.value,
        nostrContentIds: nostrContentIds.value,
      }
      localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify(data))
    } catch (err) {
      console.warn('Failed to save media cache to localStorage:', err)
    }
  }

  /**
   * Parses media attributes from event tags. Never defaults the type and
   * never mistakes an episode-suffixed d-tag for a contentid.
   */
  function parseMediaTags(tags) {
    const safeTags = Array.isArray(tags) ? tags : []
    const getTag = (name) => safeTags.find((t) => t[0] === name)?.[1]
    const rawCid = getTag('contentid') || ''
    const dRaw = getTag('d') || ''
    const base = (/^[0-9a-f]{64}$/i.test(rawCid) ? rawCid : dRaw.split(':')[0]) || ''
    const contentId = /^[0-9a-f]{64}$/i.test(base) ? base.toLowerCase() : ''
    const type = getTag('type') || ''
    const name = getTag('name') || getTag('title') || ''
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
   * Web-of-Trust preference tier for community metadata: own > followed > other.
   */
  function authorTier(pubkey) {
    if (pubkey && authStore.pubkey && pubkey === authStore.pubkey) return 3
    if (pubkey && follows.value[pubkey]) return 2
    return 1
  }

  /**
   * Ingests a raw Nostr event into our state
   */
  function ingestEvent(evt) {
    if (!evt || !Array.isArray(evt.tags)) return
    // Inbound NIP-09 deletion notices are applied, never stored.
    if (evt.kind === KINDS.DELETION) {
      applyDeletionEvent(evt)
      return
    }
    const media = parseMediaTags(evt.tags)
    // Drop malformed events instead of polluting state with undefined fields.
    if (!media.contentId) return
    const dTag = evt.tags.find((t) => t[0] === 'd')?.[1] || media.contentId
    // Mutable state is scoped per (author, d-tag): strangers' events never
    // overwrite the viewer's own status/rating.
    const authorKey = `${evt.pubkey || 'unknown'}:${dTag}`

    if (media.contentId && !mediaLibrary.value[media.contentId]) {
      mediaLibrary.value[media.contentId] = media
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
      const current = ratings.value[authorKey]

      // Mutable state: newer wins; equal timestamps tie-break on event id.
      if (!current || evt.created_at > current.createdAt || (evt.created_at === current.createdAt && (evt.id || '') < (current.eventId || ''))) {
        ratings.value[authorKey] = {
          dTag,
          contentId: media.contentId,
          rating: Number.isFinite(ratingNum) ? ratingNum : null,
          eventId: evt.id,
          createdAt: evt.created_at,
          pubkey: evt.pubkey,
          media,
        }
      }
    } else if (evt.kind === KINDS.MEDIA_METADATA) {
      const posterTag = evt.tags.find((t) => t[0] === 'poster')?.[1]
      const bannerTag = evt.tags.find((t) => t[0] === 'banner')?.[1]
      const genres = evt.tags.filter((t) => t[0] === 'genre').map((t) => t[1])
      const langTag = evt.tags.find((t) => t[0] === 'lang')?.[1] || 'en'
      const current = communityMetadata.value[media.contentId]
      const tier = authorTier(evt.pubkey)
      const currentTier = current ? authorTier(current.author) : -1
      const sameTierNewer =
        current &&
        tier === currentTier &&
        (evt.created_at > current.createdAt ||
          (evt.created_at === current.createdAt && (evt.id || '') < (current.eventId || '')))

      // Web-of-Trust preference (own > followed > other); within a tier the
      // newest wins. Sparse newer events merge over — never wipe — richer ones.
      if (!current || tier > currentTier || sameTierNewer) {
        communityMetadata.value[media.contentId] = {
          contentId: media.contentId,
          poster: posterTag || current?.poster || '',
          banner: bannerTag || current?.banner || '',
          genres: genres.length ? genres : current?.genres || [],
          overview: evt.content || current?.overview || '',
          lang: langTag,
          author: evt.pubkey,
          createdAt: evt.created_at,
          eventId: evt.id,
        }
      }
    } else if (evt.kind === KINDS.REVIEW) {
      // Immutable log: append if not already present
      if (!reviews.value.some((r) => r.id === evt.id)) {
        const ratingTag = evt.tags.find((t) => t[0] === 'rating')?.[1]
        const spoilerTag = evt.tags.find((t) => t[0] === 'spoiler')?.[1]

        reviews.value.unshift({
          id: evt.id,
          eventId: evt.id,
          contentId: media.contentId,
          content: evt.content,
          rating: ratingTag !== undefined && ratingTag !== null && ratingTag !== '' && Number.isFinite(Number(ratingTag)) ? Number(ratingTag) : null,
          spoiler: spoilerTag === '1',
          createdAt: evt.created_at,
          pubkey: evt.pubkey,
          media,
        })
      }
    } else if (evt.kind === KINDS.ACTIVITY_LOG) {
      // Immutable scrobble: append if not already present
      if (!activityLogs.value.some((a) => a.id === evt.id)) {
        const statusTag = evt.tags.find((t) => t[0] === 'status')?.[1]
        const progressTag = evt.tags.find((t) => t[0] === 'progress')?.[1]

        activityLogs.value.unshift({
          id: evt.id,
          eventId: evt.id,
          contentId: media.contentId,
          status: statusTag,
          progress: progressTag || '',
          content: evt.content,
          createdAt: evt.created_at,
          pubkey: evt.pubkey,
          media,
        })
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
      if (tag[0] === 'e' && typeof tag[1] === 'string') {
        const targetId = tag[1]
        const review = reviews.value.find((r) => r.id === targetId)
        if (review && String(review.pubkey || '').toLowerCase() === deleter) {
          reviews.value = reviews.value.filter((r) => r.id !== targetId)
          pruneProvenance(review.contentId)
        }
        const log = activityLogs.value.find((a) => a.id === targetId)
        if (log && String(log.pubkey || '').toLowerCase() === deleter) {
          activityLogs.value = activityLogs.value.filter((a) => a.id !== targetId)
          pruneProvenance(log.contentId)
        }
        // Replaceable events deleted by id (non-standard but tolerated).
        for (const map of [statuses.value, ratings.value]) {
          for (const [key, entry] of Object.entries(map)) {
            if (entry?.eventId === targetId && String(entry.pubkey || '').toLowerCase() === deleter) {
              delete map[key]
              pruneProvenance((entry.contentId || '').split(':')[0])
            }
          }
        }
      } else if (tag[0] === 'a' && typeof tag[1] === 'string') {
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
        } else if (kind === KINDS.MEDIA_METADATA) {
          const current = communityMetadata.value[base]
          if (current && String(current.author || '').toLowerCase() === deleter) {
            delete communityMetadata.value[base]
          }
        }
        pruneProvenance(base)
      }
    }
    saveToLocalStorage()
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
      saveToLocalStorage()
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
        kinds: [KINDS.RATING, KINDS.STATUS, KINDS.MEDIA_METADATA, KINDS.REVIEW, KINDS.ACTIVITY_LOG, KINDS.DELETION],
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
      saveToLocalStorage()
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
      const kinds = [KINDS.MEDIA_METADATA, KINDS.REVIEW, KINDS.ACTIVITY_LOG, KINDS.STATUS, KINDS.RATING]
      const events = await nostrClient.queryEvents([
        { '#d': [contentId], kinds, limit: 50 },
        { '#contentid': [contentId], kinds, limit: 50 },
        // Deletion notices carry e/a refs (not media tags), so they need
        // their own unfiltered query to be honored on this page.
        { kinds: [KINDS.DELETION], limit: 50 },
      ])

      ingestBatch(events)
      saveToLocalStorage()
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
      // the actual reviews/check-ins the feed is meant to render.
      const [events, deletions] = await Promise.all([
        nostrClient.queryEvents({
          kinds: [KINDS.REVIEW, KINDS.ACTIVITY_LOG],
          limit,
        }),
        nostrClient.queryEvents({
          kinds: [KINDS.DELETION],
          limit: 100,
        }),
      ])

      ingestBatch([...events, ...deletions])
      saveToLocalStorage()
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
      // the status/rating/review/scrobble events that rank popularity.
      const [events, deletions] = await Promise.all([
        nostrClient.queryEvents(
          [
            {
              kinds: [
                KINDS.STATUS,
                KINDS.RATING,
                KINDS.REVIEW,
                KINDS.ACTIVITY_LOG,
                KINDS.MEDIA_METADATA,
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
      saveToLocalStorage()

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
        countMention(getTag('contentid') || getTag('d'), evt.created_at || 0)
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
      activityLogs.value.forEach((a) => foldLocal(a.eventId || a.id, a.contentId, a.createdAt))

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
   * Sets media watch/listening status (Kind 35402) and creates an immutable check-in log (Kind 5402)
   */
  async function setStatus(media, status, progress = '', note = '') {
    if (!authStore.isAuthenticated) {
      throw new Error('Please connect your Nostr extension to track media.')
    }

    // 1. Build Kind 35402 (Mutable State)
    const statusTemplate = buildStatusEvent(media, status, progress, note)
    const signedStatus = await nostrClient.signEvent(statusTemplate)
    await publishOrThrow(signedStatus)
    ingestEvent(signedStatus)

    // 2. Build Kind 5402 (Immutable Check-in Log) if it's an active status
    if (['watching', 'completed', 'listening'].includes(status)) {
      const logTemplate = buildActivityLogEvent(media, status, progress, note)
      const signedLog = await nostrClient.signEvent(logTemplate)
      await publishOrThrow(signedLog)
      ingestEvent(signedLog)
    }

    saveToLocalStorage()
    return signedStatus
  }

  /**
   * Sets media rating (Kind 35400)
   */
  async function setRating(media, rating, note = '') {
    if (!authStore.isAuthenticated) {
      throw new Error('Please connect your Nostr extension to rate.')
    }

    const ratingTemplate = buildRatingEvent(media, rating, note)
    const signedRating = await nostrClient.signEvent(ratingTemplate)
    await publishOrThrow(signedRating)
    ingestEvent(signedRating)

    saveToLocalStorage()
    return signedRating
  }

  /**
   * Adds a written review (Kind 5401)
   */
  async function addReview(media, body, options = {}) {
    if (!authStore.isAuthenticated) {
      throw new Error('Please connect your Nostr extension to review.')
    }

    const reviewTemplate = buildReviewEvent(media, body, options)
    const signedReview = await nostrClient.signEvent(reviewTemplate)
    await publishOrThrow(signedReview)
    ingestEvent(signedReview)

    saveToLocalStorage()
    return signedReview
  }

  /**
   * Seeds community metadata to Nostr (Kind 35403)
   */
  async function seedMetadata(media, metadata) {
    if (!authStore.isAuthenticated) {
      throw new Error('Please connect your Nostr extension to seed metadata.')
    }

    const metadataTemplate = buildMediaMetadataEvent(media, metadata)
    const signed = await nostrClient.signEvent(metadataTemplate)
    await publishOrThrow(signed)
    ingestEvent(signed)

    saveToLocalStorage()
    return signed
  }

  /**
   * Deletes a mutable or immutable event via NIP-09. Local state is echoed
   * kind-aware: NIP-33 identity is (kind, pubkey, d-tag), so a status delete
   * never wipes the rating sharing its d-tag (and vice versa).
   */
  async function deleteTrackstrEvent({ eventId, coordinate, reason }) {
    if (!authStore.isAuthenticated) {
      throw new Error('Please connect your Nostr extension.')
    }
    if ((eventId && coordinate) || (!eventId && !coordinate)) {
      throw new Error('Deletion requires exactly one of eventId or coordinate.')
    }

    const deleteTemplate = buildDeletionEvent({ eventId, coordinate, reason })
    const signed = await nostrClient.signEvent(deleteTemplate)
    await publishOrThrow(signed)

    // Remove from local state
    const ownPubkey = authStore.pubkey || ''
    if (coordinate) {
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
      } else if (kind === KINDS.MEDIA_METADATA) {
        delete communityMetadata.value[base]
      }
      pruneProvenance(base)
    }
    if (eventId) {
      const removedReview = reviews.value.find((r) => r.id === eventId)
      const removedLog = activityLogs.value.find((a) => a.id === eventId)
      reviews.value = reviews.value.filter((r) => r.id !== eventId)
      activityLogs.value = activityLogs.value.filter((a) => a.id !== eventId)
      if (removedReview?.contentId) pruneProvenance(removedReview.contentId)
      if (removedLog?.contentId) pruneProvenance(removedLog.contentId)
    }

    saveToLocalStorage()
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
      reviews.value.some((r) => r.contentId === baseContentId) ||
      activityLogs.value.some((a) => a.contentId === baseContentId) ||
      Boolean(communityMetadata.value[baseContentId])
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

  function getMediaMetadata(contentId) {
    return communityMetadata.value[contentId] || null
  }

  function getReviewsForMedia(contentId) {
    return reviews.value.filter((r) => r.contentId === contentId)
  }

  function getActivityForMedia(contentId) {
    return activityLogs.value.filter((a) => a.contentId === contentId)
  }

  function cacheMediaItem(item) {
    if (item && item.contentId) {
      // Never let empty provider fields clobber previously cached values.
      const clean = {}
      for (const [k, v] of Object.entries(item)) {
        if (v !== undefined && v !== '' && v !== null) clean[k] = v
      }
      mediaLibrary.value[item.contentId] = {
        ...mediaLibrary.value[item.contentId],
        ...clean,
      }
      saveToLocalStorage()
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

    // 3. From reviews (kind 5401)
    reviews.value.forEach((r) => {
      if (r.media && r.contentId) {
        if (typeMatches(r.media.type)) {
          const existing = items.get(r.contentId) || {}
          items.set(r.contentId, { ...existing, ...r.media, contentId: r.contentId })
        }
      }
    })

    // 4. From activity logs (kind 5402)
    activityLogs.value.forEach((a) => {
      if (a.media && a.contentId) {
        if (typeMatches(a.media.type)) {
          const existing = items.get(a.contentId) || {}
          items.set(a.contentId, { ...existing, ...a.media, contentId: a.contentId })
        }
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

    // 5. From community metadata (kind 35403): fill in whatever the
    // event-derived item is still missing (poster, banner, overview, genres).
    Object.entries(communityMetadata.value).forEach(([cId, meta]) => {
      if (items.has(cId)) {
        const existing = items.get(cId)
        items.set(cId, {
          ...existing,
          poster: existing.poster || meta.poster,
          banner: existing.banner || meta.banner,
          overview: existing.overview || meta.overview,
          genres: existing.genres && existing.genres.length ? existing.genres : meta.genres,
        })
      }
    })

    return Array.from(items.values())
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

  const trackedItemsList = computed(() => {
    // The library is the viewer's own tracking — never strangers' events.
    if (!authStore.pubkey) return []
    return Object.values(statuses.value).filter((s) => s.pubkey === authStore.pubkey)
  })

  return {
    statuses,
    ratings,
    reviews,
    activityLogs,
    communityMetadata,
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
    seedMetadata,
    deleteTrackstrEvent,
    getMediaStatus,
    getMediaRating,
    getMediaMetadata,
    getReviewsForMedia,
    getActivityForMedia,
    cacheMediaItem,
    getKnownMediaFromEvents,
    searchEventAutocomplete,
    trackedItemsList,
  }
})
