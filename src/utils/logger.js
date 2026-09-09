/**
 * Trackstr Debug Logger
 * Captures logs in console and in-memory buffer for UI diagnostics.
 */

const MAX_LOGS = 100
const logsBuffer = []
const listeners = new Set()

// Scrub session secrets / API keys out of anything that reaches the log
// buffer, clipboard export, or browser console. Hex pubkeys are public by
// design and are intentionally left intact for diagnostics.
const SECRET_VALUE_RE = /([?&;"'`\s(,])(secret|client_secret|token|password|passwd|pwd|api[_-]?key|nsec)([^0-9a-zA-Z]*)([^\s&;"'`,)\\]+)/gi
const SECRET_KEY_RE = /secret|token|password|nsec|api[_-]?key/i

function redactSecrets(value) {
  if (typeof value === 'string') {
    return value.replace(SECRET_VALUE_RE, '$1$2$3***')
  }
  if (Array.isArray(value)) {
    return value.map(redactSecrets)
  }
  if (value && typeof value === 'object') {
    const out = {}
    for (const [k, v] of Object.entries(value)) {
      out[k] = SECRET_KEY_RE.test(k) && typeof v === 'string' ? '***' : redactSecrets(v)
    }
    return out
  }
  return value
}

export function addLog(level, tag, message, data = null) {
  const safeMessage = typeof message === 'string' ? redactSecrets(message) : message
  const entry = {
    id: Math.random().toString(36).substring(7),
    timestamp: new Date().toLocaleTimeString(),
    level, // 'info' | 'warn' | 'error' | 'debug'
    tag,
    message: safeMessage,
    data: data ? redactSecrets(typeof data === 'object' ? JSON.parse(JSON.stringify(data, getCircularReplacer())) : data) : null,
  }

  logsBuffer.push(entry)
  if (logsBuffer.length > MAX_LOGS) {
    logsBuffer.shift()
  }

  // Notify UI subscribers
  listeners.forEach((fn) => {
    try {
      fn(entry)
    } catch {}
  })

  // Also output to browser console
  const consolePrefix = `[${entry.timestamp}] [${tag}]`
  if (level === 'error') {
    console.error(consolePrefix, message, data || '')
  } else if (level === 'warn') {
    console.warn(consolePrefix, message, data || '')
  } else if (level === 'debug') {
    console.debug(consolePrefix, message, data || '')
  } else {
    console.log(consolePrefix, message, data || '')
  }

  return entry
}

export const logger = {
  info: (tag, msg, data) => addLog('info', tag, msg, data),
  warn: (tag, msg, data) => addLog('warn', tag, msg, data),
  error: (tag, msg, data) => addLog('error', tag, msg, data),
  debug: (tag, msg, data) => addLog('debug', tag, msg, data),
}

export function getLogs() {
  return [...logsBuffer]
}

export function clearLogs() {
  logsBuffer.length = 0
  listeners.forEach((fn) => {
    try {
      fn(null)
    } catch {}
  })
}

export function subscribeLogs(fn) {
  listeners.add(fn)
  return () => listeners.delete(fn)
}

function getCircularReplacer() {
  const seen = new WeakSet()
  return (key, value) => {
    if (typeof value === 'object' && value !== null) {
      if (seen.has(value)) {
        return '[Circular]'
      }
      seen.add(value)
    }
    return value
  }
}
