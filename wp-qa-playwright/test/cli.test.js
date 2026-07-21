import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.dirname(fileURLToPath(import.meta.url)).replace(/test$/, '');
const CLI = path.join(ROOT, 'src', 'cli.js');
const CONFIG = path.join(ROOT, 'fixtures', 'qa.config.yml');

function qa(args, opts = {}) {
  return spawnSync(process.execPath, [CLI, ...args], {
    cwd: ROOT,
    encoding: 'utf8',
    env: { ...process.env, NO_COLOR: '1', ...opts.env },
  });
}
function tmpOut() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'wpqa-cli-'));
}

test('qa run against a matching target exits 0', () => {
  const out = tmpOut();
  const r = qa(['run', 'https://good.example.com/', '-c', CONFIG, '-o', out]);
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /PASS/);
});

test('qa run against the broken target exits 1 with reasons', () => {
  const out = tmpOut();
  const r = qa(['run', 'https://broken.example.com/', '-c', CONFIG, '-o', out]);
  assert.equal(r.status, 1);
  assert.match(r.stdout, /FAIL/);
  assert.match(r.stdout, /wp_hygiene|visual|responsive/);
});

test('qa run writes a report directory with index.html and results.json', () => {
  const out = tmpOut();
  qa(['run', 'https://good.example.com/', '-c', CONFIG, '-o', out]);
  const stamps = fs.readdirSync(out);
  assert.equal(stamps.length, 1);
  assert.ok(fs.existsSync(path.join(out, stamps[0], 'index.html')));
  assert.ok(fs.existsSync(path.join(out, stamps[0], 'results.json')));
});

test('qa run --json prints valid results.json', () => {
  const out = tmpOut();
  const r = qa(['run', 'https://good.example.com/', '-c', CONFIG, '-o', out, '--json']);
  assert.equal(r.status, 0, r.stderr);
  const json = JSON.parse(r.stdout);
  assert.equal(json.pass, true);
  assert.equal(json.tool, '@irgendutils/wp-qa-playwright');
});

test('qa run --checks limits the checks that run', () => {
  const out = tmpOut();
  const r = qa(['run', 'https://broken.example.com/', '-c', CONFIG, '-o', out, '--checks', 'links', '--json']);
  const json = JSON.parse(r.stdout);
  assert.deepEqual(json.results[0].checks_run, ['links']);
});

test('qa report points at the latest report', () => {
  const out = tmpOut();
  qa(['run', 'https://good.example.com/', '-c', CONFIG, '-o', out]);
  const r = qa(['report', '-c', CONFIG, '-o', out]);
  assert.equal(r.status, 0);
  assert.match(r.stdout.trim(), /index\.html$/);
});

test('missing config exits 2 with a helpful message', () => {
  const r = qa(['run', '-c', '/no/such/qa.config.yml']);
  assert.equal(r.status, 2);
  assert.match(r.stderr, /Config file not found/);
});

test('unknown command exits 2', () => {
  const r = qa(['frobnicate']);
  assert.equal(r.status, 2);
  assert.match(r.stderr, /Unknown command/);
});

test('--help prints usage and exits 0', () => {
  const r = qa(['--help']);
  assert.equal(r.status, 0);
  assert.match(r.stdout, /qa — WordPress QA/);
});
