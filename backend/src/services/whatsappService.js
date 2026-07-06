const makeWASocket = require('@itsukichan/baileys').default
const {
  BufferJSON,
  DisconnectReason,
  fetchLatestBaileysVersion,
  initAuthCreds,
  proto,
} = require('@itsukichan/baileys')
const QRCode = require('qrcode')
const pino = require('pino')
const { getState, updateState, addLog } = require('../store/mysqlStore')
const { notifyRuntimeError } = require('./runtimeAlertService')
const { cleanPhone, isValidPhone } = require('../utils/format')

class WhatsAppService {
  constructor() {
    this.socket = null
    this.io = null
    this.reconnectTimer = null
    this.status = {
      state: 'disconnected',
      ready: false,
      qrCode: null,
      phoneNumber: null,
      expectedPhoneNumber: null,
      error: null,
    }
  }

  attach(io) {
    this.io = io
  }

  async load() {
    const creds = await this.readAuthData('creds')
    const state = await getState().catch(() => null)
    const phoneNumber = this.phoneFromJid(creds?.me?.id)
    const expectedPhoneNumber = cleanPhone(state?.settings?.whatsappPhone || phoneNumber)
    if (creds?.registered || phoneNumber || expectedPhoneNumber) {
      this.setStatus({
        ...this.status,
        phoneNumber,
        expectedPhoneNumber,
        state: creds?.registered ? 'reconnecting' : 'disconnected',
      })
      if (creds?.registered) this.scheduleReconnect(1000)
    }
  }

  getStatus() {
    return { ...this.status }
  }

  async start(phoneNumber) {
    const expectedPhoneNumber = cleanPhone(phoneNumber || this.status.expectedPhoneNumber || this.status.phoneNumber)
    if (!isValidPhone(expectedPhoneNumber)) throw new Error('A valid WhatsApp phone number is required')
    if (this.socket) return this.getStatus()
    return this.startSocket(expectedPhoneNumber)
  }

  async logout() {
    this.clearReconnectTimer()
    const socket = this.socket
    this.socket = null
    if (socket) {
      try {
        await socket.logout()
      } catch {
        socket.end(undefined)
      }
    }
    await this.clearAuthState()
    this.setStatus({
      state: 'disconnected',
      ready: false,
      qrCode: null,
      phoneNumber: null,
      expectedPhoneNumber: null,
      error: null,
    })
    await addLog({ type: 'whatsapp', message: 'WhatsApp device logged out' })
    return this.getStatus()
  }

  async sendMessage(to, text) {
    if (!this.socket || !this.status.ready) throw new Error('WhatsApp device is not connected')
    const digits = cleanPhone(to)
    if (!isValidPhone(digits)) throw new Error('A valid recipient phone number is required')
    const result = await this.socket.sendMessage(`${digits}@s.whatsapp.net`, { text })
    return { provider: '@itsukichan/baileys', id: result?.key?.id || null }
  }

