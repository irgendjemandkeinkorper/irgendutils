// Core inspection logic — pure functions over an information_schema snapshot.
//
// Snapshot shape (produced by adapters, and by JSON fixtures):
// {
//   database:   { name, charset, collation },
//   connection: { character_set_client, character_set_connection,
//                 character_set_results, collation_connection },
//   tables: [{
//     name, charset, collation, rowFormat,
//     columns: [{ name, dataType, length?, charset?, collation? }],
//     indexes: [{ name, unique, columns: [{ name, subPart? }] }],
//     foreignKeys: [{ column, refTable, refColumn }]
//   }]
// }

export const TEXT_TYPES = new Set([
  'char', 'varchar', 'tinytext', 'text', 'mediumtext', 'longtext', 'enum', 'set',
]);

// Tables whose text columns hold user content — a mismatch there is the classic
// mojibake bug, so it gets the highest severity.
const USER_CONTENT_TABLE_RE = /(posts|postmeta|comments|commentmeta|users|usermeta|terms|options|content|messages)/i;

/**
 * Is this charset acceptable for the given target?
 * MySQL's `utf8` (= utf8mb3, 3-byte) is NEVER accepted when the target is
 * utf8mb4 — it cannot store emoji or supplementary-plane CJK.
 */
export function isCharsetOk(charset, targetCharset) {
  if (charset == null || charset === '') return true; // non-text column / not applicable
  const c = String(charset).toLowerCase();
  const t = String(targetCharset).toLowerCase();
  if (c === t) return true;
  return false; // utf8 / utf8mb3 / latin1 / anything else: not correct
}

/** Parse a scope string: "all" or "tables:wp_posts,wp_postmeta" or "tables:[a,b]". */
export function parseScope(scope) {
  if (scope == null || scope === '' || scope === 'all') return { type: 'all' };
  const s = String(scope).trim();
  const m = s.match(/^tables:\[?([^\]]*)\]?$/);
  if (m) {
    const tables = m[1].split(',').map((t) => t.trim()).filter(Boolean);
    if (tables.length === 0) throw new Error(`empty table list in scope "${scope}"`);
    return { type: 'tables', tables };
  }
  throw new Error(`invalid scope "${scope}" — expected "all" or "tables:a,b"`);
}

function inScope(tableName, scope) {
  return scope.type === 'all' || scope.tables.includes(tableName);
}

/**
 * Analyze a snapshot against a target charset/collation.
 * Returns { ok, findings, indexWarnings, byTable, counts, target, scope }.
 * Pure: no I/O, no side effects.
 */
