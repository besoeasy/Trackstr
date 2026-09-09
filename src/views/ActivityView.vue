<script setup>
import { ref, onMounted } from 'vue'
import { useRouter } from 'vue-router'
import { useMediaStore } from '@/stores/media.js'
import { formatRelativeTime, formatStatus, getStatusColorClass } from '@/utils/formatters.js'

const router = useRouter()
const mediaStore = useMediaStore()

const feed = ref([])
const isLoading = ref(false)
const filterType = ref('all') // 'all' | 'reviews' | 'scrobbles'

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

function getMediaTitle(tags) {
  return tags.find((t) => t[0] === 'name')?.[1] || 'Media'
}

function getMediaType(tags) {
  return tags.find((t) => t[0] === 'type')?.[1] || 'movie'
}

function getContentId(tags) {
  return tags.find((t) => t[0] === 'contentid')?.[1] || tags.find((t) => t[0] === 'd')?.[1] || ''
}

function navigateToMedia(tags) {
  const contentId = getContentId(tags)
  if (contentId) {
    router.push({
      name: 'media-detail',
      params: { contentId },
      query: {
        type: getMediaType(tags),
        title: getMediaTitle(tags),
      },
    })
  }
}
</script>

<template>
  <div class="activity-view">
    <div class="activity-header">
      <div>
        <h1 class="page-title">Activity & Scrobbles</h1>
        <p class="page-subtitle">
          Real-time decentralized feed of reviews (Kind 5401) and check-ins (Kind 5402) across relays
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
        Reviews (5401)
      </button>
      <button
        class="tab-btn"
        :class="{ 'is-active': filterType === 'scrobbles' }"
        type="button"
        @click="filterType = 'scrobbles'"
      >
        Check-ins / Scrobbles (5402)
      </button>
    </div>

    <!-- Feed list -->
    <div v-if="isLoading" class="loading-state card">
      <p>Connecting to relays and fetching events...</p>
    </div>

    <div v-else-if="feed.length === 0" class="empty-state card">
      <p>No activity events detected on active relays.</p>
      <p class="form-hint">Track a movie, write a review, or check in to broadcast your activity.</p>
    </div>

    <div v-else class="timeline-container">
      <div
        v-for="evt in feed"
        :key="evt.id"
        class="timeline-item card"
      >
        <div class="timeline-header">
          <div class="timeline-user">
            <span class="contentid-chip">{{ evt.pubkey.slice(0, 8) }}...{{ evt.pubkey.slice(-4) }}</span>
            <span v-if="evt.kind === 5401" class="badge badge-info">Review</span>
            <span v-else-if="evt.kind === 5402" class="badge badge-success">Check-in</span>
          </div>
          <span class="timeline-time">{{ formatRelativeTime(evt.created_at) }}</span>
        </div>

        <div class="timeline-media" @click="navigateToMedia(evt.tags)">
          <span class="badge badge-primary">{{ getMediaType(evt.tags) }}</span>
          <span class="timeline-media-title">{{ getMediaTitle(evt.tags) }}</span>
          <span v-if="evt.tags.find(t => t[0] === 'rating')" class="timeline-rating">
            ★ {{ evt.tags.find(t => t[0] === 'rating')[1] }}/10
          </span>
          <span v-if="evt.tags.find(t => t[0] === 'status')" class="badge badge-neutral">
            {{ formatStatus(evt.tags.find(t => t[0] === 'status')[1]) }}
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
  margin-bottom: 24px;
}

.page-title {
  font-size: 2.2rem;
  font-weight: 800;
  margin-bottom: 4px;
}

.page-subtitle {
  color: var(--text-secondary);
  font-size: 0.95rem;
}

.timeline-container {
  display: flex;
  flex-direction: column;
  gap: 16px;
  max-width: 800px;
}

.timeline-item {
  display: flex;
  flex-direction: column;
  gap: 10px;
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
  font-size: 0.8rem;
  color: var(--text-muted);
}

.timeline-media {
  display: flex;
  align-items: center;
  gap: 10px;
  cursor: pointer;
}

.timeline-media:hover .timeline-media-title {
  color: var(--primary);
}

.timeline-media-title {
  font-size: 1.05rem;
  font-weight: 700;
  transition: color var(--transition-fast);
}

.timeline-rating {
  font-weight: 700;
  color: var(--accent-amber);
  font-size: 0.9rem;
}

.timeline-content {
  font-size: 0.92rem;
  color: var(--text-secondary);
  line-height: 1.5;
  white-space: pre-line;
  background: var(--bg-surface);
  padding: 12px;
  border-radius: var(--radius-sm);
  border: 1px solid var(--border-subtle);
}
</style>
