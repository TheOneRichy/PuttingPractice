# Camera capture: design plan

Adding phone-camera capture to the putting practice app — auto-logging makes and
misses, measuring start line, judging throwing form, and keeping a clip library.

This document is a plan, not an implementation. It describes how camera capture
would fit the app as it exists on PR #1 (vanilla ES modules, no build step, no
dependencies, localStorage, static hosting on Vercel).

---

## 1. Why disc golf makes this easier than it sounds

Ball-golf putt tracking is hard: a small white ball rolling on a surface, with
"made" meaning it vanished into a hole. Disc golf putting has three properties
that make camera work substantially more tractable:

1. **The basket is a large, static, high-contrast object.** It can be calibrated
   once per session and used as a fixed reference frame. Nothing else in the
   scene is shaped like it.
2. **A made putt ends with the disc at rest inside the cage.** The decisive
   evidence is a *static* scene after the throw, not a motion-blurred disc in
   flight. Classifying a still frame is far easier than tracking a fast object.
3. **Discs accumulate.** You throw several before walking up to collect them, so
   "how many discs are resting in the cage" is a directly observable number.

That third point drives the core algorithm below, and it maps exactly onto JYLY,
where the question the app already asks is literally "how many of 5 went in?".

---

## 2. Two camera positions, two different jobs

The single biggest design decision. One phone cannot do everything well, because
form analysis wants the thrower large in frame and make detection wants the
basket large in frame — and they are 5–20 m apart.

| Mode | Phone placement | Good for | Weak at |
| --- | --- | --- | --- |
| **Basket-cam** | Propped 2–4 m to the side of the basket, basket filling ~⅓ of frame | Make/miss, disc-count, chain contact, spit-outs | Form (thrower is tiny) |
| **Thrower-cam** | Propped 2–3 m to the side of the thrower, face-on or down-the-line | Form metrics, release point, start line, tempo | Make/miss at C1/C2 range |

The plan treats these as a **mode switch**, not a compromise angle. You pick one
per session depending on what you're working on. A single "does everything"
angle would do both jobs badly.

Down-the-line (phone behind the thrower, basket visible down the middle) is a
useful third mode later: it sees the thrower's back *and* the basket, and is the
best angle for hyzer/anhyzer release angle. But the basket is small, so
make detection there is confidence-scored only, never silently auto-logged.

---

## 3. Make/miss detection: delta-count in the catch zone

The algorithm, deliberately boring and robust:

1. **Calibrate (once per session).** Show the live camera feed. The user taps the
   basket; the app fits a region to it and the user drags to confirm two zones:
   the **cage** (the basket tray, where made discs come to rest) and the
   **chains** (above it). Store as normalised polygons so it survives rotation
   and resolution changes. Require the thrower to be out of frame, then grab a
   **background reference frame**.
2. **Arm.** Watch a downscaled grayscale frame (~256 px wide) for motion. No ML,
   just frame differencing against a rolling background.
3. **Trigger.** Motion appearing in the approach corridor starts a capture
   window. A **circular pre-roll buffer** (~2 s) means the clip includes the
   throw itself, not just the arrival.
4. **Settle.** Wait until total frame difference drops below threshold for
   ~400 ms. Discs that rattle, spit out, or roll get time to come to rest.
5. **Count.** Diff the settled frame against the background reference, mask to
   the cage zone, and count distinct blobs above a minimum area.
   `discs_now - discs_before` → **1 = make, 0 = miss.**
