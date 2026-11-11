// Pure data helpers: unit conversion, scoring and stats. No DOM access here,
// so everything in this file is covered by tests/stats.test.js.

export const FT_PER_M = 3.28084;

export const toFt = (value, unit) => (unit === 'm' ? value * FT_PER_M : value);
export const fromFt = (ft, unit) => (unit === 'm' ? ft / FT_PER_M : ft);

/** Distance in the display unit, rounded to a whole number for grouping. */
export const displayDistance = (ft, unit) => Math.round(fromFt(ft, unit));

export const pct = (makes, attempts) => (attempts ? (makes / attempts) * 100 : 0);

export function sessionTotals(session) {
  let attempts = 0;
  let makes = 0;
  for (const r of session.results) {
    attempts += r.attempts;
    makes += r.makes;
  }
  return { attempts, makes, pct: pct(makes, attempts) };
}

/** Aggregate makes/attempts by rounded distance in the display unit. */
export function byDistance(sessions, unit) {
  const map = new Map();
  for (const s of sessions) {
    for (const r of s.results) {
      if (!r.attempts) continue;
      const d = displayDistance(r.ft, unit);
      const cur = map.get(d) || { distance: d, attempts: 0, makes: 0 };
      cur.attempts += r.attempts;
      cur.makes += r.makes;
      map.set(d, cur);
    }
  }
  return [...map.values()]
    .map((x) => ({ ...x, pct: pct(x.makes, x.attempts) }))
    .sort((a, b) => a.distance - b.distance);
}

/** Make % per session at one distance (display unit), oldest first. */
export function distanceTrend(sessions, unit, distance) {
  const out = [];
  for (const s of [...sessions].sort((a, b) => a.date.localeCompare(b.date))) {
    let attempts = 0;
    let makes = 0;
    for (const r of s.results) {
      if (displayDistance(r.ft, unit) === distance) {
        attempts += r.attempts;
        makes += r.makes;
      }
    }
    if (attempts) out.push({ date: s.date, attempts, makes, pct: pct(makes, attempts) });
  }
  return out;
}

/** Overall make % per session, oldest first. */
export function overallTrend(sessions) {
  return [...sessions]
    .sort((a, b) => a.date.localeCompare(b.date))
    .map((s) => ({ date: s.date, ...sessionTotals(s) }))
    .filter((p) => p.attempts);
}

// ---- JYLY ----------------------------------------------------------------
// 20 rounds of 5 putts. Start at 10 m. After each round the next distance is
// 5 m + number of makes (0 makes -> 5 m, 5 makes -> 10 m).
// Score per round = distance (m) * makes. Max 1000.
export const JYLY_ROUNDS = 20;
export const JYLY_PUTTS = 5;
export const JYLY_START_M = 10;

export const jylyNextDistance = (makes) => 5 + makes;

export function jylyScore(rounds) {
  return rounds.reduce((sum, r) => sum + r.distanceM * r.makes, 0);
}

export function jylyCurrentDistance(rounds) {
  return rounds.length ? jylyNextDistance(rounds[rounds.length - 1].makes) : JYLY_START_M;
}

export function jylyToResults(rounds) {
  return rounds.map((r) => ({ ft: toFt(r.distanceM, 'm'), attempts: JYLY_PUTTS, makes: r.makes }));
}

// ---- Perfect Putt 360 ------------------------------------------------------
// Two rounds of five stations (10, 15, 20, 25, 30 ft, or 3-9 m), 10 putts each.
// Every make scores, with bonuses for holing the first putt, the last putt and
// all ten. The last station counts double per make. A perfect station scores
// 19 / 25 / 32 / 41 / 63, so a perfect game is 2 x 180 = 360.
export const PP360_FT = [10, 15, 20, 25, 30];
export const PP360_M = [3, 4.5, 6, 7.5, 9];
export const PP360_PUTTS = 10;
export const PP360_ROUNDS = 2;
export const PP360_STATIONS = PP360_FT.length * PP360_ROUNDS;
export const PP360_MAX = 360;
export const PP360_POINTS = {
  make: [1, 1, 1, 1, 2],
  first: [2, 2, 3, 5, 8],
  last: [2, 3, 4, 6, 10],
  all: [5, 10, 15, 20, 25],
};

/** Score for the i-th station played (0-9): { makes, first, last }. */
export function pp360StationScore(i, st) {
  const d = i % PP360_FT.length;
  const P = PP360_POINTS;
  return st.makes * P.make[d] + (st.first ? P.first[d] : 0) + (st.last ? P.last[d] : 0)
    + (st.makes >= PP360_PUTTS ? P.all[d] : 0);
}

