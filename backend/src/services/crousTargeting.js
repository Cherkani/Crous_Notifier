const axios = require('axios')
const config = require('../config')

const CROUS_BASE_URL = 'https://trouverunlogement.lescrous.fr'

function formatBounds(feature) {
  const extent = feature?.properties?.extent
  if (Array.isArray(extent) && extent.length === 4) {
    return extent.join('_')
  }

  const coordinates = feature?.geometry?.coordinates
  if (Array.isArray(coordinates) && coordinates.length >= 2) {
    const [longitude, latitude] = coordinates.map(Number)
    const delta = 0.035
    return [
      longitude - delta,
      latitude + delta,
      longitude + delta,
      latitude - delta,
    ].join('_')
  }

  return ''
}

async function resolveCrousPlace(query) {
  if (!query?.trim()) throw new Error('Target city/residence is required')

  const response = await axios.get(`${CROUS_BASE_URL}/photon/api`, {
    timeout: 10000,
    params: {
      q: query.trim(),
      limit: 5,
    },
    headers: {
      accept: 'application/json',
      'accept-language': 'fr-FR,fr;q=0.9,en;q=0.7',
      'user-agent': 'Mozilla/5.0 Crous Automation Watcher',
    },
  })

  const feature = response.data?.features?.find((item) => item?.properties?.country === 'France') || response.data?.features?.[0]
  if (!feature) throw new Error(`No Crous location suggestion found for "${query}"`)

  const bounds = formatBounds(feature)
  if (!bounds) throw new Error(`Could not calculate map bounds for "${query}"`)

  const properties = feature.properties || {}
  return {
    label: [properties.name, properties.postcode].filter(Boolean).join(' '),
    bounds,
    coordinates: feature.geometry?.coordinates || null,
    properties,
  }
}

async function buildCrousSearchUrl({
  location,
  occupationMode = 'alone',
  maxPrice = '',
  minArea = '',
}) {
  const place = await resolveCrousPlace(location)
  const url = new URL(`/tools/${config.crousToolId}/search`, CROUS_BASE_URL)
  url.searchParams.set('bounds', place.bounds)
  if (occupationMode) url.searchParams.set('occupationModes', occupationMode)
  if (maxPrice) url.searchParams.set('maxPrice', String(maxPrice))
  if (minArea) url.searchParams.set('minArea', String(minArea))
  return {
    url: url.toString(),
    place,
  }
}

module.exports = {
  buildCrousSearchUrl,
  resolveCrousPlace,
}
