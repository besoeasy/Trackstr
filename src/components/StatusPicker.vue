<script setup>
import { computed } from 'vue'

const props = defineProps({
  modelValue: {
    type: String,
    default: '',
  },
  mediaType: {
    type: String,
    default: 'movie',
  },
})

const emit = defineEmits(['update:modelValue', 'change'])

const options = computed(() => {
  if (props.mediaType === 'music') {
    return [
      { value: 'plan-to-listen', label: 'Plan to Listen', icon: '⏳' },
      { value: 'listening', label: 'Listening', icon: '🎧' },
      { value: 'completed', label: 'Completed', icon: '✅' },
    ]
  }
  return [
    { value: 'plan-to-watch', label: 'Plan to Watch', icon: '⏳' },
    { value: 'watching', label: 'Watching', icon: '👁️' },
    { value: 'completed', label: 'Completed', icon: '✅' },
    { value: 'on-hold', label: 'On Hold', icon: '⏸️' },
    { value: 'dropped', label: 'Dropped', icon: '✕' },
  ]
})

function selectStatus(val) {
  const newVal = props.modelValue === val ? '' : val
  emit('update:modelValue', newVal)
  emit('change', newVal)
}
</script>

<template>
  <div class="status-pills-row">
    <button
      v-for="opt in options"
      :key="opt.value"
      type="button"
      class="status-pill-btn"
      :class="[
        `pill-${opt.value}`,
        { 'is-active': modelValue === opt.value }
      ]"
      @click="selectStatus(opt.value)"
    >
      <span class="pill-icon">{{ opt.icon }}</span>
      <span class="pill-label">{{ opt.label }}</span>
    </button>
  </div>
</template>

<style scoped>
.status-pills-row {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  align-items: center;
}

.status-pill-btn {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 5px 12px;
  font-size: 0.82rem;
  font-weight: 500;
  border-radius: var(--radius-sm);
  background: #000000;
  border: 1px solid #262626;
  color: var(--text-secondary);
  cursor: pointer;
  transition: all var(--transition-fast);
  user-select: none;
}

.status-pill-btn:hover {
  border-color: #444444;
  color: var(--text-main);
  background: #111111;
}

.status-pill-btn:active {
  transform: scale(0.98);
}

.pill-icon {
  font-size: 0.85rem;
  line-height: 1;
}

/* Minimalist Active States */
.status-pill-btn.is-active {
  background: #ffffff;
  color: #000000;
  border-color: #ffffff;
  font-weight: 600;
}

[data-theme='light'] .status-pill-btn.is-active {
  background: #000000;
  color: #ffffff;
  border-color: #000000;
}

@media (max-width: 640px) {
  .status-pills-row {
    gap: 6px;
  }

  .status-pill-btn {
    padding: 6px 10px;
    font-size: 0.8rem;
  }
}
</style>