6. **Corroborate.** Chain-zone motion during the window means the disc *hit* the
   basket. Chain motion + no count increase = spit-out or chain-out (worth
   logging as its own outcome — it's a different miss than a flat airball).
7. **Score confidence.** Clean count delta plus clear chain signal = high. Blob
   area ambiguous, disc landed straddling the cage edge, two discs overlapping,
   lighting shift = low.

### The product rule that makes this usable

**Auto-log, then give a generous undo — never silently guess.**

- High confidence → log it, haptic buzz, show a 4-second chip: `Make ✓ · Undo`.
- Low confidence → log nothing, show `Make? / Miss?` as two big buttons, which is
  exactly the UI the app already has. Degrading to the current manual flow is
  always the fallback, so a bad camera read costs one tap, never a wrong stat.

This matters more than detection accuracy. A tracker you can't trust is worse
than a tracker you tap yourself, so the camera must be an *assistant to the tap*
until the numbers earn trust. A "camera accuracy" readout in Settings (agreed vs
corrected) lets you decide when to trust it.

### JYLY gets this for free

JYLY throws 5 discs per round and asks for a count. Delta-count after all five
settle answers it in one shot, with no per-throw tracking at all. This is the
single highest-value, lowest-risk camera feature in the whole plan, and is worth
building first within Phase 1.

---

## 4. Start line and aim bias

Achievable, genuinely useful, and cheap once clips exist.

- From a thrower-cam or down-the-line clip, track the disc centroid across the
  first ~8 frames after release (near the camera, so it is large and bright).
- Fit a line to those centroids; compare its bearing to the calibrated basket
  bearing. Report `released 2.1° right of target`.
- Aggregate across the session: **miss bias**. "You miss right 70% of the time at
  30 ft" is more actionable than a make percentage, and it's the kind of stat the
  existing Progress tab is already built to show.
- Release angle (hyzer/anhyzer) from the apparent tilt of the disc's ellipse in
  the first frames. Coarse — call it a trend indicator, not a measurement.

Honest limit: at 30 fps a putt covers ~30 cm per frame, so the disc is a smear.
Good enough for a line fit over several frames, not good enough for spin rate.

---

## 5. Form analysis

MediaPipe Pose Landmarker (33 body landmarks), loaded on demand from CDN, run
**only on the ~1.5 s window around a detected throw** rather than continuously.
That keeps battery and thermals sane and is the difference between a feature that
survives a 30-minute session and one that cooks the phone.

First find the **release frame** — the frame where wrist velocity peaks and
reverses, or where a bright blob first separates from the hand. Every metric
below is anchored to it.

Metrics that are realistically measurable from a single 30 fps camera:

- **Head stability** — nose landmark drift from setup to release, in frame-height
  percent. The classic putting fault.
- **Knee bend and leg drive** — hip height over time; depth of the load and
  whether you push up through release.
- **Shoulder rotation** — shoulder-line angle at setup vs release; staying square.
- **Reach-back depth** — wrist position relative to shoulder at the furthest point.
- **Elbow extension at release** — arm angle; are you pushing or flicking.
- **Release height** — wrist height as a fraction of standing height.
- **Tempo** — reach-back start → release duration, and the ratio of back to
  forward phase. Cheap to compute, strongly correlated with putting well.
- **Follow-through and balance** — does the wrist finish toward the basket, and
  does the ankle/hip wobble in the 500 ms after release (a falling-putt tell).
- **Stance** — ankle separation and offset classifies straddle vs staggered, so
  metrics can be compared within stance type rather than mixed together.

### Report repeatability, not a grade

Putting is a repeatability problem, so the headline number should be the
**standard deviation of release point and tempo across the reps at a station**,
not a single invented "form score". Ten putts with a tight release-point cluster
and consistent tempo is the thing to chase, and variance is honestly measurable
where "correct form" is not. A/B your good and bad sessions against it.

This is also the right place to be sceptical: a 30 fps phone video cannot tell
you your wrist angle at release to any useful precision, and any app claiming
otherwise is guessing. The plan sticks to large-amplitude, low-frequency body
motion, which pose estimation genuinely handles.

---

## 6. Clip library

- `MediaRecorder` on the camera stream, writing into a circular buffer. On a
  detected putt, cut a ~3 s clip (pre-roll + settle) rather than recording the
  whole session.
- ~3 s at 720p ≈ 300–600 KB. A 50-putt session is 15–30 MB.
- **Clips must not go in localStorage** (~5 MB cap, and they'd break
  Export JSON). Use **IndexedDB**, keyed by clip id, with a thumbnail and the
  derived metrics stored alongside the session.
- Retention policy in Settings: keep all / keep last 20 / keep starred only, plus
  a storage-used readout and a "clear clips" button. Auto-prune on session save.
- Review UI: scrub, frame-step, pose skeleton overlay toggle, star a clip, and
  **side-by-side compare** two clips — the "what was I doing when it was
  working" feature, which is the real reason to keep video at all.
- Export JSON keeps its current meaning (stats only, still portable). Clip export
  is a separate, explicit action.

---

## 7. How it fits the existing code

The app's structure is worth preserving: pure logic in testable modules, DOM and
device work kept separate, no build step, no dependencies in the core.

### New modules

| Path | Pure? | Responsibility |
| --- | --- | --- |
| `src/detect.js` | **Yes** — `node:test` | Capture state machine, blob counting, count-delta classification, confidence scoring, trajectory line fit, pose landmarks → form metrics, variance aggregation |
| `src/camera.js` | No | `getUserMedia`, canvas pumping, `requestVideoFrameCallback`, `MediaRecorder` ring buffer, lazy MediaPipe load |
| `src/clips.js` | No | IndexedDB clip store, thumbnails, retention/pruning |
| `src/calibrate.js` | No | Basket tap-to-calibrate UI, zone polygons, background reference |

`src/detect.js` is the critical one. Every decision — "is this a make", "what is
the release frame", "how consistent was this station" — must be a pure function
over arrays of numbers, so it can be tested under the existing `node --test`
setup with synthetic frames and synthetic landmark tracks. No browser needed.
That keeps CI meaningful; otherwise all the interesting logic becomes untestable
and the feature rots.

### Data model: additive, non-breaking

`state.active.log[stationIdx]` is currently `[boolean]`, and `stats.js`,
`buildResults` and the import validator all depend on that. **Don't change it.**
Add a parallel array indexed identically:

```js
active.captures[stationIdx][puttIdx] = {
  clipId: 'abc123',          // IndexedDB key, optional
  source: 'auto' | 'tap',
  confidence: 0.92,          // auto only
  corrected: false,          // user hit Undo and re-logged
  outcome: 'make' | 'miss' | 'spit-out',
  line: { degrees: 2.1 },    // optional
  form: { headDrift: 1.4, tempoMs: 640, ... },  // optional
};
```

Sessions gain an optional `captures` field the same way. Every existing stat
keeps working untouched, old sessions stay valid, and the import validator needs
no new required fields. Camera data is purely additive enrichment, which also
means the feature can be shipped dark and removed without a migration.

### Routing and views

Follows the existing pattern exactly: new hash routes `#camera` (setup and
framing), `#review` (clip library), and a `data-action` entry per new button in
the `actions` map. The live session view gains an optional camera strip above the
Make/Miss buttons; with the camera off, the view is byte-for-byte what it is now.

### Settings additions

Camera mode (off / basket / thrower), auto-log toggle, confidence threshold,
clip retention, storage used, camera accuracy readout, clear clips.

---

## 8. Platform constraints to design around

These are real and worth knowing before building, not after:

- **No build step + ML library.** MediaPipe Tasks Vision ships as an ES module on
  CDN, so a dynamic `import()` inside `camera.js` keeps it off the critical path.
  The core app stays zero-dependency and instant to load; the ~3 MB WASM bundle
  is fetched only when you actually open the camera. Cache it in a service worker
  so outdoor sessions on bad signal still work — which the app needs anyway to be
  a real PWA.
- **Frame rate is the hard ceiling.** `getUserMedia` on iOS gives ~30 fps
  (sometimes 60 at reduced resolution). The phone's 120/240 fps slow-mo is *not*
  exposed to the web. Everything above is designed for 30 fps. If you later want
  impact-level detail, that is the reason to go native (`AVCaptureDevice`), and
  it's a genuine fork, not a tweak.
- **HTTPS and a user gesture** are required for camera access. Vercel covers the
  first; the camera must start from a tap, not on page load.
- **Camera works in a home-screen PWA** on iOS 14.3+, which is how you'd actually
  use this. Worth testing there specifically, since it behaves differently from
  Safari proper.
- **Screen sleep** will kill a session. Screen Wake Lock is supported in Safari
  16.4+ and Chrome; request it while the camera view is open, release it after.
- **Thermals and battery.** Downscale for detection (256 px grayscale), run pose
  only in throw windows, drive frames with `requestVideoFrameCallback` rather
  than a `setInterval` loop, and stop the stream the moment the view closes.
- **Outdoors.** Bright sun, hard shadows and a white disc on a bright background
  are exactly where colour thresholding fails and frame differencing holds up —
  which is why the plan avoids colour. Shifting cloud cover needs a slowly
  adapting background reference. Dusk and floodlit practice will be unreliable;
  the app should detect low light and say so rather than produce bad data.
- **Phone placement.** Needs a mini tripod or a bag to lean against. The setup
  screen should show a live framing overlay (where the basket/thrower should sit)
  plus a countdown so you can walk into position, and should refuse to arm until
  framing looks right.

---

## 9. Suggested phasing

Ordered so that each phase ships something useful on its own and de-risks the
next. The riskiest work (pose, flight tracking) comes last, on top of foundations
already proven in the field.

**Phase 0 — Camera plumbing, no ML.** Camera view, placement overlay and
countdown, wake lock, ring-buffer clip capture, IndexedDB store with retention,
clip review with scrub and frame-step. Putts are still logged by tapping, but now
a clip is attached. *Delivers the clip library outright, with zero detection
risk, and builds everything the later phases need.*

**Phase 1 — Auto make/miss (basket-cam).** Calibration, arm/trigger/settle,
delta-count classification, confidence scoring, auto-log with undo chip,
accuracy readout. **Start with JYLY's count-of-5**, which is the easiest and most
valuable case, then extend to per-throw station logging.

**Phase 2 — Start line and aim bias.** Disc tracking over the first frames,
angular deviation, release angle, miss-bias stats in the Progress tab.

**Phase 3 — Form analysis (thrower-cam).** Lazy MediaPipe load, release-frame
detection, the metric set, repeatability/variance scoring, skeleton overlay in
clip review.

**Phase 4 — Put it together.** Side-by-side clip compare, form metrics plotted
against make % over time, "your release point was tightest in these sessions".

A reasonable stopping point is Phase 1. Phases 0 and 1 together give you
automatic make/miss logging and a clip library, which is most of the practical
value; Phases 2–4 are the interesting-but-optional coaching layer.

---

## 10. Open questions

- **One mode or two?** Is it worth the complexity of basket-cam *and*
  thrower-cam, or is auto-logging alone (basket-cam) the feature you'd actually
  use week to week?
- **Do you practise with a phone stand?** If not, Phase 0's framing guide matters
  more than anything else here, and may need a "lean it against your bag" preset.
- **Spit-outs as a distinct outcome** — useful signal, or noise that complicates
  the stats you already trust?
- **Is 30 fps enough for the form metrics to tell you anything you don't know?**
  Worth a throwaway spike: record 10 putts, compute head drift and tempo by hand,
  and see whether the numbers separate good reps from bad ones before building
  Phase 3 properly.
