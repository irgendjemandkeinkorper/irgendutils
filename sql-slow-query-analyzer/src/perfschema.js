// Map performance_schema.events_statements_summary_by_digest rows into the
// same group shape produced by aggregateEntries(). Timer values are picoseconds.
import { normalizeQuery, digestId } from './digest.js';
import { rankGroups, round1 } from './aggregate.js';

const PS_PER_MS = 1e9;

export function mapPerfSchemaRows(rows, { minTotalTimeMs = 0 } = {}) {
  const groups = [];
  for (const r of rows ?? []) {
    const text = r.DIGEST_TEXT ?? r.digest_text;
    if (!text) continue;
    const normalized = normalizeQuery(text);
    const count = Number(r.COUNT_STAR ?? r.count_star ?? 0);
    if (!normalized || count <= 0) continue;
    const totalMs = Number(r.SUM_TIMER_WAIT ?? r.sum_timer_wait ?? 0) / PS_PER_MS;
    const rowsExamined = Number(r.SUM_ROWS_EXAMINED ?? r.sum_rows_examined ?? 0);
    const rowsSent = Number(r.SUM_ROWS_SENT ?? r.sum_rows_sent ?? 0);
    const q95 = r.QUANTILE_95 ?? r.quantile_95;
    groups.push({
      digest: digestId(normalized),
      normalized,
      sample: normalized, // digest text is parameterized; no literal sample exists
      count,
      totalMs: round1(totalMs),
      meanMs: round1(totalMs / count),
      p95Ms: round1(q95 != null ? Number(q95) / PS_PER_MS : totalMs / count),
      rowsExamined,
      rowsSent,
      examineRatio: Math.round(rowsExamined / Math.max(1, rowsSent)),
    });
  }
  return rankGroups(groups).filter((g) => g.totalMs >= minTotalTimeMs);
}
