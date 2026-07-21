// Read-only guard: every statement headed for the database must pass this gate.
// Whitelist of read verbs + rejection of smuggled writes and multi-statements.
import { maskStrings, stripComments } from './digest.js';

const ALLOWED_START = /^\s*(select|explain|show|describe|desc|with)\b/i;
const WRITE_VERB = /\b(insert|update|delete|replace|drop|alter|create|truncate|rename|grant|revoke|lock|unlock|call|load|set)\b/i;

/**
 * Throws unless `sql` is a single read-only statement.
 * Returns the sql unchanged so it can be used inline.
 */
export function assertReadOnly(sql) {
  const s = String(sql);
  if (!ALLOWED_START.test(s)) {
    throw new Error(`read-only guard: refusing to send non-read statement: ${s.slice(0, 100)}`);
  }
  // Work on a literal-free copy so quoted strings can't hide or fake verbs.
  const masked = maskStrings(stripComments(s)).replace(/;+\s*$/, '');
  if (masked.includes(';')) {
    throw new Error(`read-only guard: refusing multi-statement SQL: ${s.slice(0, 100)}`);
  }
  // MySQL 8 allows WITH ... DELETE/UPDATE; EXPLAIN can prefix writes too.
  const head = masked.trim().slice(0, 8).toLowerCase();
  if (head.startsWith('with') || head.startsWith('explain')) {
    if (WRITE_VERB.test(masked)) {
      throw new Error(`read-only guard: write verb inside statement: ${s.slice(0, 100)}`);
    }
  }
  return sql;
}

/** True when a statement would pass the guard (for reporting, not gating). */
export function isReadOnly(sql) {
  try {
    assertReadOnly(sql);
    return true;
  } catch {
    return false;
  }
}
