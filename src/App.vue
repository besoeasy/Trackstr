<script setup>
import { ref, onMounted, onUnmounted } from 'vue'
import Navbar from '@/components/Navbar.vue'
import { useSettingsStore } from '@/stores/settings.js'

const settingsStore = useSettingsStore()
const isSigningActive = ref(false)
const signingKind = ref(null)

function onSigningEvent(e) {
  isSigningActive.value = !!e.detail?.active
  signingKind.value = e.detail?.kind || null
}

onMounted(() => {
  document.documentElement.setAttribute('data-theme', settingsStore.theme)
  window.addEventListener('trackstr:signing', onSigningEvent)
})

onUnmounted(() => {
  window.removeEventListener('trackstr:signing', onSigningEvent)
})
</script>

<template>
  <div class="app-container">
    <Navbar />

    <!-- Active Extension Signing Prompt -->
    <transition name="slide">
      <div v-if="isSigningActive" class="signing-banner">
        <span class="signing-pulse">⚡</span>
        <div class="signing-text">
          <strong>Extension Approval Required:</strong> Please check your browser extension (e.g. Alby, nos2x icon in your toolbar) to approve signing event
          <span v-if="signingKind" class="kind-tag">Kind {{ signingKind }}</span>.
        </div>
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
