// Diagnosis: parse the shape of a normalized query, read EXPLAIN output,
// propose candidate index DDL, and cross-check existing indexes so we never
// suggest something a composite index already covers. Pure except for the
// injected adapter (which is only ever sent read-only statements).

const ALIAS_KEYWORDS = new Set([
  'where', 'on', 'join', 'inner', 'left', 'right', 'cross', 'outer', 'straight_join',
  'order', 'group', 'limit', 'having', 'set', 'using', 'for', 'union', 'as', 'force', 'use', 'ignore',
]);

/** Extract tables/aliases, WHERE columns and ORDER BY columns from a normalized query. */
export function parseQueryShape(normalized) {
  const tables = [];
  const aliasMap = new Map();
  const tre = /\b(from|join)\s+([a-z_][\w$]*)(?:\s+(?:as\s+)?([a-z_][\w$]*))?/g;
  let m;
  while ((m = tre.exec(normalized)) !== null) {
    const table = m[2];
    let alias = m[3];
    if (alias && ALIAS_KEYWORDS.has(alias)) alias = undefined;
    tables.push({ table, alias: alias ?? table });
    aliasMap.set(alias ?? table, table);
    aliasMap.set(table, table);
  }

  const where = [];
  const wm = /\bwhere\s+([\s\S]*?)(?=\s+(?:group\s+by|order\s+by|limit|having|union|for\s+(?:update|share))\b|$)/.exec(normalized);
  if (wm) {
    for (const part of wm[1].split(/\band\b|\bor\b/)) {
      const cm = /^[\s(]*(?:([\w$]+)\.)?([\w$]+)\s*(<=>|<=|>=|<>|!=|=|<|>|\bin\b|\blike\b|\bbetween\b|\bis\b)/.exec(part.trim());
      if (!cm) continue;
      const [, qualifier, col, op] = cm;
      const kind = op === '=' || op === '<=>' || op === 'in' || op === 'is' ? 'eq' : 'range';
      where.push({ col, table: qualifier ? aliasMap.get(qualifier) ?? qualifier : tables[0]?.table, kind });
    }
  }

  const orderBy = [];
  const om = /\border\s+by\s+([\s\S]*?)(?=\s+limit\b|\s+for\s+(?:update|share)\b|$)/.exec(normalized);
  if (om) {
    for (const part of om[1].split(',')) {
      const cm = /^\s*(?:([\w$]+)\.)?([\w$]+)/.exec(part.trim());
      if (!cm) continue;
      const [, qualifier, col] = cm;
      if (col === '?') continue;
      orderBy.push({ col, table: qualifier ? aliasMap.get(qualifier) ?? qualifier : tables[0]?.table });
    }
  }

  return { tables, where, orderBy };
}

/**
 * Build a candidate index from the query shape: equality columns first, then
 * one range column, then ORDER BY columns (only when there is no range column).
 * Returns { table, columns } or null.
 */
export function candidateIndex(shape) {
  if (!shape.tables.length) return null;
  const byTable = new Map();
  for (const w of shape.where) {
    if (!w.table || !w.col || w.col === '?') continue;
    if (!byTable.has(w.table)) byTable.set(w.table, { eq: [], range: [] });
    byTable.get(w.table)[w.kind === 'eq' ? 'eq' : 'range'].push(w.col);
  }
  if (byTable.size === 0) return null;
  // Pick the table with the most equality predicates (first table wins ties).
  let target = null;
  for (const [table, cols] of byTable) {
    if (!target || cols.eq.length > byTable.get(target).eq.length) target = table;
  }
  const { eq, range } = byTable.get(target);
  const columns = [];
  for (const c of eq) if (!columns.includes(c)) columns.push(c);
  if (range.length > 0) {
    if (!columns.includes(range[0])) columns.push(range[0]);
  } else if (shape.orderBy.length && shape.orderBy.every((o) => o.table === target)) {
    for (const o of shape.orderBy) if (!columns.includes(o.col)) columns.push(o.col);
  }
  if (!columns.length) return null;
  return { table: target, columns: columns.slice(0, 4) };
}

/** Candidate is redundant when its column list is a prefix of an existing index. */
export function isRedundant(candidate, existingIndexes) {
  return (existingIndexes ?? []).some((ix) =>
    candidate.columns.every((c, i) => (ix.columns[i] ?? '').toLowerCase() === c.toLowerCase()),
  );
}

/** DDL text for the recommendation. Never executed by this tool. */
export function indexDdl({ table, columns }) {
  const name = `idx_${table}_${columns.join('_')}`.slice(0, 60);
  return `ALTER TABLE \`${table}\` ADD INDEX \`${name}\` (${columns.map((c) => `\`${c}\``).join(', ')});`;
}

/** Interpret tabular EXPLAIN rows into human flags. */
export function explainVerdict(rows) {
  const flags = [];
  for (const r of rows ?? []) {
    const type = (r.type ?? r.access_type ?? '').toString().toUpperCase();
    const extra = (r.Extra ?? r.extra ?? '') || '';
    if (type === 'ALL') flags.push(`full table scan on \`${r.table}\``);
    else if (type === 'INDEX' && !r.key) flags.push(`full index scan on \`${r.table}\``);
    if (/using filesort/i.test(extra)) flags.push(`filesort on \`${r.table}\``);
    if (/using temporary/i.test(extra)) flags.push(`temporary table for \`${r.table}\``);
  }
  return { flags, fullScan: flags.some((f) => f.startsWith('full table scan')) };
}

/**
 * Diagnose one aggregated group. `adapter` may be null (heuristics only).
 * Returns { explain, flags, notes, suggestion, confidence }.
 */
export async function diagnoseGroup(group, adapter, { ratioWarn = 100 } = {}) {
  const shape = parseQueryShape(group.normalized);
  const result = { explain: null, flags: [], notes: [], suggestion: null, confidence: null };
  const cand = candidateIndex(shape);
  const parameterized = /(^|[\s(=,])\?/.test(group.sample) && group.sample === group.normalized;

  let fullScan = false;
  let redundant = false;
  if (adapter && !parameterized) {
    const rows = await adapter.explain(group.sample);
    result.explain = rows;
    const v = explainVerdict(rows);
    result.flags.push(...v.flags);
    fullScan = v.fullScan;
  } else if (adapter && parameterized) {
    result.notes.push('Digest is parameterized (no sample with literals) — EXPLAIN skipped.');
  } else {
    result.notes.push('No DB connection: EXPLAIN skipped; suggestion is heuristic only.');
  }

  if (group.examineRatio >= ratioWarn && group.rowsExamined > 0) {
    result.flags.push(`examines ${group.examineRatio}x more rows than it returns — missing-index smell`);
  }

  if (cand && adapter) {
    const existing = await adapter.listIndexes(cand.table);
    redundant = isRedundant(cand, existing);
    if (redundant) {
      result.notes.push(
        `An existing index on \`${cand.table}\` already covers (${cand.columns.join(', ')}) — no new index needed.`,
      );
    }
  }

  if (cand && !redundant) {
    result.suggestion = {
      table: cand.table,
      columns: cand.columns,
      ddl: indexDdl(cand),
      note: `Recommendation only — review and apply manually. Indexes cost write performance; check INSERT/UPDATE volume on \`${cand.table}\` first.`,
    };
    result.confidence =
      (adapter && fullScan) || (!adapter && group.examineRatio >= 1000)
        ? 'high confidence'
        : 'worth investigating';
  }
  return result;
}
