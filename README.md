# Putting Practice

A small, phone-friendly web app for tracking disc golf putting practice:
run routines on the practice basket, log makes and misses with big thumb-sized
buttons, and watch your make % improve at each distance.

No accounts, no server, no build step. Data stays in your browser
(localStorage); use **Settings → Export JSON** for backups or to move devices.

## How it is laid out

The app is built around one idea: **practise at the distance where you make
about 85% of your putts**, and let the numbers tell you when to move.

- **Practice** (home) – the zone card leads. Tap a standard distance (each
  shows your make % there), set sets and putters with the steppers, and start.
  When the stats say the distance is clearly too easy or too hard, the card
  says so and offers a one-tap move to the next mark. Routines sit below, then
  "Log a past session" for putts entered after the fact.
- **Session** – full screen, no tabs, built for one thumb outdoors. Huge
  distance, a progress bar with one segment per station, a tally of each set,
  and the entry pad at the bottom: tap how many went in, with a full-width
  "All N" key. With one putter it becomes Miss / Make. Undo (top right) takes
  back the last set, putt or skipped station; × pauses and the session survives
  a reload. Putters can be changed mid-session.
- **Session complete** – make %, a bar per distance, set scores, a zone check
  that includes the session you just finished, and notes.
- **Progress** – opens with your 85% distance, estimated from every distance
  you have logged. Below it one chart plots make % against distance to scale,
  with the zone band, a 95% range on every point and the Circle 1 / Circle 2
  edges. Tap a distance in the list for its verdict (too easy / in the zone /
  too hard, last 30 days once there are 50+ putts) and its trend. Totals,
  whole-session trend and JYLY scores follow.
- **History** – sessions by month with makes per distance, set scores and notes.
- **Settings** (gear, top right) – feet or metres, target make %, backup, reset.

Also in there:

- **Routines** – station drills counted in putts or in **sets of your
  putters** (8 sets × 6 putters = 48 putts). Ships with Circle 1 Ladder, C1X
  Grind and Circle 2 Reps; edit them or add your own from Practice → Edit.
- **JYLY** – the 20-round, 5-disc game (5–10 m, max 1000 points) with automatic
  distance changes and scoring.
- **Standard distances** – every distance is picked from a fixed list
  (10, 15, 18, 20, 25, 30, 33, 40, 50, 66 ft; 3–10, 15, 20 m) so stats pile up
  at the same marks. 33 ft is the edge of Circle 1 and 66 ft the edge of
  Circle 2. Older custom distances are kept and shown as "(old)" in the editor.

## Project layout

| Path | What lives there |
| --- | --- |
| `index.html` | Page shell; loads `src/app.js` as an ES module |
| `src/app.js` | Views (template strings), routing (`#hash`), event handling |
| `src/charts.js` | SVG chart builders: data in, markup out, no app state |
| `src/stats.js` | Pure logic: unit conversion, stats, JYLY scoring, streaks |
| `src/store.js` | localStorage persistence, default routines, import validation |
| `src/styles.css` | All styles (light + dark); every colour is a token at the top |
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
