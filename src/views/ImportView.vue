<script setup>
import { ref, computed, onMounted, onUnmounted } from 'vue'
import { useRouter } from 'vue-router'
import { useAuthStore } from '@/stores/auth.js'
import { useMediaStore } from '@/stores/media.js'
import {
  parseCsvFile,
  parseTraktJson,
  consolidateMediaItems,
} from '@/services/import/parser.js'
import { trickleQueue } from '@/services/import/trickleQueue.js'
import { getImportedItems } from '@/services/db/indexedDb.js'

const router = useRouter()
const authStore = useAuthStore()
const mediaStore = useMediaStore()

// UI state
const isDragging = ref(false)
const isParsing = ref(false)
const parsedFiles = ref([])
const previewItems = ref([])
const consolidatedList = ref([])
const importSuccessMessage = ref('')
const errorMessage = ref('')
const showFormatGuide = ref(false)
const totalSkippedCount = ref(0)

const CSV_TEMPLATE = `Title,Year,Type,Artist,Status,Rating,Review,Date,Spoiler
Fight Club,1999,movie,,completed,8,Timeless masterpiece,1999-10-15,no
Severance,2022,show,,watching,9.5,Engrossing mystery,2022-03-01,no
OK Computer,1997,music,Radiohead,completed,10,Iconic album,1997-05-21,no
Inception,2010,movie,,plan-to-watch,,,,no`

function downloadTemplate() {
  const blob = new Blob([CSV_TEMPLATE], { type: 'text/csv;charset=utf-8;' })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.setAttribute('href', url)
  link.setAttribute('download', 'trackstr_template.csv')
  document.body.appendChild(link)
  link.click()
  document.body.removeChild(link)
  URL.revokeObjectURL(url)
}

// Trickle queue live state
const queueState = ref(trickleQueue.getState())
let unsubscribeQueue = null

onMounted(async () => {
  unsubscribeQueue = trickleQueue.subscribe((state) => {
    queueState.value = state
  })
  await trickleQueue.refreshStats()

  // Load existing local imported items if any
  try {
    const existing = await getImportedItems()
    if (existing && existing.length > 0 && consolidatedList.value.length === 0) {
      previewItems.value = existing.slice(0, 5)
    }
  } catch (err) {
    console.warn('Could not read existing imported items:', err)
  }
})

onUnmounted(() => {
  if (unsubscribeQueue) {
    unsubscribeQueue()
  }
})

// Drag and drop handlers
function onDragOver(e) {
  e.preventDefault()
  isDragging.value = true
}

function onDragLeave(e) {
  e.preventDefault()
  isDragging.value = false
}

async function onDrop(e) {
  e.preventDefault()
  isDragging.value = false
  const files = Array.from(e.dataTransfer?.files || [])
  if (files.length > 0) {
    await processFiles(files)
  }
}

async function onFileInputChange(e) {
  const files = Array.from(e.target?.files || [])
  if (files.length > 0) {
    await processFiles(files)
  }
}

/**
 * Reads and parses uploaded files
 */
