import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

test('backup-restore-verifier has valid package configuration', () => {
  const pkgPath = path.resolve(__dirname, '../package.json');
  assert.equal(fs.existsSync(pkgPath), true, 'package.json must exist');
  const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
  assert.equal(pkg.name, '@irgendutils/backup-restore-verifier');
});
