// collector/parsers/reddit.js — TIER B/D. r/avesLA public JSON.
// NOTE: Reddit blocks datacenter IPs (403) — runs fine from residential/CI with OAuth.
// Left functional; marked degraded if it 403s. Set REDDIT_UA for a descriptive UA.
const { httpGet, makeEvent } = require('../util');
async function collect() {
  const ua = process.env.REDDIT_UA || 'SoCalEventRadar/1.0 (personal use)';
  let j;
  try { j = await httpGet('https://www.reddit.com/r/avesLA/new.json?limit=25', { json: true, headers: { 'User-Agent': ua } }); }
  catch (e) { const err = new Error('reddit blocked (403 from datacenter IPs is expected)'); err.degraded = true; throw err; }
  const events = [];
  for (const c of (j?.data?.children || [])) {
    const p = c.data;
    events.push(makeEvent({
      title: p.title, date: null, venue: 'r/avesLA', region: 'Los Angeles',
      vibe_tags: ['community'], source_url: `https://reddit.com${p.permalink}`, ticket_url: `https://reddit.com${p.permalink}`,
      confidence: 'low',
    }, 'r/avesLA'));
  }
  return events;
}
module.exports = { collect, id: 'reddit' };
