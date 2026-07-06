const config = require('../config')
const { scrapeCrous } = require('./crousScraper')
const { notifyNewListings, notifyNoListingsWhatsApp, notifyWatchIssueEmail } = require('./notificationService')
const { addLog, getState, recordCheckEvent, updateState } = require('../store/mysqlStore')
const { notifyRuntimeError } = require('./runtimeAlertService')

function listingKey(listing) {
  return listing.key || listing.id || listing.url || listing.title
}

class WatchScheduler {
  constructor() {
    this.timer = null
    this.running = false
    this.io = null
  }

  attach(io) {
    this.io = io
  }

  start() {
    if (this.timer) return
    this.timer = setInterval(() => {
      this.runOnce().catch((error) => {
        addLog({ level: 'error', type: 'scheduler', message: 'Watcher cycle failed', details: error.message })
        notifyRuntimeError({ source: 'scheduler', error }).catch(() => undefined)
      })
    }, config.scrapeIntervalMs)
    this.runOnce().catch(() => undefined)
  }

  stop() {
    if (this.timer) clearInterval(this.timer)
    this.timer = null
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
        if (this.shouldSendNoResultWhatsApp(watch)) {
          await notifyNoListingsWhatsApp(watch)
          await updateState((draft) => {
            const target = draft.watches.find((item) => item.id === watch.id)
            if (target) target.lastNoResultWhatsAppAt = new Date().toISOString()
          })
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

  shouldSendNoResultWhatsApp(watch) {
    if (!watch.notifyWhatsApp || !watch.whatsappRecipient) return false
    if (!watch.lastNoResultWhatsAppAt) return true
    return Date.now() - new Date(watch.lastNoResultWhatsAppAt).getTime() >= config.noResultWhatsAppIntervalMs
  }

  emitState() {
    this.io?.emit('state:update')
  }
}

module.exports = new WatchScheduler()
