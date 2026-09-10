<script setup>
import { computed } from 'vue'
import { useRouter } from 'vue-router'
import { useIpfsImage } from '@/composables/useIpfsImage.js'
import { useMediaStore } from '@/stores/media.js'

const props = defineProps({
  item: {
    type: Object,
    required: true,
  },
})

const router = useRouter()
const mediaStore = useMediaStore()

const isEpisode = computed(() => props.item.type === 'episode' && props.item.season && props.item.episode)

const { src: resolvedPoster, onError: onPosterError } = useIpfsImage(() => {
  if (props.item.poster) return props.item.poster
  return mediaStore.getMediaMetadata(props.item.contentId)?.poster || ''
})

const reasonLabel = computed(() => {
  if (props.item.reason) return props.item.reason
  if (props.item.category === 'missed-episode') return 'Continue watching'
  if (props.item.category === 'unwatched') return 'Popular'
  return 'Random pick'
})

const reasonClass = computed(() => {
  if (props.item.category === 'missed-episode') return 'rec-reason-continue'
  if (props.item.category === 'unwatched') return 'rec-reason-popular'
  return 'rec-reason-random'
})

function navigateToDetail() {
  if (!props.item.contentId) return
  mediaStore.cacheMediaItem(props.item)
  router.push({
    name: 'media-detail',
    params: { contentId: props.item.contentId },
    query: {
      type: isEpisode.value ? 'show' : props.item.type,
      title: props.item.showTitle || props.item.title || props.item.name,
      year: props.item.year,
      artist: props.item.artist,
    },
  })
}
</script>

<template>
  <div class="rec-card" @click="navigateToDetail">
    <div class="rec-poster-wrap">
      <img
        v-if="resolvedPoster"
        :src="resolvedPoster"
        :alt="item.title || item.name"
        class="rec-poster"
        loading="lazy"
        @error="onPosterError"
      />
      <div v-else class="rec-poster-fallback">
        <span v-if="item.type === 'movie'">🎬</span>
        <span v-else-if="item.type === 'show' || isEpisode">📺</span>
        <span v-else>🎵</span>
      </div>

      <span class="badge rec-reason-badge" :class="reasonClass">{{ reasonLabel }}</span>
      <span v-if="isEpisode" class="rec-episode-tag">S{{ item.season }}E{{ item.episode }}</span>
    </div>

    <div class="rec-card-body">
      <h3 class="rec-title" :title="item.title || item.name">
        {{ item.title || item.name }}
      </h3>
      <div class="rec-meta">
        <span v-if="item.artist" class="rec-artist">{{ item.artist }}</span>
        <span v-else-if="item.year" class="rec-year">{{ item.year }}</span>
        <span v-if="isEpisode && item.episodeName" class="rec-episode-name">{{ item.episodeName }}</span>
      </div>
    </div>
  </div>
</template>

<style scoped>
.rec-card {
  flex-shrink: 0;
  width: 150px;
  cursor: pointer;
  border-radius: var(--radius-md);
  border: 1px solid var(--border-subtle);
  background: var(--bg-card);
  overflow: hidden;
  transition: border-color var(--transition-fast), transform var(--transition-fast);
}

.rec-card:hover {
  border-color: var(--border-hover);
  transform: translateY(-2px);
}

.rec-card:active {
  transform: scale(0.98);
}

.rec-poster-wrap {
  position: relative;
  aspect-ratio: 2 / 3;
  background: #0c0c0c;
  overflow: hidden;
}

.rec-poster {
  width: 100%;
  height: 100%;
  object-fit: cover;
  display: block;
}

.rec-poster-fallback {
  width: 100%;
  height: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 2.4rem;
  opacity: 0.5;
}

.rec-reason-badge {
  position: absolute;
  top: 8px;
  left: 8px;
  z-index: 2;
  font-size: 0.62rem;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  border-radius: var(--radius-xs);
  padding: 2px 6px;
  backdrop-filter: blur(8px);
  -webkit-backdrop-filter: blur(8px);
}

.rec-reason-continue {
  background: rgba(16, 185, 129, 0.9);
  color: #04110c;
  border: 1px solid rgba(16, 185, 129, 0.5);
}

.rec-reason-popular {
  background: rgba(245, 166, 35, 0.9);
  color: #1a1204;
  border: 1px solid rgba(245, 166, 35, 0.5);
}

.rec-reason-random {
  background: rgba(59, 130, 246, 0.9);
  color: #060f1c;
  border: 1px solid rgba(59, 130, 246, 0.5);
}

.rec-episode-tag {
  position: absolute;
  bottom: 8px;
  right: 8px;
  z-index: 2;
  font-family: var(--font-mono);
  font-size: 0.68rem;
  font-weight: 600;
  background: rgba(0, 0, 0, 0.85);
  backdrop-filter: blur(8px);
  -webkit-backdrop-filter: blur(8px);
  color: var(--accent-emerald);
  border: 1px solid rgba(16, 185, 129, 0.3);
  padding: 2px 6px;
  border-radius: var(--radius-xs);
}

.rec-card-body {
  padding: 10px 12px;
}

.rec-title {
  font-size: 0.92rem;
  font-weight: 600;
  letter-spacing: -0.02em;
  line-height: 1.3;
  color: var(--text-main);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.rec-card:hover .rec-title {
  color: #ffffff;
}

[data-theme='light'] .rec-card:hover .rec-title {
  color: #000000;
}

.rec-meta {
  display: flex;
  align-items: center;
  gap: 6px;
  margin-top: 4px;
  font-size: 0.75rem;
  color: var(--text-muted);
  min-width: 0;
}

.rec-artist {
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  max-width: 110px;
}

.rec-episode-name {
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  color: var(--accent-emerald);
  font-size: 0.72rem;
}

@media (max-width: 640px) {
  .rec-card {
    width: 130px;
  }

  .rec-card-body {
    padding: 8px 10px;
  }

  .rec-title {
    font-size: 0.85rem;
  }

  .rec-meta {
    font-size: 0.7rem;
  }
}
</style>