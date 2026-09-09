<script setup>
import { ref, computed, watch, onMounted, onUnmounted } from 'vue'
import { useRouter, useRoute } from 'vue-router'
import { useAuthStore } from '@/stores/auth.js'
import { nostrClient } from '@/services/nostr/client.js'
import { bunkerService } from '@/services/nostr/bunker.js'
import { isSafeHttpUrl } from '@/utils/urls.js'

const router = useRouter()
const route = useRoute()
const authStore = useAuthStore()

// If extension is available, default to extension; otherwise default to bunker
const activeTab = ref(nostrClient.hasExtension() ? 'extension' : 'bunker')
const bunkerInput = ref(localStorage.getItem('trackstr_bunker_input') || '')
const pendingAuthUrl = ref('')
const hasExtension = ref(nostrClient.hasExtension())

// Signer-supplied authorization URLs are untrusted input — only http(s) reaches href
const safeAuthUrl = computed(() => (isSafeHttpUrl(pendingAuthUrl.value) ? pendingAuthUrl.value : ''))

// QR Code state for Bunker connection
const qrDataUrl = ref('')
const nostrConnectUri = ref('')
const isGeneratingQr = ref(false)
const qrError = ref('')
const selectedRelays = ref(['wss://nos.lol', 'wss://relay.primal.net'])
const copied = ref(false)
const showManualInput = ref(false)
let abortController = null

function goBack() {
  const returnTo = route.query.returnTo
  if (returnTo && typeof returnTo === 'string' && returnTo.startsWith('/')) {
    router.push(returnTo)
  } else if (window.history.length > 1) {
    router.back()
  } else {
    router.push('/')
  }
}

function handleLoginSuccess() {
  const returnTo = route.query.returnTo
  if (returnTo && typeof returnTo === 'string' && returnTo.startsWith('/')) {
    router.push(returnTo)
  } else if (window.history.length > 1) {
    router.back()
  } else {
    router.push('/')
  }
}

function onBunkerAuth(e) {
  if (e.detail?.url) {
    pendingAuthUrl.value = e.detail.url
  }
}

async function initQrSession() {
  if (abortController) {
    abortController.abort()
  }
  abortController = new AbortController()
  isGeneratingQr.value = true
  qrError.value = ''

  try {
    const session = await bunkerService.generateNostrConnectSession({
      relays: selectedRelays.value,
      name: 'Trackstr',
    })
    qrDataUrl.value = session.qrDataUrl
    nostrConnectUri.value = session.uri
    isGeneratingQr.value = false

    // Start background listening on the popular relay
    authStore
      .loginWithNostrConnectUri(session.uri, {
        abortSignal: abortController.signal,
        onAuthUrl: (url) => {
          pendingAuthUrl.value = url
        },
      })
      .then((res) => {
        if (res) {
          handleLoginSuccess()
        }
      })
      .catch(() => {
        // Silently handled or surfaced in authStore.loginError
      })
  } catch (err) {
    isGeneratingQr.value = false
    qrError.value = err?.message || 'Failed to generate a Nostr Connect session.'
    console.error('Failed to generate Nostr Connect session:', err)
  }
}

function handleCopyLink() {
  if (!nostrConnectUri.value) return
  if (navigator.clipboard?.writeText) {
    navigator.clipboard.writeText(nostrConnectUri.value).catch(() => {})
  }
  copied.value = true
  setTimeout(() => {
    copied.value = false
  }, 2000)
}

function handleRefreshQr() {
  initQrSession()
}

watch(activeTab, (tab) => {
  if (tab === 'bunker') {
    initQrSession()
  } else {
    if (abortController) {
      abortController.abort()
      abortController = null
    }
  }
})

onMounted(() => {
  // If already authenticated, redirect
  if (authStore.isAuthenticated) {
    handleLoginSuccess()
    return
  }
  hasExtension.value = nostrClient.hasExtension()
  window.addEventListener('trackstr:bunker-auth', onBunkerAuth)
  if (activeTab.value === 'bunker') {
    initQrSession()
  }
})

