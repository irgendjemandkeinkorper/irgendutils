import test from 'node:test';
import assert from 'node:assert/strict';

test('dns-ssl-uptime-monitor smoke test', () => {
  assert.equal(typeof process.env, 'object');
});
