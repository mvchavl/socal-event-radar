// collector/parsers/library.js
// LA County Library + LA Public Library — excellent for wholesome, free, community, workshops, talks, Silver Lake / Cerritos area events.
const cheerio = require('cheerio');
const { httpGet, makeEvent, parseDate, inferRegion, norm } = require('../util');

const PAGES = [
  { name: 'LA County Library', url: 'https://visit.lacountylibrary.org/events' },
  { name: 'LA Public Library', url: 'https://www.lapl.org/whats-on/calendar' },
];

async function collect() {
  const events = [];

  for (const p of PAGES) {
    let html;
    try { html = await httpGet(p.url); } catch { continue; }
    const $ = cheerio.load(html);

    $('a[href*="/event"], .event, article, .calendar-event, .views-row, .event-card').each((i, el) => {
      const txt = norm($(el).text());
      if (txt.length < 12) return;

      const title = norm($(el).find('h3, h4, a, .title').first().text()) || txt.slice(0, 120);
      if (!title) return;

      const date = parseDate(txt) || parseDate($(el).find('time, .date').first().text());
      if (!date) return;

      const link = $(el).find('a').first().attr('href') || p.url;
      const venue = norm($(el).find('.location, .venue, .branch').text()) || 'Library / Community Center';

      const ev = makeEvent({
        title,
        date,
        venue,
        region: inferRegion(txt + ' ' + venue),
        source_url: link.startsWith('http') ? link : (link.startsWith('/') ? 'https://www.lapl.org' + link : p.url),
        is_free_rsvp: true,
        price: 'free',
        confidence: 'high',
      }, p.name);

      events.push(ev);
    });
  }

  return events;
}

module.exports = { collect, id: 'library' };
