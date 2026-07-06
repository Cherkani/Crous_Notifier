const config = require('../config')
const { scrapeCrous } = require('./crousScraper')
const { notifyNewListings, notifyNoListingsEmail, notifyNoListingsWhatsApp, notifyWatchIssueEmail } = require('./notificationService')
const { addLog, getState, recordCheckEvent, updateState } = require('../store/mysqlStore')
const { notifyRuntimeError } = require('./runtimeAlertService')
const { splitValues } = require('../utils/format')

function listingKey(listing) {
  return listing.key || listing.id || listing.url || listing.title
}

class WatchScheduler {
  constructor() {
    this.timer = null
    this.running = false
    this.io = null
    this.stopped = true
  }

  attach(io) {
    this.io = io
  }

  start() {
    if (this.timer) return
    this.stopped = false
    this.scheduleNext(0)
  }

  stop() {
    this.stopped = true
    if (this.timer) clearTimeout(this.timer)
    this.timer = null
  }

  restart() {
    this.stop()
    this.start()
  }

  async getSettings() {
    const state = await getState()
    return state.settings || {}
  }

  async getScrapeIntervalMs() {
    const settings = await this.getSettings().catch(() => ({}))
    const minutes = Number(settings.scrapeIntervalMinutes || 0)
    return minutes > 0 ? minutes * 60 * 1000 : config.scrapeIntervalMs
  }

  async getNoResultWhatsAppIntervalMs() {
    const settings = await this.getSettings().catch(() => ({}))
    const minutes = Number(settings.noResultWhatsAppIntervalMinutes || 0)
    return minutes > 0 ? minutes * 60 * 1000 : config.noResultWhatsAppIntervalMs
  }

  scheduleNext(delayMs) {
    if (this.stopped) return
    this.timer = setTimeout(async () => {
      this.timer = null
      try {
        await this.runOnce()
      } catch (error) {
        addLog({ level: 'error', type: 'scheduler', message: 'Watcher cycle failed', details: error.message })
        notifyRuntimeError({ source: 'scheduler', error }).catch(() => undefined)
      } finally {
        const nextDelay = await this.getScrapeIntervalMs().catch(() => config.scrapeIntervalMs)
        this.scheduleNext(nextDelay)
      }
    }, delayMs)
  }

  async runOnce() {
    if (this.running) return
    this.running = true
    try {
      const state = await getState()
      const watches = state.watches.filter((watch) => watch.enabled)
      for (const watch of watches) {
        await this.checkWatch(watch)
      }
      this.emitState()
    } finally {
      this.running = false
    }
  }

  async checkWatch(watch) {
    try {
      const listings = await scrapeCrous(watch.url)
      const currentKeys = listings.map(listingKey).filter(Boolean)
      const previousKeys = new Set(watch.lastSeenTitles || [])
      const newListings = listings.filter((item) => !previousKeys.has(listingKey(item)))
      const isFirstRun = !watch.lastCheckedAt
      const effectiveNewCount = isFirstRun ? 0 : newListings.length

      await updateState((draft) => {
        const target = draft.watches.find((item) => item.id === watch.id)
        if (!target) return
        target.lastCheckedAt = new Date().toISOString()
        target.lastSeenTitles = currentKeys
        target.lastResultCount = listings.length
        target.lastError = null
      })

      await recordCheckEvent({
        watchId: watch.id,
        watchName: watch.name,
        status: 'success',
        foundCount: listings.length,
        newCount: effectiveNewCount,
        message: listings.length
          ? `${listings.length} listing(s), ${effectiveNewCount} new`
          : 'No housing found',
      })

      if (!listings.length) {
        await addLog({ type: 'scrape', message: `No housing found for ${watch.name}` })
        if (await this.shouldSendNoResultWhatsApp(watch)) {
          await notifyNoListingsWhatsApp(watch)
          await updateState((draft) => {
            const target = draft.watches.find((item) => item.id === watch.id)
            if (target) target.lastNoResultWhatsAppAt = new Date().toISOString()
          })
        }
        const state = await getState()
        if (state.settings?.noResultEmailEnabled) {
          await notifyNoListingsEmail(watch)
        }
        return
      }

      if (isFirstRun) {
        await addLog({ type: 'scrape', message: `Initial snapshot for ${watch.name}: ${listings.length} listing(s)` })
        return
      }

      if (!newListings.length) {
        await addLog({ type: 'scrape', message: `No new housing for ${watch.name}` })
        return
      }

      await addLog({
        type: 'scrape',
        message: `${newListings.length} new housing listing(s) found for ${watch.name}`,
        details: newListings,
      })
      await notifyNewListings(watch, newListings)
    } catch (error) {
      await updateState((draft) => {
        const target = draft.watches.find((item) => item.id === watch.id)
        if (!target) return
        target.lastCheckedAt = new Date().toISOString()
        target.lastError = error.message
      })
      await recordCheckEvent({
        watchId: watch.id,
        watchName: watch.name,
        status: 'error',
        foundCount: 0,
        newCount: 0,
        message: 'Scrape failed',
        errorMessage: error.message,
      })
      await addLog({ level: 'error', type: 'scrape', message: `Scrape failed for ${watch.name}`, details: error.message })
      await notifyWatchIssueEmail(watch, error)
      await notifyRuntimeError({
        source: 'scrape',
        error,
        metadata: { watchId: watch.id, watchName: watch.name, url: watch.url },
      })
    }
  }

  async shouldSendNoResultWhatsApp(watch) {
    const settings = await this.getSettings().catch(() => ({}))
    const recipients = splitValues(settings.defaultWhatsAppRecipient || watch.whatsappRecipient)
    if (!watch.notifyWhatsApp || !recipients.length) return false
    if (!watch.lastNoResultWhatsAppAt) return true
    const intervalMs = await this.getNoResultWhatsAppIntervalMs()
    return Date.now() - new Date(watch.lastNoResultWhatsAppAt).getTime() >= intervalMs
  }

  emitState() {
    this.io?.emit('state:update')
  }
}

module.exports = new WatchScheduler()
