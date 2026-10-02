import test from 'node:test';
import assert from 'node:assert/strict';
import { worstStatus, toUrl, hostOf, daysUntil, nameMatches, escapeHtml } from '../src/util.js';

test('worstStatus ranks green < amber < red', () => {
  assert.equal(worstStatus(['green', 'amber']), 'amber');
  assert.equal(worstStatus(['amber', 'red']), 'red');
  assert.equal(worstStatus(['green']), 'green');
});

test('toUrl and hostOf format targets correctly', () => {
  assert.equal(toUrl('example.com'), 'https://example.com');
  assert.equal(hostOf('example.com/path'), 'example.com');
});

test('daysUntil calculates remaining days', () => {
  const now = Date.now();
  const future = now + 86_400_000 * 2;
  assert.equal(daysUntil(future, now), 2);
});

test('nameMatches handles wildcard and exact matches', () => {
  assert.equal(nameMatches('*.example.com', 'sub.example.com'), true);
  assert.equal(nameMatches('*.example.com', 'deep.sub.example.com'), false);
  assert.equal(nameMatches('example.com', 'example.com'), true);
});

test('escapeHtml escapes dangerous HTML characters', () => {
  assert.equal(escapeHtml('<script>"me" & you</script>'), '&lt;script&gt;&quot;me&quot; &amp; you&lt;/script&gt;');
});
