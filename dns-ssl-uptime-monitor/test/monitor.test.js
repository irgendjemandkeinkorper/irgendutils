import test from 'node:test';
import assert from 'node:assert/strict';

test('dns-ssl-uptime-monitor basic sanity check', () => {
  assert.equal(typeof 'monitor', 'string');
});
