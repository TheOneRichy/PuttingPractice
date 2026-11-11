import * as S from './stats.js';
import { rangeChart, lineChart } from './charts.js';
import { load, save, uid, validateImport, DEFAULT_ROUTINES } from './store.js';

let state = load();
const app = document.getElementById('app');
const persist = () => save(state);

// ---- helpers -------------------------------------------------------------
const esc = (v) =>
  String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const unit = () => state.settings.unit;
const fmtPct = (p) => `${Math.round(p)}%`;
const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;
const fmtDate = (iso) =>
  new Date(iso).toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });
const todayKey = () => {
  const d = new Date();
  return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
};
const daysAgo = (n) => new Date(Date.now() - n * 864e5).toISOString();
const totals = (sessions) => sessions.reduce((a, s) => {
  const t = S.sessionTotals(s);
  return { makes: a.makes + t.makes, attempts: a.attempts + t.attempts };
}, { makes: 0, attempts: 0 });

const routineSummary = (r) => {
  if (r.kind === 'jyly') return '20 rounds of 5 putts · 5–10 m';
  const st = S.routineIn(r, unit()).stations;
  const dists = `${[...new Set(st.map((s) => s.distance))].join(' · ')} ${unit()}`;
  const putts = S.expandStations(r, puttersPref()).reduce((n, s) => n + s.putts, 0);
  return `${dists} · ${plural(putts, 'putt')}`;
};

const icons = {
  practice: '<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="5"/><circle cx="12" cy="12" r="1.2" fill="currentColor"/>',
  progress: '<path d="M4 19V5M4 19h16M8 15l4-5 3 3 4-6"/>',
  history: '<path d="M5 6h14M5 12h14M5 18h9"/>',
  gear: '<circle cx="12" cy="12" r="3"/><path d="M12 3v3M12 18v3M3 12h3M18 12h3M5.6 5.6l2.1 2.1M16.3 16.3l2.1 2.1M5.6 18.4l2.1-2.1M16.3 7.7l2.1-2.1"/>',
  close: '<path d="M6 6l12 12M18 6L6 18"/>',
  undo: '<path d="M9 7L4 12l5 5M4 12h10a6 6 0 010 12h-2" transform="translate(0 -3)"/>',
  chevron: '<path d="M9 6l6 6-6 6"/>',
  back: '<path d="M15 6l-6 6 6 6"/>',
};
const icon = (name) => `<svg class="ico" viewBox="0 0 24 24" aria-hidden="true">${icons[name]}</svg>`;

// ---- putters / sets ---------------------------------------------------------
const clampPutters = (n) => Math.min(S.MAX_PUTTERS, Math.max(1, Math.round(Number(n)) || 1));
const puttersPref = () => clampPutters(state.settings.putters);
const stepper = (key, value, label, { min, max }) => `
  <div class="stepper" role="group" aria-label="${label}">
    <button type="button" data-action="step" data-key="${key}" data-d="-1" aria-label="Fewer" ${value <= min ? 'disabled' : ''}>−</button>
    <output>${value}</output>
    <button type="button" data-action="step" data-key="${key}" data-d="1" aria-label="More" ${value >= max ? 'disabled' : ''}>+</button>
  </div>`;
/** "6 · 4 · 5" plus clean-set count, for finish screen and history. */
function setsLine(sets) {
  if (!sets?.length) return '';
  const st = S.setStats(sets);
  return `Sets ${sets.map((x) => (x.makes === x.attempts ? `<strong>${x.makes}</strong>` : x.makes)).join(' · ')}
    <span class="muted">· ${st.clean} of ${st.count} clean · avg ${st.avgMakes.toFixed(1)}</span>`;
}

// ---- practice zone ---------------------------------------------------------
// The zone is saved in feet and shown as the nearest standard mark of the display unit,
// so switching units and back without picking a new distance changes nothing.
const zoneMark = () => S.nearestStandard(S.fromFt(Number(state.settings.zoneFt) || 18, unit()), unit());
const fmtMark = (d) => `${d} ${unit()}`;
const zoneSets = () => Math.min(30, Math.max(1, Number(state.settings.zoneSets) || 8));
const zoneTarget = () => Number(state.settings.zoneTarget) || 85;
const ZONE_MIN = 50; // putts before the app makes a call
const ZONE_BAND = 5; // ± % around the target that counts as "in the zone"
const zoneOpts = () => ({ target: zoneTarget(), band: ZONE_BAND, minAttempts: ZONE_MIN });
/** A distance in the unit chosen in Settings: whole feet, or metres to one decimal (no trailing .0). */
const distNum = (ft) => (unit() === 'm' ? String(Number(S.fromFt(ft, 'm').toFixed(1))) : String(Math.round(ft)));
const fmtDist = (ft) => `${distNum(ft)} ${unit()}`;
/** Session title. Zone practice is named from its distance so it follows the unit setting. */
const sessionName = (x) => {
  const zone = /^zone-(\d+)(m?)$/.exec(x.routineId || '');
  return zone && String(x.routineName).startsWith('Zone practice')
    ? `Zone practice · ${fmtDist(S.toFt(Number(zone[1]), zone[2] || 'ft'))}` : x.routineName;
};
const zoneMessages = {
  'need-more': (v) => `${plural(v.needed, 'more putt')} here and you get a reliable read.`,
  'in-zone': () => 'In the zone. This is the distance to practise.',
  'too-hard': () => 'Clearly below the zone at this distance.',
  'too-easy': () => 'Clearly above the zone at this distance.',
  'leaning-hard': () => 'Leaning below the zone, not certain yet. Keep putting here.',
  'leaning-easy': () => 'Leaning above the zone, not certain yet. Keep putting here.',
};
const zoneShort = {
  'need-more': (v) => `${v.needed} to go`, 'in-zone': () => 'In the zone', 'too-hard': () => 'Too hard',
  'too-easy': () => 'Too easy', 'leaning-hard': () => 'Leaning hard', 'leaning-easy': () => 'Leaning easy',
};
const pill = (v) => `<span class="pill ${v.status}">${zoneShort[v.status](v)}</span>`;

