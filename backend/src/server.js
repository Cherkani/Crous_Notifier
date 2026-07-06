const path = require('path')
const express = require('express')
const cors = require('cors')
const http = require('http')
const { Server } = require('socket.io')
const config = require('./config')
const apiRouter = require('./routes/api')
const whatsapp = require('./services/whatsappService')
const scheduler = require('./services/watchScheduler')
const { addLog } = require('./store/mysqlStore')
const { notifyRuntimeError } = require('./services/runtimeAlertService')
const { runMigrations } = require('../scripts/migrate')

const app = express()
const server = http.createServer(app)
const io = new Server(server, {
  cors: {
    origin: true,
    credentials: true,
  },
})

app.use(cors({
  origin: true,
  credentials: true,
}))
app.use(express.json({ limit: '2mb' }))
app.use(express.urlencoded({ extended: true }))

app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', service: 'crous-automation', timestamp: new Date().toISOString() })
})
app.use('/api', apiRouter)

const frontendDist = path.join(config.rootDir, 'frontend', 'dist')
app.use(express.static(frontendDist))
app.use((req, res) => {
  if (req.path.startsWith('/api')) {
    res.status(404).json({ success: false, message: 'API route not found' })
    return
  }
  res.sendFile(path.join(frontendDist, 'index.html'))
})

app.use((error, req, res, next) => {
  const message = error instanceof Error ? error.message : 'Unexpected error'
  addLog({ level: 'error', type: 'api', message, details: { method: req.method, url: req.url } }).catch(() => undefined)
  notifyRuntimeError({
    source: 'api',
    error,
    metadata: { method: req.method, url: req.url },
  }).catch(() => undefined)
  res.status(400).json({ success: false, message })
})

io.on('connection', (socket) => {
  socket.emit('whatsapp:status', whatsapp.getStatus())
})

whatsapp.attach(io)
scheduler.attach(io)

async function bootstrap() {
  await runMigrations()
  await whatsapp.load()
  scheduler.start()
  server.listen(config.port, '0.0.0.0', () => {
    console.log(`Crous automation API running on http://0.0.0.0:${config.port}`)
  })
}

process.on('unhandledRejection', (reason) => {
  const error = reason instanceof Error ? reason : new Error(String(reason))
  addLog({ level: 'error', type: 'process', message: 'Unhandled promise rejection', details: error.message }).catch(() => undefined)
  notifyRuntimeError({ source: 'unhandledRejection', error }).catch(() => undefined)
})

process.on('uncaughtException', (error) => {
  addLog({ level: 'error', type: 'process', message: 'Uncaught exception', details: error.message }).catch(() => undefined)
  notifyRuntimeError({ source: 'uncaughtException', error }).finally(() => {
    process.exit(1)
  })
})

bootstrap().catch((error) => {
  console.error(error)
  notifyRuntimeError({ source: 'bootstrap', error }).finally(() => {
    process.exit(1)
  })
})
