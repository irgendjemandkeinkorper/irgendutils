// End-to-end CLI tests: spawn src/cli.js against fixture configs with the fake
// adapter (via --adapter). Offline — no network, no installs. Asserts the exit
// codes the deploy pipeline relies on and the results.json contract.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const appDir = fileURLToPath(new URL('..', import.meta.url));
const cli = join(appDir, 'src', 'cli.js');
const fixture = (name) => join(appDir, 'fixtures', name);

function runCli(args, { responses, env = {} } = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'smoke-test-'));
  const out = join(dir, 'results.json');
  const res = spawnSync(
    process.execPath,
    [cli, ...args, '--adapter', fixture('fake-adapter.mjs'), '--out', out, '--no-color'],
    {
      cwd: dir,
      encoding: 'utf8',
      timeout: 15000,
      env: {
        ...process.env,
        SMOKE_FIXTURE_RESPONSES: responses ? fixture(responses) : '',
        ...env,
      },
    },
  );
  let results = null;
  try {
    results = JSON.parse(readFileSync(out, 'utf8'));
  } catch {
    /* results.json may legitimately not exist for usage errors */
  }
  rmSync(dir, { recursive: true, force: true });
  return { ...res, results };
}

const HEALTHY_ENV = { WP_APP_PASSWORD: 'abcd efgh ijkl mnop' };

test('smoke run: healthy site exits 0 and writes passing results.json', () => {
  const r = runCli(['run', '--config', fixture('smoke.fixture.yml')], {
    responses: 'responses-healthy.json',
    env: HEALTHY_ENV,
  });
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.match(r.stdout, /PASS/);
  assert.equal(r.results.ok, true);
  assert.equal(r.results.summary.failed, 0);
  assert.equal(r.results.checks.length, 6);
});

test('smoke run: broken site exits non-zero with clear reasons in output', () => {
  const r = runCli(['run', '--config', fixture('smoke.fixture.yml')], {
    responses: 'responses-broken.json',
    env: HEALTHY_ENV,
  });
  assert.equal(r.status, 1, r.stdout + r.stderr);
  assert.match(r.stdout, /FAIL/);
  assert.match(r.stdout, /expected status 200, got 500/);
  assert.match(r.stdout, /does not contain "Log In"/);
  assert.match(r.stdout, /suspiciously tiny body/);
  assert.equal(r.results.ok, false);
  assert.ok(r.results.summary.failed >= 5);
});

test('smoke run --fail-fast stops after the first failure', () => {
  const r = runCli(['run', '--config', fixture('smoke.fixture.yml'), '--fail-fast'], {
    responses: 'responses-broken.json',
    env: HEALTHY_ENV,
  });
  assert.equal(r.status, 1);
  assert.equal(r.results.checks.length, 1);
});

test('smoke run --url overrides the target', () => {
  const r = runCli(
    ['run', '--config', fixture('smoke.fixture.yml'), '--url', 'https://staging.acme.example.com'],
    { responses: 'responses-healthy.json', env: HEALTHY_ENV },
  );
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.equal(r.results.target, 'https://staging.acme.example.com');
  assert.ok(r.results.checks[0].url.startsWith('https://staging.acme.example.com/'));
});

test('a hanging URL cannot stall the pipeline: bounded run, non-zero exit', () => {
  const started = Date.now();
  const r = runCli(['run', '--config', fixture('smoke.hang.yml')], {
    responses: 'responses-hang.json',
  });
  assert.ok(Date.now() - started < 10000);
  assert.equal(r.status, 1);
  assert.match(r.stdout, /timed out after 200ms/);
});

test('missing config exits 2 with a helpful message', () => {
  const r = runCli(['run', '--config', 'nope.yml'], { responses: 'responses-healthy.json' });
  assert.equal(r.status, 2);
  assert.match(r.stderr, /Config not found/);
});

test('--help prints usage and exits 0', () => {
  const r = runCli(['run', '--help'], { responses: 'responses-healthy.json' });
  assert.equal(r.status, 0);
  assert.match(r.stdout, /smoke run/);
});
