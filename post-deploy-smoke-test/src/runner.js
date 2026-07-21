// Orchestrates a smoke run: builds requests from config (incl. authed checks
// via Application Password from env), fetches through the injected adapter with
// a hard per-check timeout, and evaluates each response with the pure core.
//
// Adapter interface: { fetch(req) -> Promise<response> } where
//   req = { url, headers, timeoutMs, check }
// and response matches the shape documented in evaluate.js. Tests inject a fake
// adapter serving fixtures — no network is ever touched from here.

import {
  evaluateCheck,
  summarize,
  DEFAULT_TIMEOUT_MS,
  DEFAULT_SOFT_BUDGET_MS,
} from './evaluate.js';

export function buildRequests(config, env = {}, now = Date.now) {
  if (!config.base_url) throw new Error('smoke.yml: base_url is required');
  const defaultTimeout = config.timeout_ms ?? DEFAULT_TIMEOUT_MS;
  const requests = [];

  for (const check of config.checks ?? []) {
    requests.push({
      check,
      url: buildUrl(config.base_url, check, now),
      headers: {},
      timeoutMs: check.timeout_ms ?? defaultTimeout,
      authed: false,
    });
  }

  for (const check of config.authed ?? []) {
    const envName = check.app_password_env ?? 'WP_APP_PASSWORD';
    const req = {
      check,
      url: buildUrl(config.base_url, check, now),
      headers: {},
      timeoutMs: check.timeout_ms ?? defaultTimeout,
      authed: true,
    };
    const secret = env[envName];
    if (!secret) {
      req.missingEnv = envName;
    } else {
      req.headers.authorization =
        'Basic ' + Buffer.from(`${check.user ?? 'admin'}:${secret}`).toString('base64');
    }
    requests.push(req);
  }

  return requests;
}

function buildUrl(baseUrl, check, now) {
  if (!check.path) throw new Error('smoke.yml: every check needs a "path"');
  const url = new URL(check.path, baseUrl);
  if (check.cache_bust) url.searchParams.set('smoke', String(now()));
  return url.toString();
}

// Hard timeout: even a hung adapter (or hung origin) cannot stall the run
// beyond timeoutMs for this check.
export async function fetchWithHardTimeout(adapter, req) {
  let timer;
  try {
    return await Promise.race([
      Promise.resolve()
        .then(() => adapter.fetch(req))
        .catch((err) => ({ error: err?.message ?? String(err) })),
      new Promise((resolve) => {
        timer = setTimeout(
          () => resolve({ timedOut: true, durationMs: req.timeoutMs }),
          req.timeoutMs,
        );
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Run all checks. Returns { ok, summary, results, durationMs, target }.
 */
export async function runSmoke(config, adapter, opts = {}) {
  const failFast = opts.failFast ?? config.fail_fast ?? false;
  const softBudgetMs = opts.softBudgetMs ?? config.soft_budget_ms ?? DEFAULT_SOFT_BUDGET_MS;
  const env = opts.env ?? {};
  const now = opts.now ?? Date.now;
  const started = now();
  const results = [];

  for (const req of buildRequests(config, env, now)) {
    let result;
    if (req.missingEnv) {
      result = {
        path: req.check.path,
        ok: false,
        failures: [
          `authed check needs env var ${req.missingEnv}, which is not set (see .env.example)`,
        ],
        warnings: [],
        status: null,
        durationMs: null,
      };
    } else {
      const response = await fetchWithHardTimeout(adapter, req);
      result = evaluateCheck(req.check, response, {
        timeoutMs: req.timeoutMs,
        softBudgetMs,
        minBodyBytes: config.min_body_bytes,
        baseUrl: config.base_url,
      });
    }
    result.url = req.url;
    result.authed = req.authed;
    results.push(result);
    if (failFast && !result.ok) break;
  }

  const summary = summarize(results);
  return {
    ok: summary.failed === 0,
    summary,
    results,
    durationMs: now() - started,
    target: config.base_url,
  };
}
