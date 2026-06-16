// collector/util.js — shared helpers for normalization across all parsers
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

loadDotEnv();

const UA = 'Mozilla/5.0 (compatible; SoCalEventRadar/1.0; +https://github.com/)';
const LA_TIME_ZONE = 'America/Los_Angeles';

function loadDotEnv() {
  const p = path.join(__dirname, '..', '.env');
  let text = '';
  try { text = fs.readFileSync(p, 'utf8'); } catch { return; }
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const m = trimmed.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
    if (!m || process.env[m[1]] != null) continue;
    let value = m[2].trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) value = value.slice(1, -1);
    process.env[m[1]] = value;
  }
}

function datePartsInTimeZone(date = new Date(), timeZone = LA_TIME_ZONE) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone, year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(date);
  const byType = Object.fromEntries(parts.filter(p => p.type !== 'literal').map(p => [p.type, p.value]));
  return { year: Number(byType.year), month: Number(byType.month), day: Number(byType.day) };
}

function dateInTimeZone(date = new Date(), timeZone = LA_TIME_ZONE) {
  const p = datePartsInTimeZone(date, timeZone);
  return `${p.year}-${String(p.month).padStart(2, '0')}-${String(p.day).padStart(2, '0')}`;
}

function addDays(date, days) { const d = new Date(date); d.setDate(d.getDate() + days); return d; }

function formatTimeInTimeZone(value, timeZone = LA_TIME_ZONE) {
  if (!value) return '';
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) return '';
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone, hour: 'numeric', minute: '2-digit', hour12: true,
  }).formatToParts(d);
  const byType = Object.fromEntries(parts.filter(p => p.type !== 'literal').map(p => [p.type, p.value]));
  const minute = byType.minute || '00';
  const suffix = (byType.dayPeriod || '').toLowerCase();
  return `${Number(byType.hour)}${minute === '00' ? '' : ':' + minute}${suffix}`;
}

// Node 18+/22 has global fetch. Thin wrapper w/ UA + timeout + text/json helpers.
async function httpGet(url, { json = false, timeout = 20000, headers = {} } = {}) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeout);
  try {
    const res = await fetch(url, {
      headers: { 'User-Agent': UA, 'Accept': json ? 'application/json' : 'text/html,*/*', ...headers },
      signal: ctrl.signal,
      redirect: 'follow',
    });
    if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
    return json ? await res.json() : await res.text();
  } finally {
    clearTimeout(t);
  }
}

async function httpPost(url, body, { timeout = 20000, headers = {} } = {}) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeout);
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'User-Agent': UA, 'Content-Type': 'application/json', 'Accept': 'application/json', ...headers },
      body: typeof body === 'string' ? body : JSON.stringify(body),
      signal: ctrl.signal,
    });
    if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
    return await res.json();
  } finally {
    clearTimeout(t);
  }
}

const norm = (s) => (s || '').toString().replace(/\s+/g, ' ').trim();

function slug(s) {
  return norm(s).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
}

// stable id from the dedupe-critical fields
function eventId({ title, date, venue }) {
  return crypto.createHash('sha1').update(`${slug(title)}|${date || ''}|${slug(venue)}`).digest('hex').slice(0, 16);
}

const MONTHS = { jan:0,feb:1,mar:2,apr:3,may:4,jun:5,jul:6,aug:7,sep:8,oct:9,nov:10,dec:11 };

