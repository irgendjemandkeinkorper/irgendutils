// Run log: every external call (WP-CLI invocation, REST request, DNS API
// call) is appended with a timestamp so failures are debuggable afterwards.

import { appendFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Create a file-backed logger. The file is created lazily on first write so
 * read-only commands like --help never dirty the working directory.
 * @returns {{log: (kind: string, detail?: object) => void, path: string}}
 */
export function createRunLog(dir, now = new Date()) {
  const stamp = now.toISOString().replace(/[:.]/g, '-');
  const path = join(dir, `${stamp}.log`);
  let ready = false;
  function log(kind, detail = {}) {
    if (!ready) {
      mkdirSync(dir, { recursive: true });
      ready = true;
    }
    const line = `${new Date().toISOString()} ${kind} ${JSON.stringify(detail)}\n`;
    appendFileSync(path, line);
  }
  return { log, path };
}

/** In-memory logger for tests / --no-log. */
export function createMemoryLog() {
  const entries = [];
  return {
    entries,
    log: (kind, detail = {}) => entries.push({ ts: new Date().toISOString(), kind, detail }),
  };
}