async function processFiles(files) {
  isParsing.value = true
  errorMessage.value = ''
  importSuccessMessage.value = ''
  totalSkippedCount.value = 0

  const allParsed = []
  const fileSummaries = []

  for (const file of files) {
    try {
      const text = await readFileAsText(file)
      let parsed = []

      if (file.name.endsWith('.json')) {
        parsed = parseTraktJson(text)
      } else {
        parsed = parseCsvFile(text, file.name)
      }

      const skippedInFile = parsed.skippedCount || 0
      totalSkippedCount.value += skippedInFile

      if (parsed.length > 0) {
        allParsed.push(...parsed)
        fileSummaries.push({
          name: file.name,
          count: parsed.length,
          skipped: skippedInFile,
          type: file.name.endsWith('.json') ? 'Trakt JSON' : 'CSV',
        })
      } else if (skippedInFile > 0) {
        fileSummaries.push({
          name: file.name,
          count: 0,
          skipped: skippedInFile,
          type: file.name.endsWith('.json') ? 'Trakt JSON' : 'CSV',
        })
      }
    } catch (err) {
      console.warn(`Failed to parse file ${file.name}:`, err)
      errorMessage.value = `Failed to parse ${file.name}: ${err.message || 'Invalid format'}`
    }
  }

  if (allParsed.length === 0 && !errorMessage.value) {
    errorMessage.value = totalSkippedCount.value > 0
      ? `No valid media entries found. ${totalSkippedCount.value} item(s) were skipped because they lacked mandatory Title, valid 4-digit release Year, or valid Type.`
      : 'No valid media entries found in the uploaded file(s).'
    isParsing.value = false
    return
  }

  parsedFiles.value = fileSummaries

  // Consolidate duplicates & compute contentId
  try {
    const consolidated = await consolidateMediaItems(allParsed)
    consolidatedList.value = consolidated
    previewItems.value = consolidated.slice(0, 6)
  } catch (err) {
    errorMessage.value = `Failed to process media items: ${err.message}`
  } finally {
    isParsing.value = false
  }
}

function readFileAsText(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(reader.result)
    reader.onerror = () => reject(reader.error)
    reader.readAsText(file)
  })
}

// Stats computed
const totalParsedCount = computed(() => consolidatedList.value.length)
const totalRatingsCount = computed(() => consolidatedList.value.filter((i) => i.rating !== null && i.rating !== undefined).length)
const totalReviewsCount = computed(() => consolidatedList.value.filter((i) => i.review && i.review.trim()).length)
const totalWatchlistCount = computed(() => consolidatedList.value.filter((i) => i.status === 'plan-to-watch').length)

// Queue calculations
const progressPercent = computed(() => {
  const total = queueState.value.stats.total
  const synced = queueState.value.stats.synced
  if (!total || total === 0) return 0
  return Math.min(100, Math.round((synced / total) * 100))
})

/**
 * Saves all parsed media directly into local database and starts trickle sync
 */
async function handleImportToLibrary() {
  if (consolidatedList.value.length === 0) return

  errorMessage.value = ''
  try {
    // Convert reactive list to plain vanilla JavaScript objects to prevent Vue proxy clone errors in IndexedDB
    const plainItems = JSON.parse(JSON.stringify(consolidatedList.value))

    // 1. Immediately inject into Pinia media store & local storage
    mediaStore.importLocalMedia(plainItems, authStore.pubkey)

    // 2. Enqueue into IndexedDB for paced background relay sync
    const { enqueuedCount } = await trickleQueue.enqueueItems(plainItems)

    importSuccessMessage.value = `Successfully saved ${plainItems.length} media items to your local library! You can start viewing them immediately.`

    // 3. Automatically start the trickle queue if authenticated
    if (authStore.isAuthenticated) {
      trickleQueue.start({ mediaStore })
    }
  } catch (err) {
    errorMessage.value = `Import error: ${err.message || String(err)}`
  }
}

function handlePauseSync() {
  trickleQueue.pause()
}

function handleResumeSync() {
  if (!authStore.isAuthenticated) {
    router.push({ path: '/connect', query: { returnTo: '/import' } })
    return
  }
  trickleQueue.resume({ mediaStore })
}

function handleRetryFailed() {
  trickleQueue.retryFailed({ mediaStore })
}

function handleClearQueue() {
  if (confirm('Are you sure you want to clear the pending sync queue? Local library data will remain intact.')) {
    trickleQueue.clear()
    consolidatedList.value = []
    parsedFiles.value = []
  }
}

function handlePaceChange(e) {
  const ms = parseInt(e.target.value, 10)
  trickleQueue.setPace(ms)
}

function navigateToLibrary() {
  router.push('/library')
}
</script>

