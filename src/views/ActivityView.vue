<script setup>
import { ref, computed, onMounted } from 'vue'
import { useRouter } from 'vue-router'
import { useMediaStore } from '@/stores/media.js'
import { formatRelativeTime, formatStatus } from '@/utils/formatters.js'
import { cleanShowTitle } from '@/utils/contentId.js'

const router = useRouter()
const mediaStore = useMediaStore()

const feed = ref([])
const isLoading = ref(false)
const filterType = ref('all') // 'all' | 'reviews' | 'suggestions'

const filteredFeed = computed(() => {
  if (filterType.value === 'reviews') {
    return feed.value.filter((e) => e?.kind === 35400 && e?.content)
  }
  if (filterType.value === 'suggestions') return feed.value.filter((e) => e?.kind === 35401)
  return feed.value
})

onMounted(async () => {
  await loadActivity()
})

async function loadActivity() {
  isLoading.value = true
  try {
    const events = await mediaStore.fetchRecentFeed(40)
    feed.value = events
  } catch (err) {
    console.warn('Failed to load activity:', err)
  } finally {
    isLoading.value = false
  }
}

function safeTags(tags) {
  return Array.isArray(tags) ? tags : []
}

function getMediaTitle(tags) {
  return safeTags(tags).find((t) => t[0] === 'name')?.[1] || 'Media'
}

function getMediaType(tags) {
  return safeTags(tags).find((t) => t[0] === 'type')?.[1] || 'movie'
}

function getContentId(tags) {
  const t = safeTags(tags)
  return t.find((t) => t[0] === 'contentid')?.[1] || ''
}

function getTagValue(tags, name) {
  return safeTags(tags).find((t) => t[0] === name)?.[1]
}

function getSimilarItems(tags) {
  return safeTags(tags)
    .filter((t) => t[0] === 'similar')
    .map((t) => ({
      contentId: t[1],
      type: t[2] || 'movie',
      name: t[3] || 'Similar Title',
      year: t[4] || '',
    }))
}

function navigateToContentId(contentId, type = 'movie', title = '', year = '') {
  if (!contentId) return
  router.push({
    name: 'media-detail',
    params: { contentId },
    query: {
      type,
      title,
      year,
    },
  })
}

function navigateToMedia(tags) {
  const contentId = getContentId(tags)
  if (contentId) {
    const rawType = getMediaType(tags)
    const rawTitle = getMediaTitle(tags)
    const isEpisode = rawType === 'episode' || !!getTagValue(tags, 'season')
    const type = isEpisode ? 'show' : rawType
    const title = isEpisode ? cleanShowTitle(rawTitle) : rawTitle
    const season = getTagValue(tags, 'season')
    const episode = getTagValue(tags, 'episode')

    const query = {
      type,
      title,
    }
    if (season) query.season = season
    if (episode) query.episode = episode

    router.push({
      name: 'media-detail',
      params: { contentId },
      query,
    })
  }
}
</script>

