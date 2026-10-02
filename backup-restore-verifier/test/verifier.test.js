import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

test('backup-restore-verifier config example exists', () => {
  assert.equal(fs.existsSync('./config.example.yml'), true);
});
