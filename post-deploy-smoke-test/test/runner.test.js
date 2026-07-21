import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { parseYaml } from '../src/yaml.js';
import { runSmoke, buildRequests } from '../src/runner.js';
import { makeFakeAdapter } from '../fixtures/fake-adapter.mjs';

const read = (name) =>
  readFileSync(fileURLToPath(new URL(`../fixtures/${name}`, import.meta.url)), 'utf8');
const config = () => parseYaml(read('smoke.fixture.yml'));
const healthyAdapter = () => makeFakeAdapter(JSON.parse(read('responses-healthy.json')));
const brokenAdapter = () => makeFakeAdapter(JSON.parse(read('responses-broken.json')));
const ENV = { WP_APP_PASSWORD: 'abcd efgh ijkl mnop' };

test('healthy fixture: all checks pass, ok is true', async () => {
  const run = await runSmoke(config(), healthyAdapter(), { env: ENV });
  assert.equal(run.ok, true);
  assert.equal(run.summary.total, 6);
  assert.equal(run.summary.failed, 0);
  assert.equal(run.target, 'https://acme.example.com');
});

test('broken fixture: every check fails with a clear reason', async () => {
  const run = await runSmoke(config(), brokenAdapter(), { env: ENV });
  assert.equal(run.ok, false);
  assert.equal(run.summary.failed, 6);
  for (const r of run.results) {
    assert.equal(r.ok, false);
    assert.ok(r.failures.length > 0, `${r.path} should have a failure reason`);
  }
});

test('fail-fast stops at the first failure', async () => {
  const run = await runSmoke(config(), brokenAdapter(), { env: ENV, failFast: true });
  assert.equal(run.ok, false);
  assert.equal(run.results.length, 1);
  assert.equal(run.results[0].path, '/');
});

test('a hanging URL is bounded by the hard timeout and the run completes', async () => {
  const cfg = parseYaml(read('smoke.hang.yml'));
  const adapter = makeFakeAdapter(JSON.parse(read('responses-hang.json')));
  const started = Date.now();
  const run = await runSmoke(cfg, adapter, {});
  const elapsed = Date.now() - started;
  assert.ok(elapsed < 2000, `run took ${elapsed}ms — hard timeout did not bound the hang`);
  assert.equal(run.ok, false);
  const hang = run.results.find((r) => r.path === '/hang');
  assert.match(hang.failures[0], /timed out after 200ms/);
  const home = run.results.find((r) => r.path === '/');
  assert.equal(home.ok, true, 'healthy check still passes alongside the hang');
});

test('authed check sends Basic auth built from the env Application Password', () => {
  const reqs = buildRequests(config(), ENV);
  const authed = reqs.find((r) => r.authed);
  const expected = 'Basic ' + Buffer.from('automation:abcd efgh ijkl mnop').toString('base64');
  assert.equal(authed.headers.authorization, expected);
  assert.equal(reqs.filter((r) => !r.authed).some((r) => r.headers.authorization), false);
});

test('authed check fails cleanly (without fetching) when the env var is missing', async () => {
  const run = await runSmoke(config(), healthyAdapter(), { env: {} });
  assert.equal(run.ok, false);
  const authed = run.results.find((r) => r.authed);
  assert.match(authed.failures[0], /env var WP_APP_PASSWORD/);
  assert.ok(!authed.failures[0].includes('abcd'), 'never echoes secrets');
});

test('fake adapter rejects the authed endpoint without credentials (401 path)', async () => {
  const cfg = config();
  cfg.authed[0].app_password_env = 'OTHER_ENV';
  const run = await runSmoke(cfg, healthyAdapter(), { env: { OTHER_ENV: '' } });
  const authed = run.results.find((r) => r.authed);
  assert.equal(authed.ok, false);
});

test('cache_bust appends a smoke query param', () => {
  const cfg = { base_url: 'https://acme.example.com', checks: [{ path: '/', cache_bust: true }] };
  const reqs = buildRequests(cfg, {}, () => 12345);
  assert.equal(new URL(reqs[0].url).searchParams.get('smoke'), '12345');
});

test('adapter exceptions become failing results, not crashes', async () => {
  const cfg = { base_url: 'https://acme.example.com', checks: [{ path: '/', contains: 'x' }] };
  const adapter = { fetch: () => { throw new Error('ECONNREFUSED 127.0.0.1:443'); } };
  const run = await runSmoke(cfg, adapter, {});
  assert.equal(run.ok, false);
  assert.match(run.results[0].failures[0], /ECONNREFUSED/);
});
