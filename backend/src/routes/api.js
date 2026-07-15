const express = require('express')
const config = require('../config')
const { addLog, getState, recordDeliveryEvent, updateState } = require('../store/mysqlStore')
const { scrapeCrous } = require('../services/crousScraper')
const { buildCrousSearchUrl } = require('../services/crousTargeting')
const { sendManualNotification } = require('../services/notificationService')
const { sendMail } = require('../services/mailService')
const whatsapp = require('../services/whatsappService')
const scheduler = require('../services/watchScheduler')
const { emailList, isValidPhone, publicPhone, publicPhoneList } = require('../utils/format')

const router = express.Router()

function assertCrousSearchUrl(value) {
  let parsed
  try {
    parsed = new URL(value)
  } catch {
    throw new Error('A valid Crous search URL is required')
  }
  if (parsed.hostname !== 'trouverunlogement.lescrous.fr') {
    throw new Error('Crous search URL must come from trouverunlogement.lescrous.fr')
  }
  if (!parsed.pathname.includes('/search')) {
    throw new Error('Crous search URL must be a search page')
  }
  return parsed.toString()
}

function scheduleFromSettings(settings = {}) {
  const scrapeIntervalMinutes = Number(settings.scrapeIntervalMinutes || 0)
  const noResultWhatsAppIntervalMinutes = Number(settings.noResultWhatsAppIntervalMinutes || 0)
  return {
    scrapeIntervalMs: scrapeIntervalMinutes > 0 ? scrapeIntervalMinutes * 60 * 1000 : config.scrapeIntervalMs,
    noResultWhatsAppIntervalMs: noResultWhatsAppIntervalMinutes > 0 ? noResultWhatsAppIntervalMinutes * 60 * 1000 : config.noResultWhatsAppIntervalMs,
    noResultEmailEnabled: Boolean(settings.noResultEmailEnabled),
    source: scrapeIntervalMinutes > 0 || noResultWhatsAppIntervalMinutes > 0 || settings.noResultEmailEnabled ? 'configuration' : 'backend env',
  }
}

function assertEmailSendingEnabled(settings = {}) {
  if (!settings.emailSendingEnabled) {
    throw new Error('Email sending is disabled in Configuration')
  }
}

router.get('/state', async (req, res, next) => {
  try {
    const state = await getState()
    const { whatsappAuth, ...publicState } = state
    res.json({
      ...publicState,
      whatsapp: whatsapp.getStatus(),
      smtp: {
        configured: Boolean(process.env.SMTP_HOST && process.env.SMTP_USER && process.env.SMTP_PASS),
        from: process.env.SMTP_FROM || process.env.SMTP_USER || null,
      },
      schedule: scheduleFromSettings(publicState.settings),
    })
  } catch (error) {
    next(error)
  }
})

router.patch('/settings', async (req, res, next) => {
  try {
    const settings = await updateState((draft) => {
      const nextSettings = { ...req.body }
      if (nextSettings.defaultWhatsAppRecipient !== undefined) {
        nextSettings.defaultWhatsAppRecipient = publicPhoneList(nextSettings.defaultWhatsAppRecipient)
      }
      if (nextSettings.defaultEmail !== undefined) {
        nextSettings.defaultEmail = emailList(nextSettings.defaultEmail)
      }
      if (nextSettings.operationalAlertEmail !== undefined) {
        nextSettings.operationalAlertEmail = emailList(nextSettings.operationalAlertEmail)
      }
      if (nextSettings.scrapeIntervalMinutes !== undefined) {
        nextSettings.scrapeIntervalMinutes = nextSettings.scrapeIntervalMinutes === '' ? '' : Math.max(1, Number(nextSettings.scrapeIntervalMinutes || 1))
      }
      if (nextSettings.noResultWhatsAppIntervalMinutes !== undefined) {
        nextSettings.noResultWhatsAppIntervalMinutes = nextSettings.noResultWhatsAppIntervalMinutes === '' ? '' : Math.max(1, Number(nextSettings.noResultWhatsAppIntervalMinutes || 1))
      }
      if (nextSettings.emailSendingEnabled !== undefined) {
        nextSettings.emailSendingEnabled = Boolean(nextSettings.emailSendingEnabled)
      }
      if (nextSettings.operationalAlertsEnabled !== undefined) {
        nextSettings.operationalAlertsEnabled = Boolean(nextSettings.operationalAlertsEnabled)
      }
      if (nextSettings.noResultEmailEnabled !== undefined) {
        nextSettings.noResultEmailEnabled = Boolean(nextSettings.noResultEmailEnabled)
      }
      if (nextSettings.emailDeliveryMode !== undefined && !['daily_summary', 'immediate'].includes(nextSettings.emailDeliveryMode)) {
        nextSettings.emailDeliveryMode = 'daily_summary'
      }
      if (nextSettings.emailDailySummaryHour !== undefined) {
        nextSettings.emailDailySummaryHour = Math.max(0, Math.min(23, Number(nextSettings.emailDailySummaryHour || 23)))
      }
      draft.settings = { ...draft.settings, ...nextSettings }
      return draft.settings
    })
    await addLog({ type: 'settings', message: 'Settings updated' })
    scheduler.restart()
    res.json({ success: true, settings })
  } catch (error) {
    next(error)
  }
})

