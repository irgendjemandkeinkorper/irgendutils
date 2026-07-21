import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { evaluateCheck, findFatalMarker, summarize } from '../src/evaluate.js';

const fixture = (name) =>
  JSON.parse(readFileSync(fileURLToPath(new URL(`../fixtures/${name}`, import.meta.url)), 'utf8'));

const healthy = fixture('responses-healthy.json');
const broken = fixture('responses-broken.json');
const BASE = 'https://acme.example.com';

test('healthy homepage passes status + contains', () => {
  const r = evaluateCheck({ path: '/', status: 200, contains: 'Acme' }, healthy['/'], { baseUrl: BASE });
  assert.equal(r.ok, true);
  assert.deepEqual(r.failures, []);
  assert.equal(r.status, 200);
});

test('500 with PHP fatal fails on status AND flags the fatal marker', () => {
  const r = evaluateCheck({ path: '/', status: 200, contains: 'Acme' }, broken['/'], { baseUrl: BASE });
  assert.equal(r.ok, false);
  assert.ok(r.failures.some((f) => f.includes('expected status 200, got 500')));
  assert.ok(r.failures.some((f) => f.includes('fatal-error marker')));
});

test('white screen (200 with empty body) fails as suspiciously tiny', () => {
  const r = evaluateCheck({ path: '/shop', status: 200, contains: 'Add to cart' }, broken['/shop'], { baseUrl: BASE });
  assert.equal(r.ok, false);
  assert.ok(r.failures.some((f) => f.includes('suspiciously tiny body')), r.failures.join('; '));
  assert.ok(r.failures.some((f) => f.includes('does not contain "Add to cart"')));
});

test('200 but wrong body is caught by the content assertion', () => {
  const r = evaluateCheck({ path: '/wp-login.php', status: 200, contains: 'Log In' }, broken['/wp-login.php'], { baseUrl: BASE });
  assert.equal(r.ok, false);
  assert.equal(r.status, 200, 'status alone would have passed');
  assert.ok(r.failures.some((f) => f.includes('does not contain "Log In"')));
});

test('json: true accepts valid JSON and rejects an HTML body', () => {
  const good = evaluateCheck({ path: '/wp-json', status: 200, json: true }, healthy['/wp-json'], { baseUrl: BASE });
  assert.equal(good.ok, true);
  const bad = evaluateCheck({ path: '/wp-json', status: 200, json: true }, broken['/wp-json'], { baseUrl: BASE });
  assert.equal(bad.ok, false);
  assert.ok(bad.failures.some((f) => f.includes('not valid JSON')));
});

test('301 with the right Location passes; wrong Location fails', () => {
  const good = evaluateCheck({ path: '/old-page', status: 301, redirects_to: '/new-page' }, healthy['/old-page'], { baseUrl: BASE });
  assert.equal(good.ok, true);
  const bad = evaluateCheck({ path: '/old-page', status: 301, redirects_to: '/new-page' }, broken['/old-page'], { baseUrl: BASE });
  assert.equal(bad.ok, false);
  assert.ok(bad.failures.some((f) => f.includes('expected redirect to /new-page')));
});

test('missing Location header on an expected redirect fails', () => {
  const r = evaluateCheck(
    { path: '/x', status: 301, redirects_to: '/y' },
    { status: 301, headers: {}, body: '', durationMs: 10 },
  );
  assert.ok(r.failures.some((f) => f.includes('no Location header')));
});

test('timed-out response fails with the timeout reason', () => {
  const r = evaluateCheck({ path: '/slowest' }, { timedOut: true, durationMs: 500 }, { timeoutMs: 500 });
  assert.equal(r.ok, false);
  assert.match(r.failures[0], /timed out after 500ms/);
});

test('network/TLS error fails with the error message', () => {
  const r = evaluateCheck({ path: '/' }, { error: 'certificate has expired' });
  assert.equal(r.ok, false);
  assert.match(r.failures[0], /request failed: certificate has expired/);
});

test('soft budget warns without failing; max_ms fails', () => {
  const slow = { status: 200, headers: {}, body: 'x'.repeat(300), durationMs: 3500 };
  const warned = evaluateCheck({ path: '/' }, slow, { softBudgetMs: 2000 });
  assert.equal(warned.ok, true);
  assert.match(warned.warnings[0], /slow: 3500ms > soft budget 2000ms/);
  const failed = evaluateCheck({ path: '/', max_ms: 3000 }, slow, { softBudgetMs: 2000 });
  assert.equal(failed.ok, false);
  assert.match(failed.failures[0], /too slow: 3500ms > max_ms 3000ms/);
});

test('fatal markers are detected across flavors', () => {
  assert.ok(findFatalMarker('There has been a critical error on this website.'));
  assert.ok(findFatalMarker('Fatal error: Allowed memory size exhausted'));
  assert.ok(findFatalMarker('Traceback (most recent call last):\n  File "app.py"'));
  assert.ok(findFatalMarker('TypeError: boom\n    at handler (/srv/app.js:10:5)'));
  assert.equal(findFatalMarker('A perfectly healthy page about criticism.'), null);
});

test('summarize counts pass/fail/warnings', () => {
  const s = summarize([
    { ok: true, warnings: [] },
    { ok: true, warnings: ['slow'] },
    { ok: false, warnings: [] },
  ]);
  assert.deepEqual(s, { total: 3, passed: 2, failed: 1, warnings: 1 });
});
