// collector/parsers/seatgeek.js — TIER A. Free client id (SEATGEEK_CLIENT_ID env).
const { httpGet, makeEvent } = require('../util');
async function collect({ clientId = process.env.SEATGEEK_CLIENT_ID } = {}) {
  if (!clientId) { const e = new Error('SEATGEEK_CLIENT_ID not set'); e.skip = true; throw e; }
  const events = [];
  for (const city of ['Los Angeles', 'San Diego']) {
    for (let page = 1; page <= 4; page++) {
      const url = `https://api.seatgeek.com/2/events?venue.city=${encodeURIComponent(city)}&taxonomies.name=concert&type=concert&per_page=100&page=${page}&client_id=${clientId}`;
      let j; try { j = await httpGet(url, { json: true }); } catch (e) { if (page === 1) throw e; break; }
      const evs = j?.events || [];
      if (!evs.length) break;
      for (const ev of evs) {
        events.push(makeEvent({
          title: ev.short_title || ev.title,
          artists: (ev.performers || []).map((p) => p.name),
          date: (ev.datetime_local || '').slice(0, 10) || null,
          venue: ev.venue?.name || '', city: ev.venue?.city || '', region: ev.venue?.city || '',
          lat: ev.venue?.location?.lat ?? null, lng: ev.venue?.location?.lon ?? null,
          price: ev.stats?.lowest_price ? `from $${ev.stats.lowest_price}` : '',
          source_url: ev.url, ticket_url: ev.url, confidence: 'high',
        }, 'SeatGeek'));
      }
      if (evs.length < 100) break;
    }
  }
  return events;
}
module.exports = { collect, id: 'seatgeek' };
