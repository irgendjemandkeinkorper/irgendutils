import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

test('repo-template package config is valid', () => {
  const pkg = JSON.parse(fs.readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
  assert.equal(pkg.name, '@irgendutils/repo-template');
});
