import { appendFileSync, existsSync, mkdirSync, readFileSync } from 'node:fs';
import { dirname } from 'node:path';

// history.jsonl: one line per run — { ts, results: [compact per-target], alerts: [fired] }

export function readHistory(file) {
  if (!existsSync(file)) return [];
  const entries = [];
  for (const line of readFileSync(file, 'utf8').split('\n')) {
    const t = line.trim();
    if (!t) continue;
    try {
      entries.push(JSON.parse(t));
    } catch {
      // tolerate a torn/corrupt line rather than losing the whole history
    }
  }
  return entries;
}

export function appendRun(file, entry) {
  mkdirSync(dirname(file), { recursive: true });
  appendFileSync(file, JSON.stringify(entry) + '\n');
}

export function priorAlerts(entries) {
  return entries.flatMap((e) => e?.alerts ?? []);
}

// Keep history lines small: statuses plus the numbers trends need.
export function compactResult(r) {
  const c = {};
  if (r.checks.uptime) {
    c.uptime = {
      status: r.checks.uptime.status,
      http_status: r.checks.uptime.http_status ?? null,
      response_ms: r.checks.uptime.response_ms ?? null,
    };
  }
  if (r.checks.tls) c.tls = { status: r.checks.tls.status, days_left: r.checks.tls.days_left ?? null };
  if (r.checks.dns) c.dns = { status: r.checks.dns.status };
  if (r.checks.domain) c.domain = { status: r.checks.domain.status, days_left: r.checks.domain.days_left ?? null };
  return { target: r.target, host: r.host, status: r.status, checks: c };
}

export function summarizeHost(entries, host) {
  const rows = [];
  for (const e of entries) {
    for (const r of e?.results ?? []) {
      if (r.host === host) rows.push({ ts: e.ts, ...r });
    }
  }
  const uptimeRows = rows.filter((r) => r.checks?.uptime);
  const upCount = uptimeRows.filter((r) => r.checks.uptime.status === 'green').length;

  const incidents = [];
  let open = null;
  for (const r of rows) {
    if (r.status === 'red' && !open) {
      open = { start: r.ts, end: null, runs: 1 };
      incidents.push(open);
    } else if (r.status === 'red' && open) {
      open.runs++;
    } else if (r.status !== 'red' && open) {
      open.end = r.ts;
      open = null;
    }
  }

  const certHistory = rows
    .filter((r) => r.checks?.tls?.days_left != null)
    .map((r) => ({ ts: r.ts, days_left: r.checks.tls.days_left }));

  const alerts = entries.flatMap((e) => (e?.alerts ?? []).filter((a) => a.host === host));

  return {
    host,
    runs: rows.length,
    uptime_pct: uptimeRows.length ? Math.round((upCount / uptimeRows.length) * 1000) / 10 : null,
    incidents,
    cert_history: certHistory,
    alerts,
    last: rows.at(-1) ?? null,
  };
}
