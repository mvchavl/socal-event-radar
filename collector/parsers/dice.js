// collector/parsers/dice.js — DICE event scraper for LA electronic/underground
const cheerio = require('cheerio');
const { httpGet, makeEvent, parseDate, inferRegion, norm, slug } = require('../util');

const TARGETS = [
  'https://dice.fm/browse/los-angeles',
  'https://dice.fm/browse/los-angeles?genres=techno',
  'https://dice.fm/browse/los-angeles?genres=electronic',
  'https://dice.fm/browse/los-angeles?genres=house',
];

async function collect() {
  const events = [];

  for (const url of TARGETS) {
    let html;
    try { html = await httpGet(url, { timeout: 15000 }); } catch { continue; }
    const $ = cheerio.load(html);

    // DICE renders events in cards with links
    $('a[href*="/event/"], [class*="event"], article').each((_, el) => {
      const txt = norm($(el).text());
      if (txt.length < 10) return;

      const title = norm($(el).find('h1,h2,h3,h4,.event-title,[class*="title"]').first().text()) || txt.slice(0, 120);
      if (!title || title.length < 4) return;

      const date = parseDate(txt) || parseDate($(el).find('time,[class*="date"]').first().text());
      if (!date) return;

      const link = $(el).attr('href') || $(el).find('a[href*="/event/"]').attr('href') || '';
      const fullLink = link.startsWith('http') ? link : link ? `https://dice.fm${link}` : url;

      const venue = norm($(el).find('[class*="venue"],[class*="location"]').first().text()) || '';
      const price = norm($(el).find('[class*="price"]').first().text()) || '';

      const blob = `${title} ${venue} ${txt}`.toLowerCase();
      const genres = [];
      if (/techno|industrial|ebm/.test(blob)) genres.push('techno');
      if (/house|deep house|tech house/.test(blob)) genres.push('house');
      if (/electronic|electro/.test(blob)) genres.push('electronic');
      if (/dnb|drum.?n.?bass/.test(blob)) genres.push('dnb');

      const ev = makeEvent({
        title,
        date,
        venue,
        region: inferRegion(txt + ' ' + venue) || 'Los Angeles',
        genres,
        price,
        source_url: fullLink,
        ticket_url: fullLink,
        confidence: 'medium',
        is_underground: /underground|warehouse|secret|popup/i.test(blob),
      }, 'DICE');

      events.push(ev);
    });
  }

  const seen = new Set();
  return events.filter(e => {
    if (seen.has(e.id)) return false;
    seen.add(e.id);
    return true;
  });
}

module.exports = { collect, id: 'dice' };
