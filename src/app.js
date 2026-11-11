import * as S from './stats.js';
import { load, save, uid, validateImport, DEFAULT_ROUTINES } from './store.js';

let state = load();
const app = document.getElementById('app');
const persist = () => save(state);

// ---- helpers -------------------------------------------------------------
const esc = (v) =>
  String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const unit = () => state.settings.unit;
const fmtPct = (p) => `${Math.round(p)}%`;
const fmtDate = (iso) =>
  new Date(iso).toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });
const todayKey = () => {
  const d = new Date();
  return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
};
const routineSummary = (r) => {
  if (r.kind === 'jyly') return '20 rounds × 5 putts, 5–10 m';
  if (r.count === 'sets') {
    const p = puttersPref();
    const sets = r.stations.reduce((n, s) => n + s.sets, 0);
    const st = r.stations;
    const dists = `${st.map((s) => s.distance).join(' · ')} ${r.unit}`;
    const plural = (n) => `${n} set${n === 1 ? '' : 's'}`;
    const where = st.length === 1 ? `${plural(sets)} at ${dists}`
      : st.every((s) => s.sets === st[0].sets) ? `${plural(st[0].sets)} each at ${dists}`
      : `${plural(sets)} across ${dists}`;
    return `${where} · ${sets * p} putts with ${p} putter${p === 1 ? '' : 's'}`;
  }
  const total = r.stations.reduce((n, s) => n + s.putts, 0);
  const st = r.stations;
  if (st.length > 1 && st.every((s) => s.distance === st[0].distance && s.putts === st[0].putts)) {
    return `${st.length} × ${st[0].putts} putts at ${st[0].distance} ${r.unit} · ${total} putts`;
  }
  return st.map((s) => `${s.distance}`).join(' · ') + ` ${r.unit} · ${total} putts`;
};

// ---- putters / sets ---------------------------------------------------------
const clampPutters = (n) => Math.min(S.MAX_PUTTERS, Math.max(1, Math.round(Number(n)) || 1));
const puttersPref = () => clampPutters(state.settings.putters);
const puttersSelect = (id, value) => `<select id="${id}" aria-label="Putters per set">${
  Array.from({ length: S.MAX_PUTTERS }, (_, i) => i + 1)
    .map((n) => `<option value="${n}" ${n === value ? 'selected' : ''}>${n === 1 ? '1 (tap each putt)' : n}</option>`)
    .join('')}</select>`;
/** "6 · 4 · 5" plus clean-set count, for finish screen and history. */
function setsLine(sets) {
  if (!sets?.length) return '';
  const st = S.setStats(sets);
  return `Sets: ${sets.map((x) => (x.makes === x.attempts ? `<strong>${x.makes}</strong>` : x.makes)).join(' · ')}
    <span class="muted">· ${st.clean} of ${st.count} clean · avg ${st.avgMakes.toFixed(1)} made</span>`;
}

// ---- practice zone ---------------------------------------------------------
const zoneFt = () => Number(state.settings.zoneFt) || 18;
const zoneTarget = () => Number(state.settings.zoneTarget) || 85;
const ZONE_MIN = 50; // putts before the app makes a call
const ZONE_BAND = 5; // ± % around the target that counts as "in the zone"
const fmtDist = (ft) => (unit() === 'm' ? `${S.fromFt(ft, 'm').toFixed(1)} m` : `${Math.round(ft)} ft`);
const zoneMessages = {
  'need-more': (v) => `Not enough putts yet for a reliable number. About <strong>${v.needed}</strong> more and the app will make a call.`,
  'in-zone': () => 'You are in the zone at this distance. Keep practising here.',
  'too-hard': () => 'Clearly below the zone. Move a step or two closer.',
  'too-easy': () => 'Clearly above the zone. Move a step or two back.',
  'leaning-hard': () => 'Leaning below the zone, but not certain yet. Keep logging putts here.',
  'leaning-easy': () => 'Leaning above the zone, but not certain yet. Keep logging putts here.',
};
const zoneTone = { 'in-zone': 'up', 'too-hard': 'down', 'too-easy': 'down' };

/** Zone verdict at the focus distance, using the last 30 days when there are enough putts. */
function zoneReport(sessions) {
  const ft = zoneFt();
  const opts = { target: zoneTarget(), band: ZONE_BAND, minAttempts: ZONE_MIN };
  const all = S.atFeet(sessions, ft);
  const recent = S.atFeet(S.sessionsSince(sessions, new Date(Date.now() - 30 * 864e5).toISOString()), ft);
  const useRecent = recent.attempts >= ZONE_MIN && recent.attempts < all.attempts;
  const v = S.zoneVerdict(useRecent ? recent : all, opts);
  return { ft, all, recent, useRecent, v };
}

