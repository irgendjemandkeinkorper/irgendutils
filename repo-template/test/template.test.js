import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

test('repo-template package has valid test configuration', () => {
  const pkgPath = path.resolve(__dirname, '../package.json');
  assert.equal(fs.existsSync(pkgPath), true);
  const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
  assert.equal(pkg.scripts.test, 'node --test');
});
