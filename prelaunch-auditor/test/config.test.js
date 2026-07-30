import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { resolveConfig } from '../src/config.js'

function tmpFile(name, content) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'prelaunch-auditor-test-'))
  const file = path.join(dir, name)
  fs.writeFileSync(file, content)
  return file
}

test('defaults apply with no config file or flags', () => {
  const cfg = resolveConfig({})
  assert.equal(cfg.environment, 'staging')
  assert.equal(cfg.runs, 3)
  assert.equal(cfg.maxPages, 25)
  assert.deepEqual(cfg.only, [])
})

test('config file overrides defaults', () => {
  const file = tmpFile('audit.config.yml', 'environment: production\nruns: 5\nmax_pages: 10\n')
  const cfg = resolveConfig({ configFile: file })
  assert.equal(cfg.environment, 'production')
  assert.equal(cfg.runs, 5)
  assert.equal(cfg.maxPages, 10)
})

test('precedence: defaults < config file < fixture environment < CLI flags', () => {
  const file = tmpFile('audit.config.yml', 'environment: staging\n')
  const cfg = resolveConfig({ configFile: file, fixtureEnvironment: 'production', flags: {} })
  assert.equal(cfg.environment, 'production', 'fixture environment should win over the config file')

  const cfg2 = resolveConfig({ configFile: file, fixtureEnvironment: 'production', flags: { env: 'staging' } })
  assert.equal(cfg2.environment, 'staging', 'an explicit CLI flag should win over the fixture environment')
})

test('--budget merges onto the default budgets by form factor', () => {
  const budgetFile = tmpFile('budgets.json', JSON.stringify({ mobile: { lcp_ms: 1000 } }))
  const cfg = resolveConfig({ flags: { budget: budgetFile } })
  assert.equal(cfg.budgets.mobile.lcp_ms, 1000)
  assert.ok(cfg.budgets.desktop, 'desktop budget should still be present from defaults')
})

test('invalid environment is rejected', () => {
  assert.throws(() => resolveConfig({ flags: { env: 'prod-ish' } }), /environment must be/)
})

test('invalid runs is rejected', () => {
  assert.throws(() => resolveConfig({ flags: { runs: '0' } }), /runs must be/)
  assert.throws(() => resolveConfig({ flags: { runs: 'many' } }), /runs must be/)
})

test('missing config/budget file throws a clear error', () => {
  assert.throws(() => resolveConfig({ configFile: '/nope/audit.config.yml' }), /config file not found/)
  assert.throws(() => resolveConfig({ flags: { budget: '/nope/budgets.json' } }), /budget file not found/)
})
