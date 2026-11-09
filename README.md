# Putting Practice

A small, phone-friendly web app for tracking disc golf putting practice:
run routines on the practice basket, log makes and misses with big thumb-sized
buttons, and watch your make % improve at each distance.

No accounts, no server, no build step. Data stays in your browser
(localStorage); use **Settings → Export JSON** for backups or to move devices.

## Features

- **Routines** – station-based drills (distance × putts). Comes with
  Circle 1 Ladder, C1X Grind and Circle 2 Reps; create and edit your own in
  feet or metres.
- **JYLY** – the classic 20-round, 5-disc game (5–10 m, max 1000 points),
  with automatic distance changes and scoring.
- **Live session screen** – Make / Miss buttons, progress pips, undo, skip a
  station, finish early, add notes. An in-progress session survives a page
  reload.
- **Quick log** – enter a session after the fact (distance / putts / made).
- **History** – every session with per-distance breakdown and notes.
- **Progress** – total putts, overall make %, putts this week, day streak,
  make % by distance (all-time vs. last 30 days), trend charts per distance
  with a 5-session rolling average, and JYLY score history.

## Project layout

| Path | What lives there |
| --- | --- |
| `index.html` | Page shell; loads `src/app.js` as an ES module |
| `src/app.js` | Views (template strings), routing (`#hash`), event handling |
| `src/stats.js` | Pure logic: unit conversion, stats, JYLY scoring, streaks |
| `src/store.js` | localStorage persistence, default routines, import validation |
| `src/styles.css` | All styles (light + dark) |
| `tests/` | `node:test` tests for `src/stats.js` |
| `.github/workflows/ci.yml` | Runs the tests on every PR and push to `main` |

Keep anything that can be tested without a browser in `src/stats.js`.

## Running locally

ES modules need to be served over HTTP (not opened as `file://`):

```sh
npm start        # python3 -m http.server 8000 → http://localhost:8000
npm test         # node --test
```

## Deploying (Vercel)

The site is plain static files, so Vercel needs no build settings.

1. In Vercel: **Add New… → Project → Import** `TheOneRichy/PuttingPractice`.
   Framework preset **Other**; leave build command and output directory empty.
2. Deploy. Every push to `main` then redeploys production, and every PR
   gets its own preview URL.
3. Custom domain: **Project → Settings → Domains → Add** (e.g.
   `putt.yourdomain.com`), then add the DNS record Vercel shows at your DNS
   provider (a `CNAME` to `cname.vercel-dns.com` for a subdomain, or an `A`
   record for an apex domain). HTTPS is issued automatically.

On your phone, open the site and use "Add to Home Screen" for an app-like
experience.
