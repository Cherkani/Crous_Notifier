const config = require('../config')
const { scrapeCrous } = require('./crousScraper')
const { notifyNewListings } = require('./notificationService')
const { addLog, getState, updateState } = require('../store/jsonStore')

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
      const currentTitles = listings.map((item) => item.title)
      const previousTitles = new Set(watch.lastSeenTitles || [])
      const newListings = listings.filter((item) => !previousTitles.has(item.title))
      const isFirstRun = !watch.lastCheckedAt

      await updateState((draft) => {
        const target = draft.watches.find((item) => item.id === watch.id)
        if (!target) return
        target.lastCheckedAt = new Date().toISOString()
        target.lastSeenTitles = currentTitles
        target.lastResultCount = listings.length
        target.lastError = null
      })

      if (!listings.length) {
        await addLog({ type: 'scrape', message: `No housing found for ${watch.name}` })
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
      await addLog({ level: 'error', type: 'scrape', message: `Scrape failed for ${watch.name}`, details: error.message })
    }
  }

  emitState() {
    this.io?.emit('state:update')
  }
}

module.exports = new WatchScheduler()
