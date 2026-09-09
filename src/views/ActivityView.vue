<script setup>
import { ref, computed, onMounted } from 'vue'
import { useRouter } from 'vue-router'
import { useMediaStore } from '@/stores/media.js'
import { formatRelativeTime, formatStatus, getStatusColorClass } from '@/utils/formatters.js'

const router = useRouter()
const mediaStore = useMediaStore()

const feed = ref([])
const isLoading = ref(false)
const filterType = ref('all') // 'all' | 'reviews' | 'scrobbles'

const filteredFeed = computed(() => {
  if (filterType.value === 'reviews') return feed.value.filter((e) => e?.kind === 5401)
  if (filterType.value === 'scrobbles') return feed.value.filter((e) => e?.kind === 5402)
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
  return t.find((t) => t[0] === 'contentid')?.[1] || t.find((t) => t[0] === 'd')?.[1] || ''
}

function getTagValue(tags, name) {
  return safeTags(tags).find((t) => t[0] === name)?.[1]
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

    <div v-else-if="filteredFeed.length === 0" class="empty-state card">
      <p v-if="feed.length === 0">No activity events detected on active relays.</p>
      <p v-else>No {{ filterType === 'reviews' ? 'reviews' : 'check-ins / scrobbles' }} in this feed yet.</p>
      <p class="form-hint">Track a movie, write a review, or check in to broadcast your activity.</p>
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
            <span v-if="evt.kind === 5401" class="badge badge-info">Review</span>
            <span v-else-if="evt.kind === 5402" class="badge badge-success">Check-in</span>
          </div>
          <span class="timeline-time">{{ formatRelativeTime(evt.created_at) }}</span>
        </div>

        <div class="timeline-media" @click="navigateToMedia(evt.tags)">
          <span class="badge badge-primary">{{ getMediaType(evt.tags) }}</span>
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
    overflow-x: auto;
    scrollbar-width: none;
    flex-wrap: nowrap;
    margin-bottom: 16px;
    padding-bottom: 4px;
  }

  .tabs-bar::-webkit-scrollbar {
    display: none;
  }

  .tabs-bar .tab-btn {
    flex-shrink: 0;
    padding: 8px 14px;
    font-size: 0.85rem;
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
