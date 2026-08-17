import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

test('repo-template script exists', () => {
  const scriptPath = path.resolve(__dirname, '../src/create-repo.js');
  assert.ok(fs.existsSync(scriptPath), 'create-repo.js should exist');
  const content = fs.readFileSync(scriptPath, 'utf8');
  assert.ok(content.includes('Repository Template Generator'), 'script should contain title');
});
