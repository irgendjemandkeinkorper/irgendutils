import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

test('backup-restore-verifier scaffold structure and configuration', () => {
  const pkgPath = path.resolve(__dirname, '../package.json');
  assert.equal(fs.existsSync(pkgPath), true);
  const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
  assert.equal(pkg.name, '@irgendutils/backup-restore-verifier');

  const configPath = path.resolve(__dirname, '../config.example.yml');
  assert.equal(fs.existsSync(configPath), true);
});
