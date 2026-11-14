# Accounts, sync and ladders: design plan

Adding optional Google sign-in so a player's history follows them between
devices, built so that competitive ladders can be added later without
reshaping the data.

This document is a plan, not an implementation. It describes how accounts would
fit the app as it exists today (vanilla ES modules, no build step, no
dependencies, everything in one `localStorage` blob, static hosting on Vercel).

An earlier version of this plan used Supabase; it is in this file's git history.

**How sure this is.** Items marked *(verify)* come from memory or third-party
pages and were not confirmed against the official docs, partly because
`convex.dev` was not reachable while this was written. Phase 2 starts with a
small proof that settles the important ones before anything is built on them.

---

## 1. Decisions

| Question | Decision | Why |
| --- | --- | --- |
| Data and server logic | **Convex** | Database plus server functions in one service; every write passes through code that can validate it; ladders can update live |
| Login | **Clerk**, Google only | A documented Convex login provider with a plain-JavaScript SDK; runs on a subdomain of our own domain, so Safari keeps the session; no passwords to store |
| Is login required? | **No** | The app must keep working signed-out and offline exactly as it does now |
| Source of truth on the device | **`localStorage`, as today** | Screens keep reading local state; the cloud is a replica that sync reconciles with |
| Ladders | **Later phase, but the tables are shaped for them now** | Avoids a data migration when they arrive |

Options considered and set aside:

- **Supabase** – simpler (one service, no deploy step, ladders as SQL queries)
  and still the fallback if the phase 2 proof fails.
- **WorkOS AuthKit** – its browser SDK keeps the session in memory and restores
  it from a cookie on WorkOS's domain, which Safari is expected to block. The
  fix is a custom domain at $99 a month.
- **Convex Auth** – beta and React-only.
- **Google's sign-in button straight into Convex** – tokens last an hour and
  silent renewal is unreliable on iPhone; fixing that means hand-written
  session handling.

Known costs of the choice:

- **The repo gains a backend.** A `convex/` folder of server functions, the
  first entry in `package.json` dependencies, and a deploy step. The site itself
  stays plain static files with no bundler.
- **Two services** to set up and keep working together.
- **Weekly re-sign-in.** Clerk's free plan fixes sessions at 7 days. Because the
  app works signed-out, an expired session only pauses sync until the next
  "Continue with Google"; no putts are lost.
- **Free limits** *(verify)*: Convex about 1M function calls and 0.5 GB a month;
  Clerk 50,000 users on its pricing page. Whether idle free Convex projects
  pause was not confirmed.

---

## 2. What "safe" means here

- **No passwords.** Google proves who the user is; Clerk issues the session.
- **Minimal Google scopes.** `openid`, `email`, `profile` only. These need no
  Google security review.
- **Identity comes from the token, never from the request.** Convex has no
  per-row security rules: every public function can be called by anyone who
  knows the deployment URL. So every function goes through one `requireUser(ctx)`
  helper that reads the caller from the verified Clerk token, and no function
  accepts a user id as an argument. A function that skips the helper is the one
  mistake that would expose data, so:
  - a test signs in as user A and confirms user B's rows are unreadable and
    unwritable through every function;
  - a lint-style test fails if any exported function does not call the helper.
- **No secret keys in the repo or the browser.** The Convex URL and the Clerk
  publishable key are public by design (like `FEEDBACK_KEY` and
  `ANALYTICS_KEY`). The Convex deploy key lives only in Vercel's settings.
- **Emails stay in Clerk.** Convex stores the Clerk user id and, later, a chosen
  display name. It never stores the email address.
- **Analytics stay anonymous.** PostHog is never told the email, name or user
  id. At most it gets a `signed_in: true/false` property.
- **Users can leave.** Settings gets "Delete my account", which removes the
  Convex rows and the Clerk login. Export JSON keeps working either way.

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

Each run calls one `push` function with local records changed since the last
successful sync, then one `pull` function for rows the server has stamped since
the device's watermark. The watermark uses a server-set timestamp, so device
clocks cannot cause missed rows. Convex runs each function as a transaction, so
a push either fully applies or does not apply at all. A failed run changes
nothing locally and is retried on the next trigger.

Sync is plain request and response. Convex's live subscriptions are not used
for personal history, which keeps the app usable offline; they are saved for
ladders.

