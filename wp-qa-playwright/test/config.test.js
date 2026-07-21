import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadConfig, normalizeChecks, resolveAuth, loadEnvFile } from '../src/config.js';

const FIXTURES = path.dirname(fileURLToPath(import.meta.url)).replace(/test$/, 'fixtures');

test('normalizeChecks maps aliases and rejects unknown checks', () => {
  assert.deepEqual(normalizeChecks(['headings', 'links']), ['structural', 'links']);
  assert.deepEqual(normalizeChecks(['wp-hygiene']), ['wp_hygiene']);
  assert.ok(normalizeChecks([]).includes('visual')); // empty => all
  assert.throws(() => normalizeChecks(['nope']), /Unknown check/);
});

test('loadConfig fills defaults and resolves the fixture path relative to the config', () => {
  const cfg = loadConfig(path.join(FIXTURES, 'qa.config.yml'));
  assert.equal(cfg.template_url, 'https://template.example.com/');
  assert.deepEqual(cfg.targets, ['https://good.example.com/', 'https://broken.example.com/']);
  assert.deepEqual(cfg.viewports, [360, 1280]);
  assert.equal(cfg.thresholds.pixel_diff_pct, 0.15);
  assert.equal(cfg.thresholds.max_broken_links, 0);
  assert.equal(cfg.adapter, 'fake');
  assert.equal(cfg.fixture, path.join(FIXTURES, 'capture.json'));
});

test('loadConfig throws a clear error for a missing file', () => {
  assert.throws(() => loadConfig('/no/such/qa.config.yml'), /Config file not found/);
});

test('resolveAuth reads the password from env, never from config', () => {
  const cfg = { auth: { user: 'automation', app_password_env: 'WP_APP_PASSWORD' } };
  assert.equal(resolveAuth(cfg, {}), null);
  assert.deepEqual(resolveAuth(cfg, { WP_APP_PASSWORD: 'secret' }), { user: 'automation', password: 'secret' });
  assert.equal(resolveAuth({ auth: null }, { WP_APP_PASSWORD: 'x' }), null);
});

test('loadEnvFile parses KEY=VALUE and does not overwrite existing env', () => {
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'wpqa-env-')), '.env');
  fs.writeFileSync(file, 'WP_APP_PASSWORD="abcd efgh"\n# comment\nEXISTING=fromfile\n');
  const env = { EXISTING: 'fromenv' };
  loadEnvFile(file, env);
  assert.equal(env.WP_APP_PASSWORD, 'abcd efgh');
  assert.equal(env.EXISTING, 'fromenv'); // real env wins
});
