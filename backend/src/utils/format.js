function cleanPhone(value) {
  return String(value || '').replace(/\D/g, '')
}

function publicPhone(value) {
  const digits = cleanPhone(value)
  return digits ? `+${digits}` : ''
}

function splitValues(value) {
  if (Array.isArray(value)) return value
  return String(value || '')
    .split(/[\n,;]+/)
    .map((item) => item.trim())
    .filter(Boolean)
}

function publicPhoneList(value) {
  return [...new Set(splitValues(value).map(publicPhone).filter(Boolean))].join(', ')
}

function emailList(value) {
  return [...new Set(splitValues(value).map((item) => item.trim()).filter(Boolean))].join(', ')
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
  emailList,
  isValidPhone,
  publicPhone,
  publicPhoneList,
  renderTemplate,
  splitValues,
}
