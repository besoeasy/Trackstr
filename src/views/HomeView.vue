<script setup>
import { ref, onMounted } from 'vue'
import { useRouter } from 'vue-router'
import { useAuthStore } from '@/stores/auth.js'
import { useMediaStore } from '@/stores/media.js'
import { SAMPLE_MEDIA } from '@/services/api/tmdb.js'
import { SAMPLE_MUSIC } from '@/services/api/musicbrainz.js'
import { computeContentId } from '@/utils/contentId.js'
import { formatRelativeTime, formatStatus, getStatusColorClass } from '@/utils/formatters.js'
import MediaCard from '@/components/MediaCard.vue'

const router = useRouter()
const authStore = useAuthStore()
const mediaStore = useMediaStore()

const featuredItems = ref([])
const recentFeed = ref([])
const isLoadingFeed = ref(false)

onMounted(async () => {
  // Prepare sample media with contentIds
  const allSamples = [...SAMPLE_MEDIA, ...SAMPLE_MUSIC]
  const items = []
  for (const m of allSamples) {
    const { contentId } = await computeContentId({
      type: m.type,
      title: m.title,
      year: m.year,
      artist: m.artist,
    })
    items.push({ ...m, contentId })
  }
  featuredItems.value = items

  // Fetch recent activity feed from relays
  loadFeed()
})

async function loadFeed() {
  isLoadingFeed.value = true
  try {
    recentFeed.value = await mediaStore.fetchRecentFeed(20)
  } catch (err) {
    console.warn('Feed load failed:', err)
  } finally {
    isLoadingFeed.value = false
  }
}
</script>

<template>
  <div class="home-view">
    <!-- Hero Banner -->
    <section class="hero-section">
      <div class="hero-content">
        <span class="badge badge-primary hero-badge">Nostr-Powered Media Social</span>
        <h1 class="hero-title">Track everything you love. Own your taste.</h1>
        <p class="hero-subtitle">
          A decentralized media tracking platform for movies, TV shows, and music.
          Ratings, watchlists, and scrobbles live on Nostr, with decentralized artwork on IPFS via Originless.
        </p>

        <div class="hero-buttons">
          <router-link to="/search" class="btn btn-primary btn-lg">
            🔍 Search & Track Media
          </router-link>
          <button
            v-if="!authStore.isAuthenticated"
            class="btn btn-secondary btn-lg"
            type="button"
            @click="authStore.loginWithExtension"
          >
            ⚡ Connect Nostr Extension
          </button>
          <router-link v-else to="/library" class="btn btn-secondary btn-lg">
            📚 Open My Library
          </router-link>
        </div>
      </div>
    </section>

    <!-- Architecture Highlight Banner -->
    <section class="arch-banner card">
      <div class="arch-col">
        <div class="arch-icon">⚡</div>
        <div class="arch-info">
          <h4>Mutable State (Kinds 35400, 35402)</h4>
          <p>NIP-33 parameterized replaceable events. Relays overwrite old states per item. Zero bloat.</p>
        </div>
      </div>
      <div class="arch-col">
        <div class="arch-icon">📜</div>
        <div class="arch-info">
          <h4>Permanent Historical Logs (Kinds 5401, 5402)</h4>
          <p>Reviews and scrobbles are permanent diary entries without artificial expiration tags.</p>
        </div>
      </div>
      <div class="arch-col">
        <div class="arch-icon">📦</div>
        <div class="arch-info">
          <h4>Decentralized IPFS (Originless)</h4>
          <p>Artwork and metadata addressed with IPFS CIDs via public instance at originless.gupt.app.</p>
        </div>
      </div>
    </section>

    <!-- Featured Section -->
    <section class="section">
      <div class="section-header">
        <div>
          <h2 class="section-title">Popular & Featured Titles</h2>
          <p class="section-subtitle">Explore, rate, or scrobble to your Nostr identity</p>
        </div>
        <router-link to="/search" class="btn btn-outline btn-sm">View All →</router-link>
      </div>

      <div class="grid grid-media">
        <MediaCard
          v-for="item in featuredItems"
          :key="item.contentId"
          :media="item"
        />
      </div>
    </section>

    <!-- Recent Nostr Activity Feed -->
    <section class="section">
      <div class="section-header">
        <div>
          <h2 class="section-title">Recent Activity Feed</h2>
          <p class="section-subtitle">Real-time check-ins and reviews across configured relays</p>
        </div>
        <button class="btn btn-secondary btn-sm" type="button" @click="loadFeed">
          🔄 Refresh Feed
        </button>
      </div>

      <div v-if="isLoadingFeed" class="empty-feed">
        <p>Connecting to Nostr relays and loading activity...</p>
      </div>

      <div v-else-if="recentFeed.length === 0" class="empty-feed card">
        <p>No recent activity received yet on the active relays.</p>
        <p class="form-hint">Connect your extension and track a movie or album to create the first entry!</p>
      </div>

      <div v-else class="activity-feed-grid">
        <div v-for="act in recentFeed" :key="act.id" class="activity-feed-card card">
          <div class="activity-card-header">
            <span class="activity-author contentid-chip">
              {{ act.pubkey.slice(0, 8) }}...{{ act.pubkey.slice(-4) }}
            </span>
            <span class="activity-time">{{ formatRelativeTime(act.created_at) }}</span>
          </div>

          <div class="activity-body">
            <div class="activity-badge-row">
              <span v-if="act.kind === 5401" class="badge badge-info">Review</span>
              <span v-else-if="act.kind === 5402" class="badge badge-success">Check-in</span>
              <span class="activity-media-name">{{ act.tags.find(t => t[0] === 'name')?.[1] || 'Media' }}</span>
            </div>
            <p v-if="act.content" class="activity-content-text">{{ act.content }}</p>
          </div>
        </div>
      </div>
    </section>
  </div>
