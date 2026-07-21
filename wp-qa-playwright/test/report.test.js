import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadConfig } from '../src/config.js';
import { runQa } from '../src/runner.js';
import { createFakeAdapter } from '../src/adapters/fake.js';
import {
  buildResultsJson,
  renderHtmlReport,
  slugifyUrl,
  writeReport,
  saveBaseline,
  loadBaseline,
} from '../src/report.js';

const FIXTURES = path.dirname(fileURLToPath(import.meta.url)).replace(/test$/, 'fixtures');
const CONFIG = path.join(FIXTURES, 'qa.config.yml');

async function run() {
  const cfg = loadConfig(CONFIG);
  return { cfg, run: await runQa(cfg, createFakeAdapter(cfg.fixture)) };
}

function tmpdir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'wpqa-'));
}

test('buildResultsJson has a valid, CI-friendly schema and no image buffers', async () => {
  const { run: r } = await run();
  const json = buildResultsJson(r, { generatedAt: '2026-07-20T00:00:00.000Z' });
  assert.equal(json.tool, '@irgendutils/wp-qa-playwright');
  assert.equal(json.pass, false);
  assert.equal(json.generated_at, '2026-07-20T00:00:00.000Z');
  assert.equal(json.summary.targets, 2);
  assert.equal(json.summary.passed, 1);
  assert.equal(json.summary.failed, 1);
  assert.deepEqual(Object.keys(json.summary.findings).sort(), ['error', 'info', 'warn']);
  assert.ok(Array.isArray(json.results));
  // No Buffers leak into the JSON.
  assert.doesNotMatch(JSON.stringify(json), /"type":"Buffer"/);
});

test('renderHtmlReport reflects the verdict and lists findings', async () => {
  const { run: r } = await run();
  const html = renderHtmlReport(r, { generatedAt: '2026-07-20T00:00:00.000Z' });
  assert.match(html, /<title>WP QA report — FAIL<\/title>/);
  assert.match(html, /broken\.example\.com/);
  assert.match(html, /Missing landmark/);
  assert.match(html, /No findings — matches the template/); // the passing target
});

test('slugifyUrl makes a filesystem-safe slug', () => {
  assert.equal(slugifyUrl('https://acme.example.com/shop?x=1'), 'acme-example-com-shop-x-1');
  assert.equal(slugifyUrl('https://a.b/'), 'a-b');
});

test('writeReport writes index.html, results.json and valid PNG screenshots', async () => {
  const { run: r } = await run();
  const dir = writeReport(r, { outDir: tmpdir(), timestamp: 'stamp', generatedAt: '2026-07-20T00:00:00.000Z' });
  assert.ok(fs.existsSync(path.join(dir, 'index.html')));
  const json = JSON.parse(fs.readFileSync(path.join(dir, 'results.json'), 'utf8'));
  assert.equal(json.pass, false);
  // A PNG was written and starts with the PNG signature.
  const png = fs.readFileSync(path.join(dir, 'screenshots', 'broken-example-com', '360-target.png'));
  assert.deepEqual([...png.subarray(0, 4)], [0x89, 0x50, 0x4e, 0x47]);
});

test('baseline save/load round-trips screenshots as PNGs', async () => {
  const { cfg, run: r } = await run();
  const c = { ...cfg, baseline_dir: path.join(tmpdir(), 'baseline') };
  const shots = {
    360: r.results[0].visualArtifacts['360'].target,
    1280: r.results[0].visualArtifacts['1280'].target,
  };
  const written = saveBaseline(c, 'https://good.example.com/', shots);
  assert.equal(written.length, 2);
  const loaded = loadBaseline(c, 'https://good.example.com/');
  assert.deepEqual(Object.keys(loaded).sort(), ['1280', '360']);
  assert.equal(Buffer.compare(loaded['360'].data, shots[360].data), 0);
});

test('loadBaseline returns null when no baseline exists', () => {
  assert.equal(loadBaseline({ baseline_dir: path.join(tmpdir(), 'nope') }, 'https://x.y/'), null);
});
