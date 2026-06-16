/* SoCal Event Radar — vanilla JS. No framework. Handles thousands of rows. */
'use strict';
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const LS = {
  get: (k, d) => { try { return JSON.parse(localStorage.getItem(k)) ?? d; } catch { return d; } },
  set: (k, v) => localStorage.setItem(k, JSON.stringify(v)),
};

let EVENTS = [], REMOTE_EVENTS = [], SOURCES = [], META = {}, COOCCURRENCE = {}, SCENE_INTEL = {};
let SAVED = new Set(LS.get('saved', [])), HIDDEN = new Set(LS.get('hidden', []));
let WATCHLIST = new Set(LS.get('radar:watchlist', []));
let GOING = new Set(LS.get('radar:going', []));
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
  wire();
  render();
  LS.set('lastVisit', Date.now()); // mark visit AFTER computing "new"
}

function uniq(a) { return [...new Set(a.filter(Boolean))]; }
function populateSelect(sel, vals) { const el = $(sel); vals.forEach(v => { const o = document.createElement('option'); o.value = v; o.textContent = v; el.appendChild(o); }); }

function updateTonightStats() {
  const today = localDateString();
  const tonightCount = EVENTS.filter(e => e.date === today).length;
  const networkCount = EVENTS.filter(e => e.my_network_match).length;
  const ugCount = EVENTS.filter(e => e.is_underground).length;
  $('#stat-tonight').textContent = tonightCount;
  $('#stat-network').textContent = networkCount;
  $('#stat-ug').textContent = ugCount;
}

const ALL_CATS = ['music','underground','festival','afterhours','tech','career','networking','ai','quant','art','gallery','community','library','wholesome','free','social','mixer','wellness','pop-up','market','education','university','professional','business','outdoor'];