</template>

<style scoped>
.hero-section {
  padding: 48px 0 36px;
  text-align: center;
  position: relative;
}

.hero-badge {
  margin-bottom: 16px;
}

.hero-title {
  font-size: 2.8rem;
  font-weight: 800;
  line-height: 1.15;
  letter-spacing: -0.03em;
  margin-bottom: 16px;
  background: linear-gradient(135deg, #ffffff 40%, var(--primary) 100%);
  -webkit-background-clip: text;
  -webkit-text-fill-color: transparent;
}

[data-theme='light'] .hero-title {
  background: linear-gradient(135deg, #0f172a 40%, var(--primary) 100%);
  -webkit-background-clip: text;
  -webkit-text-fill-color: transparent;
}

.hero-subtitle {
  font-size: 1.1rem;
  color: var(--text-secondary);
  max-width: 680px;
  margin: 0 auto 28px;
}

.hero-buttons {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 16px;
  flex-wrap: wrap;
}

.arch-banner {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 20px;
  margin: 32px 0 48px;
  background: var(--bg-surface);
}

@media (max-width: 800px) {
  .arch-banner {
    grid-template-columns: 1fr;
  }
}

.arch-col {
  display: flex;
  align-items: flex-start;
  gap: 14px;
}

.arch-icon {
  font-size: 1.8rem;
  line-height: 1;
}

.arch-info h4 {
  font-size: 0.95rem;
  font-weight: 600;
  margin-bottom: 4px;
}

.arch-info p {
  font-size: 0.82rem;
  color: var(--text-secondary);
  line-height: 1.4;
}

.section {
  margin-bottom: 48px;
}

.section-header {
  display: flex;
  align-items: flex-end;
  justify-content: space-between;
  margin-bottom: 20px;
}

.section-title {
  font-size: 1.5rem;
  font-weight: 700;
  letter-spacing: -0.02em;
}

.section-subtitle {
  font-size: 0.9rem;
  color: var(--text-secondary);
  margin-top: 2px;
}

.empty-feed {
  padding: 32px;
  text-align: center;
  color: var(--text-secondary);
}

.activity-feed-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(320px, 1fr));
  gap: 16px;
}

.activity-feed-card {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.activity-card-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.activity-time {
  font-size: 0.78rem;
  color: var(--text-muted);
}

.activity-badge-row {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 6px;
}

.activity-media-name {
  font-weight: 600;
  font-size: 0.95rem;
}

.activity-content-text {
  font-size: 0.88rem;
  color: var(--text-secondary);
  line-height: 1.4;
}
</style>