<template>
  <div class="import-page-wrap">
    <div class="page-top-nav">
      <button class="btn-back" type="button" @click="router.push('/library')">
        <span class="back-arrow">‹</span>
        <span>Back to Library</span>
      </button>
    </div>

    <div class="import-container">
      <header class="import-header">
        <div class="brand-badge-row">
          <span class="import-icon-badge">📥</span>
          <span class="badge badge-primary">Data Portability</span>
          <span class="badge badge-secondary">Nostr-Native</span>
        </div>
        <h1 class="import-title">Import Media Library</h1>
        <p class="import-subtitle">
          Import your watched history, ratings, and reviews from Trackstr CSV or Trakt JSON.
          Because Trackstr is <strong>100% Nostr-based</strong>, every item strictly requires <strong>Title</strong>, <strong>Year</strong> (4-digit), and <strong>Type</strong> (movie, show, music) for canonical addressing.
        </p>
      </header>

      <!-- Auth and Signer Tips -->
      <div v-if="!authStore.isAuthenticated" class="alert alert-warning auth-notice-banner">
        <span>⚠️ You are not connected. You can import to your local browser library now, but connect a Nostr account to sync across relays.</span>
        <router-link to="/connect?returnTo=/import" class="btn btn-sm btn-primary ml-auto">
          Connect Account
        </router-link>
      </div>

      <div v-else-if="authStore.authType === 'nsec'" class="alert alert-success auth-notice-banner">
        <span>🔑 <strong>Local nsec Signer active:</strong> Background sync will sign and broadcast smoothly without any popup interruptions.</span>
      </div>

      <div v-else class="alert alert-info auth-notice-banner">
        <span>🧩 <strong>Browser Extension active:</strong> For smooth bulk syncing, ensure your extension is configured with "Always Allow" for Trackstr, or use your nsec key to avoid repeated signing popups.</span>
      </div>

      <!-- Trackstr Strict Schema & CSV Format Guide Card -->
      <div class="format-guide-card card">
        <div class="format-guide-header">
          <div class="format-guide-title-wrap">
            <span class="guide-icon">📐</span>
            <div>
              <h2 class="format-guide-title">Trackstr Strict Metadata Rules & CSV Format</h2>
              <p class="format-guide-desc">
                Nostr Content IDs are byte-exact SHA-256 hashes generated from <code>&lt;type&gt;|&lt;title&gt;|&lt;year&gt;</code>. <strong>Title</strong>, <strong>Year</strong>, and <strong>Type</strong> are strictly mandatory headers. Rows missing any of these are skipped because they cannot be addressed on Nostr.
              </p>
            </div>
          </div>
          <div class="format-guide-actions">
            <button class="btn btn-sm btn-secondary" type="button" @click="downloadTemplate">
              📥 Download Sample CSV
            </button>
            <button class="btn btn-sm btn-outline" type="button" @click="showFormatGuide = !showFormatGuide">
              {{ showFormatGuide ? 'Hide Specification ▲' : 'View Format Spec ▼' }}
            </button>
          </div>
        </div>

        <div v-if="showFormatGuide" class="format-details-body">
          <div class="format-table-wrap">
            <table class="format-table">
              <thead>
                <tr>
                  <th>Column</th>
                  <th>Requirement</th>
                  <th>Description & Accepted Values</th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td><code>Title</code></td>
                  <td><span class="badge badge-danger">Mandatory</span></td>
                  <td>Display name of the media (must be named exactly <code>Title</code>).</td>
                </tr>
                <tr>
                  <td><code>Year</code></td>
                  <td><span class="badge badge-danger">Mandatory</span></td>
                  <td>4-digit release or first-air year (e.g. <code>1999</code>).</td>
                </tr>
                <tr>
                  <td><code>Type</code></td>
                  <td><span class="badge badge-danger">Mandatory</span></td>
                  <td>Media type: <code>movie</code>, <code>show</code>, or <code>music</code>.</td>
                </tr>
                <tr>
                  <td><code>Artist</code></td>
                  <td><span class="badge badge-warning">Required for Music</span></td>
                  <td>Artist or creator name (mandatory when <code>Type=music</code>).</td>
                </tr>
                <tr>
                  <td><code>Status</code></td>
                  <td><span class="badge badge-secondary">Optional</span></td>
                  <td><code>completed</code> (default), <code>watching</code>, <code>plan-to-watch</code>, <code>on-hold</code>, <code>dropped</code>, <code>listening</code>, <code>plan-to-listen</code>.</td>
                </tr>
                <tr>
                  <td><code>Rating</code></td>
                  <td><span class="badge badge-secondary">Optional</span></td>
                  <td>1 to 10 scale (half steps e.g. <code>8.5</code>; Letterboxd 0.5–5.0 stars are auto-scaled ×2).</td>
                </tr>
                <tr>
                  <td><code>Review</code></td>
                  <td><span class="badge badge-secondary">Optional</span></td>
                  <td>Written review text or personal notes.</td>
                </tr>
                <tr>
                  <td><code>Date</code></td>
                  <td><span class="badge badge-secondary">Optional</span></td>
                  <td>Watched / logged date (<code>YYYY-MM-DD</code>).</td>
                </tr>
                <tr>
                  <td><code>Spoiler</code></td>
                  <td><span class="badge badge-secondary">Optional</span></td>
                  <td><code>yes</code> / <code>no</code> (or <code>1</code> / <code>0</code>, <code>true</code> / <code>false</code>).</td>
                </tr>
              </tbody>
            </table>
          </div>

          <div class="code-example-wrap mt-3">
            <div class="code-header">
              <span>Example Trackstr Multi-Media CSV (<code>trackstr_template.csv</code>)</span>
            </div>
            <pre class="csv-example-code"><code>Title,Year,Type,Artist,Status,Rating,Review,Date,Spoiler
