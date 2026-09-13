<script setup>
import { ref, computed, onMounted, watch } from 'vue'
import { useRoute } from 'vue-router'
import { nip19 } from 'nostr-tools'
import { useMediaStore } from '@/stores/media.js'
import { nostrClient } from '@/services/nostr/client.js'
import { KINDS } from '@/services/nostr/events.js'
import { normalizePubkey } from '@/utils/contentId.js'
import { isValidPubkey } from '@/utils/urls.js'
import MediaCard from '@/components/MediaCard.vue'

const route = useRoute()
const mediaStore = useMediaStore()
const loading = ref(false)
const error = ref('')
const profile = ref(null)

function resolveIdentity(input) {
  const raw = String(input || '').trim()
  if (!raw) return ''
  if (isValidPubkey(raw)) return normalizePubkey(raw)
  try {
    if (raw.startsWith('npub1')) {
      const decoded = nip19.decode(raw)
      if (decoded.type === 'npub') return normalizePubkey(decoded.data)
    }
    if (raw.startsWith('nostr:npub1')) {
      const decoded = nip19.decode(raw.slice('nostr:'.length))
      if (decoded.type === 'npub') return normalizePubkey(decoded.data)
    }
  } catch {}
  return ''
}

const pubkey = computed(() => resolveIdentity(route.params.identity))

const userStatuses = computed(() => {
  const pk = pubkey.value
  if (!pk) return []
  return Object.values(mediaStore.statuses).filter((s) => normalizePubkey(s.pubkey) === pk)
})

const userReviews = computed(() => {
  const pk = pubkey.value
  if (!pk) return []
  return Object.values(mediaStore.ratings)
    .filter((r) => normalizePubkey(r.pubkey) === pk && r.content && r.content.trim())
    .sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0))
})

async function loadUser() {
  const pk = pubkey.value
  if (!pk) {
    error.value = 'Invalid Nostr identity.'
    return
  }
  error.value = ''
  loading.value = true
  try {
    const events = await nostrClient.queryEvents(
      {
        authors: [pk],
        kinds: [KINDS.RATING, KINDS.STATUS, KINDS.SIMILAR_SUGGESTION],
        limit: 200,
      },
      undefined,
      5000
    )
    if (events?.length) {
      for (const evt of events) mediaStore.ingestEvent?.(evt)
    }
    try {
      profile.value = await nostrClient.fetchProfile(pk)
    } catch {}
  } catch (err) {
    error.value = err?.message || 'Failed to load profile.'
  } finally {
    loading.value = false
  }
}

onMounted(loadUser)
watch(pubkey, loadUser)
</script>

<template>
  <main class="profile-view">
    <header v-if="pubkey">
      <h1>{{ profile?.display_name || profile?.name || `${pubkey.slice(0, 8)}…${pubkey.slice(-4)}` }}</h1>
      <code>{{ pubkey }}</code>
    </header>
    <p v-if="loading">Loading…</p>
    <p v-if="error" class="error">{{ error }}</p>
    <section v-if="!loading && !error">
      <h2>Tracked ({{ userStatuses.length }})</h2>
      <div class="grid">
        <MediaCard v-for="s in userStatuses" :key="`${s.pubkey}:${s.dTag}`" :media="s.media" />
      </div>
      <h2>Reviews ({{ userReviews.length }})</h2>
      <article v-for="r in userReviews" :key="r.eventId" class="review">
        <strong>{{ r.media?.name || r.media?.title }}</strong>
        <span v-if="r.rating"> — {{ r.rating }}/10</span>
        <p>{{ r.content }}</p>
      </article>
    </section>
  </main>
</template>

<style scoped>
.profile-view {
  padding: 1.5rem;
  max-width: 960px;
  margin: 0 auto;
}
.grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(160px, 1fr));
  gap: 1rem;
}
.review {
  border-top: 1px solid var(--border, #333);
  padding: 0.75rem 0;
}
.error {
  color: #f66;
}
</style>
