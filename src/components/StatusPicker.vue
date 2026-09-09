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
  gap: 8px;
  align-items: center;
}

.status-pill-btn {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 6px 14px;
  font-size: 0.84rem;
  font-weight: 600;
  border-radius: var(--radius-full);
  background: var(--bg-surface);
  border: 1px solid var(--border-subtle);
  color: var(--text-secondary);
  cursor: pointer;
  transition: all 0.25s var(--ease-spring);
  user-select: none;
}

.status-pill-btn:hover {
  border-color: var(--border-hover);
  color: var(--text-main);
  transform: translateY(-2px);
  background: var(--bg-card-hover);
}

.status-pill-btn:active {
  transform: scale(0.95);
}

.pill-icon {
  font-size: 0.95rem;
  line-height: 1;
}

/* Dynamic Active States with Spring Glow */
.status-pill-btn.is-active {
  color: #fff;
  transform: scale(1.04);
}

.status-pill-btn.is-active.pill-completed {
  background: linear-gradient(135deg, #10b981, #059669);
  border-color: #10b981;
  box-shadow: 0 4px 14px rgba(16, 185, 129, 0.45);
}

.status-pill-btn.is-active.pill-watching,
.status-pill-btn.is-active.pill-listening {
  background: linear-gradient(135deg, #0ea5e9, #0284c7);
  border-color: #0ea5e9;
  box-shadow: 0 4px 14px rgba(14, 165, 233, 0.45);
}

.status-pill-btn.is-active.pill-plan-to-watch,
.status-pill-btn.is-active.pill-plan-to-listen {
  background: linear-gradient(135deg, var(--primary), #7c3aed);
  border-color: var(--primary);
  box-shadow: 0 4px 14px var(--primary-glow);
}

.status-pill-btn.is-active.pill-on-hold {
  background: linear-gradient(135deg, #f59e0b, #d97706);
  border-color: #f59e0b;
  box-shadow: 0 4px 14px rgba(245, 158, 11, 0.45);
}

.status-pill-btn.is-active.pill-dropped {
  background: linear-gradient(135deg, #f43f5e, #e11d48);
  border-color: #f43f5e;
  box-shadow: 0 4px 14px rgba(244, 63, 94, 0.45);
}
</style>
