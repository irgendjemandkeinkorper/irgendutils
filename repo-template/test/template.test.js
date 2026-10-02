import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

test('create-repo template generator file exists', () => {
  assert.equal(fs.existsSync('./src/create-repo.js'), true);
});
