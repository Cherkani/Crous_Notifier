const crypto = require('crypto')

const COOKIE_NAME = 'crous_session'
const SESSION_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000

function parseCookies(header = '') {
  return String(header || '')
    .split(';')
    .map((item) => item.trim())
    .filter(Boolean)
    .reduce((cookies, item) => {
      const index = item.indexOf('=')
      if (index === -1) return cookies
      cookies[item.slice(0, index)] = decodeURIComponent(item.slice(index + 1))
      return cookies
    }, {})
}

function timingSafeEqualText(left, right) {
  const leftBuffer = Buffer.from(String(left))
  const rightBuffer = Buffer.from(String(right))
  if (leftBuffer.length !== rightBuffer.length) return false
  return crypto.timingSafeEqual(leftBuffer, rightBuffer)
}

function getAuthConfig() {
  return {
    username: process.env.APP_LOGIN_USER || 'salma',
    password: process.env.APP_LOGIN_PASSWORD || 'i love u baby',
    secret: process.env.APP_SESSION_SECRET || 'crous-local-session-secret',
  }
}

function signPayload(payload) {
  const { secret } = getAuthConfig()
  return crypto.createHmac('sha256', secret).update(payload).digest('base64url')
}

function createSessionToken(username) {
  const payload = Buffer.from(JSON.stringify({
    username,
    exp: Date.now() + SESSION_MAX_AGE_MS,
  })).toString('base64url')
  return `${payload}.${signPayload(payload)}`
}

function verifySessionToken(token) {
  if (!token || !token.includes('.')) return null
  const [payload, signature] = token.split('.')
  if (!payload || !signature || !timingSafeEqualText(signature, signPayload(payload))) return null
  try {
    const data = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'))
    if (!data.exp || Date.now() > data.exp) return null
    if (data.username !== getAuthConfig().username) return null
    return data
  } catch {
    return null
  }
}

function cookieOptions(req) {
  const secure = req.secure || req.headers['x-forwarded-proto'] === 'https'
  return {
    httpOnly: true,
    sameSite: 'lax',
    secure,
    path: '/',
    maxAge: SESSION_MAX_AGE_MS,
  }
}

function requireAuth(req, res, next) {
  const cookies = parseCookies(req.headers.cookie)
  const session = verifySessionToken(cookies[COOKIE_NAME])
  if (!session) {
    res.status(401).json({ success: false, message: 'Login required' })
    return
  }
  req.session = session
  next()
}

function isSocketAuthenticated(socket) {
  const cookies = parseCookies(socket.handshake.headers.cookie)
  return Boolean(verifySessionToken(cookies[COOKIE_NAME]))
}

module.exports = {
  COOKIE_NAME,
  createSessionToken,
  cookieOptions,
  getAuthConfig,
  isSocketAuthenticated,
  requireAuth,
  verifySessionToken,
}
