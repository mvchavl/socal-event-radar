// collector/parsers/partiful.js — best-effort parser for public Partiful pages
// No API; scrapes meta tags and JSON-LD from public event pages.
const cheerio = require('cheerio');
const { httpGet, makeEvent, parseDate, inferRegion, norm } = require('../util');

async function collect() {
  // Partiful has no browse/search. We parse known URLs from manual_events.json
  // and any Partiful links previously seen. This parser is a passthrough — the
  // real ingestion happens via Manual Inbox link pasting + /api/fetch-event.
  // Here we re-check any previously saved Partiful URLs for updated details.
  const fs = require('fs');
  const path = require('path');
  const events = [];

  const manualPath = path.join(__dirname, '..', '..', 'data', 'manual_events.json');
  let manualEvents = [];
  try { manualEvents = JSON.parse(fs.readFileSync(manualPath, 'utf8')); } catch { return []; }

  const partifulUrls = manualEvents
    .filter(e => (e.source_url || '').includes('partiful.com'))
    .map(e => e.source_url)
    .filter(Boolean);

  for (const url of partifulUrls.slice(0, 20)) {
    try {
      const ev = await parsePartifulPage(url);
      if (ev) events.push(ev);
    } catch { /* skip broken pages */ }
  }

  return events;
}

async function parsePartifulPage(url) {
  let html;
  try { html = await httpGet(url); } catch { return null; }
  const $ = cheerio.load(html);

  const title = $('meta[property="og:title"]').attr('content')
    || $('meta[name="twitter:title"]').attr('content')
    || $('title').text()
    || '';
  if (!title || title.length < 3) return null;

  const description = $('meta[property="og:description"]').attr('content')
    || $('meta[name="description"]').attr('content')
    || '';

  // Try JSON-LD
  let jsonLd = null;
  $('script[type="application/ld+json"]').each((_, el) => {
    try {
      const data = JSON.parse($(el).html());
      if (data['@type'] === 'Event' || data['@type'] === 'SocialEvent') jsonLd = data;
    } catch { /* ignore */ }
  });

  let date = null, startTime = '', venue = '', city = '';

  if (jsonLd) {
    if (jsonLd.startDate) {
      const d = new Date(jsonLd.startDate);
      if (!isNaN(d)) {
        date = d.toISOString().slice(0, 10);
        startTime = d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true }).toLowerCase();
      }
    }
    if (jsonLd.location) {
      venue = jsonLd.location.name || '';
      city = jsonLd.location.address?.addressLocality || '';
    }
  }

  if (!date) date = parseDate(description + ' ' + title);

  const blob = `${title} ${description} ${venue}`;

  return makeEvent({
    title: norm(title),
    date,
    start_time: startTime,
    venue: norm(venue),
    region: city || inferRegion(blob),
    source_url: url,
    ticket_url: url,
    description: norm(description).slice(0, 300),
    confidence: 'low',
    is_free_rsvp: /free|rsvp|no cover/i.test(blob),
  }, 'Partiful');
}

module.exports = { collect, id: 'partiful', parsePartifulPage };
