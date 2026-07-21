import { issue, worstStatus } from '../util.js';

// Evaluate an HTTP probe result (from an adapter) against expectations.
// res: { status, ms, finalUrl, redirects, error? }  — error: 'timeout' | string
export function evaluateUptime(res, { url, expectStatus = 200, timeoutMs = 10000 } = {}) {
  const issues = [];
  if (!res || res.error) {
    const msg =
      res?.error === 'timeout'
        ? `no response within ${timeoutMs} ms`
        : `connection failed (${res?.error ?? 'no data'})`;
    issues.push(issue('red', 'down', msg));
    return { status: 'red', error: res?.error ?? 'no data', issues };
  }
  if (res.status !== expectStatus) {
    issues.push(issue('red', 'bad_status', `expected HTTP ${expectStatus}, got ${res.status}`));
  }
  const finalUrl = res.finalUrl ?? url;
  if (String(finalUrl).startsWith('http://')) {
    issues.push(issue('amber', 'http_only', 'site serves plain HTTP (no redirect to https)'));
  } else if (String(url).startsWith('http://') && String(finalUrl).startsWith('https://')) {
    issues.push(issue('info', 'https_redirect', 'http redirects to https'));
  }
  return {
    status: worstStatus(issues.map((i) => i.severity)),
    http_status: res.status,
    response_ms: res.ms ?? null,
    final_url: finalUrl,
    redirects: res.redirects?.length ?? 0,
    issues,
  };
}
