// End-to-end CLI tests: spawn src/cli.js against the fixture manifest in a temp
// dir. Offline. Asserts exit codes and the on-disk contract downstream apps and
// humans rely on.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const appDir = fileURLToPath(new URL('..', import.meta.url));
const cli = path.join(appDir, 'src', 'cli.js');
const manifest = path.join(appDir, 'fixtures', 'project.yml');

function run(args, cwd) {
  return spawnSync(process.execPath, [cli, ...args, '--no-color'], {
    cwd,
    encoding: 'utf8',
    timeout: 15000,
  });
}

function withTmp(fn) {
  const dir = mkdtempSync(path.join(tmpdir(), 'ovf-cli-'));
  try {
    return fn(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

test('forge exits 0 and writes a verifiable vault', () => {
  withTmp((dir) => {
    const r = run(['forge', manifest, '-o', dir, '--date', '2026-07-21'], dir);
    assert.equal(r.status, 0, r.stderr);
    assert.match(r.stdout, /verify: front-matter valid/);
    assert.ok(existsSync(path.join(dir, 'acme-redesign', '00-Index.md')));
  });
});

test('dry-run writes nothing', () => {
  withTmp((dir) => {
    const r = run(['forge', manifest, '-o', dir, '--dry-run'], dir);
    assert.equal(r.status, 0, r.stderr);
    assert.match(r.stdout, /Dry run/);
    assert.ok(!existsSync(path.join(dir, 'acme-redesign')), 'no vault dir created');
  });
});

test('add-decision then add-meeting keep the vault verifiable', () => {
  withTmp((dir) => {
    assert.equal(run(['forge', manifest, '-o', dir, '--date', '2026-07-21'], dir).status, 0);

    const d = run(['add-decision', 'acme-redesign', 'Use multisite', '-o', dir, '--date', '2026-07-22'], dir);
    assert.equal(d.status, 0, d.stderr);
    assert.ok(existsSync(path.join(dir, 'acme-redesign', '04-Decisions', '2026-07-22 Use multisite.md')));

    const m = run(['add-meeting', 'acme-redesign', 'Kickoff', '-o', dir, '--date', '2026-07-23'], dir);
    assert.equal(m.status, 0, m.stderr);
    assert.ok(existsSync(path.join(dir, 'acme-redesign', '05-Meetings', '2026-07-23 Kickoff.md')));

    assert.equal(run(['verify', 'acme-redesign', '-o', dir], dir).status, 0);
  });
});

test('verify exits 1 when a note develops a dangling link', () => {
  withTmp((dir) => {
    run(['forge', manifest, '-o', dir, '--date', '2026-07-21'], dir);
    const tasks = path.join(dir, 'acme-redesign', '06-Tasks', 'Tasks.md');
    writeFileSync(tasks, readFileSync(tasks, 'utf8') + '\n- see [[Nonexistent Note]]\n');
    const r = run(['verify', 'acme-redesign', '-o', dir], dir);
    assert.equal(r.status, 1);
    assert.match(r.stdout, /dangling link/);
  });
});

test('add-meeting on a non-forged dir errors cleanly', () => {
  withTmp((dir) => {
    const r = run(['add-meeting', 'ghost', 'Kickoff', '-o', dir], dir);
    assert.equal(r.status, 1);
    assert.match(r.stderr, /not a forged vault/);
  });
});

test('unknown command and missing args are usage errors (exit 2)', () => {
  withTmp((dir) => {
    assert.equal(run(['bogus'], dir).status, 2);
    assert.equal(run(['forge'], dir).status, 2);
  });
});