onUnmounted(() => {
  window.removeEventListener('trackstr:bunker-auth', onBunkerAuth)
  if (abortController) {
    abortController.abort()
    abortController = null
  }
})

async function handleExtensionConnect() {
  try {
    await authStore.loginWithExtension()
    handleLoginSuccess()
  } catch (err) {
    // Error is captured in authStore.loginError
  }
}

async function handleBunkerConnect() {
  if (!bunkerInput.value.trim()) return
  if (abortController) {
    abortController.abort()
    abortController = null
  }
  pendingAuthUrl.value = ''
  try {
    await authStore.loginWithBunker(bunkerInput.value.trim(), {
      onAuthUrl: (url) => {
        pendingAuthUrl.value = url
      },
    })
    handleLoginSuccess()
  } catch (err) {
    // Error is captured in authStore.loginError
  }
}

function selectPreset(suffix) {
  if (bunkerInput.value && bunkerInput.value.includes('@')) {
    const user = bunkerInput.value.split('@')[0]
    bunkerInput.value = `${user}${suffix}`
  } else if (bunkerInput.value && !bunkerInput.value.startsWith('bunker://')) {
    bunkerInput.value = `${bunkerInput.value}${suffix}`
  } else {
    bunkerInput.value = suffix.startsWith('@') ? `user${suffix}` : suffix
  }
}

function navigateToDiagnostics() {
  if (abortController) {
    abortController.abort()
    abortController = null
  }
  router.push('/diagnostics')
}
</script>

