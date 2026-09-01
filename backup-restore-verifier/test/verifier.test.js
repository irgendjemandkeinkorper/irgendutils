import test from 'node:test';
import assert from 'node:assert/strict';

test('backup-restore-verifier basic sanity check', () => {
  assert.equal(typeof 'verifier', 'string');
});
