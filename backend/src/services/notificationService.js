const config = require('../config')
const { addLog, getState, recordDeliveryEvent, updateState } = require('../store/mysqlStore')
const { sendMail } = require('./mailService')
const whatsapp = require('./whatsappService')
const { renderTemplate, splitValues } = require('../utils/format')

function minutesFromMs(value, fallback) {
  return Math.round((Number(value || fallback || 0) / 60000) * 10) / 10
}

function effectiveMinutes(settings = {}, settingKey, envMs) {
  const minutes = Number(settings[settingKey] || 0)
  return minutes > 0 ? minutes : minutesFromMs(envMs)
}

function whatsappRecipients(watch, settings = {}) {
  return splitValues(settings.defaultWhatsAppRecipient || watch.whatsappRecipient)
}

function emailRecipients(watch = {}, settings = {}) {
  return splitValues(settings.defaultEmail || watch.emailRecipient)
}

function uniqueValues(values) {
  return [...new Set(values.filter(Boolean))]
}

function emailEnabled(settings = {}) {
  return Boolean(settings.emailSendingEnabled)
}

function usesDailySummary(settings = {}) {
  return true
}

async function sendWhatsAppToRecipients({ watch, recipients, text, triggerType, metadata = null, successLog, failureLog }) {
  const deliveries = []
  for (const recipient of recipients) {
    try {
      const result = await whatsapp.sendMessage(recipient, text)
      deliveries.push({ channel: 'whatsapp', recipient, ok: true, result })
      await recordDeliveryEvent({
        watchId: watch.id,
        watchName: watch.name,
        channel: 'whatsapp',
        triggerType,
        status: 'success',
        recipient,
        message: text,
        providerMessageId: result?.id,
        metadata,
      })
      await addLog({ type: 'notification', message: successLog, details: { recipient, result } })
    } catch (error) {
      deliveries.push({ channel: 'whatsapp', recipient, ok: false, error: error.message })
      await recordDeliveryEvent({
        watchId: watch.id,
        watchName: watch.name,
        channel: 'whatsapp',
        triggerType,
        status: 'failed',
        recipient,
        message: text,
        errorMessage: error.message,
        metadata,
      })
      await addLog({ level: 'error', type: 'notification', message: failureLog, details: { recipient, error: error.message } })
    }
  }
  return deliveries
}

async function sendEmailToRecipients({ watch = {}, recipients, subject, text, triggerType, metadata = null, successLog, failureLog }) {
  const deliveries = []
  for (const recipient of recipients) {
    try {
      const result = await sendMail({ to: recipient, subject, text })
      deliveries.push({ channel: 'email', recipient, ok: true, result })
      await recordDeliveryEvent({
        watchId: watch.id,
        watchName: watch.name,
        channel: 'email',
        triggerType,
        status: 'success',
        recipient,
        subject,
        message: text,
        providerMessageId: result?.id,
        metadata,
      })
      await addLog({ type: 'notification', message: successLog, details: { recipient, result } })
    } catch (error) {
      deliveries.push({ channel: 'email', recipient, ok: false, error: error.message })
      await recordDeliveryEvent({
        watchId: watch.id,
        watchName: watch.name,
        channel: 'email',
        triggerType,
        status: 'failed',
        recipient,
        subject,
        message: text,
        errorMessage: error.message,
        metadata,
      })
      await addLog({ level: 'error', type: 'notification', message: failureLog, details: { recipient, error: error.message } })
    }
  }
  return deliveries
}

async function queueDailyEmailSummaryItem({ type, watch, listings = [], error = null, metadata = null }) {
  await updateState((draft) => {
    const queue = Array.isArray(draft.settings.emailDailySummaryQueue) ? draft.settings.emailDailySummaryQueue : []
    queue.push({
      id: `${Date.now()}-${Math.random().toString(16).slice(2)}`,
      type,
      watchId: watch?.id || null,
      watchName: watch?.name || 'Crous search',
      url: watch?.url || '',
      listings: listings.map((item) => ({
        title: item.title || '',
        price: item.price || '',
        overview: item.overview || '',
        url: item.url || '',
      })),
      error: error ? error.message || String(error) : '',
      metadata: metadata || null,
      createdAt: new Date().toISOString(),
    })
    draft.settings.emailDailySummaryQueue = queue.slice(-200)
  })
}

function todayKey(date = new Date()) {
  return date.toISOString().slice(0, 10)
}

function shouldSendDailySummary(settings = {}, date = new Date()) {
  if (!emailEnabled(settings) || !usesDailySummary(settings)) return false
  const hour = Math.max(0, Math.min(23, Number(settings.emailDailySummaryHour || 23)))
  return date.getHours() >= hour && settings.emailDailySummaryLastSentDate !== todayKey(date)
}

