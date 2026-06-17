/* SoCal Event Radar — vanilla JS. No framework. Handles thousands of rows. */
'use strict';
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const LS = {
  get: (k, d) => { try { return JSON.parse(localStorage.getItem(k)) ?? d; } catch { return d; } },
  set: (k, v) => localStorage.setItem(k, JSON.stringify(v)),
};
const SHOW_LOG_KEY = 'radar:show_logs';

let EVENTS = [], REMOTE_EVENTS = [], SOURCES = [], META = {}, COOCCURRENCE = {}, SCENE_INTEL = {};
let SAVED = new Set(LS.get('saved', [])), HIDDEN = new Set(LS.get('hidden', []));
let WATCHLIST = new Set(LS.get('radar:watchlist', []));
let GOING = new Set(LS.get('radar:going', []));
let SHOW_LOGS = loadShowLogs(), ACTIVE_LOG_EVENT_ID = '';
const LAST_VISIT = LS.get('lastVisit', 0);
const STATE = { q: '', range: '', from: '', to: '', region: '', genre: '', source: '', sort: 'soon', flags: new Set(), age: '', categories: new Set() };
const SOCAL_BOUNDS = { minLat: 32.35, maxLat: 35.45, minLng: -120.05, maxLng: -116.55 };
const MANUAL_KEY = 'manualEvents';
let MANUAL_PREVIEW = null;

function localDateString(d = new Date()) {
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}
function addDays(d, days) { const x = new Date(d); x.setDate(x.getDate() + days); return x; }
function fmtUpdated(iso) { if (!iso) return ''; const d = new Date(iso); return 'updated ' + d.toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }); }
function isNew(e) { return LAST_VISIT && e.first_seen && new Date(e.first_seen).getTime() > LAST_VISIT; }
function arr(v) { return Array.isArray(v) ? v : []; }
function hasCoords(e) {
  if (e.lat == null || e.lng == null) return false;
  const lat = Number(e.lat), lng = Number(e.lng);
  return Number.isFinite(lat) && Number.isFinite(lng) && lat >= -90 && lat <= 90 && lng >= -180 && lng <= 180;
}
function safeHttpUrl(raw) {
  const s = String(raw || '').trim();
  if (!s) return '';
  try {
    const u = new URL(s);
    return (u.protocol === 'http:' || u.protocol === 'https:') ? u.href : '';
  } catch { return ''; }
}
function eventLink(e) { return safeHttpUrl(e.ticket_url) || safeHttpUrl(e.source_url); }

function rebuildEvents() {
  const manual = loadManualEvents();
  const byId = new Map();
  for (const ev of [...REMOTE_EVENTS, ...manual]) byId.set(ev.id, ev);
  EVENTS = [...byId.values()];
  annotateEvents();
}

function loadManualEvents() {
  return arr(LS.get(MANUAL_KEY, [])).map(normalizeManualEvent).filter(e => e.title || e.date || e.venue);
}

function saveManualEvents(list) {
  LS.set(MANUAL_KEY, arr(list).map(toManualExportRow));
}

function slug(s) {
  return String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
}

function manualId(e) {
  return `manual-${slug(e.title || 'untitled')}-${e.date || 'undated'}-${slug(e.venue || e.city || 'tba')}`.slice(0, 96);
}

function normalizeManualEvent(row) {
  const now = new Date().toISOString();
  const genres = splitList(row.genres).map(g => g.toLowerCase());
  const title = clean(row.title);
  const venue = clean(row.venue);
  const city = clean(row.city || row.region);
  const url = safeHttpUrl(row.source_url || row.ticket_url);
  const event = {
    id: row.id || manualId({ ...row, title, venue, city }),
    title,
    artists: arr(row.artists),
    date: validDate(row.date) ? row.date : null,
    start_time: clean(row.start_time || row.time),
    end_time: clean(row.end_time),
    venue,
    address: clean(row.address),
    city,
    region: city || inferRegion(`${venue} ${row.description || ''}`),
    lat: numericOrNull(row.lat),
    lng: numericOrNull(row.lng),
    genres,
    vibe_tags: arr(row.vibe_tags),
    price: clean(row.price),
    age: clean(row.age),
    promoter: clean(row.promoter),
    description: clean(row.description || row.raw_text),
    is_festival: !!row.is_festival,
    is_underground: !!row.is_underground,
    is_afterhours: !!row.is_afterhours,
    is_free_rsvp: !!row.is_free_rsvp,
    is_tba_location: !!row.is_tba_location,
    is_manual: true,
    needs_review: !!row.needs_review,
    categories: arr(row.categories),
    confidence: row.confidence || 'low',
    source_name: row.source_name || 'Manual (local)',
    source_url: url,
    ticket_url: url,
    sources_seen: [{ name: row.source_name || 'Manual (local)', url }],
    first_seen: row.first_seen || now,
    last_seen: row.last_seen || now,
    updated_at: now,
    status: 'active',
  };
  Object.assign(event, deriveManualFlags(event));
  event.categories = deriveManualCategories(event);
  event.needs_review = event.needs_review || !event.date || !event.start_time || !event.venue;
  event.id = row.id || manualId(event);
  return event;
}

function toManualExportRow(ev) {
  const row = {
    title: clean(ev.title),
    date: ev.date || '',
    start_time: clean(ev.start_time),
    end_time: clean(ev.end_time),
    venue: clean(ev.venue),
    city: clean(ev.city || ev.region),
    region: clean(ev.region),
    genres: arr(ev.genres),
    promoter: clean(ev.promoter),
    price: clean(ev.price),
    age: clean(ev.age),
    source_name: clean(ev.source_name || 'Manual (local)'),
    source_url: eventLink(ev),
    is_underground: !!ev.is_underground,
    is_afterhours: !!ev.is_afterhours,
    is_free_rsvp: !!ev.is_free_rsvp,
    is_tba_location: !!ev.is_tba_location,
    needs_review: !!ev.needs_review,
  };
  if (ev.end_time) row.end_time = ev.end_time;
  if (ev.lat != null && ev.lng != null) { row.lat = Number(ev.lat); row.lng = Number(ev.lng); }
  if (ev.description) row.description = ev.description;
  return Object.fromEntries(Object.entries(row).filter(([, v]) => !(v === '' || v == null || (Array.isArray(v) && !v.length))));
}

