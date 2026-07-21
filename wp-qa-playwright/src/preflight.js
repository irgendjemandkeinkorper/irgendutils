// Connectivity preflight — run before a live QA pass so DNS/TLS/wrong-URL and
// bad-credential problems surface in seconds, with a clear message, instead of
// as a browser run full of confusing failures. Uses only the adapter's cheap
// request methods (no browser launch), so it runs offline against the fake
// adapter in tests too.

/**
 * Check that the template + every target is reachable, and (when auth is
 * configured and the adapter supports it) that the Application Password works.
 * opts: { auth, log }
 * Returns { ok, results: [{ url, role, reachable, status, error, redirectChain,
 *          warning?, auth? }] }. ok is false only when something is unreachable
 * — a reachable site with failing auth is a warning, not a hard stop, because
 * the public checks still run and wp_hygiene degrades gracefully.
 */
export async function preflight(adapter, cfg, opts = {}) {
  const auth = opts.auth ?? null;
  const log = opts.log ?? (() => {});

  const urls = [];
  if (cfg.template_url) urls.push({ url: cfg.template_url, role: 'template' });
  for (const t of cfg.targets ?? []) urls.push({ url: t, role: 'target' });

  const results = [];
  for (const { url, role } of urls) {
    log(`preflight ${url}`);
    const st = await adapter.fetchStatus(url);
    const reachable = !st.error && typeof st.status === 'number' && st.status > 0;
    const entry = {
      url,
      role,
      reachable,
      status: reachable ? st.status : null,
      error: st.error || null,
      redirectChain: st.redirectChain || [],
    };
    if (reachable && st.status >= 500) entry.warning = `server responded HTTP ${st.status}`;
    if ((st.redirectChain || []).length) entry.warning = `redirects ${st.redirectChain.length} time(s) to ${st.finalUrl || 'elsewhere'}`;

    if (auth && reachable) {
      if (typeof adapter.verifyAuth === 'function') {
        entry.auth = await adapter.verifyAuth(url, auth);
      } else {
        entry.auth = { skipped: true, reason: 'adapter does not support auth verification' };
      }
    }
    results.push(entry);
  }

  return { ok: results.every((r) => r.reachable), results };
}

const ANSI = { green: '\x1b[32m', red: '\x1b[31m', yellow: '\x1b[33m', dim: '\x1b[2m', reset: '\x1b[0m' };

/** Human-readable preflight summary. */
export function formatPreflight(pf, { color = false } = {}) {
  const paint = (c, s) => (color ? ANSI[c] + s + ANSI.reset : s);
  const lines = ['Preflight — connectivity check'];
  for (const r of pf.results) {
    const mark = r.reachable ? paint('green', '✓') : paint('red', '✗');
    const status = r.reachable ? `HTTP ${r.status}` : paint('red', r.error || 'unreachable');
    let line = `${mark} ${r.role.padEnd(8)} ${r.url}  ${paint('dim', status)}`;
    lines.push(line);
    if (r.warning) lines.push(`    ${paint('yellow', 'warn')} ${r.warning}`);
    if (r.auth) {
      if (r.auth.skipped) lines.push(`    ${paint('dim', `auth: skipped (${r.auth.reason})`)}`);
      else if (r.auth.ok) lines.push(`    ${paint('green', 'auth ok')} (Application Password valid)`);
      else lines.push(`    ${paint('yellow', 'auth WARN')} ${r.auth.error || 'authentication failed'} — wp_hygiene will be skipped`);
    }
  }
  lines.push('');
  lines.push(
    pf.ok
      ? paint('green', 'Preflight passed — all targets reachable.')
      : paint('red', 'Preflight FAILED — one or more targets are unreachable (see above). Aborting before the browser run.'),
  );
  return lines.join('\n');
}
