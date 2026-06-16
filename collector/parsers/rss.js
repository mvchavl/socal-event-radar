// collector/parsers/rss.js — TIER B generic RSS (editorial/newsletter watch).
// Pulls items as low-confidence "intel" entries linking to the source post.
const Parser = require('rss-parser');
const { makeEvent } = require('../util');
const FEEDS = [
  { name: 'Rave New World', url: 'https://ravenewworld.substack.com/feed' },
  // add more WordPress /feed/ or Substack feeds here; they degrade gracefully if down
];
async function collect() {
  const parser = new Parser({ timeout: 20000, headers: { 'User-Agent': 'SoCalEventRadar/1.0' } });
  const events = [];
  for (const f of FEEDS) {
    let feed; try { feed = await parser.parseURL(f.url); } catch { continue; }
    for (const it of (feed.items || []).slice(0, 15)) {
      // editorial items aren't dated events; tag as intel w/ pubDate, no firm event date
      events.push(makeEvent({
        title: it.title || 'Untitled',
        date: null,
        venue: f.name,
        region: 'Los Angeles',
        vibe_tags: ['intel'],
        description: (it.contentSnippet || '').slice(0, 200),
        source_url: it.link, ticket_url: it.link,
        confidence: 'low',
      }, f.name));
    }
  }
  return events;
}
module.exports = { collect, id: 'rss' };
