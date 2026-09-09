<script setup>
import { ref, onMounted, onUnmounted, nextTick } from 'vue'
import { useRouter } from 'vue-router'
import { useAuthStore } from '@/stores/auth.js'
import { nostrClient } from '@/services/nostr/client.js'
import { getLogs, clearLogs, subscribeLogs, logger } from '@/utils/logger.js'

const router = useRouter()
const authStore = useAuthStore()

const logs = ref(getLogs())
const logContainer = ref(null)
const diagnostics = ref(nostrClient.getDiagnostics())
const isTestingExtension = ref(false)
const testResult = ref(null)
const copied = ref(false)

let unsubscribe = null

function goBack() {
  if (window.history.length > 1) {
    router.back()
  } else {
    router.push('/')
  }
}

onMounted(() => {
  diagnostics.value = nostrClient.getDiagnostics()
  unsubscribe = subscribeLogs(() => {
    logs.value = getLogs()
    scrollToBottom()
  })
  scrollToBottom()
})

onUnmounted(() => {
  if (unsubscribe) unsubscribe()
})

function scrollToBottom() {
  nextTick(() => {
    if (logContainer.value) {
      logContainer.value.scrollTop = logContainer.value.scrollHeight
    }
  })
}

async function testExtension() {
  isTestingExtension.value = true
  testResult.value = null
  logger.info('Diagnostics', 'Running manual extension test...')

  try {
    diagnostics.value = nostrClient.getDiagnostics()
    const available = await nostrClient.waitForExtension(1500)
    diagnostics.value = nostrClient.getDiagnostics()

    if (!available || !window.nostr) {
      throw new Error(
        'window.nostr is undefined. Common reasons:\n' +
        '1. Extension (Alby, nos2x) is not installed in this browser.\n' +
        '2. Extension is disabled or does not have permission for current domain.\n' +
        '3. Extension has an active incognito restriction.\n' +
        '4. Browser shields blocked scripts.'
      )
    }

    if (typeof window.nostr.getPublicKey !== 'function') {
      throw new Error(`window.nostr found (${typeof window.nostr}), but .getPublicKey is missing or not a function. Methods: ${diagnostics.value.methods.join(', ') || 'none'}`)
    }

    logger.info('Diagnostics', 'Prompting window.nostr.getPublicKey()...')
    const pubkey = await window.nostr.getPublicKey()
    testResult.value = {
      success: true,
      message: `Success! Extension connected. Public key: ${pubkey}`,
    }
    logger.info('Diagnostics', `Test passed! Pubkey: ${pubkey}`)
  } catch (err) {
    const msg = err?.message || String(err)
    testResult.value = {
      success: false,
      message: msg,
    }
    logger.error('Diagnostics', `Test failed: ${msg}`, err)
  } finally {
    isTestingExtension.value = false
  }
}

function handleCopyLogs() {
  const text = logs.value
    .map((l) => `[${l.timestamp}] [${l.level.toUpperCase()}] [${l.tag}] ${l.message} ${l.data ? JSON.stringify(l.data) : ''}`)
    .join('\n')

  if (navigator.clipboard?.writeText) {
    navigator.clipboard.writeText(text).catch(() => {})
  }
  copied.value = true
  setTimeout(() => {
    copied.value = false
  }, 2000)
}

function handleClearLogs() {
  clearLogs()
  logs.value = []
}
</script>