Fight Club,1999,movie,,completed,8,Timeless masterpiece,1999-10-15,no
Severance,2022,show,,watching,9.5,Engrossing mystery,2022-03-01,no
OK Computer,1997,music,Radiohead,completed,10,Iconic album,1997-05-21,no
Inception,2010,movie,,plan-to-watch,,,,no</code></pre>
          </div>
        </div>
      </div>

      <!-- Dropzone Area -->
      <div
        class="import-dropzone card"
        :class="{ 'is-dragging': isDragging, 'is-parsing': isParsing }"
        @dragover="onDragOver"
        @dragleave="onDragLeave"
        @drop="onDrop"
      >
        <div class="dropzone-inner">
          <span class="dropzone-icon">📁</span>
          <h2 class="dropzone-title">Drag & drop your export files here</h2>
          <p class="dropzone-hint">
            Upload Trackstr CSV or Trakt JSON. <code>Title</code>, <code>Year</code>, and <code>Type</code> are strictly required headers.
          </p>

          <label class="btn btn-secondary btn-file-pick">
            <span>Browse Files</span>
            <input
              type="file"
              multiple
              accept=".csv,.json"
              class="hidden-file-input"
              @change="onFileInputChange"
            />
          </label>

          <div v-if="isParsing" class="parsing-spinner-row">
            <span class="spinner"></span>
            <span>Parsing files and generating canonical Content IDs...</span>
          </div>
        </div>
      </div>

      <!-- Uploaded Files Badges -->
      <div v-if="parsedFiles.length > 0" class="parsed-files-row">
        <span class="parsed-files-label">Loaded Files:</span>
        <div
          v-for="file in parsedFiles"
          :key="file.name"
          class="badge badge-secondary file-badge"
        >
          📄 {{ file.name }} ({{ file.count }} imported<span v-if="file.skipped > 0">, {{ file.skipped }} skipped</span>)
        </div>
      </div>

      <!-- Skipped Warning Notice -->
      <div v-if="totalSkippedCount > 0" class="alert alert-warning mt-3">
        ⚠️ <strong>Notice:</strong> {{ totalSkippedCount }} row(s) were skipped across your file(s) because they lacked mandatory Title, valid 4-digit release Year, or valid Type required by Nostr.
      </div>

      <!-- Error / Success Messages -->
      <div v-if="errorMessage" class="alert alert-danger mt-3">
        {{ errorMessage }}
      </div>

      <div v-if="importSuccessMessage" class="alert alert-success mt-3 flex-between">
        <span>{{ importSuccessMessage }}</span>
        <button class="btn btn-sm btn-primary" type="button" @click="navigateToLibrary">
          Open Library →
        </button>
      </div>

      <!-- Parsed Summary & Action -->
      <div v-if="totalParsedCount > 0" class="parsed-summary-card card mt-4">
        <div class="summary-header">
          <div>
            <h3 class="summary-title">Import Preview</h3>
            <p class="summary-subtitle">Consolidated across all uploaded files</p>
          </div>
          <button
            class="btn btn-primary btn-lg"
            type="button"
            @click="handleImportToLibrary"
          >
            🍿 Save to Local Library (Instant)
          </button>
        </div>

        <!-- Metric badges -->
        <div class="summary-metrics-grid">
          <div class="metric-card">
            <span class="metric-value">{{ totalParsedCount }}</span>
            <span class="metric-label">🎬 Total Media</span>
          </div>
          <div class="metric-card">
            <span class="metric-value">{{ totalRatingsCount }}</span>
            <span class="metric-label">⭐ Ratings (1-10 Scale)</span>
          </div>
          <div class="metric-card">
            <span class="metric-value">{{ totalReviewsCount }}</span>
            <span class="metric-label">✍️ Written Reviews</span>
          </div>
          <div class="metric-card">
            <span class="metric-value">{{ totalWatchlistCount }}</span>
            <span class="metric-label">📋 Plan to Watch</span>
          </div>
        </div>

        <!-- Sample preview table -->
        <div class="preview-table-wrap mt-3">
          <h4 class="preview-table-title">Sample Entries:</h4>
          <div class="preview-list">
            <div
              v-for="item in previewItems"
              :key="item.contentId"
              class="preview-row"
            >
              <div class="preview-main">
                <span class="preview-title">{{ item.name }}</span>
                <span v-if="item.year" class="preview-year">({{ item.year }})</span>
              </div>
              <div class="preview-meta">
                <span
                  class="badge"
                  :class="item.status === 'completed' ? 'badge-success' : 'badge-primary'"
                >
                  {{ item.status }}
                </span>
                <span v-if="item.rating" class="badge badge-warning">
                  ⭐ {{ item.rating }}/10
                </span>
                <span v-if="item.review" class="badge badge-secondary" :title="item.review">
                  📝 Review
                </span>
              </div>
            </div>
          </div>
        </div>
      </div>

      <!-- Trickle Sync Queue Panel -->
      <div v-if="queueState.stats.total > 0" class="trickle-sync-card card mt-4">
        <div class="sync-panel-header">
          <div class="sync-title-group">
            <span class="sync-pulse-icon" :class="{ 'is-active': queueState.isRunning && !queueState.isPaused }">
              ⚡
            </span>
            <div>
              <h3 class="sync-title">Nostr Relay Background Sync</h3>
              <p class="sync-subtitle">
                Trickling events slowly to avoid relay rate-limits and spam filters.
              </p>
            </div>
          </div>

          <!-- Controls -->
          <div class="sync-controls">
            <button
              v-if="queueState.isRunning && !queueState.isPaused"
              class="btn btn-secondary btn-sm"
              type="button"
              @click="handlePauseSync"
            >
              ⏸ Pause
            </button>
            <button
              v-else
              class="btn btn-primary btn-sm"
              type="button"
              @click="handleResumeSync"
            >
              ▶ Resume Sync
            </button>

            <button
              v-if="queueState.stats.failed > 0"
              class="btn btn-warning btn-sm"
              type="button"
              @click="handleRetryFailed"
            >
              🔄 Retry Failed ({{ queueState.stats.failed }})
            </button>

            <button
              class="btn btn-danger btn-sm"
              type="button"
              @click="handleClearQueue"
            >
              🗑 Clear Queue
            </button>
          </div>
        </div>

        <!-- Progress Bar -->
        <div class="progress-bar-container">
          <div class="progress-bar-track">
            <div
              class="progress-bar-fill"
              :style="{ width: `${progressPercent}%` }"
            ></div>
          </div>
          <div class="progress-bar-stats">
            <span>{{ queueState.stats.synced }} of {{ queueState.stats.total }} actions synced ({{ progressPercent }}%)</span>
            <span>{{ queueState.stats.pending }} remaining</span>
          </div>
        </div>

        <!-- Speed & Status Bar -->
        <div class="sync-status-row">
          <div class="sync-ticker">
            <span v-if="queueState.stats.lastSyncedName" class="ticker-text">
              ✓ Synced: {{ queueState.stats.lastSyncedName }}
            </span>
            <span v-else-if="queueState.isRunning && !queueState.isPaused" class="ticker-text">
              Connecting and streaming events to relays...
            </span>
            <span v-else-if="queueState.isPaused" class="ticker-text text-muted">
              Sync paused.
            </span>
            <span v-else class="ticker-text text-success">
              ✓ All items up to date on relays!
            </span>
          </div>

          <div class="sync-pace-selector">
            <label for="pace-select" class="pace-label">Pace:</label>
            <select
              id="pace-select"
              class="pace-select"
              :value="queueState.paceMs"
              @change="handlePaceChange"
            >
              <option value="500">Fast (2 / sec)</option>
              <option value="1000">Normal (1 / sec) — Recommended</option>
              <option value="2000">Gentle (1 every 2s)</option>
            </select>
          </div>
        </div>

        <div v-if="queueState.stats.lastError" class="sync-error-notice">
          ⚠️ {{ queueState.stats.lastError }}
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.import-page-wrap {
  max-width: 960px;
  margin: 0 auto;
  padding: var(--space-6) var(--space-4);
}

