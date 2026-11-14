# Accounts, sync and ladders: design plan

Adding optional Google sign-in so a player's history follows them between
devices, built so that competitive ladders can be added later without
reshaping the data.

This document is a plan, not an implementation. It describes how accounts would
fit the app as it exists today (vanilla ES modules, no build step, no
dependencies, everything in one `localStorage` blob, static hosting on Vercel).

Limits and product details for Supabase, Vercel and Google below were written
from memory. Check them against the current docs during phase 2.

---

## 1. Decisions

| Question | Decision | Why |
| --- | --- | --- |
| Backend | **Supabase**, created from the Vercel Marketplace (project → Storage) | Login, Postgres and per-user security in one service, callable from the browser, managed from the existing Vercel account |
| Login methods | **Google only** to start | No passwords to store, reset or leak |
| Is login required? | **No** | The app must keep working signed-out and offline exactly as it does now |
| Source of truth on the device | **`localStorage`, as today** | Screens keep reading local state; the cloud is a replica that sync reconciles with |
| Ladders | **Later phase, but the tables are shaped for them now** | Avoids a data migration when they arrive |

Options considered and set aside:

- **WorkOS AuthKit** – a good login product, but login only. It would still need
  a database and a hand-written API.
- **Convex (with WorkOS)** – workable and never pauses, but adds a deploy step,
  two services, and has no SQL-style aggregation, so every ladder would need
  hand-maintained running totals.
- **Neon via Vercel + WorkOS + Vercel functions** – full control, but the whole
  API and its security would be code in this repo.

Known cost of the choice: a free Supabase project pauses after about a week
with no activity. Any request counts as activity, so a used app stays awake. If
it ever pauses, signed-in users keep working locally and sync resumes when the
project is restored.

---

## 2. What "safe" means here

- **No passwords.** Google proves who the user is; Supabase issues the session.
- **Minimal Google scopes.** `openid`, `email`, `profile` only. These need no
  Google security review.
- **Row-level security on every table.** The Supabase key shipped in the browser
  is public by design (like `FEEDBACK_KEY` and `ANALYTICS_KEY`); what protects
  data is a policy on each table saying a signed-in user can only read and write
  rows where `user_id` is their own id. A table without a policy is the one
  mistake that would expose data, so phase 2 includes a test that signs in as
  user A and confirms user B's rows are unreadable.
- **No secret keys in the repo or the browser.** The service-role key is never
  used by the app.
- **Analytics stay anonymous.** PostHog is never told the email, name or
  Supabase user id. At most it gets a `signed_in: true/false` property.
- **Users can leave.** Settings gets "Delete my account", which removes the
  cloud rows and the login. Export JSON keeps working either way.

---

## 3. How sync works

### The rule: merge, never overwrite

Every session already has a unique `id` (`uid()` in `src/store.js`). Sync is
therefore a union by id:

- a session that exists only on this device is uploaded;
- a session that exists only in the cloud is downloaded;
- a session on both sides is the same session, and the newer `updatedAt` wins.

This is what makes the first login keep existing history. It also covers the
iPhone case where Safari and the home-screen app have separate storage: each
one merges in when the user signs in there.

### What syncs and how conflicts resolve

| Data | Synced? | Conflict rule |
| --- | --- | --- |
| `sessions` | Yes | Union by `id`; newer `updatedAt` wins for the same id |
| Deleted sessions | Yes, as tombstones | A `deletedAt` marker beats any older copy |
| `routines` | Yes | Per routine, newer `updatedAt` wins; deletes are tombstones too |
| `settings` | Yes, as one unit | Newer `updatedAt` wins |
| `active` (session in progress) | **No** | Stays on the device it was started on |
| PostHog's random id | No | Per-browser by design |

Tombstones are needed because today a delete simply filters the session out of
the array. Without a marker, any other device that still has the session would
upload it again.

Default routines share ids across devices (`c1-ladder`, `jyly`, …), so they
merge as the same routine rather than duplicating. `settings.seenDefaults`
merges as a union so a deleted default stays deleted.

### When sync runs

- right after signing in;
- when the app opens or returns to the foreground;
- after a session is saved, edited or deleted, and after a routine or settings
  change;
- when the browser comes back online.

Each run pushes local changes made since the last successful sync (tracked by a
per-record `dirty` flag or a `lastSyncedAt` watermark), then pulls rows changed
on the server since that watermark. A failed run changes nothing locally and is
simply retried on the next trigger. Settings shows "Synced 2 min ago" or
"Not synced, will retry", so a silent failure is visible, in the same spirit
as the `[usage-stats]` console line.

### Edge cases

- **A second person on the same browser.** Local data records the id of the
  account that owns it. If a different account signs in, the app does not merge;
  it sets the first person's data aside (still on the device, restored when they
  sign back in) and loads the new account's.
- **Signing out.** Ask: keep this history on this device, or remove it from this
  device. The cloud copy is untouched either way.
- **"Reset all data" while signed in.** Must say what it does. Proposed: two
  explicit choices, "Clear this device" and "Delete everything, including my
  cloud history".
- **Import JSON while signed in.** Imported sessions merge by id and upload.
  They are marked as imported so ladders can exclude them (section 5).
- **Clock skew.** `updatedAt` comes from the device clock. For one person's own
  data, the rare wrong winner is acceptable. Ladders never trust device times
  (section 5).

---

## 4. Data model

### Local (`putting-practice:v1` blob)

Additive, so existing data and old backups keep loading through `upgrade()`:

```js
session:  { ...existing, updatedAt, deletedAt?, source: 'live' | 'logged' | 'imported' }
routine:  { ...existing, updatedAt, deletedAt? }
settings: { ...existing, updatedAt }
sync:     { ownerId, lastSyncedAt }          // new top-level key
```

