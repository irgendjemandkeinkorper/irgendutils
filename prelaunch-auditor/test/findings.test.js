import { test } from 'node:test'
import assert from 'node:assert/strict'
import { finding, sortFindings, summarize, SEVERITIES, CATEGORY_ORDER } from '../src/findings.js'

test('finding() rejects an invalid severity', () => {
  assert.throws(() => finding('seo', 'x', 'critical', 'msg', 'fix'), /invalid severity/)
  for (const s of SEVERITIES) {
    assert.doesNotThrow(() => finding('seo', 'x', s, 'msg', 'fix'))
  }
})

test('sortFindings: blockers first, then category order, then id/url/message', () => {
  const f = (category, id, severity, url = null, message = id) => finding(category, id, severity, message, 'fix', url)
  const input = [
    f('content', 'z-warn', 'warning'),
    f('seo', 'blocker-b', 'blocker'),
    f('a11y', 'blocker-a', 'blocker'),
    f('seo', 'info-1', 'info'),
    f('seo', 'a-warn', 'warning'),
  ]
  const sorted = sortFindings(input)
  assert.deepEqual(sorted.map((x) => x.id), ['blocker-b', 'blocker-a', 'a-warn', 'z-warn', 'info-1'])
  // seo sorts before a11y in CATEGORY_ORDER, so blocker-b (seo) precedes blocker-a (a11y)
  assert.ok(CATEGORY_ORDER.indexOf('seo') < CATEGORY_ORDER.indexOf('a11y'))
})

test('summarize: counts by severity and by category', () => {
  const f = (category, severity) => finding(category, `${category}-${severity}-${Math.random()}`, severity, 'm', 'fix')
  const findings = [f('seo', 'blocker'), f('seo', 'warning'), f('a11y', 'warning'), f('a11y', 'info')]
  const s = summarize(findings)
  assert.equal(s.blocker, 1)
  assert.equal(s.warning, 2)
  assert.equal(s.info, 1)
  assert.deepEqual(s.byCategory.seo, { blocker: 1, warning: 1, info: 0 })
  assert.deepEqual(s.byCategory.a11y, { blocker: 0, warning: 1, info: 1 })
})

test('summarize on an empty findings list', () => {
  const s = summarize([])
  assert.deepEqual(s, { blocker: 0, warning: 0, info: 0, byCategory: {} })
})
