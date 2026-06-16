// collector/collect.js — orchestrator. Runs all parsers, never aborts on one failure,
// preserves first_seen across runs, applies venue coords, dedupes, writes public/*.json.
const fs = require('fs');
const path = require('path');
const yaml = require('js-yaml');
const { dedupe } = require('./dedupe');
const { slug, dateInTimeZone } = require('./util');
const { loadSceneGraph, buildScorer } = require('./scoring');
const { generateTonightHTML } = require('./digest');

const PUB = path.join(__dirname, '..', 'public');

const FESTIVALS = loadJSON(path.join(__dirname, '..', 'data', 'festivals.json')) || [];

// Load venue seed (object { "normalized name": [lat, lng] } or array of {name, lat, lng})
let venues = loadJSON(path.join(__dirname, '..', 'data', 'venues_seed.json')) || {};
if (Array.isArray(venues)) {
  const m = {};
  for (const v of venues) {
    if (v && v.name && (v.lat != null || v.latitude != null)) {
      const lat = v.lat ?? v.latitude;
      const lng = v.lng ?? v.lon ?? v.longitude;
      m[String(v.name).toLowerCase().trim()] = [Number(lat), Number(lng)];
    }
  }
  venues = m;
}

// Also try public/venues.json as fallback (written by previous collect)
if (Object.keys(venues).length === 0) {
  const pubVenues = loadJSON(path.join(PUB, 'venues.json'));
  if (pubVenues && !Array.isArray(pubVenues)) venues = pubVenues;
}

// Build a rich lookup map for fuzzy venue matching
const venueCoordMap = buildVenueCoordMap(venues);

function buildVenueCoordMap(seed) {
  const map = new Map();
  for (const [k, coords] of Object.entries(seed || {})) {
    if (!coords || coords.length < 2) continue;
    const lat = Number(coords[0]), lng = Number(coords[1]);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) continue;

    const variants = [
      k.toLowerCase().trim(),
      k.toLowerCase().replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim(),
      slug(k).replace(/-/g, ' ')
    ];
    for (const v of variants) {
      if (v) map.set(v, [lat, lng]);
    }
    // Also index without common prefixes/suffixes
    const cleaned = k.toLowerCase().replace(/^(the |la |los angeles )/, '').replace(/ (la|nightclub|auditorium|theatre|theater|ballroom|lounge)$/i, '').trim();
    if (cleaned && cleaned !== k.toLowerCase()) map.set(cleaned, [lat, lng]);
  }
  return map;
}

function lookupCoords(venueName) {
  if (!venueName) return null;
  const key = String(venueName).toLowerCase().trim();
  if (venueCoordMap.has(key)) return venueCoordMap.get(key);

  const slugged = slug(venueName).replace(/-/g, ' ');
  if (venueCoordMap.has(slugged)) return venueCoordMap.get(slugged);

  // partial / contains fallback for common cases
  for (const [k, c] of venueCoordMap.entries()) {
    if (key.includes(k) || k.includes(key)) return c;
    const kclean = k.replace(/[^a-z0-9]/g, '');
    const vclean = key.replace(/[^a-z0-9]/g, '');
    if (kclean && vclean && (kclean.includes(vclean) || vclean.includes(kclean))) return c;
  }
  return null;
}

// registry of parsers + metadata for the source dashboard
const PARSERS = [
  { mod: './parsers/_19hz', name: '19hz', tier: 'B', type: 'html', region: 'SoCal', note: 'Backbone. Static HTML table.' },
  { mod: './parsers/ra', name: 'Resident Advisor', tier: 'C', type: 'graphql', region: 'LA', note: 'Underground/techno; auto-captures most collectives.' },
  { mod: './parsers/ticketmaster', name: 'Ticketmaster', tier: 'A', type: 'api', region: 'SoCal', note: 'Free key. + TicketWeb/Universe/FrontGate.' },
  { mod: './parsers/seatgeek', name: 'SeatGeek', tier: 'A', type: 'api', region: 'SoCal', note: 'Free key. Concerts by city.' },
  { mod: './parsers/bandsintown', name: 'Bandsintown', tier: 'A', type: 'api', region: 'SoCal', note: 'Free key. Artist watchlist tours.' },
  { mod: './parsers/edmcal', name: 'EDM Calendars', tier: 'B', type: 'html', region: 'SoCal', note: 'Festival calendars (best-effort).' },
  { mod: './parsers/rss', name: 'Editorial RSS', tier: 'B', type: 'rss', region: 'LA', note: 'Rave New World + feeds (intel).' },
  { mod: './parsers/tixr', name: 'Tixr', tier: 'C', type: 'spa', region: 'SoCal', note: 'Exchange/Academy/Avalon. 403s datacenter IPs.' },
  { mod: './parsers/reddit', name: 'r/avesLA', tier: 'B', type: 'rss', region: 'SoCal', note: 'Reddit blocks datacenter IPs; runs from residential/CI.' },
  { mod: './parsers/manual', name: 'Manual', tier: 'D', type: 'manual', region: 'SoCal', note: 'Your hand-entered IG/Discord/SMS drops.' },

  // NEW general + non-music sources (full spectrum)
  { mod: './parsers/eventbrite', name: 'Eventbrite', tier: 'C', type: 'html', region: 'SoCal', note: 'Workshops, pop-ups, networking, art, markets, community, free RSVPs.' },
  { mod: './parsers/luma', name: 'lu.ma', tier: 'C', type: 'html', region: 'LA', note: 'Tech, startup, creative, professional, social mixers (high signal for career + people).' },
  { mod: './parsers/library', name: 'Libraries', tier: 'B', type: 'html', region: 'SoCal', note: 'LA County Library + LAPL — wholesome, free workshops, talks, community events.' },
  { mod: './parsers/partiful', name: 'Partiful', tier: 'C', type: 'html', region: 'SoCal', note: 'Public Partiful pages only. Re-checks manual Partiful URLs.' },
  { mod: './parsers/dice', name: 'DICE', tier: 'C', type: 'html', region: 'SoCal', note: 'LA electronic/underground events on DICE.' },
];