.page-top-nav {
  margin-bottom: var(--space-4);
}

.btn-back {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  background: none;
  border: none;
  color: var(--text-muted);
  font-size: 0.95rem;
  cursor: pointer;
  padding: 4px 8px;
  border-radius: var(--radius-sm);
}

.btn-back:hover {
  color: var(--text-main);
  background: var(--bg-card-hover);
}

.back-arrow {
  font-size: 1.3rem;
  line-height: 1;
}

.import-header {
  margin-bottom: var(--space-6);
}

.brand-badge-row {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  margin-bottom: var(--space-2);
}

.import-icon-badge {
  font-size: 1.25rem;
}

.import-title {
  font-size: 2rem;
  font-weight: 700;
  margin-bottom: var(--space-2);
}

.import-subtitle {
  font-size: 1.05rem;
  color: var(--text-muted);
  line-height: 1.5;
}

.auth-notice-banner {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: var(--space-4);
  padding: var(--space-3) var(--space-4);
  border-radius: var(--radius-md);
  font-size: 0.95rem;
}

.format-guide-card {
  padding: var(--space-4) var(--space-5);
  margin-bottom: var(--space-4);
  border-radius: var(--radius-lg);
  border: 1px solid var(--border-subtle);
  background: var(--bg-card);
}

.format-guide-header {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-3);
}

