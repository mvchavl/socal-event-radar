// collector/parsers/luma.js
// High value for tech, startup, creative, professional, interesting community + social mixers in LA.
const cheerio = require('cheerio');
const { httpGet, makeEvent, parseDate, inferRegion, norm } = require('../util');

async function collect() {
  const events = [];
  const targets = [
    'https://lu.ma/los-angeles',
    'https://lu.ma/explore?location=los-angeles',
    'https://lu.ma/discover?location=los-angeles',
  ];

  for (const url of targets) {
    let html;
    try { html = await httpGet(url); } catch { continue; }
    const $ = cheerio.load(html);

    $('a[href*="/"], .event-card, [data-event], article').each((i, el) => {
      const txt = norm($(el).text());
      if (txt.length < 12) return;

      const title = norm($(el).find('h1,h2,h3,h4,a').first().text()) || txt.slice(0, 110);
      if (!title || title.length < 5) return;

      const date = parseDate(txt) || parseDate($(el).find('time').first().text());
      if (!date) return;

      const link = $(el).attr('href') || $(el).find('a').attr('href') || url;
      const venue = norm($(el).find('.location, [class*="loc"]').first().text()) || '';

      const ev = makeEvent({
        title,
        date,
        venue,
        region: inferRegion(txt + ' ' + venue),
        source_url: link.startsWith('http') ? link : `https://lu.ma${link}`,
        confidence: 'medium',
      }, 'lu.ma');

      events.push(ev);
    });
  }

  // dedupe within source
  const seen = new Set();
  return events.filter(e => {
    if (seen.has(e.id)) return false;
    seen.add(e.id);
    return true;
  });
}

module.exports = { collect, id: 'luma' };