Settings shows "Synced 2 min ago", "Not synced, will retry" or "Sign in to
resume sync", so a silent failure is visible, in the same spirit as the
`[usage-stats]` console line.

### Edge cases

- **Session expired (weekly on Clerk's free plan).** The app carries on locally
  and queues changes. Signing in again runs a normal sync.
- **A second person on the same browser.** Local data records the id of the
  account that owns it. If a different account signs in, the app does not merge;
  it sets the first person's data aside (still on the device, restored when they
  sign back in) and loads the new account's.
- **Signing out.** Ask: keep this history on this device, or remove it from this
  device. The cloud copy is untouched either way.
- **"Reset all data" while signed in.** Two explicit choices: "Clear this
  device" and "Delete everything, including my cloud history".
- **Import JSON while signed in.** Imported sessions merge by id and upload.
  They are marked as imported so ladders can exclude them (section 5).
- **Clock skew.** `updatedAt` comes from the device clock. For one person's own
  data, the rare wrong winner is acceptable. Ladders never trust device times.

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

### Cloud (Convex tables)

```
users         clerkId, displayName?, ladderOptIn, createdAt
              index: by clerkId
sessions      userId, clientId, date, kind, routineName, source, score?,
              results: [{ ft, makes, attempts }],
              data,                 -- sets, notes, pp360 stations: the rest of the record
              updatedAt, deletedAt?,
              receivedAt,           -- set by the server on first arrival
              serverStamp           -- set by the server on every write; the pull watermark
              indexes: by (userId, clientId), by (userId, serverStamp)
routines      userId, clientId, data, updatedAt, deletedAt?, serverStamp
userState     userId, settings, updatedAt, serverStamp
ladderTotals  userId, ft, window, makes, attempts      (phase 5)
              indexes: by (ft, window), by (userId, window)
```

Results are already stored in feet (`{ ft, attempts, makes }`), so they go in
unchanged. The `push` function validates every session before storing it:
`0 <= makes <= attempts`, distances from the standard list, a known `kind` and
`source`, and a sane size.

`ladderTotals` is what exists for ladders. Convex has no `GROUP BY`, so totals
per player, distance and window are kept up to date by the same transaction
that stores, edits or deletes a session. It is not needed until phase 5, and
can be built then from the stored `results`, so nothing about private sync
depends on it.

---

## 5. Ladders (later phases, designed for now)

### Formats to start with

- **Most putts** – total attempts in a window.
- **Best make % at each distance** – per standard distance, with a minimum
  number of putts.
- Later: JYLY and Perfect Putt 360 high scores, streaks, friend and club
  ladders, head-to-head challenges.

Each ladder is a Convex query over `ladderTotals` that returns only display
names and totals, and the ladder screen subscribes to it so standings update
live. At the size of a club, the query reads one distance and window and sorts
it. If a ladder grows large, Convex's Aggregate component (pre-1.0 at the time
of writing) provides ranked lookups without reading every row. A new format is
new code: a totals field or table, the write-path update, and a query.

### Rules to fix before building

