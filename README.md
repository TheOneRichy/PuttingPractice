# Putting Practice

A small, phone-friendly web app for tracking disc golf putting practice:
run routines on the practice basket, log makes and misses with big thumb-sized
buttons, and watch your make % improve at each distance.

No accounts, no server, no build step. Data stays in your browser
(localStorage); use **Settings → Export JSON** for backups or to move devices.

## Features

- **Routines** – station-based drills (distance × putts). Comes with
  Circle 1 Ladder (2 sets each at 10–30 ft), C1X Grind and Circle 2 Reps; create and edit your own in
  feet or metres.
- **JYLY** – the classic 20-round, 5-disc game (5–10 m, max 1000 points),
  with automatic distance changes and scoring.
- **Putters per set** – pick how many discs you putt with (Practice screen,
  or mid-session). With more than one, throw them all, walk up and tap how
  many went in; Undo takes back the whole set. Set scores and clean sets
  (all in) show on the finish screen and in History. Choose 1 to tap each
  putt as Make / Miss. A routine can count each distance in putts or in
  **sets of your putters** (chosen in the routine editor); set-based routines
  work out their putt count from your putters setting, e.g. 8 sets × 6 = 48.
- **Live session screen** – Make / Miss buttons, progress pips, undo, skip a
  station, finish early, add notes. An in-progress session survives a page
  reload.
- **Quick log** – enter a session after the fact (distance / putts / made).
- **History** – every session with per-distance breakdown and notes.
- **Standard distances** – every distance is picked from a fixed list
  (10, 15, 18, 20, 25, 30, 33, 40, 50, 66 ft; 3–10, 15, 20 m) so stats pile up
  at the same marks. 10–30 ft in 5 ft steps is the common practice ladder,
  33 ft is the edge of Circle 1 and 66 ft the edge of Circle 2. Older custom
  distances are kept and shown as "(old)" in the routine editor.
- **Zone practice** (Practice screen) – pick a standard distance (default
  18 ft) and a number of sets, and putt there.
- **Practice zone stats** – practise where you make about 85% of putts. Progress
  shows your make % at any standard distance with a 95% range,
  says when you have enough putts for a reliable read (50+), and tells you
  whether to move in, move back or stay. It also estimates your 85% distance
  from every distance you have logged, and a table judging each standard
  distance you have putted (too easy / in the zone / too hard). The target %
  is set in Settings; the session screen shows a running make % as you putt.
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
| `vercel.json` | Cache headers for the deployed site |
| `docs/` | Design notes written before a feature is built |

Keep anything that can be tested without a browser in `src/stats.js`.

## Running locally

ES modules need to be served over HTTP (not opened as `file://`):

```sh
npm start        # python3 -m http.server 8000 → http://localhost:8000
npm test         # node --test
```

## Deploying (Vercel)

Live at **https://putt.richyarthurs.com**.

The site is plain static files, so Vercel needs no build settings and there is
no build step to configure. Deploys run through Vercel's Git integration: every
push to `main` redeploys production and every pull request gets its own preview
URL. Nothing needs to be run by hand, and there are no deploy tokens or GitHub
secrets to keep working.

### First-time setup

1. In Vercel: **Add New… → Project → Import** `TheOneRichy/PuttingPractice`.
   Framework preset **Other**; leave build command and output directory empty.
2. Deploy, then confirm the `*.vercel.app` URL works.
3. **Project → Settings → Domains → Add** `putt.richyarthurs.com`.
4. At your DNS provider, add the record Vercel shows — a `CNAME` for
   `putt` pointing at `cname.vercel-dns.com`. HTTPS is issued automatically
   once the record resolves, usually within a few minutes.

### `vercel.json`

Only sets one thing: `Cache-Control: public, max-age=0, must-revalidate` on
everything. Because there is no build step, filenames carry no content hash, so
a cached `src/app.js` would keep serving old code after a deploy — on a phone
with the app on the home screen, indefinitely. The files are a few KB and
revalidation returns a `304`, so always checking costs effectively nothing and
removes a whole class of "why is my fix not showing up" confusion.

### CI

`.github/workflows/ci.yml` runs `npm test` on every pull request and every push
to `main`. It does not deploy; Vercel handles that on its own. Tests are not a
gate on deployment, so a red build will still ship — check CI before merging.

On your phone, open the site and use "Add to Home Screen" for an app-like
experience.
