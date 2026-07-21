import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { loadConfig } from '../src/config.js';
import { runQa, runTarget, severityCounts } from '../src/runner.js';
import { createFakeAdapter } from '../src/adapters/fake.js';

const FIXTURES = path.dirname(fileURLToPath(import.meta.url)).replace(/test$/, 'fixtures');
const CONFIG = path.join(FIXTURES, 'qa.config.yml');

function cfg() {
  return loadConfig(CONFIG);
}
function adapter() {
  return createFakeAdapter(cfg().fixture);
}

test('self-consistency: the template checked against itself yields zero error findings', async () => {
  const c = cfg();
  const run = await runQa({ ...c, targets: ['https://template.example.com/'] }, adapter());
  const r = run.results[0];
  assert.equal(r.pass, true);
  assert.equal(severityCounts(r.findings).error, 0);
});

test('a matching target passes with no findings at all', async () => {
  const c = cfg();
  const run = await runQa({ ...c, targets: ['https://good.example.com/'] }, adapter());
  assert.equal(run.pass, true);
  assert.equal(run.results[0].findings.length, 0);
});

test('the broken fixture produces at least one finding for every implemented check', async () => {
  const c = cfg();
  const run = await runQa({ ...c, targets: ['https://broken.example.com/'] }, adapter());
  const r = run.results[0];
  assert.equal(r.pass, false);
  for (const check of ['structural', 'visual', 'links', 'console', 'responsive', 'wp_hygiene']) {
    assert.ok(
      r.findings.some((f) => f.check === check),
      `expected at least one "${check}" finding, got: ${r.findings.map((f) => f.check).join(', ')}`,
    );
  }
});

test('the broken fixture fails on an error in each of the failing checks', async () => {
  const run = await runQa({ ...cfg(), targets: ['https://broken.example.com/'] }, adapter());
  const errorChecks = new Set(run.results[0].findings.filter((f) => f.severity === 'error').map((f) => f.check));
  for (const check of ['structural', 'visual', 'links', 'console', 'responsive', 'wp_hygiene']) {
    assert.ok(errorChecks.has(check), `expected an error-level "${check}" finding`);
  }
});

test('determinism: two runs of an unchanged page produce byte-identical screenshots and 0% diff', async () => {
  const c = cfg();
  const a = await runQa({ ...c, targets: ['https://good.example.com/'] }, adapter());
  const b = await runQa({ ...c, targets: ['https://good.example.com/'] }, adapter());
  for (const vp of ['360', '1280']) {
    const ia = a.results[0].visualArtifacts[vp];
    const ib = b.results[0].visualArtifacts[vp];
    assert.equal(ia.diffPct, 0, `viewport ${vp} should have 0% diff`);
    assert.equal(Buffer.compare(ia.target.data, ib.target.data), 0, `viewport ${vp} screenshots differ between runs`);
  }
});

test('runQa aggregates pass/fail across targets', async () => {
  const run = await runQa(cfg(), adapter()); // good + broken
  assert.equal(run.pass, false);
  assert.equal(run.results.length, 2);
  assert.equal(run.results.filter((r) => r.pass).length, 1);
});

test('a subset of checks runs only those checks', async () => {
  const c = { ...cfg(), checks: ['links'], targets: ['https://broken.example.com/'] };
  const run = await runTarget(adapter(), c, c.targets[0], {});
  assert.ok(run.findings.every((f) => f.check === 'links'));
  assert.equal(run.checksRun.join(','), 'links');
});

test('max_broken_links threshold turns broken links into a failing error', async () => {
  const c = { ...cfg(), checks: ['links'], targets: ['https://broken.example.com/'] };
  c.thresholds = { ...c.thresholds, max_broken_links: 5 };
  const run = await runTarget(adapter(), c, c.targets[0], {});
  // The 404 is now under threshold, so no "exceeds threshold" error — but mixed
  // content is still an error regardless of the link count.
  assert.ok(!run.findings.some((f) => /exceed the max_broken_links/.test(f.message)));
  assert.ok(run.findings.some((f) => /Mixed content/.test(f.message)));
});

test('wp_hygiene degrades to a skip note when REST is unavailable', async () => {
  const c = { ...cfg(), checks: ['wp_hygiene'], targets: ['https://good.example.com/'] };
  // No template WP info and force target to look REST-less via a bare adapter.
  const bare = {
    async capturePage() { return { html: '', screenshots: {}, viewports: {}, console: [], failedRequests: [], maskRects: {} }; },
    async fetchStatus() { return { status: 200, redirectChain: [] }; },
    async fetchWpInfo() { return { restAvailable: false, note: 'no credentials' }; },
    async close() {},
  };
  const run = await runTarget(bare, c, c.targets[0], {});
  assert.equal(run.pass, true);
  assert.ok(run.findings.some((f) => f.check === 'wp_hygiene' && f.skipped));
});
