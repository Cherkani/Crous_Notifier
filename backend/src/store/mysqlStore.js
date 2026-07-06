const { withTransaction, getPool } = require('../db/pool')

const DEFAULT_STATE = {
  watches: [],
  logs: [],
  settings: {
    whatsappPhone: '',
    defaultEmail: '',
    defaultWhatsAppRecipient: '',
    operationalAlertsEnabled: true,
    operationalAlertEmail: '',
    notificationTemplate: 'Nouveau logement Crous disponible:\\n{items}\\n\\nRecherche: {url}',
  },
  whatsappAuth: {},
}

let writeQueue = Promise.resolve()

function clone(value) {
  return structuredClone(value)
}

function toIso(value) {
  if (!value) return null
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString()
}

function toDate(value) {
  return value ? new Date(value) : null
}

function parseJson(value, fallback) {
  if (value === null || value === undefined) return fallback
  if (typeof value !== 'string') return value
  try {
    return JSON.parse(value)
  } catch {
    return fallback
  }
}

async function getStateFromConnection(connection) {
  const [settingsRows] = await connection.query('SELECT setting_key, setting_value FROM app_settings')
  const [watchRows] = await connection.query('SELECT * FROM watches ORDER BY created_at DESC')
  const [logRows] = await connection.query('SELECT * FROM app_logs ORDER BY created_at DESC LIMIT 500')
  const [authRows] = await connection.query('SELECT auth_key, payload FROM whatsapp_auth')
  const [alertRows] = await connection.query('SELECT * FROM alert_email_events ORDER BY created_at DESC LIMIT 100')
  const [deliveryRows] = await connection.query('SELECT * FROM delivery_events ORDER BY created_at DESC LIMIT 100')
  const [checkRows] = await connection.query('SELECT * FROM check_events ORDER BY created_at DESC LIMIT 100')
  const [deliveryMetricRows] = await connection.query(`
    SELECT
      channel,
      status,
      COUNT(*) AS count,
      SUM(created_at >= DATE_SUB(UTC_TIMESTAMP(3), INTERVAL 24 HOUR)) AS count_24h
    FROM delivery_events
    GROUP BY channel, status
  `)
  const [checkMetricRows] = await connection.query(`
    SELECT
      COUNT(*) AS total_checks,
      COALESCE(SUM(status = 'success'), 0) AS successful_checks,
      COALESCE(SUM(status = 'error'), 0) AS failed_checks,
      COALESCE(SUM(found_count > 0), 0) AS checks_with_results,
      COALESCE(SUM(new_count), 0) AS new_listing_count,
      COALESCE(SUM(created_at >= DATE_SUB(UTC_TIMESTAMP(3), INTERVAL 24 HOUR)), 0) AS checks_24h,
      COALESCE(SUM(created_at >= DATE_SUB(UTC_TIMESTAMP(3), INTERVAL 24 HOUR) AND found_count > 0), 0) AS found_24h
    FROM check_events
  `)

  const settings = { ...DEFAULT_STATE.settings }
  for (const row of settingsRows) {
    settings[row.setting_key] = parseJson(row.setting_value, row.setting_value)
  }

  const watches = watchRows.map((row) => ({
    id: row.id,
    name: row.name,
    url: row.url,
    enabled: Boolean(row.enabled),
    notifyWhatsApp: Boolean(row.notify_whatsapp),
    notifyEmail: Boolean(row.notify_email),
    whatsappRecipient: row.whatsapp_recipient || '',
    emailRecipient: row.email_recipient || '',
    lastSeenTitles: parseJson(row.last_seen_titles, []),
    lastCheckedAt: toIso(row.last_checked_at),
    lastResultCount: row.last_result_count || 0,
    lastError: row.last_error || null,
    lastNoResultWhatsAppAt: toIso(row.last_no_result_whatsapp_at),
    createdAt: toIso(row.created_at),
  }))

  const logs = logRows.map((row) => ({
    id: row.id,
    createdAt: toIso(row.created_at),
    level: row.level || 'info',
    type: row.type || 'system',
    message: row.message,
    details: parseJson(row.details, null),
  }))

  const whatsappAuth = {}
  for (const row of authRows) {
    whatsappAuth[row.auth_key] = row.payload
  }

  const alertEmailEvents = alertRows.map((row) => ({
    id: row.id,
    eventType: row.event_type,
    status: row.status,
    recipientCount: row.recipient_count || 0,
    recipients: row.recipients || '',
    subject: row.subject || '',
    errorMessage: row.error_message || '',
    metadata: parseJson(row.metadata, null),
    createdAt: toIso(row.created_at),
  }))

  const deliveryEvents = deliveryRows.map((row) => ({
    id: row.id,
    watchId: row.watch_id,
    watchName: row.watch_name,
    channel: row.channel,
    triggerType: row.trigger_type,
    status: row.status,
    recipient: row.recipient || '',
    subject: row.subject || '',
    message: row.message || '',
    providerMessageId: row.provider_message_id || '',
    errorMessage: row.error_message || '',
    metadata: parseJson(row.metadata, null),
    createdAt: toIso(row.created_at),
  }))

  const checkEvents = checkRows.map((row) => ({
    id: row.id,
    watchId: row.watch_id,
    watchName: row.watch_name,
    status: row.status,
    foundCount: row.found_count || 0,
    newCount: row.new_count || 0,
    message: row.message || '',
    errorMessage: row.error_message || '',
    createdAt: toIso(row.created_at),
  }))

  const deliveryMetrics = deliveryMetricRows.reduce((acc, row) => {
    const key = `${row.channel}_${row.status}`
    acc[key] = Number(row.count || 0)
    acc[`${key}_24h`] = Number(row.count_24h || 0)
    return acc
  }, {
    whatsapp_success: 0,
    whatsapp_failed: 0,
    email_success: 0,
    email_failed: 0,
    whatsapp_success_24h: 0,
    whatsapp_failed_24h: 0,
    email_success_24h: 0,
    email_failed_24h: 0,
  })

  const checkMetrics = {
    totalChecks: Number(checkMetricRows[0]?.total_checks || 0),
    successfulChecks: Number(checkMetricRows[0]?.successful_checks || 0),
    failedChecks: Number(checkMetricRows[0]?.failed_checks || 0),
    checksWithResults: Number(checkMetricRows[0]?.checks_with_results || 0),
    newListingCount: Number(checkMetricRows[0]?.new_listing_count || 0),
    checks24h: Number(checkMetricRows[0]?.checks_24h || 0),
    found24h: Number(checkMetricRows[0]?.found_24h || 0),
  }

  return {
    watches,
    logs,
    settings,
    whatsappAuth,
    alertEmailEvents,
    deliveryEvents,
    deliveryMetrics,
    checkEvents,
    checkMetrics,
  }
}

