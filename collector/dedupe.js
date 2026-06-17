// collector/dedupe.js — merge duplicate events across sources.
const { slug } = require('./util');

function normalizeTitleForDedupe(t) {
  return (t || '').toString()
    .replace(/\([^)]*\)/g, ' ')
    .replace(/^the\s+/i, '')
    .replace(/\s+/g, ' ')
    .trim();
}

// fuzzy title key: drop punctuation + common noise words for matching
function titleKey(t) {
  const base = slug(normalizeTitleForDedupe(t));
  return base
    .replace(/-(presents|pres|feat|ft|w|with|the|a|an|at|live|night|day|party)-/g, '-')
    .replace(/-+/g, '-')
    .replace(/(^-|-$)/g, '');
}

function venueKey(v) {
  return slug(v)
    .replace(/^(the|at)-/, '')
    .replace(/-(los|angeles|la|ca|usa)-/g, '-')
    .replace(/-+/g, '-')
    .replace(/(^-|-$)/g, '');
}

function regionKey(ev) {
  return slug(ev.city || ev.region || '');
}

function isFuzzyDup(a, b) {
  if (!a.date || a.date !== b.date) return false;
  const ta = titleKey(a.title);
  const tb = titleKey(b.title);
  if (!ta || !tb) return false;
  if (ta === tb) return true;
  const shorter = ta.length <= tb.length ? ta : tb;
  const longer = ta.length <= tb.length ? tb : ta;
  if (shorter.length < 6 || longer.length < 8) return false;
  if (!longer.includes(shorter)) return false;
  const va = venueKey(a.venue);
  const vb = venueKey(b.venue);
  const ra = regionKey(a);
  const rb = regionKey(b);
  if (ra && rb && ra !== rb) return false;
  if (!va || !vb) return true;
  return va === vb || va.includes(vb) || vb.includes(va);
}

function mergeInto(base, dup) {
  const seen = new Map();
  [...(base.sources_seen || []), ...(dup.sources_seen || [])].forEach((s) => seen.set(s.name + s.url, s));
  base.sources_seen = [...seen.values()];
  base.genres = [...new Set([...(base.genres || []), ...(dup.genres || [])].map((g) => (g || '').toLowerCase()))];
  base.artists = [...new Set([...(base.artists || []), ...(dup.artists || [])])];
  base.categories = [...new Set([...(base.categories || []), ...(dup.categories || [])])];
  base.vibe_tags = [...new Set([...(base.vibe_tags || []), ...(dup.vibe_tags || [])])];
  for (const k of ['start_time', 'end_time', 'price', 'age', 'promoter', 'address', 'description', 'lat', 'lng', 'ticket_url']) {
    if (!base[k] && dup[k]) base[k] = dup[k];
  }
  for (const k of ['is_underground', 'is_afterhours', 'is_free_rsvp', 'is_festival', 'is_tba_location']) {
    base[k] = base[k] || dup[k];
  }
  const rank = { high: 3, medium: 2, low: 1 };
  if ((rank[dup.confidence] || 0) > (rank[base.confidence] || 0)) base.confidence = dup.confidence;
  if (!base.venue && dup.venue) base.venue = dup.venue;
  if (!base.city && dup.city) base.city = dup.city;
  base.first_seen = base.first_seen < dup.first_seen ? base.first_seen : dup.first_seen;
  base._seen_live = !!(base._seen_live || dup._seen_live);
  base._stale_sources = [...new Set([...(base._stale_sources || []), ...(dup._stale_sources || [])])];
  base._stale_errors = [...new Set([...(base._stale_errors || []), ...(dup._stale_errors || [])])];
  return base;
}

function findDuplicate(byId, ev) {
  const k1 = ev.id;
  if (byId.has(k1)) return byId.get(k1);
  const k2 = `${titleKey(ev.title)}|${ev.date || ''}`;
  for (const existing of byId.values()) {
    if (`${titleKey(existing.title)}|${existing.date || ''}` === k2 && existing.date === ev.date) return existing;
    if (isFuzzyDup(existing, ev)) return existing;
  }
  return null;
}

function dedupe(events) {
  const byId = new Map();
  for (const ev of events) {
    const target = findDuplicate(byId, ev);
    if (target) mergeInto(target, ev);
    else byId.set(ev.id, ev);
  }
  return [...byId.values()];
}

module.exports = { dedupe, titleKey, venueKey };