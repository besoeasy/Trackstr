<script setup>
import { ref, computed } from 'vue'
import { useRouter, useRoute } from 'vue-router'
import { useAuthStore } from '@/stores/auth.js'
import { useSettingsStore } from '@/stores/settings.js'
import { safeMediaUrl } from '@/utils/urls.js'
import SettingsModal from './SettingsModal.vue'
import DebugModal from './DebugModal.vue'
import LoginModal from './LoginModal.vue'
import AddMediaModal from './AddMediaModal.vue'

const router = useRouter()
const route = useRoute()
const authStore = useAuthStore()
const settingsStore = useSettingsStore()

// Kind-0 picture URLs are attacker-controlled relay data — render only if safe.
const safeAvatar = computed(() => safeMediaUrl(authStore.avatarUrl))

const showSettings = ref(false)
const showDebug = ref(false)
const showUserMenu = ref(false)
const showAddMediaModal = ref(false)

function handleTrack() {
  showAddMediaModal.value = true
}

function handleLogin() {
  authStore.openLoginModal()
}

function handleLogout() {
  authStore.logout()
  showUserMenu.value = false
  router.push('/')
}
</script>

<template>
  <header class="navbar">
    <div class="navbar-inner">
      <router-link to="/" class="brand">
        <div class="brand-icon">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
            <path d="M12 1L24 22H0L12 1Z" />
          </svg>
        </div>
        <span class="brand-text">Trackstr</span>
      </router-link>

      <nav class="nav-links">
        <router-link to="/" class="nav-link">Explore</router-link>
        <router-link v-if="authStore.isAuthenticated" to="/library" class="nav-link">
          Library
        </router-link>
        <router-link to="/activity" class="nav-link">Activity</router-link>
      </nav>

      <div class="nav-actions">
        <!-- Debug Diagnostics (desktop) -->
        <button
          class="btn btn-icon btn-desktop-only"
          type="button"
          title="Extension & Network Diagnostics (Debug Logs)"
          @click="showDebug = true"
        >
          <span style="font-size: 13px;">🐞</span>
        </button>

        <!-- Theme toggle (always available) -->
        <button
          class="btn btn-icon btn-theme-toggle"
          type="button"
          :title="`Switch to ${settingsStore.theme === 'dark' ? 'light' : 'dark'} mode`"
          @click="settingsStore.toggleTheme"
        >
          <span v-if="settingsStore.theme === 'dark'" style="font-size: 13px;">☀️</span>
          <span v-else style="font-size: 13px;">🌙</span>
        </button>

        <!-- Settings (desktop) -->
        <button
          class="btn btn-icon btn-desktop-only"
          type="button"
          title="Network & Settings"
          @click="showSettings = true"
        >
          <span style="font-size: 13px;">⚙️</span>
        </button>

        <!-- Track Media (desktop) -->
        <button
          class="btn btn-primary btn-sm btn-desktop-only"
          type="button"
          title="Track Movie, Series, or Music"
          @click="handleTrack"
        >
          <span>+ Track</span>
        </button>

        <!-- Nostr Auth (Extension or Bunker) -->
        <template v-if="!authStore.isAuthenticated">
          <button
            class="btn btn-secondary btn-sm btn-auth"
            type="button"
            :disabled="authStore.isLoggingIn"
            @click="handleLogin"
          >
            <span class="btn-auth-dot">●</span>
            <span class="btn-auth-text">{{ authStore.isLoggingIn ? 'Connecting...' : 'Connect' }}</span>
          </button>
        </template>

        <template v-else>
          <div class="user-profile-menu">
            <button
              class="user-btn"
              type="button"
              @click="showUserMenu = !showUserMenu"
            >
              <img
                v-if="safeAvatar"
                :src="safeAvatar"
                class="user-avatar"
                alt="Avatar"
              />
              <div v-else class="user-avatar-placeholder">
                {{ authStore.displayName.slice(0, 1).toUpperCase() }}
              </div>
              <span class="user-name">{{ authStore.displayName }}</span>
              <span class="auth-pill-badge" :title="authStore.authType === 'bunker' ? 'Bunker Remote Signer' : 'Extension Signer'">
                {{ authStore.authType === 'bunker' ? '⚡' : '🧩' }}
              </span>
            </button>

            <div v-if="showUserMenu" class="user-dropdown">
              <div class="dropdown-header">
                <div class="dropdown-auth-badge">
                  <span v-if="authStore.authType === 'bunker'" class="badge badge-bunker">⚡ Bunker (NIP-46)</span>
                  <span v-else class="badge badge-extension">🧩 Extension (NIP-07)</span>
                </div>
                <span class="dropdown-npub">{{ authStore.npub }}</span>
              </div>
              <router-link to="/library" class="dropdown-item" @click="showUserMenu = false">
                📚 My Library
              </router-link>
              <button class="dropdown-item" type="button" @click="showSettings = true; showUserMenu = false">
                ⚙️ Settings & Relays
              </button>
              <button class="dropdown-item" type="button" @click="showDebug = true; showUserMenu = false">
                🐞 Diagnostics Logs
              </button>
              <button class="dropdown-item dropdown-logout" type="button" @click="handleLogout">
                🚪 Log Out
              </button>
            </div>
          </div>
        </template>
      </div>
    </div>
  </header>

  <!-- Mobile Bottom Navigation Bar (Docked App Navigation) -->
  <nav class="mobile-bottom-nav" aria-label="Mobile Navigation">
    <router-link
      to="/"
      class="mobile-nav-item"
      :class="{ 'is-active': route.path === '/' && !route.query.track }"
    >
      <span class="mobile-nav-icon">🔍</span>
      <span>Explore</span>
    </router-link>

    <router-link
      v-if="authStore.isAuthenticated"
      to="/library"
      class="mobile-nav-item"
      :class="{ 'is-active': route.path === '/library' }"
    >
      <span class="mobile-nav-icon">📚</span>
      <span>Library</span>
    </router-link>
    <button
      v-else
      type="button"
      class="mobile-nav-item"
      @click="authStore.openLoginModal"
    >
      <span class="mobile-nav-icon">📚</span>
      <span>Library</span>
    </button>

    <button
      type="button"
      class="mobile-nav-item is-track-btn"
      title="Track media"
      @click="handleTrack"
    >
      <div class="mobile-nav-icon-wrap">
        <span>+</span>
      </div>
      <span>Track</span>
    </button>

    <router-link
      to="/activity"
      class="mobile-nav-item"
      :class="{ 'is-active': route.path === '/activity' }"
    >
      <span class="mobile-nav-icon">⚡</span>
      <span>Activity</span>
    </router-link>

    <button
      type="button"
      class="mobile-nav-item"
      title="Settings & Network"
      @click="showSettings = true"
    >
      <span class="mobile-nav-icon">⚙️</span>
      <span>Settings</span>
    </button>
  </nav>

  <LoginModal
    v-if="authStore.showLoginModal"
    @close="authStore.closeLoginModal"
    @open-debug="showDebug = true"
  />
  <AddMediaModal
    v-if="showAddMediaModal"
    @close="showAddMediaModal = false"
    @saved="showAddMediaModal = false"
  />
  <SettingsModal v-if="showSettings" @close="showSettings = false" />
  <DebugModal v-if="showDebug" @close="showDebug = false" />
