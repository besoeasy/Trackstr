<script setup>
import { ref, onMounted, onUnmounted, nextTick } from 'vue'
import { useAuthStore } from '@/stores/auth.js'
import { nostrClient } from '@/services/nostr/client.js'
import { bunkerService } from '@/services/nostr/bunker.js'
import { getLogs, clearLogs, subscribeLogs, logger } from '@/utils/logger.js'

const emit = defineEmits(['close'])

const authStore = useAuthStore()
const logs = ref(getLogs())
const logContainer = ref(null)
const diagnostics = ref(nostrClient.getDiagnostics())
const isTestingExtension = ref(false)
const isTestingBunker = ref(false)
const testResult = ref(null)
const copied = ref(false)

let unsubscribe = null

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
        '2. Extension is disabled or does not have permission for localhost/current domain.\n' +
        '3. Extension has an active incognito restriction.\n' +
        '4. Browser shields/brave shields blocked scripts.'
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

async function testBunker() {
  isTestingBunker.value = true
  testResult.value = null
  logger.info('Diagnostics', 'Running Bunker connection test...')

  try {
    diagnostics.value = nostrClient.getDiagnostics()
    if (!bunkerService.isConnected()) {
      throw new Error('No active Bunker session connected. Log in via Bunker (NIP-46) first.')
    }

    logger.info('Diagnostics', 'Calling bunker.getPublicKey()...')
    const pk = await bunkerService.getPublicKey()
    testResult.value = {
      success: true,
      message: `Success! Bunker responded with public key: ${pk}`,
    }
    logger.info('Diagnostics', `Bunker test passed! Pubkey: ${pk}`)
  } catch (err) {
    const msg = err?.message || String(err)
    testResult.value = {
      success: false,
      message: msg,
    }
    logger.error('Diagnostics', `Bunker test failed: ${msg}`, err)
  } finally {
    isTestingBunker.value = false
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
  <div class="modal-overlay" @click.self="$emit('close')">
    <div class="modal-dialog modal-debug">
      <div class="sheet-drag-handle"></div>
      <div class="modal-header">
        <div class="header-left">
          <span class="debug-badge">🐞</span>
          <h2 class="modal-title">Nostr Extension & Network Diagnostics</h2>
        </div>
        <button class="btn btn-icon" type="button" @click="$emit('close')">✕</button>
      </div>

      <div class="modal-body">
        <!-- Diagnostic Summary -->
        <div class="diag-summary card">
          <div class="diag-grid">
            <div class="diag-item">
              <span class="diag-label">NIP-07 window.nostr:</span>
              <span
                class="badge"
                :class="diagnostics.hasNostr ? 'badge-success' : 'badge-danger'"
              >
                {{ diagnostics.hasNostr ? 'Detected' : 'Not Detected' }}
              </span>
            </div>

            <div class="diag-item">
              <span class="diag-label">Type:</span>
              <span class="mono-val">{{ diagnostics.nostrType }}</span>
            </div>

            <div class="diag-item">
              <span class="diag-label">Available Methods:</span>
              <span class="mono-val">
                {{ diagnostics.methods?.length > 0 ? diagnostics.methods.join(', ') : 'None' }}
              </span>
            </div>

            <div class="diag-item">
              <span class="diag-label">Active Relays:</span>
              <span class="mono-val">{{ diagnostics.activeRelays?.length || 0 }} configured</span>
            </div>

            <div class="diag-item">
              <span class="diag-label">NIP-46 Bunker:</span>
              <span
                class="badge"
                :class="diagnostics.bunkerConnected ? 'badge-success' : 'badge-neutral'"
              >
                {{ diagnostics.bunkerConnected ? 'Connected' : 'Not Active' }}
              </span>
            </div>

            <div class="diag-item">
              <span class="diag-label">Active Auth Method:</span>
              <span class="mono-val">{{ authStore.authType || 'None' }}</span>
            </div>
          </div>

          <div class="diag-actions">
            <button
              class="btn btn-primary btn-sm"
              type="button"
              :disabled="isTestingExtension || isTestingBunker"
              @click="testExtension"
            >
              {{ isTestingExtension ? 'Testing Extension...' : '🧪 Test Extension Call' }}
            </button>

            <button
              v-if="diagnostics.bunkerConnected"
              class="btn btn-outline btn-sm"
              type="button"
              :disabled="isTestingExtension || isTestingBunker"
              @click="testBunker"
            >
              {{ isTestingBunker ? 'Testing Bunker...' : '⚡ Test Bunker Call' }}
            </button>
          </div>

          <div v-if="testResult" class="test-result-box" :class="testResult.success ? 'is-success' : 'is-error'">
            <strong>{{ testResult.success ? '✓ Extension Test Passed' : '✗ Extension Test Failed' }}</strong>
            <pre class="test-msg">{{ testResult.message }}</pre>
          </div>
        </div>

        <!-- Live Debug Log Viewer -->
        <div class="log-section">
          <div class="log-header">
            <h4 class="log-title">Live Debug Console ({{ logs.length }} events)</h4>
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
              No logs recorded yet. Perform an action like clicking "Connect Nostr" to generate logs.
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
        </div>
      </div>

      <div class="modal-footer">
        <button class="btn btn-secondary" type="button" @click="$emit('close')">Close</button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.modal-debug {
  max-width: 820px;
}

.header-left {
  display: flex;
  align-items: center;
  gap: 8px;
}

.debug-badge {
  font-size: 1.25rem;
}

.diag-summary {
  margin-bottom: 20px;
  background: var(--bg-card);
}

.diag-grid {
  display: grid;
  grid-template-columns: repeat(2, 1fr);
  gap: 12px;
  margin-bottom: 14px;
}

@media (max-width: 600px) {
  .diag-grid {
    grid-template-columns: 1fr;
  }
}

.diag-item {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.diag-label {
  font-size: 0.78rem;
  color: var(--text-secondary);
  text-transform: uppercase;
  font-weight: 600;
  letter-spacing: 0.03em;
}

.mono-val {
  font-family: var(--font-mono);
  font-size: 0.85rem;
  color: var(--accent-sky);
  word-break: break-all;
}

.diag-actions {
  display: flex;
  justify-content: flex-end;
  border-top: 1px solid var(--border-subtle);
  padding-top: 12px;
}

.test-result-box {
  margin-top: 12px;
  padding: 12px 14px;
  border-radius: var(--radius-sm);
  font-size: 0.85rem;
}

.test-result-box.is-success {
  background: rgba(16, 185, 129, 0.15);
  border: 1px solid rgba(16, 185, 129, 0.3);
  color: var(--accent-emerald);
}

.test-result-box.is-error {
  background: rgba(244, 63, 94, 0.15);
  border: 1px solid rgba(244, 63, 94, 0.3);
  color: var(--accent-rose);
}

.test-msg {
  font-family: var(--font-mono);
  margin-top: 6px;
  font-size: 0.8rem;
  white-space: pre-wrap;
  line-height: 1.4;
}

.log-section {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.log-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.log-title {
  font-size: 0.95rem;
  font-weight: 600;
}

.log-actions {
  display: flex;
  gap: 8px;
}

.log-terminal {
  background: #05070a;
  border: 1px solid var(--border-subtle);
  border-radius: var(--radius-sm);
  padding: 12px;
  height: 260px;
  overflow-y: auto;
  font-family: var(--font-mono);
  font-size: 0.78rem;
  line-height: 1.5;
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.log-empty {
  color: var(--text-muted);
  text-align: center;
  padding: 40px 10px;
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
  padding: 4px 8px;
  border-radius: 4px;
  margin-top: 2px;
  white-space: pre-wrap;
}

@media (max-width: 640px) {
  .diag-grid {
    grid-template-columns: 1fr;
  }

  .test-actions {
    flex-direction: column;
  }

  .test-actions .btn {
    width: 100%;
  }

  .header-left {
    gap: 8px;
  }

  .modal-title {
    font-size: 1.05rem;
  }
}
</style>