export const pp360Score = (stations) => stations.reduce((sum, st, i) => sum + pp360StationScore(i, st), 0);

/** Make counts that are possible given whether the first and last putt went in. */
export const pp360MakesRange = (first, last) => ({
  min: (first ? 1 : 0) + (last ? 1 : 0),
  max: PP360_PUTTS - (first ? 0 : 1) - (last ? 0 : 1),
});

export function pp360ToResults(stations) {
  return stations.map((st, i) => ({ ft: PP360_FT[i % PP360_FT.length], attempts: PP360_PUTTS, makes: st.makes }));
}

// ---- Dates ---------------------------------------------------------------
export const dayKey = (iso) => iso.slice(0, 10);

/** Consecutive days (ending today or yesterday) with at least one session. */
export function currentStreak(sessions, todayKey) {
  const days = new Set(sessions.map((s) => dayKey(s.date)));
  const step = (key, n) => {
    const d = new Date(key + 'T12:00:00Z');
    d.setUTCDate(d.getUTCDate() + n);
    return d.toISOString().slice(0, 10);
  };
  let cursor = days.has(todayKey) ? todayKey : step(todayKey, -1);
  let streak = 0;
  while (days.has(cursor)) {
    streak++;
    cursor = step(cursor, -1);
  }
  return streak;
}

export function sessionsSince(sessions, sinceIso) {
  return sessions.filter((s) => s.date >= sinceIso);
}

// ---- Practice zone (target make %) ------------------------------------------
// Idea: practise at the distance where you make about 85% of putts. These
// helpers answer "what is my real % at that distance?" and "which distance is
// my 85% distance?" with enough statistics to know when the sample is too small.

/** Makes/attempts at one distance in whole feet, across all sessions. */
export function atFeet(sessions, ft) {
  let attempts = 0;
  let makes = 0;
  for (const s of sessions) {
    for (const r of s.results) {
      if (Math.round(r.ft) === ft) {
        attempts += r.attempts;
        makes += r.makes;
      }
    }
  }
  return { attempts, makes, pct: pct(makes, attempts) };
}

/**
 * Wilson score interval for a make %, returned in percent. With a 95% default
 * this is the range your true make % very likely sits in, given the putts so far.
 */
export function wilson(makes, attempts, z = 1.96) {
  if (!attempts) return { lo: 0, hi: 100 };
  const p = makes / attempts;
  const z2 = z * z;
  const denom = 1 + z2 / attempts;
  const centre = (p + z2 / (2 * attempts)) / denom;
  const half = (z * Math.sqrt((p * (1 - p)) / attempts + z2 / (4 * attempts * attempts))) / denom;
  return { lo: Math.max(0, centre - half) * 100, hi: Math.min(1, centre + half) * 100 };
}

/**
 * Is this distance in the practice zone (target ± band, in %)?
 *  need-more    fewer than minAttempts putts; no call yet
 *  too-hard     even the top of the 95% range is below the zone
 *  too-easy     even the bottom of the 95% range is above the zone
 *  in-zone      make % is inside the zone
 *  leaning-hard / leaning-easy  outside the zone, but not conclusively yet
 */
export function zoneVerdict({ makes, attempts }, { target = 85, band = 5, minAttempts = 50 } = {}) {
  const p = pct(makes, attempts);
  const { lo, hi } = wilson(makes, attempts);
  const base = { pct: p, lo, hi, attempts, needed: Math.max(0, minAttempts - attempts) };
  if (attempts < minAttempts) return { ...base, status: 'need-more' };
  if (hi < target - band) return { ...base, status: 'too-hard' };
  if (lo > target + band) return { ...base, status: 'too-easy' };
  if (p >= target - band && p <= target + band) return { ...base, status: 'in-zone' };
  return { ...base, status: p < target ? 'leaning-hard' : 'leaning-easy' };
}

/**
 * Estimate the distance (ft) where make % crosses the target, by straight-line
 * interpolation between the two logged distances either side of it. Only
 * distances with at least minAttempts putts count.
 * Returns { ft, kind } where kind is 'between', 'beyond' (you beat the target at
 * every distance; ft is the furthest one) or 'inside' (you miss it at every
 * distance; ft is the closest one); null when there is no usable data.
 */
