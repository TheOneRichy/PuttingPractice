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