| Rule | Proposal |
| --- | --- |
| Minimum for a % ladder | 48 putts at that distance in the window (the app's existing threshold) |
| Windows | This week, this month, all time |
| Which sessions count | `source = 'live'` only, received by the server while signed in. Backdated "Log a past session" entries and imports stay in personal stats but not ladders |
| Feet vs metres | Separate ladders. 33 ft and 10 m are not the same putt (32.8 ft), and results are stored in feet |
| Windows are measured by | Server `receivedAt`, not the device's `date` |
| Joining | Opt-in, with a chosen display name. Private is the default |

### Honesty

Every putt is self-reported, so a ladder runs on the honour system and no
backend changes that. What helps:

- server-side sanity checks in the `push` function (plausible pace, late edits
  to old sessions not counting);
- friend and club ladders first, where people know each other, before a global
  one;
- a way to hide a player from a ladder;
- the camera-capture plan as a future "verified" tier.

---

## 6. How it fits the existing code

| Path | Change |
| --- | --- |
| `src/store.js` | `upgrade()` adds `updatedAt` / `source`; deletes become tombstones; new `sync` key |
| `src/stats.js` | Pure `mergeState(local, remote)` with tests; `CONVEX_URL` and `CLERK_KEY` next to the other public keys |
| `src/sync.js` (new) | The only file that talks to Clerk and Convex: sign in/out, push, pull. Loaded on demand, like PostHog |
| `src/app.js` | Account section in Settings, sync status, sign-out and reset prompts; mutations stamp `updatedAt` |
| `convex/` (new) | `schema`, `auth.config`, the `requireUser` helper, `sync` functions (push, pull, delete account); later `ladders` |
| `tests/` | Merge tests (plain `node:test`); server function tests including the cross-user access test |
| `package.json` | `convex` as a dependency, for the CLI and server functions only |
| `README.md`, Settings copy | "No accounts, no server" and "stored only in this browser" become "optional account" wording; new privacy page |

**The browser side stays build-free.** Convex publishes a browser bundle that
loads from a script tag (confirmed in the published package, 1.50.0), and Clerk
loads the same way. Both are pinned to exact versions and fetched only when the
user opens sign-in or is already signed in, so signed-out users load nothing
new. Functions are called by name (`convex.anyApi`), so no generated code is
imported by the site.

**The glue** *(verify in the phase 2 proof)*: after `Clerk.load()`, the Convex
client is given a callback that returns
`Clerk.session.getToken({ template: 'convex' })`. No official example combines
script-tag Clerk with script-tag Convex, though each half is documented.

**Deploying.** Vercel's build command becomes `npx convex deploy`, with a Convex
deploy key in Vercel's environment settings, so server functions ship with
every push to `main` exactly as the site does. The README's "no deploy tokens to
keep working" line stops being true and needs updating. CI gains the server
tests.

**Preview deploys and localhost.** These use a separate Convex development
deployment and Clerk's development instance, or hide sign-in entirely (as
analytics already does off the live domain). Decide in phase 2.

**Service worker.** There is none today, so nothing interferes with the sign-in
redirect. If one is added later it must not intercept it.

---

## 7. Setup outside the code

Done once, by the project owner, in dashboards:

1. **Convex** – create a project; note the deployment URL; create a production
   deploy key and add it to Vercel as an environment variable.
2. **Clerk** – create an application with Google as the only sign-in method;
   enable its Convex integration (this creates the `convex` token template).
3. **Clerk production instance** – add the DNS records it lists for a subdomain
   of `richyarthurs.com` *(verify that the free plan includes this)*.
4. **Google Cloud Console** – create an OAuth client for production and give
   its id and secret to Clerk (Clerk's shared Google credentials are for
   development only *(verify)*). Consent screen: app name, support email, link
   to the privacy page; publish it.
5. **Convex** – set Clerk's issuer URL as an environment variable for
   `auth.config`.
6. Paste the Convex URL and Clerk publishable key into `src/stats.js`.

---

## 8. Phasing

1. **Local groundwork.** `updatedAt`, `source`, tombstones, `mergeState` with
   tests. Ships with no visible change and no backend. Identical whichever
   backend is used.
2. **Proof, then accounts and private sync.**
   - *Proof first:* a throwaway page with script-tag Clerk and Convex that signs
     in with Google, calls one authenticated function, and stays signed in
     after a reload, tested in iPhone Safari and as a home-screen app. If this
     fails, fall back to the Supabase plan before any more is built.
   - Then: schema, `requireUser`, push and pull, the cross-user access test,
     `src/sync.js`, the Settings account section, the Vercel deploy step.
3. **Edge cases and wording.** Second-account handling, expired-session note,
   sign-out and reset prompts, delete account, README and privacy page.
4. **Profiles and opt-in.** Display name, ladder opt-in.
5. **First ladders.** `ladderTotals`, most putts and best % per distance,
   starting with friend or club groups.
6. **More formats.** Game high scores, challenges, verified tier.

Phases 1 to 3 deliver "my history follows me". Each phase is shippable on its
own.

---

## 9. Open questions

- Is a weekly "Continue with Google" acceptable, or is a paid Clerk plan worth
  it to lengthen sessions?
- Should a brand-new visitor be invited to sign in, or only find it in Settings?
- Do preview deploys get working sign-in, or is it live-site only?
- Friend/club groups: invite link, or join by code?
- Do edits to a saved session ("tap a logged result to correct it") stop
  counting for ladders after some time?
- Is a global ladder wanted at all, or only groups?
