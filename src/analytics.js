/**
 * Anonymous usage stats, sent to PostHog: which screens get opened and which kinds of session
 * get played. No names, notes, routines or distances. Nothing loads unless S.analyticsOn() says so.
 */
import * as S from './stats.js';

/**
 * One line in the console for each state worth knowing about. Both failures this file has had in
 * the wild — a content blocker eating the script, and a proxy rewrite that 404'd every event —
 * were invisible: the SDK initialised, `posthog` looked healthy, and nothing was recorded for
 * weeks. Silence is the bug, so say what is actually happening.
 */
const say = (msg) => console.info('[usage-stats]', msg);

let client = null; // PostHog, once its script has loaded
let on = false;
const queue = []; // events captured while the script is still loading

/** Call at startup and whenever the setting changes. */
export function startAnalytics(settings) {
  on = S.analyticsOn(S.ANALYTICS_KEY, location.hostname, settings);
  if (!on) {
    queue.length = 0;
    say(!S.ANALYTICS_KEY ? 'off: no key set'
      : location.hostname !== S.ANALYTICS_SITE ? `off: only ${S.ANALYTICS_SITE} reports, this is ${location.hostname}`
      : 'off: switched off in Settings');
  }
  if (client) {
    if (on) client.opt_in_capturing(); else client.opt_out_capturing();
    return;
  }
  if (!on || document.getElementById('usage-stats')) return;
  const script = Object.assign(document.createElement('script'), { id: 'usage-stats', async: true, src: S.ANALYTICS_SCRIPT });
  // A blocked or failed load (ad blockers, offline) sends nothing; it is only fine if it is said out loud.
  script.onerror = () => say(`blocked: ${S.ANALYTICS_SCRIPT} never loaded, so no events will be sent`);
  script.onload = () => {
    const ph = window.posthog;
    if (!ph?.init) { say('loaded, but PostHog did not initialise'); return; }
    ph.init(S.ANALYTICS_KEY, {
      api_host: S.ANALYTICS_HOST,
      ui_host: S.ANALYTICS_UI_HOST, // api_host is our own domain, so name the real one for links
      persistence: 'localStorage', // a random ID next to the app's own data; no cookies
      person_profiles: 'always', // no login here, so without this there are no profiles and cohorts stay empty
      autocapture: false, // only the events named in app.js, so typed text can never be picked up
      capture_pageview: false, // screens are #hash routes; app.js reports them
      disable_session_recording: true,
      disable_surveys: true,
      advanced_disable_flags: true, // no feature flags here, so skip the request for them
      on_request_error: (err) => say(`event rejected: HTTP ${err?.statusCode} from ${S.ANALYTICS_HOST} — not recorded`),
    });
    ph.register({ installed: matchMedia('(display-mode: standalone)').matches || navigator.standalone === true });
    client = ph;
    if (!on) { ph.opt_out_capturing(); return; }
    for (const [event, props, timestamp] of queue.splice(0)) ph.capture(event, props, { timestamp });
    say(`on, sending via ${S.ANALYTICS_HOST}`);
  };
  document.head.append(script);
}

export function track(event, props = {}) {
  if (!on) return;
  if (client) client.capture(event, props);
  else if (queue.length < 100) queue.push([event, props, new Date()]);
}
