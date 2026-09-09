<script setup>
import { ref } from 'vue'
import { useRouter } from 'vue-router'
import { useSettingsStore } from '@/stores/settings.js'
import { useAuthStore } from '@/stores/auth.js'
import { nostrClient } from '@/services/nostr/client.js'
import { DEFAULT_ORIGINLESS_INSTANCE } from '@/services/originless.js'

const router = useRouter()
const settingsStore = useSettingsStore()
const authStore = useAuthStore()

const newRelay = ref('')
const tmdbKey = ref(settingsStore.tmdbApiKey)
const originlessNode = ref(settingsStore.originlessUrl)
const hasExtension = ref(nostrClient.hasExtension())
const formError = ref('')
const saveSuccess = ref(false)

function goBack() {
  if (window.history.length > 1) {
    router.back()
  } else {
    router.push('/')
  }
}

function handleAddRelay() {
  formError.value = ''
  saveSuccess.value = false
  if (!newRelay.value.trim()) return
  if (settingsStore.addRelay(newRelay.value.trim())) {
    newRelay.value = ''
  } else {
    formError.value = settingsStore.settingsError || 'Invalid relay URL.'
  }
}

function handleSaveSettings() {
  formError.value = ''
  saveSuccess.value = false
  settingsStore.setTmdbApiKey(tmdbKey.value)
  if (!settingsStore.setOriginlessUrl(originlessNode.value)) {
    formError.value = settingsStore.settingsError || 'Invalid Originless node URL.'
    return
  }
  saveSuccess.value = true
  setTimeout(() => {
    saveSuccess.value = false
  }, 2500)
}

function resetOriginless() {
  originlessNode.value = DEFAULT_ORIGINLESS_INSTANCE
}
</script>

