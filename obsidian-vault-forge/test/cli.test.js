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

function assertStatus(r, expected) {
  if (r.status !== expected) {
    assert.fail(
      `Expected exit code ${expected} but got ${r.status}.\n\n` +
      `--- STDOUT ---\n${r.stdout || ''}\n\n` +
      `--- STDERR ---\n${r.stderr || ''}`
    );
  }
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
    assertStatus(r, 0);
    assert.match(r.stdout, /verify: front-matter valid/);
    assert.ok(existsSync(path.join(dir, 'acme-redesign', '00-Index.md')));
  });
});

test('dry-run writes nothing', () => {
  withTmp((dir) => {
    const r = run(['forge', manifest, '-o', dir, '--dry-run'], dir);
    assertStatus(r, 0);
    assert.match(r.stdout, /Dry run/);
    assert.ok(!existsSync(path.join(dir, 'acme-redesign')), 'no vault dir created');
  });
});

test('add-decision then add-meeting keep the vault verifiable', () => {
  withTmp((dir) => {
    assertStatus(run(['forge', manifest, '-o', dir, '--date', '2026-07-21'], dir), 0);

    const d = run(['add-decision', 'acme-redesign', 'Use multisite', '-o', dir, '--date', '2026-07-22'], dir);
    assertStatus(d, 0);
    assert.ok(existsSync(path.join(dir, 'acme-redesign', '04-Decisions', '2026-07-22 Use multisite.md')));

    const m = run(['add-meeting', 'acme-redesign', 'Kickoff', '-o', dir, '--date', '2026-07-23'], dir);
    assertStatus(m, 0);
    assert.ok(existsSync(path.join(dir, 'acme-redesign', '05-Meetings', '2026-07-23 Kickoff.md')));

    assertStatus(run(['verify', 'acme-redesign', '-o', dir], dir), 0);
  });
});

test('verify exits 1 when a note develops a dangling link', () => {
  withTmp((dir) => {
    run(['forge', manifest, '-o', dir, '--date', '2026-07-21'], dir);
    const tasks = path.join(dir, 'acme-redesign', '06-Tasks', 'Tasks.md');
    writeFileSync(tasks, readFileSync(tasks, 'utf8') + '\n- see [[Nonexistent Note]]\n');
    const r = run(['verify', 'acme-redesign', '-o', dir], dir);
    assertStatus(r, 1);
    assert.match(r.stdout, /dangling link/);
  });
});

test('add-meeting on a non-forged dir errors cleanly', () => {
  withTmp((dir) => {
    const r = run(['add-meeting', 'ghost', 'Kickoff', '-o', dir], dir);
    assertStatus(r, 1);
    assert.match(r.stderr, /not a forged vault/);
  });
});

test('unknown command and missing args are usage errors (exit 2)', () => {
  withTmp((dir) => {
    assertStatus(run(['bogus'], dir), 2);
    assertStatus(run(['forge'], dir), 2);
  });
});
