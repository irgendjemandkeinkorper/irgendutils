import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

test('create-repo script exists and is executable entry point', () => {
  const cliPath = path.resolve(__dirname, '../src/create-repo.js');
  assert.equal(fs.existsSync(cliPath), true);
  const content = fs.readFileSync(cliPath, 'utf8');
  assert.match(content, /#!/);
});
