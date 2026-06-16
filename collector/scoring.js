const fs = require('fs');
const path = require('path');

function loadSceneGraph() {
  const p = path.join(__dirname, '..', 'data', 'scene_graph.json');
  try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch { return null; }
}

function buildScorer(scene) {
  if (!scene) return (ev) => ({ for_you_score: 0, my_network_match: false });

  const connectionHandles = new Map();
  for (const c of scene.my_connections || []) {
    for (const h of c.handles || []) {
      connectionHandles.set(h.toLowerCase(), c.tier);
    }
  }

  const collectives = new Set((scene.collectives_i_follow || []).map(s => s.toLowerCase()));
  const artistsFollowed = new Set((scene.artists_i_follow || []).map(s => s.toLowerCase()));
  const venueNames = new Set((scene.my_venues || []).map(v => v.name.toLowerCase()));
  const tasteGenres = new Set((scene.my_taste?.genres || []).map(g => g.toLowerCase()));
  const antiVibe = (scene.my_taste?.anti_vibe || []).map(s => s.toLowerCase());

  return function scoreEvent(ev, today) {
    let score = 0;
    let networkMatch = false;

    const blob = `${ev.title || ''} ${(ev.artists || []).join(' ')} ${ev.promoter || ''} ${(ev.genres || []).join(' ')} ${ev.description || ''}`.toLowerCase();
    const artistsLower = (ev.artists || []).map(a => a.toLowerCase());
    const promoterLower = (ev.promoter || '').toLowerCase();
    const venueLower = (ev.venue || '').toLowerCase();

    for (const a of artistsLower) {
      for (const [handle, tier] of connectionHandles) {
        if (a.includes(handle) || handle.includes(a)) {
          score += tier === 1 ? 40 : 25;
          networkMatch = true;
          break;
        }
      }
    }

    if (promoterLower) {
      for (const [handle, tier] of connectionHandles) {
        if (promoterLower.includes(handle)) {
          score += tier === 1 ? 40 : 25;
          networkMatch = true;
          break;
        }
      }
    }

    for (const c of collectives) {
      if (blob.includes(c)) {
        score += 35;
        networkMatch = true;
        break;
      }
    }

    for (const v of venueNames) {
      if (venueLower && (venueLower.includes(v) || v.includes(venueLower))) {
        score += 20;
        break;
      }
    }

    for (const a of artistsLower) {
      for (const af of artistsFollowed) {
        if (a.includes(af) || af.includes(a)) {
          score += 15;
          break;
        }
      }
    }

    let genreHits = 0;
    for (const g of (ev.genres || [])) {
      if (tasteGenres.has(g.toLowerCase())) {
        genreHits++;
      }
    }
    score += Math.min(genreHits * 20, 60);

    if (ev.is_underground) score += 10;
    if (ev.is_afterhours) score += 10;
    if (ev.is_tba_location) score += 8;
    if (ev.confidence === 'high') score += 8;
    if (ev.is_free_rsvp) score += 5;

    let hasAntiVibe = false;
    const promoterIsCollective = collectives.has(promoterLower);
    if (!promoterIsCollective) {
      for (const av of antiVibe) {
        if (blob.includes(av)) { hasAntiVibe = true; break; }
      }
    }
    if (hasAntiVibe) score -= 20;

    if (today && ev.date) {
      if (ev.date === today) score += 15;
      else {
        const evDate = new Date(ev.date + 'T12:00:00');
        const todayDate = new Date(today + 'T12:00:00');
        const diff = (evDate - todayDate) / 86400000;
        if (diff >= 0 && diff <= 2) score += 8;
      }
    }

    if (ev.first_seen) {
      const age = (Date.now() - new Date(ev.first_seen).getTime()) / 3600000;
      if (age < 24) score += 5;
    }

    return {
      for_you_score: Math.max(0, Math.min(200, score)),
      my_network_match: networkMatch,
    };
  };
}

module.exports = { loadSceneGraph, buildScorer };
