// SVG chart builders. Pure functions: data in, markup string out, no DOM and
// no app state. Colours come from CSS classes in styles.css.

const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const f = (n) => n.toFixed(1);
const shortDate = (iso) => new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });

/**
 * Make % against distance, drawn to scale from the basket outwards.
 * rows: [{ distance, pct, lo, hi, attempts, status }] in the display unit.
 * Shows the target band, each distance's 95% range as a whisker, and the
 * Circle 1 / Circle 2 edges when they fall inside the plotted range.
 */
export function rangeChart(rows, { target = 85, band = 5, selected = null, unit = 'ft' } = {}) {
  if (!rows.length) return '';
  const W = 340, H = 210, L = 34, R = 14, T = 20, B = 30;
  const c1 = unit === 'm' ? 10 : 33;
  const c2 = unit === 'm' ? 20 : 66;
  const step = unit === 'm' ? 5 : 10;
  const far = Math.max(c1, ...rows.map((r) => r.distance));
  const maxD = Math.ceil((far * 1.04) / step) * step;
  const x = (d) => L + (d / maxD) * (W - L - R);
  const y = (p) => T + (1 - p / 100) * (H - T - B);
  const xt = [];
  for (let d = 0; d <= maxD; d += step) xt.push(d);
  const edges = [[c1, 'C1 edge'], [c2, 'C2 edge']].filter(([d]) => d <= maxD);
  const line = rows.map((r, i) => `${i ? 'L' : 'M'}${f(x(r.distance))},${f(y(r.pct))}`).join(' ');
  return `
  <svg class="chart range" viewBox="0 0 ${W} ${H}" role="img" aria-label="Make percentage by distance, with the ${target}% practice zone">
    ${[0, 25, 50, 75, 100].map((t) => `<line class="grid" x1="${L}" x2="${W - R}" y1="${f(y(t))}" y2="${f(y(t))}"/>
      <text class="axis" x="${L - 6}" y="${f(y(t) + 3)}" text-anchor="end">${t}%</text>`).join('')}
    <rect class="band" x="${L}" width="${W - L - R}" y="${f(y(Math.min(100, target + band)))}" height="${f(y(target - band) - y(Math.min(100, target + band)))}"/>
    ${edges.map(([d, label]) => `<line class="edge" x1="${f(x(d))}" x2="${f(x(d))}" y1="${T - 4}" y2="${H - B}"/>
      <text class="axis" x="${f(x(d) - 3)}" y="${T - 8}" text-anchor="end">${label}</text>`).join('')}
    ${xt.map((d) => `<text class="axis" x="${f(x(d))}" y="${H - B + 14}" text-anchor="middle">${d}</text>`).join('')}
    <text class="axis" x="${W - R}" y="${H - 3}" text-anchor="end">${unit === 'm' ? 'metres' : 'feet'} from the basket</text>
    ${rows.length > 1 ? `<path class="line-range" d="${line}"/>` : ''}
    ${rows.map((r) => `<line class="whisker" x1="${f(x(r.distance))}" x2="${f(x(r.distance))}" y1="${f(y(r.hi))}" y2="${f(y(r.lo))}"/>`).join('')}
    ${rows.map((r) => `${r.distance === selected ? `<circle class="pt-ring" cx="${f(x(r.distance))}" cy="${f(y(r.pct))}" r="9"/>` : ''}
      <circle class="pt ${esc(r.status)}" cx="${f(x(r.distance))}" cy="${f(y(r.pct))}" r="4.5"><title>${r.distance} ${unit}: ${Math.round(r.pct)}% of ${r.attempts} putts</title></circle>`).join('')}
  </svg>`;
}

/** One value per session over time, with a 5-session rolling average on top. */
export function lineChart(points, { yMax = 100, suffix = '%', label = '', target = null } = {}) {
  if (points.length < 2) return `<p class="muted small">Two sessions here and a trend line appears.</p>`;
  const W = 340, H = 170, L = 34, R = 12, T = 12, B = 24;
  const x = (i) => L + (i * (W - L - R)) / (points.length - 1);
  const y = (v) => T + (1 - v / yMax) * (H - T - B);
  const ticks = [0, 0.25, 0.5, 0.75, 1].map((t) => Math.round(t * yMax));
  const path = (vals) => vals.map((v, i) => `${i ? 'L' : 'M'}${f(x(i))},${f(y(v))}`).join(' ');
  const avg = points.map((_, i) => {
    const w = points.slice(Math.max(0, i - 4), i + 1);
    return w.reduce((n, p) => n + p.value, 0) / w.length;
  });
  return `
  <svg class="chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(label)}">
    ${ticks.map((t) => `<line class="grid" x1="${L}" x2="${W - R}" y1="${f(y(t))}" y2="${f(y(t))}"/>
      <text class="axis" x="${L - 6}" y="${f(y(t) + 3)}" text-anchor="end">${t}${suffix}</text>`).join('')}
    ${target != null ? `<line class="target" x1="${L}" x2="${W - R}" y1="${f(y(target))}" y2="${f(y(target))}"/>` : ''}
    <path class="area" d="${path(avg)} L${f(x(points.length - 1))},${f(y(0))} L${f(x(0))},${f(y(0))} Z"/>
    <path class="line-raw" d="${path(points.map((p) => p.value))}"/>
    <path class="line-avg" d="${path(avg)}"/>
    ${points.map((p, i) => `<circle class="dot" cx="${f(x(i))}" cy="${f(y(p.value))}" r="2.4"><title>${shortDate(p.date)}: ${Math.round(p.value)}${suffix}</title></circle>`).join('')}
    <circle class="end" cx="${f(x(points.length - 1))}" cy="${f(y(avg.at(-1)))}" r="4"/>
    <text class="axis" x="${L}" y="${H - 5}">${shortDate(points[0].date)}</text>
    <text class="axis" x="${W - R}" y="${H - 5}" text-anchor="end">${shortDate(points.at(-1).date)}</text>
  </svg>
  <p class="legend small"><span class="key raw"></span>each session <span class="key avg"></span>5-session average</p>`;
}
