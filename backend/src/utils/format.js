function cleanPhone(value) {
  return String(value || '').replace(/\D/g, '')
}

function publicPhone(value) {
  const digits = cleanPhone(value)
  return digits ? `+${digits}` : ''
}

function isValidPhone(value) {
  const digits = cleanPhone(value)
  return digits.length >= 8 && digits.length <= 15
}

function renderTemplate(template, context) {
  return String(template || '')
    .replaceAll('{items}', context.items || '')
    .replaceAll('{url}', context.url || '')
    .replaceAll('{watchName}', context.watchName || '')
    .replaceAll('{count}', String(context.count ?? ''))
}

module.exports = {
  cleanPhone,
  isValidPhone,
  publicPhone,
  renderTemplate,
}
