// collector/parsers/manual.js — TIER D. Your hand-entered events from IG/Discord/SMS/flyers.
const fs = require('fs');
const path = require('path');
const { makeEvent, parseDate, inferRegion, norm } = require('../util');

async function collect() {
  const p = path.join(__dirname, '../../data/manual_events.json');
  let rows = [];
  try { rows = JSON.parse(fs.readFileSync(p, 'utf8')); } catch { return []; }
  return rows
    .map(normalizeManualRow)
    .filter((r) => r.title || r.date || r.venue)
    .map((r) => makeEvent({ ...r, confidence: r.confidence || 'medium' }, r.source_name || 'Manual'));
}

function normalizeManualRow(row) {
  if (typeof row === 'string') return parseManualText(row);
  const rawText = row.paste || row.text || row.raw || row.flyer || '';
  const parsed = rawText ? parseManualText(rawText) : {};
  const merged = { ...parsed, ...row };
  delete merged.paste; delete merged.text; delete merged.raw; delete merged.flyer;
  if (!merged.region) merged.region = inferRegion(`${merged.venue || ''} ${merged.city || ''} ${rawText}`);
  return merged;
}

function parseManualText(text) {
  const body = norm(text);
  const labels = {};
  for (const line of String(text || '').split(/\r?\n/).map((l) => l.trim()).filter(Boolean)) {
    const m = line.match(/^([a-z][a-z /_-]{1,24})\s*:\s*(.+)$/i);
    if (m) labels[m[1].toLowerCase().replace(/[\s_-]+/g, '_')] = norm(m[2]);
  }
  const firstTextLine = String(text || '').split(/\r?\n/).map((l) => l.trim()).find((l) => l && !/^[a-z][a-z /_-]{1,24}\s*:/i.test(l));
  const title = labels.event || labels.title || labels.name || firstTextLine || '';
  const date = parseDate(labels.date || labels.when || body);
  const times = extractTimes(labels.time || labels.hours || body);
  const venue = labels.venue || labels.location || labels.place || extractVenue(body);
  const artists = splitList(labels.lineup || labels.artists || labels.djs || '');
  const genres = extractGenres(`${labels.genre || labels.genres || labels.tags || ''} ${body}`);
  const price = labels.price || labels.cover || extractPrice(body);
  const age = labels.age || extractAge(body);
  const promoter = labels.promoter || labels.collective || labels.host || labels.by || '';
  const url = labels.url || labels.link || (body.match(/https?:\/\/\S+/i)?.[0] || '');

  return {
    title, date,
    start_time: times.start,
    end_time: times.end,
    venue,
    region: inferRegion(`${venue} ${body}`),
    artists,
    genres,
    price,
    age,
    promoter,
    source_url: url.replace(/[),.;]+$/, ''),
    ticket_url: url.replace(/[),.;]+$/, ''),
    source_name: labels.source || 'Manual (paste)',
    description: body.slice(0, 500),
    is_underground: /\b(tba|warehouse|secret|underground|afters|afterhours|dtla)\b/i.test(body),
  };
}

function extractTimes(text) {
  const range = norm(text).match(/(\d{1,2}(?::\d{2})?\s*(?:am|pm))\s*(?:-|–|to)\s*(\d{1,2}(?::\d{2})?\s*(?:am|pm))/i);
  if (range) return { start: compactTime(range[1]), end: compactTime(range[2]) };
  const one = norm(text).match(/\b(\d{1,2}(?::\d{2})?\s*(?:am|pm))\b/i);
  return { start: one ? compactTime(one[1]) : '', end: '' };
}

function compactTime(s) { return norm(s).toLowerCase().replace(/\s+/g, ''); }

function extractVenue(text) {
  const m = text.match(/(?:venue|location|place)\s*[:\-]\s*([^|,\n]+)/i) || text.match(/\s@\s*([^|,\n]+)/i) || text.match(/\bat\s+([^|,\n]+)/i);
  return m ? norm(m[1]).slice(0, 100) : '';
}

function splitList(s) {
  return norm(s).split(/\s*(?:,|\/|\+|&|\bx\b)\s*/i).map((x) => x.trim()).filter(Boolean).slice(0, 20);
}

function extractGenres(text) {
  const terms = ['hard techno', 'schranz', 'techno', 'industrial', 'ebm', 'darkwave', 'trance', 'jungle', 'dnb', 'drum and bass', 'house', 'acid', 'bass', 'dubstep', 'breaks'];
  const lower = text.toLowerCase();
  return terms.filter((g) => lower.includes(g));
}

function extractPrice(text) {
  const m = text.match(/\b(free|rsvp|no cover)\b/i) || text.match(/\$\s*\d+(?:\s*-\s*\$?\d+)?/);
  return m ? norm(m[0]).toLowerCase() : '';
}

function extractAge(text) {
  const m = text.match(/\b(21\+|18\+|all ages)\b/i);
  return m ? m[1] : '';
}

module.exports = { collect, id: 'manual' };
