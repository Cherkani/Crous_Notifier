const fs = require('fs/promises')
const path = require('path')
const config = require('../config')

const DEFAULT_STATE = {
  watches: [],
  logs: [],
  settings: {
    whatsappPhone: '',
    defaultEmail: '',
    defaultWhatsAppRecipient: '',
    notificationTemplate: 'Nouveau logement Crous disponible:\\n{items}\\n\\nRecherche: {url}',
  },
  whatsappAuth: {},
}

const statePath = path.join(config.dataDir, 'state.json')
let state = null
let writeQueue = Promise.resolve()

async function ensureLoaded() {
  if (state) return state
  await fs.mkdir(config.dataDir, { recursive: true })
  try {
    const raw = await fs.readFile(statePath, 'utf8')
    state = { ...DEFAULT_STATE, ...JSON.parse(raw) }
  } catch {
    state = structuredClone(DEFAULT_STATE)
    await save()
  }
  return state
}

async function save() {
  await fs.mkdir(config.dataDir, { recursive: true })
  const payload = JSON.stringify(state, null, 2)
  writeQueue = writeQueue.then(() => fs.writeFile(statePath, payload))
  await writeQueue
}

async function getState() {
  return structuredClone(await ensureLoaded())
}

async function updateState(updater) {
  await ensureLoaded()
  const result = await updater(state)
  await save()
  return result
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

module.exports = {
  addLog,
  getState,
  updateState,
}
