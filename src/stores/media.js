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
  const communityMetadata = ref({}) // key: contentId -> { poster, banner, genres, overview, author, createdAt }
  const mediaLibrary = ref({}) // key: contentId -> base media object
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
        reviews: reviews.value.slice(0, 100),
        activityLogs: activityLogs.value.slice(0, 100),
        communityMetadata: communityMetadata.value,
        mediaLibrary: mediaLibrary.value,
        lastSyncedAt: lastSyncedAt.value,
        nostrContentIds: nostrContentIds.value,
      }
      localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify(data))
    } catch (err) {
      console.warn('Failed to save media cache to localStorage:', err)
    }
  }

  /**
   * Parses media attributes from event tags
   */
  function parseMediaTags(tags) {
    const getTag = (name) => tags.find((t) => t[0] === name)?.[1]
    const contentId = getTag('contentid') || getTag('d')
    const type = getTag('type') || 'movie'
    const name = getTag('name') || ''
    const year = getTag('year') || ''
    const season = getTag('season')
    const episode = getTag('episode')

    return {
      contentId,
      type,
      name,
      year,
      season,
      episode,
    }
  }

  /**
   * Ingests a raw Nostr event into our state
   */
  function ingestEvent(evt) {
    const media = parseMediaTags(evt.tags)
    const dTag = evt.tags.find((t) => t[0] === 'd')?.[1] || media.contentId

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
      const current = statuses.value[dTag]

      // Mutable state: overwrite if newer
      if (!current || evt.created_at >= current.createdAt) {
        statuses.value[dTag] = {
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
      const current = ratings.value[dTag]

      // Mutable state: overwrite if newer
      if (!current || evt.created_at >= current.createdAt) {
        ratings.value[dTag] = {
          dTag,
          contentId: media.contentId,
          rating: ratingTag ? Number(ratingTag) : 0,
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
      const current = communityMetadata.value[media.contentId]

      if (!current || evt.created_at >= current.createdAt) {
        communityMetadata.value[media.contentId] = {
          contentId: media.contentId,
          poster: posterTag || '',
          banner: bannerTag || '',
          genres,
          overview: evt.content || '',
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
          contentId: media.contentId,
          content: evt.content,
          rating: ratingTag ? Number(ratingTag) : null,
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
   * Syncs user's mutable state and logs from Nostr relays (Delta Sync)
   */
  async function syncUserData(pubkey) {
    const userPubkey = pubkey || authStore.pubkey
    if (!userPubkey) return

    isSyncing.value = true
    try {
      const filter = {
        authors: [userPubkey],
        kinds: [KINDS.RATING, KINDS.STATUS, KINDS.REVIEW, KINDS.ACTIVITY_LOG],
      }

      // Delta sync if we already synced recently
      if (lastSyncedAt.value > 0) {
        filter.since = lastSyncedAt.value - 60 // 1 min buffer
      }

      const events = await nostrClient.queryEvents(filter)
      events.forEach((evt) => ingestEvent(evt))

      // Update sync time
      lastSyncedAt.value = Math.floor(Date.now() / 1000)
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
      const events = await nostrClient.queryEvents({
        '#d': [contentId],
        kinds: [KINDS.MEDIA_METADATA, KINDS.REVIEW, KINDS.ACTIVITY_LOG, KINDS.STATUS, KINDS.RATING],
        limit: 50,
      })

      events.forEach((evt) => ingestEvent(evt))
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
      const events = await nostrClient.queryEvents({
        kinds: [KINDS.REVIEW, KINDS.ACTIVITY_LOG],
        limit,
      })

      events.forEach((evt) => ingestEvent(evt))
      saveToLocalStorage()
      return events
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
      // Query events from relays across all Trackstr kinds
      const events = await nostrClient.queryEvents(
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
      )

      events.forEach((evt) => ingestEvent(evt))
      saveToLocalStorage()

      // Aggregate all known media items and calculate popularity based on event mentions
      const mentionCounts = new Map()
      const latestTimes = new Map()

      events.forEach((evt) => {
        const getTag = (name) => evt.tags.find((t) => t[0] === name)?.[1]
        const cId = getTag('contentid') || getTag('d')
        if (cId) {
          const baseContentId = cId.split(':')[0]
          mentionCounts.set(baseContentId, (mentionCounts.get(baseContentId) || 0) + 1)
          if (!latestTimes.has(baseContentId) || evt.created_at > latestTimes.get(baseContentId)) {
            latestTimes.set(baseContentId, evt.created_at)
          }
        }
      })

      // Also count from local stored statuses, ratings, reviews, logs
      Object.values(statuses.value).forEach((s) => {
        if (s.contentId) {
          mentionCounts.set(s.contentId, (mentionCounts.get(s.contentId) || 0) + 2)
        }
      })
      reviews.value.forEach((r) => {
        if (r.contentId) {
          mentionCounts.set(r.contentId, (mentionCounts.get(r.contentId) || 0) + 2)
        }
      })
      activityLogs.value.forEach((a) => {
        if (a.contentId) {
          mentionCounts.set(a.contentId, (mentionCounts.get(a.contentId) || 0) + 1)
        }
      })

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
   * Sets media watch/listening status (Kind 35402) and creates an immutable check-in log (Kind 5402)
   */
  async function setStatus(media, status, progress = '', note = '') {
    if (!authStore.isAuthenticated) {
      throw new Error('Please connect your Nostr extension to track media.')
    }

    // 1. Build Kind 35402 (Mutable State)
    const statusTemplate = buildStatusEvent(media, status, progress, note)
    const signedStatus = await nostrClient.signEvent(statusTemplate)
    await nostrClient.publish(signedStatus)
    ingestEvent(signedStatus)

    // 2. Build Kind 5402 (Immutable Check-in Log) if it's an active status
    if (['watching', 'completed', 'listening'].includes(status)) {
      try {
        const logTemplate = buildActivityLogEvent(media, status, progress, note)
        const signedLog = await nostrClient.signEvent(logTemplate)
        await nostrClient.publish(signedLog)
        ingestEvent(signedLog)
      } catch (logErr) {
        console.warn('Activity log event publication failed, but status was updated:', logErr)
      }
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
    await nostrClient.publish(signedRating)
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
    await nostrClient.publish(signedReview)
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
    await nostrClient.publish(signed)
    ingestEvent(signed)

    saveToLocalStorage()
    return signed
  }

  /**
   * Deletes a mutable or immutable event via NIP-09
   */
  async function deleteTrackstrEvent({ eventId, coordinate, reason }) {
    if (!authStore.isAuthenticated) {
      throw new Error('Please connect your Nostr extension.')
    }

    const deleteTemplate = buildDeletionEvent({ eventId, coordinate, reason })
    const signed = await nostrClient.signEvent(deleteTemplate)
    await nostrClient.publish(signed)

    // Remove from local state
    if (coordinate) {
      const parts = coordinate.split(':')
      const dTag = parts[2]
      if (dTag) {
        delete statuses.value[dTag]
        delete ratings.value[dTag]
      }
    }
    if (eventId) {
      reviews.value = reviews.value.filter((r) => r.id !== eventId)
      activityLogs.value = activityLogs.value.filter((a) => a.id !== eventId)
    }

    saveToLocalStorage()
    return signed
  }

  // Computed helper getters
  function getMediaStatus(contentId, season, episode) {
    const dTag = buildDTag({ contentId, season, episode })
    return statuses.value[dTag] || null
  }

  function getMediaRating(contentId, season, episode) {
    const dTag = buildDTag({ contentId, season, episode })
    return ratings.value[dTag]?.rating || null
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
      mediaLibrary.value[item.contentId] = {
        ...mediaLibrary.value[item.contentId],
        ...item,
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

    // 1. From mediaLibrary cache (Nostr-sourced entries only)
    Object.values(mediaLibrary.value).forEach((m) => {
      if (m && m.contentId && nostrContentIds.value[m.contentId]) {
        if (!type || m.type === type) {
          items.set(m.contentId, { ...m })
        }
      }
    })

    // 2. From statuses (kind 35402)
    Object.values(statuses.value).forEach((s) => {
      if (s.media && s.contentId) {
        if (!type || s.media.type === type) {
          const existing = items.get(s.contentId) || {}
          items.set(s.contentId, {
            ...existing,
            ...s.media,
            contentId: s.contentId,
            userStatus: s.status,
          })
        }
      }
    })

    // 3. From reviews (kind 5401)
    reviews.value.forEach((r) => {
      if (r.media && r.contentId) {
        if (!type || r.media.type === type) {
          const existing = items.get(r.contentId) || {}
          items.set(r.contentId, { ...existing, ...r.media, contentId: r.contentId })
        }
      }
    })

    // 4. From activity logs (kind 5402)
    activityLogs.value.forEach((a) => {
      if (a.media && a.contentId) {
        if (!type || a.media.type === type) {
          const existing = items.get(a.contentId) || {}
          items.set(a.contentId, { ...existing, ...a.media, contentId: a.contentId })
        }
      }
    })

    // 5. From community metadata (kind 35403)
    Object.entries(communityMetadata.value).forEach(([cId, meta]) => {
      if (items.has(cId)) {
        const existing = items.get(cId)
        items.set(cId, {
          ...existing,
          poster: existing.poster || meta.poster,
          genres: meta.genres || existing.genres,
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
    return Object.values(statuses.value)
  })

  return {
    statuses,
    ratings,
    reviews,
    activityLogs,
    communityMetadata,
    mediaLibrary,
    isSyncing,
    syncUserData,
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
