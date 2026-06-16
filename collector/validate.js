// Strong validation for generated public data and JS syntax.
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const yaml = require('js-yaml');

const ROOT = path.join(__dirname, '..');
const PUB = path.join(ROOT, 'public');
const errors = [];
const warnings = [];

function readJSON(rel) {
  try { return JSON.parse(fs.readFileSync(path.join(ROOT, rel), 'utf8')); }
  catch (e) { errors.push(`${rel}: ${e.message}`); return null; }
}

function fail(msg) { errors.push(msg); }
function warn(msg) { warnings.push(msg); }
function isObj(v) { return v && typeof v === 'object' && !Array.isArray(v); }
function isHttpUrl(v) {
  if (!v) return true;
  try {
    const u = new URL(String(v));
    return u.protocol === 'http:' || u.protocol === 'https:';
  } catch { return false; }
}
function validISODate(v) {
  if (v == null) return true;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(v))) return false;
  const d = new Date(`${v}T12:00:00`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === v;
}
function hasFiniteCoords(e) {
  if (e.lat == null && e.lng == null) return false;
  if (e.lat == null || e.lng == null) return false;
  const lat = Number(e.lat), lng = Number(e.lng);
  return Number.isFinite(lat) && Number.isFinite(lng);
}

const events = readJSON('public/events.json') || [];
const sources = readJSON('public/sources.json') || [];
const meta = readJSON('public/last_updated.json') || {};

if (!Array.isArray(events)) fail('public/events.json must be an array');
if (Array.isArray(events) && events.length < 50) fail(`event count too low: ${events.length}`);
if (meta.event_count != null && meta.event_count !== events.length) fail(`last_updated event_count ${meta.event_count} does not match events ${events.length}`);

const ids = new Set();
let dated = 0, coordCount = 0;
const allowedConfidence = new Set(['high', 'medium', 'low']);
const requiredArrays = ['artists', 'genres', 'vibe_tags', 'categories', 'sources_seen'];

events.forEach((e, i) => {
  const where = `event[${i}] ${e && e.id ? e.id : '(no id)'}`;
  if (!isObj(e)) { fail(`${where}: must be an object`); return; }
  if (!e.id) fail(`${where}: missing id`);
  else if (ids.has(e.id)) fail(`${where}: duplicate id`);
  else ids.add(e.id);
  if (!e.title) fail(`${where}: missing title`);
  if (!validISODate(e.date)) fail(`${where}: invalid date ${e.date}`);
  if (e.date) dated++;
  for (const k of requiredArrays) if (!Array.isArray(e[k])) fail(`${where}: ${k} must be an array`);
  if (!allowedConfidence.has(e.confidence)) fail(`${where}: invalid confidence ${e.confidence}`);
  if (!isHttpUrl(e.source_url)) fail(`${where}: source_url must be http/https or empty`);
  if (!isHttpUrl(e.ticket_url)) fail(`${where}: ticket_url must be http/https or empty`);
  for (const [j, s] of (Array.isArray(e.sources_seen) ? e.sources_seen : []).entries()) {
    if (!s || !s.name) fail(`${where}: sources_seen[${j}] missing name`);
    if (s && !isHttpUrl(s.url)) fail(`${where}: sources_seen[${j}].url must be http/https or empty`);
  }
  const oneCoordMissing = (e.lat == null) !== (e.lng == null);
  if (oneCoordMissing) fail(`${where}: lat/lng must both be present or both be null`);
  if (e.lat != null || e.lng != null) {
    if (!hasFiniteCoords(e)) fail(`${where}: invalid lat/lng ${e.lat}, ${e.lng}`);
    else {
      const lat = Number(e.lat), lng = Number(e.lng);
      if (lat < -90 || lat > 90 || lng < -180 || lng > 180) fail(`${where}: out-of-range lat/lng ${lat}, ${lng}`);
      else coordCount++;
    }
  }
});