.format-guide-title-wrap {
  display: flex;
  align-items: flex-start;
  gap: var(--space-3);
  flex: 1;
  min-width: 280px;
}

.guide-icon {
  font-size: 1.5rem;
  line-height: 1.2;
}

.format-guide-title {
  font-size: 1.05rem;
  font-weight: 700;
  margin: 0 0 4px 0;
}

.format-guide-desc {
  font-size: 0.85rem;
  color: var(--text-muted);
  line-height: 1.4;
  margin: 0;
}

.format-guide-actions {
  display: flex;
  align-items: center;
  gap: var(--space-2);
}

.format-details-body {
  border-top: 1px solid var(--border-subtle);
  padding-top: var(--space-4);
  margin-top: var(--space-4);
}

.format-table-wrap {
  overflow-x: auto;
}

.format-table {
  width: 100%;
  border-collapse: collapse;
  font-size: 0.85rem;
}

.format-table th {
  text-align: left;
  padding: 8px 12px;
  background: var(--bg-card-hover);
  color: var(--text-muted);
  font-weight: 600;
  border-bottom: 1px solid var(--border-subtle);
}

.format-table td {
  padding: 8px 12px;
  border-bottom: 1px solid var(--border-subtle);
  color: var(--text-main);
  vertical-align: middle;
}