async function replaceState(connection, state) {
  await connection.query('DELETE FROM whatsapp_auth')
  await connection.query('DELETE FROM app_settings')
  await connection.query('DELETE FROM watches')
  await connection.query('DELETE FROM app_logs')

  const settings = { ...DEFAULT_STATE.settings, ...(state.settings || {}) }
  const settingRows = Object.entries(settings).map(([key, value]) => [key, JSON.stringify(value)])
  if (settingRows.length) {
    await connection.query('INSERT INTO app_settings (setting_key, setting_value) VALUES ?', [settingRows])
  }

  const watchRows = (state.watches || []).map((watch) => [
    watch.id,
    watch.name || 'Crous search',
    watch.url || '',
    watch.enabled !== false ? 1 : 0,
    watch.notifyWhatsApp ? 1 : 0,
    watch.notifyEmail ? 1 : 0,
    watch.whatsappRecipient || '',
    watch.emailRecipient || '',
    JSON.stringify(watch.lastSeenTitles || []),
    toDate(watch.lastCheckedAt),
    Number(watch.lastResultCount || 0),
    watch.lastError || null,
    toDate(watch.lastNoResultWhatsAppAt),
    toDate(watch.createdAt) || new Date(),
  ])
  if (watchRows.length) {
    await connection.query(`
      INSERT INTO watches (
        id, name, url, enabled, notify_whatsapp, notify_email, whatsapp_recipient, email_recipient,
        last_seen_titles, last_checked_at, last_result_count, last_error, last_no_result_whatsapp_at, created_at
      ) VALUES ?
    `, [watchRows])
  }

  const logRows = (state.logs || []).slice(0, 500).map((log) => [
    log.id,
    toDate(log.createdAt) || new Date(),
    log.level || 'info',
    log.type || 'system',
    log.message || '',
    log.details === null || log.details === undefined ? null : JSON.stringify(log.details),
  ])
  if (logRows.length) {
    await connection.query('INSERT INTO app_logs (id, created_at, level, type, message, details) VALUES ?', [logRows])
  }

  const authRows = Object.entries(state.whatsappAuth || {}).map(([key, payload]) => [key, payload])
  if (authRows.length) {
    await connection.query('INSERT INTO whatsapp_auth (auth_key, payload) VALUES ?', [authRows])
  }
}

