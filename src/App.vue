<script setup>
import { ref, onMounted, onUnmounted } from 'vue'
import Navbar from '@/components/Navbar.vue'
import { useSettingsStore } from '@/stores/settings.js'

const settingsStore = useSettingsStore()
const isActionActive = ref(false)
const actionInfo = ref({
  type: 'sign',
  title: 'Extension Action Required',
  message: 'Please check your browser extension to continue.',
  kind: null,
})

function onExtensionAction(e) {
  if (!e.detail) return
  isActionActive.value = !!e.detail.active
  if (e.detail.active) {
    actionInfo.value = {
      type: e.detail.type || 'sign',
      title: e.detail.title || 'Extension Action Required',
      message: e.detail.message || 'Please check your browser extension to continue.',
      kind: e.detail.kind || null,
    }
  }
}

function onSigningLegacy(e) {
  if (!e.detail) return
  if (!isActionActive.value && e.detail.active) {
    isActionActive.value = true
    actionInfo.value = {
      type: 'sign',
      title: 'Approve Event Signature',
      message: 'Please check your browser extension (e.g. Alby, nos2x icon in your toolbar) to approve signing.',
      kind: e.detail.kind || null,
    }
  } else if (!e.detail.active) {
    isActionActive.value = false
  }
}

onMounted(() => {
  document.documentElement.setAttribute('data-theme', settingsStore.theme)
  window.addEventListener('trackstr:extension-action', onExtensionAction)
  window.addEventListener('trackstr:signing', onSigningLegacy)
})

onUnmounted(() => {
  window.removeEventListener('trackstr:extension-action', onExtensionAction)
  window.removeEventListener('trackstr:signing', onSigningLegacy)
})
</script>

<template>
  <div class="app-container">
    <Navbar />

    <!-- Active Extension Prompt Banner -->
    <transition name="slide">
      <div v-if="isActionActive" class="signing-banner">
        <span class="signing-pulse">⚡</span>
        <div class="signing-text">
          <div class="signing-head">
            <strong>{{ actionInfo.title }}</strong>
            <span v-if="actionInfo.kind" class="kind-tag">Kind {{ actionInfo.kind }}</span>
          </div>
          <div class="signing-desc">{{ actionInfo.message }}</div>
        </div>
        <button
          class="btn-banner-dismiss"
          type="button"
          title="Dismiss banner"
          @click="isActionActive = false"
        >
          ✕
        </button>
      </div>
    </transition>

    <main class="main-content">
      <router-view />
    </main>
  </div>
</template>

<style scoped>
.signing-banner {
  position: fixed;
  bottom: 24px;
  left: 50%;
  transform: translateX(-50%);
  z-index: 999;
  background: var(--bg-surface);
  border: 2px solid var(--primary);
  box-shadow: 0 0 24px var(--primary-glow), var(--shadow-lg);
  border-radius: var(--radius-md);
  padding: 14px 20px;
  display: flex;
  align-items: center;
  gap: 12px;
  max-width: 620px;
  width: calc(100% - 40px);
  font-size: 0.9rem;
}

.signing-pulse {
  font-size: 1.4rem;
  animation: pulse 1s infinite alternate;
}

.signing-text {
  color: var(--text-main);
  line-height: 1.4;
  flex: 1;
}

.signing-head {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 2px;
}

.signing-desc {
  font-size: 0.82rem;
  color: var(--text-secondary);
  line-height: 1.35;
}

.btn-banner-dismiss {
  background: none;
  border: none;
  color: var(--text-muted);
  cursor: pointer;
  padding: 4px 8px;
  font-size: 1rem;
  line-height: 1;
  border-radius: var(--radius-xs);
  transition: color var(--transition-fast);
}

.btn-banner-dismiss:hover {
  color: var(--text-main);
}

.kind-tag {
  font-family: var(--font-mono);
  background: var(--primary-light);
  color: var(--primary);
  padding: 2px 6px;
  border-radius: 4px;
  font-size: 0.8rem;
}

.slide-enter-active,
.slide-leave-active {
  transition: all 0.25s ease;
}

.slide-enter-from,
.slide-leave-to {
  opacity: 0;
  transform: translate(-50%, 20px);
}

@keyframes pulse {
  from {
    transform: scale(0.9);
  }
  to {
    transform: scale(1.15);
  }
}
</style>
