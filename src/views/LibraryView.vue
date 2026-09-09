<script setup>
import { ref, computed, onMounted, watch } from 'vue'
import { useRouter } from 'vue-router'
import { useAuthStore } from '@/stores/auth.js'
import { useMediaStore } from '@/stores/media.js'
import { formatStatus, getStatusColorClass, formatRelativeTime } from '@/utils/formatters.js'

const router = useRouter()
const authStore = useAuthStore()
const mediaStore = useMediaStore()

const activeTab = ref('all') // 'all' | 'active' | 'completed' | 'plan' | 'dropped' | 'reviews'
const actionError = ref('')

function handleTrack() {
  router.push({ path: '/', query: { track: 'true' } })
}

onMounted(() => {
  if (authStore.pubkey) {
    mediaStore.syncUserData(authStore.pubkey)
  }
})

// A wallet connected after mount must still populate the library.
watch(
  () => authStore.pubkey,
  (newPubkey, oldPubkey) => {
    if (newPubkey && newPubkey !== oldPubkey) {
      mediaStore.syncUserData(newPubkey)
    }
  }
)

const allTracked = computed(() => {
  return mediaStore.trackedItemsList
})

const filteredItems = computed(() => {
  if (activeTab.value === 'all') return allTracked.value
  if (activeTab.value === 'active') {
    return allTracked.value.filter((i) => i.status === 'watching' || i.status === 'listening')
  }
  if (activeTab.value === 'completed') {
    return allTracked.value.filter((i) => i.status === 'completed')
  }
  if (activeTab.value === 'plan') {
    return allTracked.value.filter((i) => i.status === 'plan-to-watch' || i.status === 'plan-to-listen')
  }
  if (activeTab.value === 'dropped') {
    return allTracked.value.filter((i) => i.status === 'dropped' || i.status === 'on-hold')
  }
  return allTracked.value
})

const userReviews = computed(() => {
  if (!authStore.pubkey) return []
  return mediaStore.reviews.filter((r) => r.pubkey === authStore.pubkey)
})

async function handleDelete(item) {
  if (!confirm(`Are you sure you want to remove "${item.media?.name || item.contentId}" from your library? (NIP-09 deletion will be published)`)) {
    return
  }

  actionError.value = ''
  try {
    // Delete both the status (35402) and the rating (35400) sharing this
    // d-tag so no orphaned half of the record survives on relays.
    await mediaStore.deleteTrackstrEvent({
      coordinate: `35402:${authStore.pubkey}:${item.dTag}`,
      reason: 'Removed from library',
    })
    await mediaStore.deleteTrackstrEvent({
      coordinate: `35400:${authStore.pubkey}:${item.dTag}`,
      reason: 'Removed from library',
    })
  } catch (err) {
    actionError.value = err.message || 'Failed to delete item.'
  }
}

async function handleDeleteReview(review) {
  if (!confirm('Are you sure you want to delete this review? (NIP-09 deletion will be published)')) {
    return
  }

  actionError.value = ''
  try {
    await mediaStore.deleteTrackstrEvent({ eventId: review.id, reason: 'Review deleted by author' })
  } catch (err) {
    actionError.value = err.message || 'Failed to delete review.'
  }
}

function navigateToItem(contentId, media) {
  router.push({
    name: 'media-detail',
    params: { contentId },
    query: {
      type: media?.type || 'movie',
      title: media?.name || '',
      year: media?.year || '',
      artist: media?.artist || '',
    },
  })
}
</script>

