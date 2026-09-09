<script setup>
import { ref } from 'vue'
import { useRouter } from 'vue-router'
import { useAuthStore } from '@/stores/auth.js'
import { useSettingsStore } from '@/stores/settings.js'
import SettingsModal from './SettingsModal.vue'
import DebugModal from './DebugModal.vue'

const router = useRouter()
const authStore = useAuthStore()
const settingsStore = useSettingsStore()

const showSettings = ref(false)
const showDebug = ref(false)
const showUserMenu = ref(false)

async function handleLogin() {
  try {
    await authStore.loginWithExtension()
  } catch (err) {
    // Open debug diagnostics modal automatically on failure so the user sees exactly what went wrong
    showDebug.value = true
  }
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
        <div class="brand-icon">T</div>
        <span>Trackstr</span>
      </router-link>

      <nav class="nav-links">
        <router-link to="/" class="nav-link">Explore</router-link>
        <router-link to="/search" class="nav-link">Search</router-link>
        <router-link v-if="authStore.isAuthenticated" to="/library" class="nav-link">
          My Library
        </router-link>
        <router-link to="/activity" class="nav-link">Activity</router-link>
      </nav>

      <div class="nav-actions">
        <!-- Debug Diagnostics -->
        <button
          class="btn btn-icon"
          type="button"
          title="Extension & Network Diagnostics (Debug Logs)"
          @click="showDebug = true"
        >
          🐞
        </button>

        <!-- Theme toggle -->
        <button
          class="btn btn-icon"
          type="button"
          :title="`Switch to ${settingsStore.theme === 'dark' ? 'light' : 'dark'} mode`"
          @click="settingsStore.toggleTheme"
        >
          <span v-if="settingsStore.theme === 'dark'">☀️</span>
          <span v-else>🌙</span>
        </button>

        <!-- Settings -->
        <button
          class="btn btn-icon"
          type="button"
          title="Network & Settings"
          @click="showSettings = true"
        >
          ⚙️
        </button>

        <!-- Extension Auth -->
        <template v-if="!authStore.isAuthenticated">
          <button
            class="btn btn-primary"
            type="button"
            :disabled="authStore.isLoggingIn"
            @click="handleLogin"
          >
            <span>⚡</span>
            <span>{{ authStore.isLoggingIn ? 'Connecting...' : 'Connect Nostr' }}</span>
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
                v-if="authStore.avatarUrl"
                :src="authStore.avatarUrl"
                class="user-avatar"
                alt="Avatar"
              />
              <div v-else class="user-avatar-placeholder">
                {{ authStore.displayName.slice(0, 1).toUpperCase() }}
              </div>
              <span class="user-name">{{ authStore.displayName }}</span>
            </button>

            <div v-if="showUserMenu" class="user-dropdown">
              <div class="dropdown-header">
                <span class="dropdown-npub">{{ authStore.npub }}</span>
              </div>
              <router-link to="/library" class="dropdown-item" @click="showUserMenu = false">
                📚 My Library
              </router-link>
              <button class="dropdown-item dropdown-logout" type="button" @click="handleLogout">
                🚪 Log Out
              </button>
            </div>
          </div>
        </template>
      </div>
    </div>
  </header>

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
  border-radius: var(--radius-full);
  padding: 4px 12px 4px 4px;
  cursor: pointer;
  color: var(--text-main);
  transition: border-color var(--transition-fast);
}

.user-btn:hover {
  border-color: var(--border-hover);
}

.user-avatar {
  width: 28px;
  height: 28px;
  border-radius: 50%;
  object-fit: cover;
}

.user-avatar-placeholder {
  width: 28px;
  height: 28px;
  border-radius: 50%;
  background: var(--primary);
  color: #fff;
  display: flex;
  align-items: center;
  justify-content: center;
  font-weight: 700;
  font-size: 0.8rem;
}

.user-name {
  font-size: 0.88rem;
  font-weight: 500;
  max-width: 120px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.user-dropdown {
  position: absolute;
  top: calc(100% + 8px);
  right: 0;
  width: 220px;
  background: var(--bg-surface);
  border: 1px solid var(--border-subtle);
  border-radius: var(--radius-md);
  box-shadow: var(--shadow-lg);
  z-index: 60;
  padding: 8px 0;
}

.dropdown-header {
  padding: 8px 14px;
  border-bottom: 1px solid var(--border-subtle);
  margin-bottom: 4px;
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
  font-size: 0.88rem;
  color: var(--text-secondary);
  background: none;
  border: none;
  cursor: pointer;
  text-align: left;
  transition: all var(--transition-fast);
}

.dropdown-item:hover {
  background: var(--primary-light);
  color: var(--text-main);
}

.dropdown-logout {
  color: var(--accent-rose);
  border-top: 1px solid var(--border-subtle);
  margin-top: 4px;
  padding-top: 10px;
}
</style>