<template>
  <div class="settings-page-wrap">
    <div class="page-top-nav">
      <button class="btn-back" type="button" @click="goBack">
        <span class="back-arrow">‹</span>
        <span>Back</span>
      </button>
    </div>

    <div class="settings-card card">
      <header class="settings-header">
        <div class="brand-badge-row">
          <span class="settings-icon-badge">⚙️</span>
          <span class="badge badge-neutral">Preferences</span>
        </div>
        <h1 class="settings-title">Settings & Network</h1>
        <p class="settings-subtitle">
          Configure Nostr relay connections, Originless decentralized media storage, and metadata providers.
        </p>
      </header>

      <div v-if="formError" class="badge badge-danger error-banner">
        {{ formError }}
      </div>

      <div v-if="saveSuccess" class="badge badge-success success-banner">
        ✓ Settings saved successfully
      </div>

      <!-- Section: Signer Status -->
      <section class="settings-section">
        <h2 class="section-heading">Nostr Signer Status</h2>
        <div class="status-box">
          <template v-if="authStore.isAuthenticated">
            <div class="signer-header-row">
              <span v-if="authStore.authType === 'nsec'" class="badge badge-success">🔑 nsec Connected</span>
              <span v-else class="badge badge-success">🧩 Extension Connected</span>
              <router-link to="/connect" class="btn btn-secondary btn-xs">Switch Signer</router-link>
            </div>
            <p class="form-hint">
              Logged in as: <span class="contentid-chip">{{ authStore.npub }}</span>
            </p>
          </template>
          <template v-else>
            <div class="signer-header-row">
              <span v-if="hasExtension" class="badge badge-success">Extension Detected</span>
              <span v-else class="badge badge-neutral">No Signer Connected</span>
              <router-link to="/connect" class="btn btn-primary btn-xs">Connect Now</router-link>
            </div>
            <p class="form-hint">
              Connect via browser extension (Alby, nos2x), paste an nsec key, or create a disposable account.
            </p>
          </template>
        </div>
      </section>

      <!-- Section: Relays -->
      <section class="settings-section">
        <div class="section-title-row">
          <h2 class="section-heading">Active Nostr Relays</h2>
          <button
            class="btn btn-xs btn-outline"
            type="button"
            @click="settingsStore.restoreDefaultRelays"
          >
            Restore Defaults
          </button>
        </div>
        <p class="section-desc">
          Your personal library, ratings, and scrobbles are broadcast to and fetched from these relays.
        </p>

        <div class="relay-list">
          <div v-for="relay in settingsStore.relays" :key="relay" class="relay-item">
            <span class="relay-url">{{ relay }}</span>
            <button
              class="btn btn-xs btn-danger"
              type="button"
              @click="settingsStore.removeRelay(relay)"
            >
              Remove
            </button>
          </div>
        </div>

        <div class="add-relay-row">
          <input
            v-model="newRelay"
            type="text"
            class="input"
            placeholder="wss://relay.example.com"
            @keyup.enter="handleAddRelay"
          />
          <button class="btn btn-secondary" type="button" @click="handleAddRelay">
            Add Relay
          </button>
        </div>
      </section>

      <!-- Section: Originless IPFS Node -->
      <section class="settings-section">
        <h2 class="section-heading">Originless IPFS Node (Media Storage)</h2>
        <p class="section-desc">
          Free public IPFS swarm instance for uploading posters, backdrops, and avatars without centralized APIs.
        </p>
        <div class="input-with-action">
          <input
            v-model="originlessNode"
            type="text"
            class="input"
            placeholder="https://originless.gupt.app"
          />
          <button class="btn btn-secondary" type="button" @click="resetOriginless">
            Default
          </button>
        </div>

        <div class="resolver-sub-box">
          <label class="form-label">IPFS Presentation Resolver</label>
          <input
            type="text"
            class="input"
            value="https://dweb.link/ipfs/CID"
            disabled
          />
          <p class="form-hint">
            Media assets stored on IPFS are resolved at presentation time via <code>https://dweb.link/ipfs/CID</code>.
          </p>
        </div>
      </section>

      <!-- Section: TMDB API Key -->
      <section class="settings-section">
        <h2 class="section-heading">TMDB API Key (Free Tier, Optional)</h2>
        <p class="section-desc">
          Used for client-side movie & show metadata presentation. If left empty, TMDB is skipped and open community providers are queried.
        </p>
        <input
          v-model="tmdbKey"
          type="password"
          class="input"
          placeholder="Enter your free TMDB API key"
          autocomplete="off"
        />
        <p class="form-hint">
          Get a free key at
          <a href="https://www.themoviedb.org/settings/api" target="_blank" rel="noopener" class="link">
            themoviedb.org
          </a>.
        </p>
      </section>

      <!-- Section: Appearance -->
      <section class="settings-section">
        <h2 class="section-heading">Appearance</h2>
        <div class="theme-toggle-row">
          <span class="theme-label">Current Theme: <strong>{{ settingsStore.theme === 'dark' ? 'Dark Mode' : 'Light Mode' }}</strong></span>
          <button class="btn btn-secondary btn-sm" type="button" @click="settingsStore.toggleTheme">
            {{ settingsStore.theme === 'dark' ? '☀️ Switch to Light' : '🌙 Switch to Dark' }}
          </button>
        </div>
      </section>

      <!-- Footer Actions -->
      <footer class="settings-footer">
        <router-link to="/diagnostics" class="btn btn-outline btn-sm">
          🐞 Diagnostics & Logs
        </router-link>
        <div class="save-actions">
          <button class="btn btn-secondary btn-sm" type="button" @click="goBack">Back</button>
          <button class="btn btn-primary btn-sm" type="button" @click="handleSaveSettings">Save Preferences</button>
        </div>
      </footer>
    </div>
  </div>
</template>

<style scoped>
.settings-page-wrap {
  max-width: 680px;
  margin: 0 auto;
  padding: 12px 0 60px;
}

.page-top-nav {
  margin-bottom: 16px;
}