function renderDailySummary({ state, queue, date = new Date() }) {
  const startOfDay = new Date(date)
  startOfDay.setHours(0, 0, 0, 0)
  const todayChecks = (state.checkEvents || []).filter((event) => new Date(event.createdAt) >= startOfDay)
  const foundChecks = todayChecks.filter((event) => Number(event.foundCount || 0) > 0)
  const errorChecks = todayChecks.filter((event) => event.status === 'error')
  const listingItems = queue.flatMap((item) => item.listings.map((listing) => ({ ...listing, watchName: item.watchName, watchUrl: item.url })))
  const issueItems = queue.filter((item) => item.type === 'watch_issue')
  const runtimeIssueItems = queue.filter((item) => item.type === 'runtime_issue')

  const listingLines = listingItems.length
    ? listingItems.map((listing, index) => [
      `${index + 1}. ${listing.title || 'Logement Crous'}`,
      listing.price ? `   Prix: ${listing.price}` : null,
      listing.overview ? `   ${listing.overview}` : null,
      `   Recherche: ${listing.watchName}`,
      listing.url ? `   ${listing.url}` : listing.watchUrl ? `   ${listing.watchUrl}` : null,
    ].filter(Boolean).join('\n')).join('\n\n')
    : 'Aucun nouveau logement mis en file pour le resume email aujourd hui.'

  const issueLines = issueItems.length
    ? issueItems.map((item) => `- ${item.watchName}: ${item.error || 'Erreur inconnue'}`).join('\n')
    : 'Aucune erreur de surveillance mise en file.'

  const runtimeIssueLines = runtimeIssueItems.length
    ? runtimeIssueItems.map((item) => {
      const metadata = item.metadata || {}
      return [
        `- ${metadata.source || item.watchName || 'runtime'}: ${item.error || 'Erreur inconnue'}`,
        metadata.code ? `  Code: ${metadata.code}` : null,
        metadata.publicBaseUrl ? `  URL publique: ${metadata.publicBaseUrl}` : null,
      ].filter(Boolean).join('\n')
    }).join('\n')
    : 'Aucune alerte operationnelle mise en file.'

  return [
    `Resume Crous du ${date.toLocaleDateString('fr-FR')}`,
    '',
    'Vue globale',
    `- Checks aujourd hui: ${todayChecks.length}`,
    `- Checks avec logements: ${foundChecks.length}`,
    `- Erreurs: ${errorChecks.length}`,
    `- Nouveaux logements dans ce resume: ${listingItems.length}`,
    `- Alertes operationnelles: ${runtimeIssueItems.length}`,
    '',
    'Nouveaux logements',
    listingLines,
    '',
    'Problemes detectes',
    issueLines,
    '',
    'Alertes operationnelles',
    runtimeIssueLines,
    '',
    'Ce resume est envoye une seule fois en fin de journee quand le mode resume quotidien est active.',
  ].join('\n')
}

async function sendDailyEmailSummaryIfDue() {
  const state = await getState()
  const settings = state.settings || {}
  if (!shouldSendDailySummary(settings)) return { skipped: true }

  const recipients = uniqueValues([
    ...emailRecipients({}, settings),
    ...(state.watches || []).flatMap((watch) => splitValues(watch.emailRecipient)),
  ])
  if (!recipients.length) return { skipped: true, reason: 'missing recipients' }

  const queue = Array.isArray(settings.emailDailySummaryQueue) ? settings.emailDailySummaryQueue : []
  const subject = `Crous: resume quotidien ${new Date().toLocaleDateString('fr-FR')}`
  const text = renderDailySummary({ state, queue })
  const deliveries = await sendEmailToRecipients({
    recipients,
    subject,
    text,
    triggerType: 'daily_summary',
    metadata: { queuedItems: queue.length },
    successLog: 'Daily email summary sent',
    failureLog: 'Daily email summary failed',
  })

  if (deliveries.some((delivery) => delivery.ok)) {
    await updateState((draft) => {
      draft.settings.emailDailySummaryLastSentDate = todayKey()
      draft.settings.emailDailySummaryQueue = []
    })
  }
  return { ok: deliveries.some((delivery) => delivery.ok), deliveries }
}

async function notifyNewListings(watch, listings) {
  const state = await getState()
  const items = listings.map((item) => [
    `- ${item.title}`,
    item.price ? `  Prix: ${item.price}` : null,
    item.overview ? `  ${item.overview}` : null,
    item.url ? `  ${item.url}` : null,
  ].filter(Boolean).join('\n')).join('\n')
  const text = renderTemplate(state.settings.notificationTemplate, {
    items,
    url: watch.url,
    watchName: watch.name,
    count: listings.length,
  })

  const deliveries = []

  const phoneRecipients = whatsappRecipients(watch, state.settings)
  if (watch.notifyWhatsApp && phoneRecipients.length) {
    deliveries.push(...await sendWhatsAppToRecipients({
      watch,
      recipients: phoneRecipients,
      text,
      triggerType: 'new_listing',
      metadata: { listingCount: listings.length },
      successLog: `WhatsApp alert sent for ${watch.name}`,
      failureLog: `WhatsApp alert failed for ${watch.name}`,
    }))
  }

  const mailRecipients = emailRecipients(watch, state.settings)
  if (emailEnabled(state.settings) && watch.notifyEmail && mailRecipients.length) {
    if (usesDailySummary(state.settings)) {
      await queueDailyEmailSummaryItem({ type: 'new_listing', watch, listings })
    } else {
      const subject = `Crous: ${listings.length} nouveau(x) logement(s)`
      deliveries.push(...await sendEmailToRecipients({
        watch,
        recipients: mailRecipients,
        subject,
        text,
        triggerType: 'new_listing',
        metadata: { listingCount: listings.length },
        successLog: `Email alert sent for ${watch.name}`,
        failureLog: `Email alert failed for ${watch.name}`,
      }))
    }
  }

  return { text, deliveries }
}

