import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

test('backup-restore-verifier config example file exists', () => {
  const configPath = path.resolve('config.example.yml');
  assert.equal(fs.existsSync(configPath), true);
});
