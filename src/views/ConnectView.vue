<script setup>
import { ref, computed, onMounted } from 'vue'
import { useRouter, useRoute } from 'vue-router'
import { useAuthStore } from '@/stores/auth.js'
import { nostrClient } from '@/services/nostr/client.js'

const router = useRouter()
const route = useRoute()
const authStore = useAuthStore()

// If extension is available, default to extension; otherwise default to nsec
const activeTab = ref(nostrClient.hasExtension() ? 'extension' : 'nsec')
const nsecInput = ref('')
const hasExtension = ref(nostrClient.hasExtension())

// Disposable account state
const disposableNsec = ref('')
const showDisposableBackup = ref(false)
const copied = ref(false)

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

onMounted(() => {
  // If already authenticated, redirect
  if (authStore.isAuthenticated) {
    handleLoginSuccess()
    return
  }
  hasExtension.value = nostrClient.hasExtension()
})

async function handleExtensionConnect() {
  try {
    await authStore.loginWithExtension()
    handleLoginSuccess()
  } catch (err) {
    // Error is captured in authStore.loginError
  }
}

async function handleNsecConnect() {
  if (!nsecInput.value.trim()) return
  try {
    await authStore.loginWithNsec(nsecInput.value.trim())
    handleLoginSuccess()
  } catch (err) {
    // Error is captured in authStore.loginError
  }
}

async function handleCreateDisposable() {
  disposableNsec.value = ''
  showDisposableBackup.value = false
  try {
    const result = await authStore.createDisposableAccount()
    disposableNsec.value = result.nsec
    showDisposableBackup.value = true
  } catch (err) {
    // Error is captured in authStore.loginError
  }
}

function handleCopyNsec() {
  if (!disposableNsec.value) return
  if (navigator.clipboard?.writeText) {
    navigator.clipboard.writeText(disposableNsec.value).catch(() => {})
  }
  copied.value = true
  setTimeout(() => {
    copied.value = false
  }, 2000)
}

function handleContinueToApp() {
  handleLoginSuccess()
}

