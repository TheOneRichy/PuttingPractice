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

test('stepStandard walks the standard marks and stops at the ends', () => {
  assert.equal(S.stepStandard(18, 1), 20);
  assert.equal(S.stepStandard(18, -1), 15);
  assert.equal(S.stepStandard(10, -1), null);
  assert.equal(S.stepStandard(66, 1), null);
  assert.equal(S.stepStandard(17, 1), null);
});

test('atDistance groups putts by whole metres or feet', () => {
  const sessions = [{ results: [
    { ft: 18, attempts: 10, makes: 8 }, // 5.49 m -> 5 m
    { ft: S.toFt(5, 'm'), attempts: 10, makes: 6 },
    { ft: 20, attempts: 10, makes: 5 }, // 6.1 m -> 6 m
  ] }];
  assert.deepEqual(S.atDistance(sessions, 'm', 5), { attempts: 20, makes: 14, pct: 70 });
  assert.equal(S.atDistance(sessions, 'm', 6).attempts, 10);
  assert.equal(S.atDistance(sessions, 'ft', 18).attempts, 10);
});

test('metric zone marks step in whole metres', () => {
  assert.equal(S.stepStandard(5, 1, 'm'), 6);
  assert.equal(S.zoneMove('too-hard', 5, 'm'), 4);
  assert.equal(S.zoneMove('too-easy', 20, 'm'), null);
});

test('routineIn rounds a routine to whole distances in the other unit', () => {
  const ladder = { name: 'Ladder', unit: 'ft', count: 'sets', stations: [10, 15, 20, 25, 30].map((d) => ({ distance: d, sets: 2 })) };
  const m = S.routineIn(ladder, 'm');
  assert.equal(m.unit, 'm');
  assert.deepEqual(m.stations.map((s) => s.distance), [3, 5, 6, 8, 9]);
  assert.equal(m.stations[0].sets, 2);
  assert.equal(S.routineIn(ladder, 'ft'), ladder);
  assert.deepEqual(S.routineIn({ unit: 'm', stations: [{ distance: 6, putts: 10 }] }, 'ft').stations, [{ distance: 20, putts: 10 }]);
  const jyly = { kind: 'jyly', unit: 'm', stations: [] };
  assert.equal(S.routineIn(jyly, 'ft'), jyly);
});

test('zoneMove only moves on a clear verdict', () => {
  assert.equal(S.zoneMove('too-easy', 18), 20);
  assert.equal(S.zoneMove('too-hard', 18), 15);
  assert.equal(S.zoneMove('in-zone', 18), null);
  assert.equal(S.zoneMove('leaning-easy', 18), null);
  assert.equal(S.zoneMove('need-more', 18), null);
  assert.equal(S.zoneMove('too-easy', 66), null);
});

test('sessionProgress weights stations by putts and counts skipped ones as done', () => {
  const stations = [{ distance: 10, putts: 10 }, { distance: 20, putts: 30 }];
  const p = S.sessionProgress(stations, [[true, false, true, true, true], []], 0);
  assert.equal(p.total, 40);
  assert.equal(p.parts[0].fraction, 0.5);
  assert.equal(p.fraction, 5 / 40);
  const skipped = S.sessionProgress(stations, [[true], [true, true, true]], 1);
  assert.equal(skipped.parts[0].fraction, 1);
  assert.equal(skipped.fraction, (10 + 3) / 40);
});

test('Perfect Putt 360 scoring', () => {
  const st = (makes, first, last) => ({ makes, first: first === 'y', last: last === 'y' });
  const perfect = Array.from({ length: S.PP360_STATIONS }, () => st(10, 'y', 'y'));
  assert.deepEqual(perfect.slice(0, 5).map((x, i) => S.pp360StationScore(i, x)), [19, 25, 32, 41, 63]);
  assert.equal(S.pp360Score(perfect), 360);
  // A real card: 19 14 14 3 16 / 13 12 15 11 16 = 133
  const card = [
    st(10, 'y', 'y'), st(9, 'y', 'y'), st(7, 'y', 'y'), st(3, 'n', 'n'), st(4, 'y', 'n'),
    st(9, 'y', 'y'), st(7, 'y', 'y'), st(8, 'y', 'y'), st(6, 'y', 'n'), st(4, 'y', 'n'),
  ];
  assert.deepEqual(card.map((x, i) => S.pp360StationScore(i, x)), [19, 14, 14, 3, 16, 13, 12, 15, 11, 16]);
  assert.equal(S.pp360Score(card), 133);
  assert.equal(S.pp360StationScore(1, st(9, 'n', 'y')), 12); // last only
  assert.equal(S.pp360StationScore(4, st(4, 'y', 'y')), 26); // makes count double at the last station
  assert.deepEqual(S.pp360MakesRange(false, false), { min: 0, max: 8 });
  assert.deepEqual(S.pp360MakesRange(true, false), { min: 1, max: 9 });
  assert.deepEqual(S.pp360MakesRange(true, true), { min: 2, max: 10 });
  const res = S.pp360ToResults(card);
  assert.deepEqual(res[6], { ft: 15, attempts: 10, makes: 7 });
  assert.equal(S.atFeet([{ results: res }], 10).makes, 19);
});

test('feedbackMailto addresses Richard and carries the message and details', () => {
  const link = S.feedbackMailto('  The chart is blank & 50% off\nsecond line ', '3 sessions logged, feet');
  const [to, query] = link.slice('mailto:'.length).split('?');
  assert.ok(link.startsWith('mailto:'));
  assert.equal(to, S.FEEDBACK_EMAIL);
  assert.ok(!query.includes('+'));
  const q = new URLSearchParams(query);
  assert.equal(q.get('subject'), 'Putting Practice feedback');
  assert.equal(q.get('body'), 'The chart is blank & 50% off\nsecond line\n\n--\n3 sessions logged, feet');
  assert.ok(!S.feedbackMailto('hi').includes('--'));
});

test('feedbackPayload carries the key, the message with details, and the sender when given', () => {
  const p = S.feedbackPayload('k', { message: ' Love it ', name: ' Sam ', details: '3 sessions logged, feet' });
  assert.deepEqual(p, {
    access_key: 'k', subject: 'Putting Practice feedback from Sam', from_name: 'Sam',
    message: 'Love it\n\n--\n3 sessions logged, feet',
  });
  const anon = S.feedbackPayload('k', { message: 'hi' });
  assert.equal(anon.subject, 'Putting Practice feedback');
  assert.equal(anon.from_name, 'Putting Practice');
  assert.equal(anon.message, 'hi');
});