router.post('/watches', async (req, res, next) => {
  try {
    const body = req.body || {}
    if (!body.url && !body.targetLocation) throw new Error('Crous URL or target city/residence is required')
    const state = await getState()
    const target = body.url?.trim()
      ? { url: assertCrousSearchUrl(body.url.trim()), place: null }
      : await buildCrousSearchUrl({
        location: body.targetLocation,
        occupationMode: body.occupationMode || 'alone',
        maxPrice: body.maxPrice,
        minArea: body.minArea,
      })
    const watch = {
      id: `${Date.now()}-${Math.random().toString(16).slice(2)}`,
      name: body.name?.trim() || target.place?.label || 'Crous search',
      url: target.url,
      enabled: body.enabled !== false,
      notifyWhatsApp: Boolean(body.notifyWhatsApp),
      notifyEmail: Boolean(body.notifyEmail),
      whatsappRecipient: publicPhoneList(body.whatsappRecipient || state.settings.defaultWhatsAppRecipient),
      emailRecipient: emailList(body.emailRecipient || state.settings.defaultEmail),
      lastSeenTitles: [],
      lastCheckedAt: null,
      lastResultCount: 0,
      lastError: null,
      createdAt: new Date().toISOString(),
    }

    await updateState((draft) => {
      draft.watches.unshift(watch)
    })
    await addLog({ type: 'watch', message: `Watch created: ${watch.name}`, details: { url: watch.url, place: target.place } })
    scheduler.runOnce().catch(() => undefined)
    res.status(201).json({ success: true, watch })
  } catch (error) {
    next(error)
  }
})

router.patch('/watches/:id', async (req, res, next) => {
  try {
    const watch = await updateState((draft) => {
      const target = draft.watches.find((item) => item.id === req.params.id)
      if (!target) throw new Error('Watch not found')
      Object.assign(target, req.body)
      if (req.body.whatsappRecipient !== undefined) target.whatsappRecipient = publicPhoneList(req.body.whatsappRecipient)
      if (req.body.emailRecipient !== undefined) target.emailRecipient = emailList(req.body.emailRecipient)
      return target
    })
    res.json({ success: true, watch })
  } catch (error) {
    next(error)
  }
})

router.delete('/watches/:id', async (req, res, next) => {
  try {
    await updateState((draft) => {
      draft.watches = draft.watches.filter((item) => item.id !== req.params.id)
    })
    await addLog({ type: 'watch', message: 'Watch removed', details: { id: req.params.id } })
    res.json({ success: true })
  } catch (error) {
    next(error)
  }
})

router.post('/watches/:id/check', async (req, res, next) => {
  try {
    const state = await getState()
    const watch = state.watches.find((item) => item.id === req.params.id)
    if (!watch) throw new Error('Watch not found')
    await scheduler.checkWatch(watch)
    res.json({ success: true })
  } catch (error) {
    next(error)
  }
})

router.post('/scrape-preview', async (req, res, next) => {
  try {
    if (!req.body?.url) throw new Error('URL is required')
    const listings = await scrapeCrous(req.body.url)
    res.json({ success: true, listings })
  } catch (error) {
    next(error)
  }
})

router.get('/whatsapp/status', (req, res) => {
  res.json(whatsapp.getStatus())
})

router.post('/whatsapp/start', async (req, res, next) => {
  try {
    if (!isValidPhone(req.body?.phoneNumber)) throw new Error('A valid WhatsApp phone number is required')
    const status = await whatsapp.start(req.body.phoneNumber)
    await updateState((draft) => {
      draft.settings.whatsappPhone = publicPhone(req.body.phoneNumber)
    })
    res.json(status)
  } catch (error) {
    next(error)
  }
})

router.post('/whatsapp/logout', async (req, res, next) => {
  try {
    res.json(await whatsapp.logout())
  } catch (error) {
    next(error)
  }
})

router.post('/notifications/manual', async (req, res, next) => {
  try {
    if (!req.body?.message?.trim()) throw new Error('Message is required')
    if (!req.body.phoneNumber && !req.body.email) throw new Error('Choose WhatsApp, email, or both')
    if (req.body.email) {
      const state = await getState()
      assertEmailSendingEnabled(state.settings)
    }
    res.json(await sendManualNotification({
      phoneNumber: req.body.phoneNumber,
      email: req.body.email,
      message: req.body.message.trim(),
    }))
  } catch (error) {
    next(error)
  }
})

router.post('/email/test', async (req, res, next) => {
  try {
    if (!req.body?.email) throw new Error('Email is required')
    const state = await getState()
    assertEmailSendingEnabled(state.settings)
    const subject = 'Crous automation SMTP test'
    const result = await sendMail({
      to: req.body.email,
      subject,
      text: 'SMTP is configured and email sending is enabled.',
    })
    await recordDeliveryEvent({
      channel: 'email',
      triggerType: 'manual_test',
      status: 'success',
      recipient: req.body.email,
      subject,
      message: 'SMTP is configured and email sending is enabled.',
      providerMessageId: result?.id,
    })
    await addLog({ type: 'email', message: 'SMTP test email sent', details: result })
    res.json({ success: true, result })
  } catch (error) {
    if (req.body?.email) {
      await recordDeliveryEvent({
        channel: 'email',
        triggerType: 'manual_test',
        status: 'failed',
        recipient: req.body.email,
        subject: 'Crous automation SMTP test',
        message: 'SMTP is configured and email sending is enabled.',
        errorMessage: error.message,
      }).catch(() => undefined)
    }
    next(error)
  }
})

module.exports = router
