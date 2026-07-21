// "New since last run" support. The history file stores the classified rows of
// the last full run; the next run diffs against it.

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

export function rowKey(row) {
  return `${row.project}|${row.type}|${row.package}`;
}

// A row is "new" when it wasn't in the previous run, its available latest
// version moved, or it newly became a security item.
export function diffNewRows(currentRows, previousRows) {
  const prev = new Map((previousRows ?? []).map((r) => [rowKey(r), r]));
  return currentRows.filter((row) => {
    const p = prev.get(rowKey(row));
    if (!p) return true;
    if (p.latest !== row.latest) return true;
    if (!p.security && row.security) return true;
    return false;
  });
}

export function loadHistory(file) {
  try {
    const data = JSON.parse(readFileSync(file, 'utf8'));
    if (data && Array.isArray(data.rows)) return data;
    return null;
  } catch {
    return null; // no history yet (first run) or unreadable — treat as first run
  }
}

export function saveHistory(file, rows, now = new Date()) {
  mkdirSync(dirname(file), { recursive: true });
  const data = {
    generatedAt: now.toISOString(),
    rows: rows.map((r) => ({
      project: r.project,
      type: r.type,
      package: r.package,
      current: r.current,
      latest: r.latest,
      security: r.security,
      severity: r.severity,
    })),
  };
  writeFileSync(file, JSON.stringify(data, null, 2) + '\n');
  return data;
}