</template>

<style scoped>
.user-profile-menu {
  position: relative;
}

.user-btn {
  display: flex;
  align-items: center;
  gap: 8px;
  background: var(--bg-surface);
  border: 1px solid var(--border-subtle);
  border-radius: var(--radius-sm);
  padding: 4px 10px 4px 4px;
  cursor: pointer;
  color: var(--text-main);
  transition: all var(--transition-fast);
}

.user-btn:hover {
  border-color: var(--border-hover);
  background: var(--bg-card-hover);
}

.user-avatar {
  width: 24px;
  height: 24px;
  border-radius: var(--radius-xs);
  object-fit: cover;
}

.user-avatar-placeholder {
  width: 24px;
  height: 24px;
  border-radius: var(--radius-xs);
  background: #ffffff;
  color: #000000;
  display: flex;
  align-items: center;
  justify-content: center;
  font-weight: 700;
  font-size: 0.75rem;
}

[data-theme='light'] .user-avatar-placeholder {
  background: #000000;
  color: #ffffff;
}

.user-name {
  font-size: 0.85rem;
  font-weight: 500;
  max-width: 120px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.user-dropdown {
  position: absolute;
  top: calc(100% + 6px);
  right: 0;
  width: 220px;
  background: #0a0a0a;
  border: 1px solid var(--border-subtle);
  border-radius: var(--radius-md);
  box-shadow: var(--shadow-lg);
  z-index: 60;
  padding: 6px 0;
}

.dropdown-header {
  padding: 8px 14px;
  border-bottom: 1px solid var(--border-subtle);
  margin-bottom: 4px;
}

.dropdown-auth-badge {
  margin-bottom: 6px;
}

.badge-bunker {
  background: #141414;
  color: var(--accent-amber);
  border: 1px solid rgba(245, 166, 35, 0.3);
  font-size: 0.68rem;
  padding: 2px 6px;
  border-radius: var(--radius-xs);
  font-weight: 500;
}

.badge-extension {
  background: #141414;
  color: #ededed;
  border: 1px solid #333333;
  font-size: 0.68rem;
  padding: 2px 6px;
  border-radius: var(--radius-xs);
  font-weight: 500;
}

.auth-pill-badge {
  font-size: 0.75rem;
  line-height: 1;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  opacity: 0.85;
}

.dropdown-npub {
  font-family: var(--font-mono);
  font-size: 0.72rem;
  color: var(--text-muted);
  word-break: break-all;
}

.dropdown-item {
  display: flex;
  align-items: center;
  width: 100%;
  padding: 8px 14px;
  font-size: 0.85rem;
  color: var(--text-secondary);
  background: none;
  border: none;
  cursor: pointer;
  text-align: left;
  transition: all var(--transition-fast);
}

.dropdown-item:hover {
  background: #171717;
  color: #ffffff;
}

.dropdown-logout {
  color: var(--accent-rose);
  border-top: 1px solid var(--border-subtle);
  margin-top: 4px;
  padding-top: 8px;
}

.btn-auth-dot {
  color: var(--accent-emerald);
  font-size: 8px;
}

@media (max-width: 768px) {
  .btn-desktop-only {
    display: none;
  }

  .nav-actions {
    gap: 8px;
  }

  .btn-auth {
    padding: 6px 12px;
    font-size: 0.82rem;
  }

  .user-name {
    display: none;
  }

  .user-btn {
    padding: 3px;
  }
}
</style>