async function notifyNoListingsWhatsApp(watch) {
  const state = await getState()
  const recipients = whatsappRecipients(watch, state.settings)
  if (!watch.notifyWhatsApp || !recipients.length) return { skipped: true }

  const checkEvery = effectiveMinutes(state.settings, 'scrapeIntervalMinutes', config.scrapeIntervalMs)
  const noResultEvery = effectiveMinutes(state.settings, 'noResultWhatsAppIntervalMinutes', config.noResultWhatsAppIntervalMs)
  const text = [
    `Crous check: not yet anything for ${watch.name}.`,
    `The system is still checking Crous every ${checkEvery} minute(s).`,
    `If nothing is found, this WhatsApp update is sent every ${noResultEvery} minute(s).`,
    `Search: ${watch.url}`,
    `Checked at: ${new Date().toLocaleString('fr-FR')}`,
  ].join('\n')

  const deliveries = await sendWhatsAppToRecipients({
    watch,
    recipients,
    text,
    triggerType: 'no_result_heartbeat',
    successLog: `WhatsApp no-result update sent for ${watch.name}`,
    failureLog: `WhatsApp no-result update failed for ${watch.name}`,
  })
  return { ok: deliveries.some((delivery) => delivery.ok), deliveries }
}

async function notifyWatchIssueEmail(watch, error) {
  const state = await getState()
  const recipients = emailRecipients(watch, state.settings)
  if (!emailEnabled(state.settings) || !watch.notifyEmail || !recipients.length) return { skipped: true }

  if (usesDailySummary(state.settings)) {
    await queueDailyEmailSummaryItem({ type: 'watch_issue', watch, error })
    return { queued: true }
  }

  const subject = `Crous automation issue: ${watch.name}`
  const text = [
    `A Crous watch failed.`,
    '',
    `Watch: ${watch.name}`,
    `URL: ${watch.url}`,
    `Error: ${error.message}`,
    `Time: ${new Date().toISOString()}`,
  ].join('\n')

  const deliveries = await sendEmailToRecipients({
    watch,
    recipients,
    subject,
    text,
    triggerType: 'watch_issue',
    successLog: `Issue email sent for ${watch.name}`,
    failureLog: `Issue email failed for ${watch.name}`,
  })
  return { ok: deliveries.some((delivery) => delivery.ok), deliveries }
}

async function sendManualNotification({ phoneNumber, email, message }) {
  const deliveries = []

  if (phoneNumber) {
    try {
      const result = await whatsapp.sendMessage(phoneNumber, message)
      deliveries.push({ channel: 'whatsapp', ok: true, result })
      await recordDeliveryEvent({
        channel: 'whatsapp',
        triggerType: 'manual_test',
        status: 'success',
        recipient: phoneNumber,
        message,
        providerMessageId: result?.id,
      })
      await addLog({ type: 'manual', message: 'Manual WhatsApp message sent', details: result })
    } catch (error) {
      deliveries.push({ channel: 'whatsapp', ok: false, error: error.message })
      await recordDeliveryEvent({
        channel: 'whatsapp',
        triggerType: 'manual_test',
        status: 'failed',
        recipient: phoneNumber,
        message,
        errorMessage: error.message,
      })
      throw error
    }
  }

  if (email) {
    const subject = 'Crous automation message'
    try {
      const result = await sendMail({ to: email, subject, text: message })
      deliveries.push({ channel: 'email', ok: true, result })
      await recordDeliveryEvent({
        channel: 'email',
        triggerType: 'manual_test',
        status: 'success',
        recipient: email,
        subject,
        message,
        providerMessageId: result?.id,
      })
      await addLog({ type: 'manual', message: 'Manual email sent', details: result })
    } catch (error) {
      deliveries.push({ channel: 'email', ok: false, error: error.message })
      await recordDeliveryEvent({
        channel: 'email',
        triggerType: 'manual_test',
        status: 'failed',
        recipient: email,
        subject,
        message,
        errorMessage: error.message,
      })
      throw error
    }
  }

  return { ok: true, deliveries }
}

module.exports = {
  notifyNoListingsWhatsApp,
  notifyNewListings,
  notifyWatchIssueEmail,
  queueDailyEmailSummaryItem,
  sendDailyEmailSummaryIfDue,
  sendManualNotification,
}