function loadJSON(p) { try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch { return null; } }

function loadSourceRegistry(activeNames) {
  const p = path.join(__dirname, '..', 'sources.yaml');
  let doc;
  try { doc = yaml.load(fs.readFileSync(p, 'utf8')); } catch { return []; }
  const seen = new Set([...activeNames].map((n) => String(n).toLowerCase()));
  const planned = [];

  function addSource(raw, section) {
    let item = raw;
    if (typeof item === 'string') item = { name: item, note: '' };
    if (!item || typeof item !== 'object') return;
    const rawName = String(item.name || item.url || '').trim();
    if (!rawName) return;
    const name = rawName.replace(/\s*\([^)]*\)\s*$/, '').trim();
    if (!name || name.length > 120) return;
    const key = name.toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    planned.push({
      name,
      tier: item.tier || '',
      type: item.type || '',
      region: item.region || '',
      url: item.url || '',
      status: registryStatus(item, section),
      note: item.note || section || '',
      section,
      active: false,
    });
  }

  function walk(node, section = '') {
    if (Array.isArray(node)) {
      for (const item of node) {
        if (typeof item === 'string') addSource({ name: item }, section);
        else if (item && typeof item === 'object' && (item.name || item.url)) addSource(item, section);
        else walk(item, section);
      }
      return;
    }
    if (!node || typeof node !== 'object') return;
    if (node.name || node.url) { addSource(node, section); return; }
    for (const [key, value] of Object.entries(node)) {
      if (key === 'active_parsers' || key === 'note') continue;
      walk(value, section ? `${section}.${key}` : key);
    }
  }

  walk(doc);
  return planned;
}

function registryStatus(item, section = '') {
  const s = `${item.status || ''} ${item.type || ''} ${item.tier || ''} ${item.note || ''} ${section}`.toLowerCase();
  if (/\b(watch|manual|social|instagram|discord|telegram|whatsapp|underground_watchlist)\b/.test(s)) return 'manual';
  if (/\b(best-effort|best_effort|degraded|spa|reverse-engineer|blocks|scrape|parser)\b/.test(s) || item.tier === 'C') return 'best_effort';
  return 'planned';
}

function applyCoords(ev) {
  // 1. Preserve anything the parser already provided (SeatGeek, Ticketmaster, future parsers, or previous run data)
  let lat = ev.lat != null ? Number(ev.lat) : null;
  let lng = ev.lng != null ? Number(ev.lng) : null;

  if (Number.isFinite(lat) && Number.isFinite(lng)) {
    ev.lat = lat;
    ev.lng = lng;
    return ev;
  }

  // 2. Try direct lookup with improved fuzzy matching against the seed
  const c = lookupCoords(ev.venue);
  if (c) {
    ev.lat = c[0];
    ev.lng = c[1];
  }

  return ev;
}

