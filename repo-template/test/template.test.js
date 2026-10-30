import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

test('repo-template package structure', () => {
  assert.ok(fs.existsSync('package.json'));
  assert.ok(fs.existsSync('src/create-repo.js'));
  const pkg = JSON.parse(fs.readFileSync('package.json', 'utf8'));
  assert.equal(pkg.name, '@irgendutils/repo-template');
  assert.equal(pkg.scripts.test, 'node --test');
});
