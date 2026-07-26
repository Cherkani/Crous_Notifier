const path = require('path')
const dotenv = require('dotenv')

const rootDir = path.resolve(__dirname, '..', '..')
dotenv.config({ path: path.join(rootDir, '.env'), quiet: true })

const config = {
  rootDir,
  dataDir: path.isAbsolute(process.env.DATA_DIR || '')
    ? process.env.DATA_DIR
    : path.join(rootDir, process.env.DATA_DIR || 'data'),
  port: Number(process.env.PORT || 4100),
  frontendUrl: process.env.FRONTEND_URL || 'http://localhost:5173',
  publicBaseUrl: process.env.PUBLIC_BASE_URL || 'https://automation.al-shifae.ma',
  crousToolId: '47',
  crousAcademicYear: process.env.CROUS_ACADEMIC_YEAR || '2026-2027',
  crousMaxPages: Number(process.env.CROUS_MAX_PAGES || 5),
  scrapeIntervalMs: Number(process.env.SCRAPE_INTERVAL_MS || 60000),
  noResultWhatsAppIntervalMs: Number(process.env.NO_RESULT_WHATSAPP_INTERVAL_MS || 30 * 60 * 1000),
  db: {
    uri: process.env.DATABASE_URL || '',
    socketPath: process.env.MYSQL_SOCKET || '',
    host: process.env.MYSQL_HOST || 'localhost',
    port: Number(process.env.MYSQL_PORT || 3306),
    user: process.env.MYSQL_USER || 'root',
    password: process.env.MYSQL_PASSWORD || '',
    database: process.env.MYSQL_DATABASE || 'crous_automation',
    connectionLimit: Number(process.env.MYSQL_CONNECTION_LIMIT || 10),
  },
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
