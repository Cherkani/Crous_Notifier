const config = require('../config')
const { sendMail } = require('./mailService')
const { addLog, getState, recordAlertEmailEvent } = require('../store/mysqlStore')

const recentAlerts = new Map()
const ALERT_THROTTLE_MS = Number(process.env.ALERT_THROTTLE_MS || 15 * 60 * 1000)

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

function shouldSend(fingerprint) {
  const key = String(fingerprint || 'runtime').slice(0, 500)
  const now = Date.now()
  const lastSentAt = recentAlerts.get(key) || 0
  if (now - lastSentAt < ALERT_THROTTLE_MS) return false
  recentAlerts.set(key, now)
  return true
}

async function getAlertConfig() {
  let settings = {}
  try {
    const state = await getState()
    settings = state.settings || {}
  } catch {
    settings = {
      operationalAlertsEnabled: process.env.OPERATIONAL_ALERTS_ENABLED || 'true',
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
    enabled: truthy(settings.operationalAlertsEnabled),
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

async function notifyRuntimeError({ source, error, metadata = null }) {
  const normalizedError = formatError(error)
  const subject = `[Crous Automation] ${source || 'runtime'}: ${normalizedError.code || normalizedError.name}`
  const fingerprint = [
    source || 'runtime',
    normalizedError.code,
    normalizedError.message,
  ].join('|')

  if (!shouldSend(fingerprint)) return false

  const alertConfig = await getAlertConfig().catch(() => ({ enabled: false, recipients: [] }))
  if (!alertConfig.enabled || !alertConfig.recipients.length) {
    await recordAlertEmailEvent({
      eventType: 'runtime_error',
      status: 'skipped',
      subject,
      errorMessage: 'Operational alerts disabled, missing recipient, or throttled',
      metadata: { source, originalError: normalizedError.message, ...(metadata || {}) },
    }).catch(() => undefined)
    return false
  }

  const text = [
    'Crous Automation detected a runtime issue.',
    '',
    `Source: ${source || 'runtime'}`,
    `Public URL: ${config.publicBaseUrl || '-'}`,
    `Node env: ${process.env.NODE_ENV || '-'}`,
    `Code: ${normalizedError.code || '-'}`,
    '',
    'Message:',
    normalizedError.message || '-',
    '',
    'Metadata:',
    metadata ? JSON.stringify(metadata, null, 2) : '-',
    '',
    'Stack:',
    normalizedError.stack || '-',
  ].join('\n')

  try {
    await sendMail({ to: alertConfig.recipients, subject, text })
    await recordAlertEmailEvent({
      eventType: 'runtime_error',
      status: 'sent',
      recipients: alertConfig.recipients,
      subject,
      metadata: { source, originalError: normalizedError.message, ...(metadata || {}) },
    })
    await addLog({ type: 'monitoring', message: `Operational alert sent: ${source}`, details: { recipients: alertConfig.recipients } })
    return true
  } catch (sendError) {
    await recordAlertEmailEvent({
      eventType: 'runtime_error',
      status: 'failed',
      recipients: alertConfig.recipients,
      subject,
      errorMessage: sendError.message,
      metadata: { source, originalError: normalizedError.message, ...(metadata || {}) },
    }).catch(() => undefined)
    await addLog({ level: 'error', type: 'monitoring', message: 'Operational alert email failed', details: sendError.message }).catch(() => undefined)
    return false
  }
}

module.exports = {
  notifyRuntimeError,
}
