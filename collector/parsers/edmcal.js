// collector/parsers/edmcal.js — TIER B best-effort HTML for festival calendars.
// edmcalendar.com + electronicmidwest.com share a layout (festival rows). Degrades gracefully.
const cheerio = require('cheerio');
const { httpGet, makeEvent, parseDate, inferRegion, norm } = require('../util');
const PAGES = [
  { name: 'EDMcalendar', url: 'https://edmcalendar.com/edm-event-calendar/southern-california/' },
  { name: 'Electronic Midwest', url: 'https://electronicmidwest.com/edm-event-calendar/southern-california/' },
];
async function collect() {
  const events = [];
  for (const page of PAGES) {
    let html; try { html = await httpGet(page.url); } catch { continue; }
    const $ = cheerio.load(html);
    // these pages render festival entries as repeated blocks with a date + title + venue line
    $('article, .event, .tribe-events-calendar-list__event, li, .fl-post-grid-post').each((i, el) => {
      const text = norm($(el).text());
      if (text.length < 12 || text.length > 400) return;
      const link = $(el).find('a').first().attr('href') || page.url;
      const titleEl = $(el).find('h1,h2,h3,h4,.title,a').first();
      const title = norm(titleEl.text()).slice(0, 120);
      const date = parseDate(text);
      if (!title || !date) return;
      events.push(makeEvent({
        title, date, venue: '', region: inferRegion(text),
        source_url: link.startsWith('http') ? link : page.url, ticket_url: link.startsWith('http') ? link : '',
        is_festival: true, confidence: 'low',
      }, page.name));
    });
  }
  // de-noise: keep only rows with a plausible festival-ish title
  return events.filter((e) => e.title && e.title.length > 4);
}
module.exports = { collect, id: 'edmcal' };
