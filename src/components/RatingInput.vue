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
  gap: 3px;
}

.star-btn {
  background: none;
  border: none;
  font-size: 1.35rem;
  line-height: 1;
  color: var(--border-hover);
  cursor: pointer;
  padding: 3px;
  transition: transform 0.2s var(--ease-bounce), color 0.15s ease, filter 0.2s ease;
  user-select: none;
}

.star-btn:not(.is-readonly):hover {
  transform: scale(1.35) rotate(-6deg);
  color: var(--accent-amber);
  filter: drop-shadow(0 0 6px rgba(245, 158, 11, 0.6));
}

.star-btn:not(.is-readonly):active {
  transform: scale(0.9) rotate(4deg);
}

.star-btn.is-filled {
  color: var(--accent-amber);
  filter: drop-shadow(0 0 3px rgba(245, 158, 11, 0.35));
}

.star-btn.is-half {
  background: linear-gradient(90deg, var(--accent-amber) 50%, var(--border-hover) 50%);
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
  min-width: 60px;
}

.rating-value {
  font-weight: 800;
  font-size: 1rem;
  color: var(--accent-amber);
  display: inline-flex;
  align-items: baseline;
  padding: 2px 8px;
  border-radius: var(--radius-xs);
  background: rgba(245, 158, 11, 0.12);
  border: 1px solid rgba(245, 158, 11, 0.3);
  box-shadow: 0 0 12px rgba(245, 158, 11, 0.2);
  transition: all 0.2s var(--ease-spring);
}

.rating-value.is-hovered {
  transform: scale(1.08);
  box-shadow: 0 0 18px rgba(245, 158, 11, 0.4);
}

.rating-max {
  font-size: 0.75rem;
  color: rgba(245, 158, 11, 0.7);
  font-weight: 500;
  margin-left: 2px;
}

.rating-empty {
  font-size: 0.82rem;
  color: var(--text-muted);
}
</style>
