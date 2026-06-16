// collector/parsers/tixr.js — TIER C best-effort. Per-group endpoints.
// Powers Exchange LA, Academy, Avalon, Time Nightclub, Day Trip, Nova SD.
// Tixr 403s datacenter IPs; works behind a residential proxy or w/ a session. Degrades gracefully.
const { httpGet, makeEvent, inferRegion } = require('../util');
const GROUPS = ['exchangela', 'academy', 'avalonhollywood', 'timenightclub', 'novasd', 'daytrip'];
async function collect() {
  const events = [];
  let anyOk = false;
  for (const g of GROUPS) {
    let j;
    try { j = await httpGet(`https://www.tixr.com/api/groups/${g}/events`, { json: true }); anyOk = true; }
    catch { continue; }
    const list = Array.isArray(j) ? j : (j.events || []);
    for (const ev of list) {
      events.push(makeEvent({
        title: ev.name || ev.title, date: (ev.start_date || ev.startDate || '').slice(0, 10) || null,
        venue: ev.venue?.name || g, region: inferRegion(ev.venue?.city || ''),
        source_url: ev.url || `https://www.tixr.com/groups/${g}`, ticket_url: ev.url || '',
        confidence: 'medium',
      }, 'Tixr'));
    }
  }
  if (!anyOk) { const e = new Error('tixr blocked (403) — best-effort source'); e.degraded = true; throw e; }
  return events;
}
module.exports = { collect, id: 'tixr' };
