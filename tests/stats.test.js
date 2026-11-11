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

test('atFeet sums putts at one distance only', () => {
  const t = S.atFeet([
    session('2026-01-01', [{ ft: 18, attempts: 10, makes: 9 }, { ft: 20, attempts: 10, makes: 5 }]),
    session('2026-01-02', [{ ft: 18.0001, attempts: 10, makes: 8 }]),
  ], 18);
  assert.deepEqual(t, { attempts: 20, makes: 17, pct: 85 });
});

test('wilson interval brackets the observed % and narrows with more putts', () => {
  const small = S.wilson(17, 20);
  const big = S.wilson(170, 200);
  assert.ok(small.lo < 85 && small.hi > 85);
  assert.ok(big.lo > small.lo && big.hi < small.hi);
  assert.ok(Math.abs(big.lo - 79.4) < 0.5 && Math.abs(big.hi - 89.4) < 0.5);
  assert.deepEqual(S.wilson(0, 0), { lo: 0, hi: 100 });
  assert.equal(S.wilson(10, 10).hi, 100);
});

test('zoneVerdict needs enough putts, then calls the zone', () => {
  assert.equal(S.zoneVerdict({ makes: 9, attempts: 10 }).status, 'need-more');
  assert.equal(S.zoneVerdict({ makes: 9, attempts: 10 }).needed, 40);
  assert.equal(S.zoneVerdict({ makes: 43, attempts: 50 }).status, 'in-zone');
  assert.equal(S.zoneVerdict({ makes: 120, attempts: 200 }).status, 'too-hard');
  assert.equal(S.zoneVerdict({ makes: 198, attempts: 200 }).status, 'too-easy');
  assert.equal(S.zoneVerdict({ makes: 38, attempts: 50 }).status, 'leaning-hard');
  assert.equal(S.zoneVerdict({ makes: 48, attempts: 50 }).status, 'leaning-easy');
});

test('targetDistance interpolates where make % crosses the target', () => {
  const s = [session('2026-01-01', [
    { ft: 15, attempts: 20, makes: 19 }, // 95%
    { ft: 20, attempts: 20, makes: 15 }, // 75%
    { ft: 30, attempts: 5, makes: 0 }, // too few putts, ignored
  ])];
  assert.deepEqual(S.targetDistance(s), { ft: 17.5, kind: 'between' });
  assert.deepEqual(S.targetDistance([session('x', [{ ft: 18, attempts: 30, makes: 29 }])]), { ft: 18, kind: 'beyond' });
  assert.deepEqual(S.targetDistance([session('x', [{ ft: 18, attempts: 30, makes: 10 }])]), { ft: 18, kind: 'inside' });
  assert.equal(S.targetDistance([]), null);
});

test('nextSetSize uses all putters until the station runs short', () => {
  assert.equal(S.nextSetSize(6, 10), 6);
  assert.equal(S.nextSetSize(6, 4), 4);
  assert.equal(S.nextSetSize(6, 0), 0);
  assert.equal(S.nextSetSize(1, 10), 1);
});

test('setStats counts sets, clean sets and average makes', () => {
  const st = S.setStats([
    { ft: 18, attempts: 6, makes: 6 },
    { ft: 18, attempts: 6, makes: 4 },
    { ft: 18, attempts: 4, makes: 4 },
  ]);
  assert.deepEqual(st, { count: 3, clean: 2, makes: 14, attempts: 16, avgMakes: 14 / 3 });
  assert.equal(S.setStats([]).avgMakes, 0);
});

test('expandStations turns sets into putts using the putter count', () => {
  const sets = { count: 'sets', stations: [{ distance: 18, sets: 8 }, { distance: 21, sets: 2 }] };
  assert.deepEqual(S.expandStations(sets, 6), [{ distance: 18, putts: 48 }, { distance: 21, putts: 12 }]);
  assert.deepEqual(S.expandStations(sets, 1), [{ distance: 18, putts: 8 }, { distance: 21, putts: 2 }]);
  const putts = { stations: [{ distance: 10, putts: 10 }] };
  assert.deepEqual(S.expandStations(putts, 6), [{ distance: 10, putts: 10 }]);
});

test('standard distances: 18 ft default is listed, nearestStandard snaps', () => {
  assert.ok(S.STANDARD_FT.includes(18) && S.STANDARD_FT.includes(33));
  assert.deepEqual([...S.STANDARD_FT].sort((a, b) => a - b), S.STANDARD_FT);
  assert.equal(S.nearestStandard(28, 'ft'), 30);
  assert.equal(S.nearestStandard(17, 'ft'), 18);
  assert.equal(S.nearestStandard(S.fromFt(18, 'm'), 'm'), 5);
  assert.equal(S.nearestStandard(60, 'ft'), 66);
});
