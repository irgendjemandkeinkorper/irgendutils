// Console table + results.json assembly. Pure formatting, no I/O.

const ANSI = {
  green: '\x1b[32m',
  red: '\x1b[31m',
  yellow: '\x1b[33m',
  dim: '\x1b[2m',
  reset: '\x1b[0m',
};

export function redactSecrets(obj, env = process.env) {
  const secretValues = new Set();
  const secretKeys = ['PASSWORD', 'SECRET', 'TOKEN', 'KEY', 'AUTH', 'PASS', 'PWD'];
  for (const [key, value] of Object.entries(env)) {
    if (value && value.length >= 3) {
      if (secretKeys.some(k => key.toUpperCase().includes(k))) {
        if (!key.toUpperCase().includes('PATH') && !key.toUpperCase().includes('FILE') && !key.toUpperCase().includes('DIR')) {
          secretValues.add(value);
        }
      }
    }
  }

  const redactString = (str) => {
    if (typeof str !== 'string') return str;
    let current = str;
    for (const secret of secretValues) {
      current = current.split(secret).join('[REDACTED]');
    }
    current = current.replace(/(https?:\/\/)([^:@]+):([^@]+)(@)/g, '$1$2:[REDACTED]$4');
    return current;
  };

  const redactValue = (val) => {
    if (val === null || val === undefined) return val;
    if (typeof val === 'string') return redactString(val);
    if (Array.isArray(val)) return val.map(redactValue);
    if (typeof val === 'object') {
      const copy = {};
      for (const [k, v] of Object.entries(val)) {
        if (secretKeys.some(key => k.toUpperCase().includes(key)) && typeof v === 'string') {
          copy[k] = '[REDACTED]';
        } else {
          copy[k] = redactValue(v);
        }
      }
      return copy;
    }
    return val;
  };

  return redactValue(obj);
}

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
  return redactSecrets(lines.join('\n'));
}

export function buildResultsJson(run, opts = {}) {
  const generatedAt = opts.generatedAt ?? new Date().toISOString();
  const startTime = opts.startTime ?? new Date(Date.now() - (run.durationMs || 0)).toISOString();

  const envelope = {
    contract_version: '1.0.0',
    tool: {
      name: '@irgendutils/post-deploy-smoke-test',
      version: '1.0.0',
    },
    status: run.ok ? 'success' : 'failure',
    summary: {
      total: run.summary.total,
      passed: run.summary.passed,
      failed: run.summary.failed,
      warnings: run.summary.warnings,
    },
    results: run.results.map((r) => ({
      path: r.path,
      url: r.url,
      authed: r.authed ?? false,
      ok: r.ok,
      status: r.status,
      duration_ms: r.durationMs,
      failures: r.failures,
      warnings: r.warnings,
    })),
    warnings: run.results.flatMap((r) => r.warnings || []),
    errors: run.results.flatMap((r) => r.failures || []),
    timing: {
      start_time: startTime,
      end_time: generatedAt,
      duration_ms: run.durationMs,
    },
    artifacts: opts.outPath ? [opts.outPath] : [],
  };

  return redactSecrets(envelope, opts.env || process.env);
}
