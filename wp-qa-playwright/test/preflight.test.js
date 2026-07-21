import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadConfig } from '../src/config.js';
import { preflight, formatPreflight } from '../src/preflight.js';
import { createFakeAdapter } from '../src/adapters/fake.js';

const FIXTURES = path.dirname(fileURLToPath(import.meta.url)).replace(/test$/, 'fixtures');
const CONFIG = path.join(FIXTURES, 'qa.config.yml');

function adapter() {
  return createFakeAdapter(loadConfig(CONFIG).fixture);
}

test('preflight passes when the template and all targets are reachable', async () => {
  const cfg = loadConfig(CONFIG);
  const pf = await preflight(adapter(), cfg);
  assert.equal(pf.ok, true);
  assert.equal(pf.results.length, 3); // template + 2 targets
  assert.ok(pf.results.every((r) => r.reachable && r.status === 200));
  assert.equal(pf.results[0].role, 'template');
});

test('preflight fails when a target is unreachable', async () => {
  const cfg = { ...loadConfig(CONFIG), targets: ['https://good.example.com/', 'https://down.example.com/'] };
  const pf = await preflight(adapter(), cfg);
  assert.equal(pf.ok, false);
  const down = pf.results.find((r) => r.url.includes('down'));
  assert.equal(down.reachable, false);
  assert.match(down.error, /unreachable/);
});

test('preflight verifies auth when configured and the adapter supports it', async () => {
  const cfg = { ...loadConfig(CONFIG), targets: ['https://good.example.com/'] };
  const pf = await preflight(adapter(), cfg, { auth: { user: 'automation', password: 'app-pw' } });
  const good = pf.results.find((r) => r.role === 'target');
  assert.equal(good.auth.ok, true);
});

test('preflight reports an auth failure as a non-fatal warning (still ok)', async () => {
  // A reachable adapter whose auth check fails: run stays "ok" (public checks
  // still work); the failure is surfaced per-URL.
  const failAuth = {
    name: 'stub',
    async fetchStatus() { return { status: 200, redirectChain: [] }; },
    async verifyAuth() { return { ok: false, status: 401, error: 'authentication failed (HTTP 401)' }; },
    async close() {},
  };
  const cfg = { template_url: null, targets: ['https://acme.example.com/'] };
  const pf = await preflight(failAuth, cfg, { auth: { user: 'a', password: 'b' } });
  assert.equal(pf.ok, true); // reachable => not a hard stop
  assert.equal(pf.results[0].auth.ok, false);
  assert.match(formatPreflight(pf), /auth WARN/);
});

test('preflight notes when the adapter cannot verify auth', async () => {
  const noAuth = {
    name: 'stub',
    async fetchStatus() { return { status: 200, redirectChain: [] }; },
    async close() {},
  };
  const pf = await preflight(noAuth, { targets: ['https://x.y/'] }, { auth: { user: 'a', password: 'b' } });
  assert.equal(pf.results[0].auth.skipped, true);
});

test('formatPreflight renders a readable summary with a verdict', async () => {
  const cfg = { ...loadConfig(CONFIG), targets: ['https://down.example.com/'] };
  const out = formatPreflight(await preflight(adapter(), cfg));
  assert.match(out, /Preflight — connectivity check/);
  assert.match(out, /Preflight FAILED/);
});
