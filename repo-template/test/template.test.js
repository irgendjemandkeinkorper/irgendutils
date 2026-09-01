import test from 'node:test';
import assert from 'node:assert/strict';

test('repo-template basic sanity check', () => {
  assert.equal(typeof 'template', 'string');
});