// Parse "Jun 15", "Jun 15 2026", "2026/06/15", "2026-06-15" -> YYYY-MM-DD (assume soonest future yr)
function parseDate(raw, hintISO) {
  if (hintISO) {
    const m = norm(hintISO).match(/(\d{4})[\/-](\d{1,2})[\/-](\d{1,2})/);
    if (m) return `${m[1]}-${m[2].padStart(2,'0')}-${m[3].padStart(2,'0')}`;
  }
  const s = norm(raw).toLowerCase();
  let m = s.match(/(\d{4})[\/-](\d{1,2})[\/-](\d{1,2})/);
  if (m) return `${m[1]}-${m[2].padStart(2,'0')}-${m[3].padStart(2,'0')}`;
  m = s.match(/(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?\s+(\d{1,2})(?:,?\s*(\d{4}))?/);
  if (m) {
    const mo = MONTHS[m[1]]; const day = parseInt(m[2], 10);
    let yr = m[3] ? parseInt(m[3], 10) : null;
    if (!yr) {
      const now = new Date();
      yr = datePartsInTimeZone(now).year;
      const cand = `${yr}-${String(mo + 1).padStart(2,'0')}-${String(day).padStart(2,'0')}`;
      const yesterday = dateInTimeZone(addDays(now, -1));
      if (cand < yesterday) yr += 1;
    }
    return `${yr}-${String(mo + 1).padStart(2,'0')}-${String(day).padStart(2,'0')}`;
  }
  return null;
}

// extract a "(7pm-11:45pm)" -> {start,end}
function parseTime(raw) {
  const m = norm(raw).match(/\(([^)]+)\)/);
  if (!m) return { start: '', end: '' };
  const inner = m[1];
  const parts = inner.split(/[-–]/).map((x) => x.trim());
  return { start: parts[0] || '', end: parts[1] || '' };
}

const UNDERGROUND_HINTS = /\b(tba|secret|warehouse|location|undisclosed|address.*day|dtla warehouse)\b/i;
const AFTERHOURS_HINTS = /\b(after\s?hours|afters|after-hours)\b/i;

function deriveFlags(ev) {
  const venue = (ev.venue || '').toLowerCase();
  const title = (ev.title || '').toLowerCase();
  const price = (ev.price || '').toLowerCase();
  const blob = `${venue} ${title}`;
  const is_tba_location = UNDERGROUND_HINTS.test(blob);
  const endHour = parseHour(ev.end_time);
  const startHour = parseHour(ev.start_time);
  const is_afterhours = AFTERHOURS_HINTS.test(blob) || (endHour != null && endHour >= 3 && endHour <= 11) || (startHour != null && startHour >= 23);
  return {
    is_tba_location,
    is_underground: is_tba_location || AFTERHOURS_HINTS.test(blob),
    is_afterhours,
    is_free_rsvp: /\bfree\b/.test(price) || /\brsvp\b/.test(price),
    is_festival: /\bfest(ival)?\b/.test(title) || (ev.is_festival === true),
  };
}

function deriveCategories(partial) {
  const blob = norm(`${partial.title || ''} ${partial.venue || ''} ${partial.description || ''} ${partial.promoter || ''} ${partial.genres ? partial.genres.join(' ') : ''}`).toLowerCase();
  const cats = new Set(partial.categories || []);

  // music / underground core (preserve existing signals + genres)
  const hasMusicSignal = /(techno|house|edm|rave|dj|electronic|bass|dubstep|dnb|jungle|hardstyle|schranz|industrial|ebm|goth|warehouse|minimal|acid|trance)/.test(blob);
  if (hasMusicSignal || (partial.genres && partial.genres.length)) cats.add('music');
  if (/(underground|afters|warehouse|tba|secret|loft|hard techno)/.test(blob)) cats.add('underground');
  if (/(festival|hard summer|escape|beyond|edc|nocturnal|countdown)/.test(blob)) { cats.add('music'); cats.add('festival'); }

  // afterhours
  if (/(afterhours|afters|4am|5am|late night)/.test(blob)) cats.add('afterhours');

  // tech / career / ai / quant / networking / professional
  if (/(tech|startup|ai |artificial intelligence|llm|machine learning|quant|quantitative|trading|data science|engineer|developer|product|founder|investor|networking|career fair|job|resume|interview)/.test(blob)) {
    cats.add('tech');
    if (/ai|llm|machine learning/.test(blob)) cats.add('ai');
    if (/quant|trading|finance|hedge/.test(blob)) cats.add('quant');
    if (/career|job|resume|hiring/.test(blob)) cats.add('career');
    if (/network|mixer|social|founder/.test(blob)) cats.add('networking');
    cats.add('professional');
  }

  // community / library / wholesome / free / education
  if (/(library|public library|county library|workshop|community event|free event|volunteer|book club|lecture)/.test(blob)) {
    cats.add('community');
    cats.add('wholesome');
    if (/library/.test(blob)) cats.add('library');
  }
  if (/(university|college|campus|cypress college|ucla|usc|csulb|cal state|student|education)/.test(blob)) {
    cats.add('education');
    cats.add('university');
  }
  if (/(free|no cover|rsvp free|pay what you can|community)/.test(blob)) cats.add('free');

  // art / gallery / culture
  if (/(art |gallery|exhibit|opening|moca|getty|hammer|arts district|culture|film screening)/.test(blob)) {
    cats.add('art');
    cats.add('gallery');
  }

  // social / mixer
  if (/(mixer|social event|happy hour|drinks|meet people|singles)/.test(blob)) {
    cats.add('social');
    cats.add('mixer');
  }

  // wellness / health / outdoor / pop-up / market
  if (/(yoga|meditation|wellness|breathwork|sound bath|run club|hike)/.test(blob)) { cats.add('wellness'); cats.add('health'); }
  if (/(pop-up|popup|market|farmers|vendor|night market)/.test(blob)) { cats.add('pop-up'); cats.add('market'); }
  if (/(outdoor|park|beach|rooftop)/.test(blob)) cats.add('outdoor');

  // business / professional already covered above

  if (cats.size === 0) {
    cats.add('community'); // safe default for general events
  }

  return Array.from(cats);
}

