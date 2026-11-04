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
