import test from 'node:test';
import assert from 'node:assert/strict';
import {
  worstStatus,
  toUrl,
  hostOf,
  registeredDomain,
  nameMatches,
  escapeHtml
} from '../src/util.js';

test('worstStatus ranks status correctly', () => {
  assert.equal(worstStatus(['green', 'amber']), 'amber');
  assert.equal(worstStatus(['amber', 'red', 'green']), 'red');
  assert.equal(worstStatus([], 'green'), 'green');
});

test('toUrl adds https prefix if missing', () => {
  assert.equal(toUrl('example.com'), 'https://example.com');
  assert.equal(toUrl('http://example.com'), 'http://example.com');
});

test('hostOf extracts hostname', () => {
  assert.equal(hostOf('https://sub.example.com/path'), 'sub.example.com');
  assert.equal(hostOf('example.com'), 'example.com');
});

test('registeredDomain extracts root domain', () => {
  assert.equal(registeredDomain('sub.example.com'), 'example.com');
  assert.equal(registeredDomain('example.com'), 'example.com');
});

test('nameMatches checks wildcard and exact matches', () => {
  assert.equal(nameMatches('*.example.com', 'sub.example.com'), true);
  assert.equal(nameMatches('*.example.com', 'foo.bar.example.com'), false);
  assert.equal(nameMatches('example.com', 'example.com'), true);
});

test('escapeHtml escapes dangerous HTML characters', () => {
  assert.equal(escapeHtml('<script>"foo" & bar</script>'), '&lt;script&gt;&quot;foo&quot; &amp; bar&lt;/script&gt;');
});
