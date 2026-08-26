import test from 'node:test';
import assert from 'node:assert/strict';
import { loadConfig } from '../src/config.js';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

test('loadConfig parses example configuration file', () => {
  const exampleConfigPath = path.resolve(__dirname, '../config.example.yml');
  const cfg = loadConfig(exampleConfigPath);
  assert.equal(typeof cfg, 'object');
  assert.notEqual(cfg, null);
  assert.equal(Array.isArray(cfg.targets), true);
});