const go = (hash) => {
  if (location.hash === '#' + hash) render();
  else location.hash = hash;
};

// ---- charts --------------------------------------------------------------
function lineChart(points, { yMax = 100, suffix = '%', label = '' } = {}) {
  if (points.length < 2) {
    return `<p class="muted small">Log at least two sessions to see a trend.</p>`;
  }
  const W = 320, H = 170, L = 34, R = 10, T = 12, B = 26;
  const x = (i) => L + (i * (W - L - R)) / (points.length - 1);
  const y = (v) => T + (1 - v / yMax) * (H - T - B);
  const ticks = [0, 0.25, 0.5, 0.75, 1].map((f) => Math.round(f * yMax));
  const path = points.map((p, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(p.value).toFixed(1)}`).join(' ');
  // 5-point rolling average to show the underlying trend.
  const avg = points.map((_, i) => {
    const w = points.slice(Math.max(0, i - 4), i + 1);
    return w.reduce((n, p) => n + p.value, 0) / w.length;
  });
  const avgPath = avg.map((v, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(' ');
  const short = (iso) => new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  return `
  <svg class="chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(label)}">
    ${ticks.map((t) => `<line class="grid" x1="${L}" x2="${W - R}" y1="${y(t)}" y2="${y(t)}"/>
      <text class="axis" x="${L - 6}" y="${y(t) + 3}" text-anchor="end">${t}${suffix}</text>`).join('')}
    <path class="line-raw" d="${path}"/>
    <path class="line-avg" d="${avgPath}"/>
    ${points.map((p, i) => `<circle class="dot" cx="${x(i)}" cy="${y(p.value)}" r="2.6"><title>${short(p.date)}: ${Math.round(p.value)}${suffix}</title></circle>`).join('')}
    <text class="axis" x="${L}" y="${H - 6}">${short(points[0].date)}</text>
    <text class="axis" x="${W - R}" y="${H - 6}" text-anchor="end">${short(points.at(-1).date)}</text>
  </svg>
  <p class="legend small"><span class="key raw"></span>each session <span class="key avg"></span>5-session average</p>`;
}

// ---- views ---------------------------------------------------------------
const tabs = [
  ['practice', 'Practice'],
  ['history', 'History'],
  ['progress', 'Progress'],
  ['routines', 'Routines'],
  ['settings', 'Settings'],
];

function shell(active, body) {
  return `
  <header class="top"><h1>Putting Practice</h1></header>
  <main>${body}</main>
  <nav class="tabs">${tabs
    .map(([id, label]) => `<a href="#${id}" class="${id === active ? 'on' : ''}">${label}</a>`)
    .join('')}</nav>`;
}

function viewPractice() {
  const resume = state.active
    ? `<div class="card accent"><strong>Session in progress</strong>
        <p class="muted">${esc(state.active.routineName)}</p>
        <div class="row"><a class="btn primary" href="#session">Resume</a>
        <button class="btn ghost" data-action="discard">Discard</button></div></div>`
    : '';
  const today = S.sessionsSince(state.sessions, todayKey());
  const todayTot = today.reduce((a, s) => { const t = S.sessionTotals(s); a.m += t.makes; a.a += t.attempts; return a; }, { m: 0, a: 0 });
  return shell('practice', `
    ${resume}
    <section class="stats-row">
      <div class="stat"><span class="num">${S.currentStreak(state.sessions, todayKey())}</span><span class="lbl">day streak</span></div>
      <div class="stat"><span class="num">${todayTot.a}</span><span class="lbl">putts today</span></div>
      <div class="stat"><span class="num">${todayTot.a ? fmtPct(S.pct(todayTot.m, todayTot.a)) : '–'}</span><span class="lbl">today</span></div>
    </section>
    <h2>Start a routine</h2>
    <label class="field inline">Putters per set ${puttersSelect('putters-pref', puttersPref())}</label>
    <p class="muted small">Throw them all, walk up, then tap how many went in.</p>
    <ul class="list">${state.routines
      .map((r) => `<li><button class="routine" data-action="start" data-id="${r.id}" ${state.active ? 'disabled' : ''}>
        <strong>${esc(r.name)}</strong><span class="muted small">${esc(routineSummary(r))}</span></button></li>`)
      .join('')}</ul>
    <p><a class="btn ghost full" href="#quicklog">Log a session after the fact</a></p>`);
}

function viewSession() {
  const a = state.active;
  if (!a) return viewPractice();
  if (a.kind === 'jyly') return viewJyly(a);
  if (a.finishedEarly || a.stationIdx >= a.stations.length) return viewFinish(a);
  const st = a.stations[a.stationIdx];
  const log = a.log[a.stationIdx];
  const makes = log.filter(Boolean).length;
  const sofar = a.log.flat();
  const sofarMakes = sofar.filter(Boolean).length;
  const putters = clampPutters(a.putters);
  const size = S.nextSetSize(putters, st.putts - log.length);
  const pip = (i) => `<span class="pip ${i < log.length ? (log[i] ? 'make' : 'miss') : ''}"></span>`;
  const pips = putters > 1
    ? Array.from({ length: Math.ceil(st.putts / putters) }, (_, g) =>
        `<span class="pip-set">${Array.from({ length: Math.min(putters, st.putts - g * putters) }, (_, k) => pip(g * putters + k)).join('')}</span>`).join('')
    : Array.from({ length: st.putts }, (_, i) => pip(i)).join('');
  const entry = putters > 1
    ? `<p class="progress-text">Set ${Math.floor(log.length / putters) + 1} of ${Math.ceil(st.putts / putters)} · how many of <strong>${size}</strong> went in?</p>
      <div class="makes-grid ${size + 1 > 6 ? 'four' : ''}">${Array.from({ length: size + 1 }, (_, n) =>
        `<button class="big ${n === size ? 'make' : n === 0 ? 'miss' : ''}" data-action="set" data-makes="${n}">${n}</button>`).join('')}</div>`
    : `<div class="bigbtns">
        <button class="big miss" data-action="putt" data-made="0">Miss</button>
        <button class="big make" data-action="putt" data-made="1">Make</button>
      </div>`;
  return shell('practice', `
    <div class="session">
      <p class="muted">${esc(a.routineName)} · station ${a.stationIdx + 1} of ${a.stations.length}</p>
      <div class="distance">${st.distance}<small> ${a.unit}</small></div>
      <p class="progress-text">Putt ${Math.min(log.length + 1, st.putts)} of ${st.putts} · <strong>${makes}</strong> made</p>
      <div class="pips">${pips}</div>
      ${sofar.length ? `<p class="muted small">Session so far: ${sofarMakes}/${sofar.length} · <strong>${fmtPct(S.pct(sofarMakes, sofar.length))}</strong></p>` : ''}
      ${entry}
      <label class="field inline small">Putters ${puttersSelect('session-putters', putters)}</label>
      <div class="row">
        <button class="btn ghost" data-action="undo" ${sofar.length ? '' : 'disabled'}>Undo</button>
        <button class="btn ghost" data-action="skip">Skip station</button>
        <button class="btn ghost" data-action="finish-early">Finish now</button>
      </div>
    </div>`);
}

function viewJyly(a) {
  if (a.finishedEarly || a.rounds.length >= S.JYLY_ROUNDS) return viewFinish(a);
  const dist = S.jylyCurrentDistance(a.rounds);
  return shell('practice', `
    <div class="session">
      <p class="muted">JYLY · round ${a.rounds.length + 1} of ${S.JYLY_ROUNDS} · score <strong>${S.jylyScore(a.rounds)}</strong></p>
      <div class="distance">${dist}<small> m</small></div>
      <p class="progress-text">${(dist * S.FT_PER_M).toFixed(0)} ft · how many of 5 went in?</p>
      <div class="makes-grid">${[0, 1, 2, 3, 4, 5]
        .map((n) => `<button class="big ${n === 5 ? 'make' : n === 0 ? 'miss' : ''}" data-action="jyly" data-makes="${n}">${n}</button>`)
        .join('')}</div>
      <div class="row">
        <button class="btn ghost" data-action="undo" ${a.rounds.length ? '' : 'disabled'}>Undo</button>
        <button class="btn ghost" data-action="finish-early">Finish now</button>
      </div>
    </div>`);
}

function buildResults(a) {
  if (a.kind === 'jyly') return S.jylyToResults(a.rounds);
  return a.stations
    .map((st, i) => ({ ft: S.toFt(st.distance, a.unit), attempts: a.log[i].length, makes: a.log[i].filter(Boolean).length }))
    .filter((r) => r.attempts);
}

/** Sets entered as "how many of N went in" during a station session. */
function buildSets(a) {
  return (a.history || []).filter((h) => h.set)
    .map((h) => ({ ft: S.toFt(a.stations[h.station].distance, a.unit), attempts: h.n, makes: h.makes }));
}

function viewFinish(a) {
  const results = buildResults(a);
  const tot = S.sessionTotals({ results });
  const rows = a.kind === 'jyly'
    ? `<p class="score">JYLY score <strong>${S.jylyScore(a.rounds)}</strong> / 1000</p>`
    : `<table><tr><th>Distance</th><th>Made</th><th>%</th></tr>${a.stations
        .map((st, i) => a.log[i].length
          ? `<tr><td>${st.distance} ${a.unit}</td><td>${a.log[i].filter(Boolean).length}/${a.log[i].length}</td><td>${fmtPct(S.pct(a.log[i].filter(Boolean).length, a.log[i].length))}</td></tr>`
          : '')
        .join('')}</table>`;
  const here = S.atFeet([{ results }], zoneFt());
  let zoneLine = '';
  if (here.attempts) {
    const z = zoneReport([...state.sessions, { date: new Date().toISOString(), results }]);
    zoneLine = `<div class="card accent"><strong>${fmtDist(z.ft)} zone check</strong>
      <p class="small">This session: ${here.makes}/${here.attempts} (${fmtPct(here.pct)}). Including it, you are at
      <strong>${fmtPct(z.v.pct)}</strong> over ${z.v.attempts} putts${z.useRecent ? ' in the last 30 days' : ''}.</p>
      <p class="small ${zoneTone[z.v.status] || ''}">${zoneMessages[z.v.status](z.v)}</p></div>`;
  }
  return shell('practice', `
    <h2>Session complete</h2>
    <div class="card">
      <p class="big-pct">${fmtPct(tot.pct)}</p>
      <p class="muted center">${tot.makes} of ${tot.attempts} putts made</p>
      ${rows}
      ${a.kind === 'jyly' ? '' : (() => { const sets = buildSets(a); return sets.length ? `<p class="small">${setsLine(sets)}</p>` : ''; })()}
    </div>
    ${zoneLine}
    <label class="field">Notes (wind, form cues, how it felt)
      <textarea id="notes" rows="3" placeholder="e.g. focused on follow-through, light headwind"></textarea></label>
    <div class="row">
      <button class="btn primary" data-action="save-session" ${tot.attempts ? '' : 'disabled'}>Save session</button>
      <button class="btn ghost" data-action="undo">Back</button>
      <button class="btn ghost" data-action="discard">Discard</button>
    </div>`);
}

function viewQuickLog() {
  return shell('practice', `
    <h2>Log a session</h2>
    <form id="quicklog" class="card">
      <label class="field">Date <input type="date" name="date" value="${todayKey()}" required></label>
      <table class="edit" id="ql-rows">
        <tr><th>Distance (${unit()})</th><th>Putts</th><th>Made</th><th></th></tr>
        ${qlRow()}
      </table>
      <button type="button" class="btn ghost" data-action="ql-add">+ Add distance</button>
      <label class="field">Notes <textarea name="notes" rows="2"></textarea></label>
      <div class="row"><button class="btn primary" type="submit">Save</button><a class="btn ghost" href="#practice">Cancel</a></div>
    </form>`);
}
const qlRow = () => `<tr>
  <td><input type="number" name="d" min="1" step="1" required inputmode="numeric"></td>
  <td><input type="number" name="p" min="1" step="1" value="10" required inputmode="numeric"></td>
  <td><input type="number" name="m" min="0" step="1" required inputmode="numeric"></td>
  <td><button type="button" class="x" data-action="row-del" aria-label="Remove">×</button></td></tr>`;

function viewHistory() {
  const list = [...state.sessions].sort((a, b) => b.date.localeCompare(a.date));
  if (!list.length) return shell('history', `<h2>History</h2><p class="muted">No sessions yet. Go make some putts.</p>`);
  return shell('history', `<h2>History</h2><ul class="list">${list
    .map((s) => {
      const t = S.sessionTotals(s);
      const detail = S.byDistance([s], unit()).map((d) => `${d.distance}${unit()}: ${d.makes}/${d.attempts}`).join(' · ');
      return `<li class="card hist">
        <div class="hist-head"><strong>${esc(s.routineName)}</strong><span class="pct">${s.kind === 'jyly' ? `${s.score} pts` : fmtPct(t.pct)}</span></div>
        <p class="muted small">${fmtDate(s.date)} · ${t.makes}/${t.attempts} made${s.kind === 'jyly' ? ` · ${fmtPct(t.pct)}` : ''}</p>
        <p class="small">${esc(detail)}</p>
        ${s.sets?.length ? `<p class="small">${setsLine(s.sets)}</p>` : ''}
        ${s.notes ? `<p class="note small">${esc(s.notes)}</p>` : ''}
        <button class="link danger small" data-action="del-session" data-id="${s.id}">Delete</button>
      </li>`;
    })
    .join('')}</ul>`);
}

let progressDistance = null;
function viewProgress() {
  const all = state.sessions;
  if (!all.length) return shell('progress', `<h2>Progress</h2><p class="muted">Your stats will show up here after your first session.</p>`);
  const u = unit();
  const now = new Date();
  const since30 = new Date(now - 30 * 864e5).toISOString();
  const since7 = new Date(now - 7 * 864e5).toISOString();
  const overall = all.reduce((a, s) => { const t = S.sessionTotals(s); a.m += t.makes; a.a += t.attempts; return a; }, { m: 0, a: 0 });
  const week = S.sessionsSince(all, since7).reduce((n, s) => n + S.sessionTotals(s).attempts, 0);
  const dists = S.byDistance(all, u);
  const recent = new Map(S.byDistance(S.sessionsSince(all, since30), u).map((d) => [d.distance, d]));
  if (!dists.some((d) => d.distance === progressDistance)) {
    progressDistance = [...dists].sort((a, b) => b.attempts - a.attempts)[0].distance;
  }
  const trend = S.distanceTrend(all, u, progressDistance).map((p) => ({ date: p.date, value: p.pct }));
  const overallTrend = S.overallTrend(all.filter((s) => s.kind !== 'jyly')).map((p) => ({ date: p.date, value: p.pct }));
  const jyly = all.filter((s) => s.kind === 'jyly').sort((a, b) => a.date.localeCompare(b.date));
  const best = jyly.length ? Math.max(...jyly.map((s) => s.score)) : null;
  const z = zoneReport(all);
  const target = zoneTarget();
  const est = S.targetDistance(all, { target, minAttempts: 20 });
  const estLine = !est ? ''
    : est.kind === 'between' ? `Across all your distances, your ${target}% distance looks like about <strong>${fmtDist(est.ft)}</strong>.`
    : est.kind === 'beyond' ? `You are at ${target}%+ at every distance you have logged (out to ${fmtDist(est.ft)}). Log some putts further out to find your ${target}% distance.`
    : `You are under ${target}% at every distance you have logged (in to ${fmtDist(est.ft)}). Log some putts closer in to find your ${target}% distance.`;
  const zoneCard = `<div class="card accent">
      <div class="hist-head"><h3>${target}% zone · ${fmtDist(z.ft)}</h3>
        ${z.v.attempts ? `<span class="pct">${fmtPct(z.v.pct)}</span>` : ''}</div>
      ${z.all.attempts ? `
        <p class="small">${z.v.attempts} putts${z.useRecent ? ' in the last 30 days' : ''} ·
          likely between <strong>${fmtPct(z.v.lo)}</strong> and <strong>${fmtPct(z.v.hi)}</strong> (95% range)</p>
        <div class="zone-bar" aria-hidden="true">
          <span class="zone-band" style="left:${target - ZONE_BAND}%;width:${2 * ZONE_BAND}%"></span>
          <span class="zone-range" style="left:${z.v.lo}%;width:${Math.max(1, z.v.hi - z.v.lo)}%"></span>
          <span class="zone-dot" style="left:${z.v.pct}%"></span>
        </div>
        <p class="small ${zoneTone[z.v.status] || ''}">${zoneMessages[z.v.status](z.v)}</p>
        ${z.useRecent ? `<p class="muted small">All time: ${z.all.makes}/${z.all.attempts} (${fmtPct(z.all.pct)})</p>` : ''}`
      : `<p class="small muted">No putts at ${fmtDist(z.ft)} yet. Run <strong>18 ft Zone Reps</strong> to start building the number.</p>`}
      ${estLine ? `<p class="small">${estLine}</p>` : ''}
    </div>`;

  return shell('progress', `
    <h2>Progress</h2>
    ${zoneCard}
    <section class="stats-row four">
      <div class="stat"><span class="num">${all.length}</span><span class="lbl">sessions</span></div>
      <div class="stat"><span class="num">${overall.a}</span><span class="lbl">total putts</span></div>
      <div class="stat"><span class="num">${fmtPct(S.pct(overall.m, overall.a))}</span><span class="lbl">overall</span></div>
      <div class="stat"><span class="num">${week}</span><span class="lbl">putts / 7 days</span></div>
    </section>

    <div class="card">
      <h3>Make % by distance</h3>
      <table class="bars"><tr><th>${u}</th><th>All time</th><th>Last 30 days</th></tr>${dists
        .map((d) => {
          const r = recent.get(d.distance);
          const delta = r ? r.pct - d.pct : null;
          return `<tr><td>${d.distance}</td>
            <td><div class="bar"><span style="width:${d.pct}%"></span></div><span class="small">${fmtPct(d.pct)} <span class="muted">(${d.attempts})</span></span></td>
            <td>${r ? `${fmtPct(r.pct)}${Math.round(delta) ? ` <span class="${delta > 0 ? 'up' : 'down'} small">${delta > 0 ? '▲' : '▼'}${Math.abs(Math.round(delta))}</span>` : ''}` : '<span class="muted">–</span>'}</td></tr>`;
        })
        .join('')}</table>
    </div>

    <div class="card">
      <div class="hist-head"><h3>Trend at</h3>
        <select id="trend-dist">${dists.map((d) => `<option value="${d.distance}" ${d.distance === progressDistance ? 'selected' : ''}>${d.distance} ${u}</option>`).join('')}</select></div>
      ${lineChart(trend, { label: `Make percentage at ${progressDistance} ${u}` })}
    </div>

    <div class="card"><h3>Overall make % (routines)</h3>${lineChart(overallTrend, { label: 'Overall make percentage per session' })}</div>

    ${jyly.length ? `<div class="card"><div class="hist-head"><h3>JYLY score</h3><span>best <strong>${best}</strong></span></div>
      ${lineChart(jyly.map((s) => ({ date: s.date, value: s.score })), { yMax: Math.max(400, Math.ceil(best / 100) * 100), suffix: '', label: 'JYLY score per session' })}</div>` : ''}`);
}

let editing = null; // routine being edited (a copy)
function viewRoutines() {
  if (editing) return viewRoutineEdit();
  return shell('routines', `
    <h2>Routines</h2>
    <ul class="list">${state.routines
      .map((r) => `<li class="card hist"><div class="hist-head"><strong>${esc(r.name)}</strong>
        <span>${r.kind === 'jyly' ? '' : `<button class="link small" data-action="edit-routine" data-id="${r.id}">Edit</button>`}
        <button class="link danger small" data-action="del-routine" data-id="${r.id}">Delete</button></span></div>
        <p class="muted small">${esc(routineSummary(r))}</p></li>`)
      .join('')}</ul>
    <div class="row"><button class="btn primary" data-action="new-routine">New routine</button>
    ${state.routines.some((r) => r.kind === 'jyly') ? '' : '<button class="btn ghost" data-action="add-jyly">Add JYLY</button>'}</div>`);
}

function viewRoutineEdit() {
  const r = editing;
  return shell('routines', `
    <h2>${state.routines.some((x) => x.id === r.id) ? 'Edit' : 'New'} routine</h2>
    <form id="routine-form" class="card">
      <label class="field">Name <input name="name" value="${esc(r.name)}" required maxlength="60"></label>
      <label class="field">Unit <select name="unit">
        <option value="ft" ${r.unit === 'ft' ? 'selected' : ''}>feet</option>
        <option value="m" ${r.unit === 'm' ? 'selected' : ''}>metres</option></select></label>
      <label class="field">Count each distance in <select name="count" id="routine-count">
        <option value="putts" ${r.count !== 'sets' ? 'selected' : ''}>putts</option>
        <option value="sets" ${r.count === 'sets' ? 'selected' : ''}>sets of my putters</option></select></label>
      <table class="edit" id="st-rows"><tr><th>Distance</th><th id="st-count-head">${r.count === 'sets' ? 'Sets' : 'Putts'}</th><th></th></tr>
        ${r.stations.map((s) => stRow({ distance: s.distance, putts: r.count === 'sets' ? s.sets : s.putts })).join('')}</table>
      <button type="button" class="btn ghost" data-action="st-add">+ Add station</button>
      <div class="row"><button class="btn primary" type="submit">Save routine</button>
      <button type="button" class="btn ghost" data-action="cancel-edit">Cancel</button></div>
    </form>`);
}
const stRow = (s = { distance: '', putts: 10 }) => `<tr>
  <td><input type="number" name="d" min="1" step="1" value="${s.distance}" required inputmode="numeric"></td>
  <td><input type="number" name="p" min="1" max="100" step="1" value="${s.putts}" required inputmode="numeric"></td>
  <td><button type="button" class="x" data-action="row-del" aria-label="Remove">×</button></td></tr>`;

function viewSettings() {
  return shell('settings', `
    <h2>Settings</h2>
    <div class="card">
      <label class="field">Show stats in
        <select id="unit"><option value="ft" ${unit() === 'ft' ? 'selected' : ''}>feet</option>
        <option value="m" ${unit() === 'm' ? 'selected' : ''}>metres</option></select></label>
    </div>
    <div class="card">
      <h3>Practice zone</h3>
      <p class="muted small">Practise where you make about ${zoneTarget()}% of your putts. Progress tracks your make % at this distance and tells you when to move in or back.</p>
      <label class="field">Zone distance (ft) <input type="number" id="zone-ft" min="3" max="100" step="1" value="${zoneFt()}" inputmode="numeric"></label>
      <label class="field">Target make % <input type="number" id="zone-target" min="50" max="99" step="1" value="${zoneTarget()}" inputmode="numeric"></label>
    </div>
    <div class="card">
      <h3>Backup</h3>
      <p class="muted small">Your data is stored only in this browser. Export a backup now and then, and import it to move to another device.</p>
      <div class="row"><button class="btn" data-action="export">Export JSON</button>
      <label class="btn">Import JSON<input type="file" id="import" accept="application/json" hidden></label></div>
    </div>
    <div class="card">
      <h3>Reset</h3>
      <div class="row"><button class="btn ghost" data-action="reset-routines">Restore default routines</button>
      <button class="btn danger" data-action="wipe">Delete all data</button></div>
    </div>`);
}

// ---- render & routing -------------------------------------------------------
function render() {
  const route = location.hash.slice(1) || 'practice';
  const views = {
    practice: viewPractice, session: viewSession, quicklog: viewQuickLog, history: viewHistory,
    progress: viewProgress, routines: viewRoutines, settings: viewSettings,
  };
  app.innerHTML = (views[route] || viewPractice)();
}
window.addEventListener('hashchange', render);

// ---- actions ---------------------------------------------------------------
function startRoutine(id) {
  const r = state.routines.find((x) => x.id === id);
  if (!r) return;
  const putters = puttersPref();
  state.active = {
    routineId: r.id, routineName: r.name, kind: r.kind, unit: r.unit, startedAt: new Date().toISOString(),
    stations: S.expandStations(r, putters), stationIdx: 0, log: r.stations.map(() => []), rounds: [],
    putters, history: [],
    // For set-based routines, keep the set counts so a mid-session putter change can resize stations.
    stationSets: r.count === 'sets' ? r.stations.map((st) => st.sets) : null,
  };
  persist();
  go('session');
}

function saveActive() {
  const a = state.active;
  const results = buildResults(a);
  const session = {
    id: uid(), date: a.startedAt, routineId: a.routineId, routineName: a.routineName, kind: a.kind, results,
    notes: (document.getElementById('notes')?.value || '').trim(),
  };
  if (a.kind === 'jyly') session.score = S.jylyScore(a.rounds);
  else {
    const sets = buildSets(a);
    if (sets.length) { session.putters = clampPutters(a.putters); session.sets = sets; }
  }
  state.sessions.push(session);
  state.active = null;
  persist();
  go('history');
}

const actions = {
  start: (el) => startRoutine(el.dataset.id),
  putt: (el) => {
    const a = state.active;
    const log = a.log[a.stationIdx];
    const made = el.dataset.made === '1';
    log.push(made);
    (a.history ||= []).push({ station: a.stationIdx, n: 1, makes: made ? 1 : 0 });
    if (navigator.vibrate) navigator.vibrate(made ? 30 : [15, 40, 15]);
    if (log.length >= a.stations[a.stationIdx].putts) a.stationIdx++;
    persist(); render();
  },
  set: (el) => {
    const a = state.active;
    const st = a.stations[a.stationIdx];
    const log = a.log[a.stationIdx];
    const n = S.nextSetSize(clampPutters(a.putters), st.putts - log.length);
    const makes = Math.min(n, Number(el.dataset.makes));
    for (let i = 0; i < n; i++) log.push(i < makes);
    (a.history ||= []).push({ station: a.stationIdx, n, makes, set: true });
    if (navigator.vibrate) navigator.vibrate(makes === n ? [30, 40, 30] : 30);
    if (log.length >= st.putts) a.stationIdx++;
    persist(); render();
  },
  jyly: (el) => {
    const a = state.active;
    a.rounds.push({ distanceM: S.jylyCurrentDistance(a.rounds), makes: Number(el.dataset.makes) });
    persist(); render();
  },
  undo: () => {
    const a = state.active;
    if (a.finishedEarly) a.finishedEarly = false;
    else if (a.kind === 'jyly') a.rounds.pop();
    else if (a.history?.length) {
      // Undo the last entry: one putt, or a whole set.
      const h = a.history.pop();
      a.stationIdx = h.station;
      a.log[h.station].splice(-h.n);
    } else {
      if (a.stationIdx >= a.stations.length) a.stationIdx = a.stations.length - 1;
      if (!a.log[a.stationIdx].length && a.stationIdx > 0) a.stationIdx--;
      a.log[a.stationIdx].pop();
    }
    persist(); render();
  },
  skip: () => { state.active.stationIdx++; persist(); render(); },
  'finish-early': () => { state.active.finishedEarly = true; persist(); render(); },
  'save-session': saveActive,
  discard: () => {
    if (!confirm('Discard this session?')) return;
    state.active = null; persist(); go('practice');
  },
  'ql-add': () => document.getElementById('ql-rows').insertAdjacentHTML('beforeend', qlRow()),
  'st-add': () => document.getElementById('st-rows').insertAdjacentHTML('beforeend', stRow()),
  'row-del': (el) => {
    const table = el.closest('table');
    if (table.querySelectorAll('tr').length > 2) el.closest('tr').remove();
  },
  'del-session': (el) => {
    if (!confirm('Delete this session?')) return;
    state.sessions = state.sessions.filter((s) => s.id !== el.dataset.id); persist(); render();
  },
  'new-routine': () => { editing = { id: uid(), name: '', kind: 'stations', unit: unit(), stations: [{ distance: 20, putts: 10 }] }; render(); },
  'edit-routine': (el) => { editing = structuredClone(state.routines.find((r) => r.id === el.dataset.id)); render(); },
  'cancel-edit': () => { editing = null; render(); },
  'del-routine': (el) => {
    if (!confirm('Delete this routine? Past sessions are kept.')) return;
    state.routines = state.routines.filter((r) => r.id !== el.dataset.id); persist(); render();
  },
  'add-jyly': () => { state.routines.push(structuredClone(DEFAULT_ROUTINES.find((r) => r.kind === 'jyly'))); persist(); render(); },
  'reset-routines': () => {
    if (!confirm('Replace your routines with the defaults? Sessions are kept.')) return;
    state.routines = structuredClone(DEFAULT_ROUTINES); persist(); render();
  },
  wipe: () => {
    if (!confirm('Delete ALL sessions and routines? This cannot be undone.')) return;
    localStorage.clear(); state = load(); go('practice');
  },
  export: () => {
    const blob = new Blob([JSON.stringify({ ...state, active: null }, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `putting-practice-${todayKey()}.json`;
    a.click();
    URL.revokeObjectURL(a.href);
  },
};

app.addEventListener('click', (e) => {
  const el = e.target.closest('[data-action]');
  if (!el || el.disabled) return;
  const fn = actions[el.dataset.action];
  if (fn) { e.preventDefault(); fn(el); }
});

app.addEventListener('change', (e) => {
  if (e.target.id === 'unit') { state.settings.unit = e.target.value; persist(); render(); }
  if (e.target.id === 'zone-ft' || e.target.id === 'zone-target') {
    const n = Math.round(Number(e.target.value));
    const [key, min, max] = e.target.id === 'zone-ft' ? ['zoneFt', 3, 100] : ['zoneTarget', 50, 99];
    if (n >= min && n <= max) { state.settings[key] = n; persist(); }
    render();
  }
  if (e.target.id === 'routine-count') {
    document.getElementById('st-count-head').textContent = e.target.value === 'sets' ? 'Sets' : 'Putts';
  }
  if (e.target.id === 'putters-pref') { state.settings.putters = clampPutters(e.target.value); persist(); render(); }
  if (e.target.id === 'session-putters' && state.active) {
    const a = state.active;
    a.putters = state.settings.putters = clampPutters(e.target.value);
    if (a.stationSets) {
      for (let i = a.stationIdx; i < a.stations.length; i++) {
        a.stations[i].putts = Math.max(a.log[i].length, a.stationSets[i] * a.putters);
      }
    }
    persist(); render();
  }
  if (e.target.id === 'trend-dist') { progressDistance = Number(e.target.value); render(); }
  if (e.target.id === 'import') {
    const file = e.target.files[0];
    if (!file) return;
    file.text().then((txt) => {
      try {
        state = validateImport(JSON.parse(txt)); persist();
        alert(`Imported ${state.sessions.length} sessions.`); go('history');
      } catch (err) { alert(err.message); }
    });
  }
});

const rows = (form) => [...form.querySelectorAll('tr')].slice(1).map((tr) => {
  const v = (n) => tr.querySelector(`[name="${n}"]`)?.value;
  return { d: Number(v('d')), p: Number(v('p')), m: Number(v('m')) };
});

app.addEventListener('submit', (e) => {
  e.preventDefault();
  const form = e.target;
  if (form.id === 'quicklog') {
    const data = rows(form);
    if (data.some((r) => r.m > r.p)) { alert('Made putts can’t be more than putts taken.'); return; }
    const date = form.date.value;
    state.sessions.push({
      id: uid(), date: new Date(date + 'T12:00:00').toISOString(), routineId: null, routineName: 'Logged session',
      kind: 'manual', notes: form.notes.value.trim(),
      results: data.map((r) => ({ ft: S.toFt(r.d, unit()), attempts: r.p, makes: r.m })),
    });
    persist(); go('history');
  }
  if (form.id === 'routine-form') {
    editing.name = form.name.value.trim();
    editing.unit = form.unit.value;
    if (form.count.value === 'sets') {
      editing.count = 'sets';
      editing.stations = rows(form).map((r) => ({ distance: r.d, sets: r.p }));
    } else {
      delete editing.count;
      editing.stations = rows(form).map((r) => ({ distance: r.d, putts: r.p }));
    }
    const i = state.routines.findIndex((r) => r.id === editing.id);
    if (i >= 0) state.routines[i] = editing; else state.routines.push(editing);
    editing = null; persist(); render();
  }
});

render();
