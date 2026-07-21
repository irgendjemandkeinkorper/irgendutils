// Console table + results.json assembly. Pure formatting, no I/O.

const ANSI = {
  green: '\x1b[32m',
  red: '\x1b[31m',
  yellow: '\x1b[33m',
  dim: '\x1b[2m',
  reset: '\x1b[0m',
};

export function formatTable(run, opts = {}) {
  const useColor = opts.color ?? false;
  const paint = (code, s) => (useColor ? ANSI[code] + s + ANSI.reset : s);

  const rows = run.results.map((r) => {
    const label = r.path + (r.authed ? ' (authed)' : '');
    const status = r.status == null ? '—' : String(r.status);
    const time = r.durationMs == null ? '—' : `${r.durationMs}ms`;
    let reason = '';
    if (!r.ok) reason = r.failures.join('; ');
    else if (r.warnings.length) reason = 'warn: ' + r.warnings.join('; ');
    return { ok: r.ok, warned: r.warnings.length > 0, label, status, time, reason };
  });

  const w = {
    label: Math.max(5, ...rows.map((r) => r.label.length)),
    status: Math.max(6, ...rows.map((r) => r.status.length)),
    time: Math.max(4, ...rows.map((r) => r.time.length)),
  };

  const lines = [];
  lines.push(
    `  ${'check'.padEnd(w.label)}  ${'status'.padEnd(w.status)}  ${'time'.padEnd(w.time)}  reason`,
  );
  for (const r of rows) {
    const mark = r.ok ? paint('green', '✓') : paint('red', '✗');
    const reason = r.ok
      ? paint('yellow', r.reason)
      : paint('red', r.reason);
    lines.push(
      `${mark} ${r.label.padEnd(w.label)}  ${r.status.padEnd(w.status)}  ${r.time.padEnd(w.time)}  ${reason}`.trimEnd(),
    );
  }

  const s = run.summary;
  const verdict = run.ok ? paint('green', 'PASS') : paint('red', 'FAIL');
  lines.push('');
  lines.push(
    `${verdict}  ${s.passed}/${s.total} passed, ${s.failed} failed, ${s.warnings} warning${s.warnings === 1 ? '' : 's'}  ${paint('dim', `(${run.durationMs}ms against ${run.target})`)}`,
  );
  return lines.join('\n');
}

export function buildResultsJson(run, opts = {}) {
  const generatedAt = opts.generatedAt ?? new Date().toISOString();
  return {
    tool: '@irgendutils/post-deploy-smoke-test',
    target: run.target,
    generated_at: generatedAt,
    ok: run.ok,
    duration_ms: run.durationMs,
    summary: run.summary,
    checks: run.results.map((r) => ({
      path: r.path,
      url: r.url,
      authed: r.authed ?? false,
      ok: r.ok,
      status: r.status,
      duration_ms: r.durationMs,
      failures: r.failures,
      warnings: r.warnings,
    })),
  };
}
