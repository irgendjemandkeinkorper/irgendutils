import test from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { join, dirname } from 'node:path';

import { parseYaml } from '../src/yaml.js';
import { loadConfig, resolvePassword } from '../src/config.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

test('parseYaml handles nested maps, scalars, comments and quotes', () => {
  const doc = parseYaml(`
# top comment
db:
  host: 127.0.0.1   # inline comment
  port: 3306
  name: "site db"
  user: 'readonly'
target_charset: utf8mb4
require_backup_before_apply: true
empty:
`);
  assert.equal(doc.db.host, '127.0.0.1');
  assert.equal(doc.db.port, 3306);
  assert.equal(doc.db.name, 'site db');
  assert.equal(doc.db.user, 'readonly');
  assert.equal(doc.target_charset, 'utf8mb4');
  assert.equal(doc.require_backup_before_apply, true);
  assert.deepEqual(doc.empty, {});
});

test('parseYaml handles inline arrays and block lists', () => {
  const doc = parseYaml(`
inline: [wp_posts, wp_postmeta]
block:
  - alpha
  - beta
scope: tables:[wp_posts,wp_postmeta]
`);
  assert.deepEqual(doc.inline, ['wp_posts', 'wp_postmeta']);
  assert.deepEqual(doc.block, ['alpha', 'beta']);
  // scope value contains a colon and brackets — must survive as a string
  assert.equal(doc.scope, 'tables:[wp_posts,wp_postmeta]');
});

test('loadConfig parses the shipped example config and applies defaults', () => {
  const config = loadConfig(join(root, 'config.example.yml'));
  assert.equal(config.db.host, '127.0.0.1');
  assert.equal(config.db.pass_env, 'DB_RO_PASSWORD');
  assert.equal(config.target_charset, 'utf8mb4');
  assert.equal(config.target_collation, 'utf8mb4_unicode_ci');
  assert.equal(config.scope, 'all');
  assert.equal(config.require_backup_before_apply, true);
  assert.equal(config.backup.path, 'backups/sitedb.sql');
  assert.equal(config.backup.max_age_hours, 24);
  assert.equal(config.report_dir, 'report');
});

test('loadConfig without a file returns pure defaults', () => {
  const config = loadConfig(undefined);
  assert.equal(config.target_charset, 'utf8mb4');
  assert.equal(config.require_backup_before_apply, true);
});

test('resolvePassword reads the env var NAMED in config, never the config itself', () => {
  const env = { DB_RO_PASSWORD: 's3cret', DB_RW_PASSWORD: 'r00t' };
  assert.equal(resolvePassword({ pass_env: 'DB_RO_PASSWORD' }, { env }), 's3cret');
  assert.equal(
    resolvePassword({ pass_env: 'DB_RO_PASSWORD', apply_pass_env: 'DB_RW_PASSWORD' }, { env, forApply: true }),
    'r00t'
  );
  assert.throws(() => resolvePassword({ pass_env: 'MISSING_VAR' }, { env }), /MISSING_VAR/);
  assert.equal(resolvePassword({}, { env }), undefined);
});
