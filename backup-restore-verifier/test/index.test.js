import test from 'node:test';
import assert from 'node:assert';
import pkg from '../package.json' with { type: 'json' };

test('backup-restore-verifier package manifest is valid', () => {
  assert.strictEqual(pkg.name, '@irgendutils/backup-restore-verifier');
});
