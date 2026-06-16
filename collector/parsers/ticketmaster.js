// collector/parsers/ticketmaster.js — TIER A. Free key (TM_API_KEY env).
// One call covers Ticketmaster + TicketWeb + Universe + FrontGate + TMR. CORS-enabled.
const { httpGet, makeEvent } = require('../util');
// SoCal DMA ids: 324 = Los Angeles, 825 = San Diego, 803 also LA metro. We query LA + SD.
const DMAS = [324, 825];
async function collect({ apiKey = process.env.TM_API_KEY } = {}) {
  if (!apiKey) { const e = new Error('TM_API_KEY not set'); e.skip = true; throw e; }
  const events = [];
  for (const dma of DMAS) {
    for (let page = 0; page < 5; page++) {
      const url = `https://app.ticketmaster.com/discovery/v2/events.json?dmaId=${dma}&classificationName=Dance%2FElectronic&segmentName=Music&size=100&page=${page}&sort=date,asc&apikey=${apiKey}`;
      let j;
      try { j = await httpGet(url, { json: true }); } catch (e) { if (page === 0) throw e; break; }
      const evs = j?._embedded?.events || [];
      if (!evs.length) break;
      for (const ev of evs) {
        const v = ev?._embedded?.venues?.[0] || {};
        const d = ev?.dates?.start || {};
        const loc = v.location || {};
        events.push(makeEvent({
          title: ev.name,
          date: d.localDate || null,
          start_time: d.localTime ? to12(d.localTime) : '',
          venue: v.name || '',
          city: v.city?.name || '',
          region: v.city?.name || '',
          genres: (ev.classifications || []).map((c) => c.genre?.name).filter((x) => x && x !== 'Undefined'),
          price: ev.priceRanges?.[0] ? `$${ev.priceRanges[0].min}-${ev.priceRanges[0].max}` : '',
          source_url: ev.url, ticket_url: ev.url,
          lat: parseFloat(loc.latitude || v.lat || loc.lat) || null,
          lng: parseFloat(loc.longitude || v.lng || loc.lon || v.lon) || null,
          confidence: 'high',
          is_festival: /fest|festival/i.test(ev.name),
        }, 'Ticketmaster'));
      }
      if (evs.length < 100) break;
    }
  }
  return events;
}
function to12(t) { const [h, m] = t.split(':').map(Number); const ap = h >= 12 ? 'pm' : 'am'; const hh = h % 12 || 12; return m ? `${hh}:${String(m).padStart(2,'0')}${ap}` : `${hh}${ap}`; }
module.exports = { collect, id: 'ticketmaster' };
