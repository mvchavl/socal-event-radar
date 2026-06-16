// Dev server: `npm run dev` -> http://localhost:8787
// Serves static files + local-only API endpoints for manual event management.
const http = require('http');
const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..', 'public');
const DATA = path.join(__dirname, '..', 'data');
const PORT = Number(process.env.PORT) || 8787;
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml', '.webmanifest': 'application/manifest+json' };

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', c => chunks.push(c));
    req.on('end', () => { try { resolve(JSON.parse(Buffer.concat(chunks).toString())); } catch (e) { reject(e); } });
    req.on('error', reject);
  });
}

http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);
  const p = url.pathname;

  // API: save manual events to data/manual_events.json
  if (p === '/api/save-manual' && req.method === 'POST') {
    res.setHeader('Content-Type', 'application/json');
    try {
      const body = await readBody(req);
      const events = Array.isArray(body.events) ? body.events : [];
      fs.writeFileSync(path.join(DATA, 'manual_events.json'), JSON.stringify(events, null, 2));
      res.writeHead(200);
      res.end(JSON.stringify({ ok: true, count: events.length }));
    } catch (e) {
      res.writeHead(400);
      res.end(JSON.stringify({ ok: false, error: e.message }));
    }
    return;
  }

  // API: fetch a URL and return its text (for Partiful/RA/DICE link parsing)
  if (p === '/api/fetch-event' && req.method === 'POST') {
    res.setHeader('Content-Type', 'application/json');
    try {
      const body = await readBody(req);
      const targetUrl = String(body.url || '').trim();
      if (!targetUrl || !(targetUrl.startsWith('http://') || targetUrl.startsWith('https://'))) {
        res.writeHead(400);
        res.end(JSON.stringify({ ok: false, error: 'invalid url' }));
        return;
      }
      const ctrl = new AbortController();
      const t = setTimeout(() => ctrl.abort(), 15000);
      const r = await fetch(targetUrl, {
        headers: { 'User-Agent': 'Mozilla/5.0 (compatible; SoCalEventRadar/1.0)' },
        signal: ctrl.signal,
        redirect: 'follow',
      });
      clearTimeout(t);
      const text = await r.text();
      res.writeHead(200);
      res.end(JSON.stringify({ ok: true, html: text.slice(0, 50000), status: r.status }));
    } catch (e) {
      res.writeHead(500);
      res.end(JSON.stringify({ ok: false, error: e.message }));
    }
    return;
  }

  // Static file serving
  let filePath = decodeURIComponent(p);
  if (filePath === '/') filePath = '/index.html';
  const fp = path.join(ROOT, filePath);
  if (!fp.startsWith(ROOT)) { res.writeHead(403); return res.end(); }
  fs.readFile(fp, (e, d) => {
    if (e) { res.writeHead(404); return res.end('not found'); }
    res.writeHead(200, { 'Content-Type': TYPES[path.extname(fp)] || 'application/octet-stream' });
    res.end(d);
  });
}).listen(PORT, () => console.log(`SoCal Event Radar -> http://localhost:${PORT}`));