<template>
  <div class="debug-page-wrap">
    <div class="page-top-nav">
      <button class="btn-back" type="button" @click="goBack">
        <span class="back-arrow">‹</span>
        <span>Back</span>
      </button>
    </div>

    <div class="debug-card card">
      <header class="debug-header">
        <div class="brand-badge-row">
          <span class="debug-icon-badge">🐞</span>
          <span class="badge badge-neutral">System Console</span>
        </div>
        <h1 class="debug-title">Nostr & Network Diagnostics</h1>
        <p class="debug-subtitle">
          Real-time inspect NIP-07 browser extension state, local nsec signer status, and live application logs.
        </p>
      </header>

      <!-- Diagnostic Status Grid -->
      <section class="diag-summary-box">
        <div class="diag-grid">
          <div class="diag-item">
            <span class="diag-label">NIP-07 window.nostr</span>
            <span
              class="badge"
              :class="diagnostics.hasNostr ? 'badge-success' : 'badge-danger'"
            >
              {{ diagnostics.hasNostr ? 'Detected' : 'Not Detected' }}
            </span>
          </div>

          <div class="diag-item">
            <span class="diag-label">Extension Type</span>
            <span class="mono-val">{{ diagnostics.nostrType || 'None' }}</span>
          </div>

          <div class="diag-item">
            <span class="diag-label">Available Methods</span>
            <span class="mono-val">
              {{ diagnostics.methods?.length > 0 ? diagnostics.methods.join(', ') : 'None' }}
            </span>
          </div>

          <div class="diag-item">
            <span class="diag-label">Active Relays</span>
            <span class="mono-val">{{ diagnostics.activeRelays?.length || 0 }} configured</span>
          </div>

          <div class="diag-item">
            <span class="diag-label">Local nsec Signer</span>
            <span
              class="badge"
              :class="diagnostics.localSignerConnected ? 'badge-success' : 'badge-neutral'"
            >
              {{ diagnostics.localSignerConnected ? 'Connected' : 'Not Active' }}
            </span>
          </div>

          <div class="diag-item">
            <span class="diag-label">Active Auth</span>
            <span class="mono-val">{{ authStore.authType || 'Anonymous' }}</span>
          </div>
        </div>

        <div class="diag-actions-row">
          <button
            class="btn btn-primary btn-sm"
            type="button"
            :disabled="isTestingExtension"
            @click="testExtension"
          >
            {{ isTestingExtension ? 'Testing Extension...' : '🧪 Test Extension Call' }}
          </button>
        </div>

        <div v-if="testResult" class="test-result-box" :class="testResult.success ? 'is-success' : 'is-error'">
          <strong>{{ testResult.success ? '✓ Extension Test Passed' : '✗ Extension Test Failed' }}</strong>
          <pre class="test-msg">{{ testResult.message }}</pre>
        </div>
      </section>

      <!-- Live Debug Log Terminal -->
      <section class="log-section">
        <div class="log-header">
          <div class="log-title-wrap">
            <h2 class="log-title">Live Log Console</h2>
            <span class="log-count-chip">{{ logs.length }} events</span>
          </div>
          <div class="log-actions">
            <button class="btn btn-sm btn-outline" type="button" @click="handleCopyLogs">
              {{ copied ? '✓ Copied' : '📋 Copy All' }}
            </button>
            <button class="btn btn-sm btn-secondary" type="button" @click="handleClearLogs">
              Clear
            </button>
          </div>
        </div>

        <div ref="logContainer" class="log-terminal">
          <div v-if="logs.length === 0" class="log-empty">
            No logs recorded yet. Perform an action like clicking "Connect" or tracking media to stream diagnostic logs.
          </div>
          <div
            v-for="log in logs"
            :key="log.id"
            class="log-row"
            :class="`log-${log.level}`"
          >
            <span class="log-time">{{ log.timestamp }}</span>
            <span class="log-level">{{ log.level.toUpperCase() }}</span>
            <span class="log-tag">[{{ log.tag }}]</span>
            <span class="log-msg">{{ log.message }}</span>
            <pre v-if="log.data" class="log-data">{{ JSON.stringify(log.data, null, 2) }}</pre>
          </div>
        </div>
      </section>

      <!-- Footer -->
      <footer class="debug-footer">
        <router-link to="/settings" class="btn btn-outline btn-sm">
          ⚙️ Open Settings
        </router-link>
        <button class="btn btn-secondary btn-sm" type="button" @click="goBack">
          Back
        </button>
      </footer>
    </div>
  </div>
</template>