export function analyzeSchema(snapshot, opts) {
  const targetCharset = (opts.targetCharset ?? 'utf8mb4').toLowerCase();
  const targetCollation = (opts.targetCollation ?? 'utf8mb4_unicode_ci').toLowerCase();
  const scope = typeof opts.scope === 'object' && opts.scope !== null
    ? opts.scope
    : parseScope(opts.scope);

  const findings = [];

  // 1. Database default charset/collation (only meaningful for full scans —
  //    a table-scoped run should not nag about the DB default).
  if (scope.type === 'all' && snapshot.database) {
    const { name, charset, collation } = snapshot.database;
    if (!isCharsetOk(charset, targetCharset)) {
      findings.push({
        level: 'database', object: name, type: 'charset', severity: 'medium',
        current: { charset, collation }, expected: { charset: targetCharset, collation: targetCollation },
        message: `database default charset is ${charset} (want ${targetCharset}) — new tables will inherit the wrong charset`,
      });
    } else if (collation && targetCollation && collation.toLowerCase() !== targetCollation) {
      findings.push({
        level: 'database', object: name, type: 'collation', severity: 'low',
        current: { charset, collation }, expected: { charset: targetCharset, collation: targetCollation },
        message: `database default collation is ${collation} (want ${targetCollation})`,
      });
    }
  }

  // 2. Connection charset — a utf8mb4 database served over a latin1/utf8
  //    connection still corrupts new data.
  if (snapshot.connection) {
    const conn = snapshot.connection;
    for (const varName of ['character_set_client', 'character_set_connection', 'character_set_results']) {
      const val = conn[varName];
      if (val != null && !isCharsetOk(val, targetCharset)) {
        findings.push({
          level: 'connection', object: varName, type: 'charset', severity: 'high',
          current: { charset: val }, expected: { charset: targetCharset },
          message: `connection variable ${varName} is ${val} (want ${targetCharset}) — ` +
            `even correct tables get corrupted through this connection; fix the client / SET NAMES ${targetCharset}`,
        });
      }
    }
  }

  // 3. Tables and their text/varchar columns.
  for (const table of snapshot.tables ?? []) {
    if (!inScope(table.name, scope)) continue;

    if (!isCharsetOk(table.charset, targetCharset)) {
      findings.push({
        level: 'table', object: table.name, type: 'charset', severity: 'medium',
        current: { charset: table.charset, collation: table.collation },
        expected: { charset: targetCharset, collation: targetCollation },
        message: `table default charset is ${table.charset} (want ${targetCharset})`,
      });
    } else if (table.collation && targetCollation && table.collation.toLowerCase() !== targetCollation) {
      findings.push({
        level: 'table', object: table.name, type: 'collation', severity: 'low',
        current: { charset: table.charset, collation: table.collation },
        expected: { charset: targetCharset, collation: targetCollation },
        message: `table default collation is ${table.collation} (want ${targetCollation})`,
      });
    }

    for (const col of table.columns ?? []) {
      const dataType = String(col.dataType ?? '').toLowerCase();
      if (!TEXT_TYPES.has(dataType)) continue; // only text-family columns carry a charset
      if (!isCharsetOk(col.charset, targetCharset)) {
        const userContent = USER_CONTENT_TABLE_RE.test(table.name);
        findings.push({
          level: 'column', object: `${table.name}.${col.name}`,
          table: table.name, column: col.name, dataType,
          type: 'charset', severity: userContent ? 'high' : 'medium',
          current: { charset: col.charset, collation: col.collation },
          expected: { charset: targetCharset, collation: targetCollation },
          message: `column ${table.name}.${col.name} (${dataType}) is ${col.charset} (want ${targetCharset})` +
            (userContent ? ' — holds user content, mojibake risk' : ''),
        });
      } else if (
        col.collation && targetCollation && col.collation.toLowerCase() !== targetCollation
      ) {
        findings.push({
          level: 'column', object: `${table.name}.${col.name}`,
          table: table.name, column: col.name, dataType,
          type: 'collation', severity: 'low',
          current: { charset: col.charset, collation: col.collation },
          expected: { charset: targetCharset, collation: targetCollation },
          message: `column ${table.name}.${col.name} collation is ${col.collation} (want ${targetCollation})`,
        });
      }
    }
  }

  // 4. Index-length overflow warnings for tables that need conversion:
  //    utf8mb4 = 4 bytes/char; old row formats (Compact/Redundant) cap index
  //    prefixes at 767 bytes → a unique VARCHAR(255) index overflows (1020 B).
  const tablesNeedingConversion = new Set(
    findings
      .filter((f) => f.type === 'charset' && (f.level === 'table' || f.level === 'column'))
      .map((f) => f.table ?? f.object)
  );
  const indexWarnings = [];
  const bytesPerChar = targetCharset === 'utf8mb4' ? 4 : 3;
  for (const table of snapshot.tables ?? []) {
    if (!tablesNeedingConversion.has(table.name)) continue;
    const rowFormat = String(table.rowFormat ?? '').toLowerCase();
    const prefixLimit = rowFormat === 'compact' || rowFormat === 'redundant' ? 767 : 3072;
    for (const index of table.indexes ?? []) {
      for (const part of index.columns ?? []) {
        const col = (table.columns ?? []).find((c) => c.name === part.name);
        if (!col) continue;
        const dataType = String(col.dataType ?? '').toLowerCase();
        if (dataType !== 'varchar' && dataType !== 'char') continue;
        const chars = part.subPart ?? col.length;
        if (!chars) continue;
        const bytes = chars * bytesPerChar;
        if (bytes > prefixLimit) {
          indexWarnings.push({
            table: table.name, index: index.name, column: col.name,
            unique: Boolean(index.unique), chars, bytes, limit: prefixLimit,
            rowFormat: table.rowFormat ?? 'unknown',
            message:
              `${index.unique ? 'UNIQUE ' : ''}index ${table.name}.${index.name} on ${col.name}(${chars}) ` +
              `would need ${bytes} bytes after ${targetCharset} conversion, over the ${prefixLimit}-byte ` +
              `prefix limit (row format ${table.rowFormat ?? 'unknown'}). ` +
              `Shorten to ${Math.floor(prefixLimit / bytesPerChar)} chars, add a prefix length, ` +
              'or move to ROW_FORMAT=DYNAMIC first.',
          });
        }
      }
    }
  }

  const byTable = groupByTable(findings);
  const counts = { high: 0, medium: 0, low: 0 };
  for (const f of findings) counts[f.severity] = (counts[f.severity] ?? 0) + 1;

  return {
    ok: findings.length === 0,
    findings,
    indexWarnings,
    byTable,
    counts,
    target: { charset: targetCharset, collation: targetCollation },
    scope,
  };
}

function groupByTable(findings) {
  const groups = new Map();
  for (const f of findings) {
    const key =
      f.level === 'table' || f.level === 'column' ? (f.table ?? f.object)
        : f.level === 'database' ? '(database)'
          : '(connection)';
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(f);
  }
  return groups;
}
