import test from 'node:test';
import assert from 'node:assert/strict';
import { withDefaults, resolveChecks } from '../src/config.js';

test('withDefaults sets default values for monitor config', () => {
  const config = withDefaults({});
  assert.deepEqual(config.tls.warn_days, [30, 14, 7, 1]);
  assert.equal(config.uptime.timeout_ms, 10000);
});

test('resolveChecks resolves default checks', () => {
  const config = withDefaults({});
  const checks = resolveChecks(config);
  assert.deepEqual(checks, ['uptime', 'tls', 'dns']);
});