function parseHour(t) {
  if (!t) return null;
  const m = norm(t).toLowerCase().match(/(\d{1,2})(?::(\d{2}))?\s*(am|pm)?/);
  if (!m) return null;
  let h = parseInt(m[1], 10);
  const ap = m[3];
  if (ap === 'pm' && h < 12) h += 12;
  if (ap === 'am' && h === 12) h = 0;
  return h;
}

// region inference from a "(Region/sub)" string or city text
function inferRegion(text) {
  const s = (text || '').toLowerCase();
  if (/san diego/.test(s)) return 'San Diego';
  if (/long beach/.test(s)) return 'Long Beach';
  if (/(orange county|santa ana|costa mesa|anaheim|huntington|irvine|fullerton)/.test(s)) return 'Orange County';
  if (/(inland empire|riverside|san bernardino|pomona|ontario|corona)/.test(s)) return 'Inland Empire';
  if (/(palm springs|coachella|indio|desert|joshua tree)/.test(s)) return 'Palm Springs';
  if (/ventura|santa barbara|oxnard/.test(s)) return 'Ventura';
  return 'Los Angeles';
}

// Build a fully-normalized event, filling defaults + derived flags + timestamps.
function makeEvent(partial, sourceName) {
  const nowISO = new Date().toISOString();
  const e = {
    id: '', title: norm(partial.title), artists: partial.artists || [],
    date: partial.date || null, start_time: norm(partial.start_time), end_time: norm(partial.end_time),
    venue: norm(partial.venue), address: norm(partial.address), city: norm(partial.city),
    region: partial.region || inferRegion(`${partial.region || ''} ${partial.venue || ''} ${partial.city || ''}`),
    lat: partial.lat ?? null, lng: partial.lng ?? null,
    genres: [...new Set((partial.genres || []).map((g) => norm(g).toLowerCase()).filter(Boolean))],
    vibe_tags: partial.vibe_tags || [],
    price: norm(partial.price), age: norm(partial.age), promoter: norm(partial.promoter),
    description: norm(partial.description),
    is_festival: !!partial.is_festival, is_underground: false, is_afterhours: false,
    is_free_rsvp: false, is_tba_location: false,
    categories: deriveCategories(partial),
    confidence: partial.confidence || 'medium',
    source_name: sourceName, source_url: partial.source_url || '', ticket_url: partial.ticket_url || partial.source_url || '',
    sources_seen: [{ name: sourceName, url: partial.source_url || partial.ticket_url || '' }],
    first_seen: nowISO, last_seen: nowISO, updated_at: nowISO, status: 'active',
  };
  Object.assign(e, deriveFlags(e));
  e.id = eventId(e);
  return e;
}

module.exports = { httpGet, httpPost, norm, slug, eventId, parseDate, parseTime, parseHour, inferRegion, deriveFlags, deriveCategories, makeEvent, dateInTimeZone, formatTimeInTimeZone, LA_TIME_ZONE, UA };
