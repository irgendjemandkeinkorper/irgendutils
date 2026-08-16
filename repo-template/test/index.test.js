import test from 'node:test';
import assert from 'node:assert';
import pkg from '../package.json' with { type: 'json' };

test('repo-template package manifest is valid', () => {
  assert.strictEqual(pkg.name, '@irgendutils/repo-template');
});
