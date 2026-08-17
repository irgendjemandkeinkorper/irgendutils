import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

test('backup-restore-verifier config example validation', () => {
  const configPath = path.resolve(__dirname, '../config.example.yml');
  assert.ok(fs.existsSync(configPath), 'config.example.yml should exist');
  const content = fs.readFileSync(configPath, 'utf8');
  assert.ok(content.includes('scratch:'), 'config should define scratch section');
});