if (!Array.isArray(sources)) fail('public/sources.json must be an array');
const allowedStatuses = new Set(['ok', 'empty', 'needs_key', 'degraded', 'error', 'planned', 'best_effort', 'manual']);
let activeSourceCount = 0, okSourceCount = 0;
sources.forEach((s, i) => {
  const where = `source[${i}] ${s && s.name ? s.name : '(no name)'}`;
  if (!isObj(s)) { fail(`${where}: must be an object`); return; }
  if (!s.name) fail(`${where}: missing name`);
  if (!allowedStatuses.has(s.status)) fail(`${where}: invalid status ${s.status}`);
  if (s.active !== false) {
    activeSourceCount++;
    if (s.status === 'ok') okSourceCount++;
  }
  if (s.url && !isHttpUrl(s.url) && !String(s.url).startsWith('data/')) warn(`${where}: registry url is not http/https: ${s.url}`);
});
if (activeSourceCount < 1) fail('source health has no active sources');
if (okSourceCount < 1) fail('source health has no ok active source');
if (meta.sources_total != null && meta.sources_total !== activeSourceCount) fail(`last_updated sources_total ${meta.sources_total} does not match active source count ${activeSourceCount}`);

try { yaml.load(fs.readFileSync(path.join(ROOT, 'sources.yaml'), 'utf8')); }
catch (e) { fail(`sources.yaml: ${e.message}`); }

const jsFiles = listFiles(ROOT).filter((f) => f.endsWith('.js') && !f.includes(`${path.sep}node_modules${path.sep}`));
for (const file of jsFiles) {
  try { new vm.Script(fs.readFileSync(file, 'utf8'), { filename: file }); }
  catch (e) { fail(`${path.relative(ROOT, file)}: JS syntax check failed\n${String(e.message).trim()}`); }
}

// Phase 11A: scene intelligence checks
const scoredCount = events.filter(e => e.for_you_score != null).length;
const scorePct = events.length ? Math.round(100 * scoredCount / events.length) : 0;
if (scorePct < 80) warn(`only ${scorePct}% of events have for_you_score (expected >= 80%)`);

const networkCount = events.filter(e => e.my_network_match).length;
if (networkCount < 5) warn(`only ${networkCount} events have my_network_match (expected >= 5)`);

const tonightPath = path.join(PUB, 'tonight.html');
if (!fs.existsSync(tonightPath)) fail('public/tonight.html not found — run collect');

const cooccurrencePath = path.join(PUB, 'cooccurrence.json');
if (!fs.existsSync(cooccurrencePath)) fail('public/cooccurrence.json not found — run collect');
else {
  try {
    const co = JSON.parse(fs.readFileSync(cooccurrencePath, 'utf8'));
    if (Object.keys(co).length === 0) warn('cooccurrence.json is empty');
  } catch (e) { fail(`cooccurrence.json: ${e.message}`); }
}

const sceneIntelPath = path.join(PUB, 'scene_intel.json');
if (!fs.existsSync(sceneIntelPath)) warn('public/scene_intel.json not found — run collect');

console.log(`events ${events.length}`);
console.log(`dated ${dated}`);
console.log(`coords ${coordCount}`);
console.log(`scored ${scoredCount} (${scorePct}%)`);
console.log(`my network events ${networkCount}`);
console.log(`sources active ${activeSourceCount}, registered ${Array.isArray(sources) ? sources.length : 0}, ok ${okSourceCount}`);
console.log(`js syntax files ${jsFiles.length}`);
console.log(`tonight.html ${fs.existsSync(tonightPath) ? 'exists' : 'MISSING'}`);
console.log(`cooccurrence.json ${fs.existsSync(cooccurrencePath) ? 'exists' : 'MISSING'}`);
if (warnings.length) console.warn(`warnings:\n- ${warnings.join('\n- ')}`);
if (errors.length) {
  console.error(`valid: false\n- ${errors.join('\n- ')}`);
  process.exit(1);
}
console.log('valid: true');

function listFiles(dir) {
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === 'node_modules') continue;
    const p = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...listFiles(p));
    else out.push(p);
  }
  return out;
}
