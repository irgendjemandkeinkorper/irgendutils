// Fixture adapter — an offline, in-memory "database" driven by a JSON
// information_schema snapshot. Used by all tests (npm test needs no network,
// no MySQL) and available via `db.fixture` / `--fixture` for demos.
//
// It also simulates the destructive side: execute() applies ALTER statements
// to the in-memory snapshot, and roundTrip() models how a value's bytes fare
// when stored in a column of a given charset (latin1 / 3-byte utf8 mangle
// emoji; utf8mb4 preserves them) so tests can assert stored bytes.

import { readFileSync } from 'node:fs';

export class FixtureAdapter {
  constructor(snapshot) {
    this.snapshot = structuredClone(snapshot);
    this.executed = [];
  }

  static fromFile(path) {
    return new FixtureAdapter(JSON.parse(readFileSync(path, 'utf8')));
  }

  async fetchSnapshot() {
    return structuredClone(this.snapshot);
  }

  async execute(sql) {
    this.executed.push(sql);
    const s = sql.trim().replace(/;$/, '');

    if (/^SET\s+FOREIGN_KEY_CHECKS\s*=\s*[01]$/i.test(s)) return;

    let m = s.match(/^SET\s+NAMES\s+'?(\w+)'?(?:\s+COLLATE\s+'?(\w+)'?)?$/i);
    if (m) {
      this.snapshot.connection ??= {};
      this.snapshot.connection.character_set_client = m[1];
      this.snapshot.connection.character_set_connection = m[1];
      this.snapshot.connection.character_set_results = m[1];
      if (m[2]) this.snapshot.connection.collation_connection = m[2];
      return;
    }

    m = s.match(/^ALTER\s+DATABASE\s+`?([\w-]+)`?\s+CHARACTER\s+SET\s+(\w+)(?:\s+COLLATE\s+(\w+))?$/i);
    if (m) {
      if (this.snapshot.database?.name !== m[1]) {
        throw new Error(`fixture: unknown database ${m[1]}`);
      }
      this.snapshot.database.charset = m[2];
      if (m[3]) this.snapshot.database.collation = m[3];
      return;
    }

    m = s.match(/^ALTER\s+TABLE\s+`?([\w-]+)`?\s+CONVERT\s+TO\s+CHARACTER\s+SET\s+(\w+)(?:\s+COLLATE\s+(\w+))?$/i);
    if (m) {
      const table = (this.snapshot.tables ?? []).find((t) => t.name === m[1]);
      if (!table) throw new Error(`fixture: unknown table ${m[1]}`);
      // Enforce the very limit the index warning is about: MySQL rejects the
      // conversion when an index prefix would overflow — model that too? No:
      // real MySQL >=5.7 with DYNAMIC succeeds; old formats error. Keep the
      // fixture permissive and rely on the pre-flight warning.
      table.charset = m[2];
      if (m[3]) table.collation = m[3];
      for (const col of table.columns ?? []) {
        if (col.charset != null) {
          col.charset = m[2];
          if (m[3]) col.collation = m[3];
        }
      }
      return;
    }

    throw new Error(`fixture adapter cannot execute: ${sql}`);
  }

  /**
   * Simulate storing `text` in table.column and reading it back.
   * Returns { storedBytes: Buffer, retrieved: string } based on the column's
   * CURRENT charset — call before and after conversion to assert survival.
   */
  async roundTrip(tableName, columnName, text) {
    const table = (this.snapshot.tables ?? []).find((t) => t.name === tableName);
    const col = table?.columns?.find((c) => c.name === columnName);
    if (!col) throw new Error(`fixture: no such column ${tableName}.${columnName}`);
    const charset = String(col.charset ?? 'utf8mb4').toLowerCase();

    if (charset === 'utf8mb4') {
      const storedBytes = Buffer.from(text, 'utf8');
      return { storedBytes, retrieved: storedBytes.toString('utf8') };
    }
    if (charset === 'utf8' || charset === 'utf8mb3') {
      // 3-byte utf8: supplementary-plane code points (emoji) cannot be stored.
      const mangled = [...text]
        .map((ch) => (ch.codePointAt(0) > 0xffff ? '?' : ch))
        .join('');
      const storedBytes = Buffer.from(mangled, 'utf8');
      return { storedBytes, retrieved: storedBytes.toString('utf8') };
    }
    if (charset === 'latin1') {
      const mangled = [...text]
        .map((ch) => (ch.codePointAt(0) > 0xff ? '?' : ch))
        .join('');
      const storedBytes = Buffer.from(mangled, 'latin1');
      return { storedBytes, retrieved: storedBytes.toString('latin1') };
    }
    throw new Error(`fixture: unmodeled charset ${charset}`);
  }

  async close() {}
}