.format-table tr:last-child td {
  border-bottom: none;
}

.code-example-wrap {
  background: var(--bg-surface);
  border: 1px solid var(--border-subtle);
  border-radius: var(--radius-md);
  overflow: hidden;
}

.code-header {
  padding: 6px 12px;
  background: var(--bg-card-hover);
  border-bottom: 1px solid var(--border-subtle);
  font-size: 0.8rem;
  color: var(--text-muted);
  font-weight: 600;
}

.csv-example-code {
  padding: 12px;
  margin: 0;
  font-family: var(--font-mono);
  font-size: 0.8rem;
  color: var(--text-main);
  overflow-x: auto;
  white-space: pre;
}

.import-dropzone {
  border: 2px dashed var(--border-subtle);
  border-radius: var(--radius-lg);
  padding: var(--space-8);
  text-align: center;
  cursor: pointer;
  transition: border-color 0.2s, background 0.2s;
  background: var(--bg-card);
}

.import-dropzone:hover,
.import-dropzone.is-dragging {
  border-color: var(--primary);
  background: var(--bg-card-hover);
}

.dropzone-inner {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: var(--space-3);
}

.dropzone-icon {
  font-size: 3rem;
}

.dropzone-title {
  font-size: 1.3rem;
  font-weight: 600;
  margin: 0;
}

.dropzone-hint {
  color: var(--text-muted);
  font-size: 0.95rem;
  max-width: 500px;
  margin: 0;
}

.btn-file-pick {
  margin-top: var(--space-2);
  cursor: pointer;
  display: inline-block;
}

.hidden-file-input {
  display: none;
}

.parsing-spinner-row {
  display: flex;
  align-items: center;
  gap: var(--space-3);
  margin-top: var(--space-3);
  color: var(--primary);
  font-size: 0.95rem;
}

.parsed-files-row {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--space-2);
  margin-top: var(--space-3);
}

.parsed-files-label {
  font-size: 0.85rem;
  color: var(--text-muted);
  font-weight: 600;
}

.file-badge {
  font-size: 0.85rem;
}

.parsed-summary-card {
  padding: var(--space-6);
  border-radius: var(--radius-lg);
}

.summary-header {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-4);
  margin-bottom: var(--space-4);
}

.summary-title {
  font-size: 1.3rem;
  font-weight: 700;
  margin: 0;
}

.summary-subtitle {
  color: var(--text-muted);
  font-size: 0.9rem;
  margin: 2px 0 0 0;
}

.summary-metrics-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(160px, 1fr));
  gap: var(--space-3);
}

.metric-card {
  background: var(--bg-card-hover);
  padding: var(--space-4);
  border-radius: var(--radius-md);
  text-align: center;
}

.metric-value {
  display: block;
  font-size: 1.8rem;
  font-weight: 800;
  color: var(--primary);
}

.metric-label {
  display: block;
  font-size: 0.85rem;
  color: var(--text-muted);
  margin-top: 4px;
}

.preview-table-wrap {
  background: var(--bg-card-hover);
  padding: var(--space-4);
  border-radius: var(--radius-md);
}

.preview-table-title {
  font-size: 0.9rem;
  font-weight: 600;
  margin: 0 0 var(--space-2) 0;
  color: var(--text-muted);
}