/** Dropdown of standard distances. Values are in the given unit. */
const distanceSelect = (attrs, u, value) => {
  const opts = S.standardDistances(u);
  const extra = value !== '' && value != null && !opts.includes(Number(value)) ? [Number(value)] : []; // keep an old custom value
  return `<select ${attrs}>${[...opts, ...extra].sort((a, b) => a - b)
    .map((d) => `<option value="${d}" ${d === Number(value) ? 'selected' : ''}>${d} ${u}${extra.includes(d) ? ' (old)' : ''}</option>`)
    .join('')}</select>`;
};

/** Verdict from all-time and last-30-day tallies: recent form wins once it has enough putts. */
function judge(all, recent) {
  const useRecent = recent.attempts >= ZONE_MIN && recent.attempts < all.attempts;
  return { all, recent, useRecent, v: S.zoneVerdict(useRecent ? recent : all, zoneOpts()) };
}
/** Zone verdict at a standard distance in the display unit (default: the zone distance). */
function zoneReport(sessions, d = zoneMark()) {
  const u = unit();
  return { d, ...judge(S.atDistance(sessions, u, d), S.atDistance(S.sessionsSince(sessions, daysAgo(30)), u, d)) };
}
/** Sentence + optional "move" button for a zone report. */
function advice(z, { after = false } = {}) {
  const move = S.zoneMove(z.v.status, z.d, unit());
  const text = zoneMessages[z.v.status](z.v);
  if (move == null) return `<p class="advice">${text}</p>`;
  if (move === zoneMark()) return `<p class="advice">${text} Your zone is set to <strong>${fmtMark(move)}</strong>.</p>`;
  const step = `Step ${move > z.d ? 'back' : 'in'} to ${fmtMark(move)}${after ? ' next time' : ''}.`;
  // Only offer to move the zone from the zone distance itself.
  if (z.d !== zoneMark()) return `<p class="advice">${text}</p>`;
  return `<p class="advice">${text} ${step}</p>
    <button class="btn small" data-action="set-zone" data-d="${move}">Move zone to ${fmtMark(move)}</button>`;
}

const go = (hash) => {
  if (location.hash === '#' + hash) render();
  else location.hash = hash;
};

// ---- toast & confirm sheet ----------------------------------------------------
function toast(text) {
  document.querySelector('.toast')?.remove();
  const el = Object.assign(document.createElement('div'), { className: 'toast', textContent: text });
  el.setAttribute('role', 'status');
  document.body.append(el);
  setTimeout(() => el.remove(), 2600);
}
function ask(text, okLabel, onOk) {
  const d = document.createElement('dialog');
  d.className = 'sheet';
  d.innerHTML = `<p>${esc(text)}</p><div class="sheet-row">
    <button class="btn" value="cancel">Cancel</button>
    <button class="btn danger-fill" value="ok">${esc(okLabel)}</button></div>`;
  const close = () => { d.close(); d.remove(); };
  d.addEventListener('click', (e) => {
    const v = e.target.closest('button')?.value;
    if (v) { close(); if (v === 'ok') onOk(); } else if (e.target === d) close();
  });
  d.addEventListener('cancel', () => d.remove());
  document.body.append(d);
  d.showModal();
}

// ---- shells -----------------------------------------------------------------
const tabs = [['practice', 'Practice'], ['progress', 'Progress'], ['history', 'History']];

/** Top-level screen: title bar with settings, body, bottom tabs. */
function shell(active, title, body) {
  return `
  <header class="top"><h1>${title}</h1>
    <a class="icon-btn" href="#settings" aria-label="Settings">${icon('gear')}</a></header>
  <main>${body}</main>
  <nav class="tabs" aria-label="Sections">${tabs
    .map(([id, label]) => `<a href="#${id}" class="${id === active ? 'on' : ''}" ${id === active ? 'aria-current="page"' : ''}>${icon(id)}<span>${label}</span></a>`)
    .join('')}</nav>`;
}
/** Second-level screen: back arrow, no tabs. */
function subpage(title, body, back = 'practice') {
  return `
  <header class="top sub"><a class="icon-btn" href="#${back}" aria-label="Back">${icon('back')}</a><h1>${title}</h1></header>
  <main>${body}</main>`;
}