<template>
  <div class="activity-view">
    <div class="activity-header">
      <div>
        <h1 class="page-title">Activity & Suggestions</h1>
        <p class="page-subtitle">
          Real-time decentralized feed of ratings & reviews (Kind 35400) and community suggestions (Kind 35401) across relays
        </p>
      </div>

      <button class="btn btn-secondary btn-sm" type="button" :disabled="isLoading" @click="loadActivity">
        {{ isLoading ? 'Refreshing...' : '🔄 Refresh' }}
      </button>
    </div>

    <!-- Filter tabs -->
    <div class="tabs-bar">
      <button
        class="tab-btn"
        :class="{ 'is-active': filterType === 'all' }"
        type="button"
        @click="filterType = 'all'"
      >
        All Activity
      </button>
      <button
        class="tab-btn"
        :class="{ 'is-active': filterType === 'reviews' }"
        type="button"
        @click="filterType = 'reviews'"
      >
        Reviews & Ratings (35400)
      </button>
      <button
        class="tab-btn"
        :class="{ 'is-active': filterType === 'suggestions' }"
        type="button"
        @click="filterType = 'suggestions'"
      >
        Suggestions (35401)
      </button>
    </div>

    <!-- Feed list -->
    <div v-if="isLoading" class="loading-state card">
      <p>Connecting to relays and fetching events...</p>
    </div>

    <div v-else-if="filteredFeed.length === 0" class="empty-state card">
      <p v-if="feed.length === 0">No activity events detected on active relays.</p>
      <p v-else>No {{ filterType === 'reviews' ? 'reviews' : 'suggestions' }} in this feed yet.</p>
      <p class="form-hint">Track a movie, write a review, or suggest similar titles to broadcast your activity.</p>
    </div>

    <div v-else class="timeline-container">
      <div
        v-for="evt in filteredFeed"
        :key="evt.id"
        class="timeline-item card"
      >
        <div class="timeline-header">
          <div class="timeline-user">
            <span class="contentid-chip">{{ (evt.pubkey || '').slice(0, 8) }}...{{ (evt.pubkey || '').slice(-4) }}</span>
            <span v-if="evt.kind === 35400 && evt.content" class="badge badge-info">Review</span>
            <span v-else-if="evt.kind === 35400" class="badge badge-warning">Rating</span>
            <span v-else-if="evt.kind === 35401" class="badge badge-accent">Suggestion</span>
          </div>
          <span class="timeline-time">{{ formatRelativeTime(evt.created_at) }}</span>
        </div>

        <!-- Suggestion display for Kind 35401 -->
        <div v-if="evt.kind === 35401" class="timeline-suggestion-box">
          <div class="suggestion-flow">
            <span class="flow-label">Similar to</span>
            <span class="flow-source" @click="navigateToMedia(evt.tags)">{{ getMediaTitle(evt.tags) }}</span>
            <span class="flow-arrow">➔</span>
            <div class="suggested-items-chips">
              <span
                v-for="sug in getSimilarItems(evt.tags)"
                :key="sug.contentId"
                class="suggested-chip"
                @click.stop="navigateToContentId(sug.contentId, sug.type, sug.name, sug.year)"
              >
                💡 {{ sug.name }} <template v-if="sug.year">({{ sug.year }})</template>
              </span>
            </div>
          </div>
        </div>

        <!-- Standard media display for Kind 35400 -->
        <div v-else class="timeline-media" @click="navigateToMedia(evt.tags)">
          <span class="badge badge-primary">{{ getMediaType(evt.tags) === 'episode' ? 'show' : getMediaType(evt.tags) }}</span>
          <span class="timeline-media-title">{{ getMediaTitle(evt.tags) }}</span>
          <span v-if="getTagValue(evt.tags, 'rating')" class="timeline-rating">
            ★ {{ getTagValue(evt.tags, 'rating') }}/10
          </span>
          <span v-if="getTagValue(evt.tags, 'status')" class="badge badge-neutral">
            {{ formatStatus(getTagValue(evt.tags, 'status')) }}
          </span>
        </div>

        <p v-if="evt.content" class="timeline-content">{{ evt.content }}</p>
      </div>
    </div>
  </div>
</template>

<style scoped>
.activity-header {
  display: flex;
  justify-content: space-between;
  align-items: flex-end;
  margin-bottom: 36px;
  gap: 20px;
}

.page-title {
  font-size: clamp(2.4rem, 5vw, 3.5rem);
  font-weight: 800;
  letter-spacing: -0.05em;
  line-height: 1.08;
  color: var(--text-main);
  margin-bottom: 8px;
}

.page-subtitle {
  color: var(--text-secondary);
  font-size: 1.05rem;
  line-height: 1.6;
  max-width: 680px;
  letter-spacing: -0.01em;
}

