import test from 'node:test';
import assert from 'node:assert/strict';

test('repo-template smoke test', () => {
  assert.equal(typeof process.env, 'object');
});
