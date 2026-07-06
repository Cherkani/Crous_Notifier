const axios = require('axios')
const cheerio = require('cheerio')

async function scrapeCrous(url) {
  const response = await axios.get(url, {
    timeout: 12000,
    headers: {
      'user-agent': 'Mozilla/5.0 Crous Automation Watcher',
      accept: 'text/html,application/xhtml+xml',
    },
  })

  const $ = cheerio.load(response.data)
  const cards = []

  $('div.fr-card.svelte-12dfls6').each((_, element) => {
    const link = $(element).find('a').first()
    const title = link.text().replace(/\s+/g, ' ').trim()
    const href = link.attr('href')
    if (!title) return
    cards.push({
      title,
      url: href ? new URL(href, url).toString() : url,
    })
  })

  return cards
}

module.exports = {
  scrapeCrous,
}
