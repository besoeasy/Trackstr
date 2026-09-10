<script setup>
import { computed } from 'vue'
import { useRouter } from 'vue-router'
import { useMediaImage } from '@/composables/useMediaImage.js'
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

const { src: resolvedPoster, onError: onPosterError } = useMediaImage(() => {
  return props.media.poster || ''
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
        @error="onPosterError"
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
  border-radius: var(--radius-xs);
  font-size: 0.68rem;
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
  font-family: var(--font-mono);
  font-size: 0.7rem;
  font-weight: 600;
  background: rgba(0, 0, 0, 0.85);
  backdrop-filter: blur(8px);
  -webkit-backdrop-filter: blur(8px);
  color: var(--accent-amber);
  border: 1px solid rgba(245, 166, 35, 0.3);
  padding: 2px 6px;
  border-radius: var(--radius-xs);
}

.media-card:hover .media-title {
  color: #ffffff;
}

[data-theme='light'] .media-card:hover .media-title {
  color: #000000;
}

.card-sources {
  display: flex;
  gap: 4px;
  flex-wrap: wrap;
}

.source-chip {
  font-family: var(--font-mono);
  font-size: 0.65rem;
  padding: 2px 6px;
  border-radius: var(--radius-xs);
  background: #111111;
  color: #888888;
  border: 1px solid #222222;
}

.media-card:active {
  transform: scale(0.99);
}

@media (max-width: 640px) {
  .media-card-body {
    padding: 8px 10px 10px;
  }

  .media-title {
    font-size: 0.86rem;
    line-height: 1.25;
    margin-bottom: 4px;
  }

  .media-meta {
    font-size: 0.72rem;
  }

  .media-artist {
    max-width: 85px;
  }
}
</style>
