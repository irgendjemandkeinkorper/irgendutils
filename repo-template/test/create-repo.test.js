import test from 'node:test';
import assert from 'node:assert/strict';

test('repo-template structure test', () => {
  const options = {
    name: 'my-new-repo',
    type: 'cli',
  };
  assert.equal(options.name, 'my-new-repo');
  assert.equal(options.type, 'cli');
});