<template>
  <div class="library-view">
    <div class="library-header">
      <div>
        <h1 class="page-title">My Library</h1>
        <p class="page-subtitle">
          Your personal media collection stored on Nostr (NIP-33 Parameterized Replaceable State)
        </p>
      </div>

      <div class="header-actions">
        <button
          class="btn btn-primary btn-sm"
          type="button"
          @click="handleTrack"
        >
          <span>+</span>
          <span>Track Media</span>
        </button>
        <button
          class="btn btn-secondary btn-sm"
          type="button"
          :disabled="mediaStore.isSyncing"
          @click="mediaStore.syncUserData()"
        >
          <span>{{ mediaStore.isSyncing ? 'Syncing...' : '🔄 Delta Sync Relays' }}</span>
        </button>
      </div>
    </div>

    <!-- Login prompt if not authenticated -->
    <div v-if="!authStore.isAuthenticated" class="auth-banner card">
      <h2>Connect your Nostr Account</h2>
      <p>Connect your browser extension or Bunker remote signer to view and manage your library across relays.</p>
      <button class="btn btn-primary" type="button" @click="authStore.openLoginModal">
        ⚡ Connect Nostr
      </button>
    </div>

    <template v-else>
      <div v-if="actionError" class="badge badge-danger error-banner">
        {{ actionError }}
      </div>
      <!-- Filter Tabs -->
      <div class="tabs-bar">
        <button
          class="tab-btn"
          :class="{ 'is-active': activeTab === 'all' }"
          type="button"
          @click="activeTab = 'all'"
        >
          All Items ({{ allTracked.length }})
        </button>
        <button
          class="tab-btn"
          :class="{ 'is-active': activeTab === 'active' }"
          type="button"
          @click="activeTab = 'active'"
        >
          Watching / Listening
        </button>
        <button
          class="tab-btn"
          :class="{ 'is-active': activeTab === 'completed' }"
          type="button"
          @click="activeTab = 'completed'"
        >
          Completed
        </button>
        <button
          class="tab-btn"
          :class="{ 'is-active': activeTab === 'plan' }"
          type="button"
          @click="activeTab = 'plan'"
        >
          Plan to Watch/Listen
        </button>
        <button
          class="tab-btn"
          :class="{ 'is-active': activeTab === 'dropped' }"
          type="button"
          @click="activeTab = 'dropped'"
        >
          On Hold / Dropped
        </button>
        <button
          class="tab-btn"
          :class="{ 'is-active': activeTab === 'reviews' }"
          type="button"
          @click="activeTab = 'reviews'"
        >
          My Reviews ({{ userReviews.length }})
        </button>
      </div>

      <!-- Items List -->
      <div v-if="activeTab !== 'reviews'">
        <div v-if="filteredItems.length === 0" class="empty-state card">
          <p>No titles currently in this category.</p>
          <router-link :to="{ path: '/', query: { track: 'true' } }" class="btn btn-primary btn-sm">
            🔍 Discover Titles to Track
          </router-link>
        </div>

        <div v-else class="library-items-list">
          <div
            v-for="item in filteredItems"
            :key="item.dTag"
            class="library-row card"
          >
            <div class="row-media-info" @click="navigateToItem(item.contentId, item.media)">
              <div class="row-badges">
                <span class="badge badge-primary">{{ item.media?.type || 'media' }}</span>
                <span class="badge" :class="getStatusColorClass(item.status)">
                  {{ formatStatus(item.status) }}
                </span>
                <span v-if="item.progress" class="row-progress">[{{ item.progress }}]</span>
              </div>

              <h3 class="row-title">{{ item.media?.name || item.contentId }}</h3>
              <div class="row-sub">
                <span v-if="item.media?.year">{{ item.media.year }}</span>
                <span class="contentid-chip">{{ item.contentId.slice(0, 12) }}...</span>
              </div>
            </div>

            <div class="row-actions">
              <div v-if="mediaStore.getMediaRating(item.contentId)" class="row-rating">
                ★ <strong>{{ mediaStore.getMediaRating(item.contentId) }}</strong>/10
              </div>

              <button
                class="btn btn-outline btn-sm"
                type="button"
                @click="navigateToItem(item.contentId, item.media)"
              >
                View
              </button>

              <button
                class="btn btn-sm btn-danger"
                type="button"
                title="Publish NIP-09 deletion event"
                @click="handleDelete(item)"
              >
                Delete
              </button>
            </div>
          </div>
        </div>
      </div>

      <!-- My Reviews Tab -->
      <div v-else>
        <div v-if="userReviews.length === 0" class="empty-state card">
          <p>You haven't published any written reviews yet.</p>
        </div>

        <div v-else class="reviews-list">
          <div v-for="rev in userReviews" :key="rev.id" class="review-card card">
            <div class="review-top">
              <div class="review-media-meta">
                <h4 class="review-title">{{ rev.media?.name || rev.contentId }}</h4>
                <span v-if="rev.rating" class="review-score">★ {{ rev.rating }}/10</span>
              </div>
              <div class="review-date-actions">
                <span class="review-time">{{ formatRelativeTime(rev.createdAt) }}</span>
                <button
                  class="btn btn-sm btn-danger"
                  type="button"
                  title="NIP-09 delete review"
                  @click="handleDeleteReview(rev)"
                >
                  Delete
                </button>
              </div>
            </div>
            <p class="review-body">{{ rev.content }}</p>
          </div>
        </div>
      </div>
    </template>
  </div>
</template>

<style scoped>
.error-banner {
  display: block;
  padding: 8px 12px;
  margin-bottom: 14px;
}

.library-header {
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

.auth-banner {
  padding: 48px;
  text-align: center;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 16px;
}

.library-items-list {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.library-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 16px 20px;
  cursor: pointer;
}

.library-row:hover {
  border-color: var(--border-hover);
  background: var(--bg-card-hover);
}

.row-media-info {
  flex: 1;
}

.row-badges {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 6px;
}

.row-progress {
  font-family: var(--font-mono);
  font-size: 0.8rem;
  color: var(--accent-sky);
  font-weight: 600;
}

.row-title {
  font-size: 1.1rem;
  font-weight: 700;
  margin-bottom: 4px;
}

.row-sub {
  display: flex;
  align-items: center;
  gap: 12px;
  font-size: 0.82rem;
  color: var(--text-secondary);
}

.row-actions {
  display: flex;
  align-items: center;
  gap: 12px;
}

.row-rating {
  font-size: 0.92rem;
  color: var(--accent-amber);
}

.reviews-list {
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.review-top {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  margin-bottom: 10px;
}

.review-media-meta {
  display: flex;
  align-items: center;
  gap: 12px;
}

.review-title {
  font-size: 1.1rem;
  font-weight: 700;
}

.review-score {
  font-weight: 700;
  color: var(--accent-amber);
}

.review-date-actions {
  display: flex;
  align-items: center;
  gap: 12px;
}

.review-time {
  font-size: 0.8rem;
  color: var(--text-muted);
}

.review-body {
  font-size: 0.92rem;
  line-height: 1.5;
  color: var(--text-secondary);
}

@media (max-width: 640px) {
  .library-header {
    flex-direction: column;
    align-items: flex-start;
    gap: 14px;
    margin-bottom: 18px;
  }

  .page-title {
    font-size: 1.8rem;
  }

  .header-actions {
    width: 100%;
    display: flex;
    gap: 8px;
  }

  .header-actions .btn {
    flex: 1;
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

  .library-row {
    flex-direction: column;
    align-items: flex-start;
    gap: 12px;
    padding: 14px 16px;
  }

  .row-actions {
    width: 100%;
    justify-content: space-between;
    border-top: 1px solid var(--border-subtle);
    padding-top: 10px;
    margin-top: 2px;
  }

  .review-top {
    flex-direction: column;
    align-items: flex-start;
    gap: 8px;
  }

  .review-date-actions {
    width: 100%;
    justify-content: space-between;
  }
}
</style>