// ---- practice (home) ----------------------------------------------------------
function zoneHero() {
  const p = puttersPref();
  const z = zoneReport(state.sessions);
  const chips = S.standardDistances(unit()).map((d) => {
    const r = d === z.d ? z : zoneReport(state.sessions, d);
    return `<button class="chip ${d === z.d ? 'on' : ''} ${r.v.status}" data-action="set-zone" data-d="${d}" aria-pressed="${d === z.d}">
      <b>${d}</b><span>${r.all.attempts ? fmtPct(r.v.pct) : '–'}</span></button>`;
  }).join('');
  const read = z.all.attempts
    ? `<p class="hero-pct">${fmtPct(z.v.pct)}</p><p class="muted small">${plural(z.v.attempts, 'putt')}${z.useRecent ? ' · 30 days' : ''}</p>${pill(z.v)}`
    : `<p class="hero-pct muted">–</p><p class="muted small">no putts here yet</p>`;
  return `<section class="hero" aria-label="Zone practice">
    <p class="eyebrow">Zone practice · aim for ${zoneTarget()}%</p>
    <div class="hero-head">
      <div><p class="hero-dist">${z.d}<small>${unit()}</small></p></div>
      <div class="hero-read">${read}</div>
    </div>
    <div class="chips" role="group" aria-label="Distance (${unit()}), with your make % at each">${chips}</div>
    ${z.all.attempts ? advice(z) : `<p class="advice">Pick a distance and putt. Your make % builds up at each mark until you find where you hit ${zoneTarget()}%.</p>`}
    <div class="setup">
      <div class="setup-item"><span>Sets</span> ${stepper('zoneSets', zoneSets(), 'Sets', { min: 1, max: 30 })}</div>
      <div class="setup-item"><span>Putters per set</span> ${stepper('putters', p, 'Putters per set', { min: 1, max: S.MAX_PUTTERS })}</div>
    </div>
    <button class="btn primary xl" data-action="start-zone" ${state.active ? 'disabled' : ''}>Start ${plural(zoneSets() * p, 'putt')} at ${fmtMark(z.d)}</button>
  </section>`;
}

function viewPractice() {
  const resume = state.active
    ? `<div class="resume"><div><strong>Session in progress</strong>
        <p class="muted small">${esc(sessionName(state.active))}</p></div>
        <div class="resume-btns"><button class="btn ghost small" data-action="discard">Discard</button>
        <a class="btn primary small" href="#session">Resume</a></div></div>`
    : '';
  const today = totals(S.sessionsSince(state.sessions, todayKey()));
  const streak = S.currentStreak(state.sessions, todayKey());
  const todayLine = state.sessions.length
    ? `<p class="today"><span><b>${streak}</b> day streak</span><span><b>${today.attempts}</b> putts today</span>
        <span><b>${today.attempts ? fmtPct(S.pct(today.makes, today.attempts)) : '–'}</b> made</span></p>`
    : '';
  return shell('practice', 'Putting Practice', `
    ${resume}
    ${todayLine}
    ${zoneHero()}
    <div class="section-head"><h2>Routines</h2><a class="link" href="#routines">Edit</a></div>
    <ul class="list rows">${state.routines
      .map((r) => `<li><button class="rowbtn" data-action="start" data-id="${r.id}" ${state.active ? 'disabled' : ''}>
        <span><strong>${esc(r.name)}</strong><span class="muted small">${esc(routineSummary(r))}</span></span>${icon('chevron')}</button></li>`)
      .join('')}
      <li><a class="rowbtn" href="#quicklog"><span><strong>Log a past session</strong>
        <span class="muted small">Enter distance, putts and makes by hand</span></span>${icon('chevron')}</a></li></ul>`);
}

// ---- live session -------------------------------------------------------------
/** Full-screen, no tabs: everything you need mid-putt and nothing to mis-tap. */
let canUndo = false;
function focusShell({ title, segments, top, pad, foot }) {
  return `
  <div class="focus">
    <header class="focus-bar">
      <a class="icon-btn" href="#practice" aria-label="Pause and go back">${icon('close')}</a>
      <span class="focus-title">${title}</span>
      <button class="icon-btn" data-action="undo" aria-label="Undo" ${canUndo ? '' : 'disabled'}>${icon('undo')}</button>
    </header>
    <div class="segments" aria-hidden="true">${segments
      .map((s) => `<span style="flex:${s.weight}"><i style="width:${Math.round(s.fraction * 100)}%"></i></span>`).join('')}</div>
    <div class="focus-top">${top}</div>
    <div class="focus-pad">${pad}</div>
    <footer class="focus-foot">${foot}</footer>
  </div>`;
}
/** 0…N-1 as a grid with a full-width "all in" below, where the thumb rests. */
const countPad = (size, action) => `
  <p class="pad-q">How many of <strong>${size}</strong> went in?</p>
  <div class="count-grid ${size > 6 ? 'wide' : ''}">${Array.from({ length: size }, (_, n) =>
    `<button class="key ${n === 0 ? 'zero' : ''}" data-action="${action}" data-makes="${n}">${n}</button>`).join('')}</div>
  <button class="key all" data-action="${action}" data-makes="${size}">All ${size}</button>`;
const slot = (makes, of, current) => makes == null
  ? `<span class="slot ${current ? 'now' : ''}"></span>`
  : `<span class="slot done ${makes === of ? 'clean' : ''}">${makes}</span>`;