<style scoped>
.debug-page-wrap {
  max-width: 960px;
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

.debug-card {
  padding: 32px 28px;
  background: var(--bg-surface);
  border: 1px solid var(--border-subtle);
  border-radius: var(--radius-lg);
  box-shadow: var(--shadow-lg);
}

.debug-header {
  margin-bottom: 28px;
}

.brand-badge-row {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 12px;
}

.debug-icon-badge {
  font-size: 1rem;
}

.debug-title {
  font-size: 1.75rem;
  font-weight: 700;
  letter-spacing: -0.03em;
  margin: 0 0 8px 0;
  color: var(--text-main);
}

.debug-subtitle {
  font-size: 0.9rem;
  color: var(--text-muted);
  line-height: 1.5;
  margin: 0;
}

.diag-summary-box {
  background: var(--bg-card);
  border: 1px solid var(--border-subtle);
  border-radius: var(--radius-md);
  padding: 20px;
  margin-bottom: 32px;
}

.diag-grid {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 16px;
  margin-bottom: 18px;
}

.diag-item {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.diag-label {
  font-size: 0.76rem;
  color: var(--text-secondary);
  text-transform: uppercase;
  font-weight: 600;
  letter-spacing: 0.04em;
}

.mono-val {
  font-family: var(--font-mono);
  font-size: 0.85rem;
  color: var(--accent-sky);
  word-break: break-all;
}

.diag-actions-row {
  display: flex;
  gap: 10px;
  justify-content: flex-end;
  border-top: 1px solid var(--border-subtle);
  padding-top: 14px;
}

.test-result-box {
  margin-top: 14px;
  padding: 14px 16px;
  border-radius: var(--radius-sm);
  font-size: 0.86rem;
}

.test-result-box.is-success {
  background: rgba(16, 185, 129, 0.12);
  border: 1px solid rgba(16, 185, 129, 0.3);
  color: var(--accent-emerald);
}

.test-result-box.is-error {
  background: rgba(244, 63, 94, 0.12);
  border: 1px solid rgba(244, 63, 94, 0.3);
  color: var(--accent-rose);
}

.test-msg {
  font-family: var(--font-mono);
  margin-top: 8px;
  font-size: 0.82rem;
  white-space: pre-wrap;
  line-height: 1.4;
}

.log-section {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.log-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.log-title-wrap {
  display: flex;
  align-items: center;
  gap: 10px;
}

.log-title {
  font-size: 1.05rem;
  font-weight: 600;
  margin: 0;
  color: var(--text-main);
}

.log-count-chip {
  font-family: var(--font-mono);
  font-size: 0.72rem;
  background: var(--bg-card);
  color: var(--text-muted);
  border: 1px solid var(--border-subtle);
  padding: 2px 7px;
  border-radius: var(--radius-xs);
}

.log-actions {
  display: flex;
  gap: 8px;
}

.log-terminal {
  background: #000000;
  border: 1px solid var(--border-subtle);
  border-radius: var(--radius-md);
  padding: 16px;
  height: 380px;
  overflow-y: auto;
  font-family: var(--font-mono);
  font-size: 0.8rem;
  line-height: 1.5;
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.log-empty {
  color: var(--text-muted);
  text-align: center;
  padding: 60px 16px;
}

.log-row {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  align-items: baseline;
}

.log-time {
  color: var(--text-muted);
}

.log-level {
  font-weight: 700;
  font-size: 0.72rem;
  padding: 1px 4px;
  border-radius: 2px;
}

.log-tag {
  color: var(--primary);
  font-weight: 600;
}

.log-info .log-level {
  background: rgba(14, 165, 233, 0.2);
  color: var(--accent-sky);
}

.log-warn .log-level {
  background: rgba(245, 158, 11, 0.2);
  color: var(--accent-amber);
}

.log-warn .log-msg {
  color: var(--accent-amber);
}

.log-error .log-level {
  background: rgba(244, 63, 94, 0.2);
  color: var(--accent-rose);
}

.log-error .log-msg {
  color: var(--accent-rose);
  font-weight: 600;
}

.log-debug .log-level {
  background: rgba(100, 116, 139, 0.2);
  color: var(--text-muted);
}

.log-data {
  width: 100%;
  color: var(--text-secondary);
  background: rgba(255, 255, 255, 0.03);
  padding: 6px 10px;
  border-radius: 4px;
  margin-top: 4px;
  white-space: pre-wrap;
}

.debug-footer {
  display: flex;
  align-items: center;
  justify-content: space-between;
  border-top: 1px solid var(--border-subtle);
  margin-top: 28px;
  padding-top: 20px;
}

@media (max-width: 768px) {
  .debug-card {
    padding: 24px 18px;
  }

  .diag-grid {
    grid-template-columns: 1fr 1fr;
  }

  .diag-actions-row {
    flex-direction: column;
  }

  .diag-actions-row .btn {
    width: 100%;
  }

  .log-terminal {
    height: 280px;
  }
}

@media (max-width: 480px) {
  .diag-grid {
    grid-template-columns: 1fr;
  }
}
</style>
