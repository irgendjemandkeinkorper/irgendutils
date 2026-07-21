import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join, dirname } from 'node:path';

import { parseWpConfig, checkWpConfigAgainstTarget } from '../src/wpconfig.js';

const fixtures = join(dirname(fileURLToPath(import.meta.url)), '..', 'fixtures');

test('parses DB_CHARSET / DB_COLLATE from a wp-config.php with spacing variations', () => {
  const wp = parseWpConfig(readFileSync(join(fixtures, 'wp-config-utf8.php'), 'utf8'));
  assert.equal(wp.DB_CHARSET, 'utf8');
  assert.equal(wp.DB_COLLATE, 'utf8_general_ci');
  assert.equal(wp.DB_NAME, 'wp_legacy');
});

test('parses tight define() style and empty DB_COLLATE', () => {
  const wp = parseWpConfig(readFileSync(join(fixtures, 'wp-config-utf8mb4.php'), 'utf8'));
  assert.equal(wp.DB_CHARSET, 'utf8mb4');
  assert.equal(wp.DB_COLLATE, '');
});

test('warns when the site itself is configured for 3-byte utf8', () => {
  const wp = { DB_CHARSET: 'utf8', DB_COLLATE: 'utf8_general_ci' };
  const warnings = checkWpConfigAgainstTarget(wp, 'utf8mb4', 'utf8mb4_unicode_ci');
  assert.equal(warnings.length, 2);
  assert.match(warnings[0], /DB_CHARSET is 'utf8'/);
  assert.match(warnings[0], /only 3 bytes/);
  assert.match(warnings[1], /DB_COLLATE/);
});

test('no warnings when wp-config already targets utf8mb4', () => {
  const wp = { DB_CHARSET: 'utf8mb4', DB_COLLATE: '' };
  assert.deepEqual(checkWpConfigAgainstTarget(wp, 'utf8mb4', 'utf8mb4_unicode_ci'), []);
});

test('warns when DB_CHARSET is missing entirely', () => {
  const warnings = checkWpConfigAgainstTarget({}, 'utf8mb4', 'utf8mb4_unicode_ci');
  assert.equal(warnings.length, 1);
  assert.match(warnings[0], /does not define DB_CHARSET/);
});
