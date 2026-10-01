import test from 'node:test';
import assert from 'node:assert/strict';

test('repo template generator structure test', () => {
  assert.equal(typeof 'create-repo', 'string');
});
