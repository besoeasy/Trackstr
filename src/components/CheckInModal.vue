<script setup>
import { ref } from 'vue'
import { useMediaStore } from '@/stores/media.js'

const props = defineProps({
  media: {
    type: Object,
    required: true,
  },
})

const emit = defineEmits(['close', 'logged'])

const mediaStore = useMediaStore()

const status = ref(props.media.type === 'music' ? 'listening' : 'watching')
const progress = ref('')
const note = ref('')
const isSubmitting = ref(false)
const errorMsg = ref('')

async function handleSubmit() {
  isSubmitting.value = true
  errorMsg.value = ''

  try {
    await mediaStore.setStatus(props.media, status.value, progress.value, note.value)
    emit('logged')
    emit('close')
  } catch (err) {
    console.error('Check-in failed:', err)
    errorMsg.value = err.message || 'Failed to log check-in to Nostr.'
  } finally {
    isSubmitting.value = false
  }
}
</script>

<template>
  <div class="modal-overlay" @click.self="$emit('close')">
    <div class="modal-dialog">
      <div class="modal-header">
        <h2 class="modal-title">Log Check-in / Scrobble</h2>
        <button class="btn btn-icon" type="button" @click="$emit('close')">✕</button>
      </div>

      <div class="modal-body">
        <div v-if="errorMsg" class="badge badge-danger error-banner">
          {{ errorMsg }}
        </div>

        <div class="form-group">
          <label class="form-label">Activity</label>
          <select v-model="status" class="select">
            <option v-if="media.type === 'music'" value="listening">Listening Now</option>
            <option v-if="media.type === 'music'" value="completed">Finished Album / Track</option>
            <option v-if="media.type !== 'music'" value="watching">Watching Now</option>
            <option v-if="media.type !== 'music'" value="completed">Finished Watching</option>
          </select>
        </div>

        <div v-if="media.type === 'show'" class="form-group">
          <label class="form-label">Progress (e.g. S01E03)</label>
          <input v-model="progress" type="text" class="input" placeholder="e.g. S01E03" />
        </div>

        <div class="form-group">
          <label class="form-label">Note / Timestamp (Optional)</label>
          <input v-model="note" type="text" class="input" placeholder="e.g. Rewatched in 4K" />
        </div>

        <p class="form-hint">
          Emits both a Mutable Status update (Kind 35402) and an Immutable historical check-in log (Kind 5402).
        </p>
      </div>

      <div class="modal-footer">
        <button class="btn btn-secondary" type="button" :disabled="isSubmitting" @click="$emit('close')">
          Cancel
        </button>
        <button class="btn btn-primary" type="button" :disabled="isSubmitting" @click="handleSubmit">
          {{ isSubmitting ? 'Logging...' : 'Sign & Log Check-in' }}
        </button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.error-banner {
  display: block;
  padding: 8px 12px;
  margin-bottom: 14px;
}
</style>
