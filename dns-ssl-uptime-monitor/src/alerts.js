// Turn check issues into alert objects and de-duplicate against recent history.

export function alertKey(host, check, kind, threshold = null) {
  return `${host}|${check}|${kind}${threshold != null ? `|${threshold}` : ''}`;
}

export function alertsFromResult(result, now) {
  const alerts = [];
  for (const [check, cr] of Object.entries(result.checks ?? {})) {
    for (const iss of cr?.issues ?? []) {
      if (iss.severity === 'info') continue; // notes never alert
      alerts.push({
        key: alertKey(result.host, check, iss.kind, iss.threshold ?? null),
        ts: now,
        target: result.target,
        host: result.host,
        check,
        kind: iss.kind,
        severity: iss.severity,
        threshold: iss.threshold ?? null,
        message: iss.message,
      });
    }
  }
  return alerts;
}

// prior: alerts previously *fired* (from history). An alert is suppressed when the
// same key fired within the last dedupeMinutes. Escalations (e.g. the 7-day →
// 1-day cert warning) carry the threshold in the key, so they still fire.
export function dedupeAlerts(alerts, prior, now, dedupeMinutes = 60) {
  const windowMs = dedupeMinutes * 60_000;
  const recent = new Set();
  for (const p of prior ?? []) {
    if (p?.key && Number.isFinite(p.ts) && now - p.ts < windowMs && p.ts <= now) {
      recent.add(p.key);
    }
  }
  const fresh = [];
  const suppressed = [];
  for (const a of alerts) (recent.has(a.key) ? suppressed : fresh).push(a);
  return { fresh, suppressed };
}
