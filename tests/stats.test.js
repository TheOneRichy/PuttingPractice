import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as S from '../src/stats.js';

const session = (date, results, extra = {}) => ({ id: date, date, results, ...extra });

test('unit conversion round-trips', () => {
  assert.equal(S.displayDistance(S.toFt(10, 'm'), 'm'), 10);
  assert.equal(S.displayDistance(S.toFt(10, 'm'), 'ft'), 33);
  assert.equal(S.displayDistance(20, 'ft'), 20);
});

test('sessionTotals sums all stations', () => {
  const t = S.sessionTotals(session('2026-01-01', [
    { ft: 10, attempts: 10, makes: 9 },
    { ft: 20, attempts: 10, makes: 6 },
  ]));
  assert.deepEqual(t, { attempts: 20, makes: 15, pct: 75 });
});

test('byDistance groups across sessions and sorts by distance', () => {
  const rows = S.byDistance([
    session('2026-01-01', [{ ft: 20, attempts: 10, makes: 5 }, { ft: 10, attempts: 10, makes: 10 }]),
    session('2026-01-02', [{ ft: 20, attempts: 10, makes: 7 }]),
  ], 'ft');
  assert.deepEqual(rows.map((r) => [r.distance, r.makes, r.attempts]), [[10, 10, 10], [20, 12, 20]]);
  assert.equal(rows[1].pct, 60);
});

test('distanceTrend returns one point per session that putted at that distance', () => {
  const pts = S.distanceTrend([
    session('2026-01-03', [{ ft: 20, attempts: 10, makes: 8 }]),
    session('2026-01-01', [{ ft: 20, attempts: 10, makes: 4 }]),
    session('2026-01-02', [{ ft: 30, attempts: 10, makes: 4 }]),
  ], 'ft', 20);
  assert.deepEqual(pts.map((p) => p.pct), [40, 80]);
});

test('JYLY distance and scoring', () => {
  assert.equal(S.jylyCurrentDistance([]), 10);
  const rounds = [{ distanceM: 10, makes: 3 }];
  assert.equal(S.jylyCurrentDistance(rounds), 8);
  rounds.push({ distanceM: 8, makes: 0 });
  assert.equal(S.jylyCurrentDistance(rounds), 5);
  assert.equal(S.jylyScore(rounds), 30);
  const perfect = Array.from({ length: 20 }, () => ({ distanceM: 10, makes: 5 }));
  assert.equal(S.jylyScore(perfect), 1000);
  assert.equal(S.jylyToResults(rounds)[0].attempts, 5);
});

test('currentStreak counts consecutive days ending today or yesterday', () => {
  const s = ['2026-03-10T10:00:00Z', '2026-03-09T10:00:00Z', '2026-03-08T10:00:00Z', '2026-03-05T10:00:00Z']
    .map((d) => session(d, []));
  assert.equal(S.currentStreak(s, '2026-03-10'), 3);
  assert.equal(S.currentStreak(s, '2026-03-11'), 3);
  assert.equal(S.currentStreak(s, '2026-03-12'), 0);
});