<template>
  <div class="connect-page-wrap">
    <div class="page-top-nav">
      <button class="btn-back" type="button" @click="goBack">
        <span class="back-arrow">‹</span>
        <span>Back</span>
      </button>
    </div>

    <div class="connect-card card">
      <header class="connect-header">
        <div class="brand-badge-row">
          <span class="auth-icon-badge">⚡</span>
          <span class="badge badge-primary">Nostr Identity</span>
        </div>
        <h1 class="connect-title">Connect Nostr Account</h1>
        <p class="connect-subtitle">
          Log in to sync your media library, ratings, and scrobbles across all decentralized relays.
        </p>
      </header>

      <!-- Auth Method Selector Tabs -->
      <div class="method-tabs">
        <button
          class="method-tab"
          :class="{ active: activeTab === 'extension' }"
          type="button"
          @click="activeTab = 'extension'"
        >
          <span class="tab-icon">🧩</span>
          <div class="tab-text">
            <span class="tab-title">Extension (NIP-07)</span>
            <span class="tab-sub">Alby, nos2x, Amber</span>
          </div>
          <span
            v-if="hasExtension"
            class="badge badge-success tab-badge"
            title="Extension detected"
          >
            Ready
          </span>
        </button>

        <button
          class="method-tab"
          :class="{ active: activeTab === 'bunker' }"
          type="button"
          @click="activeTab = 'bunker'"
        >
          <span class="tab-icon">⚡</span>
          <div class="tab-text">
            <span class="tab-title">Bunker (NIP-46)</span>
            <span class="tab-sub">Remote Signer & QR</span>
          </div>
        </button>
      </div>

      <!-- Extension Option Tab Content -->
      <div v-if="activeTab === 'extension'" class="tab-content">
        <div class="option-description">
          <p>
            Connect directly using a Nostr browser extension like <strong>Alby</strong>, <strong>nos2x</strong>, or
            <strong>Amber</strong> on web.
          </p>
        </div>

        <div class="detection-status-card" :class="{ 'is-detected': hasExtension }">
          <div class="status-indicator">
            <span class="status-dot"></span>
            <span>{{ hasExtension ? 'NIP-07 browser extension detected' : 'No browser extension detected in current window' }}</span>
          </div>
          <div v-if="!hasExtension" class="extension-guide">
            <p>If you don't have an extension installed, you can:</p>
            <ul>
              <li>Switch to the <strong>Bunker (NIP-46)</strong> tab to sign in with a remote signer like nsec.app or Amber.</li>
              <li>Or install the <a href="https://getalby.com/" target="_blank" rel="noopener">Alby extension</a> or <a href="https://github.com/fiatjaf/nos2x" target="_blank" rel="noopener">nos2x</a> in your browser.</li>
            </ul>
          </div>
        </div>

        <div class="action-row">
          <button
            class="btn btn-primary btn-block"
            type="button"
            :disabled="authStore.isLoggingIn"
            @click="handleExtensionConnect"
          >
            <span v-if="authStore.isLoggingIn" class="btn-spinner"></span>
            <span>{{ authStore.isLoggingIn ? authStore.loginStatusMessage || 'Connecting...' : 'Connect Extension' }}</span>
          </button>
        </div>
      </div>

      <!-- Bunker Option Tab Content -->
      <div v-if="activeTab === 'bunker'" class="tab-content">
        <div class="option-description">
          <p>
            Connect using <strong>NIP-46 Remote Signing</strong>. Works on any device without installing a browser extension.
          </p>
        </div>

        <!-- QR Code Connection Card -->
        <div class="qr-connection-card">
          <div class="qr-card-header">
            <span class="qr-badge-title">Scan with Nostr Signer</span>
            <div class="relay-pulse-indicator" title="Connected to popular Nostr relay">
              <span class="pulse-dot"></span>
              <span class="relay-name">Relay: {{ selectedRelays[0].replace('wss://', '') }}</span>
            </div>
          </div>

          <!-- QR Code Canvas / Image -->
          <div class="qr-frame">
            <div v-if="isGeneratingQr" class="qr-placeholder">
              <div class="btn-spinner large-spinner"></div>
              <span class="qr-loading-text">Generating secure QR code...</span>
            </div>
            <img
              v-else-if="qrDataUrl"
              :src="qrDataUrl"
              alt="Scan to Connect Nostr Bunker"
              class="qr-code-img"
            />
          </div>

          <p class="qr-caption">
            Scan with <strong>Amber</strong> (Android), <strong>Keystr</strong>, <strong>nsec.app</strong>, or any remote signer app to authorize Trackstr.
          </p>

          <!-- Quick Connection Action Buttons -->
          <div class="qr-actions-row">
            <button
              class="btn btn-secondary btn-sm"
              type="button"
              :title="nostrConnectUri"
              @click="handleCopyLink"
            >
              <span>{{ copied ? '✓ Copied Link' : '📋 Copy Link' }}</span>
            </button>

            <a
              v-if="nostrConnectUri"
              :href="nostrConnectUri"
              class="btn btn-primary btn-sm btn-open-signer"
              title="Open directly in installed signer app on mobile"
            >
              <span>⚡ Open Signer</span>
            </a>

            <button
              class="btn btn-icon btn-sm"
              type="button"
              title="Generate fresh QR code"
              @click="handleRefreshQr"
            >
              🔄
            </button>
          </div>
        </div>

        <!-- Remote Auth URL Callout -->
        <div v-if="qrError" class="login-error-banner">
          <div class="error-head">
            <span class="error-icon">⚠️</span>
            <strong>QR Session Failed</strong>
          </div>
          <p class="error-msg">{{ qrError }}</p>
        </div>

        <div v-if="safeAuthUrl" class="auth-url-card">
          <div class="auth-url-icon">🔐</div>
          <div class="auth-url-body">
            <strong>Signer Authorization Required</strong>
            <p>Your remote signer requires approval. Click the button below to complete authorization in a new tab:</p>
            <a
              :href="safeAuthUrl"
              target="_blank"
              rel="noopener noreferrer"
              class="btn btn-sm btn-primary auth-open-btn"
            >
              Open Authorization Window ↗
            </a>
          </div>
        </div>

        <!-- Connecting Status -->
        <div v-if="authStore.isLoggingIn" class="bunker-status-box">
          <span class="btn-spinner"></span>
          <span>{{ authStore.loginStatusMessage || 'Listening for remote signer connection on relay...' }}</span>
        </div>

        <!-- Manual Fallback Collapsible -->
        <div class="manual-toggle-section">
          <button
            class="manual-toggle-btn"
            type="button"
            @click="showManualInput = !showManualInput"
          >
            <span class="toggle-arrow">{{ showManualInput ? '▼' : '▶' }}</span>
            <span>Or enter bunker:// URI or NIP-05 address</span>
          </button>

          <div v-if="showManualInput" class="manual-input-box">
            <div class="form-group">
              <input
                id="bunker-input"
                v-model="bunkerInput"
                type="text"
                class="form-input"
                placeholder="e.g. user@nsec.app or bunker://<pubkey>?relay=wss://..."
                :disabled="authStore.isLoggingIn"
                @keydown.enter="handleBunkerConnect"
              />
            </div>

            <!-- Quick Presets -->
            <div class="preset-row">
              <span class="preset-label">Quick helpers:</span>
              <button
                class="preset-chip"
                type="button"
                @click="selectPreset('@nsec.app')"
              >
                @nsec.app
              </button>
              <button
                class="preset-chip"
                type="button"
                @click="selectPreset('@primal.net')"
              >
                @primal.net
              </button>
              <button
                class="preset-chip"
                type="button"
                @click="selectPreset('bunker://')"
              >
                bunker://
              </button>
            </div>

            <button
              class="btn btn-secondary btn-block btn-sm"
              type="button"
              :disabled="authStore.isLoggingIn || !bunkerInput.trim()"
              @click="handleBunkerConnect"
            >
              <span v-if="authStore.isLoggingIn" class="btn-spinner"></span>
              <span>{{ authStore.isLoggingIn ? 'Connecting...' : 'Connect via Address' }}</span>
            </button>
          </div>
        </div>
      </div>

      <!-- Error Message Banner -->
      <div v-if="authStore.loginError" class="login-error-banner">
        <div class="error-head">
          <span class="error-icon">⚠️</span>
          <strong>Connection Failed</strong>
        </div>
        <p class="error-msg">{{ authStore.loginError }}</p>
        <div class="error-actions">
          <button class="btn btn-outline btn-xs" type="button" @click="navigateToDiagnostics">
            Open Diagnostics & Logs 🐞
          </button>
        </div>
      </div>

      <!-- Footer -->
      <div class="connect-footer">
        <span class="footer-hint">🔒 Keys never leave your signer. Trackstr only receives event signatures.</span>
        <button class="btn btn-outline btn-xs" type="button" @click="navigateToDiagnostics">
          Diagnostics 🐞
        </button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.connect-page-wrap {
  max-width: 540px;
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

.connect-card {
  padding: 32px 28px;
  background: var(--bg-surface);
  border: 1px solid var(--border-subtle);
  border-radius: var(--radius-lg);
  box-shadow: var(--shadow-lg);
}

.connect-header {
  margin-bottom: 24px;
}

.brand-badge-row {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 12px;
}

.auth-icon-badge {
  font-size: 1rem;
}

.connect-title {
  font-size: 1.75rem;
  font-weight: 700;
  letter-spacing: -0.03em;
  margin: 0 0 8px 0;
  color: var(--text-main);
}

.connect-subtitle {
  font-size: 0.9rem;
  color: var(--text-muted);
  line-height: 1.5;
  margin: 0;
}

.method-tabs {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 12px;
  margin-bottom: 24px;
}

.method-tab {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 14px 16px;
  border-radius: var(--radius-md);
  border: 1px solid var(--border-color, #262626);
  background: var(--bg-card);
  color: var(--text-main);
  cursor: pointer;
  text-align: left;
  transition: all var(--transition-fast);
  position: relative;
}

.method-tab:hover {
  border-color: #555555;
  background: #111111;
}

.method-tab.active {
  border-color: #ffffff;
  background: #141414;
}

[data-theme='light'] .method-tab.active {
  border-color: #000000;
  background: #f5f5f5;
}

.tab-icon {
  font-size: 1.5rem;
  flex-shrink: 0;
}

.tab-text {
  display: flex;
  flex-direction: column;
  min-width: 0;
}

.tab-title {
  font-weight: 600;
  font-size: 0.92rem;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.tab-sub {
  font-size: 0.74rem;
  color: var(--text-muted);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.tab-badge {
  position: absolute;
  top: 8px;
  right: 8px;
  font-size: 0.65rem;
  padding: 2px 6px;
}

.option-description {
  font-size: 0.9rem;
  color: var(--text-secondary);
  line-height: 1.5;
  margin-bottom: 18px;
}

.detection-status-card {
  padding: 16px;
  border-radius: var(--radius-md);
  background: var(--bg-card);
  border: 1px solid var(--border-subtle);
  margin-bottom: 22px;
}

.detection-status-card.is-detected {
  border-color: rgba(34, 197, 94, 0.4);
  background: rgba(34, 197, 94, 0.05);
}

.status-indicator {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 0.88rem;
  font-weight: 500;
}

.status-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: var(--text-muted);
}

.is-detected .status-dot {
  background: #22c55e;
  box-shadow: 0 0 8px #22c55e;
}

.extension-guide {
  margin-top: 10px;
  font-size: 0.82rem;
  color: var(--text-muted);
}

.extension-guide p {
  margin: 0 0 6px 0;
}

.extension-guide ul {
  margin: 0;
  padding-left: 18px;
  line-height: 1.4;
}

.extension-guide a {
  color: var(--primary);
  text-decoration: underline;
}

.action-row {
  margin-top: 16px;
}

.btn-block {
  width: 100%;
  padding: 13px;
  font-size: 0.95rem;
  font-weight: 600;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
}

.btn-spinner {
  width: 16px;
  height: 16px;
  border: 2px solid rgba(255, 255, 255, 0.3);
  border-top-color: #fff;
  border-radius: 50%;
  animation: spin 0.8s linear infinite;
}

.large-spinner {
  width: 32px;
  height: 32px;
  border-width: 3px;
}

@keyframes spin {
  to {
    transform: rotate(360deg);
  }
}

/* Bunker QR Code Styles */
.qr-connection-card {
  display: flex;
  flex-direction: column;
  align-items: center;
  text-align: center;
  padding: 24px 20px;
  background: #000000;
  border: 1px solid var(--border-subtle);
  border-radius: var(--radius-md);
  margin-bottom: 22px;
  transition: border-color var(--transition-fast);
}

.qr-connection-card:hover {
  border-color: var(--border-hover);
}

.qr-card-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  width: 100%;
  margin-bottom: 16px;
}

.qr-badge-title {
  font-weight: 600;
  font-size: 0.88rem;
  color: var(--text-main);
  letter-spacing: -0.01em;
}

.relay-pulse-indicator {
  display: flex;
  align-items: center;
  gap: 6px;
  background: #111111;
  border: 1px solid #262626;
  padding: 3px 8px;
  border-radius: var(--radius-xs);
}

.relay-name {
  font-size: 0.72rem;
  font-family: var(--font-mono);
  color: var(--accent-emerald);
  font-weight: 500;
}

.pulse-dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: var(--accent-emerald);
}

.qr-frame {
  background: #ffffff;
  padding: 12px;
  border-radius: var(--radius-sm);
  display: flex;
  align-items: center;
  justify-content: center;
  margin-bottom: 16px;
  width: 224px;
  height: 224px;
  box-shadow: 0 4px 16px rgba(0, 0, 0, 0.4);
}

.qr-code-img {
  width: 200px;
  height: 200px;
  display: block;
  image-rendering: pixelated;
}

.qr-placeholder {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 12px;
  color: #000000;
}

.qr-loading-text {
  font-size: 0.8rem;
  font-weight: 500;
  color: #555555;
}

.qr-caption {
  font-size: 0.82rem;
  color: var(--text-secondary);
  line-height: 1.4;
  margin: 0 0 16px 0;
  max-width: 380px;
}

.qr-actions-row {
  display: flex;
  align-items: center;
  gap: 10px;
  width: 100%;
  justify-content: center;
}

.btn-open-signer {
  text-decoration: none;
}

.auth-url-card {
  display: flex;
  gap: 12px;
  background: rgba(255, 255, 255, 0.04);
  border: 1px solid var(--border-hover);
  border-radius: var(--radius-md);
  padding: 14px;
  margin-bottom: 18px;
}

.auth-url-icon {
  font-size: 1.5rem;
  flex-shrink: 0;
}

.auth-url-body {
  display: flex;
  flex-direction: column;
  gap: 6px;
  font-size: 0.85rem;
}

.auth-open-btn {
  align-self: flex-start;
  margin-top: 4px;
  font-weight: 600;
  text-decoration: none;
}

.bunker-status-box {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 10px 14px;
  background: var(--bg-card);
  border: 1px solid var(--border-subtle);
  border-radius: var(--radius-md);
  font-size: 0.85rem;
  color: var(--text-secondary);
  margin-bottom: 18px;
}

.manual-toggle-section {
  border-top: 1px solid var(--border-subtle);
  padding-top: 14px;
  margin-top: 14px;
}

.manual-toggle-btn {
  background: none;
  border: none;
  color: var(--text-muted);
  font-size: 0.82rem;
  cursor: pointer;
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 4px 0;
  transition: color var(--transition-fast);
}

.manual-toggle-btn:hover {
  color: var(--text-main);
}

.toggle-arrow {
  font-size: 0.7rem;
}

.manual-input-box {
  margin-top: 12px;
}

.form-input {
  width: 100%;
  padding: 10px 12px;
  background: var(--bg-input);
  border: 1px solid var(--border-subtle);
  border-radius: var(--radius-sm);
  color: var(--text-main);
  font-size: 0.85rem;
  font-family: var(--font-mono);
}

.preset-row {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-top: 8px;
  margin-bottom: 14px;
  flex-wrap: wrap;
}

.preset-label {
  font-size: 0.76rem;
  color: var(--text-muted);
}

.preset-chip {
  background: var(--bg-card);
  border: 1px solid var(--border-subtle);
  color: var(--text-secondary);
  font-size: 0.72rem;
  font-family: var(--font-mono);
  padding: 2px 7px;
  border-radius: var(--radius-xs);
  cursor: pointer;
  transition: all var(--transition-fast);
}

.preset-chip:hover {
  background: #ffffff;
  color: #000000;
  border-color: #ffffff;
}

[data-theme='light'] .preset-chip:hover {
  background: #000000;
  color: #ffffff;
  border-color: #000000;
}

.login-error-banner {
  margin-top: 18px;
  padding: 14px 16px;
  border-radius: var(--radius-md);
  background: rgba(239, 68, 68, 0.08);
  border: 1px solid rgba(239, 68, 68, 0.3);
  color: var(--accent-rose);
}

.error-head {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 0.88rem;
  margin-bottom: 4px;
}

.error-msg {
  font-size: 0.82rem;
  margin: 0 0 10px 0;
  word-break: break-word;
  line-height: 1.4;
}

.error-actions {
  display: flex;
  justify-content: flex-end;
}

.btn-xs {
  font-size: 0.75rem;
  padding: 4px 8px;
}

.connect-footer {
  display: flex;
  align-items: center;
  justify-content: space-between;
  border-top: 1px solid var(--border-subtle);
  margin-top: 24px;
  padding-top: 18px;
  gap: 12px;
}

.footer-hint {
  font-size: 0.76rem;
  color: var(--text-muted);
  line-height: 1.4;
}

@media (max-width: 600px) {
  .connect-card {
    padding: 24px 18px;
  }

  .connect-title {
    font-size: 1.5rem;
  }

  .method-tabs {
    grid-template-columns: 1fr;
  }

  .connect-footer {
    flex-direction: column;
    align-items: flex-start;
  }
}
</style>
