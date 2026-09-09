<script setup>
import { ref } from 'vue'
import { useSettingsStore } from '@/stores/settings.js'
import { useAuthStore } from '@/stores/auth.js'
import { nostrClient } from '@/services/nostr/client.js'
import { DEFAULT_ORIGINLESS_INSTANCE } from '@/services/originless.js'

const emit = defineEmits(['close'])

const settingsStore = useSettingsStore()
const authStore = useAuthStore()

const newRelay = ref('')
const tmdbKey = ref(settingsStore.tmdbApiKey)
const originlessNode = ref(settingsStore.originlessUrl)
const hasExtension = ref(nostrClient.hasExtension())
const formError = ref('')

function handleAddRelay() {
  formError.value = ''
  if (!newRelay.value.trim()) return
  if (settingsStore.addRelay(newRelay.value.trim())) {
    newRelay.value = ''
  } else {
    formError.value = settingsStore.settingsError || 'Invalid relay URL.'
  }
}

function handleSaveSettings() {
  formError.value = ''
  settingsStore.setTmdbApiKey(tmdbKey.value)
  if (!settingsStore.setOriginlessUrl(originlessNode.value)) {
    formError.value = settingsStore.settingsError || 'Invalid Originless node URL.'
    return
  }
  emit('close')
}

function resetOriginless() {
  originlessNode.value = DEFAULT_ORIGINLESS_INSTANCE
}
</script>

<template>
  <div class="modal-overlay" @click.self="$emit('close')">
    <div class="modal-dialog">
      <div class="sheet-drag-handle"></div>
      <div class="modal-header">
        <h2 class="modal-title">Settings & Network</h2>
        <button class="btn btn-icon" type="button" @click="$emit('close')">✕</button>
      </div>

      <div class="modal-body">
        <div v-if="formError" class="badge badge-danger error-banner">
          {{ formError }}
        </div>
        <!-- Nostr Signer Status -->
        <div class="form-group">
          <label class="form-label">Nostr Signer Status (NIP-07 / NIP-46 Bunker)</label>
          <div class="status-box">
            <template v-if="authStore.isAuthenticated">
              <span v-if="authStore.authType === 'bunker'" class="badge badge-success">⚡ Bunker Connected</span>
              <span v-else class="badge badge-success">🧩 Extension Connected</span>
              <p class="form-hint">
                Logged in as: <span class="contentid-chip">{{ authStore.npub }}</span>
              </p>
            </template>
            <template v-else>
              <span v-if="hasExtension" class="badge badge-success">Extension Detected</span>
              <span v-else class="badge badge-neutral">No Extension (Bunker available)</span>
              <p class="form-hint">
                Connect via browser extension (Alby, nos2x) or remote Bunker (nsec.app, Amber).
              </p>
            </template>
          </div>
        </div>

        <hr class="divider" />

        <!-- Relays -->
        <div class="form-group">
          <label class="form-label">Active Nostr Relays</label>
          <div class="relay-list">
            <div v-for="relay in settingsStore.relays" :key="relay" class="relay-item">
              <span class="relay-url">{{ relay }}</span>
              <button
                class="btn btn-sm btn-danger"
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

          <div class="relay-actions">
            <button
              class="btn btn-sm btn-outline"
              type="button"
              @click="settingsStore.restoreDefaultRelays"
            >
              Restore Default Relays
            </button>
          </div>
        </div>

        <hr class="divider" />

        <!-- Originless IPFS Node & Resolver -->
        <div class="form-group">
          <label class="form-label">Originless IPFS Node (Media Storage)</label>
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
          <p class="form-hint">
            Free public IPFS swarm instance for uploading posters, backdrops, and avatars without API keys.
          </p>
        </div>

        <div class="form-group">
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

        <hr class="divider" />

        <!-- TMDB Free API Key -->
        <div class="form-group">
          <label class="form-label">TMDB API Key (Free Tier, Optional)</label>
          <input
            v-model="tmdbKey"
            type="password"
            class="input"
            placeholder="Enter your free TMDB API key"
            autocomplete="off"
          />
          <p class="form-hint">
            Used for client-side movie & show metadata. You can get a free API key at
            <a href="https://www.themoviedb.org/settings/api" target="_blank" rel="noopener" class="link">
              themoviedb.org
            </a>. If left empty, TMDB is skipped and open providers (TVMaze, Wikipedia) are used.
          </p>
        </div>
      </div>

      <div class="modal-footer">
        <button class="btn btn-secondary" type="button" @click="$emit('close')">Cancel</button>
        <button class="btn btn-primary" type="button" @click="handleSaveSettings">Save Settings</button>
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

.status-box {
  background: var(--bg-card);
  padding: 12px;
  border-radius: var(--radius-sm);
  border: 1px solid var(--border-subtle);
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.divider {
  border: none;
  border-top: 1px solid var(--border-subtle);
  margin: 18px 0;
}

.relay-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
  max-height: 160px;
  overflow-y: auto;
  margin-bottom: 12px;
  background: var(--bg-card);
  padding: 8px;
  border-radius: var(--radius-sm);
  border: 1px solid var(--border-subtle);
}

.relay-item {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 6px 10px;
  background: var(--bg-surface);
  border-radius: var(--radius-xs);
  font-size: 0.85rem;
}

.relay-url {
  font-family: var(--font-mono);
  color: var(--text-secondary);
}

.add-relay-row {
  display: flex;
  gap: 8px;
  margin-bottom: 8px;
}

.relay-actions {
  display: flex;
  justify-content: flex-end;
}

.input-with-action {
  display: flex;
  gap: 8px;
}

.link {
  color: var(--primary);
  text-decoration: underline;
}

@media (max-width: 640px) {
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
}
</style>
