<script setup>
import { computed } from 'vue'
import { useRouter } from 'vue-router'
import { resolveIpfsUrl } from '@/services/originless.js'
import { useMediaStore } from '@/stores/media.js'
import { formatStatus, getStatusColorClass } from '@/utils/formatters.js'

const props = defineProps({
  media: {
    type: Object,
    required: true,
  },
})

const router = useRouter()
const mediaStore = useMediaStore()

const resolvedPoster = computed(() => {
  if (!props.media.poster) {
    // Check if community metadata has poster for this contentId
    const meta = mediaStore.getMediaMetadata(props.media.contentId)
    if (meta?.poster) {
      return resolveIpfsUrl(meta.poster)
    }
    return ''
  }
  return resolveIpfsUrl(props.media.poster)
})

const userStatus = computed(() => {
  if (!props.media.contentId) return null
  return mediaStore.getMediaStatus(props.media.contentId)
})

const userRating = computed(() => {
  if (!props.media.contentId) return null
  return mediaStore.getMediaRating(props.media.contentId)
})

function navigateToDetail() {
  if (props.media.contentId) {
    mediaStore.cacheMediaItem(props.media)
    router.push({
      name: 'media-detail',
      params: { contentId: props.media.contentId },
      query: {
        type: props.media.type,
        title: props.media.title || props.media.name,
        year: props.media.year,
        artist: props.media.artist,
      },
    })
  }
}
</script>

<template>
  <div class="media-card" @click="navigateToDetail">
    <div class="media-poster-wrap">
      <img
        v-if="resolvedPoster"
        :src="resolvedPoster"
        :alt="media.title || media.name"
        class="media-poster"
        loading="lazy"
        @error="$event.target.style.display = 'none'"
      />
      <div v-else class="media-poster-fallback">
        <span v-if="media.type === 'movie'">🎬</span>
        <span v-else-if="media.type === 'show'">📺</span>
        <span v-else>🎵</span>
      </div>

      <span class="badge badge-primary media-type-tag">
        {{ media.type }}
      </span>

      <span v-if="media.voteAverage" class="card-vote-badge">
        ★ {{ media.voteAverage }}
      </span>

      <span v-if="userStatus" class="badge media-status-tag" :class="getStatusColorClass(userStatus.status)">
        {{ formatStatus(userStatus.status) }}
      </span>
    </div>

    <div class="media-card-body">
      <h3 class="media-title" :title="media.title || media.name">
        {{ media.title || media.name }}
      </h3>
      <div class="media-meta">
        <span v-if="media.artist" class="media-artist">{{ media.artist }}</span>
        <span v-else-if="media.year" class="media-year">{{ media.year }}</span>

        <div v-if="userRating" class="rating-stars" :title="`Your rating: ${userRating}/10`">
          ★ <span class="rating-score">{{ userRating }}</span>
        </div>

        <div v-else-if="media.sources && media.sources.length > 0" class="card-sources">
          <span v-for="src in media.sources" :key="src" class="source-chip">{{ src }}</span>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.media-status-tag {
  position: absolute;
  bottom: 8px;
  right: 8px;
  z-index: 2;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.4);
  animation: popIn 0.3s var(--ease-spring);
}

@keyframes popIn {
  from {
    opacity: 0;
    transform: scale(0.7);
  }
  to {
    opacity: 1;
    transform: scale(1);
  }
}

.media-artist {
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  max-width: 110px;
}

.card-vote-badge {
  position: absolute;
  top: 8px;
  right: 8px;
  z-index: 2;
  font-size: 0.72rem;
  font-weight: 700;
  background: rgba(15, 17, 26, 0.88);
  backdrop-filter: blur(6px);
  -webkit-backdrop-filter: blur(6px);
  color: var(--accent-amber);
  border: 1px solid rgba(245, 158, 11, 0.35);
  padding: 2px 7px;
  border-radius: var(--radius-xs);
  transition: transform 0.2s var(--ease-spring);
}

.media-card:hover .card-vote-badge {
  transform: scale(1.08);
}

.media-card:hover .media-title {
  color: var(--primary);
  transition: color 0.2s ease;
}

.card-sources {
  display: flex;
  gap: 4px;
  flex-wrap: wrap;
}

.source-chip {
  font-size: 0.65rem;
  padding: 2px 6px;
  border-radius: 4px;
  background: var(--bg-surface);
  color: var(--accent-sky);
  border: 1px solid var(--border-subtle);
  transition: transform 0.2s var(--ease-spring), border-color 0.2s ease;
}

.media-card:hover .source-chip {
  border-color: rgba(14, 165, 233, 0.35);
  transform: translateY(-1px);
}

.media-card:active {
  transform: scale(0.97);
}

@media (max-width: 640px) {
  .media-card-body {
    padding: 10px;
  }

  .media-title {
    font-size: 0.88rem;
    line-height: 1.25;
  }

  .media-meta {
    font-size: 0.75rem;
  }
}
</style>