.timeline-container {
  display: flex;
  flex-direction: column;
  gap: 14px;
  max-width: 860px;
}

.timeline-item {
  display: flex;
  flex-direction: column;
  gap: 12px;
  padding: 20px 24px;
  border-radius: var(--radius-md);
  border: 1px solid var(--border-subtle);
  background: var(--bg-card);
  transition: border-color var(--transition-fast);
}

.timeline-item:hover {
  border-color: var(--border-hover);
}

.timeline-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
}

.timeline-user {
  display: flex;
  align-items: center;
  gap: 10px;
}

.timeline-time {
  font-size: 0.78rem;
  color: var(--text-muted);
}

.timeline-media {
  display: flex;
  align-items: center;
  gap: 10px;
  cursor: pointer;
}

.timeline-media:hover .timeline-media-title {
  color: #ffffff;
}

[data-theme='light'] .timeline-media:hover .timeline-media-title {
  color: #000000;
}

.timeline-media-title {
  font-size: 1.1rem;
  font-weight: 700;
  letter-spacing: -0.025em;
  transition: color var(--transition-fast);
}

.timeline-rating {
  font-weight: 600;
  color: var(--accent-amber);
  font-size: 0.88rem;
}

.timeline-content {
  font-size: 0.92rem;
  line-height: 1.6;
  color: var(--text-secondary);
  white-space: pre-line;
  background: #000000;
  padding: 14px 16px;
  border-radius: var(--radius-sm);
  border: 1px solid var(--border-subtle);
}

[data-theme='light'] .timeline-content {
  background: #f9f9f9;
}

.timeline-suggestion-box {
  background: var(--bg-surface);
  border-radius: var(--radius-sm);
  padding: 12px 14px;
  border: 1px solid var(--border-subtle);
}

.suggestion-flow {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
  font-size: 0.92rem;
}

.flow-label {
  color: var(--text-muted);
}

.flow-source {
  color: var(--text-main);
  font-weight: 600;
  cursor: pointer;
  text-decoration: underline;
  text-underline-offset: 2px;
}

.flow-arrow {
  color: var(--accent-primary);
  font-weight: bold;
}

.suggested-items-chips {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}

.suggested-chip {
  display: inline-flex;
  align-items: center;
  padding: 4px 10px;
  background: rgba(230, 0, 103, 0.1);
  color: var(--accent-primary);
  border: 1px solid rgba(230, 0, 103, 0.25);
  border-radius: var(--radius-pill);
  font-size: 0.82rem;
  font-weight: 500;
  cursor: pointer;
  transition: all var(--transition-fast);
}

.suggested-chip:hover {
  background: rgba(230, 0, 103, 0.2);
  border-color: var(--accent-primary);
}

@media (max-width: 640px) {
  .activity-header {
    flex-direction: column;
    align-items: flex-start;
    gap: 12px;
    margin-bottom: 18px;
  }

  .activity-header .btn {
    align-self: stretch;
    justify-content: center;
  }

  .page-title {
    font-size: 1.8rem;
  }

  .tabs-bar {
    display: flex;
    overflow-x: auto;
    scrollbar-width: none;
    -webkit-overflow-scrolling: touch;
    flex-wrap: nowrap;
    margin-bottom: 16px;
    padding-bottom: 4px;
    width: 100%;
    max-width: 100%;
  }

  .tabs-bar::-webkit-scrollbar {
    display: none;
  }

  .tabs-bar .tab-btn {
    flex-shrink: 0;
    padding: 8px 14px;
    font-size: 0.85rem;
  }

  .timeline-container {
    width: 100%;
    max-width: 100%;
  }

  .timeline-item {
    padding: 16px;
    width: 100%;
    max-width: 100%;
  }

  .timeline-header {
    flex-direction: column;
    align-items: flex-start;
    gap: 6px;
  }

  .timeline-media {
    flex-wrap: wrap;
  }
}
</style>
