<script setup>
import { ref } from 'vue'
import { useMediaStore } from '@/stores/media.js'
import { useAuthStore } from '@/stores/auth.js'
import RatingInput from './RatingInput.vue'

const props = defineProps({
  media: {
    type: Object,
    required: true,
  },
  initialRating: {
    type: [Number, String],
    default: null,
  },
})

const emit = defineEmits(['close', 'reviewed'])

const mediaStore = useMediaStore()
const authStore = useAuthStore()

const reviewBody = ref('')
const rating = ref(props.initialRating)
const containsSpoiler = ref(false)
const isSubmitting = ref(false)
const errorMsg = ref('')

async function handleSubmit() {
  if (!authStore.isAuthenticated) {
    authStore.openLoginModal()
    emit('close')
    return
  }
  if (!reviewBody.value.trim()) {
    errorMsg.value = 'Please enter your review text.'
    return
  }

  isSubmitting.value = true
  errorMsg.value = ''

  try {
    await mediaStore.addReview(props.media, reviewBody.value.trim(), {
      rating: rating.value,
      spoiler: containsSpoiler.value,
    })

    emit('reviewed')
    emit('close')
  } catch (err) {
    console.error('Failed to submit review:', err)
    errorMsg.value = err.message || 'Failed to publish review to Nostr.'
  } finally {
    isSubmitting.value = false
  }
}
</script>

<template>
  <div class="modal-overlay" @click.self="$emit('close')">
    <div class="modal-dialog">
      <div class="modal-header">
        <h2 class="modal-title">Write Review — {{ media.title || media.name }}</h2>
        <button class="btn btn-icon" type="button" @click="$emit('close')">✕</button>
      </div>

      <div class="modal-body">
        <div v-if="errorMsg" class="badge badge-danger error-banner">
          {{ errorMsg }}
        </div>

        <div class="form-group">
          <label class="form-label">Score (Optional)</label>
          <RatingInput v-model="rating" />
        </div>

        <div class="form-group">
          <label class="form-label">Review Content</label>
          <textarea
            v-model="reviewBody"
            class="textarea"
            rows="5"
            placeholder="Share your thoughts on this title..."
          ></textarea>
        </div>

        <div class="checkbox-row">
          <label class="checkbox-label">
            <input v-model="containsSpoiler" type="checkbox" />
            <span>Mark review as containing spoilers</span>
          </label>
        </div>

        <p class="form-hint">
          Published as a permanent Nostr diary log (Kind 5401) signed by your identity.
        </p>
      </div>

      <div class="modal-footer">
        <button class="btn btn-secondary" type="button" :disabled="isSubmitting" @click="$emit('close')">
          Cancel
        </button>
        <button class="btn btn-primary" type="button" :disabled="isSubmitting" @click="handleSubmit">
          {{ isSubmitting ? 'Publishing...' : 'Sign & Post Review' }}
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

.checkbox-row {
  margin: 12px 0;
}

.checkbox-label {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 0.9rem;
  color: var(--text-secondary);
  cursor: pointer;
}
</style>
