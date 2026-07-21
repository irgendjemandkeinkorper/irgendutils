// Live MySQL adapter. Loaded lazily and only when a real DB connection is
// requested. Requires the OPTIONAL dependency `mysql2` (npm i mysql2) — tests
// and offline analysis never touch this file. Every statement passes the
// read-only guard before being sent, and everything sent is logged.
import { assertReadOnly } from '../readonly.js';

export async function createMysqlAdapter({ host, port = 3306, name, user, password }) {
  let mysql;
  try {
    const mod = await import('mysql2/promise');
    mysql = mod.default ?? mod;
  } catch {
    throw new Error(
      "Live DB support needs the optional dependency 'mysql2'. Install it with: npm i mysql2 — or run with --no-db for log-only analysis.",
    );
  }
  const conn = await mysql.createConnection({ host, port, user, password, database: name });
  const log = [];
  async function q(sql, params = []) {
    assertReadOnly(sql);
    log.push(sql);
    const [rows] = await conn.query(sql, params);
    return rows;
  }

  return {
    kind: 'mysql',
    log,

    async explain(sql) {
      return q(`EXPLAIN ${String(sql).replace(/;+\s*$/, '')}`);
    },

    async listIndexes(table) {
      const rows = await q(
        'SELECT INDEX_NAME AS index_name, SEQ_IN_INDEX AS seq, COLUMN_NAME AS col, NON_UNIQUE AS non_unique FROM information_schema.statistics WHERE table_schema = DATABASE() AND table_name = ? ORDER BY index_name, seq',
        [table],
      );
      const byName = new Map();
      for (const r of rows) {
        if (!byName.has(r.index_name)) byName.set(r.index_name, { name: r.index_name, unique: !r.non_unique, columns: [] });
        byName.get(r.index_name).columns.push(r.col);
      }
      return [...byName.values()];
    },

    async autoloadStats() {
      try {
        const where = "autoload IN ('yes','on','auto','auto-on')";
        const [totals] = await q(
          `SELECT COUNT(*) AS cnt, COALESCE(SUM(LENGTH(option_value)), 0) AS total_bytes FROM wp_options WHERE ${where}`,
        );
        const top = await q(
          `SELECT option_name AS name, LENGTH(option_value) AS bytes FROM wp_options WHERE ${where} ORDER BY bytes DESC, option_name LIMIT 10`,
        );
        return { totalBytes: Number(totals.total_bytes), count: Number(totals.cnt), top };
      } catch {
        return null; // not a WordPress database
      }
    },

    async perfSchemaDigests() {
      const base =
        'SELECT DIGEST_TEXT, COUNT_STAR, SUM_TIMER_WAIT, SUM_ROWS_EXAMINED, SUM_ROWS_SENT%COLS% FROM performance_schema.events_statements_summary_by_digest WHERE DIGEST_TEXT IS NOT NULL';
      try {
        return await q(base.replace('%COLS%', ', QUANTILE_95')); // MySQL >= 8.0
      } catch {
        return q(base.replace('%COLS%', ''));
      }
    },

    async close() {
      await conn.end();
    },
  };
}
