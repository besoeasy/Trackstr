<script setup>
import { computed } from 'vue'

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

const currentRating = computed(() => {
  if (props.modelValue === null || props.modelValue === undefined || props.modelValue === '') {
    return null
  }
  return Number(props.modelValue)
})

function setRating(val) {
  if (props.readonly) return
  const newRating = currentRating.value === val ? null : val
  emit('update:modelValue', newRating)
  emit('change', newRating)
}
</script>

<template>
  <div class="rating-input-container">
    <div class="stars-row">
      <button
        v-for="star in max"
        :key="star"
        type="button"
        class="star-btn"
        :class="{ 'is-filled': currentRating !== null && star <= currentRating, 'is-readonly': readonly }"
        :title="`${star} / ${max}`"
        @click="setRating(star)"
      >
        ★
      </button>
    </div>
    <span v-if="currentRating !== null" class="rating-value">
      {{ currentRating }}<span class="rating-max">/{{ max }}</span>
    </span>
    <span v-else class="rating-empty">Unrated</span>
  </div>
</template>

<style scoped>
.rating-input-container {
  display: inline-flex;
  align-items: center;
  gap: 8px;
}

.stars-row {
  display: inline-flex;
  gap: 2px;
}

.star-btn {
  background: none;
  border: none;
  font-size: 1.25rem;
  line-height: 1;
  color: var(--border-hover);
  cursor: pointer;
  padding: 2px;
  transition: transform var(--transition-fast), color var(--transition-fast);
}

.star-btn:not(.is-readonly):hover {
  transform: scale(1.2);
  color: var(--accent-amber);
}

.star-btn.is-filled {
  color: var(--accent-amber);
}

.star-btn.is-readonly {
  cursor: default;
}

.rating-value {
  font-weight: 700;
  font-size: 0.95rem;
  color: var(--accent-amber);
}

.rating-max {
  font-size: 0.75rem;
  color: var(--text-muted);
  font-weight: 400;
}

.rating-empty {
  font-size: 0.8rem;
  color: var(--text-muted);
}
</style>
