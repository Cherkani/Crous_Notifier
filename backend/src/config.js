const path = require('path')
const dotenv = require('dotenv')

const rootDir = path.resolve(__dirname, '..', '..')
dotenv.config({ path: path.join(rootDir, '.env'), quiet: true, override: true })

const config = {
  rootDir,
  dataDir: path.isAbsolute(process.env.DATA_DIR || '')
    ? process.env.DATA_DIR
    : path.join(rootDir, process.env.DATA_DIR || 'data'),
  port: Number(process.env.PORT || 4100),
  frontendUrl: process.env.FRONTEND_URL || 'http://localhost:5173',
  publicBaseUrl: process.env.PUBLIC_BASE_URL || 'https://automation.al-shifae.ma',
  scrapeIntervalMs: Number(process.env.SCRAPE_INTERVAL_MS || 60000),
  smtp: {
    host: process.env.SMTP_HOST,
    port: Number(process.env.SMTP_PORT || 587),
    secure: process.env.SMTP_SECURE === 'true',
    user: process.env.SMTP_USER,
    pass: process.env.SMTP_PASS,
    from: process.env.SMTP_FROM || process.env.SMTP_USER,
  },
}

module.exports = config
