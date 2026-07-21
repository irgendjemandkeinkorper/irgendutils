// Pure per-check evaluation. Takes a check definition and an already-fetched
// response (real adapter or test fixture) and returns a verdict. No I/O here.
//
// Response shape (produced by adapters / fixtures):
//   {
//     status: 200,                 // HTTP status code
//     headers: { location: ... }, // lower-cased header names
//     body: "...",                // response body as text
//     durationMs: 123,            // wall time of the request
//     timedOut: true,             // set when the hard timeout fired
//     error: "ECONNREFUSED ...",  // network/TLS error message
//   }

export const DEFAULT_TIMEOUT_MS = 8000;
export const DEFAULT_SOFT_BUDGET_MS = 2000;
export const DEFAULT_MIN_BODY_BYTES = 100;

const FATAL_MARKERS = [
  { re: /Fatal error/, label: '"Fatal error" (PHP fatal)' },
  { re: /There has been a critical error/, label: '"There has been a critical error" (WP death screen)' },
  { re: /Stack trace:/, label: '"Stack trace:" (PHP exception dump)' },
  { re: /^#\d+\s+\S+\.php[(:]/m, label: 'PHP stack frame in body' },
  { re: /Traceback \(most recent call last\)/, label: 'Python traceback in body' },
  { re: /^\s+at .+ \(.+:\d+:\d+\)$/m, label: 'JS stack trace in body' },
  { re: /Uncaught (Error|Exception|TypeError)/, label: 'uncaught exception in body' },
];

export function findFatalMarker(body) {
  for (const m of FATAL_MARKERS) {
    if (m.re.test(body)) return m.label;
  }
  return null;
}

/**
 * Evaluate one check against a fetched response.
 * @param {object} check   { path, status?, contains?, json?, redirects_to?, max_ms?, min_body_bytes? }
 * @param {object} response  see shape above (or null/undefined when nothing came back)
 * @param {object} opts    { timeoutMs, softBudgetMs, minBodyBytes, baseUrl }
 * @returns {{ path, ok, failures: string[], warnings: string[], status, durationMs }}
 */
export function evaluateCheck(check, response, opts = {}) {
  const timeoutMs = opts.timeoutMs ?? check.timeout_ms ?? DEFAULT_TIMEOUT_MS;
  const softBudgetMs = opts.softBudgetMs ?? DEFAULT_SOFT_BUDGET_MS;
  const minBodyBytes = check.min_body_bytes ?? opts.minBodyBytes ?? DEFAULT_MIN_BODY_BYTES;
  const expectStatus = check.status ?? 200;
  const failures = [];
  const warnings = [];

  if (!response) {
    failures.push('no response received');
  } else if (response.timedOut) {
    failures.push(`timed out after ${timeoutMs}ms (hard per-check timeout)`);
  } else if (response.error) {
    failures.push(`request failed: ${response.error}`);
  } else {
    const body = String(response.body ?? '');

    // 1. Status code
    if (response.status !== expectStatus) {
      failures.push(`expected status ${expectStatus}, got ${response.status}`);
    }

    // 2. Redirect target (for expected 301/302)
    if (check.redirects_to) {
      const loc = headerValue(response.headers, 'location');
      if (!loc) {
        failures.push(`expected redirect to ${check.redirects_to}, but no Location header`);
      } else if (!redirectMatches(check.redirects_to, loc, opts.baseUrl)) {
        failures.push(`expected redirect to ${check.redirects_to}, got ${loc}`);
      }
    }

    // 3. JSON validity
    if (check.json) {
      try {
        JSON.parse(body);
      } catch (err) {
        failures.push(`body is not valid JSON: ${err.message}`);
      }
    }

    // 4. Content assertion (proof-of-life string)
    if (check.contains && !body.includes(check.contains)) {
      failures.push(`body does not contain "${check.contains}"`);
    }

    // 5. Fatal-error markers + white-screen detection (only when success expected)
    if (expectStatus < 400) {
      const marker = findFatalMarker(body);
      if (marker) failures.push(`fatal-error marker in body: ${marker}`);

      if (expectStatus < 300 && !check.json && !check.redirects_to) {
        const size = Buffer.byteLength(body.trim(), 'utf8');
        if (size < minBodyBytes) {
          failures.push(`suspiciously tiny body (${size} bytes < ${minBodyBytes}) — possible white screen`);
        }
      }
    }

    // 6. Response time: soft budget warns; explicit per-check max_ms fails.
    if (typeof response.durationMs === 'number') {
      if (typeof check.max_ms === 'number' && response.durationMs > check.max_ms) {
        failures.push(`too slow: ${response.durationMs}ms > max_ms ${check.max_ms}ms`);
      } else if (response.durationMs > softBudgetMs) {
        warnings.push(`slow: ${response.durationMs}ms > soft budget ${softBudgetMs}ms`);
      }
    }
  }

  return {
    path: check.path,
    ok: failures.length === 0,
    failures,
    warnings,
    status: response && !response.timedOut && !response.error ? response.status : null,
    durationMs: typeof response?.durationMs === 'number' ? response.durationMs : null,
  };
}

export function summarize(results) {
  const passed = results.filter((r) => r.ok).length;
  return {
    total: results.length,
    passed,
    failed: results.length - passed,
    warnings: results.reduce((n, r) => n + r.warnings.length, 0),
  };
}

function headerValue(headers, name) {
  if (!headers) return undefined;
  return headers[name] ?? headers[name.toLowerCase()] ?? headers[capitalize(name)];
}

function capitalize(s) {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

// Expected may be a path ("/new-page") or an absolute URL. Actual Location may
// be relative or absolute. Path-style expectations compare path (+query when
// given); absolute expectations compare the full URL.
function redirectMatches(expected, actual, baseUrl) {
  const base = baseUrl ?? 'http://smoke.invalid/';
  let e;
  let a;
  try {
    e = new URL(expected, base);
    a = new URL(actual, base);
  } catch {
    return expected === actual;
  }
  if (/^https?:\/\//i.test(expected)) return stripSlash(e.href) === stripSlash(a.href);
  if (e.pathname !== a.pathname && stripSlash(e.pathname) !== stripSlash(a.pathname)) return false;
  return e.search === '' || e.search === a.search;
}

function stripSlash(s) {
  return s.length > 1 && s.endsWith('/') ? s.slice(0, -1) : s;
}