function initCategoryChips() {
  // inject a categories row if not present
  let catRow = $('#cat-row');
  if (!catRow) {
    catRow = document.createElement('div');
    catRow.id = 'cat-row';
    catRow.className = 'controls';
    catRow.style.marginTop = '4px';
    catRow.innerHTML = '<span style="margin-right:6px;opacity:.7">cats:</span>';
    const controls = $('.controls');
    if (controls) controls.parentNode.insertBefore(catRow, controls.nextSibling);
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
  // add preset buttons to the top bar or after controls
  let presetBar = $('#preset-bar');
  if (!presetBar) {
    presetBar = document.createElement('div');
    presetBar.id = 'preset-bar';
    presetBar.style.cssText = 'padding:4px 12px 2px; font-size:11px; display:flex; gap:4px; flex-wrap:wrap; align-items:center; border-bottom:1px solid #222;';
    const header = document.querySelector('header');
    if (header) header.appendChild(presetBar);
  }

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
  if (e.for_you_score != null) return e.for_you_score;
  const blob = `${e.title || ''} ${e.venue || ''} ${e.promoter || ''} ${arr(e.artists).join(' ')} ${arr(e.genres).join(' ')} ${arr(e.categories).join(' ')} ${e.description || ''}`.toLowerCase();
  let score = 0;
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
  return score;
}

function badges(e) {
  let h = '';
  if (isNew(e)) h += '<span class="badge b-new">new</span>';
  if (e.is_manual) h += '<span class="badge b-manual">manual</span>';
  if (e.needs_review) h += '<span class="badge b-review">needs review</span>';
  if (e.is_underground) h += '<span class="badge b-ug">ug</span>';
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
  const rows = $('#rows');
  const frag = document.createDocumentFragment();
  const nowMs = Date.now();
  for (const e of list) {
    const tr = document.createElement('tr');
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
      `<td class="venue">${esc(e.venue || (e.is_tba_location ? 'TBA' : ''))}</td>` +
      `<td class="region">${esc(e.region)}</td>` +
      `<td class="genres">${esc(arr(e.genres).slice(0, 4).join(', '))}</td>` +
      `<td class="pa">${esc([e.price, e.age].filter(Boolean).join(' · '))}</td>` +
      `<td class="src" title="${esc(srcNames)}">${esc(srcNames.length > 18 ? arr(e.sources_seen).length + ' src' : srcNames)}</td>` +
      `<td class="acts"><span class="star ${SAVED.has(e.id) ? 'on' : ''}" data-save="${e.id}" title="save">★</span>` +
        `<span class="going-btn${GOING.has(e.id) ? ' on' : ''}" data-going="${e.id}" title="going">▶</span>` +
        `<span class="attended-btn${HISTORY.some(h=>h.id===e.id) ? ' done' : ''}" data-attend="${e.id}" title="mark attended">✓</span>` +
        `<span data-cal="${e.id}" title="add to calendar">⤓</span>` +
        `<span data-hide="${e.id}" title="hide">✕</span></td>`;
    frag.appendChild(tr);
  }
  rows.replaceChildren(frag);
  $('#stat-shown').textContent = list.length;
  $('#foot-summary').textContent = `${list.length} shown · ${EVENTS.filter(e => e.date).length} dated · ${EVENTS.filter(e => e.is_underground).length} underground · ${EVENTS.filter(e => e.is_manual).length} manual · ${EVENTS.filter(isNew).length} new since last visit`;
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
  $('#history-export').onclick = exportHistoryCSV;
  $('#btn-share-tonight').onclick = shareTonight;
  $('#btn-export').onclick = () => exportICS(render());
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
  // event delegation for row action icons + artist/promoter clicks
  $('#rows').addEventListener('click', (e) => {
    const t = e.target;
    if (t.dataset.save) { toggle(SAVED, t.dataset.save, 'saved'); render(); }
    else if (t.dataset.going) { toggle(GOING, t.dataset.going, 'radar:going'); render(); }
    else if (t.dataset.attend) { markAttended(t.dataset.attend); }
    else if (t.dataset.hide) { HIDDEN.add(t.dataset.hide); LS.set('hidden', [...HIDDEN]); render(); }
    else if (t.dataset.cal) { const ev = EVENTS.find(x => x.id === t.dataset.cal); if (ev) exportICS([ev]); }
    else if (t.dataset.artist) { showArtistTooltip(t.dataset.artist, t); }
    else if (t.dataset.promoter) { showPromoterPanel(t.dataset.promoter); }
  });
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

async function parseWithAI(rawText) {
  const key = localStorage.getItem('radar:anthropic_key');
  if (!key) return null;
  try {
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': key,
        'anthropic-version': '2023-06-01',
        'anthropic-dangerous-direct-browser-access': 'true',
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-6',
        max_tokens: 1000,
        system: 'You are an event detail extractor for the LA underground electronic music scene.\nExtract event details from pasted flyer text, Instagram captions, Discord messages, SMS drops, or Partiful links.\nReturn ONLY valid JSON, no markdown, no explanation.\nFor uncertain fields, use null. Never guess dates. If no year is clear, assume 2026.\nFor "needs_review", set true if date, venue, or title is uncertain.',
        messages: [{
          role: 'user',
          content: `Extract event details from this text and return JSON:\n\n${rawText}\n\nReturn exactly this shape:\n{\n  "title": "event name or null",\n  "date": "YYYY-MM-DD or null",\n  "time_start": "11pm or null",\n  "time_end": "6am or null",\n  "venue": "venue name or null",\n  "city": "city or null",\n  "price": "$20 or Free or RSVP or null",\n  "age_restriction": "21+ or 18+ or all ages or null",\n  "genres": ["genre1", "genre2"],\n  "artists": ["artist1", "artist2"],\n  "promoter": "promoter name or null",\n  "source_url": "https://... or null",\n  "needs_review": true\n}`
        }]
      })
    });
    if (!response.ok) throw new Error('API error ' + response.status);
    const data = await response.json();
    const text = data.content?.[0]?.text || '';
    return JSON.parse(text.replace(/```json|```/g, '').trim());
  } catch (err) {
    console.warn('AI parse failed, falling back to regex:', err);
    return null;
  }
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
  let parseMethod = 'regex';
  const aiResult = await parseWithAI(text);
  if (aiResult) {
    parseMethod = 'AI';
    MANUAL_PREVIEW = normalizeManualEvent({
      title: aiResult.title,
      date: aiResult.date,
      start_time: aiResult.time_start,
      end_time: aiResult.time_end,
      venue: aiResult.venue,
      city: aiResult.city,
      price: aiResult.price,
      age: aiResult.age_restriction,
      genres: arr(aiResult.genres),
      artists: arr(aiResult.artists),
      promoter: aiResult.promoter,
      source_url: aiResult.source_url,
      needs_review: aiResult.needs_review,
      description: text.slice(0, 600),
    });
  } else {
    MANUAL_PREVIEW = parseManualText(text);
  }
  if (checkNetworkMatch(MANUAL_PREVIEW)) {
    MANUAL_PREVIEW.my_network_match = true;
  }
  fillManualFields(MANUAL_PREVIEW);
  const reviewNote = MANUAL_PREVIEW.needs_review ? ' · needs review' : '';
  const networkNote = MANUAL_PREVIEW.my_network_match ? ' · 🔗 in network' : '';
  setManualStatus(`${parseMethod} parsed${reviewNote}${networkNote}`);
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

