const { addLog, getState } = require('../store/jsonStore')
const { sendMail } = require('./mailService')
const whatsapp = require('./whatsappService')
const { renderTemplate } = require('../utils/format')

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

  if (watch.notifyWhatsApp && watch.whatsappRecipient) {
    try {
      const result = await whatsapp.sendMessage(watch.whatsappRecipient, text)
      deliveries.push({ channel: 'whatsapp', ok: true, result })
      await addLog({ type: 'notification', message: `WhatsApp alert sent for ${watch.name}`, details: result })
    } catch (error) {
      deliveries.push({ channel: 'whatsapp', ok: false, error: error.message })
      await addLog({ level: 'error', type: 'notification', message: `WhatsApp alert failed for ${watch.name}`, details: error.message })
    }
  }

  if (watch.notifyEmail && watch.emailRecipient) {
    try {
      const result = await sendMail({
        to: watch.emailRecipient,
        subject: `Crous: ${listings.length} nouveau(x) logement(s)`,
        text,
      })
      deliveries.push({ channel: 'email', ok: true, result })
      await addLog({ type: 'notification', message: `Email alert sent for ${watch.name}`, details: result })
    } catch (error) {
      deliveries.push({ channel: 'email', ok: false, error: error.message })
      await addLog({ level: 'error', type: 'notification', message: `Email alert failed for ${watch.name}`, details: error.message })
    }
  }

  return { text, deliveries }
}

async function sendManualNotification({ phoneNumber, email, message }) {
  const deliveries = []

  if (phoneNumber) {
    const result = await whatsapp.sendMessage(phoneNumber, message)
    deliveries.push({ channel: 'whatsapp', ok: true, result })
    await addLog({ type: 'manual', message: 'Manual WhatsApp message sent', details: result })
  }

  if (email) {
    const result = await sendMail({
      to: email,
      subject: 'Crous automation message',
      text: message,
    })
    deliveries.push({ channel: 'email', ok: true, result })
    await addLog({ type: 'manual', message: 'Manual email sent', details: result })
  }

  return { ok: true, deliveries }
}

module.exports = {
  notifyNewListings,
  sendManualNotification,
}
