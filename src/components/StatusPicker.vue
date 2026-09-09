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
      { value: 'plan-to-listen', label: 'Plan to Listen' },
      { value: 'listening', label: 'Listening' },
      { value: 'completed', label: 'Completed' },
    ]
  }
  return [
    { value: 'plan-to-watch', label: 'Plan to Watch' },
    { value: 'watching', label: 'Watching' },
    { value: 'completed', label: 'Completed' },
    { value: 'on-hold', label: 'On Hold' },
    { value: 'dropped', label: 'Dropped' },
  ]
})

function onChange(e) {
  const val = e.target.value
  emit('update:modelValue', val)
  emit('change', val)
}
</script>

<template>
  <div class="status-picker">
    <select :value="modelValue" class="select select-status" @change="onChange">
      <option value="">+ Add to Library / Track</option>
      <option v-for="opt in options" :key="opt.value" :value="opt.value">
        {{ opt.label }}
      </option>
    </select>
  </div>
</template>

<style scoped>
.status-picker {
  display: inline-block;
}

.select-status {
  padding: 8px 14px;
  font-size: 0.88rem;
  font-weight: 500;
  border-radius: var(--radius-sm);
  background: var(--bg-surface);
  border: 1px solid var(--border-hover);
  color: var(--text-main);
  cursor: pointer;
}

.select-status:hover {
  border-color: var(--primary);
}
</style>