async function getState() {
  const state = await getStateFromConnection(getPool())
  return clone(state)
}

async function updateState(updater) {
  const nextWrite = writeQueue.catch(() => undefined).then(() => withTransaction(async (connection) => {
    const state = await getStateFromConnection(connection)
    const draft = clone(state)
    const result = await updater(draft)
    await replaceState(connection, draft)
    return result === undefined ? undefined : clone(result)
  }))
  writeQueue = nextWrite.catch(() => undefined)
  return nextWrite
}

async function addLog(entry) {
  return updateState((draft) => {
    const log = {
      id: `${Date.now()}-${Math.random().toString(16).slice(2)}`,
      createdAt: new Date().toISOString(),
      level: entry.level || 'info',
      type: entry.type || 'system',
      message: entry.message,
      details: entry.details || null,
    }
    draft.logs.unshift(log)
    draft.logs = draft.logs.slice(0, 500)
    return log
  })
}

async function recordAlertEmailEvent({
  eventType,
  status,
  recipients = [],
  subject = null,
  errorMessage = null,
  metadata = null,
}) {
  const normalizedRecipients = Array.isArray(recipients) ? recipients : []
  await getPool().query(`
    INSERT INTO alert_email_events (
      event_type, status, recipient_count, recipients, subject, error_message, metadata
    ) VALUES (?, ?, ?, ?, ?, ?, ?)
  `, [
    eventType || 'runtime_error',
    status,
    normalizedRecipients.length,
    normalizedRecipients.join(','),
    subject,
    errorMessage,
    metadata ? JSON.stringify(metadata) : null,
  ])
}

async function recordCheckEvent({
  watchId = null,
  watchName = null,
  status,
  foundCount = 0,
  newCount = 0,
  message = null,
  errorMessage = null,
}) {
  await getPool().query(`
    INSERT INTO check_events (
      watch_id, watch_name, status, found_count, new_count, message, error_message
    ) VALUES (?, ?, ?, ?, ?, ?, ?)
  `, [
    watchId,
    watchName,
    status,
    Number(foundCount || 0),
    Number(newCount || 0),
    message,
    errorMessage,
  ])
}

async function recordDeliveryEvent({
  watchId = null,
  watchName = null,
  channel,
  triggerType,
  status,
  recipient = null,
  subject = null,
  message = null,
  providerMessageId = null,
  errorMessage = null,
  metadata = null,
}) {
  await getPool().query(`
    INSERT INTO delivery_events (
      watch_id, watch_name, channel, trigger_type, status, recipient, subject,
      message, provider_message_id, error_message, metadata
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `, [
    watchId,
    watchName,
    channel,
    triggerType,
    status,
    recipient,
    subject,
    message,
    providerMessageId,
    errorMessage,
    metadata ? JSON.stringify(metadata) : null,
  ])
}

module.exports = {
  addLog,
  getState,
  recordAlertEmailEvent,
  recordCheckEvent,
  recordDeliveryEvent,
  updateState,
  DEFAULT_STATE,
}
