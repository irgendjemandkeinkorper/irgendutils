// Parser for the standard MySQL/MariaDB slow query log format. Pure, tolerant:
// malformed entries are skipped, valid ones are kept.

const STATS_RE = /Query_time:\s*([\d.]+)\s+Lock_time:\s*([\d.]+)\s+Rows_sent:\s*(\d+)\s+Rows_examined:\s*(\d+)/;

/**
 * Parse slow-log text into entries:
 *   { time, userHost, queryTimeMs, lockTimeMs, rowsSent, rowsExamined, sql }
 * Entries without a valid Query_time header or without SQL are dropped.
 */
export function parseSlowLog(text) {
  const entries = [];
  let cur = null;
  let sqlLines = [];

  const flush = () => {
    if (cur && typeof cur.queryTimeMs === 'number') {
      const sql = cleanStatement(sqlLines.join('\n'));
      if (sql) entries.push({ ...cur, sql });
    }
    cur = null;
    sqlLines = [];
  };

  for (const raw of text.split(/\r?\n/)) {
    const line = raw;
    if (line.startsWith('#')) {
      if (sqlLines.length > 0) flush();
      if (line.startsWith('# Time:')) {
        if (cur && !sqlLines.length && typeof cur.queryTimeMs === 'number') flush();
        cur = cur ?? {};
        cur.time = line.slice('# Time:'.length).trim();
      } else if (line.startsWith('# User@Host:')) {
        cur = cur ?? {};
        cur.userHost = line.slice('# User@Host:'.length).trim();
      } else {
        const m = STATS_RE.exec(line);
        if (m) {
          cur = cur ?? {};
          cur.queryTimeMs = parseFloat(m[1]) * 1000;
          cur.lockTimeMs = parseFloat(m[2]) * 1000;
          cur.rowsSent = parseInt(m[3], 10);
          cur.rowsExamined = parseInt(m[4], 10);
        }
        // other meta lines (Thread_id, Schema, etc.) are ignored
      }
      continue;
    }
    // Non-comment line: server preamble, admin statements, or query text.
    const t = line.trim();
    if (t === '') continue;
    if (/^(SET timestamp=|use\s+\S+;?$)/i.test(t)) continue;
    if (/started with:|^Tcp port:|^Time\s+Id\s+Command/.test(line)) continue;
    if (cur === null) continue; // stray text with no entry header
    sqlLines.push(line);
  }
  flush();
  return entries;
}

/** Trim a captured statement; drop pure-admin leftovers. */
function cleanStatement(sql) {
  const s = sql.trim();
  if (!s) return null;
  if (/^(quit|flush\s|# )/i.test(s)) return null;
  return s;
}