.btn-back {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  background: transparent;
  border: none;
  color: var(--text-secondary);
  font-size: 0.9rem;
  font-weight: 500;
  cursor: pointer;
  padding: 4px 0;
  transition: color var(--transition-fast);
}

.btn-back:hover {
  color: var(--text-main);
}

.back-arrow {
  font-size: 1.25rem;
  line-height: 1;
}

.settings-card {
  padding: 32px 28px;
  background: var(--bg-surface);
  border: 1px solid var(--border-subtle);
  border-radius: var(--radius-lg);
  box-shadow: var(--shadow-lg);
}

.settings-header {
  margin-bottom: 28px;
}

.brand-badge-row {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 12px;
}

.settings-icon-badge {
  font-size: 1rem;
}

.settings-title {
  font-size: 1.75rem;
  font-weight: 700;
  letter-spacing: -0.03em;
  margin: 0 0 8px 0;
  color: var(--text-main);
}

.settings-subtitle {
  font-size: 0.9rem;
  color: var(--text-muted);
  line-height: 1.5;
  margin: 0;
}

.error-banner {
  display: block;
  padding: 10px 14px;
  margin-bottom: 20px;
}

.success-banner {
  display: block;
  padding: 10px 14px;
  margin-bottom: 20px;
}

.settings-section {
  padding-bottom: 24px;
  margin-bottom: 24px;
  border-bottom: 1px solid var(--border-subtle);
}

.settings-section:last-of-type {
  border-bottom: none;
  margin-bottom: 0;
  padding-bottom: 0;
}

.section-heading {
  font-size: 1rem;
  font-weight: 600;
  margin: 0 0 6px 0;
  letter-spacing: -0.01em;
  color: var(--text-main);
}

.section-title-row {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 6px;
}

.section-desc {
  font-size: 0.84rem;
  color: var(--text-muted);
  margin: 0 0 14px 0;
  line-height: 1.4;
}

.status-box {
  background: var(--bg-card);
  padding: 14px;
  border-radius: var(--radius-sm);
  border: 1px solid var(--border-subtle);
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.signer-header-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.relay-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
  max-height: 200px;
  overflow-y: auto;
  margin-bottom: 12px;
  background: var(--bg-card);
  padding: 10px;
  border-radius: var(--radius-sm);
  border: 1px solid var(--border-subtle);
}

.relay-item {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 8px 12px;
  background: var(--bg-surface);
  border-radius: var(--radius-xs);
  font-size: 0.85rem;
}

.relay-url {
  font-family: var(--font-mono);
  color: var(--text-secondary);
  font-size: 0.82rem;
}

.add-relay-row {
  display: flex;
  gap: 8px;
}

.input-with-action {
  display: flex;
  gap: 8px;
  margin-bottom: 12px;
}

.resolver-sub-box {
  margin-top: 14px;
}

.link {
  color: var(--primary);
  text-decoration: underline;
}

.theme-toggle-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  background: var(--bg-card);
  padding: 12px 14px;
  border-radius: var(--radius-sm);
  border: 1px solid var(--border-subtle);
}

.theme-label {
  font-size: 0.88rem;
  color: var(--text-secondary);
}

.settings-footer {
  display: flex;
  align-items: center;
  justify-content: space-between;
  border-top: 1px solid var(--border-subtle);
  margin-top: 28px;
  padding-top: 20px;
  gap: 12px;
}

.save-actions {
  display: flex;
  gap: 10px;
}

@media (max-width: 640px) {
  .settings-card {
    padding: 24px 18px;
  }

  .add-relay-row {
    flex-direction: column;
  }

  .add-relay-row .btn {
    width: 100%;
  }

  .input-with-action {
    flex-direction: column;
  }

  .input-with-action .btn {
    width: 100%;
  }

  .settings-footer {
    flex-direction: column;
    align-items: stretch;
  }

  .save-actions {
    justify-content: space-between;
  }
}
</style>