/* ---- lazy Leaflet map ---- */
let mapOpen = false, map = null, layer = null, leafletLoading = null;
function currentList() { return sortEvents(EVENTS.filter(matches)); }
function toggleMap() {
  mapOpen = !mapOpen;
  $('#map').style.display = mapOpen ? 'block' : 'none';
  $('#btn-map').classList.toggle('on', mapOpen);
  if (mapOpen) {
    drawMap(currentList());
    ensureLeaflet().then(() => drawMap(currentList()));
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
    if (map) { map.remove(); map = null; layer = null; }
    mapEl.dataset.mode = 'fallback';
    mapEl.innerHTML = '<div class="map-empty">No mapped events in this view.</div>';
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
  if (layer) layer.remove();
  layer = L.layerGroup().addTo(map);
  const bounds = [];
  pts.forEach(e => {
    const lat = Number(e.lat), lng = Number(e.lng);
    const m = L.circleMarker([lat, lng], { radius: 6, color: e.is_underground ? '#c98bff' : (e.is_festival ? '#6fa8ff' : '#3ad06a'), weight: 2, fillOpacity: .75 });
    const link = eventLink(e);
    m.bindPopup(`<b>${esc(e.title)}</b><br>${esc(e.date || '')} ${esc(e.start_time || '')}<br>${esc(e.venue)} — ${esc(e.region)}${link ? `<br><a href="${esc(link)}" target="_blank" rel="noopener noreferrer">tickets/info ↗</a>` : ''}`);
    layer.addLayer(m);
    bounds.push([lat, lng]);
  });
  setTimeout(() => {
    map.invalidateSize();
    if (bounds.length) map.fitBounds(bounds, { padding: [18, 18], maxZoom: 12 });
  }, 50);
}

function drawFallbackMap(pts) {
  const mapEl = $('#map');
  if (map) { map.remove(); map = null; layer = null; }
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
  if (!data.length) { container.innerHTML = '<div style="color:var(--mut);padding:8px">No collective data. Run npm run collect first.</div>'; return; }
  const rows = data.map(c => {
    const next = c.next_event ? `${c.next_event.date} — ${esc(c.next_event.title).slice(0, 40)}` : '—';
    return `<tr><td><span class="clickable-promoter" data-promoter="${esc(c.name)}">${esc(c.name)}</span></td><td>${c.events_this_month}</td><td style="color:var(--mut)">${next}</td><td style="color:var(--mut)">${esc(c.vibe)}</td></tr>`;
  }).join('');
  container.innerHTML = `<table><thead><tr><th>Collective</th><th>This Month</th><th>Next Event</th><th>Vibe</th></tr></thead><tbody>${rows}</tbody></table>`;
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