function navigateToDiagnostics() {
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
          :class="{ active: activeTab === 'nsec' }"
          type="button"
          @click="activeTab = 'nsec'"
        >
          <span class="tab-icon">🔑</span>
          <div class="tab-text">
            <span class="tab-title">nsec Key</span>
            <span class="tab-sub">Paste private key</span>
          </div>
        </button>

        <button
          class="method-tab"
          :class="{ active: activeTab === 'disposable' }"
          type="button"
          @click="activeTab = 'disposable'"
        >
          <span class="tab-icon">🎭</span>
          <div class="tab-text">
            <span class="tab-title">Disposable</span>
            <span class="tab-sub">Instant throwaway account</span>
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
              <li>Switch to the <strong>nsec Key</strong> tab to paste an existing private key.</li>
              <li>Or create a <strong>Disposable</strong> account for instant, throwaway use.</li>
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

      <!-- nsec Key Option Tab Content -->
      <div v-if="activeTab === 'nsec'" class="tab-content">
        <div class="option-description">
          <p>
            Paste an existing <strong>nsec</strong> private key to log in. Events are signed locally in your browser.
          </p>
        </div>

        <div class="form-group">
          <label class="form-label" for="nsec-input">nsec private key</label>
          <input
            id="nsec-input"
            v-model="nsecInput"
            type="password"
            class="form-input"
            placeholder="nsec1..."
            autocomplete="off"
            spellcheck="false"
            :disabled="authStore.isLoggingIn"
            @keydown.enter="handleNsecConnect"
          />
          <p class="form-hint">
            Accepts <code>nsec1...</code>, <code>nostr:nsec1...</code>, or a 64-character hex key.
          </p>
        </div>

        <div class="security-note">
          <span class="security-note-icon">⚠️</span>
          <p>
            Your nsec is stored in this browser to sign events. Anyone with access to this browser profile can use it.
            For long-lived keys, prefer a <strong>NIP-07 extension</strong>.
          </p>
        </div>

        <div class="action-row">
          <button
            class="btn btn-primary btn-block"
            type="button"
            :disabled="authStore.isLoggingIn || !nsecInput.trim()"
            @click="handleNsecConnect"
          >
            <span v-if="authStore.isLoggingIn" class="btn-spinner"></span>
            <span>{{ authStore.isLoggingIn ? authStore.loginStatusMessage || 'Connecting...' : 'Log In with nsec' }}</span>
          </button>
        </div>
      </div>

      <!-- Disposable Account Option Tab Content -->
      <div v-if="activeTab === 'disposable'" class="tab-content">
        <div class="option-description">
          <p>
            Create a <strong>fresh, disposable Nostr identity</strong> instantly — no extension, no existing key needed.
            Perfect for trying Trackstr or for throwaway accounts.
          </p>
        </div>

        <div v-if="!showDisposableBackup" class="action-row">
          <button
            class="btn btn-primary btn-block"
            type="button"
            :disabled="authStore.isLoggingIn"
            @click="handleCreateDisposable"
          >
            <span v-if="authStore.isLoggingIn" class="btn-spinner"></span>
            <span>{{ authStore.isLoggingIn ? authStore.loginStatusMessage || 'Generating...' : '🎭 Create Disposable Account' }}</span>
          </button>
        </div>

        <!-- Backup nsec callout after creation -->
        <div v-if="showDisposableBackup" class="disposable-backup-card">
          <div class="backup-head">
            <span class="backup-icon">🔑</span>
            <strong>Back up your new key</strong>
          </div>
          <p class="backup-desc">
            This is the only time your disposable nsec is shown. Save it if you want to keep this identity — otherwise it's lost forever when you log out.
          </p>
          <div class="backup-nsec-box">
            <code class="backup-nsec">{{ disposableNsec }}</code>
            <button
              class="btn btn-secondary btn-sm"
              type="button"
              @click="handleCopyNsec"
            >
              {{ copied ? '✓ Copied' : '📋 Copy' }}
            </button>
          </div>
          <button
            class="btn btn-primary btn-block"
            type="button"
            @click="handleContinueToApp"
          >
            Continue to Trackstr →
          </button>
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
        <span class="footer-hint">🔒 With nsec login, keys stay in your browser and events are signed locally.</span>
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
  grid-template-columns: repeat(3, 1fr);
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

/* nsec & Disposable Account Styles */
.form-group {
  margin-bottom: 16px;
}

.form-label {
  display: block;
  font-size: 0.82rem;
  font-weight: 600;
  color: var(--text-secondary);
  margin-bottom: 6px;
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

.form-hint {
  font-size: 0.76rem;
  color: var(--text-muted);
  margin: 6px 0 0 0;
  line-height: 1.4;
}

.form-hint code {
  font-family: var(--font-mono);
  background: var(--bg-card);
  border: 1px solid var(--border-subtle);
  padding: 1px 5px;
  border-radius: var(--radius-xs);
}

.security-note {
  display: flex;
  gap: 10px;
  padding: 12px 14px;
  background: rgba(245, 158, 11, 0.08);
  border: 1px solid rgba(245, 158, 11, 0.3);
  border-radius: var(--radius-md);
  margin-bottom: 18px;
}

.security-note-icon {
  font-size: 1.1rem;
  flex-shrink: 0;
}

.security-note p {
  margin: 0;
  font-size: 0.8rem;
  color: var(--text-secondary);
  line-height: 1.5;
}

.disposable-backup-card {
  padding: 18px;
  background: var(--bg-card);
  border: 1px solid rgba(34, 197, 94, 0.35);
  border-radius: var(--radius-md);
  margin-bottom: 18px;
}

.backup-head {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 0.95rem;
  margin-bottom: 8px;
}

.backup-icon {
  font-size: 1.2rem;
}

.backup-desc {
  font-size: 0.82rem;
  color: var(--text-secondary);
  line-height: 1.5;
  margin: 0 0 14px 0;
}

.backup-nsec-box {
  display: flex;
  align-items: center;
  gap: 10px;
  background: #000000;
  border: 1px solid var(--border-subtle);
  border-radius: var(--radius-sm);
  padding: 10px 12px;
  margin-bottom: 14px;
}

.backup-nsec {
  flex: 1;
  font-family: var(--font-mono);
  font-size: 0.72rem;
  color: var(--accent-emerald);
  word-break: break-all;
  line-height: 1.4;
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
