const fs = require('fs/promises')
const path = require('path')
const config = require('../src/config')
const { getPool } = require('../src/db/pool')
const { updateState, DEFAULT_STATE } = require('../src/store/mysqlStore')

const statePath = path.join(config.dataDir, 'state.json')

async function run() {
  const raw = await fs.readFile(statePath, 'utf8')
  const state = { ...DEFAULT_STATE, ...JSON.parse(raw) }

  await updateState((draft) => {
    draft.watches = state.watches || []
    draft.logs = state.logs || []
    draft.settings = { ...DEFAULT_STATE.settings, ...(state.settings || {}) }
    draft.whatsappAuth = state.whatsappAuth || {}
  })

  console.log(`Imported JSON state from ${statePath}`)
  await getPool().end()
}

run().catch((error) => {
  console.error(error)
  process.exit(1)
})
