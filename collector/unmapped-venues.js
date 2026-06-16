// List top unmapped venues to improve data/venues_seed.json by hand.
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const events = JSON.parse(fs.readFileSync(path.join(root, 'public', 'events.json'), 'utf8'));
const limit = Number(process.argv[2]) || 40;
const counts = new Map();

for (const e of events) {
  if (!e || !e.venue || hasCoords(e)) continue;
  const key = cleanVenue(e.venue);
  if (!key || /\b(tba|secret|warehouse|address day|online|various|rave new world)\b/i.test(key)) continue;
  const row = counts.get(key) || { venue: e.venue, count: 0, regions: new Set(), examples: [] };
  row.count += 1;
  if (e.region) row.regions.add(e.region);
  if (row.examples.length < 3 && e.title) row.examples.push(e.title);
  counts.set(key, row);
}

const rows = [...counts.values()].sort((a, b) => b.count - a.count || a.venue.localeCompare(b.venue)).slice(0, limit);
console.log(`Top ${rows.length} unmapped venues from public/events.json`);
console.log('Add coordinates to data/venues_seed.json like: "venue name": [34.0522, -118.2437]');
for (const r of rows) {
  console.log(`${String(r.count).padStart(3)}  ${r.venue}  [${[...r.regions].join(', ') || 'region ?'}]`);
  console.log(`     seed key: "${cleanVenue(r.venue).toLowerCase()}"`);
  if (r.examples.length) console.log(`     ex: ${r.examples.join(' | ')}`);
}

function hasCoords(e) {
  if (e.lat == null || e.lng == null) return false;
  const lat = Number(e.lat), lng = Number(e.lng);
  return Number.isFinite(lat) && Number.isFinite(lng);
}

function cleanVenue(v) {
  return String(v || '').replace(/\s+/g, ' ').trim();
}
