// Console + network check. An error-level console message or a genuinely failed
// resource request during load is a finding — but two common, benign patterns
// are downgraded so they don't fail every real-world site:
//
//   * Analytics / beacon endpoints (Google Analytics, GTM, Meta Pixel, …) are
//     fire-and-forget. The browser routinely aborts them on page unload, and a
//     failure never affects the page. Reported as info, never a failure.
//   * An aborted request (net::ERR_ABORTED / BLOCKED_BY_CLIENT) is a
//     cancellation — a beacon on unload, a navigation, a prefetch — not a
//     resource that failed to load. Reported as a warning. Real breakage looks
//     like ERR_NAME_NOT_RESOLVED / ERR_CONNECTION_REFUSED / ERR_TIMED_OUT or an
//     HTTP 4xx/5xx, which stays an error.

// Substrings that identify third-party analytics / tracking / beacon endpoints.
export const BEACON_HOSTS = [
  'google-analytics.com',
  'analytics.google.com',
  'googletagmanager.com',
  'g/collect',
  'doubleclick.net',
  'connect.facebook.net',
  'facebook.com/tr',
  'bat.bing.com',
  'clarity.ms',
  'hotjar.com',
  'hotjar.io',
  'segment.com',
  'segment.io',
  'ct.pinterest.com',
  'px.ads.linkedin.com',
  'snap.licdn.com',
  'analytics.tiktok.com',
];

export function isBeaconUrl(url) {
  const u = String(url);
  return BEACON_HOSTS.some((h) => u.includes(h));
}

export function isAbortedReason(reason) {
  return /ERR_ABORTED|ERR_BLOCKED_BY_CLIENT|(^|\b)aborted\b/i.test(String(reason || ''));
}

// Drop the query string for noisy beacon URLs (GA "collect" URLs are enormous).
function tidyBeaconUrl(url) {
  const s = String(url);
  const q = s.indexOf('?');
  return q === -1 ? s : s.slice(0, q);
}

export function checkConsole(messages = [], failedRequests = []) {
  const findings = [];

  for (const m of messages) {
    const type = String(m.type || '').toLowerCase();
    if (type === 'error') {
      findings.push({ check: 'console', severity: 'error', message: `Console error: ${m.text}` });
    } else if (type === 'warning' || type === 'warn') {
      findings.push({ check: 'console', severity: 'warn', message: `Console warning: ${m.text}` });
    }
  }

  for (const r of failedRequests) {
    const reason = r.reason || '';

    if (isBeaconUrl(r.url)) {
      findings.push({
        check: 'console',
        severity: 'info',
        message: `Analytics/beacon request did not complete (ignored): ${tidyBeaconUrl(r.url)}${reason ? ` (${reason})` : ''}`,
        details: { url: r.url, reason, beacon: true },
      });
      continue;
    }

    if (isAbortedReason(reason)) {
      findings.push({
        check: 'console',
        severity: 'warn',
        message: `Request aborted during load (likely a cancelled beacon or navigation, not a broken resource): ${r.url}${reason ? ` (${reason})` : ''}`,
        details: { url: r.url, reason, aborted: true },
      });
      continue;
    }

    findings.push({
      check: 'console',
      severity: 'error',
      message: `Failed request during load: ${r.url}${reason ? ` (${reason})` : ''}`,
      details: { url: r.url, ...(reason ? { reason } : {}) },
    });
  }

  return findings;
}
