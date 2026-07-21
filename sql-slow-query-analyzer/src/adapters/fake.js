// Offline fake DB adapter. Serves fixture EXPLAIN/schema/autoload data and
// records every statement it "sends" in `adapter.log` — tests assert the log
// contains only read-only statements. Same guard the real adapter uses.
import { assertReadOnly } from '../readonly.js';
import { normalizeQuery } from '../digest.js';
import { parseQueryShape } from '../diagnose.js';

const AUTOLOAD_WHERE = "autoload IN ('yes','on','auto','auto-on')";

export function createFakeAdapter(fixture = {}) {
  const log = [];
  const send = (sql) => {
    assertReadOnly(sql);
    log.push(sql);
  };

  const mainTable = (sql) => parseQueryShape(normalizeQuery(sql)).tables[0]?.table ?? null;

  return {
    kind: 'fake',
    log,

    async explain(sql) {
      send(`EXPLAIN ${sql.replace(/;+\s*$/, '')}`);
      const table = mainTable(sql);
      return (
        fixture.explains?.[table] ?? [
          { id: 1, select_type: 'SIMPLE', table, type: 'ALL', possible_keys: null, key: null, rows: 1000, Extra: 'Using where' },
        ]
      );
    },

    async listIndexes(table) {
      send(
        `SELECT index_name, seq_in_index, column_name, non_unique FROM information_schema.statistics WHERE table_schema = DATABASE() AND table_name = '${table}' ORDER BY index_name, seq_in_index`,
      );
      return fixture.indexes?.[table] ?? [];
    },

    async autoloadStats() {
      send(`SELECT COUNT(*) AS cnt, COALESCE(SUM(LENGTH(option_value)), 0) AS total_bytes FROM wp_options WHERE ${AUTOLOAD_WHERE}`);
      send(`SELECT option_name, LENGTH(option_value) AS bytes FROM wp_options WHERE ${AUTOLOAD_WHERE} ORDER BY bytes DESC, option_name LIMIT 10`);
      return fixture.autoload ?? null;
    },

    async perfSchemaDigests() {
      send(
        'SELECT DIGEST_TEXT, COUNT_STAR, SUM_TIMER_WAIT, SUM_ROWS_EXAMINED, SUM_ROWS_SENT, QUANTILE_95 FROM performance_schema.events_statements_summary_by_digest WHERE DIGEST_TEXT IS NOT NULL',
      );
      return fixture.perfDigests ?? [];
    },

    async close() {},
  };
}
