const fs = require('fs/promises')
const path = require('path')
const config = require('../config')
const { addLog, getState, recordAlertEmailEvent, updateState } = require('../store/mysqlStore')

const recentAlerts = new Map()
const ALERT_THROTTLE_MS = Number(process.env.ALERT_THROTTLE_MS || 15 * 60 * 1000)
const RUNTIME_ALERT_STATE_FILE = path.join(config.dataDir, 'runtime-alert-state.json')
let persistedAlertsLoaded = false

async function loadPersistedAlerts() {
  if (persistedAlertsLoaded) return
  persistedAlertsLoaded = true
  try {
    const raw = await fs.readFile(RUNTIME_ALERT_STATE_FILE, 'utf8')
    const parsed = JSON.parse(raw)
    for (const [key, value] of Object.entries(parsed || {})) {
      const timestamp = Number(value || 0)
      if (timestamp > 0) recentAlerts.set(key, timestamp)
    }
  } catch (error) {
    if (error.code !== 'ENOENT') throw error
  }
}

async function persistAlerts() {
  await fs.mkdir(config.dataDir, { recursive: true })
  const cutoff = Date.now() - ALERT_THROTTLE_MS * 2
  const snapshot = {}
  for (const [key, value] of recentAlerts.entries()) {
    if (value >= cutoff) {
      snapshot[key] = value
      continue
    }
    recentAlerts.delete(key)
  }
  await fs.writeFile(RUNTIME_ALERT_STATE_FILE, JSON.stringify(snapshot, null, 2))
}

function truthy(value) {
  return value === true ||
    value === 1 ||
    value === '1' ||
    String(value || '').toLowerCase() === 'true' ||
    String(value || '').toLowerCase() === 'yes'
}

function splitRecipients(value) {
  return String(value || '')
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean)
}

async function shouldSend(fingerprint) {
  await loadPersistedAlerts().catch(() => undefined)
  const key = String(fingerprint || 'runtime').slice(0, 500)
  const now = Date.now()
  const lastSentAt = recentAlerts.get(key) || 0
  if (now - lastSentAt < ALERT_THROTTLE_MS) return false
  recentAlerts.set(key, now)
  await persistAlerts().catch(() => undefined)
  return true
}

async function getAlertConfig() {
  let settings = {}
  try {
    const state = await getState()
    settings = state.settings || {}
  } catch {
    settings = {
      emailSendingEnabled: process.env.EMAIL_SENDING_ENABLED || 'false',
      operationalAlertsEnabled: process.env.OPERATIONAL_ALERTS_ENABLED || 'false',
      operationalAlertEmail: process.env.OPERATIONAL_ALERT_EMAIL || process.env.ALERT_EMAIL_TO || '',
    }
  }

  const recipients = splitRecipients(
    settings.operationalAlertEmail ||
    process.env.OPERATIONAL_ALERT_EMAIL ||
    process.env.ALERT_EMAIL_TO ||
    settings.defaultEmail
  )

  return {
    enabled: truthy(settings.emailSendingEnabled) && truthy(settings.operationalAlertsEnabled),
    recipients,
  }
}

function formatError(error) {
  if (!error) return { name: 'Error', message: 'Unknown error', stack: '' }
  return {
    name: error.name || 'Error',
    code: error.code || '',
    message: error.message || String(error),
    stack: error.stack || '',
  }
}

async function queueRuntimeIssue({ source, error, metadata = null }) {
  await updateState((draft) => {
    const queue = Array.isArray(draft.settings.emailDailySummaryQueue) ? draft.settings.emailDailySummaryQueue : []
    queue.push({
      id: `${Date.now()}-${Math.random().toString(16).slice(2)}`,
      type: 'runtime_issue',
      watchId: null,
      watchName: source || 'runtime',
      url: '',
      listings: [],
      error: error.message || String(error),
      metadata,
      createdAt: new Date().toISOString(),
    })
    draft.settings.emailDailySummaryQueue = queue.slice(-200)
  })
}

async function notifyRuntimeError({ source, error, metadata = null }) {
  const normalizedError = formatError(error)
  const subject = `[Crous Automation] ${source || 'runtime'}: ${normalizedError.code || normalizedError.name}`
  const fingerprint = [
    source || 'runtime',
    normalizedError.code,
    normalizedError.message,
  ].join('|')

  if (!(await shouldSend(fingerprint))) return false

  const alertConfig = await getAlertConfig().catch(() => ({ enabled: false, recipients: [] }))
  if (!alertConfig.enabled || !alertConfig.recipients.length) {
    await recordAlertEmailEvent({
      eventType: 'runtime_error',
      status: 'skipped',
      subject,
      errorMessage: 'Email sending disabled, operational alerts disabled, missing recipient, or throttled',
      metadata: { source, originalError: normalizedError.message, ...(metadata || {}) },
    }).catch(() => undefined)
    await addLog({ level: 'error', type: 'monitoring', message: `Runtime issue detected: ${source || 'runtime'}`, details: normalizedError }).catch(() => undefined)
    return false
  }

  await queueRuntimeIssue({
    source: source || 'runtime',
    error: normalizedError.message,
    metadata: {
      source: source || 'runtime',
      code: normalizedError.code || normalizedError.name,
      publicBaseUrl: config.publicBaseUrl || '',
      nodeEnv: process.env.NODE_ENV || '',
      originalMetadata: metadata || null,
    },
  }).catch(() => undefined)

  await recordAlertEmailEvent({
    eventType: 'runtime_error',
    status: 'queued',
    recipients: alertConfig.recipients,
    subject,
    metadata: { source, originalError: normalizedError.message, ...(metadata || {}) },
  }).catch(() => undefined)
  await addLog({ level: 'error', type: 'monitoring', message: `Operational alert queued for daily email summary: ${source || 'runtime'}`, details: normalizedError }).catch(() => undefined)
  return true
}

module.exports = {
  notifyRuntimeError,
}
