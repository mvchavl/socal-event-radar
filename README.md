# SoCal Event Radar (max)

Full-spectrum command center for SoCal (LA/OC/IE/SD).

**Music/underground core** (HARD Summer → secret 4am warehouse afters) **+ tech/AI/quant/career networking + wholesome community/library/pop-up events + art + everything in between**.

Dense 19hz-style table. Real data from 13+ live sources (770+ events on last collect). Categories + quick presets. Map. PWA. Manual paste lane for IG stories / crew drops. Hourly auto-update via GitHub Actions.

A brutally lightweight, **19hz-style** radar for *every* Southern California music/nightlife event — underground warehouse afters to HARD Summer — in one fast page that works on **desktop + iPhone**, **auto-updates hourly**, and has an **optional map**.

No framework. No login. Dense monospace rows. Plain CSS. The frontend just reads static JSON that a scheduled collector regenerates — so it loads instantly and never depends on a live scrape at view time.

**It already works:** running the collector pulls **~740 real, deduped SoCal events** from live sources right now. Add a free API key or two and it pulls hundreds more.

---

## Quick start

```bash
npm install
npm run collect      # pull live data -> public/*.json   (~740 events, no keys needed)
npm run dev          # open http://localhost:8787
```

Then open the app, hit **Map**, filter by **Underground / Afters / Free / New**, search by artist/venue/genre, and **Export .ics** for anything you want on your calendar.

---

## What's actually live vs. what needs a key

The honest part most "scrape everything" setups skip. Sources are tiered by *how they can be ingested*:

| Source | Tier | How | Status out of the box |
|---|---|---|---|
| **19hz** | B | static HTML table | ✅ live — ~500 events, the backbone |
| **Resident Advisor** | C | GraphQL (area 23 = LA) | ✅ live — ~300 events, auto-captures most underground collectives |
| **EDM Calendars** (edmcalendar + electronicmidwest) | B | HTML | ✅ live — festivals (best-effort) |
| **Editorial RSS** (Rave New World) | B | RSS | ✅ live — scene intel |
| **Manual** | D | `data/manual_events.json` | ✅ live — your IG/Discord/SMS drops |
| **Ticketmaster** | A | Discovery API | 🔑 add `TM_API_KEY` → +TicketWeb/Universe/FrontGate |
| **SeatGeek** | A | Platform API | 🔑 add `SEATGEEK_CLIENT_ID` |
| **Bandsintown** | A | API | 🔑 add `BIT_APP_ID` (tracks `data/artists.json`) |
| **Tixr** | C | per-group JSON | ⚠️ blocks datacenter IPs — runs from residential / GitHub Actions |
| **r/avesLA** | B | Reddit JSON | ⚠️ blocks datacenter IPs — runs from residential / GitHub Actions |

Everything else in `sources.yaml` (Posh, Shotgun, DICE, AXS, EDMTrain, every promoter/venue/collective) is registered with notes so you can add a parser or keep it as a watchlist. **Underground collectives mostly surface through the RA pull** — they post on Resident Advisor even when their own channels are Instagram-only.

### Add the free API keys (optional, ~5 min each)
- **Ticketmaster** — https://developer.ticketmaster.com → register → copy key → `export TM_API_KEY=...` (free, 5000 req/day, covers TM + TicketWeb + Universe + FrontGate)
- **SeatGeek** — https://platform.seatgeek.com → create app → `export SEATGEEK_CLIENT_ID=...`
- **Bandsintown** — https://www.artists.bandsintown.com/support → request app id → `export BIT_APP_ID=...` (edit `data/artists.json` to your DJ watchlist)

Then `npm run collect` again. On GitHub, add them as repo **Secrets** (the workflow already reads them).

---

## Auto-update + map + freshness

- **Hourly:** `.github/workflows/update.yml` runs the collector, commits refreshed `public/*.json`, and deploys to GitHub Pages. (Also runs on manual dispatch and on push.)
- **Freshness:** every event carries `first_seen` / `last_seen`. New-since-your-last-visit events get a **`new`** badge and a **New** filter (tracked in `localStorage`). Events that vanish are marked `possibly_removed`/`stale` for a few days, not deleted.
- **Map:** Leaflet loads only when you tap **Map** (kept out of the initial < 200KB load). ~240 events have coordinates from `data/venues_seed.json`; add venues there to map more.
- **Source health:** footer → **source health** shows each source's tier, status, count, and error.

---

## Add warehouse / IG / Discord drops by hand

The truly secret stuff (day-of address drops) can't be legally scraped. Paste it into `data/manual_events.json` and re-run `npm run collect`.

Structured rows use the same schema as everything else:

```json
[{ "title": "...", "date": "2026-07-04", "start_time": "11pm", "venue": "TBA (DTLA)",
   "region": "Los Angeles", "genres": ["hard techno"], "promoter": "Control Room LA",
   "price": "$20", "age": "21+", "source_name": "Manual (IG)", "source_url": "https://instagram.com/...",
   "is_underground": true }]
```

Raw flyer/IG/Discord text works too:

```json
[{ "paste": "Event: Midnight Transit\nVenue: TBA DTLA\nDate: Jun 30\nTime: 11pm-5am\nLineup: Nera, Pulse Twin\nGenres: hard techno, industrial\nPrice: $20\nAge: 21+\nLink: https://example.com" }]
```

---

## Add a new source in ~5 minutes

1. Add a row to `sources.yaml`.
2. Create `collector/parsers/<name>.js` exporting `async collect()` that returns normalized events via `makeEvent(...)` from `collector/util.js` (handles dates, flags, hashing).
3. Register it in the `PARSERS` array in `collector/collect.js`.
4. `npm run collect`. If it throws, it's marked `error`/`degraded` in the dashboard and never breaks the rest.

`makeEvent` auto-derives `is_underground` / `is_afterhours` / `is_free_rsvp` / `is_festival` / `is_tba_location`, infers region, and computes a stable dedupe id, so a parser only needs to map raw fields.

---

## Deploy (GitHub Pages, free)

```bash
git init && git add -A && git commit -m "init: SoCal Event Radar"
gh repo create socal-event-radar --public --source=. --push
# In repo Settings → Pages → Source: GitHub Actions
# (optional) Settings → Secrets → add TM_API_KEY / SEATGEEK_CLIENT_ID / BIT_APP_ID
```

The workflow deploys `public/` and refreshes data hourly. Any static host (Cloudflare Pages, Netlify, Vercel) works too — point it at `public/` and run `npm run collect` on a cron.

---

## Project layout

```
collector/
  collect.js        orchestrator (fault-tolerant; writes public/*.json + source health)
  dedupe.js         cross-source merge (keeps all source links per event)
  util.js           normalize: dates, flags, region, stable id, fetch
  serve.js          zero-dep local dev server
  parsers/          _19hz, ra, ticketmaster, seatgeek, bandsintown, edmcal, rss, tixr, reddit, manual
data/
  venues_seed.json  venue -> [lat,lng] for the map
  artists.json      DJ watchlist for Bandsintown
  manual_events.json your hand-entered drops
public/
  index.html app.js style.css   the app (dense, monospace, PWA)
  manifest.webmanifest sw.js icon.svg
  events.json sources.json venues.json last_updated.json   (generated)
sources.yaml         full registry of every source (active + watchlist)
.github/workflows/update.yml   hourly collect + deploy
```

Built to be "19hz for all of SoCal" — fast, plain, dense, honest about its sources, with new-event detection and a map. Not a SaaS dashboard. On purpose.
