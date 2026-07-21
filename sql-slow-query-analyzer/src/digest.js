// Query digest normalization — pure functions, no I/O.
// Collapses literal values so parameter-only variants group together:
//   WHERE id = 1  and  WHERE id = 2   ->  where id = ?
//   IN (1, 2, 3)                      ->  in (?)
import { createHash } from 'node:crypto';

/** Strip SQL comments (/* ... *​/, -- to EOL, # to EOL). Best-effort, pre-masking. */
export function stripComments(sql) {
  return sql
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/--[ \t].*$/gm, ' ')
    .replace(/^\s*#.*$/gm, ' ');
}

/** Replace quoted string literals with `?`, preserving backtick identifiers. */
export function maskStrings(sql) {
  let out = '';
  let i = 0;
  while (i < sql.length) {
    const c = sql[i];
    if (c === "'" || c === '"') {
      const q = c;
      i += 1;
      while (i < sql.length) {
        if (sql[i] === '\\') { i += 2; continue; }
        if (sql[i] === q) {
          if (sql[i + 1] === q) { i += 2; continue; } // '' escaped quote
          i += 1;
          break;
        }
        i += 1;
      }
      out += '?';
    } else if (c === '`') {
      let j = i + 1;
      while (j < sql.length && sql[j] !== '`') j += 1;
      out += sql.slice(i + 1, j); // drop backticks, keep identifier
      i = j + 1;
    } else {
      out += c;
      i += 1;
    }
  }
  return out;
}

/** Normalize a query to its canonical digest text. Deterministic. */
export function normalizeQuery(sql) {
  let s = stripComments(String(sql));
  s = maskStrings(s);
  s = s.replace(/(?<![\w$.])0x[0-9a-f]+/gi, '?'); // hex literals
  s = s.replace(/(?<![\w$.])-?\d+(?:\.\d+)?(?:e[+-]?\d+)?/gi, '?'); // numbers
  s = s.replace(/\s+/g, ' ');
  s = s.toLowerCase();
  s = s.replace(/\s*(<=>|<=|>=|<>|!=|=|<|>)\s*/g, ' $1 ');
  s = s.replace(/\s*,\s*/g, ', ');
  s = s.replace(/\(\s+/g, '(').replace(/\s+\)/g, ')');
  s = s.replace(/\bin\s*\(\s*\?(?:,\s*\?)*\s*\)/gi, 'in (?)'); // collapse IN-lists
  s = s.replace(/\bvalues\s*\(\s*\?(?:,\s*\?)*\s*\)/gi, 'values (?)');
  s = s.replace(/\s+/g, ' ').trim();
  s = s.replace(/;+\s*$/, '');
  return s;
}

/** Stable short id for a normalized query. */
export function digestId(normalized) {
  return createHash('sha1').update(normalized).digest('hex').slice(0, 12);
}
