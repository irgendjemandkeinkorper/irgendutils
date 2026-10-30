import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

test('backup-restore-verifier structure test', () => {
  assert.ok(fs.existsSync('package.json'));
  const pkg = JSON.parse(fs.readFileSync('package.json', 'utf8'));
  assert.equal(pkg.name, '@irgendutils/backup-restore-verifier');
  assert.equal(pkg.scripts.test, 'node --test');
});
