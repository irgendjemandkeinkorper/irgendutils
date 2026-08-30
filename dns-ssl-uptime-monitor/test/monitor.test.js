import test from 'node:test';
import assert from 'node:assert/strict';
import { worstStatus, toUrl, hostOf } from '../src/util.js';

test('dns-ssl-uptime-monitor util functions work correctly', () => {
  assert.equal(worstStatus(['green', 'amber', 'red']), 'red');
  assert.equal(toUrl('example.org'), 'https://example.org');
  assert.equal(hostOf('https://example.org/path'), 'example.org');
});