function parseManualText(text) {
  const raw = String(text || '');
  const body = raw.replace(/\r/g, '');
  const labels = {};
  for (const line of body.split('\n').map(l => l.trim()).filter(Boolean)) {
    const m = line.match(/^([a-z][a-z /_-]{1,24})\s*:\s*(.+)$/i);
    if (m) labels[m[1].toLowerCase().replace(/[\s/_-]+/g, '_')] = clean(m[2]);
  }
  const sourceUrl = safeHttpUrl((body.match(/https?:\/\/[^\s<>"']+/i) || [''])[0].replace(/[),.;]+$/, ''));
  const title = labels.event || labels.title || labels.name || likelyTitle(body);
  const date = parseLooseDate(labels.date || labels.when || body);
  const times = parseLooseTime(labels.time || labels.hours || body);
  const venue = labels.venue || labels.location || labels.place || likelyVenue(body);
  const city = labels.city || labels.region || likelyCity(body);
  const genres = splitList(labels.genres || labels.genre || labels.tags || '').length
    ? splitList(labels.genres || labels.genre || labels.tags)
    : extractGenres(body);
  const price = labels.price || labels.cover || likelyPrice(body);
  const age = labels.age || likelyAge(body);
  const promoter = labels.promoter || labels.collective || labels.host || labels.by || likelyPromoter(body);
  const coords = parseCoords(body);
  return normalizeManualEvent({
    title,
    date,
    start_time: times.start,
    end_time: times.end,
    venue,
    city,
    genres,
    promoter,
    price,
    age,
    source_url: sourceUrl,
    lat: coords.lat,
    lng: coords.lng,
    source_name: sourceUrl.includes('partiful.com') ? 'Manual (Partiful)' : 'Manual (local)',
    description: clean(body).slice(0, 600),
  });
}

function clean(v) { return String(v || '').replace(/\s+/g, ' ').trim(); }
function splitList(v) { return Array.isArray(v) ? v.map(clean).filter(Boolean) : clean(v).split(/\s*(?:,|\/|\+|&|\bx\b)\s*/i).map(clean).filter(Boolean); }
function numericOrNull(v) { if (v === '' || v == null) return null; const n = Number(v); return Number.isFinite(n) ? n : null; }
function validDate(v) { return /^\d{4}-\d{2}-\d{2}$/.test(String(v || '')); }

function parseLooseDate(text) {
  const s = clean(text).toLowerCase();
  let m = s.match(/\b(20\d{2})[-/](\d{1,2})[-/](\d{1,2})\b/);
  if (m) return `${m[1]}-${m[2].padStart(2, '0')}-${m[3].padStart(2, '0')}`;
  m = s.match(/\b(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?\b/);
  if (m) return futureDate(Number(m[1]) - 1, Number(m[2]), m[3]);
  const months = { jan:0,feb:1,mar:2,apr:3,may:4,jun:5,jul:6,aug:7,sep:8,oct:9,nov:10,dec:11 };
  m = s.match(/\b(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?\s+(\d{1,2})(?:,?\s*(20\d{2}))?\b/);
  if (m) return futureDate(months[m[1]], Number(m[2]), m[3]);
  if (/\btonight\b/.test(s)) return localDateString();
  if (/\btomorrow\b/.test(s)) return localDateString(addDays(new Date(), 1));
  const dows = ['sun','mon','tue','wed','thu','fri','sat'];
  m = s.match(/\b(sun|mon|tue|wed|thu|fri|sat)(?:day)?\b/);
  if (m) {
    const now = new Date();
    const target = dows.indexOf(m[1]);
    let delta = (target - now.getDay() + 7) % 7;
    if (delta === 0 && !/\btonight\b/.test(s)) delta = 7;
    return localDateString(addDays(now, delta));
  }
  return '';
}

function futureDate(month, day, yearRaw) {
  const now = new Date();
  let year = yearRaw ? Number(String(yearRaw).length === 2 ? '20' + yearRaw : yearRaw) : now.getFullYear();
  let out = `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
  if (!yearRaw && out < localDateString(addDays(now, -1))) {
    year += 1;
    out = `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
  }
  return out;
}

function parseLooseTime(text) {
  const s = clean(text).toLowerCase().replace(/\b(\d{1,2})p\b/g, '$1pm').replace(/\b(\d{1,2})a\b/g, '$1am');
  const token = '(\\d{1,2})(?::(\\d{2}))?\\s*(am|pm)';
  const range = s.match(new RegExp(`${token}\\s*(?:-|–|to|til|until)\\s*${token}`, 'i'));
  if (range) return { start: compactTime(range[1], range[2], range[3]), end: compactTime(range[4], range[5], range[6]) };
  const one = s.match(new RegExp(`\\b${token}\\b`, 'i'));
  return { start: one ? compactTime(one[1], one[2], one[3]) : '', end: '' };
}

function compactTime(h, m, ap) { return `${Number(h)}${m ? ':' + m.padStart(2, '0') : ''}${String(ap).toLowerCase()}`; }

function likelyTitle(text) {
  const lines = text.split('\n').map(clean).filter(Boolean);
  return lines.find(l => !/^https?:\/\//i.test(l) && !/^\w+\s*:/.test(l) && !parseLooseDate(l) && !parseLooseTime(l).start && l.length <= 90) || '';
}

function likelyVenue(text) {
  const s = clean(text);
  const label = s.match(/\b(?:venue|location|place)\s*[:\-]\s*([^|,\n]+)/i);
  if (label) return clean(label[1]).slice(0, 100);
  const at = s.match(/\s@\s*([A-Za-z0-9 .'&+-]{3,80})/);
  if (at && !/instagram|gmail|yahoo|hotmail/i.test(at[1])) return clean(at[1]);
  if (/\b(tba|warehouse|secret location|address day of|dtla warehouse)\b/i.test(s)) return (s.match(/\b(tba(?:\s*\([^)]+\))?|dtla warehouse|secret location|warehouse)\b/i) || [''])[0];
  return '';
}

function likelyCity(text) {
  const cities = ['Los Angeles','DTLA','Hollywood','Long Beach','Santa Ana','Anaheim','Irvine','Costa Mesa','San Diego','Riverside','Pomona','Pasadena','Glendale','Silver Lake','Echo Park','Venice','Inglewood'];
  const found = cities.find(c => new RegExp(`\\b${c.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i').test(text));
  return found === 'DTLA' ? 'Los Angeles' : (found || '');
}

function inferRegion(text) {
  const s = String(text || '').toLowerCase();
  if (/san diego/.test(s)) return 'San Diego';
  if (/long beach/.test(s)) return 'Long Beach';
  if (/(orange county|santa ana|costa mesa|anaheim|huntington|irvine|fullerton)/.test(s)) return 'Orange County';
  if (/(inland empire|riverside|san bernardino|pomona|ontario|corona)/.test(s)) return 'Inland Empire';
  if (/(palm springs|coachella|indio|desert|joshua tree)/.test(s)) return 'Palm Springs';
  if (/ventura|santa barbara|oxnard/.test(s)) return 'Ventura';
  return s ? 'Los Angeles' : '';
}

function extractGenres(text) {
  const terms = ['hard techno','schranz','techno','industrial','ebm','darkwave','trance','jungle','dnb','drum and bass','house','acid','bass','dubstep','breaks','hardstyle','goth'];
  const lower = text.toLowerCase();
  return terms.filter(g => lower.includes(g));
}

function likelyPrice(text) {
  const m = text.match(/\b(free|rsvp|no cover)\b/i) || text.match(/\$\s*\d+(?:\s*-\s*\$?\d+)?/);
  return m ? clean(m[0]).toLowerCase() : '';
}

function likelyAge(text) {
  const m = text.match(/\b(21\+|18\+|all ages)\b/i);
  return m ? m[1] : '';
}

function likelyPromoter(text) {
  const m = text.match(/\b(?:by|presented by|hosted by)\s+([A-Za-z0-9 .'&+-]{3,80})/i);
  return m ? clean(m[1]) : '';
}

function parseCoords(text) {
  const m = text.match(/\b(-?\d{1,2}\.\d{3,})\s*,\s*(-?\d{2,3}\.\d{3,})\b/);
  return m ? { lat: Number(m[1]), lng: Number(m[2]) } : { lat: null, lng: null };
}

function deriveManualFlags(e) {
  const blob = `${e.title} ${e.venue} ${e.description} ${arr(e.genres).join(' ')} ${e.price}`.toLowerCase();
  const startHour = parseHour(e.start_time);
  const endHour = parseHour(e.end_time);
  return {
    is_manual: true,
    is_tba_location: e.is_tba_location || /\b(tba|warehouse|secret location|undisclosed|address day|dtla warehouse)\b/.test(blob),
    is_underground: e.is_underground || /\b(underground|warehouse|secret|tba|afters|afterhours|hard techno|industrial|ebm|darkwave)\b/.test(blob),
    is_afterhours: e.is_afterhours || /\b(afterhours|afters|after-hours)\b/.test(blob) || (startHour != null && startHour >= 23) || (endHour != null && endHour >= 3 && endHour <= 11),
    is_free_rsvp: e.is_free_rsvp || /\b(free|rsvp|no cover)\b/.test(blob),
  };
}

function deriveManualCategories(e) {
  const cats = new Set(arr(e.categories));
  const blob = `${e.title} ${e.venue} ${e.description} ${arr(e.genres).join(' ')}`.toLowerCase();
  if (arr(e.genres).length || /(dj|techno|house|rave|bass|trance|jungle|dnb|industrial|ebm|darkwave)/.test(blob)) cats.add('music');
  if (e.is_underground) cats.add('underground');
  if (e.is_afterhours) cats.add('afterhours');
  if (e.is_free_rsvp) cats.add('free');
  if (/(pop-up|popup|market)/.test(blob)) { cats.add('pop-up'); cats.add('market'); }
  return [...cats];
}

function parseHour(t) {
  const m = clean(t).toLowerCase().match(/(\d{1,2})(?::(\d{2}))?\s*(am|pm)?/);
  if (!m) return null;
  let h = Number(m[1]);
  if (m[3] === 'pm' && h < 12) h += 12;
  if (m[3] === 'am' && h === 12) h = 0;
  return h;
}

function annotateEvents() {
  EVENTS.forEach(e => {
    e.stable_id = getEventStableId(e);
    e.underground_score = computeUndergroundScore(e);
    e.is_underground = !!e.is_underground || e.underground_score >= 7;
  });
}

function getEventStableId(e) {
  return e.id || slug([e.title, e.date, e.venue || e.region].filter(Boolean).join('-')) || 'event';
}

function computeUndergroundScore(e) {
  const sourceNames = arr(e.sources_seen).map(s => s.name || '').concat([e.source_name || '']).join(' ').toLowerCase();
  const blob = `${e.title || ''} ${e.venue || ''} ${e.region || ''} ${e.promoter || ''} ${arr(e.genres).join(' ')} ${arr(e.categories).join(' ')} ${e.price || ''} ${e.description || ''}`.toLowerCase();
  let score = 4.2;

  if (e.is_manual || /manual|instagram|discord|sms|friend|flyer/.test(sourceNames)) score += 2.1;
  if (/resident advisor|\bra\b|19hz|r\/aves|dice|posh|shotgun/.test(sourceNames)) score += 1.1;
  if (/ticketmaster|axs|livenation|seatgeek/.test(sourceNames)) score -= 1.2;

  if (/\b(warehouse|tba|secret|underground|afters|afterhours|late night|address sent|address day|rsvp|dtla warehouse)\b/.test(blob)) score += 1.8;
  if (e.is_afterhours) score += 1.1;
  if (e.is_tba_location) score += 1.1;
  if (e.is_free_rsvp || /\b(free|rsvp|no cover|\$0)\b/.test(blob)) score += 0.5;
  if (/\$([7-9]\d|\d{3,})/.test(blob)) score -= 0.8;

  if (/\b(hard techno|techno|electro|industrial|ebm|darkwave|experimental|jungle|dnb|drum and bass|acid|trance|club)\b/.test(blob)) score += 1.3;
  if (/\b(pop|comedy|sports|arena|stadium|festival|fair|awards|viewing party)\b/.test(blob)) score -= 0.9;
  if (e.is_festival) score -= 0.7;

  return Math.max(1, Math.min(10, Math.round(score * 10) / 10));
}

function undergroundLabel(e) {
  return `UG ${Math.round((e.underground_score || computeUndergroundScore(e)) * 10) / 10}`;
}

async function boot() {
  try {
    [REMOTE_EVENTS, SOURCES, META, COOCCURRENCE, SCENE_INTEL] = await Promise.all([
      fetch('events.json').then(r => r.json()),
      fetch('sources.json').then(r => r.json()).catch(() => []),
      fetch('last_updated.json').then(r => r.json()).catch(() => ({})),
      fetch('cooccurrence.json').then(r => r.json()).catch(() => ({})),
      fetch('scene_intel.json').then(r => r.json()).catch(() => ({ collectives: [], venues: [] })),
    ]);
  } catch (e) { $('#rows').innerHTML = `<tr><td colspan="8">Couldn't load events.json — run <code>npm run collect</code> first.</td></tr>`; return; }

  rebuildEvents();
  initHistory();
  $('#stat-updated').textContent = fmtUpdated(META.updated_at);
  $('#stat-count').textContent = EVENTS.length;
  $('#stat-src').textContent = `${META.sources_ok ?? '?'}/${META.sources_total ?? SOURCES.length}`;
  updateTonightStats();
  populateSelect('#region', uniq(EVENTS.map(e => e.region)));
  populateSelect('#genre', uniq(EVENTS.flatMap(e => arr(e.genres))).sort());
  populateSelect('#source', uniq(EVENTS.flatMap(e => arr(e.sources_seen).map(s => s.name))).sort());
  renderSources();
  initCategoryChips();
  initPresets();
  initMobileUI();
  wire();
  render();
  syncMobileStats();
  LS.set('lastVisit', Date.now()); // mark visit AFTER computing "new"
}

function uniq(a) { return [...new Set(a.filter(Boolean))]; }
function populateSelect(sel, vals) { const el = $(sel); vals.forEach(v => { const o = document.createElement('option'); o.value = v; o.textContent = v; el.appendChild(o); }); }

function updateTonightStats() {
  const today = localDateString();
  const tonightCount = EVENTS.filter(e => e.date === today).length;
  const networkCount = EVENTS.filter(e => e.my_network_match).length;
  const ugCount = EVENTS.filter(e => (e.underground_score || 0) >= 7).length;
  $('#stat-tonight').textContent = tonightCount;
  $('#stat-network').textContent = networkCount;
  $('#stat-ug').textContent = ugCount;
}

const ALL_CATS = ['music','underground','festival','afterhours','tech','career','networking','ai','quant','art','gallery','community','library','wholesome','free','social','mixer','wellness','pop-up','market','education','university','professional','business','outdoor'];

function initCategoryChips() {
  let catRow = $('#cat-row');
  if (!catRow) {
    catRow = document.createElement('div');
    catRow.id = 'cat-row';
    catRow.className = 'controls cat-row';
    const mount = $('#header-panels') || document.querySelector('header');
    if (mount) mount.appendChild(catRow);
  }
  const container = $('#cat-row');
  container.querySelectorAll('.cat-chip').forEach(el => el.remove());

  ALL_CATS.forEach(cat => {
    const el = document.createElement('span');
    el.className = 'chip cat-chip';
    el.textContent = cat;
    el.dataset.cat = cat;
    el.onclick = () => {
      if (STATE.categories.has(cat)) STATE.categories.delete(cat);
      else STATE.categories.add(cat);
      el.classList.toggle('on', STATE.categories.has(cat));
      render();
    };
    container.appendChild(el);
  });
}

function initPresets() {
  let presetBar = $('#preset-bar');
  if (!presetBar) {
    presetBar = document.createElement('div');
    presetBar.id = 'preset-bar';
    presetBar.className = 'preset-bar';
    const mount = $('#header-panels') || document.querySelector('header');
    if (mount) mount.appendChild(presetBar);
  }
  presetBar.replaceChildren();

  const presets = [
    { label: 'Underground Pulse', fn: () => { STATE.categories = new Set(['music','underground','afterhours','festival']); STATE.flags.add('is_underground'); } },
    { label: 'Tech + Career + Social', fn: () => { STATE.categories = new Set(['tech','career','networking','ai','quant','social','professional']); } },
    { label: 'Free Wholesome', fn: () => { STATE.categories = new Set(['community','library','wholesome','free','education','art']); STATE.flags.add('is_free_rsvp'); } },
    { label: 'Everything', fn: () => { STATE.categories.clear(); STATE.flags.clear(); } },
  ];

  presets.forEach(p => {
    const b = document.createElement('button');
    b.className = 'btn preset';
    b.textContent = p.label;
    b.onclick = () => {
      p.fn();
      // clear old single selects that conflict
      STATE.region = ''; STATE.genre = ''; STATE.source = '';
      $('#region').value = ''; $('#genre').value = ''; $('#source').value = '';
      syncAllUI();
      render();
    };
    presetBar.appendChild(b);
  });
}

function syncAllUI() {
  // sync category chips
  $$('#cat-row .cat-chip').forEach(c => c.classList.toggle('on', STATE.categories.has(c.dataset.cat)));
  syncChips();
}

function matches(e) {
  if (HIDDEN.has(e.id)) return false;
  const q = STATE.q.toLowerCase();
  if (q) {
    const blob = `${e.title} ${arr(e.artists).join(' ')} ${e.venue} ${e.promoter} ${arr(e.genres).join(' ')} ${e.region}`.toLowerCase();
    if (!blob.includes(q)) return false;
  }
  if (STATE.region && e.region !== STATE.region) return false;
  if (STATE.genre && !arr(e.genres).includes(STATE.genre)) return false;
  if (STATE.source && !arr(e.sources_seen).some(s => s.name === STATE.source)) return false;
  if (STATE.age) { const a = (e.age || '').toLowerCase(); if (STATE.age === '18+' ? !/18\+/.test(a) : !/all ages/.test(a)) return false; }
  if (STATE.categories.size > 0) {
    const ec = (e.categories || []);
    let hasAny = false;
    for (const c of STATE.categories) { if (ec.includes(c)) { hasAny = true; break; } }
    if (!hasAny) return false;
  }
  for (const f of STATE.flags) {
    if (f === 'new') { if (!isNew(e)) return false; }
    else if (f === 'saved') { if (!SAVED.has(e.id)) return false; }
    else if (f === 'watched') { if (!isWatchedEvent(e)) return false; }
    else if (f === 'going') { if (!GOING.has(e.id)) return false; }
    else if (f === 'is_underground') { if ((e.underground_score || 0) < 7) return false; }
    else if (!e[f]) return false;
  }
  if (STATE.range === 'tonight' && !isTonight(e)) return false;
  // date range
  const { from, to } = dateBounds();
  if (from || to) {
    if (!e.date) return false;
    if (from && e.date < from) return false;
    if (to && e.date > to) return false;
  }
  return true;
}

function dateBounds() {
  if (STATE.from || STATE.to) return { from: STATE.from, to: STATE.to };
  const t = new Date(); const iso = localDateString;
  if (STATE.range === 'today') return { from: iso(t), to: iso(t) };
  if (STATE.range === 'tonight') return { from: iso(t), to: iso(t) };
  if (STATE.range === 'weekend') {
    const day = t.getDay(); const fri = new Date(t); fri.setDate(t.getDate() + ((5 - day + 7) % 7));
    const sun = new Date(fri); sun.setDate(fri.getDate() + 2);
    // if it's already the weekend, start today
    const start = (day === 6 || day === 0 || day === 5) ? t : fri;
    return { from: iso(start), to: iso(sun) };
  }
  if (STATE.range === '7d') { const e = new Date(t); e.setDate(t.getDate() + 7); return { from: iso(t), to: iso(e) }; }
  if (STATE.range === '30d') { const e = new Date(t); e.setDate(t.getDate() + 30); return { from: iso(t), to: iso(e) }; }
  return { from: '', to: '' };
}

function isTonight(e) {
  if (e.date !== localDateString()) return false;
  const h = parseHour(e.start_time);
  return h == null || h >= 17 || h <= 4 || e.is_afterhours;
}

function sortEvents(list) {
  const rank = { high: 3, medium: 2, low: 1 };
  const byDate = (a, b) => (!a.date ? 1 : !b.date ? -1 : a.date.localeCompare(b.date) || (a.start_time || '').localeCompare(b.start_time || ''));
  if (STATE.sort === 'foryou') return list.sort((a, b) => (b.my_network_match ? 1 : 0) - (a.my_network_match ? 1 : 0) || (forYouScore(b) - forYouScore(a)) || byDate(a, b));
  if (STATE.sort === 'new') return list.sort((a, b) => new Date(b.first_seen) - new Date(a.first_seen));
  if (STATE.sort === 'venue') return list.sort((a, b) => (a.venue || '~').localeCompare(b.venue || '~') || byDate(a, b));
  if (STATE.sort === 'conf') return list.sort((a, b) => (rank[b.confidence] - rank[a.confidence]) || byDate(a, b));
  return list.sort(byDate);
}

function forYouScore(e) {
  let score = Number(e.for_you_score) || 0;
  const ugBoost = Math.max(0, (e.underground_score || 0) - 6) * 2;
  const logBoost = showLogAffinityBoost(e);
  if (e.for_you_score != null) return score + ugBoost + logBoost;
  const blob = `${e.title || ''} ${e.venue || ''} ${e.promoter || ''} ${arr(e.artists).join(' ')} ${arr(e.genres).join(' ')} ${arr(e.categories).join(' ')} ${e.description || ''}`.toLowerCase();
  score += ugBoost;
  if (e.is_underground) score += 45;
  if (e.is_afterhours) score += 35;
  if (e.is_tba_location || /\b(tba|warehouse|secret|undisclosed|dtla warehouse)\b/.test(blob)) score += 30;
  if (e.is_free_rsvp) score += 14;
  const boosts = [
    [/hard\s*techno|schranz|industrial techno/, 34],
    [/\btechno\b/, 24],
    [/\bindustrial\b|\bebm\b|\bdarkwave\b|\bgoth\b/, 22],
    [/\btrance\b|\bacid\b/, 18],
    [/\bjungle\b|\bdnb\b|drum\s*(and|&)?\s*bass/, 18],
    [/\bhouse\b|\bminimal\b|\bdeep house\b/, 14],
  ];
  for (const [re, points] of boosts) if (re.test(blob)) score += points;
  if (e.confidence === 'high') score += 4;
  if (isNew(e)) score += 3;
  score += logBoost;
  return score;
}

function badges(e) {
  let h = '';
  if (isNew(e)) h += '<span class="badge b-new">new</span>';
  if (e.is_manual) h += '<span class="badge b-manual">manual</span>';
  if (e.needs_review) h += '<span class="badge b-review">needs review</span>';
  h += `<span class="badge b-ug">${esc(undergroundLabel(e))}</span>`;
  if (SHOW_LOGS[getEventStableId(e)]) h += '<span class="badge b-log">logged</span>';
  if (e.is_afterhours) h += '<span class="badge b-aft">afters</span>';
  if (e.is_festival) h += '<span class="badge b-fest">fest</span>';
  if (e.is_free_rsvp) h += '<span class="badge b-free">free</span>';
  return h;
}
function esc(s) { return String(s || '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])); }
function dateCell(e) {
  if (!e.date) return '<span class="date">—</span>';
  const d = new Date(e.date + 'T12:00');
  const dow = d.toLocaleDateString([], { weekday: 'short' });
  const md = d.toLocaleDateString([], { month: 'short', day: 'numeric' });
  return `<span class="date">${dow} <b>${md}</b>${e.start_time ? '<br>' + esc(e.start_time) : ''}</span>`;
}

function isMobileLayout() {
  return window.matchMedia('(max-width: 700px)').matches;
}

const DrawerUI = {
  active: null,
  _scrollY: 0,

  toggle(name) {
    if (this.active === name) this.close();
    else this.open(name);
  },

  open(name) {
    if (!isMobileLayout()) return;
    if (this.active === name) return;
    if (!this.active) this._scrollY = window.scrollY;
    this.active = name || null;
    this.sync();
  },

  close() {
    if (!this.active) return;
    const savedY = this._scrollY;
    this.active = null;
    this.sync();
    window.scrollTo(0, savedY);
  },

  sync() {
    const open = !!this.active;
    const body = document.body;
    if (open) {
      body.style.top = `-${this._scrollY}px`;
      body.classList.add('mobile-drawer-open');
    } else {
      body.classList.remove('mobile-drawer-open');
      body.style.top = '';
    }
    const root = $('#drawer-root');
    if (root) {
      root.classList.toggle('is-active', open);
      root.setAttribute('aria-hidden', String(!open));
    }
    for (const id of ['filters', 'presets', 'more']) {
      const sheet = $(`#drawer-${id}`);
      const btn = $(`.mob-drawer-btn[data-drawer="${id}"]`);
      const isOpen = this.active === id;
      if (sheet) {
        sheet.classList.toggle('is-open', isOpen);
        sheet.setAttribute('aria-hidden', String(!isOpen));
      }
      if (btn) {
        btn.classList.toggle('is-active', isOpen);
        btn.setAttribute('aria-expanded', String(isOpen));
      }
    }
  },
};

function relocateDrawerPanels() {
  const mobile = isMobileLayout();
  const headerPanels = $('#header-panels');
  const filtersBody = $('#drawer-filters-body');
  const presetsBody = $('#drawer-presets-body');
  const filters = $('#filters-drawer');
  const catRow = $('#cat-row');
  const presetBar = $('#preset-bar');
  if (!headerPanels || !filtersBody || !presetsBody || !filters) return;

  if (mobile) {
    if (filters.parentElement !== filtersBody) filtersBody.appendChild(filters);
    if (catRow && catRow.parentElement !== filtersBody) filtersBody.appendChild(catRow);
    if (presetBar && presetBar.parentElement !== presetsBody) presetsBody.appendChild(presetBar);
    DrawerUI.close();
  } else {
    if (filters.parentElement !== headerPanels) headerPanels.insertBefore(filters, headerPanels.firstChild);
    if (catRow && catRow.parentElement !== headerPanels) headerPanels.appendChild(catRow);
    if (presetBar && presetBar.parentElement !== headerPanels) headerPanels.appendChild(presetBar);
    DrawerUI.close();
  }
}

function actionButtons(e, compactSecondary = false) {
  const sid = getEventStableId(e);
  const attended = HISTORY.some(h => h.id === e.id);
  const primary =
    `<button type="button" class="act-btn star${SAVED.has(e.id) ? ' on' : ''}" data-save="${e.id}" aria-label="Save"><span aria-hidden="true">★</span><span class="act-lbl">save</span></button>` +
    `<button type="button" class="act-btn going${GOING.has(e.id) ? ' on' : ''}" data-going="${e.id}" aria-label="Going"><span aria-hidden="true">▶</span><span class="act-lbl">going</span></button>` +
    `<button type="button" class="act-btn share" data-share="${sid}" aria-label="Share"><span aria-hidden="true">⤴</span><span class="act-lbl">share</span></button>` +
    `<button type="button" class="act-btn log" data-log="${sid}" aria-label="Log show"><span aria-hidden="true">✎</span><span class="act-lbl">log</span></button>`;
  const secondary =
    `<button type="button" class="act-btn compact attend${attended ? ' done' : ''}" data-attend="${e.id}" aria-label="Attended"><span aria-hidden="true">✓</span><span class="act-lbl">went</span></button>` +
    `<button type="button" class="act-btn compact cal" data-cal="${e.id}" aria-label="Calendar"><span aria-hidden="true">⤓</span><span class="act-lbl">cal</span></button>` +
    `<button type="button" class="act-btn compact hide" data-hide="${e.id}" aria-label="Hide"><span aria-hidden="true">✕</span><span class="act-lbl">hide</span></button>`;
  if (compactSecondary) {
    return `<div class="card-actions-primary">${primary}</div><div class="card-actions-secondary">${secondary}</div>`;
  }
  return `<div class="event-actions">${primary}${secondary}</div>`;
}

function legacyActionButtons(e) {
  const sid = getEventStableId(e);
  return `<span class="star ${SAVED.has(e.id) ? 'on' : ''}" data-save="${e.id}" title="save">★</span>` +
    `<span class="going-btn${GOING.has(e.id) ? ' on' : ''}" data-going="${e.id}" title="going">▶</span>` +
    `<span class="attended-btn${HISTORY.some(h => h.id === e.id) ? ' done' : ''}" data-attend="${e.id}" title="mark attended">✓</span>` +
    `<span data-cal="${e.id}" title="add to calendar">⤓</span>` +
    `<span data-hide="${e.id}" title="hide">✕</span>` +
    `<span data-log="${sid}" title="log show">log</span>` +
    `<span data-share="${sid}" title="copy share text">share</span>`;
}

function syncMobileStats() {
  const pairs = [
    ['stat-updated', 'stat-updated-m'],
    ['stat-count', 'stat-count-m'],
    ['stat-shown', 'stat-shown-m'],
    ['stat-tonight', 'stat-tonight-m'],
    ['stat-ug', 'stat-ug-m'],
  ];
  for (const [src, dst] of pairs) {
    const s = $(`#${src}`);
    const d = $(`#${dst}`);
    if (s && d) d.textContent = s.textContent;
  }
}

function initMobileUI() {
  if (window.__mobileUIReady) return;
  window.__mobileUIReady = true;

  const quickIds = ['btn-map', 'btn-share-tonight', 'btn-export'];
  const moreIds = ['btn-manual', 'btn-history', 'btn-scene', 'btn-venues', 'btn-weekend', 'btn-show-log', 'btn-release'];
  const quick = $('#mobile-quick-actions');
  const more = $('#mobile-more-actions');

  if (quick) {
    quick.replaceChildren();
    for (const id of quickIds) {
      const src = $(`#${id}`);
      if (!src) continue;
      const clone = src.cloneNode(true);
      clone.id = `${id}-m`;
      clone.addEventListener('click', (e) => { e.preventDefault(); src.click(); });
      quick.appendChild(clone);
    }
  }
  if (more) {
    more.replaceChildren();
    for (const id of moreIds) {
      const src = $(`#${id}`);
      if (!src) continue;
      const clone = src.cloneNode(true);
      clone.id = `${id}-m`;
      clone.addEventListener('click', () => { src.click(); DrawerUI.close(); });
      more.appendChild(clone);
    }
    const phone = document.querySelector('a.btn[href="phone.html"]');
    if (phone) {
      const link = phone.cloneNode(true);
      link.id = 'phone-setup-m';
      more.appendChild(link);
    }
  }

  $('#mobile-drawer-bar')?.addEventListener('click', (e) => {
    const btn = e.target.closest('.mob-drawer-btn[data-drawer]');
    if (!btn) return;
    DrawerUI.toggle(btn.dataset.drawer);
  });
  $('#drawer-backdrop')?.addEventListener('click', () => DrawerUI.close());
  $('#drawer-root')?.addEventListener('click', (e) => {
    if (e.target.closest('[data-drawer-close]')) DrawerUI.close();
  });
  $('#btn-theme-m')?.addEventListener('click', toggleTheme);

  let resizeTimer;
  window.addEventListener('resize', () => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => {
      relocateDrawerPanels();
      render();
    }, 120);
  });

  relocateDrawerPanels();
  DrawerUI.sync();
}

function srcLabel(e) {
  const names = arr(e.sources_seen).map(s => s.name);
  const joined = names.join(', ');
  return joined.length > 22 ? `${names.length} src` : joined;
}

function renderMobileCard(e, nowMs) {
  const card = document.createElement('article');
  card.className = 'event-card' + (e.my_network_match ? ' network' : '');
  card.dataset.eventId = getEventStableId(e);
  const link = eventLink(e);
  const tte = timeToEvent(e, nowMs);
  const title = link
    ? `<a href="${esc(link)}" target="_blank" rel="noopener noreferrer">${esc(e.title)}</a>`
    : esc(e.title);
  const score = (e.for_you_score || 0) >= 80 ? `<span class="score-badge">${e.for_you_score}</span>` : '';
  const artists = arr(e.artists).length
    ? `<div class="card-sub">${arr(e.artists).slice(0, 6).map(a => `<span class="clickable-artist" data-artist="${esc(a)}">${esc(a)}</span>`).join(', ')}</div>`
    : '';
  const promoter = e.promoter
    ? `<div class="card-sub">by <span class="clickable-promoter" data-promoter="${esc(e.promoter)}">${esc(e.promoter)}</span></div>`
    : '';
  const venue = esc(e.venue || (e.is_tba_location ? 'TBA' : ''));
  const city = esc(e.region || e.city || '');
  card.innerHTML =
    `<div class="card-meta"><div class="card-date">${dateCell(e)}</div>${tte ? `<div class="card-countdown">${esc(tte)}</div>` : ''}</div>` +
    `<div class="card-badges">${badges(e)}${score}</div>` +
    `<div class="card-title">${title}</div>${artists}${promoter}` +
    `<div class="card-venue"><span data-venue-intel="${esc(e.venue || e.region || '')}">${venue}</span>${city ? ` · ${city}` : ''}</div>` +
    (arr(e.genres).length ? `<div class="card-row">${esc(arr(e.genres).slice(0, 4).join(', '))}</div>` : '') +
    (e.price || e.age ? `<div class="card-row">${esc([e.price, e.age].filter(Boolean).join(' · '))}</div>` : '') +
    `<div class="card-src">${esc(srcLabel(e))}</div>` +
    `<div class="card-actions">${actionButtons(e, true)}</div>`;
  return card;
}

function renderMobileCards(list, nowMs) {
  const host = $('#event-cards');
  if (!host) return;
  const frag = document.createDocumentFragment();
  for (const e of list) frag.appendChild(renderMobileCard(e, nowMs));
  host.replaceChildren(frag);
}

function renderTableRows(list, nowMs) {
  const rows = $('#rows');
  if (!rows) return;
  const frag = document.createDocumentFragment();
  for (const e of list) {
    const tr = document.createElement('tr');
    tr.dataset.eventId = getEventStableId(e);
    if (e.my_network_match) tr.classList.add('network-row');
    const link = eventLink(e);
    const srcNames = arr(e.sources_seen).map(s => s.name).join(', ');
    const title = link
      ? `<a href="${esc(link)}" target="_blank" rel="noopener noreferrer">${esc(e.title)}</a>`
      : `<span>${esc(e.title)}</span>`;
    const score = (e.for_you_score || 0) >= 80 ? `<span class="score-badge">${e.for_you_score}</span>` : '';
    const tte = timeToEvent(e, nowMs);
    tr.innerHTML =
      `<td>${dateCell(e)}${tte ? `<div class="tte">${tte}</div>` : ''}</td>` +
      `<td class="ev"><div class="t">${badges(e)}${score}${title}</div>` +
        (arr(e.artists).length ? `<div class="a">${arr(e.artists).slice(0, 6).map(a => `<span class="clickable-artist" data-artist="${esc(a)}">${esc(a)}</span>`).join(', ')}</div>` : '') +
        (e.promoter ? `<div class="a">by <span class="clickable-promoter" data-promoter="${esc(e.promoter)}">${esc(e.promoter)}</span></div>` : '') + `</td>` +
      `<td class="venue"><span data-venue-intel="${esc(e.venue || e.region || '')}">${esc(e.venue || (e.is_tba_location ? 'TBA' : ''))}</span></td>` +
      `<td class="region">${esc(e.region)}</td>` +
      `<td class="genres">${esc(arr(e.genres).slice(0, 4).join(', '))}</td>` +
      `<td class="pa">${esc([e.price, e.age].filter(Boolean).join(' · '))}</td>` +
      `<td class="src" title="${esc(srcNames)}">${esc(srcNames.length > 18 ? arr(e.sources_seen).length + ' src' : srcNames)}</td>` +
      `<td class="acts">${legacyActionButtons(e)}</td>`;
    frag.appendChild(tr);
  }
  rows.replaceChildren(frag);
}

function timeToEvent(e, nowMs) {
  if (!e.date || e.date !== localDateString()) return '';
  if (!e.start_time) return 'today';
  const tm = (e.start_time || '').toLowerCase().match(/(\d{1,2})(?::(\d{2}))?\s*(am|pm)?/);
  if (!tm) return 'today';
  let h = +tm[1], m = tm[2] ? +tm[2] : 0;
  if (tm[3] === 'pm' && h < 12) h += 12;
  if (tm[3] === 'am' && h === 12) h = 0;
  const evTime = new Date();
  evTime.setHours(h, m, 0, 0);
  const diff = evTime.getTime() - nowMs;
  if (diff < -3600000) return '';
  if (diff < 0) return 'now';
  const mins = Math.round(diff / 60000);
  if (mins < 60) return `in ${mins}min`;
  return `in ${Math.round(mins / 60)}h`;
}

function render() {
  const list = sortEvents(EVENTS.filter(matches));
  const nowMs = Date.now();
  if (isMobileLayout()) {
    renderMobileCards(list, nowMs);
    $('#rows')?.replaceChildren();
  } else {
    renderTableRows(list, nowMs);
    $('#event-cards')?.replaceChildren();
  }
  $('#stat-shown').textContent = list.length;
  syncMobileStats();
  $('#foot-summary').textContent = `${list.length} shown · ${EVENTS.filter(e => e.date).length} dated · ${EVENTS.filter(e => (e.underground_score || 0) >= 7).length} underground · ${EVENTS.filter(e => e.is_manual).length} manual · ${EVENTS.filter(isNew).length} new since last visit`;
  $('#hidden-count').textContent = HIDDEN.size ? `${HIDDEN.size} hidden ·` : '';
  if (mapOpen) drawMap(list);
  renderWatchlistDigest();
  return list;
}

/* ---- interactions ---- */
function wire() {
  $('#q').addEventListener('input', e => { STATE.q = e.target.value; render(); });
  $('#region').onchange = e => { STATE.region = e.target.value; render(); };
  $('#genre').onchange = e => { STATE.genre = e.target.value; render(); };
  $('#source').onchange = e => { STATE.source = e.target.value; render(); };
  $('#sort').onchange = e => { STATE.sort = e.target.value; render(); };
  $('#from').onchange = e => { STATE.from = e.target.value; STATE.range = ''; syncChips(); render(); };
  $('#to').onchange = e => { STATE.to = e.target.value; STATE.range = ''; syncChips(); render(); };
  $$('.chip[data-range]').forEach(c => c.onclick = () => { STATE.range = STATE.range === c.dataset.range ? '' : c.dataset.range; STATE.from = STATE.to = ''; $('#from').value = ''; $('#to').value = ''; syncChips(); render(); });
  $$('.chip[data-flag]').forEach(c => c.onclick = () => { const f = c.dataset.flag; STATE.flags.has(f) ? STATE.flags.delete(f) : STATE.flags.add(f); syncChips(); render(); });
  $$('.chip[data-age]').forEach(c => c.onclick = () => { STATE.age = STATE.age === c.dataset.age ? '' : c.dataset.age; syncChips(); render(); });
  $('#btn-reset').onclick = () => {
    Object.assign(STATE, { q: '', range: '', from: '', to: '', region: '', genre: '', source: '', sort: 'soon', age: '' });
    STATE.flags.clear();
    STATE.categories.clear();
    $('#q').value = ''; $('#from').value = ''; $('#to').value = ''; $('#region').value = ''; $('#genre').value = ''; $('#source').value = ''; $('#sort').value = 'soon';
    syncAllUI(); render();
  };
  $('#btn-theme').onclick = toggleTheme;
  $('#btn-map').onclick = toggleMap;
  $('#btn-manual').onclick = toggleManualPanel;
  $('#btn-history').onclick = toggleHistoryPanel;
  $('#btn-weekend').onclick = toggleWeekendPanel;
  $('#btn-show-log').onclick = toggleShowLogPanel;
  $('#btn-release').onclick = toggleReleasePanel;
  $('#history-export').onclick = exportHistoryCSV;
  $('#btn-share-tonight').onclick = shareTonight;
  $('#btn-export').onclick = () => exportICS(render());
  $('#digest-generate').onclick = () => { $('#digest-output').value = generateWeekendDigest(EVENTS); $('#digest-status').textContent = 'generated'; };
  $('#digest-copy').onclick = () => copyText($('#digest-output').value || generateWeekendDigest(EVENTS), $('#digest-output'), $('#digest-status'));
  $('#log-here').onclick = markArrivedHere;
  $('#log-save').onclick = saveActiveShowLog;
  $('#log-close').onclick = () => { $('#log-editor-panel').hidden = true; };
  $('#venue-intel-close').onclick = () => { $('#venue-intel-panel').hidden = true; };
  $('#release-run').onclick = renderReleaseTarget;
  $('#manual-parse').onclick = parseManualPreview;
  $('#manual-save').onclick = saveManualPreview;
  $('#manual-copy').onclick = copyManualJSON;
  $('#manual-download').onclick = downloadManualJSON;
  $('#manual-clear').onclick = clearManualLocal;
  if (IS_LOCALHOST) {
    const sfBtn = $('#manual-save-file');
    if (sfBtn) { sfBtn.style.display = ''; sfBtn.onclick = saveManualToFile; }
  }
  $('#toggle-sources').onclick = (e) => { e.preventDefault(); const s = $('#sources'); s.style.display = s.style.display === 'block' ? 'none' : 'block'; };
  $('#unhide').onclick = (e) => { e.preventDefault(); HIDDEN.clear(); LS.set('hidden', []); render(); };
  $$('th[data-sk]').forEach(th => th.onclick = () => { const m = { date: 'soon', title: 'soon', venue: 'venue', region: 'soon' }[th.dataset.sk] || 'soon'; STATE.sort = m; $('#sort').value = m; render(); });
  $('#btn-scene').onclick = toggleScenePanel;
  $('#btn-venues').onclick = toggleVenuePanel;
  function handleEventAction(e) {
    const t = e.target.closest('[data-save],[data-going],[data-attend],[data-log],[data-share],[data-venue-intel],[data-hide],[data-cal],[data-artist],[data-promoter]');
    if (!t) return;
    if (t.dataset.save) { toggle(SAVED, t.dataset.save, 'saved'); render(); }
    else if (t.dataset.going) { toggle(GOING, t.dataset.going, 'radar:going'); render(); }
    else if (t.dataset.attend) { markAttended(t.dataset.attend); }
    else if (t.dataset.log) { openShowLogEditor(t.dataset.log); }
    else if (t.dataset.share) { shareEventText(t.dataset.share); }
    else if (t.dataset.venueIntel) { showVenueIntelPanel(t.dataset.venueIntel); }
    else if (t.dataset.hide) { HIDDEN.add(t.dataset.hide); LS.set('hidden', [...HIDDEN]); render(); }
    else if (t.dataset.cal) { const ev = EVENTS.find(x => x.id === t.dataset.cal); if (ev) exportICS([ev]); }
    else if (t.dataset.artist) { showArtistTooltip(t.dataset.artist, t); }
    else if (t.dataset.promoter) { showPromoterPanel(t.dataset.promoter); }
  }
  $('#rows')?.addEventListener('click', handleEventAction);
  $('#event-cards')?.addEventListener('click', handleEventAction);
  document.addEventListener('click', (e) => {
    const t = e.target;
    if (!t.closest('.artist-tooltip') && !t.dataset.artist) {
      $('#artist-tooltip').hidden = true;
    }
    if (t.dataset.promoter && !t.closest('#rows')) { showPromoterPanel(t.dataset.promoter); }
  });
  // restore theme
  const th = LS.get('theme', 'dark'); document.documentElement.dataset.theme = th;
}
function toggle(set, id, key) { set.has(id) ? set.delete(id) : set.add(id); LS.set(key, [...set]); }
function syncChips() {
  $$('.chip[data-range]').forEach(c => c.classList.toggle('on', STATE.range === c.dataset.range));
  $$('.chip[data-flag]').forEach(c => c.classList.toggle('on', STATE.flags.has(c.dataset.flag)));
  $$('.chip[data-age]').forEach(c => c.classList.toggle('on', STATE.age === c.dataset.age));
  $$('#cat-row .cat-chip').forEach(c => c.classList.toggle('on', STATE.categories.has(c.dataset.cat)));
}
function toggleTheme() { const n = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark'; document.documentElement.dataset.theme = n; LS.set('theme', n); if (mapOpen) drawMap(render()); }

function toggleManualPanel() {
  const panel = $('#manual-panel');
  const open = panel.hidden;
  panel.hidden = !open;
  $('#btn-manual').classList.toggle('on', open);
  if (open) $('#manual-input').focus();
}

function checkNetworkMatch(ev) {
  const collectives = ["americanrecycling","stereochrome","crushed_mag","mattermind records","eurohead la","eurohead","extra small","the hellp","ldl","lights down low","dguci","daw","tunedin ucla","catacomb","snla","airheads","pretty but wicked","silk road","lan","startnowla","cd presents"];
  const handles = ["americanrecycling","stereochrome","crushh","wesley","n5316n","nelsonfive316","samsclub.wav","samswavclub","sonni"];
  const blob = `${ev.title || ''} ${arr(ev.artists).join(' ')} ${ev.promoter || ''} ${ev.description || ''}`.toLowerCase();
  for (const c of collectives) { if (blob.includes(c)) return true; }
  for (const h of handles) { if (blob.includes(h)) return true; }
  return false;
}

async function parseManualPreview() {
  const text = $('#manual-input').value;
  if (!text.trim()) return;
  setManualStatus('parsing…');
  MANUAL_PREVIEW = parseManualText(text);
  if (checkNetworkMatch(MANUAL_PREVIEW)) {
    MANUAL_PREVIEW.my_network_match = true;
  }
  fillManualFields(MANUAL_PREVIEW);
  const reviewNote = MANUAL_PREVIEW.needs_review ? ' · needs review' : '';
  const networkNote = MANUAL_PREVIEW.my_network_match ? ' · 🔗 in network' : '';
  setManualStatus(`parsed${reviewNote}${networkNote}`);
}

function fillManualFields(ev) {
  const values = {
    title: ev.title, date: ev.date || '', start_time: ev.start_time, end_time: ev.end_time,
    venue: ev.venue, city: ev.city || ev.region, price: ev.price, age: ev.age,
    genres: arr(ev.genres).join(', '), promoter: ev.promoter, source_url: eventLink(ev),
    lat: ev.lat == null ? '' : ev.lat, lng: ev.lng == null ? '' : ev.lng,
  };
  for (const [k, v] of Object.entries(values)) {
    const el = $(`#manual-${k.replace('_', '-')}`);
    if (el) el.value = v || '';
  }
  $('#manual-needs-review').checked = !!ev.needs_review;
  $('#manual-preview').hidden = false;
}

function readManualFields() {
  return normalizeManualEvent({
    title: $('#manual-title').value,
    date: $('#manual-date').value,
    start_time: $('#manual-start-time').value,
    end_time: $('#manual-end-time').value,
    venue: $('#manual-venue').value,
    city: $('#manual-city').value,
    price: $('#manual-price').value,
    age: $('#manual-age').value,
    genres: splitList($('#manual-genres').value),
    promoter: $('#manual-promoter').value,
    source_url: $('#manual-source-url').value,
    lat: $('#manual-lat').value,
    lng: $('#manual-lng').value,
    description: $('#manual-input').value,
    needs_review: $('#manual-needs-review').checked,
    source_name: 'Manual (local)',
  });
}

function saveManualPreview() {
  const ev = readManualFields();
  if (!ev.title && !ev.date && !ev.venue) { setManualStatus('nothing to save'); return; }
  const existing = loadManualEvents().filter(x => x.id !== ev.id);
  existing.push(ev);
  saveManualEvents(existing);
  rebuildEvents();
  refreshEventStats();
  ensureFilterOptions(ev);
  syncAllUI();
  render();
  setManualStatus(`saved local · ${existing.length} manual`);
}

function refreshEventStats() {
  $('#stat-count').textContent = EVENTS.length;
}

function ensureFilterOptions(ev) {
  if (ev.region) ensureOption('#region', ev.region);
  for (const g of arr(ev.genres)) ensureOption('#genre', g);
  for (const s of arr(ev.sources_seen)) if (s.name) ensureOption('#source', s.name);
}

function ensureOption(sel, value) {
  const el = $(sel);
  if (!el || !value || [...el.options].some(o => o.value === value)) return;
  const o = document.createElement('option');
  o.value = value;
  o.textContent = value;
  el.appendChild(o);
}

async function copyManualJSON() {
  const text = manualJSONText();
  try {
    await navigator.clipboard.writeText(text);
    setManualStatus('copied manual_events.json');
  } catch {
    $('#manual-export').value = text;
    $('#manual-export').hidden = false;
    $('#manual-export').select();
    setManualStatus('copy blocked; text selected');
  }
}

function downloadManualJSON() {
  downloadText('manual_events.json', manualJSONText(), 'application/json');
  setManualStatus('downloaded manual_events.json');
}

function manualJSONText() {
  return JSON.stringify(loadManualEvents().map(toManualExportRow), null, 2);
}

function clearManualLocal() {
  saveManualEvents([]);
  rebuildEvents();
  refreshEventStats();
  render();
  setManualStatus('cleared local manual');
}

const IS_LOCALHOST = location.hostname === 'localhost' || location.hostname === '127.0.0.1';

async function saveManualToFile() {
  if (!IS_LOCALHOST) return;
  const events = loadManualEvents().map(toManualExportRow);
  try {
    const res = await fetch('/api/save-manual', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ events }),
    });
    const data = await res.json();
    if (data.ok) setManualStatus(`saved to file · ${data.count} events`);
    else setManualStatus('file save failed: ' + (data.error || 'unknown'));
  } catch (e) {
    setManualStatus('file save failed: ' + e.message);
  }
}

function downloadText(filename, text, type) {
  const blob = new Blob([text], { type });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  a.click();
  URL.revokeObjectURL(a.href);
}

function setManualStatus(text) {
  $('#manual-status').textContent = text;
}

/* ---- source dashboard ---- */
function renderSources() {
  const cls = { ok: 's-ok', error: 's-err', needs_key: 's-key', degraded: 's-deg', empty: 's-empty', planned: 's-plan', best_effort: 's-best', manual: 's-manual' };
  const today = localDateString();
  const rows = SOURCES.map(s => {
    const tier = [s.tier ? `T${s.tier}` : '', s.type || ''].filter(Boolean).join('/');
    const status = `${s.status || 'planned'}${s.count != null ? ' (' + s.count + ')' : ''}`;
    const lastChecked = s.last_checked ? new Date(s.last_checked) : null;
    const stale = lastChecked && (Date.now() - lastChecked.getTime()) > 48 * 3600000;
    const statusCls = stale && s.status === 'ok' ? 's-deg' : (cls[s.status] || '');
    const eventsThisWeek = s.active ? EVENTS.filter(e => arr(e.sources_seen).some(ss => ss.name === s.name) && e.date && e.date >= today).length : '';
    const lastTime = lastChecked ? lastChecked.toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) : '';
    return `<tr><td>${esc(s.name)}</td><td>${esc(tier)}</td><td class="${statusCls}">${esc(status)}${stale ? ' ⚠' : ''}</td><td style="color:var(--mut)">${eventsThisWeek ? eventsThisWeek + ' upcoming · ' : ''}${lastTime ? 'last: ' + lastTime + ' · ' : ''}${esc(s.note || '')}${s.error ? ' — ' + esc(s.error) : ''}</td></tr>`;
  }).join('');
  const okCount = SOURCES.filter(s => s.status === 'ok').length;
  const errCount = SOURCES.filter(s => s.status === 'error' || s.status === 'needs_key').length;
  const summary = `<div style="margin-bottom:6px;font-size:11px"><span class="s-ok">${okCount} ok</span> · <span class="s-deg">${SOURCES.filter(s => s.status === 'degraded').length} degraded</span> · <span class="s-err">${errCount} err/key</span> · ${SOURCES.filter(s => !s.active).length} planned</div>`;
  $('#sources').innerHTML = `${summary}<table><thead><tr><th>Source</th><th>Tier</th><th>Status</th><th>Notes</th></tr></thead><tbody>${rows}</tbody></table>`;
}

/* ---- ICS export ---- */
function icsDate(date, time) {
  if (!date) return null;
  let h = 20, m = 0;
  const tm = (time || '').toLowerCase().match(/(\d{1,2})(?::(\d{2}))?\s*(am|pm)?/);
  if (tm) { h = +tm[1]; m = tm[2] ? +tm[2] : 0; if (tm[3] === 'pm' && h < 12) h += 12; if (tm[3] === 'am' && h === 12) h = 0; }
  return date.replace(/-/g, '') + 'T' + String(h).padStart(2, '0') + String(m).padStart(2, '0') + '00';
}
function exportICS(list) {
  const evs = list.filter(e => e.date);
  if (!evs.length) { alert('No dated events to export in the current view.'); return; }
  let ics = 'BEGIN:VCALENDAR\r\nVERSION:2.0\r\nPRODID:-//SoCal Event Radar//EN\r\n';
  for (const e of evs) {
    const dt = icsDate(e.date, e.start_time);
    const link = eventLink(e);
    ics += 'BEGIN:VEVENT\r\n' +
      `UID:${e.id}@socal-radar\r\nDTSTART:${dt}\r\n` +
      `SUMMARY:${icsEsc(e.title)}${e.venue ? ' @ ' + icsEsc(e.venue) : ''}\r\n` +
      `LOCATION:${icsEsc([e.venue, e.region].filter(Boolean).join(', '))}\r\n` +
      `DESCRIPTION:${icsEsc([arr(e.genres).join(', '), e.price, e.age, link].filter(Boolean).join(' | '))}\r\n` +
      `URL:${link}\r\nEND:VEVENT\r\n`;
  }
  ics += 'END:VCALENDAR';
  const blob = new Blob([ics], { type: 'text/calendar' });
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob);
  a.download = evs.length === 1 ? `${(evs[0].title || 'event').slice(0, 40).replace(/[^a-z0-9]+/gi, '-')}.ics` : 'socal-events.ics';
  a.click(); URL.revokeObjectURL(a.href);
}
function icsEsc(s) { return (s || '').replace(/([,;\\])/g, '\\$1').replace(/\n/g, '\\n'); }

/* ---- share tonight ---- */
async function shareTonight() {
  const today = localDateString();
  const tonightEvents = EVENTS.filter(e => e.date === today)
    .sort((a, b) => (forYouScore(b) - forYouScore(a)));
  if (!tonightEvents.length) { alert('No events tonight.'); return; }
  const d = new Date();
  const header = `TONIGHT IN LA — ${d.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' })}`;
  const sep = '──────────────────────';
  const lines = tonightEvents.slice(0, 20).map(e => {
    const time = e.start_time || '';
    const venue = e.venue || 'TBA';
    const price = e.price ? ` — ${e.price}` : '';
    const age = e.age ? ` ${e.age}` : '';
    const url = (e.ticket_url || e.source_url || '').trim();
    let line = `${time} ${e.title} @ ${venue}${price}${age}`;
    if (url) line += `\n${url}`;
    return line;
  });
  const text = `${header}\n${sep}\n${lines.join('\n')}\n${sep}\nGenerated by SoCal Event Radar`;
  try {
    await navigator.clipboard.writeText(text);
    alert('Tonight\'s picks copied to clipboard!');
  } catch {
    prompt('Copy this text:', text);
  }
}

/* ---- local scene intelligence ---- */
function eventByStableId(id) {
  return EVENTS.find(e => getEventStableId(e) === id || e.id === id);
}

function dayLabel(iso) {
  if (!iso) return 'undated';
  const d = new Date(iso + 'T12:00');
  return d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
}

function weekendBounds(base = new Date()) {
  const day = base.getDay();
  const fri = addDays(base, (5 - day + 7) % 7);
  const start = (day === 5 || day === 6 || day === 0) ? base : fri;
  const end = day === 0 ? base : addDays(fri, 2);
  return { from: localDateString(start), to: localDateString(end) };
}

function eventVibes(e) {
  const tags = [];
  if ((e.underground_score || 0) >= 7) tags.push('underground');
  if (e.is_afterhours) tags.push('afters');
  if (e.is_tba_location) tags.push('TBA/warehouse');
  if (e.is_free_rsvp) tags.push('free');
  if (e.is_manual) tags.push('manual');
  for (const g of arr(e.genres).slice(0, 4)) tags.push(g);
  return [...new Set(tags.filter(Boolean))];
}

function digestScore(e) {
  return forYouScore(e)
    + (e.underground_score || 0) * 5
    + (e.is_manual ? 10 : 0)
    + (e.is_afterhours ? 8 : 0)
    + (e.is_tba_location ? 8 : 0)
    + (SAVED.has(e.id) ? 10 : 0)
    + (GOING.has(e.id) ? 12 : 0);
}

function generateWeekendDigest(allEvents) {
  const { from, to } = weekendBounds();
  const events = allEvents
    .filter(e => e.date && e.date >= from && e.date <= to)
    .sort((a, b) => digestScore(b) - digestScore(a) || (a.date || '').localeCompare(b.date || '') || (a.start_time || '').localeCompare(b.start_time || ''));
  const lines = [
    'SOCAL EVENT RADAR',
    `Weekend digest: ${dayLabel(from)} - ${dayLabel(to)}`,
    `${events.length} events, ${events.filter(e => (e.underground_score || 0) >= 7).length} underground, ${events.filter(e => e.is_free_rsvp).length} free`,
    '',
  ];
  if (!events.length) {
    lines.push('No dated weekend events in the current dataset yet.');
    return lines.join('\n');
  }
  for (const iso of [...new Set(events.map(e => e.date))]) {
    const dayEvents = events.filter(e => e.date === iso).slice(0, 10);
    lines.push(dayLabel(iso).toUpperCase());
    dayEvents.forEach((e, i) => {
      const where = [e.venue || (e.is_tba_location ? 'TBA' : ''), e.region].filter(Boolean).join(', ');
      const time = e.start_time ? `${e.start_time} - ` : '';
      lines.push(`${i + 1}. ${time}${e.title}${where ? ' @ ' + where : ''} (${undergroundLabel(e)}/10)`);
      const vibes = eventVibes(e).join(', ');
      if (vibes) lines.push(`   vibe: ${vibes}`);
      const link = eventLink(e);
      if (link) lines.push(`   link: ${link}`);
    });
    lines.push('');
  }
  lines.push('Generated locally by SoCal Event Radar.');
  return lines.join('\n').trim();
}

function toggleWeekendPanel() {
  const panel = $('#weekend-panel');
  const open = panel.hidden;
  panel.hidden = !open;
  $('#btn-weekend').classList.toggle('on', open);
  if (open && !$('#digest-output').value) {
    $('#digest-output').value = generateWeekendDigest(EVENTS);
    $('#digest-status').textContent = 'generated';
  }
}

async function copyText(text, fallbackEl, statusEl) {
  if (!text) return false;
  try {
    if (navigator.clipboard?.writeText) await navigator.clipboard.writeText(text);
    else throw new Error('clipboard unavailable');
    if (statusEl) statusEl.textContent = 'copied';
    flashNote('copied');
    return true;
  } catch {
    if (fallbackEl && typeof fallbackEl.select === 'function') {
      fallbackEl.focus();
      fallbackEl.select();
      try {
        document.execCommand('copy');
        if (statusEl) statusEl.textContent = 'copied';
        flashNote('copied');
        return true;
      } catch {}
    }
    prompt('Copy this text:', text);
    if (statusEl) statusEl.textContent = 'copy manually';
    return false;
  }
}

function flashNote(msg) {
  const note = $('#hidden-note');
  if (!note) return;
  note.textContent = msg;
  note.style.display = 'block';
  clearTimeout(flashNote.timer);
  flashNote.timer = setTimeout(() => { note.style.display = 'none'; }, 2400);
}

function generateShareText(e) {
  const where = [e.venue || (e.is_tba_location ? 'TBA' : ''), e.region].filter(Boolean).join(', ');
  const lines = [
    e.title || 'Untitled event',
    [dayLabel(e.date), e.start_time].filter(Boolean).join(' '),
    where,
  ].filter(Boolean);
  const vibes = eventVibes(e);
  if (vibes.length) lines.push(`vibe: ${vibes.join(', ')}`);
  if (e.price || e.age) lines.push([e.price, e.age].filter(Boolean).join(' / '));
  lines.push(`underground score: ${(e.underground_score || 0).toFixed(1)}/10`);
  const link = eventLink(e);
  if (link) lines.push(link);
  return lines.join('\n');
}

function shareEventText(id) {
  const ev = eventByStableId(id);
  if (!ev) return;
  copyText(generateShareText(ev), null, $('#hidden-note'));
}

function loadShowLogs() {
  const logs = LS.get(SHOW_LOG_KEY, {});
  return logs && typeof logs === 'object' && !Array.isArray(logs) ? logs : {};
}

function saveShowLog(eventId, log) {
  SHOW_LOGS[eventId] = log;
  LS.set(SHOW_LOG_KEY, SHOW_LOGS);
}

function showLogAffinityBoost(e) {
  const logs = Object.values(SHOW_LOGS || {});
  if (!logs.length) return 0;
  const eGenres = new Set(arr(e.genres).map(g => g.toLowerCase()));
  const venue = clean(e.venue).toLowerCase();
  const promoter = clean(e.promoter).toLowerCase();
  let boost = 0;
  for (const log of logs) {
    const liked = Number(log.vibe) >= 4 || log.worth_it === 'yes';
    const disliked = Number(log.vibe) > 0 && Number(log.vibe) <= 2 || log.worth_it === 'no';
    let sim = 0;
    if (venue && venue === clean(log.venue).toLowerCase()) sim += 2.5;
    if (promoter && promoter === clean(log.promoter).toLowerCase()) sim += 2;
    const overlap = arr(log.genres).filter(g => eGenres.has(String(g).toLowerCase())).length;
    sim += Math.min(3, overlap);
    if (!sim) continue;
    if (liked) boost += sim * 1.4;
    if (disliked) boost -= sim;
  }
  return Math.max(-10, Math.min(14, boost));
}

function openShowLogEditor(id) {
  const ev = eventByStableId(id);
  if (!ev) return;
  ACTIVE_LOG_EVENT_ID = getEventStableId(ev);
  const old = SHOW_LOGS[ACTIVE_LOG_EVENT_ID] || {};
  $('#log-event-title').textContent = `Log: ${ev.title || 'event'}`;
  $('#log-vibe').value = old.vibe || '';
  $('#log-crowd').value = old.crowd || '';
  $('#log-worth').value = old.worth_it || 'yes';
  $('#log-note').value = old.note || '';
  $('#log-status').textContent = old.updated_at ? 'editing saved log' : '';
  $('#log-editor-panel').hidden = false;
}

function showLogPayload(id, extra = {}) {
  const ev = eventByStableId(id);
  return {
    stable_id: id,
    event_id: ev?.id || '',
    title: ev?.title || '',
    date: ev?.date || '',
    venue: ev?.venue || '',
    city: ev?.city || ev?.region || '',
    promoter: ev?.promoter || '',
    genres: arr(ev?.genres),
    ...extra,
    updated_at: new Date().toISOString(),
  };
}

function markArrivedHere() {
  if (!ACTIVE_LOG_EVENT_ID) return;
  const old = SHOW_LOGS[ACTIVE_LOG_EVENT_ID] || {};
  saveShowLog(ACTIVE_LOG_EVENT_ID, showLogPayload(ACTIVE_LOG_EVENT_ID, { ...old, arrived_at: new Date().toISOString() }));
  $('#log-status').textContent = 'arrival saved';
  renderShowLogPanel();
  render();
}

function saveActiveShowLog() {
  if (!ACTIVE_LOG_EVENT_ID) return;
  const old = SHOW_LOGS[ACTIVE_LOG_EVENT_ID] || {};
  saveShowLog(ACTIVE_LOG_EVENT_ID, showLogPayload(ACTIVE_LOG_EVENT_ID, {
    ...old,
    vibe: $('#log-vibe').value,
    crowd: $('#log-crowd').value,
    worth_it: $('#log-worth').value,
    note: clean($('#log-note').value),
  }));
  $('#log-status').textContent = 'saved';
  renderShowLogPanel();
  render();
}

function toggleShowLogPanel() {
  const panel = $('#showlog-panel');
  const open = panel.hidden;
  panel.hidden = !open;
  $('#btn-show-log').classList.toggle('on', open);
  if (open) renderShowLogPanel();
}

function renderShowLogPanel() {
  const list = $('#showlog-list');
  if (!list) return;
  const logs = Object.values(SHOW_LOGS || {}).sort((a, b) => (b.updated_at || b.date || '').localeCompare(a.updated_at || a.date || ''));
  $('#showlog-stats').textContent = `${logs.length} logged`;
  if (!logs.length) {
    list.innerHTML = '<div class="intel-mini">Click log on any event row to save a post-show note.</div>';
    return;
  }
  list.innerHTML = '<div class="intel-list">' + logs.map(log => {
    const meta = [log.date, log.venue, log.city].filter(Boolean).join(' - ');
    const ratings = [`vibe ${log.vibe || '-'}`, `crowd ${log.crowd || '-'}`, `worth ${log.worth_it || '-'}`].join(' / ');
    return `<div class="intel-row"><b>${esc(log.title || 'Untitled event')}</b><div class="intel-mini">${esc(meta)}</div><div>${esc(ratings)}</div>${log.note ? `<div class="intel-mini">${esc(log.note)}</div>` : ''}</div>`;
  }).join('') + '</div>';
}

function priceNumber(price) {
  const s = clean(price).toLowerCase();
  if (!s) return null;
  if (/\b(free|no cover|\$0)\b/.test(s)) return 0;
  const m = s.match(/\$?\s*(\d+(?:\.\d{1,2})?)/);
  return m ? Number(m[1]) : null;
}

function topCounts(values, limit = 5) {
  const counts = new Map();
  values.map(clean).filter(Boolean).forEach(v => counts.set(v, (counts.get(v) || 0) + 1));
  return Array.from(counts.entries())
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, limit);
}

function getVenueIntel(name) {
  const key = clean(name).toLowerCase();
  let matches = EVENTS.filter(e => clean(e.venue || e.region).toLowerCase() === key);
  if (!matches.length && key) matches = EVENTS.filter(e => clean(e.venue || '').toLowerCase().includes(key));
  const today = localDateString();
  const upcoming = matches.filter(e => e.date && e.date >= today).sort((a, b) => a.date.localeCompare(b.date) || (a.start_time || '').localeCompare(b.start_time || ''));
  const prices = matches.map(e => priceNumber(e.price)).filter(n => n != null);
  const avgPrice = prices.length ? prices.reduce((a, b) => a + b, 0) / prices.length : null;
  const avgUg = matches.length ? matches.reduce((sum, e) => sum + (e.underground_score || 0), 0) / matches.length : 0;
  return {
    matches,
    upcoming,
    avgPrice,
    avgUg,
    mapped: matches.some(hasCoords),
    genres: topCounts(matches.flatMap(e => arr(e.genres)), 5),
    promoters: topCounts(matches.map(e => e.promoter), 5),
    days: topCounts(matches.map(e => e.date ? new Date(e.date + 'T12:00').toLocaleDateString('en-US', { weekday: 'short' }) : ''), 5),
  };
}

function showVenueIntelPanel(name) {
  const panel = $('#venue-intel-panel');
  const body = $('#venue-intel-body');
  const intel = getVenueIntel(name);
  $('#venue-intel-title').textContent = `Venue Intel: ${name || 'TBA'}`;
  if (!intel.matches.length) {
    body.innerHTML = '<div class="intel-mini">No matching local venue history yet.</div>';
    panel.hidden = false;
    return;
  }
  const avgPrice = intel.avgPrice == null ? 'unknown' : (intel.avgPrice === 0 ? 'free' : `$${Math.round(intel.avgPrice)}`);
  const upcoming = intel.upcoming.slice(0, 8).map(e =>
    `<div class="intel-row">${esc(e.date || '')} ${esc(e.start_time || '')} - <b>${esc(e.title)}</b><div class="intel-mini">${esc(eventVibes(e).join(', '))}</div></div>`
  ).join('');
  body.innerHTML =
    `<div class="intel-mini">${intel.matches.length} total events - ${intel.upcoming.length} upcoming - avg ${undergroundLabel({ underground_score: intel.avgUg })}/10 - avg cover ${avgPrice} - ${intel.mapped ? 'mapped' : 'unmapped'}</div>` +
    `<div class="intel-mini">genres: ${esc(intel.genres.map(([k, v]) => `${k} (${v})`).join(', ') || 'unknown')}</div>` +
    `<div class="intel-mini">promoters: ${esc(intel.promoters.map(([k, v]) => `${k} (${v})`).join(', ') || 'unknown')}</div>` +
    `<div class="intel-mini">busy days: ${esc(intel.days.map(([k, v]) => `${k} (${v})`).join(', ') || 'unknown')}</div>` +
    `<div class="intel-list">${upcoming || '<div class="intel-row">No upcoming events at this venue.</div>'}</div>`;
  panel.hidden = false;
}

function sceneBlob(e) {
  return `${e.title || ''} ${e.venue || ''} ${e.region || ''} ${e.promoter || ''} ${arr(e.artists).join(' ')} ${arr(e.genres).join(' ')} ${arr(e.categories).join(' ')} ${e.description || ''}`.toLowerCase();
}

function relatedArtists(term) {
  const lower = term.toLowerCase();
  const key = Object.keys(COOCCURRENCE || {}).find(k => k.toLowerCase() === lower);
  if (!key) return [];
  return Object.entries(COOCCURRENCE[key]).sort((a, b) => b[1] - a[1]).slice(0, 10);
}

function renderSceneSearchResult(term) {
  const el = $('#scene-result');
  if (!term) {
    el.innerHTML = '<div class="intel-mini">Search an artist, promoter, venue, genre, or vibe for local scene intel.</div>';
    return;
  }
  const lower = term.toLowerCase();
  const rows = EVENTS.filter(e => sceneBlob(e).includes(lower));
  const upcoming = rows.filter(e => e.date && e.date >= localDateString()).sort((a, b) => a.date.localeCompare(b.date)).slice(0, 8);
  const related = relatedArtists(term);
  if (!rows.length && !related.length) {
    el.innerHTML = `<div class="intel-mini">No local matches for ${esc(term)} yet.</div>`;
    return;
  }
  const genres = topCounts(rows.flatMap(e => arr(e.genres)), 6).map(([k, v]) => `${k} (${v})`).join(', ');
  const venues = topCounts(rows.map(e => e.venue || e.region), 6).map(([k, v]) => `${k} (${v})`).join(', ');
  const promoters = topCounts(rows.map(e => e.promoter), 6).map(([k, v]) => `${k} (${v})`).join(', ');
  const upHtml = upcoming.map(e => `<div class="intel-row">${esc(e.date || '')} - <b>${esc(e.title)}</b> @ ${esc(e.venue || 'TBA')} <span class="badge b-ug">${esc(undergroundLabel(e))}</span></div>`).join('');
  el.innerHTML =
    `<div class="intel-mini">${rows.length} matching events - ${upcoming.length} upcoming</div>` +
    `<div class="intel-mini">genres: ${esc(genres || 'unknown')}</div>` +
    `<div class="intel-mini">venues: ${esc(venues || 'unknown')}</div>` +
    `<div class="intel-mini">promoters: ${esc(promoters || 'unknown')}</div>` +
    `<div class="intel-mini">related: ${esc(related.map(([k, v]) => `${k} (${v})`).join(', ') || 'none yet')}</div>` +
    `<div class="intel-list">${upHtml || '<div class="intel-row">No upcoming matches.</div>'}</div>`;
}

function toggleReleasePanel() {
  const panel = $('#release-panel');
  const open = panel.hidden;
  panel.hidden = !open;
  $('#btn-release').classList.toggle('on', open);
  if (open) {
    if (!$('#release-date').value) $('#release-date').value = weekendBounds().from;
    renderReleaseTarget();
  }
}

function releaseWindowRows(targetIso) {
  const rows = [];
  const base = new Date(targetIso + 'T12:00');
  for (let i = -7; i <= 7; i++) {
    const iso = localDateString(addDays(base, i));
    const dayEvents = EVENTS.filter(e => e.date === iso);
    rows.push({
      iso,
      count: dayEvents.length,
      underground: dayEvents.filter(e => (e.underground_score || 0) >= 7).length,
      free: dayEvents.filter(e => e.is_free_rsvp).length,
    });
  }
  return rows;
}

function dateDistanceDays(iso, targetIso) {
  return Math.abs(new Date(iso + 'T12:00') - new Date(targetIso + 'T12:00')) / 86400000;
}

function renderReleaseTarget() {
  const out = $('#release-output');
  const date = $('#release-date').value || weekendBounds().from;
  const keywords = splitList($('#release-keyword').value).map(s => s.toLowerCase());
  const region = clean($('#release-region').value).toLowerCase();
  const base = new Date(date + 'T12:00');
  const from = localDateString(addDays(base, -7));
  const to = localDateString(addDays(base, 7));
  const competitors = EVENTS.filter(e => {
    if (!e.date || e.date < from || e.date > to) return false;
    const blob = sceneBlob(e);
    if (region && !blob.includes(region)) return false;
    if (keywords.length && !keywords.some(k => blob.includes(k))) return false;
    return true;
  }).sort((a, b) => dateDistanceDays(a.date, date) - dateDistanceDays(b.date, date) || digestScore(b) - digestScore(a));
  const best = releaseWindowRows(date)
    .filter(r => r.iso >= localDateString())
    .sort((a, b) => a.count - b.count || a.underground - b.underground || a.iso.localeCompare(b.iso))
    .slice(0, 3);
  const bestText = best.map(r => `${dayLabel(r.iso)}: ${r.count} events, ${r.underground} underground`).join(' | ');
  const rows = competitors.slice(0, 12).map(e =>
    `<div class="intel-row">${esc(dayLabel(e.date))} ${esc(e.start_time || '')} - <b>${esc(e.title)}</b> @ ${esc(e.venue || 'TBA')} <span class="badge b-ug">${esc(undergroundLabel(e))}</span></div>`
  ).join('');
  out.innerHTML =
    `<div class="intel-mini">Light competition days: ${esc(bestText || 'unknown')}</div>` +
    `<div class="intel-mini">${competitors.length} nearby events in the +/- 7 day window${keywords.length ? ' matching ' + esc(keywords.join(', ')) : ''}.</div>` +
    `<div class="intel-list">${rows || '<div class="intel-row">No nearby matching events.</div>'}</div>`;
}

/* ---- lazy Leaflet map ---- */
let mapOpen = false, map = null, layer = null, leafletLoading = null, mapViewTimer = null, mapDrawSeq = 0;
function currentList() { return sortEvents(EVENTS.filter(matches)); }
function toggleMap() {
  mapOpen = !mapOpen;
  $('#map').style.display = mapOpen ? 'block' : 'none';
  $('#btn-map').classList.toggle('on', mapOpen);
  if (mapOpen) {
    drawMap(currentList());
    ensureLeaflet().then(() => { if (mapOpen) drawMap(currentList()); });
  }
}
function ensureLeaflet() {
  if (window.L) return Promise.resolve(true);
  if (leafletLoading) return leafletLoading;
  leafletLoading = new Promise((res) => {
    let done = false;
    const finish = (ok) => { if (!done) { done = true; res(ok); } };
    const css = document.createElement('link'); css.rel = 'stylesheet'; css.href = 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/leaflet.min.css'; document.head.appendChild(css);
    const js = document.createElement('script'); js.src = 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/leaflet.min.js'; js.onload = () => finish(true); js.onerror = () => finish(false); document.head.appendChild(js);
    setTimeout(() => finish(false), 8000);
  });
  return leafletLoading;
}
function drawMap(list) {
  const pts = list.filter(hasCoords);
  const mapEl = $('#map');
  if (!pts.length) {
    clearMapLayer();
    cancelMapViewUpdate();
    mapEl.dataset.mapped = '0';
    if (map) {
      mapEl.dataset.renderer = 'leaflet';
    } else {
      mapEl.dataset.mode = 'fallback';
      mapEl.innerHTML = '<div class="map-empty">No mapped events in this view.</div>';
    }
    return;
  }
  if (!window.L) { drawFallbackMap(pts); return; }
  if (mapEl.dataset.mode === 'fallback') {
    mapEl.replaceChildren();
    delete mapEl.dataset.mode;
  }
  mapEl.dataset.mapped = String(pts.length);
  mapEl.dataset.renderer = 'leaflet';
  if (!map) { map = L.map('map').setView([34.05, -118.24], 10); L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { attribution: '© OpenStreetMap', maxZoom: 18 }).addTo(map); }
  if (!layer) layer = L.layerGroup().addTo(map);
  else layer.clearLayers();
  const bounds = [];
  pts.forEach(e => {
    const lat = Number(e.lat), lng = Number(e.lng);
    const m = L.circleMarker([lat, lng], { radius: 6, color: e.is_underground ? '#c98bff' : (e.is_festival ? '#6fa8ff' : '#3ad06a'), weight: 2, fillOpacity: .75 });
    const link = eventLink(e);
    m.bindPopup(`<b>${esc(e.title)}</b><br>${esc(e.date || '')} ${esc(e.start_time || '')}<br>${esc(e.venue)} — ${esc(e.region)}${link ? `<br><a href="${esc(link)}" target="_blank" rel="noopener noreferrer">tickets/info ↗</a>` : ''}`);
    layer.addLayer(m);
    bounds.push([lat, lng]);
  });
  scheduleMapViewUpdate(bounds);
}

function drawFallbackMap(pts) {
  const mapEl = $('#map');
  mapEl.dataset.mode = 'fallback';
  mapEl.dataset.mapped = String(pts.length);
  mapEl.dataset.renderer = 'fallback';
  const bounds = pointBounds(pts);
  const dots = pts.map((e) => {
    const lat = Number(e.lat), lng = Number(e.lng);
    const x = clamp((lng - bounds.minLng) / (bounds.maxLng - bounds.minLng), 0, 1) * 100;
    const y = clamp((bounds.maxLat - lat) / (bounds.maxLat - bounds.minLat), 0, 1) * 100;
    const cls = e.is_underground ? ' ug' : (e.is_festival ? ' fest' : '');
    return `<span class="map-dot${cls}" style="left:${x.toFixed(2)}%;top:${y.toFixed(2)}%" title="${esc(e.title)} — ${esc(e.venue || e.region || '')}"></span>`;
  }).join('');
  mapEl.innerHTML = `<div class="map-fallback" role="img" aria-label="${pts.length} mapped events"><div class="map-grid"></div>${dots}<div class="map-count">${pts.length} mapped events</div></div>`;
}

function clearMapLayer() {
  if (layer && typeof layer.clearLayers === 'function') layer.clearLayers();
}

function cancelMapViewUpdate() {
  if (mapViewTimer) clearTimeout(mapViewTimer);
  mapViewTimer = null;
  mapDrawSeq += 1;
}

function scheduleMapViewUpdate(bounds) {
  cancelMapViewUpdate();
  const seq = mapDrawSeq;
  mapViewTimer = setTimeout(() => {
    if (seq !== mapDrawSeq || !map || !mapOpen) return;
    try {
      map.invalidateSize();
      if (bounds.length) map.fitBounds(bounds, { padding: [18, 18], maxZoom: 12 });
    } catch {
      // Leaflet can leave an animation frame behind while filters redraw the map.
    }
  }, 50);
}

function pointBounds(pts) {
  let minLat = Math.min(...pts.map(e => Number(e.lat))), maxLat = Math.max(...pts.map(e => Number(e.lat)));
  let minLng = Math.min(...pts.map(e => Number(e.lng))), maxLng = Math.max(...pts.map(e => Number(e.lng)));
  if (minLat === maxLat) { minLat -= 0.05; maxLat += 0.05; }
  if (minLng === maxLng) { minLng -= 0.05; maxLng += 0.05; }
  const latPad = Math.max((maxLat - minLat) * 0.12, 0.04);
  const lngPad = Math.max((maxLng - minLng) * 0.12, 0.04);
  return {
    minLat: Math.max(SOCAL_BOUNDS.minLat, minLat - latPad),
    maxLat: Math.min(SOCAL_BOUNDS.maxLat, maxLat + latPad),
    minLng: Math.max(SOCAL_BOUNDS.minLng, minLng - lngPad),
    maxLng: Math.min(SOCAL_BOUNDS.maxLng, maxLng + lngPad),
  };
}
function clamp(n, min, max) { return Math.max(min, Math.min(max, n)); }

/* ---- history / attended ---- */
const HISTORY_KEY = 'radar:history';
let HISTORY = LS.get(HISTORY_KEY, []);
let SEED_HISTORY = [];

function loadSeedHistory() {
  return fetch('events.json').then(r => r.json()).then(() => {
    // seed history comes from scene_graph attended events baked into localStorage on first load
    return [];
  }).catch(() => []);
}

function initHistory() {
  // On first run, seed from scene_graph attended events if not already in history
  const seeded = LS.get('radar:history_seeded', false);
  if (!seeded) {
    const seeds = [
      { id: 'attended_001', title: "Brian's Birthday — Paper Tiger Afters", venue: 'Paper Tiger Bar', city: 'Los Angeles', date: '2026-06-07', artists: ['Wesley / crushh', 'Blake / AMERICANRECYCLING'], promoter: 'Blake / AMERICANRECYCLING', notes: 'VERLANT debut set at house pre-party before this. Ran until 6AM. Met crushed_mag contacts and photographer.', rating: 5 },
      { id: 'attended_002', title: 'GENESYS Clothing Launch', venue: 'Water & Power', city: 'Los Angeles', date: '2026-04-15', artists: [], promoter: 'GENESYS', notes: 'Fashion/visual world crossover. Attended as guest.', rating: 4 },
      { id: 'attended_003', title: 'SEBii + kimj', venue: 'Club Six SF', city: 'San Francisco', date: '2026-04-11', artists: ['SEBii', 'kimj', 'R!R!Riot', 'moth', 'faith', 'Justice Park', 'Star Eater', 'WORLDPEACE2030'], promoter: 'Stereochrome x AMERICANRECYCLING', notes: 'Stereochrome x americanrecycling. Knew the promoters personally.', rating: 4 },
      { id: 'attended_004', title: 'Ms* Gloom / J Is For Joon Mixtape Release', venue: 'Three Clubs', city: 'Los Angeles', date: '2026-03-27', artists: ['Ms* Gloom'], promoter: 'Pretty But Wicked', notes: 'Dark electronic live set. Rare live show from Ms* Gloom. Adjacent to VERLANT aesthetic.', rating: 5 },
      { id: 'attended_005', title: 'Bixby El Rey Show Afters', venue: 'unknown', city: 'Los Angeles', date: '2026-01', artists: ['Wesley / crushh'], promoter: '', notes: 'Went with Sonni. Met Taylor at the event Sam gave me a ticket for.', rating: 4 },
    ];
    const existingIds = new Set(HISTORY.map(h => h.id));
    for (const s of seeds) {
      if (!existingIds.has(s.id)) HISTORY.push(s);
    }
    LS.set(HISTORY_KEY, HISTORY);
    LS.set('radar:history_seeded', true);
  }
}

function markAttended(eventId) {
  const ev = EVENTS.find(e => e.id === eventId);
  if (!ev) return;
  const existing = HISTORY.find(h => h.id === eventId);
  if (existing) return;
  const rating = 0;
  HISTORY.push({
    id: ev.id, title: ev.title, venue: ev.venue, city: ev.city || ev.region,
    date: ev.date, artists: arr(ev.artists), promoter: ev.promoter || '',
    notes: '', rating,
  });
  LS.set(HISTORY_KEY, HISTORY);
  renderHistory();
  render();
}

function setHistoryRating(id, rating) {
  const h = HISTORY.find(e => e.id === id);
  if (h) { h.rating = rating; LS.set(HISTORY_KEY, HISTORY); renderHistory(); }
}

function setHistoryNotes(id) {
  const h = HISTORY.find(e => e.id === id);
  if (!h) return;
  const notes = prompt('Personal notes:', h.notes || '');
  if (notes !== null) { h.notes = notes; LS.set(HISTORY_KEY, HISTORY); renderHistory(); }
}

function renderHistory() {
  const list = $('#history-list');
  if (!list) return;
  $('#history-count').textContent = HISTORY.length;
  if (!HISTORY.length) { list.innerHTML = '<div style="color:var(--mut);padding:8px">No attended events yet. Click ✓ on any event row to mark it.</div>'; return; }
  const sorted = [...HISTORY].sort((a, b) => (b.date || '').localeCompare(a.date || ''));
  const rows = sorted.map(h => {
    const stars = [1,2,3,4,5].map(n => `<span onclick="setHistoryRating('${esc(h.id)}',${n})" style="cursor:pointer">${n <= (h.rating||0) ? '★' : '☆'}</span>`).join('');
    return `<tr>
      <td class="date">${esc(h.date || '—')}</td>
      <td><b>${esc(h.title)}</b></td>
      <td>${esc(h.venue || '')}</td>
      <td>${esc(arr(h.artists).slice(0,4).join(', '))}</td>
      <td class="hist-stars">${stars}</td>
      <td class="hist-notes" onclick="setHistoryNotes('${esc(h.id)}')">${esc(h.notes || '')}</td>
    </tr>`;
  }).join('');
  list.innerHTML = `<table><tbody>${rows}</tbody></table>`;
}

function exportHistoryCSV() {
  if (!HISTORY.length) return;
  const header = 'date,title,venue,city,artists,promoter,price,personal_notes,rating';
  const rows = HISTORY.map(h => [
    h.date || '', csvEsc(h.title), csvEsc(h.venue), csvEsc(h.city),
    csvEsc(arr(h.artists).join('; ')), csvEsc(h.promoter), '',
    csvEsc(h.notes), h.rating || ''
  ].join(','));
  downloadText('event-history.csv', header + '\n' + rows.join('\n'), 'text/csv');
}

function csvEsc(s) { const v = String(s || ''); return v.includes(',') || v.includes('"') || v.includes('\n') ? '"' + v.replace(/"/g, '""') + '"' : v; }

function toggleHistoryPanel() {
  const panel = $('#history-panel');
  panel.hidden = !panel.hidden;
  $('#btn-history').classList.toggle('on', !panel.hidden);
  if (!panel.hidden) renderHistory();
}

/* ---- Phase 7: Artist Watchlist ---- */
function isWatchedEvent(e) {
  if (!WATCHLIST.size) return false;
  const artists = arr(e.artists).map(a => a.toLowerCase());
  for (const w of WATCHLIST) {
    const wl = w.toLowerCase();
    for (const a of artists) { if (a.includes(wl) || wl.includes(a)) return true; }
  }
  return false;
}

function renderWatchlistDigest() {
  const el = $('#watchlist-digest');
  if (!el) return;
  if (!WATCHLIST.size) { el.innerHTML = '<span style="color:var(--mut)">Click ☆ on any artist to add them to your watchlist.</span>'; return; }
  const today = localDateString();
  const items = [];
  for (const artist of WATCHLIST) {
    const lower = artist.toLowerCase();
    const upcoming = EVENTS.filter(e => e.date && e.date >= today && arr(e.artists).some(a => a.toLowerCase().includes(lower) || lower.includes(a.toLowerCase())))
      .sort((a, b) => a.date.localeCompare(b.date));
    const next = upcoming[0];
    items.push({ artist, count: upcoming.length, next });
  }
  items.sort((a, b) => b.count - a.count);
  el.innerHTML = items.map(i => {
    const next = i.next ? `${i.next.date} @ ${esc(i.next.venue || 'TBA')}` : '<span style="color:var(--mut)">no upcoming</span>';
    return `<div style="padding:2px 0;border-bottom:1px solid var(--line)">${esc(i.artist)} (${i.count}) — ${next} <span style="cursor:pointer;color:var(--aft)" onclick="toggleWatchlist('${esc(i.artist).replace(/'/g, "\\'")}')">✕</span></div>`;
  }).join('');
}

/* ---- Phase 5A: Scene Intelligence — Collective Activity Dashboard ---- */
function toggleScenePanel() {
  const panel = $('#scene-panel');
  panel.hidden = !panel.hidden;
  $('#btn-scene').classList.toggle('on', !panel.hidden);
  if (!panel.hidden) renderScenePanel();
}

function renderScenePanel() {
  const container = $('#scene-collectives');
  const data = SCENE_INTEL.collectives || [];
  const search = `<div class="intel-head"><input id="scene-search" placeholder="artist / promoter / venue / genre"><button class="btn" id="scene-find">Search</button><span class="stat">local event memory</span></div><div id="scene-result"></div>`;
  if (!data.length) {
    container.innerHTML = search + '<div style="color:var(--mut);padding:8px">No collective data. Run npm run collect first.</div>';
    $('#scene-find').onclick = () => renderSceneSearchResult($('#scene-search').value.trim());
    $('#scene-search').onkeydown = (e) => { if (e.key === 'Enter') renderSceneSearchResult(e.target.value.trim()); };
    renderSceneSearchResult('');
    return;
  }
  const rows = data.map(c => {
    const next = c.next_event ? `${c.next_event.date} — ${esc(c.next_event.title).slice(0, 40)}` : '—';
    return `<tr><td><span class="clickable-promoter" data-promoter="${esc(c.name)}">${esc(c.name)}</span></td><td>${c.events_this_month}</td><td style="color:var(--mut)">${next}</td><td style="color:var(--mut)">${esc(c.vibe)}</td></tr>`;
  }).join('');
  container.innerHTML = search + `<table><thead><tr><th>Collective</th><th>This Month</th><th>Next Event</th><th>Vibe</th></tr></thead><tbody>${rows}</tbody></table>`;
  $('#scene-find').onclick = () => renderSceneSearchResult($('#scene-search').value.trim());
  $('#scene-search').onkeydown = (e) => { if (e.key === 'Enter') renderSceneSearchResult(e.target.value.trim()); };
  renderSceneSearchResult('');
}

/* ---- Phase 5B: Artist Co-occurrence Tooltip ---- */
function showArtistTooltip(artistName, anchorEl) {
  const tooltip = $('#artist-tooltip');
  tooltip.style.pointerEvents = 'auto';
  const peers = COOCCURRENCE[artistName];
  const isWatched = WATCHLIST.has(artistName);
  const watchBtn = `<span style="cursor:pointer;margin-left:6px;color:${isWatched ? 'var(--new)' : 'var(--mut)'}" onclick="toggleWatchlist('${esc(artistName).replace(/'/g, "\\'")}');event.stopPropagation()">${isWatched ? '★ watching' : '☆ watch'}</span>`;
  if (!peers || !Object.keys(peers).length) {
    tooltip.innerHTML = `<b>${esc(artistName)}</b>${watchBtn}<br><span style="color:var(--mut)">no co-occurrence data yet</span>`;
  } else {
    const sorted = Object.entries(peers).sort((a, b) => b[1] - a[1]).slice(0, 8);
    tooltip.innerHTML = `<b>${esc(artistName)}</b>${watchBtn}<br>Often plays with: ${sorted.map(([name, count]) => `${esc(name)} (${count})`).join(', ')}`;
  }
  const rect = anchorEl.getBoundingClientRect();
  tooltip.style.left = Math.min(rect.left, window.innerWidth - 320) + 'px';
  tooltip.style.top = (rect.bottom + 4) + 'px';
  tooltip.hidden = false;
}

function toggleWatchlist(artistName) {
  if (WATCHLIST.has(artistName)) WATCHLIST.delete(artistName);
  else WATCHLIST.add(artistName);
  LS.set('radar:watchlist', [...WATCHLIST]);
  $('#artist-tooltip').hidden = true;
  render();
}

/* ---- Phase 5C: Venue Heat Map Sidebar ---- */
function toggleVenuePanel() {
  const panel = $('#venue-panel');
  panel.hidden = !panel.hidden;
  $('#btn-venues').classList.toggle('on', !panel.hidden);
  if (!panel.hidden) renderVenuePanel();
}

function renderVenuePanel() {
  const container = $('#venue-list');
  const data = SCENE_INTEL.venues || [];
  if (!data.length) { container.innerHTML = '<div style="color:var(--mut);padding:8px">No venue data. Run npm run collect first.</div>'; return; }
  const rows = data.map(v => {
    const genres = v.top_genres.slice(0, 2).join(', ');
    const promoters = v.top_promoters.slice(0, 2).join(', ');
    return `<tr>` +
      `<td><span class="venue-filter" data-venue-filter="${esc(v.name)}">${esc(v.name)}</span></td>` +
      `<td style="color:var(--mut)">${esc(v.neighborhood || '')}</td>` +
      `<td>${v.events_this_month}</td>` +
      `<td style="color:var(--mut)">${esc(genres)}</td>` +
      `<td style="color:var(--mut)">${esc(promoters)}</td>` +
      `<td>${v.has_upcoming ? '●' : '<span style="opacity:.3">○</span>'}</td>` +
      `</tr>`;
  }).join('');
  container.innerHTML = `<table><thead><tr><th>Venue</th><th>Hood</th><th>Month</th><th>Genres</th><th>Promoters</th><th>Up</th></tr></thead><tbody>${rows}</tbody></table>`;
  container.addEventListener('click', (e) => {
    const t = e.target.closest('[data-venue-filter]');
    if (t) {
      $('#q').value = t.dataset.venueFilter;
      STATE.q = t.dataset.venueFilter;
      render();
    }
  });
}

/* ---- Phase 5D: Promoter Profile Panel ---- */
function showPromoterPanel(promoterName) {
  const panel = $('#promoter-panel');
  const today = localDateString();
  const lower = promoterName.toLowerCase();

  const COLLECTIVES = (SCENE_INTEL.collectives || []).map(c => c.name.toLowerCase());
  const isFollowed = COLLECTIVES.includes(lower);
  $('#promoter-name').textContent = promoterName;
  const badge = $('#promoter-badge');
  badge.style.display = isFollowed ? '' : 'none';

  const allByPromoter = EVENTS.filter(ev => {
    const blob = `${ev.promoter || ''} ${(ev.artists || []).join(' ')} ${ev.title || ''}`.toLowerCase();
    return blob.includes(lower);
  }).sort((a, b) => (a.date || '~').localeCompare(b.date || '~'));

  const upcoming = allByPromoter.filter(e => e.date && e.date >= today);
  const past = allByPromoter.filter(e => e.date && e.date < today).slice(-10);
  const attended = HISTORY.filter(h => {
    const blob = `${h.promoter || ''} ${(h.artists || []).join(' ')} ${h.title || ''}`.toLowerCase();
    return blob.includes(lower);
  });

  let html = '';
  if (upcoming.length) {
    html += `<div style="margin-bottom:8px"><b style="color:var(--new)">Upcoming (${upcoming.length})</b></div>`;
    html += '<div class="promoter-events-list">' + upcoming.slice(0, 15).map(e =>
      `<div>${esc(e.date || '')} · ${esc(e.title)} @ ${esc(e.venue || 'TBA')}</div>`
    ).join('') + '</div>';
  }
  if (past.length) {
    html += `<div style="margin:8px 0 4px"><b style="color:var(--mut)">Recent Past</b></div>`;
    html += '<div class="promoter-events-list">' + past.map(e =>
      `<div>${esc(e.date || '')} · ${esc(e.title)} @ ${esc(e.venue || 'TBA')}</div>`
    ).join('') + '</div>';
  }
  if (attended.length) {
    html += `<div style="margin:8px 0 4px"><b style="color:var(--ug)">You Attended (${attended.length})</b></div>`;
    html += '<div class="promoter-events-list">' + attended.map(h =>
      `<div>${esc(h.date || '')} · ${esc(h.title)}${h.rating ? ' ★' + h.rating : ''}</div>`
    ).join('') + '</div>';
  }
  if (!upcoming.length && !past.length && !attended.length) {
    html = '<div style="color:var(--mut)">No events found for this promoter.</div>';
  }

  $('#promoter-events').innerHTML = html;
  panel.hidden = false;
}

/* ---- Phase 9E: Mobile swipe actions ---- */
(function initSwipe() {
  if (!('ontouchstart' in window)) return;
  let startX = 0, startY = 0, currentTr = null, swiped = false;
  const rows = document.getElementById('rows');
  rows.addEventListener('touchstart', (e) => {
    const tr = e.target.closest('tr');
    if (!tr) return;
    startX = e.touches[0].clientX;
    startY = e.touches[0].clientY;
    currentTr = tr;
    swiped = false;
  }, { passive: true });
  rows.addEventListener('touchmove', (e) => {
    if (!currentTr) return;
    const dx = e.touches[0].clientX - startX;
    const dy = Math.abs(e.touches[0].clientY - startY);
    if (dy > 30) { currentTr = null; return; }
    if (dx < -60 && !swiped) {
      swiped = true;
      showSwipeActions(currentTr);
    }
  }, { passive: true });
  rows.addEventListener('touchend', () => { currentTr = null; }, { passive: true });

  function showSwipeActions(tr) {
    tr.querySelectorAll('.swipe-actions').forEach(el => el.remove());
    const lastTd = tr.querySelector('td:last-child');
    if (!lastTd) return;
    const saveId = lastTd.querySelector('[data-save]')?.dataset.save;
    const goingId = lastTd.querySelector('[data-going]')?.dataset.going;
    if (!saveId) return;
    const div = document.createElement('div');
    div.className = 'swipe-actions';
    div.innerHTML = `<span data-save="${saveId}">★ Save</span> <span data-going="${goingId}">▶ Going</span>`;
    lastTd.appendChild(div);
    setTimeout(() => div.remove(), 3000);
  }
})();

boot();
if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});