export function targetDistance(sessions, { target = 85, minAttempts = 20 } = {}) {
  const rows = byDistance(sessions, 'ft').filter((r) => r.attempts >= minAttempts);
  if (!rows.length) return null;
  for (let i = 0; i < rows.length - 1; i++) {
    const a = rows[i];
    const b = rows[i + 1];
    if (a.pct >= target && b.pct < target) {
      const f = (a.pct - target) / (a.pct - b.pct);
      return { ft: a.distance + f * (b.distance - a.distance), kind: 'between' };
    }
  }
  if (rows.every((r) => r.pct >= target)) return { ft: rows.at(-1).distance, kind: 'beyond' };
  if (rows.every((r) => r.pct < target)) return { ft: rows[0].distance, kind: 'inside' };
  // Non-monotonic data (e.g. better at 20 than 15): use the distance closest to target.
  const best = [...rows].sort((x, y) => Math.abs(x.pct - target) - Math.abs(y.pct - target))[0];
  return { ft: best.distance, kind: 'between' };
}

// ---- Sets (putting with several discs) -------------------------------------
// With N putters you throw N putts, walk to the basket and count. A "set" is
// one of those throw-ins: { ft, attempts, makes }.
export const MAX_PUTTERS = 12;

/** Discs in the next set: all your putters, or fewer if the station is nearly done. */
export const nextSetSize = (putters, puttsLeft) => Math.max(0, Math.min(putters, puttsLeft));

/** Summary of a list of sets: how many, how many were clean (all made), make counts. */
export function setStats(sets) {
  const full = sets.filter((s) => s.attempts > 0);
  const clean = full.filter((s) => s.makes === s.attempts).length;
  const makes = full.reduce((n, s) => n + s.makes, 0);
  const attempts = full.reduce((n, s) => n + s.attempts, 0);
  return { count: full.length, clean, makes, attempts, avgMakes: full.length ? makes / full.length : 0 };
}

/**
 * A routine counts each station in putts ({ distance, putts }) or, with
 * count: 'sets', in sets of your putters ({ distance, sets }). This turns either
 * into concrete { distance, putts } stations for a session.
 */
export function expandStations(routine, putters) {
  const p = Math.max(1, putters || 1);
  return routine.stations.map((s) =>
    routine.count === 'sets'
      ? { distance: s.distance, putts: (s.sets || 1) * p }
      : { distance: s.distance, putts: s.putts });
}

// ---- Standard distances ----------------------------------------------------
// Every distance you can pick comes from these lists, so stats pile up at the
// same marks instead of scattering across 17, 19, 22 ft... 10-30 ft in 5 ft
// steps is the common practice ladder; 18 ft is the zone default; 33 ft (10 m)
// is the edge of Circle 1 and 66 ft (20 m) the edge of Circle 2.
export const STANDARD_FT = [10, 15, 18, 20, 25, 30, 33, 40, 50, 66];
export const STANDARD_M = [3, 4, 5, 6, 7, 8, 9, 10, 15, 20];
export const standardDistances = (unit) => (unit === 'm' ? STANDARD_M : STANDARD_FT);

/** The standard distance closest to a value (same unit), for switching units. */
export function nearestStandard(value, unit) {
  return standardDistances(unit).reduce((best, d) => (Math.abs(d - value) < Math.abs(best - value) ? d : best));
}

/** The next standard distance (ft) further out (dir 1) or closer in (dir -1); null at the ends. */
export function stepStandard(ft, dir) {
  const i = STANDARD_FT.indexOf(ft);
  return i < 0 ? null : STANDARD_FT[i + dir] ?? null;
}

/**
 * Where to practise next, given a zone verdict at a standard distance: one mark
 * back when it is clearly too easy, one mark in when clearly too hard, else
 * null (stay put - including while the verdict is only "leaning").
 */
export function zoneMove(status, ft) {
  if (status === 'too-easy') return stepStandard(ft, 1);
  if (status === 'too-hard') return stepStandard(ft, -1);
  return null;
}

/**
 * Progress through a station session: putts logged against putts planned, per
 * station and overall. Skipped stations count as finished so the bar keeps moving.
 */
export function sessionProgress(stations, log, stationIdx = 0) {
  const parts = stations.map((st, i) => {
    const done = Math.min(log[i]?.length || 0, st.putts);
    return { putts: st.putts, done, fraction: i < stationIdx ? 1 : st.putts ? done / st.putts : 1 };
  });
  const total = parts.reduce((n, p) => n + p.putts, 0);
  const done = parts.reduce((n, p) => n + p.putts * p.fraction, 0);
  return { parts, total, fraction: total ? done / total : 0 };
}