  async startSocket(expectedPhoneNumber) {
    this.setStatus({ ...this.status, state: 'initializing', ready: false, qrCode: null, expectedPhoneNumber, error: null })
    const { state, saveCreds } = await this.useAuthState()
    const waVersion = [2, 3000, 1033893291]
    try {
      const { version: latestVersion, isLatest } = await fetchLatestBaileysVersion()
      await addLog({
        type: 'whatsapp',
        message: `Using WhatsApp Web version ${waVersion.join('.')} for QR registration`,
        details: { latestVersion, isLatest },
      })
    } catch (error) {
      await addLog({
        type: 'whatsapp',
        message: `Using bundled WhatsApp Web registration version ${waVersion.join('.')}`,
        details: error.message,
      })
    }
    const socket = makeWASocket({
      auth: state,
      browser: ['Crous Automation', 'Chrome', '120.0'],
      version: waVersion,
      printQRInTerminal: false,
      logger: pino({ level: 'silent' }),
      syncFullHistory: false,
      markOnlineOnConnect: false,
      defaultQueryTimeoutMs: 90000,
      connectTimeoutMs: 90000,
      keepAliveIntervalMs: 20000,
      retryRequestDelayMs: 2000,
      maxMsgRetryCount: 5,
      qrTimeout: 120000,
      transactionOpts: {
        maxCommitRetries: 15,
        delayBetweenTriesMs: 3000,
      },
    })
    this.socket = socket

    socket.ev.on('creds.update', saveCreds)
    socket.ev.on('connection.update', async (update) => {
      if (update.qr) {
        const qrCode = await QRCode.toDataURL(update.qr, {
          width: 512,
          margin: 2,
          errorCorrectionLevel: 'M',
        })
        this.setStatus({ state: 'awaiting_scan', ready: false, qrCode, phoneNumber: null, expectedPhoneNumber, error: null })
      }

      if (update.connection === 'open') {
        const phoneNumber = this.phoneFromJid(socket.user?.id) || this.phoneFromJid(state.creds.me?.id)
        this.setStatus({ state: 'connected', ready: true, qrCode: null, phoneNumber, expectedPhoneNumber, error: null })
        await addLog({ type: 'whatsapp', message: `WhatsApp connected: +${phoneNumber || expectedPhoneNumber}` })
      }

      if (update.connection === 'close') {
        this.socket = null
        const statusCode = update.lastDisconnect?.error?.output?.statusCode
        const loggedOut = statusCode === DisconnectReason.loggedOut
        const restartRequired = statusCode === DisconnectReason.restartRequired
        const authInvalid = [
          DisconnectReason.badSession,
          DisconnectReason.forbidden,
          DisconnectReason.multideviceMismatch,
        ].includes(statusCode)
        const connectionReplaced = statusCode === DisconnectReason.connectionReplaced
        if (loggedOut || authInvalid) await this.clearAuthState()
        const phoneNumber = this.phoneFromJid(state.creds.me?.id)
        this.setStatus({
          state: loggedOut || authInvalid || connectionReplaced ? 'disconnected' : 'reconnecting',
          ready: false,
          qrCode: null,
          phoneNumber,
          expectedPhoneNumber,
          error: loggedOut || restartRequired ? null : this.errorMessage(update.lastDisconnect?.error, authInvalid),
        })
        if (!loggedOut && !restartRequired) {
          await notifyRuntimeError({
            source: 'whatsapp',
            error: update.lastDisconnect?.error || new Error('WhatsApp connection closed'),
            metadata: { statusCode, phoneNumber },
          })
        }
        if (!loggedOut && !authInvalid && !connectionReplaced) this.scheduleReconnect(restartRequired ? 8000 : 3000)
      }
    })

    return this.getStatus()
  }

  setStatus(status) {
    this.status = status
    this.io?.emit('whatsapp:status', this.getStatus())
  }

  scheduleReconnect(delayMs) {
    if (this.reconnectTimer) return
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null
      if (!this.socket) this.start(this.status.expectedPhoneNumber || this.status.phoneNumber).catch((error) => {
        this.setStatus({ ...this.status, state: 'error', ready: false, error: error.message })
      })
    }, delayMs)
  }

  clearReconnectTimer() {
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer)
    this.reconnectTimer = null
  }

  async useAuthState() {
    const creds = (await this.readAuthData('creds')) || initAuthCreds()
    return {
      state: {
        creds,
        keys: {
          get: async (type, ids) => {
            const data = {}
            await Promise.all(ids.map(async (id) => {
              let value = await this.readAuthData(`${type}-${id}`)
              if (type === 'app-state-sync-key' && value) {
                value = proto.Message.AppStateSyncKeyData.fromObject(value)
              }
              data[id] = value
            }))
            return data
          },
          set: async (data) => {
            const tasks = []
            for (const category in data) {
              for (const id in data[category]) {
                const value = data[category][id]
                tasks.push(value ? this.writeAuthData(`${category}-${id}`, value) : this.removeAuthData(`${category}-${id}`))
              }
            }
            await Promise.all(tasks)
          },
        },
      },
      saveCreds: () => this.writeAuthData('creds', creds),
    }
  }

  async readAuthData(file) {
    const state = await getState()
    const raw = state.whatsappAuth?.[file]
    if (!raw) return null
    try {
      return JSON.parse(raw, BufferJSON.reviver)
    } catch {
      return null
    }
  }

  async writeAuthData(file, value) {
    const payload = JSON.stringify(value, BufferJSON.replacer)
    await updateState((draft) => {
      draft.whatsappAuth[file] = payload
    })
  }

  async removeAuthData(file) {
    await updateState((draft) => {
      delete draft.whatsappAuth[file]
    })
  }

  async clearAuthState() {
    await updateState((draft) => {
      draft.whatsappAuth = {}
    })
  }

  phoneFromJid(jid) {
    return jid?.split('@')[0]?.split(':')[0] || null
  }

  errorMessage(error, fatalSessionError = false) {
    const statusCode = error?.output?.statusCode
    const streamCode = error?.data?.code
    const reason = error?.data?.reason
    const details = [statusCode && `status ${statusCode}`, streamCode && `code ${streamCode}`, reason].filter(Boolean).join(' · ')
    const base = error instanceof Error ? error.message : 'WhatsApp connection closed'
    if (fatalSessionError) return `${base}${details ? ` (${details})` : ''}. Session was reset; click Start / refresh QR to pair again.`
    if (details) return `${base} (${details})`
    if (error instanceof Error) return error.message
    return 'WhatsApp connection closed'
  }
}

module.exports = new WhatsAppService()