Views filter out records with `deletedAt`. Old tombstones can be dropped after
they have synced and aged (say 90 days).

### Cloud (Postgres)

```
profiles     user_id PK, display_name, ladder_opt_in, created_at
sessions     (user_id, id) PK, date, kind, routine_name, source, score,
             data jsonb,            -- sets, notes, pp360 stations: the full record
             updated_at, deleted_at,
             received_at            -- set by the server, never by the client
putts        (user_id, session_id, ft) PK, makes, attempts
             -- one row per distance per session, mirroring session.results
routines     (user_id, id) PK, data jsonb, updated_at, deleted_at
user_state   user_id PK, settings jsonb, updated_at
```

`putts` is the part that exists for ladders. Private sync alone could store
each session as a single JSON blob, but ranking needs makes and attempts per
distance per user as real columns. Results are already stored in feet
(`{ ft, attempts, makes }`), so they map straight onto it. A database constraint
enforces `0 <= makes <= attempts`.

Every table has row-level security: owner can select, insert, update; nobody
else can do anything. Ladders are exposed through views (section 5), never by
loosening these policies.

---

## 5. Ladders (later phases, designed for now)

### Formats to start with

- **Most putts** – total attempts in a window.
- **Best make % at each distance** – per standard distance, with a minimum
  number of putts.
- Later: JYLY and Perfect Putt 360 high scores, streaks, friend and club
  ladders, head-to-head challenges.

Each is a SQL view or function over `putts` and `sessions`, returning only
display name and totals. A new format is a new query, not new infrastructure.

### Rules to fix before building

| Rule | Proposal |
| --- | --- |
| Minimum for a % ladder | 48 putts at that distance in the window (the app's existing threshold) |
| Windows | This week, this month, all time |
| Which sessions count | `source = 'live'` only, received by the server while signed in. Backdated "Log a past session" entries and imports stay in personal stats but not ladders |
| Feet vs metres | Separate ladders. 33 ft and 10 m are not the same putt (32.8 ft), and results are stored in feet |
| Windows are measured by | Server `received_at`, not the device's `date` |
| Joining | Opt-in, with a chosen display name. Private is the default |

### Honesty

Every putt is self-reported, so a ladder runs on the honour system and no
backend changes that. What helps:

- server-side sanity checks (plausible pace, no edits to old sessions counting);
- friend and club ladders first, where people know each other, before a global
  one;
- a way to hide a player from a ladder;
- the camera-capture plan as a future "verified" tier.

---

## 6. How it fits the existing code

| File | Change |
| --- | --- |
| `src/store.js` | `upgrade()` adds `updatedAt` / `source`; deletes become tombstones; new `sync` key |
| `src/stats.js` | Pure `mergeState(local, remote)` and the session → `putts` rows mapping, with tests |
| `src/sync.js` (new) | The only file that talks to Supabase: sign in/out, push, pull. Loaded on demand, like PostHog |
| `src/app.js` | Account section in Settings, sync status, sign-out and reset prompts; mutations stamp `updatedAt` |
| `supabase/` (new) | SQL for tables, policies and ladder views, kept in the repo |
| `README.md`, Settings copy | "No accounts" and "stored only in this browser" become "optional account" wording; new privacy page |

**The client library without a build step.** `supabase-js` is loaded as an ES
module, pinned to an exact version. It is fetched only when the user opens the
sign-in flow or is already signed in, so signed-out users load nothing new.
Vendoring a copy into the repo is the alternative if a CDN dependency is
unwanted.

**Sign-in flow.** A redirect to Google and back to `putt.richyarthurs.com`.
Preview deploys and `localhost` need their URLs added to the allowed redirect
list, or sign-in is simply hidden there (as analytics is).

**Service worker.** There is none today, so nothing caches the auth redirect.
If one is added later it must not intercept the callback.

---

## 7. Setup outside the code

Done once, by the project owner, in dashboards:

1. Vercel → project → Storage → create a Supabase database (free plan).
2. Google Cloud Console → create an OAuth client; consent screen with app name,
   support email, link to the privacy page; publish it (basic scopes need no
   review).
3. Supabase → Authentication → enable Google with that client id and secret;
   set the site URL and allowed redirect URLs.
4. Run the SQL in `supabase/` to create tables and policies.
5. Paste the Supabase project URL and public key into `src/stats.js` next to
   the other public keys.

By default Google's consent screen will name the Supabase project domain rather
than `putt.richyarthurs.com`. Fixing that needs either Supabase's paid custom
domain or Google's own sign-in button passing a token to Supabase. Decide in
phase 2; it does not affect the data design.

---

## 8. Phasing

1. **Local groundwork.** `updatedAt`, `source`, tombstones, `mergeState` with
   tests. Ships with no visible change and no backend.
2. **Accounts and private sync.** Supabase setup, tables including `putts`,
   policies, the cross-user access test, `src/sync.js`, Settings account
   section.
3. **Edge cases and wording.** Second-account handling, sign-out and reset
   prompts, delete account, README and privacy page.
4. **Profiles and opt-in.** Display name, ladder opt-in.
5. **First ladders.** Most putts and best % per distance, starting with friend
   or club groups.
6. **More formats.** Game high scores, challenges, verified tier.

Phases 1 to 3 deliver "my history follows me". Each phase is shippable on its
own.

---

## 9. Open questions

- Sign-in button: Supabase redirect (simplest) or Google's own button (shows
  this site's domain on the consent screen)?
- Should a brand-new visitor be invited to sign in, or only find it in Settings?
- Friend/club groups: invite link, or join by code?
- Do edits to a saved session ("tap a logged result to correct it") stop
  counting for ladders after some time?
- Is a global ladder wanted at all, or only groups?
