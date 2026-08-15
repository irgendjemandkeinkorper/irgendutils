import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readdirSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRunLog, pruneRunLogs } from '../src/runlog.js';

function tempDir() {
  return mkdtempSync(join(tmpdir(), 'wp-spinup-runlog-'));
}

test('pruneRunLogs removes old logs but leaves non-log files alone', () => {
  const dir = tempDir();
  try {
    const now = new Date('2026-08-15T00:00:00.000Z');
    const old = join(dir, 'old.log');
    const fresh = join(dir, 'fresh.log');
    writeFileSync(old, 'old');
    writeFileSync(fresh, 'fresh');
    writeFileSync(join(dir, 'notes.txt'), 'keep');
    utimesSync(old, new Date('2026-07-01T00:00:00.000Z'), new Date('2026-07-01T00:00:00.000Z'));
    utimesSync(fresh, now, now);

    assert.equal(pruneRunLogs(dir, { now, maxAgeDays: 30 }), 1);
    assert.deepEqual(readdirSync(dir).sort(), ['fresh.log', 'notes.txt']);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('createRunLog caps retained logs before creating the next run log', () => {
  const dir = tempDir();
  try {
    const now = new Date('2026-08-15T00:00:00.000Z');
    for (let i = 0; i < 3; i += 1) {
      const path = join(dir, `2026-08-15T00-0${i}-00-000Z.log`);
      writeFileSync(path, `run ${i}`);
      const time = new Date(now.getTime() - (3 - i) * 1000);
      utimesSync(path, time, time);
    }

    const log = createRunLog(dir, now, { maxAgeDays: 365, maxFiles: 2 });
    log.log('start');
    const logs = readdirSync(dir).filter((name) => name.endsWith('.log'));
    assert.equal(logs.length, 3);
    assert.ok(logs.some((name) => name.startsWith('2026-08-15T00-00-00-000Z')));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
