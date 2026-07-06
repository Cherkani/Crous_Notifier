const axios = require('axios')
const cheerio = require('cheerio')

function cleanText(value) {
  return String(value || '').replace(/\s+/g, ' ').trim()
}

function absoluteUrl(href, baseUrl) {
  if (!href) return ''
  try {
    return new URL(href, baseUrl).toString()
  } catch {
    return ''
  }
}

function parseListingId(url) {
  if (!url) return ''
  const match = String(url).match(/\/([^/?#]+)(?:[?#])?$/)
  return match ? match[1] : ''
}

function firstValue(source, keys) {
  if (!source || typeof source !== 'object') return ''
  for (const key of keys) {
    if (source[key] !== undefined && source[key] !== null && source[key] !== '') return source[key]
  }
  return ''
}

function parsePrice(value) {
  const text = cleanText(value)
  if (!text) return ''
  const numeric = text.match(/(\d+(?:[,.]\d+)?)/)
  return numeric ? `${numeric[1].replace(',', '.')} €` : text
}

function looksLikeNotFound($) {
  const title = cleanText($('title').text()).toLowerCase()
  const body = cleanText($('body').text()).toLowerCase()
  return title.includes('page non trouvée') || body.includes('page non trouvée')
}

function parseResultCount($) {
  const heading = cleanText($('h2.SearchResults-desktop').first().text() || $('h2').filter((_, element) => {
    const text = cleanText($(element).text()).toLowerCase()
    return text.includes('logement') || text.includes('résultat') || text.includes('resultat') || text.startsWith('aucun')
  }).first().text())

  if (!heading) return null
  if (/^aucun/i.test(heading)) return 0
  const match = heading.match(/\d+/)
  return match ? Number(match[0]) : null
}

function normalizeAccommodationObject(item, baseUrl) {
  if (!item || typeof item !== 'object') return null

  const rawTitle = firstValue(item, ['title', 'label', 'name', 'residenceLabel', 'residence', 'typology', 'type'])
  const rawUrl = firstValue(item, ['url', 'href', 'link', 'permalink'])
  const rawId = firstValue(item, ['id', 'accommodationId', 'accommodation_id', 'logementId', 'residenceId'])
  const rawAddress = firstValue(item, ['address', 'adresse', 'location', 'city', 'sector', 'residenceAddress'])
  const rawPrice = firstValue(item, ['price', 'rent', 'loyer', 'amount', 'redevance'])
  const rawImage = firstValue(item, ['image', 'imageUrl', 'image_url', 'photo', 'photoUrl', 'thumbnail'])

  const hasAccommodationSignal = rawPrice || rawAddress || rawImage || rawUrl || rawId
  const title = cleanText(rawTitle)
  if (!title || !hasAccommodationSignal) return null

  const url = absoluteUrl(rawUrl, baseUrl)
  const id = rawId ? String(rawId) : parseListingId(url)
  const details = []
  const address = cleanText(rawAddress)
  if (address) details.push(address)
  for (const value of [
    firstValue(item, ['surface', 'area']),
    firstValue(item, ['availability', 'availableAt']),
    firstValue(item, ['crous', 'city']),
  ]) {
    const text = cleanText(value)
    if (text && !details.includes(text)) details.push(text)
  }

  return {
    id,
    key: id || url || title,
    title,
    url: url || baseUrl,
    price: parsePrice(rawPrice),
    address,
    details,
    overview: details.join('\n'),
    imageUrl: absoluteUrl(rawImage, baseUrl),
  }
}

function walkJson(value, visitor) {
  if (!value || typeof value !== 'object') return
  if (Array.isArray(value)) {
    value.forEach((item) => walkJson(item, visitor))
    return
  }
  visitor(value)
  Object.values(value).forEach((child) => walkJson(child, visitor))
}

function parseSvelteKitFetchedAccommodations($, baseUrl) {
  const listings = []

  $('script[type="application/json"][data-sveltekit-fetched]').each((_, element) => {
    const dataUrl = $(element).attr('data-url') || ''
    if (!/search|accommodation|logement|residence/i.test(dataUrl)) return

    let payload
    try {
      payload = JSON.parse($(element).text())
      if (typeof payload.body === 'string') payload = JSON.parse(payload.body)
    } catch {
      return
    }

    walkJson(payload, (item) => {
      const listing = normalizeAccommodationObject(item, baseUrl)
      if (listing && !listings.some((existing) => existing.key === listing.key)) listings.push(listing)
    })
  })

  return listings
}

function parseAccommodationCard($, element, baseUrl) {
  const card = $(element)
  const titleNode = card.find('h3.fr-card__title').first()
  const link = titleNode.find('a').first().length
    ? titleNode.find('a').first()
    : card.find('a[href]').first()
  const title = cleanText(titleNode.text() || link.text())
  const url = absoluteUrl(link.attr('href'), baseUrl)

  if (!title && !url) return null

  const details = []
  const address = cleanText(card.find('p.fr-card__desc').first().text())
  if (address) details.push(address)
  card.find('p.fr-card__detail').each((_, detail) => {
    const text = cleanText($(detail).text())
    if (text) details.push(text)
  })

  const image = absoluteUrl(card.find('img.fr-responsive-img, img').first().attr('src'), baseUrl)
  const price = parsePrice(card.find('p.fr-badge, .fr-badge').first().text())
  const id = parseListingId(url)

  return {
    id,
    key: id || url || title,
    title: title || url,
    url: url || baseUrl,
    price,
    address,
    details,
    overview: details.join('\n'),
    imageUrl: image,
  }
}

async function scrapeCrous(url) {
  const response = await axios.get(url, {
    timeout: 12000,
    headers: {
      'user-agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36 CrousAutomation/1.0',
      accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      'accept-language': 'fr-FR,fr;q=0.9,en;q=0.7',
    },
  })

  const $ = cheerio.load(response.data)
  if (response.status === 404 || looksLikeNotFound($)) {
    throw new Error('Crous search URL returned a 404 page. Re-copy the URL from the live Crous search after selecting a city/zone.')
  }

  const cards = []

  $('div.fr-card').each((_, element) => {
    const listing = parseAccommodationCard($, element, url)
    if (listing) cards.push(listing)
  })

  if (!cards.length) {
    $('[class*="fr-card"]').each((_, element) => {
      const listing = parseAccommodationCard($, element, url)
      if (listing && !cards.some((card) => card.key === listing.key)) cards.push(listing)
    })
  }

  if (!cards.length) {
    cards.push(...parseSvelteKitFetchedAccommodations($, url))
  }

  const resultCount = parseResultCount($)
  if (resultCount !== null && resultCount > 0 && !cards.length) {
    throw new Error(`Crous page reported ${resultCount} result(s), but no listing cards could be parsed`)
  }

  return cards
}

module.exports = {
  parseAccommodationCard,
  parseResultCount,
  parseSvelteKitFetchedAccommodations,
  scrapeCrous,
}
