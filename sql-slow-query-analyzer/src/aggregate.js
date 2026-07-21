// Aggregate slow-log entries per query digest and rank by TOTAL time impact.
// Pure functions; deterministic ordering (total time desc, digest id as tiebreak).
import { normalizeQuery, digestId } from './digest.js';

export function round1(x) {
  return Math.round(x * 10) / 10;
}

/** Nearest-rank percentile. */
export function percentile(values, p) {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const rank = Math.max(1, Math.ceil((p / 100) * sorted.length));
  return sorted[rank - 1];
}

/**
 * Group parsed entries by digest.
 * Returns ranked groups: { digest, normalized, sample, count, totalMs, meanMs,
 * p95Ms, rowsExamined, rowsSent, examineRatio }.
 */
export function aggregateEntries(entries, { minTotalTimeMs = 0 } = {}) {
  const groups = new Map();
  for (const e of entries) {
    const normalized = normalizeQuery(e.sql);
    if (!normalized) continue;
    const id = digestId(normalized);
    let g = groups.get(id);
    if (!g) {
      g = { digest: id, normalized, sample: e.sql, count: 0, times: [], totalMs: 0, rowsExamined: 0, rowsSent: 0 };
      groups.set(id, g);
    }
    g.count += 1;
    g.times.push(e.queryTimeMs);
    g.totalMs += e.queryTimeMs;
    g.rowsExamined += e.rowsExamined ?? 0;
    g.rowsSent += e.rowsSent ?? 0;
  }
  const out = [...groups.values()].map((g) => ({
    digest: g.digest,
    normalized: g.normalized,
    sample: g.sample,
    count: g.count,
    totalMs: round1(g.totalMs),
    meanMs: round1(g.totalMs / g.count),
    p95Ms: round1(percentile(g.times, 95)),
    rowsExamined: g.rowsExamined,
    rowsSent: g.rowsSent,
    examineRatio: Math.round(g.rowsExamined / Math.max(1, g.rowsSent)),
  }));
  return rankGroups(out).filter((g) => g.totalMs >= minTotalTimeMs);
}

/** Deterministic ranking: total time impact desc, then digest id. */
export function rankGroups(groups) {
  return [...groups].sort((a, b) => b.totalMs - a.totalMs || a.digest.localeCompare(b.digest));
}
