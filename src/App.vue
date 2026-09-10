<script setup>
import { ref, computed, onMounted, onUnmounted } from 'vue'
import Navbar from '@/components/Navbar.vue'
import { useSettingsStore } from '@/stores/settings.js'
import { isSafeHttpUrl } from '@/utils/urls.js'

const settingsStore = useSettingsStore()
const isActionActive = ref(false)
const actionInfo = ref({
  type: 'sign',
  title: 'Extension Action Required',
  message: 'Please check your browser extension to continue.',
  kind: null,
})
// Auth URLs originate from remote signers/relays — never bind them blindly.
const safeAuthUrl = computed(() =>
  isSafeHttpUrl(actionInfo.value.authUrl) ? actionInfo.value.authUrl : ''
)

function onExtensionAction(e) {
  if (!e.detail) return
  isActionActive.value = !!e.detail.active
  if (e.detail.active) {
    actionInfo.value = {
      type: e.detail.type || 'sign',
      title: e.detail.title || 'Extension Action Required',
      message: e.detail.message || 'Please check your browser extension to continue.',
      kind: e.detail.kind || null,
      authUrl: e.detail.authUrl || null,
    }
  }
}

onMounted(() => {
  document.documentElement.setAttribute('data-theme', settingsStore.theme)
  window.addEventListener('trackstr:extension-action', onExtensionAction)
})

onUnmounted(() => {
  window.removeEventListener('trackstr:extension-action', onExtensionAction)
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
          <a
            v-if="safeAuthUrl"
            :href="safeAuthUrl"
            target="_blank"
            rel="noopener noreferrer"
            class="banner-auth-link"
          >
            Open Authorization ↗
          </a>
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
      <router-view v-slot="{ Component }">
        <transition name="page" mode="out-in">
          <component :is="Component" />
        </transition>
      </router-view>
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
  background: #0a0a0a;
  border: 1px solid #333333;
  box-shadow: var(--shadow-lg);
  border-radius: var(--radius-sm);
  padding: 14px 20px;
  display: flex;
  align-items: center;
  gap: 12px;
  max-width: 620px;
  width: calc(100% - 40px);
  font-size: 0.88rem;
}

@media (max-width: 768px) {
  .signing-banner {
    bottom: calc(72px + var(--safe-bottom, 0px));
    width: calc(100% - 24px);
    padding: 10px 14px;
  }
}

.signing-pulse {
  font-size: 1.2rem;
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
  line-height: 1.4;
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
  background: #141414;
  color: #ededed;
  border: 1px solid #333333;
  padding: 1px 6px;
  border-radius: 4px;
  font-size: 0.75rem;
}

.banner-auth-link {
  display: inline-block;
  margin-top: 6px;
  background: #ffffff;
  color: #000000;
  padding: 4px 10px;
  border-radius: var(--radius-xs);
  font-size: 0.8rem;
  font-weight: 500;
  text-decoration: none;
  transition: opacity var(--transition-fast);
}

.banner-auth-link:hover {
  opacity: 0.85;
}

.slide-enter-active,
.slide-leave-active {
  transition: all 0.2s ease;
}

.slide-enter-from,
.slide-leave-to {
  opacity: 0;
  transform: translate(-50%, 16px);
}
</style>
