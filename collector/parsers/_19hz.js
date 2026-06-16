// collector/parsers/_19hz.js — TIER B (static HTML). The backbone source.
// Parses the LA/SoCal listing table (also covers San Diego + Inland Empire via the region column).
const cheerio = require('cheerio');
const { httpGet, makeEvent, parseDate, parseTime, inferRegion, norm } = require('../util');

const PAGES = [
  { url: 'https://19hz.info/eventlisting_LosAngeles.php', label: 'LA/SoCal' },
];

function splitTitleVenue(text) {
  // "Event Title @ Venue (Region)"  -> {title, venue, region}
  const t = norm(text);
  const at = t.lastIndexOf(' @ ');
  if (at === -1) return { title: t, venue: '', region: '' };
  const title = t.slice(0, at).trim();
  let rest = t.slice(at + 3).trim();
  let region = '';
  const rm = rest.match(/\(([^)]*)\)\s*$/);
  if (rm) { region = rm[1]; rest = rest.replace(/\([^)]*\)\s*$/, '').trim(); }
  return { title, venue: rest, region };
}

function splitPriceAge(text) {
  const t = norm(text);
  if (!t) return { price: '', age: '' };
  const parts = t.split('|').map((x) => x.trim());
  if (parts.length === 2) return { price: parts[0], age: parts[1] };
  // sometimes age is embedded like "$20 21+"
  const am = t.match(/(\b(all ages|18\+|21\+)\b)/i);
  if (am) return { price: t.replace(am[1], '').trim(), age: am[1] };
  return { price: t, age: '' };
}

async function collect() {
  const events = [];
  for (const page of PAGES) {
    const html = await httpGet(page.url);
    const $ = cheerio.load(html);
    const rows = $('table').first().find('tr');
    rows.each((i, tr) => {
      if (i === 0) return; // header
      const tds = $(tr).find('td');
      if (tds.length < 6) return;
      const dateCell = $(tds[0]).text();
      const tvCell = $(tds[1]);
      const tagsCell = $(tds[2]).text();
      const priceCell = $(tds[3]).text();
      const orgCell = $(tds[4]).text();
      const extraLinks = $(tds[5]).find('a').map((k, a) => $(a).attr('href')).get();
      const isoHint = tds.length >= 7 ? $(tds[6]).text() : '';

      const ticketUrl = tvCell.find('a').first().attr('href') || '';
      const { title, venue, region } = splitTitleVenue(tvCell.text());
      if (!title) return;
      const { start, end } = parseTime(dateCell);
      const { price, age } = splitPriceAge(priceCell);
      const genres = norm(tagsCell).split(',').map((s) => s.trim()).filter(Boolean);

      events.push(makeEvent({
        title, venue,
        region: inferRegion(`${region} ${venue}`),
        date: parseDate(dateCell, isoHint),
        start_time: start, end_time: end,
        genres, price, age,
        promoter: norm(orgCell),
        source_url: page.url,
        ticket_url: ticketUrl,
        confidence: 'high',
        vibe_tags: [],
      }, '19hz'));
    });
  }
  return events;
}

module.exports = { collect, id: '19hz' };
