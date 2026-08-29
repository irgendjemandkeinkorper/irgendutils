import test from 'node:test';
import assert from 'node:assert/strict';
import { worstStatus, toUrl, hostOf, registeredDomain, nameMatches } from '../src/util.js';

test('dns-ssl-uptime-monitor utils', () => {
  assert.equal(worstStatus(['green', 'amber', 'green']), 'amber');
  assert.equal(worstStatus(['green', 'red']), 'red');
  assert.equal(toUrl('example.com'), 'https://example.com');
  assert.equal(hostOf('https://example.com/path'), 'example.com');
  assert.equal(registeredDomain('sub.example.com'), 'example.com');
  assert.ok(nameMatches('*.example.com', 'test.example.com'));
});
