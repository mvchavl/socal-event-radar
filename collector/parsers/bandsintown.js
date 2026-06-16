// collector/parsers/bandsintown.js — TIER A. Free app id (BIT_APP_ID env).
// Artist-tour focused: feed it your watchlist of DJs (data/artists.json).
const fs = require('fs');
const path = require('path');
const { httpGet, makeEvent, inferRegion } = require('../util');
async function collect({ appId = process.env.BIT_APP_ID } = {}) {
  if (!appId) { const e = new Error('BIT_APP_ID not set'); e.skip = true; throw e; }
  let artists = [];
  try { artists = JSON.parse(fs.readFileSync(path.join(__dirname, '../../data/artists.json'), 'utf8')); } catch {}
  const events = [];
  for (const name of artists) {
    let j; try { j = await httpGet(`https://rest.bandsintown.com/artists/${encodeURIComponent(name)}/events?app_id=${appId}`, { json: true }); } catch { continue; }
    for (const ev of (Array.isArray(j) ? j : [])) {
      const region = ev.venue?.region || '';
      if (!/CA|California/i.test(region)) continue;
      const city = ev.venue?.city || '';
      events.push(makeEvent({
        title: `${name} @ ${ev.venue?.name || ''}`.trim(),
        artists: [name],
        date: (ev.datetime || '').slice(0, 10) || null,
        venue: ev.venue?.name || '', city, region: inferRegion(city),
        lat: ev.venue?.latitude ? Number(ev.venue.latitude) : null, lng: ev.venue?.longitude ? Number(ev.venue.longitude) : null,
        source_url: ev.url, ticket_url: (ev.offers?.[0]?.url) || ev.url, confidence: 'high',
      }, 'Bandsintown'));
    }
  }
  return events;
}
module.exports = { collect, id: 'bandsintown' };