async function main() {
  const prev = loadJSON(path.join(PUB, 'events.json')) || [];
  const prevById = new Map(prev.map((e) => [e.id, e]));
  const sourceHealth = [];
  let all = [];

  for (const p of PARSERS) {
    const meta = { name: p.name, tier: p.tier, type: p.type, region: p.region, note: p.note, last_checked: new Date().toISOString() };
    try {
      const mod = require(p.mod);
      const evs = await mod.collect();
      for (const ev of evs) ev._seen_live = true;
      all = all.concat(evs);
      meta.status = evs.length ? 'ok' : 'empty';
      meta.count = evs.length;
    } catch (e) {
      meta.status = e.skip ? 'needs_key' : (e.degraded ? 'degraded' : 'error');
      meta.count = 0;
      meta.error = e.message;
      // keep previous events from this source so a transient failure doesn't drop data
      const kept = prev
        .filter((ev) => (ev.sources_seen || []).some((s) => s.name === p.name))
        .map((ev) => ({
          ...ev,
          _seen_live: false,
          _stale_sources: [p.name],
          _stale_errors: [e.message],
          status: 'source_stale',
          stale_sources: [...new Set([...(ev.stale_sources || []), p.name])],
          stale_reason: e.message,
          stale_since: ev.stale_since || meta.last_checked,
        }));
      all = all.concat(kept);
    }
    sourceHealth.push(meta);
    process.stdout.write(`  ${p.name}: ${meta.status} (${meta.count})\n`);
  }

  // dedupe + merge, apply coords, preserve first_seen from prior runs, recompute timestamps
  const today = dateInTimeZone();
  let merged = dedupe(all)
    .filter((ev) => !ev.date || ev.date >= today) // forward-looking; keep undated intel
    .map(applyCoords);
  const nowISO = new Date().toISOString();
  merged = merged.map((ev) => {
    const old = prevById.get(ev.id);
    if (old) ev.first_seen = old.first_seen || ev.first_seen;
    if (ev._seen_live) {
      ev.status = 'active';
      ev.last_seen = nowISO;
      delete ev.stale_sources;
      delete ev.stale_reason;
      delete ev.stale_since;
    } else if (ev._stale_sources && ev._stale_sources.length) {
      ev.status = 'source_stale';
      ev.last_seen = old?.last_seen || ev.last_seen || ev.first_seen;
      ev.stale_sources = [...new Set([...(old?.stale_sources || []), ...ev._stale_sources])];
      ev.stale_reason = ev._stale_errors?.join('; ') || old?.stale_reason || 'source failed';
      ev.stale_since = old?.stale_since || nowISO;
    }
    delete ev._seen_live;
    delete ev._stale_sources;
    delete ev._stale_errors;
    return ev;
  });

  // mark events that vanished (were in prev, not in this run) as possibly_removed/stale
  const liveIds = new Set(merged.map((e) => e.id));
  for (const old of prev) {
    if (!liveIds.has(old.id)) {
      const ageDays = (Date.now() - new Date(old.last_seen || old.first_seen).getTime()) / 86400000;
      if (ageDays < 4 && old.date && old.date >= today) {
        old.status = ageDays < 1 ? 'possibly_removed' : 'stale';
        merged.push(old); // keep recent vanished future events briefly
      }
    }
  }

  // score events with scene graph data
  const scene = loadSceneGraph();
  const scorer = buildScorer(scene);
  for (const ev of merged) {
    const { for_you_score, my_network_match } = scorer(ev, today);
    ev.for_you_score = for_you_score;
    ev.my_network_match = my_network_match;
  }
  const networkCount = merged.filter(e => e.my_network_match).length;
  console.log(`  scoring: ${networkCount} my-network events, scene_graph ${scene ? 'loaded' : 'missing'}`);

  // Phase 6C: match events against known festivals
  let festivalMatches = 0;
  for (const ev of merged) {
    const blob = `${ev.title || ''} ${(ev.artists || []).join(' ')} ${ev.description || ''}`.toLowerCase();
    for (const fest of FESTIVALS) {
      const festLower = fest.name.toLowerCase();
      if (blob.includes(festLower) || (fest.dates && fest.dates.includes(ev.date))) {
        ev.is_festival = true;
        ev.festival_name = fest.name;
        ev.festival_url = fest.url;
        if (fest.dates && fest.dates.includes(ev.date)) ev.festival_dates = fest.dates;
        festivalMatches++;
        break;
      }
    }
  }
  if (festivalMatches) console.log(`  festivals: ${festivalMatches} events matched to known festivals`);

  // sort soonest-first (undated/intel last)
  merged.sort((a, b) => {
    if (!a.date && !b.date) return 0;
    if (!a.date) return 1;
    if (!b.date) return -1;
    return a.date.localeCompare(b.date) || (a.start_time || '').localeCompare(b.start_time || '');
  });

  fs.mkdirSync(PUB, { recursive: true });
  const registrySources = loadSourceRegistry(new Set(PARSERS.map((p) => p.name)));
  const sourcesOut = [
    ...sourceHealth.map((s) => ({ ...s, active: true })),
    ...registrySources,
  ];
  fs.writeFileSync(path.join(PUB, 'events.json'), JSON.stringify(merged));
  fs.writeFileSync(path.join(PUB, 'sources.json'), JSON.stringify(sourcesOut, null, 2));
  fs.writeFileSync(path.join(PUB, 'venues.json'), JSON.stringify(venues));
  fs.writeFileSync(path.join(PUB, 'last_updated.json'), JSON.stringify({
    updated_at: nowISO,
    event_count: merged.length,
    sources_total: sourceHealth.length,
    sources_registered: sourcesOut.length,
    sources_ok: sourceHealth.filter((s) => s.status === 'ok').length,
    dated: merged.filter((e) => e.date).length,
    underground: merged.filter((e) => e.is_underground).length,
  }));

  generateTonightHTML(merged);

  // Phase 5B: artist co-occurrence
  const cooccurrence = buildCooccurrence(merged);
  fs.writeFileSync(path.join(PUB, 'cooccurrence.json'), JSON.stringify(cooccurrence));

  // Phase 5A/5C: scene intelligence (collective activity + venue heat)
  const sceneIntel = buildSceneIntel(merged, scene, today);
  fs.writeFileSync(path.join(PUB, 'scene_intel.json'), JSON.stringify(sceneIntel));
  console.log(`  scene_intel: ${sceneIntel.collectives.length} collectives, ${sceneIntel.venues.length} venues, ${Object.keys(cooccurrence).length} artists in co-occurrence`);

  console.log(`\nDONE: ${merged.length} events (${merged.filter((e) => e.date).length} dated) from ${sourceHealth.filter((s) => s.status === 'ok').length}/${sourceHealth.length} live sources.`);
}