function viewSession() {
  const a = state.active;
  if (!a) return viewPractice();
  if (a.kind === 'jyly') return viewJyly(a);
  if (a.finishedEarly || a.stationIdx >= a.stations.length) return viewFinish(a);
  const st = a.stations[a.stationIdx];
  const log = a.log[a.stationIdx];
  const sofar = a.log.flat();
  const sofarMakes = sofar.filter(Boolean).length;
  const putters = clampPutters(a.putters);
  const size = S.nextSetSize(putters, st.putts - log.length);
  const prog = S.sessionProgress(a.stations, a.log, a.stationIdx);
  canUndo = (a.history || []).length > 0 || sofar.length > 0;
  let tally;
  let where;
  if (putters > 1) {
    const done = (a.history || []).filter((h) => h.set && h.station === a.stationIdx);
    const totalSets = done.length + Math.ceil((st.putts - log.length) / putters);
    where = `Set ${done.length + 1} of ${totalSets}`;
    tally = Array.from({ length: totalSets }, (_, i) => slot(done[i]?.makes, done[i]?.n, i === done.length)).join('');
  } else {
    where = `Putt ${log.length + 1} of ${st.putts}`;
    tally = Array.from({ length: st.putts }, (_, i) =>
      `<span class="pip ${i < log.length ? (log[i] ? 'make' : 'miss') : i === log.length ? 'now' : ''}"></span>`).join('');
  }
  const pad = putters > 1 ? countPad(size, 'set') : `
    <div class="two">
      <button class="key miss" data-action="putt" data-made="0">Miss</button>
      <button class="key all" data-action="putt" data-made="1">Make</button>
    </div>`;
  return focusShell({
    title: esc(sessionName(a)),
    segments: prog.parts.map((p) => ({ weight: p.putts, fraction: p.fraction })),
    top: `
      <p class="eyebrow">${a.stations.length > 1 ? `Station ${a.stationIdx + 1} of ${a.stations.length} · ` : ''}${where}</p>
      <p class="distance">${distNum(S.toFt(st.distance, a.unit))}<small>${unit()}</small></p>
      <div class="tally">${tally}</div>
      <p class="running">${sofar.length ? `<strong>${fmtPct(S.pct(sofarMakes, sofar.length))}</strong> · ${sofarMakes} of ${sofar.length} made` : 'Throw them all, walk up, tap the count.'}</p>`,
    pad,
    foot: `
      <div class="foot-putters"><span>Putters</span> ${stepper('sessionPutters', putters, 'Putters per set', { min: 1, max: S.MAX_PUTTERS })}</div>
      ${a.stations.length > 1 ? '<button class="btn ghost small" data-action="skip">Skip station</button>' : ''}
      <button class="btn ghost small" data-action="finish-early">Finish</button>`,
  });
}

