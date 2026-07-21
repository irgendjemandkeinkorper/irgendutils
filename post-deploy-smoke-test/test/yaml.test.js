import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { parseYaml, parseDotEnv } from '../src/yaml.js';

const fixture = (name) => fileURLToPath(new URL(`../fixtures/${name}`, import.meta.url));

test('parses the spec-shaped smoke.yml', () => {
  const cfg = parseYaml(readFileSync(fixture('smoke.fixture.yml'), 'utf8'));
  assert.equal(cfg.base_url, 'https://acme.example.com');
  assert.equal(cfg.timeout_ms, 500);
  assert.equal(cfg.fail_fast, false);
  assert.equal(cfg.checks.length, 5);
  assert.deepEqual(cfg.checks[0], { path: '/', status: 200, contains: 'Acme' });
  assert.deepEqual(cfg.checks[3], { path: '/old-page', status: 301, redirects_to: '/new-page' });
  assert.equal(cfg.checks[2].json, true);
  assert.equal(cfg.authed.length, 1);
  assert.equal(cfg.authed[0].app_password_env, 'WP_APP_PASSWORD');
  assert.equal(cfg.authed[0].user, 'automation');
});

test('handles comments, quotes and scalar coercion', () => {
  const cfg = parseYaml(`
# full-line comment
base_url: https://x.example.com   # trailing comment
timeout_ms: 8000
ratio: 1.5
flag: true
nothing: null
name: "hash # inside quotes"
checks:
  - { path: /a, contains: "Add to cart, now" }
`);
  assert.equal(cfg.base_url, 'https://x.example.com');
  assert.equal(cfg.timeout_ms, 8000);
  assert.equal(cfg.ratio, 1.5);
  assert.equal(cfg.flag, true);
  assert.equal(cfg.nothing, null);
  assert.equal(cfg.name, 'hash # inside quotes');
  assert.deepEqual(cfg.checks[0], { path: '/a', contains: 'Add to cart, now' });
});

test('throws a clear error on unparseable lines', () => {
  assert.throws(() => parseYaml('just some junk'), /cannot parse/);
  assert.throws(() => parseYaml('- { path: / }'), /list item without/);
});

test('parseDotEnv reads KEY=value with quotes and comments', () => {
  const env = parseDotEnv(`
# secrets
WP_APP_PASSWORD="abcd efgh ijkl"
export OTHER=plain
IGNORED LINE
`);
  assert.equal(env.WP_APP_PASSWORD, 'abcd efgh ijkl');
  assert.equal(env.OTHER, 'plain');
  assert.equal(Object.keys(env).length, 2);
});