function buildCooccurrence(events) {
  const co = {};
  for (const ev of events) {
    const artists = (ev.artists || []).map(a => a.trim()).filter(Boolean);
    if (artists.length < 2) continue;
    for (let i = 0; i < artists.length; i++) {
      for (let j = i + 1; j < artists.length; j++) {
        const a = artists[i], b = artists[j];
        if (!co[a]) co[a] = {};
        if (!co[b]) co[b] = {};
        co[a][b] = (co[a][b] || 0) + 1;
        co[b][a] = (co[b][a] || 0) + 1;
      }
    }
  }
  return co;
}

function buildSceneIntel(events, scene, today) {
  const collectives = (scene?.collectives_i_follow || []);
  const monthEnd = new Date(today + 'T12:00:00');
  monthEnd.setDate(monthEnd.getDate() + 30);
  const monthEndStr = monthEnd.toISOString().slice(0, 10);

  const collectiveData = collectives.map(name => {
    const lower = name.toLowerCase();
    const matched = events.filter(ev => {
      const blob = `${ev.title || ''} ${(ev.artists || []).join(' ')} ${ev.promoter || ''} ${ev.description || ''}`.toLowerCase();
      return blob.includes(lower);
    });
    const upcoming = matched.filter(e => e.date && e.date >= today && e.date <= monthEndStr)
      .sort((a, b) => a.date.localeCompare(b.date));
    const genres = {};
    for (const ev of matched) for (const g of (ev.genres || [])) genres[g] = (genres[g] || 0) + 1;
    const topGenres = Object.entries(genres).sort((a, b) => b[1] - a[1]).slice(0, 3).map(([g]) => g);
    return {
      name,
      events_this_month: upcoming.length,
      next_event: upcoming[0] ? { date: upcoming[0].date, title: upcoming[0].title } : null,
      vibe: topGenres.join(', ') || 'unknown',
      total_events: matched.length,
    };
  }).sort((a, b) => b.events_this_month - a.events_this_month || b.total_events - a.total_events);

  const myVenues = (scene?.my_venues || []);
  const venueData = myVenues.map(v => {
    const lower = v.name.toLowerCase();
    const matched = events.filter(ev => (ev.venue || '').toLowerCase().includes(lower) || lower.includes((ev.venue || '').toLowerCase()));
    const upcoming = matched.filter(e => e.date && e.date >= today && e.date <= monthEndStr);
    const genres = {};
    const promoters = {};
    for (const ev of matched) {
      for (const g of (ev.genres || [])) genres[g] = (genres[g] || 0) + 1;
      if (ev.promoter) promoters[ev.promoter] = (promoters[ev.promoter] || 0) + 1;
    }
    return {
      name: v.name,
      neighborhood: v.neighborhood,
      vibe: v.vibe,
      events_this_month: upcoming.length,
      total_events: matched.length,
      top_genres: Object.entries(genres).sort((a, b) => b[1] - a[1]).slice(0, 3).map(([g]) => g),
      top_promoters: Object.entries(promoters).sort((a, b) => b[1] - a[1]).slice(0, 3).map(([p]) => p),
      has_upcoming: upcoming.length > 0,
    };
  }).sort((a, b) => b.events_this_month - a.events_this_month || b.total_events - a.total_events);

  return { collectives: collectiveData, venues: venueData, generated: new Date().toISOString() };
}

main().catch((e) => { console.error('FATAL', e); process.exit(1); });
