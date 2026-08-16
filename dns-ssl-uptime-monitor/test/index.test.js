import test from 'node:test';
import assert from 'node:assert';
import { withDefaults } from '../src/config.js';

test('dns-ssl-uptime-monitor withDefaults loads default config', () => {
  const config = withDefaults({});
  assert.ok(config);
  assert.ok(Array.isArray(config.targets));
});
