<script setup>
import { ref, computed } from 'vue'

const props = defineProps({
  modelValue: {
    type: [Number, String],
    default: null,
  },
  readonly: {
    type: Boolean,
    default: false,
  },
  max: {
    type: Number,
    default: 10,
  },
})

const emit = defineEmits(['update:modelValue', 'change'])

const hoveredStar = ref(null)

const currentRating = computed(() => {
  if (props.modelValue === null || props.modelValue === undefined || props.modelValue === '') {
    return null
  }
  return Number(props.modelValue)
})

const displayRating = computed(() => {
  if (hoveredStar.value !== null) return hoveredStar.value
  return currentRating.value
})

function ratingForClick(star, event) {
  // Left half of a star = half-step (spec allows 8.5-style values).
  const el = event?.currentTarget
  if (el && typeof event?.clientX === 'number' && el.getBoundingClientRect) {
    const rect = el.getBoundingClientRect()
    if (rect.width > 0 && event.clientX - rect.left < rect.width / 2) {
      return star - 0.5
    }
  }
  return star
}

function setRating(star, event) {
  if (props.readonly) return
  const val = ratingForClick(star, event)
  const newRating = currentRating.value === val ? null : val
  emit('update:modelValue', newRating)
  emit('change', newRating)
}

function onHover(star) {
  if (props.readonly) return
  hoveredStar.value = star
}

function onLeave() {
  hoveredStar.value = null
}
</script>

<template>
  <div class="rating-input-container">
    <div class="stars-row" @mouseleave="onLeave">
      <button
        v-for="star in max"
        :key="star"
        type="button"
        class="star-btn"
        :class="{
          'is-filled': displayRating !== null && star <= displayRating,
          'is-half': displayRating !== null && star - 0.5 === displayRating,
          'is-preview': hoveredStar !== null && star <= hoveredStar && (currentRating === null || star > currentRating),
          'is-readonly': readonly,
        }"
        :title="`${star} / ${max}`"
        @mouseenter="onHover(star)"
        @click="setRating(star, $event)"
      >
        ★
      </button>
    </div>

    <div class="score-badge-wrap">
      <span v-if="displayRating !== null" class="rating-value" :class="{ 'is-hovered': hoveredStar !== null }">
        {{ displayRating }}<span class="rating-max">/{{ max }}</span>
      </span>
      <span v-else class="rating-empty">Unrated</span>
    </div>
  </div>
</template>

<style scoped>
.rating-input-container {
  display: inline-flex;
  align-items: center;
  gap: 12px;
}

.stars-row {
  display: inline-flex;
  gap: 2px;
}

.star-btn {
  background: none;
  border: none;
  font-size: 1.3rem;
  line-height: 1;
  color: #333333;
  cursor: pointer;
  padding: 3px;
  transition: transform 0.15s ease, color 0.15s ease;
  user-select: none;
}

.star-btn:not(.is-readonly):hover {
  transform: scale(1.15);
  color: var(--accent-amber);
}

.star-btn:not(.is-readonly):active {
  transform: scale(0.95);
}

.star-btn.is-filled {
  color: var(--accent-amber);
}

.star-btn.is-half {
  background: linear-gradient(90deg, var(--accent-amber) 50%, #333333 50%);
  -webkit-background-clip: text;
  background-clip: text;
  color: transparent;
}

.star-btn.is-preview {
  opacity: 0.85;
}

.star-btn.is-readonly {
  cursor: default;
}

.score-badge-wrap {
  min-width: 54px;
}

.rating-value {
  font-family: var(--font-mono);
  font-weight: 600;
  font-size: 0.88rem;
  color: var(--accent-amber);
  display: inline-flex;
  align-items: baseline;
  padding: 2px 7px;
  border-radius: var(--radius-xs);
  background: #111111;
  border: 1px solid #262626;
}

.rating-max {
  font-size: 0.72rem;
  color: var(--text-muted);
  font-weight: 400;
  margin-left: 2px;
}

.rating-empty {
  font-family: var(--font-mono);
  font-size: 0.78rem;
  color: var(--text-muted);
}

@media (max-width: 640px) {
  .rating-input-container {
    flex-wrap: nowrap;
    gap: 8px;
    max-width: 100%;
    align-items: center;
  }

  .stars-row {
    gap: 0px;
    flex-shrink: 0;
  }

  .star-btn {
    font-size: 1.25rem;
    padding: 3px 2px;
  }
}

@media (max-width: 380px) {
  .star-btn {
    font-size: 1.12rem;
    padding: 2px 1px;
  }

  .score-badge-wrap {
    min-width: 44px;
  }

  .rating-value {
    font-size: 0.8rem;
    padding: 2px 4px;
  }
}
</style>
