// collector/dedupe.js — merge duplicate events across sources.
const { slug } = require('./util');

// fuzzy title key: drop punctuation + common noise words for matching
function titleKey(t) {
  return slug(t).replace(/-(presents|pres|feat|ft|w|with|the|a|an|at|live|night|day|party)-/g, '-').replace(/-+/g, '-');
}

function mergeInto(base, dup) {
  // keep the richer record; union sources, genres, artists
  const seen = new Map();
  [...(base.sources_seen || []), ...(dup.sources_seen || [])].forEach((s) => seen.set(s.name + s.url, s));
  base.sources_seen = [...seen.values()];
  base.genres = [...new Set([...(base.genres || []), ...(dup.genres || [])].map((g) => (g || '').toLowerCase()))];
  base.artists = [...new Set([...(base.artists || []), ...(dup.artists || [])])];
  base.categories = [...new Set([...(base.categories || []), ...(dup.categories || [])])];
  base.vibe_tags = [...new Set([...(base.vibe_tags || []), ...(dup.vibe_tags || [])])];
  // prefer non-empty fields
  for (const k of ['start_time', 'end_time', 'price', 'age', 'promoter', 'address', 'description', 'lat', 'lng', 'ticket_url']) {
    if (!base[k] && dup[k]) base[k] = dup[k];
  }
  // flags: OR them
  for (const k of ['is_underground', 'is_afterhours', 'is_free_rsvp', 'is_festival', 'is_tba_location']) {
    base[k] = base[k] || dup[k];
  }
  // confidence: take the highest
  const rank = { high: 3, medium: 2, low: 1 };
  if ((rank[dup.confidence] || 0) > (rank[base.confidence] || 0)) base.confidence = dup.confidence;
  base.first_seen = base.first_seen < dup.first_seen ? base.first_seen : dup.first_seen;
  base._seen_live = !!(base._seen_live || dup._seen_live);
  base._stale_sources = [...new Set([...(base._stale_sources || []), ...(dup._stale_sources || [])])];
  base._stale_errors = [...new Set([...(base._stale_errors || []), ...(dup._stale_errors || [])])];
  return base;
}

function dedupe(events) {
  const byId = new Map();
  for (const ev of events) {
    // primary: exact id (title|date|venue). secondary: titleKey|date when venue differs/missing
    const k1 = ev.id;
    const k2 = `${titleKey(ev.title)}|${ev.date || ''}`;
    let target = byId.get(k1) || (ev.date ? [...byId.values()].find((e) => `${titleKey(e.title)}|${e.date || ''}` === k2 && e.date === ev.date) : null);
    if (target) { mergeInto(target, ev); }
    else { byId.set(k1, ev); }
  }
  return [...byId.values()];
}

module.exports = { dedupe, titleKey };
