const { addLog, getState, recordDeliveryEvent } = require('../store/mysqlStore')
const { sendMail } = require('./mailService')
const whatsapp = require('./whatsappService')
const { renderTemplate, splitValues } = require('../utils/format')

function whatsappRecipients(watch, settings = {}) {
  return splitValues(settings.defaultWhatsAppRecipient || watch.whatsappRecipient)
}

function emailRecipients(watch, settings = {}) {
  return splitValues(settings.defaultEmail || watch.emailRecipient)
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

async function sendEmailToRecipients({ watch, recipients, subject, text, triggerType, metadata = null, successLog, failureLog }) {
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

async function notifyNewListings(watch, listings) {
  const state = await getState()
  const items = listings.map((item) => `- ${item.title}${item.url ? `\n  ${item.url}` : ''}`).join('\n')
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
  if (watch.notifyEmail && mailRecipients.length) {
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

  return { text, deliveries }
}

async function notifyNoListingsWhatsApp(watch) {
  const state = await getState()
  const recipients = whatsappRecipients(watch, state.settings)
  if (!watch.notifyWhatsApp || !recipients.length) return { skipped: true }

  const text = [
    `Crous check: no housing found for ${watch.name}.`,
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
  if (!watch.notifyEmail || !recipients.length) return { skipped: true }

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
  sendManualNotification,
}
