/**
 * Anonymous usage stats, sent to PostHog: which screens get opened and which kinds of session
 * get played. No names, notes, routines or distances. Nothing loads unless S.analyticsOn() says so.
 */
import * as S from './stats.js';

let client = null; // PostHog, once its script has loaded
let on = false;
const queue = []; // events captured while the script is still loading

/** Call at startup and whenever the setting changes. */
export function startAnalytics(settings) {
  on = S.analyticsOn(S.ANALYTICS_KEY, location.hostname, settings);
  if (!on) queue.length = 0;
  if (client) {
    if (on) client.opt_in_capturing(); else client.opt_out_capturing();
    return;
  }
  if (!on || document.getElementById('usage-stats')) return;
  const script = Object.assign(document.createElement('script'), { id: 'usage-stats', async: true, src: S.ANALYTICS_SCRIPT });
  // A blocked or failed load (ad blockers, offline) is fine: the queue is simply never sent.
  script.onload = () => {
    const ph = window.posthog;
    if (!ph?.init) return;
    ph.init(S.ANALYTICS_KEY, {
      api_host: S.ANALYTICS_HOST,
      persistence: 'localStorage', // a random ID next to the app's own data; no cookies
      person_profiles: 'identified_only',
      autocapture: false, // only the events named in app.js, so typed text can never be picked up
      capture_pageview: false, // screens are #hash routes; app.js reports them
      disable_session_recording: true,
      disable_surveys: true,
      advanced_disable_flags: true, // no feature flags here, so skip the request for them
    });
    ph.register({ installed: matchMedia('(display-mode: standalone)').matches || navigator.standalone === true });
    client = ph;
    if (!on) { ph.opt_out_capturing(); return; }
    for (const [event, props, timestamp] of queue.splice(0)) ph.capture(event, props, { timestamp });
  };
  document.head.append(script);
}

export function track(event, props = {}) {
  if (!on) return;
  if (client) client.capture(event, props);
  else if (queue.length < 100) queue.push([event, props, new Date()]);
}
