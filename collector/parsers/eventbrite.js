// collector/parsers/eventbrite.js
// Tier C best-effort for general events: pop-ups, workshops, networking, art, community, Silver Lake/Arts District, free RSVPs, etc.
const cheerio = require('cheerio');
const { httpGet, makeEvent, parseDate, inferRegion, norm, cleanScraped } = require('../util');

async function collect() {
  const events = [];
  const urls = [
    'https://www.eventbrite.com/d/ca--los-angeles/all-events/',
    'https://www.eventbrite.com/d/ca--los-angeles/free--events/',
    'https://www.eventbrite.com/d/ca--orange-county/all-events/',
    'https://www.eventbrite.com/d/ca--long-beach/all-events/',
  ];

  for (const url of urls) {
    let html;
    try { html = await httpGet(url); } catch { continue; }
    const $ = cheerio.load(html);

    $('a[href*="/e/"]').each((i, el) => {
      const $el = $(el);
      const title = cleanScraped($el.text());
      if (!title || title.length < 6) return;

      const href = $el.attr('href') || '';
      const parent = $el.closest('div, li, article, section');
      const txt = norm(parent.text() || '');

      const date = parseDate(txt) || parseDate(parent.find('time').first().text());
      if (!date) return;

      let venue = cleanScraped(parent.find('[class*="location"], [class*="venue"], .adr').first().text());
      if (!venue && txt.includes('·')) venue = cleanScraped(txt.split('·').pop().trim().slice(0, 80));

      const isFree = /free|no cost|rsvp/i.test(txt);

      const ev = makeEvent({
        title: title.slice(0, 160),
        date,
        venue,
        region: inferRegion(txt + ' ' + venue),
        source_url: href.startsWith('http') ? href : `https://www.eventbrite.com${href}`,
        ticket_url: href.startsWith('http') ? href : `https://www.eventbrite.com${href}`,
        is_free_rsvp: isFree,
        price: isFree ? 'free / RSVP' : '',
        confidence: 'medium',
        // categories will be auto-derived by makeEvent via deriveCategories
      }, 'Eventbrite');

      // Force some useful broad categories for general events
      if (!ev.categories || ev.categories.length === 0 || ev.categories.includes('community')) {
        // already handled in deriveCategories, but we can nudge
      }
      events.push(ev);
    });
  }

  return events.filter(e => e.title && e.date);
}

module.exports = { collect, id: 'eventbrite' };
