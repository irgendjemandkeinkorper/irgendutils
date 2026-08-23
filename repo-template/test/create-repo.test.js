import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

test('create-repo script file exists and is readable', () => {
  const scriptPath = path.resolve('src/create-repo.js');
  assert.equal(fs.existsSync(scriptPath), true);
  const content = fs.readFileSync(scriptPath, 'utf8');
  assert.match(content, /Repository Template Generator/);
});
