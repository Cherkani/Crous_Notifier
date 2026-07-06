const nodemailer = require('nodemailer')
const config = require('../config')

function assertSmtpConfigured() {
  const missing = []
  if (!config.smtp.host) missing.push('SMTP_HOST')
  if (!config.smtp.user) missing.push('SMTP_USER')
  if (!config.smtp.pass) missing.push('SMTP_PASS')
  if (!config.smtp.from) missing.push('SMTP_FROM')
  if (missing.length) throw new Error(`Missing SMTP configuration: ${missing.join(', ')}`)
}

function createTransport() {
  assertSmtpConfigured()
  return nodemailer.createTransport({
    host: config.smtp.host,
    port: config.smtp.port,
    secure: config.smtp.secure,
    auth: {
      user: config.smtp.user,
      pass: config.smtp.pass,
    },
  })
}

async function sendMail({ to, subject, text }) {
  const transport = createTransport()
  const result = await transport.sendMail({
    from: config.smtp.from,
    to,
    subject,
    text,
  })
  return { provider: 'smtp', id: result.messageId }
}

module.exports = {
  sendMail,
}
