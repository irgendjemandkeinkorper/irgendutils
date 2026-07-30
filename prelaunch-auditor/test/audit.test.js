// Acceptance criteria: a clean site audits with zero blockers/warnings; a
// deliberately broken fixture trips at least one blocker per check category
// that's exercised; findings are deterministically ordered; the exit-code
// contract (pass === no blockers) holds.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { runAudit } from '../src/audit.js'
import { resolveConfig } from '../src/config.js'
import { createFixtureAdapter } from '../src/adapters/fixture.js'
import { sortFindings } from '../src/findings.js'

const here = path.dirname(fileURLToPath(import.meta.url))
const fixture = (name) => path.join(here, 'fixtures', name)

async function auditFixture(name, { configOverrides } = {}) {
  const adapter = await createFixtureAdapter(fixture(name))
  const config = resolveConfig({ fixtureEnvironment: adapter.environment })
  Object.assign(config, configOverrides)
  return runAudit(adapter, config)
}

test('clean fixture: zero blockers, zero warnings, pass === true', async () => {
  const run = await auditFixture('clean')
  const blockers = run.findings.filter((f) => f.severity === 'blocker')
  const warnings = run.findings.filter((f) => f.severity === 'warning')
  assert.deepEqual(blockers, [], `unexpected blockers: ${JSON.stringify(blockers, null, 2)}`)
  assert.deepEqual(warnings, [], `unexpected warnings: ${JSON.stringify(warnings, null, 2)}`)
  assert.equal(run.summary.blocker, 0)
  assert.equal(run.pass, true)
  assert.equal(run.pagesAudited.length, 2)
})

test('broken fixture: trips a blocker per exercised category, pass === false', async () => {
  const run = await auditFixture('broken', { configOverrides: { consent: { required: true } } })
  assert.equal(run.pass, false)
  assert.ok(run.summary.blocker >= 10, `expected many blockers, got ${run.summary.blocker}`)

  const ids = run.findings.map((f) => f.id)
  const blockerIds = run.findings.filter((f) => f.severity === 'blocker').map((f) => f.id)

  // seo
  assert.ok(blockerIds.includes('staging-canonical'))
  assert.ok(blockerIds.includes('noindex-production'))
  assert.ok(blockerIds.includes('robots-disallow-all'))
  assert.ok(ids.includes('missing-meta-description'))
  assert.ok(ids.includes('missing-h1'))
  assert.ok(ids.includes('missing-open-graph'))
  // a11y
  assert.ok(blockerIds.includes('img-missing-alt'))
  assert.ok(blockerIds.includes('form-missing-label'))
  assert.ok(ids.includes('missing-lang'))
  assert.ok(ids.includes('low-contrast'))
  assert.ok(ids.includes('focus-outline-removed'))
  // perf (over budget on both form factors)
  assert.ok(blockerIds.includes('mobile-lcp_ms-over-budget'))
  assert.ok(blockerIds.includes('desktop-lcp_ms-over-budget'))
  // security
  assert.ok(blockerIds.includes('site-on-http'))
  assert.ok(blockerIds.includes('debug-output'))
  assert.ok(ids.includes('wp-version-exposed'))
  assert.ok(ids.includes('readme-exposed'))
  assert.ok(ids.includes('default-admin-username'))
  // content
  assert.ok(blockerIds.includes('lorem-ipsum'))
  assert.ok(ids.includes('sample-content'))
  assert.ok(ids.includes('empty-menu'))
  assert.ok(ids.includes('broken-internal-link'))
  assert.ok(ids.includes('404-wrong-status'))
  assert.ok(ids.includes('missing-favicon'))
  // analytics / consent
  assert.ok(blockerIds.includes('tracking-missing'))
  assert.ok(blockerIds.includes('consent-missing'))
})

test('findings are deterministically ordered: blockers first, then by category/id', async () => {
  const run = await auditFixture('broken', { configOverrides: { consent: { required: true } } })
  const resorted = sortFindings(run.findings)
  assert.deepEqual(run.findings, resorted, 'runAudit should already return sorted findings')
  const firstWarningIdx = run.findings.findIndex((f) => f.severity === 'warning')
  const lastBlockerIdx = run.findings.map((f) => f.severity).lastIndexOf('blocker')
  if (firstWarningIdx !== -1 && lastBlockerIdx !== -1) {
    assert.ok(lastBlockerIdx < firstWarningIdx, 'all blockers must sort before all warnings')
  }
})

test('--only filters to the requested categories', async () => {
  const adapter = await createFixtureAdapter(fixture('broken'))
  const config = resolveConfig({ fixtureEnvironment: adapter.environment, flags: { only: 'seo,a11y' } })
  const run = await runAudit(adapter, config)
  assert.deepEqual(run.categories, ['seo', 'a11y'])
  assert.ok(run.findings.every((f) => ['seo', 'a11y'].includes(f.category)))
})

test('two runs of the same fixture produce byte-identical findings (determinism)', async () => {
  const a = await auditFixture('clean')
  const b = await auditFixture('clean')
  assert.deepEqual(a.findings, b.findings)
})
