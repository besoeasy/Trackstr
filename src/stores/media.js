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
    trackedItemsList,
  }
})
