import test from 'node:test';
import assert from 'node:assert/strict';

test('backup-restore-verifier smoke test', () => {
  assert.equal(typeof process.env, 'object');
});
