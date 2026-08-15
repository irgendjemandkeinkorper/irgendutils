// Run log: every external call (WP-CLI invocation, REST request, DNS API
// call) is appended with a timestamp so failures are debuggable afterwards.

import { appendFileSync, mkdirSync, readdirSync, statSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';

const DEFAULT_RETENTION_DAYS = 30;
const DEFAULT_MAX_FILES = 50;

/**
 * Remove old run logs without traversing outside the configured log directory.
 * Only regular files with the generated .log suffix are eligible.
 */
export function pruneRunLogs(
  dir,
  { now = new Date(), maxAgeDays = DEFAULT_RETENTION_DAYS, maxFiles = DEFAULT_MAX_FILES } = {},
) {
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true })
      .filter((entry) => entry.isFile() && entry.name.endsWith('.log'))
      .map((entry) => {
        const path = join(dir, entry.name);
        return { path, mtimeMs: statSync(path).mtimeMs };
      })
      .sort((a, b) => b.mtimeMs - a.mtimeMs);
  } catch (error) {
    if (error.code === 'ENOENT') return 0;
    throw error;
  }

  const cutoff = now.getTime() - maxAgeDays * 24 * 60 * 60 * 1000;
  const remove = entries.filter((entry, index) => entry.mtimeMs < cutoff || index >= maxFiles);
  for (const entry of remove) unlinkSync(entry.path);
  return remove.length;
}

/**
 * Create a file-backed logger. The file is created lazily on first write so
 * read-only commands like --help never dirty the working directory.
 * @returns {{log: (kind: string, detail?: object) => void, path: string}}
 */
export function createRunLog(dir, now = new Date(), retention = {}) {
  pruneRunLogs(dir, { now, ...retention });
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