function viewJyly(a) {
  if (a.finishedEarly || a.rounds.length >= S.JYLY_ROUNDS) return viewFinish(a);
  const dist = S.jylyCurrentDistance(a.rounds);
  canUndo = a.rounds.length > 0;
  return focusShell({
    title: 'JYLY',
    segments: Array.from({ length: S.JYLY_ROUNDS }, (_, i) => ({ weight: 1, fraction: i < a.rounds.length ? 1 : 0 })),
    top: `
      <p class="eyebrow">Round ${a.rounds.length + 1} of ${S.JYLY_ROUNDS}${unit() === 'ft' ? ` · ${(dist * S.FT_PER_M).toFixed(0)} ft` : ''}</p>
      <p class="distance">${dist}<small>m</small></p>
      <div class="tally">${Array.from({ length: S.JYLY_ROUNDS }, (_, i) => slot(a.rounds[i]?.makes, S.JYLY_PUTTS, i === a.rounds.length)).join('')}</div>
      <p class="running">Score <strong>${S.jylyScore(a.rounds)}</strong></p>`,
    pad: countPad(S.JYLY_PUTTS, 'jyly'),
    foot: '<button class="btn ghost small" data-action="finish-early">Finish</button>',
  });
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

const barRow = (label, makes, attempts) => `<li class="bar-row"><span class="bar-label">${label}</span>
  <span class="bar"><i style="width:${S.pct(makes, attempts)}%"></i></span>
  <span class="bar-val"><b>${fmtPct(S.pct(makes, attempts))}</b> <span class="muted">${makes}/${attempts}</span></span></li>`;

function viewFinish(a) {
  const results = buildResults(a);
  const tot = S.sessionTotals({ results });
  const rows = a.kind === 'jyly'
    ? S.byDistance([{ results }], 'm').map((d) => barRow(`${d.distance} m`, d.makes, d.attempts))
    : a.stations.map((st, i) => (a.log[i].length ? barRow(fmtDist(S.toFt(st.distance, a.unit)), a.log[i].filter(Boolean).length, a.log[i].length) : ''));
  const sets = a.kind === 'jyly' ? [] : buildSets(a);
  // Zone check at the zone distance if putted, else the standard distance with the most putts.
  const putted = S.standardDistances(unit()).map((d) => ({ d, ...S.atDistance([{ results }], unit(), d) })).filter((x) => x.attempts);
  const check = putted.find((x) => x.d === zoneMark()) || putted.sort((x, y) => y.attempts - x.attempts)[0];
  let zoneBlock = '';
  if (check && a.kind !== 'jyly') {
    const z = zoneReport([...state.sessions, { date: new Date().toISOString(), results }], check.d);
    zoneBlock = `<section class="panel">
      <div class="panel-head"><h3>${fmtMark(z.d)} with this session</h3>${pill(z.v)}</div>
      <p class="small"><strong>${fmtPct(z.v.pct)}</strong> over ${plural(z.v.attempts, 'putt')}${z.useRecent ? ' in the last 30 days' : ''},
        likely between ${fmtPct(z.v.lo)} and ${fmtPct(z.v.hi)}.</p>
      ${advice(z, { after: true })}</section>`;
  }
  return subpage('Session complete', `
    <section class="result">
      <p class="result-pct">${a.kind === 'jyly' ? S.jylyScore(a.rounds) : fmtPct(tot.pct)}</p>
      <p class="muted">${a.kind === 'jyly' ? `JYLY score of 1000 · ${fmtPct(tot.pct)} made` : `${tot.makes} of ${plural(tot.attempts, 'putt')} made`}</p>
    </section>
    <section class="panel">
      <ul class="list bars">${rows.join('')}</ul>
      ${sets.length ? `<p class="small sets-line">${setsLine(sets)}</p>` : ''}
    </section>
    ${zoneBlock}
    <label class="field">Notes
      <textarea id="notes" rows="3" placeholder="Wind, form cues, how it felt">${esc(a.notes || '')}</textarea></label>
    <div class="actions">
      <button class="btn primary xl" data-action="save-session" ${tot.attempts ? '' : 'disabled'}>Save session</button>
      <div class="actions-row"><button class="btn ghost" data-action="undo">Keep putting</button>
      <button class="btn ghost danger" data-action="discard">Discard</button></div>
    </div>`);
}

// ---- quick log ----------------------------------------------------------------
function viewQuickLog() {
  return subpage('Log a past session', `
    <form id="quicklog" class="panel">
      <label class="field">Date <input type="date" name="date" value="${todayKey()}" max="${todayKey()}" required></label>
      <table class="edit" id="ql-rows">
        <tr><th>Distance</th><th>Putts</th><th>Made</th><th></th></tr>
        ${qlRow()}
      </table>
      <button type="button" class="btn ghost small" data-action="ql-add">+ Add distance</button>
      <label class="field">Notes <textarea name="notes" rows="2"></textarea></label>
      <button class="btn primary xl" type="submit">Save session</button>
    </form>`);
}
const qlRow = () => `<tr>
  <td>${distanceSelect('name="d" required aria-label="Distance"', unit(), S.standardDistances(unit())[0])}</td>
  <td><input type="number" name="p" min="1" step="1" value="10" required inputmode="numeric" aria-label="Putts"></td>
  <td><input type="number" name="m" min="0" step="1" required inputmode="numeric" aria-label="Made"></td>
  <td><button type="button" class="x" data-action="row-del" aria-label="Remove">×</button></td></tr>`;

// ---- history ------------------------------------------------------------------
function viewHistory() {
  const list = [...state.sessions].sort((a, b) => b.date.localeCompare(a.date));
  if (!list.length) {
    return shell('history', 'History', `<div class="empty"><p><strong>No sessions yet</strong></p>
      <p class="muted">Every session you save lands here, with makes at each distance.</p>
      <a class="btn primary" href="#practice">Start practising</a></div>`);
  }
  const months = new Map();
  for (const s of list) {
    const key = new Date(s.date).toLocaleDateString(undefined, { month: 'long', year: 'numeric' });
    months.set(key, [...(months.get(key) || []), s]);
  }
  return shell('history', 'History', [...months].map(([month, sessions]) => {
    const t = totals(sessions);
    return `<div class="section-head"><h2>${month}</h2><span class="muted small">${plural(t.attempts, 'putt')} · ${fmtPct(S.pct(t.makes, t.attempts))}</span></div>
    <ul class="list rows">${sessions.map((s) => {
      const st = S.sessionTotals(s);
      return `<li class="hist">
        <div class="hist-head"><span><strong>${esc(sessionName(s))}</strong>
          <span class="muted small">${fmtDate(s.date)} · ${st.makes}/${st.attempts} made</span></span>
          <span class="hist-score">${s.kind === 'jyly' ? `${s.score}<small> pts</small>` : fmtPct(st.pct)}</span></div>
        <p class="tags">${S.byDistance([s], unit()).map((d) => `<span>${d.distance} ${unit()} <b>${d.makes}/${d.attempts}</b></span>`).join('')}</p>
        ${s.sets?.length ? `<p class="small">${setsLine(s.sets)}</p>` : ''}
        ${s.notes ? `<p class="note small">${esc(s.notes)}</p>` : ''}
        <button class="link danger small" data-action="del-session" data-id="${s.id}">Delete</button>
      </li>`;
    }).join('')}</ul>`;
  }).join(''));
}

// ---- progress -----------------------------------------------------------------
let progressDistance = null; // selected distance, in the display unit
function viewProgress() {
  const all = state.sessions;
  if (!all.length) {
    return shell('progress', 'Progress', `<div class="empty"><p><strong>Nothing to chart yet</strong></p>
      <p class="muted">After your first session this shows your make % at every distance and where your ${zoneTarget()}% zone sits.</p>
      <a class="btn primary" href="#practice">Start practising</a></div>`);
  }
  const u = unit();
  const target = zoneTarget();
  const recent = new Map(S.byDistance(S.sessionsSince(all, daysAgo(30)), u).map((d) => [d.distance, d]));
  const rows = S.byDistance(all, u).map((d) => {
    const j = judge(d, recent.get(d.distance) || { attempts: 0, makes: 0 });
    return { distance: d.distance, ...j, pct: j.v.pct, lo: j.v.lo, hi: j.v.hi, attempts: j.v.attempts, status: j.v.status };
  });
  const zoneD = zoneMark();
  if (!rows.some((r) => r.distance === progressDistance)) {
    progressDistance = rows.some((r) => r.distance === zoneD) ? zoneD : [...rows].sort((a, b) => b.all.attempts - a.all.attempts)[0].distance;
  }
  const sel = rows.find((r) => r.distance === progressDistance);
  const selD = S.standardDistances(u).includes(sel.distance) ? sel.distance : null;

  const est = S.targetDistance(all, { target, minAttempts: 20 });
  const headline = !est
    ? `<p class="result-pct muted">–</p><p class="muted">20 putts at one distance gives a first estimate of your ${target}% distance.</p>`
    : est.kind === 'between'
      ? `<p class="result-pct">${fmtDist(est.ft)}</p><p class="muted">is about where you make ${target}% of your putts.</p>`
      : est.kind === 'beyond'
        ? `<p class="result-pct">${fmtDist(est.ft)}+</p><p class="muted">You make ${target}% or better everywhere you have putted. Putt further out to find the edge.</p>`
        : `<p class="result-pct">under ${fmtDist(est.ft)}</p><p class="muted">You are below ${target}% everywhere you have putted. Putt closer in to find your zone.</p>`;

  const t = totals(all);
  const week = totals(S.sessionsSince(all, daysAgo(7))).attempts;
  const trend = S.distanceTrend(all, u, sel.distance).map((p) => ({ date: p.date, value: p.pct }));
  const overallTrend = S.overallTrend(all.filter((s) => s.kind !== 'jyly')).map((p) => ({ date: p.date, value: p.pct }));
  const jyly = all.filter((s) => s.kind === 'jyly').sort((a, b) => a.date.localeCompare(b.date));
  const best = jyly.length ? Math.max(...jyly.map((s) => s.score)) : null;

  return shell('progress', 'Progress', `
    <section class="result left"><p class="eyebrow">Your ${target}% distance</p>${headline}</section>

    <section class="panel">
      <div class="panel-head"><h3>Make % by distance</h3>
        <span class="legend small"><span class="key band"></span>${target - ZONE_BAND}–${Math.min(100, target + ZONE_BAND)}% zone</span></div>
      ${rangeChart(rows, { target, band: ZONE_BAND, selected: sel.distance, unit: u })}
      <p class="muted small">Dots are your make %. The bar through each is the range your true % very likely sits in; more putts make it shorter.</p>
      <ul class="list dist-rows">${rows.map((r) => {
        const delta = r.useRecent ? Math.round(r.recent.pct - r.all.pct) : 0;
        return `<li><button class="dist-row ${r.distance === sel.distance ? 'on' : ''}" data-action="pick-distance" data-d="${r.distance}" aria-pressed="${r.distance === sel.distance}">
          <span class="d">${r.distance} ${u}</span>
          <span class="p"><b>${fmtPct(r.pct)}</b>${delta ? ` <span class="${delta > 0 ? 'up' : 'down'}">${delta > 0 ? '▲' : '▼'}${Math.abs(delta)}</span>` : ''}</span>
          <span class="n muted">${r.attempts}${r.useRecent ? ' · 30d' : ''}</span>
          ${pill(r.v)}</button></li>`;
      }).join('')}</ul>
    </section>

    <section class="panel">
      <div class="panel-head"><h3>${sel.distance} ${u}</h3>${pill(sel.v)}</div>
      <p class="small"><strong>${fmtPct(sel.pct)}</strong> over ${plural(sel.attempts, 'putt')}${sel.useRecent ? ' in the last 30 days' : ''},
        likely between <strong>${fmtPct(sel.lo)}</strong> and <strong>${fmtPct(sel.hi)}</strong>.
        ${sel.useRecent ? `<span class="muted">All time ${fmtPct(sel.all.pct)} of ${sel.all.attempts}.</span>` : ''}</p>
      ${selD != null ? advice({ d: selD, v: sel.v }) : `<p class="advice">${zoneMessages[sel.v.status](sel.v)}</p>`}
      ${selD != null && selD !== zoneD && !['too-easy', 'too-hard'].includes(sel.v.status)
        ? `<button class="btn small" data-action="set-zone" data-d="${selD}">Practise at ${fmtMark(selD)}</button>` : ''}
      ${lineChart(trend, { label: `Make percentage at ${sel.distance} ${u} per session`, target })}
    </section>

    <section class="figures">
      <div><b>${all.length}</b><span>sessions</span></div>
      <div><b>${t.attempts.toLocaleString()}</b><span>putts</span></div>
      <div><b>${fmtPct(S.pct(t.makes, t.attempts))}</b><span>made overall</span></div>
      <div><b>${week}</b><span>putts, last 7 days</span></div>
    </section>

    <section class="panel"><h3>Whole-session make %</h3>
      <p class="muted small">Routines only. Moves with the distances you choose as well as your form.</p>
      ${lineChart(overallTrend, { label: 'Overall make percentage per session' })}</section>

    ${jyly.length ? `<section class="panel"><div class="panel-head"><h3>JYLY score</h3><span class="small">best <strong>${best}</strong></span></div>
      ${lineChart(jyly.map((s) => ({ date: s.date, value: s.score })), { yMax: Math.max(400, Math.ceil(best / 100) * 100), suffix: '', label: 'JYLY score per session' })}</section>` : ''}`);
}

// ---- routines -----------------------------------------------------------------
let editing = null; // routine being edited (a copy)
function viewRoutines() {
  if (editing) return viewRoutineEdit();
  return subpage('Routines', `
    <ul class="list rows">${state.routines
      .map((r) => `<li class="hist"><div class="hist-head"><span><strong>${esc(r.name)}</strong>
        <span class="muted small">${esc(routineSummary(r))}</span></span>
        <span class="nowrap">${r.kind === 'jyly' ? '' : `<button class="link" data-action="edit-routine" data-id="${r.id}">Edit</button>`}
        <button class="link danger" data-action="del-routine" data-id="${r.id}">Delete</button></span></div></li>`)
      .join('')}</ul>
    <div class="actions"><button class="btn primary" data-action="new-routine">New routine</button>
    ${state.routines.some((r) => r.kind === 'jyly') ? '' : '<button class="btn ghost" data-action="add-jyly">Add JYLY</button>'}
    <button class="btn ghost" data-action="reset-routines">Restore the default routines</button></div>`);
}

function viewRoutineEdit() {
  const r = editing;
  return `
  <header class="top sub"><button class="icon-btn" data-action="cancel-edit" aria-label="Cancel">${icon('back')}</button>
    <h1>${state.routines.some((x) => x.id === r.id) ? 'Edit' : 'New'} routine</h1></header>
  <main>
    <form id="routine-form" class="panel">
      <label class="field">Name <input name="name" value="${esc(r.name)}" required maxlength="60" placeholder="e.g. Circle 1 warm-up"></label>
      <div class="field-pair">
        <label class="field">Unit <select name="unit">
          <option value="ft" ${r.unit === 'ft' ? 'selected' : ''}>feet</option>
          <option value="m" ${r.unit === 'm' ? 'selected' : ''}>metres</option></select></label>
        <label class="field">Count in <select name="count" id="routine-count">
          <option value="putts" ${r.count !== 'sets' ? 'selected' : ''}>putts</option>
          <option value="sets" ${r.count === 'sets' ? 'selected' : ''}>sets</option></select></label>
      </div>
      <table class="edit" id="st-rows"><tr><th>Distance</th><th id="st-count-head">${r.count === 'sets' ? 'Sets' : 'Putts'}</th><th></th></tr>
        ${r.stations.map((s) => stRow({ distance: s.distance, putts: r.count === 'sets' ? s.sets : s.putts }, r.unit)).join('')}</table>
      <button type="button" class="btn ghost small" data-action="st-add">+ Add station</button>
      <button class="btn primary xl" type="submit">Save routine</button>
    </form>
  </main>`;
}
const stRow = (s = { distance: '', putts: 2 }, u = 'ft') => `<tr>
  <td>${distanceSelect('name="d" required aria-label="Distance"', u, s.distance === '' ? S.standardDistances(u)[0] : s.distance)}</td>
  <td><input type="number" name="p" min="1" max="100" step="1" value="${s.putts}" required inputmode="numeric" aria-label="Count"></td>
  <td><button type="button" class="x" data-action="row-del" aria-label="Remove">×</button></td></tr>`;

// ---- settings -----------------------------------------------------------------
function viewSettings() {
  const seg = (id, value, options) => `<div class="seg" role="group">${options
    .map(([v, label]) => `<button data-action="set-setting" data-key="${id}" data-value="${v}" aria-pressed="${String(v) === String(value)}" class="${String(v) === String(value) ? 'on' : ''}">${label}</button>`).join('')}</div>`;
  return subpage('Settings', `
    <section class="panel">
      <h3>Distances</h3>
      <p class="muted small">Every distance in the app uses this unit. Routines written in the other one are putted at the nearest whole ${unit() === 'm' ? 'metre' : 'foot'}.</p>
      ${seg('unit', unit(), [['ft', 'Feet'], ['m', 'Metres']])}
    </section>
    <section class="panel">
      <h3>Target make %</h3>
      <p class="muted small">The zone is the distance where you make about this share of your putts: hard enough to stretch you, easy enough to groove a good stroke.</p>
      ${seg('zoneTarget', zoneTarget(), [75, 80, 85, 90, 95].map((t) => [t, `${t}%`]))}
    </section>
    <section class="panel">
      <h3>Backup</h3>
      <p class="muted small">Your putts are stored only in this browser. Export a backup now and then, and import it to move to another phone.</p>
      <div class="actions-row"><button class="btn" data-action="export">Export backup</button>
      <label class="btn">Import backup<input type="file" id="import" accept="application/json" hidden></label></div>
    </section>
    <section class="panel">
      <h3>Start over</h3>
      <p class="muted small">Deletes every session and routine on this device.</p>
      <button class="btn ghost danger" data-action="wipe">Delete all data</button>
    </section>`);
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
let lastRoute = null;
window.addEventListener('hashchange', () => {
  render();
  const route = location.hash.slice(1);
  if (route !== lastRoute) window.scrollTo(0, 0);
  lastRoute = route;
});

// ---- actions ---------------------------------------------------------------
function startRoutine(id) {
  const r = state.routines.find((x) => x.id === id);
  if (r) startRoutineObj(r);
}

function startRoutineObj(saved) {
  const r = S.routineIn(saved, unit()); // putt it at round distances in the display unit
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
    notes: (document.getElementById('notes')?.value ?? a.notes ?? '').trim(),
  };
  if (a.kind === 'jyly') session.score = S.jylyScore(a.rounds);
  else {
    const sets = buildSets(a);
    if (sets.length) { session.putters = clampPutters(a.putters); session.sets = sets; }
  }
  state.sessions.push(session);
  state.active = null;
  persist();
  go('practice');
  toast('Session saved');
}

function setSessionPutters(n) {
  const a = state.active;
  a.putters = state.settings.putters = clampPutters(n);
  if (a.stationSets) {
    for (let i = a.stationIdx; i < a.stations.length; i++) {
      a.stations[i].putts = Math.max(a.log[i].length, a.stationSets[i] * a.putters);
    }
  }
}

const actions = {
  start: (el) => startRoutine(el.dataset.id),
  step: (el) => {
    const d = Number(el.dataset.d);
    const key = el.dataset.key;
    if (key === 'zoneSets') state.settings.zoneSets = Math.min(30, Math.max(1, zoneSets() + d));
    if (key === 'putters') state.settings.putters = clampPutters(puttersPref() + d);
    if (key === 'sessionPutters' && state.active) setSessionPutters(clampPutters(state.active.putters) + d);
    persist(); render();
  },
  'set-zone': (el) => { state.settings.zoneFt = S.toFt(Number(el.dataset.d), unit()); persist(); render(); },
  'set-setting': (el) => {
    const { key, value } = el.dataset;
    state.settings[key] = key === 'unit' ? value : Number(value);
    persist(); render();
  },
  'pick-distance': (el) => { progressDistance = Number(el.dataset.d); render(); },
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
    if (navigator.vibrate) navigator.vibrate(30);
    persist(); render();
  },
  undo: () => {
    const a = state.active;
    if (!a) return;
    if (a.finishedEarly) a.finishedEarly = false;
    else if (a.kind === 'jyly') a.rounds.pop();
    else if (a.history?.length) {
      // Undo the last entry: one putt, a whole set, or a skipped station.
      const h = a.history.pop();
      a.stationIdx = h.station;
      if (h.n) a.log[h.station].splice(-h.n);
    } else {
      if (a.stationIdx >= a.stations.length) a.stationIdx = a.stations.length - 1;
      if (!a.log[a.stationIdx].length && a.stationIdx > 0) a.stationIdx--;
      a.log[a.stationIdx].pop();
    }
    persist(); render();
  },
  skip: () => { const a = state.active; (a.history ||= []).push({ station: a.stationIdx, n: 0, makes: 0, skip: true }); a.stationIdx++; persist(); render(); },
  'finish-early': () => { state.active.finishedEarly = true; persist(); render(); },
  'save-session': saveActive,
  discard: () => ask('Discard this session? Its putts will not be saved.', 'Discard', () => {
    state.active = null; persist(); go('practice');
  }),
  'ql-add': () => document.getElementById('ql-rows').insertAdjacentHTML('beforeend', qlRow()),
  'st-add': () => document.getElementById('st-rows')
    .insertAdjacentHTML('beforeend', stRow({ distance: '', putts: document.getElementById('routine-count').value === 'sets' ? 2 : 10 },
      document.querySelector('#routine-form [name=unit]').value)),
  'start-zone': () => {
    const d = zoneMark();
    startRoutineObj({ id: `zone-${d}${unit() === 'm' ? 'm' : ''}`, name: `Zone practice · ${fmtMark(d)}`, kind: 'stations', unit: unit(), count: 'sets',
      stations: [{ distance: d, sets: zoneSets() }] });
  },
  'row-del': (el) => {
    const table = el.closest('table');
    if (table.querySelectorAll('tr').length > 2) el.closest('tr').remove();
  },
  'del-session': (el) => ask('Delete this session? Its putts leave your stats.', 'Delete', () => {
    state.sessions = state.sessions.filter((s) => s.id !== el.dataset.id); persist(); render();
  }),
  'new-routine': () => {
    editing = { id: uid(), name: '', kind: 'stations', unit: unit(), count: 'sets', stations: [{ distance: unit() === 'm' ? 6 : 20, sets: 2 }] };
    render();
  },
  'edit-routine': (el) => { editing = structuredClone(state.routines.find((r) => r.id === el.dataset.id)); render(); },
  'cancel-edit': () => { editing = null; render(); },
  'del-routine': (el) => ask('Delete this routine? Past sessions are kept.', 'Delete', () => {
    state.routines = state.routines.filter((r) => r.id !== el.dataset.id); persist(); render();
  }),
  'add-jyly': () => { state.routines.push(structuredClone(DEFAULT_ROUTINES.find((r) => r.kind === 'jyly'))); persist(); render(); },
  'reset-routines': () => ask('Replace your routines with the defaults? Sessions are kept.', 'Replace', () => {
    state.routines = structuredClone(DEFAULT_ROUTINES); persist(); render();
  }),
  wipe: () => ask('Delete ALL sessions and routines on this device? This cannot be undone.', 'Delete everything', () => {
    localStorage.clear(); state = load(); go('practice');
  }),
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

// Notes survive a re-render or a reload while the finish screen is open.
app.addEventListener('input', (e) => {
  if (e.target.id === 'notes' && state.active) { state.active.notes = e.target.value; persist(); }
});

app.addEventListener('change', (e) => {
  if (e.target.name === 'unit' && e.target.closest('#routine-form')) {
    // Switch every distance dropdown to the new unit's standards, keeping the nearest mark.
    const to = e.target.value;
    const from = to === 'm' ? 'ft' : 'm';
    e.target.form.querySelectorAll('select[name=d]').forEach((sel) => {
      const near = S.nearestStandard(S.fromFt(S.toFt(Number(sel.value), from), to), to);
      sel.outerHTML = distanceSelect('name="d" required aria-label="Distance"', to, near);
    });
  }
  if (e.target.id === 'routine-count') {
    document.getElementById('st-count-head').textContent = e.target.value === 'sets' ? 'Sets' : 'Putts';
  }
  if (e.target.id === 'import') {
    const file = e.target.files[0];
    if (!file) return;
    file.text().then((txt) => {
      try {
        state = validateImport(JSON.parse(txt)); persist();
        go('history'); toast(`Imported ${plural(state.sessions.length, 'session')}`);
      } catch (err) { toast(err instanceof SyntaxError ? 'That file is not a backup from this app.' : err.message); }
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
    if (data.some((r) => r.m > r.p)) { toast('Made can’t be more than putts taken.'); return; }
    const date = form.date.value;
    state.sessions.push({
      id: uid(), date: new Date(date + 'T12:00:00').toISOString(), routineId: null, routineName: 'Logged session',
      kind: 'manual', notes: form.notes.value.trim(),
      results: data.map((r) => ({ ft: S.toFt(r.d, unit()), attempts: r.p, makes: r.m })),
    });
    persist(); go('history'); toast('Session saved');
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

lastRoute = location.hash.slice(1);
render();