.preview-list {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.preview-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 6px var(--space-2);
  border-bottom: 1px solid var(--border-subtle);
  font-size: 0.9rem;
}

.preview-row:last-child {
  border-bottom: none;
}

.preview-main {
  display: flex;
  align-items: center;
  gap: 6px;
}

.preview-title {
  font-weight: 600;
}

.preview-year {
  color: var(--text-muted);
}

.preview-meta {
  display: flex;
  align-items: center;
  gap: 6px;
}

.trickle-sync-card {
  padding: var(--space-6);
  border-radius: var(--radius-lg);
  border-left: 4px solid var(--primary);
}

.sync-panel-header {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-4);
  margin-bottom: var(--space-4);
}

.sync-title-group {
  display: flex;
  align-items: center;
  gap: var(--space-3);
}

.sync-pulse-icon {
  font-size: 1.8rem;
  transition: transform 0.2s;
}

.sync-pulse-icon.is-active {
  animation: pulse 1.5s infinite;
}

@keyframes pulse {
  0% { transform: scale(1); opacity: 0.8; }
  50% { transform: scale(1.2); opacity: 1; }
  100% { transform: scale(1); opacity: 0.8; }
}

.sync-title {
  font-size: 1.25rem;
  font-weight: 700;
  margin: 0;
}

.sync-subtitle {
  font-size: 0.85rem;
  color: var(--text-muted);
  margin: 2px 0 0 0;
}

.sync-controls {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--space-2);
}

.progress-bar-container {
  margin-bottom: var(--space-4);
}

.progress-bar-track {
  width: 100%;
  height: 12px;
  background: var(--bg-card-hover);
  border-radius: 6px;
  overflow: hidden;
}

.progress-bar-fill {
  height: 100%;
  background: linear-gradient(90deg, var(--primary), #10b981);
  transition: width 0.3s ease;
}

.progress-bar-stats {
  display: flex;
  justify-content: space-between;
  font-size: 0.85rem;
  color: var(--text-muted);
  margin-top: 6px;
}

.sync-status-row {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-3);
  padding-top: var(--space-2);
  border-top: 1px solid var(--border-subtle);
}

.sync-ticker {
  font-size: 0.9rem;
  font-weight: 500;
}

.ticker-text {
  color: var(--text-main);
}

.sync-pace-selector {
  display: flex;
  align-items: center;
  gap: 6px;
}

.pace-label {
  font-size: 0.85rem;
  color: var(--text-muted);
}

.pace-select {
  padding: 4px 8px;
  border-radius: var(--radius-sm);
  background: var(--bg-card-hover);
  border: 1px solid var(--border-subtle);
  color: var(--text-main);
  font-size: 0.85rem;
}

.sync-error-notice {
  margin-top: var(--space-3);
  font-size: 0.85rem;
  color: #ef4444;
}

.flex-between {
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.ml-auto {
  margin-left: auto;
}

.mt-3 {
  margin-top: var(--space-4);
}

.mt-4 {
  margin-top: var(--space-6);
}

@media (max-width: 640px) {
  .import-page-wrap {
    padding: 4px 0 80px;
  }

  .import-card {
    padding: 20px 16px;
    border-radius: var(--radius-md);
  }

  .import-title {
    font-size: 1.5rem;
  }

  .import-dropzone {
    padding: 24px 16px;
  }

  .dropzone-icon {
    font-size: 2.2rem;
  }

  .dropzone-title {
    font-size: 1.1rem;
  }

  .dropzone-hint {
    font-size: 0.82rem;
  }

  .sync-card {
    padding: 18px 14px;
  }

  .sync-controls {
    width: 100%;
    margin-top: 10px;
  }

  .sync-controls .btn {
    flex: 1;
    justify-content: center;
  }

  .sync-status-row {
    flex-direction: column;
    align-items: flex-start;
    gap: 8px;
  }
}
</style>
