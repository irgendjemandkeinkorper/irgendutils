import test from 'node:test';
import assert from 'node:assert/strict';
import {
  worstStatus,
  toUrl,
  hostOf,
  registeredDomain,
  daysUntil,
  nameMatches
} from '../src/util.js';

test('dns-ssl-uptime-monitor util tests', async (t) => {
  await t.test('worstStatus returns the highest rank status', () => {
    assert.equal(worstStatus(['green', 'amber']), 'amber');
    assert.equal(worstStatus(['green', 'amber', 'red']), 'red');
    assert.equal(worstStatus(['green']), 'green');
  });

  await t.test('toUrl formats target to valid URL string', () => {
    assert.equal(toUrl('example.com'), 'https://example.com');
    assert.equal(toUrl('http://example.com'), 'http://example.com');
  });

  await t.test('hostOf extracts hostname from target', () => {
    assert.equal(hostOf('https://example.com/path'), 'example.com');
    assert.equal(hostOf('sub.example.com'), 'sub.example.com');
  });

  await t.test('registeredDomain extracts last two labels', () => {
    assert.equal(registeredDomain('sub.example.com'), 'example.com');
    assert.equal(registeredDomain('example.com'), 'example.com');
  });

  await t.test('daysUntil calculates relative days correctly', () => {
    const now = Date.parse('2026-01-01T00:00:00Z');
    const target = Date.parse('2026-01-03T00:00:00Z');
    assert.equal(daysUntil(target, now), 2);
  });

  await t.test('nameMatches handles wildcard and exact matches', () => {
    assert.ok(nameMatches('*.example.com', 'sub.example.com'));
    assert.ok(!nameMatches('*.example.com', 'deep.sub.example.com'));
    assert.ok(nameMatches('example.com', 'example.com'));
  });
});
