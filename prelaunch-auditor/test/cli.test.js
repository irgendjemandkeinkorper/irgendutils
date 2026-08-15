// End-to-end CLI tests: spawn src/cli.js against the fixture directories.
// Offline — no network, no browser, no Lighthouse.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const appDir = fileURLToPath(new URL('..', import.meta.url))
const cli = join(appDir, 'src', 'cli.js')
const fixture = (name) => join(appDir, 'test', 'fixtures', name)

function runCli(args) {
  const dir = mkdtempSync(join(tmpdir(), 'prelaunch-auditor-test-'))
  const out = join(dir, 'out')
  const res = spawnSync(process.execPath, [cli, ...args, '--out', out, '--no-color'], {
    encoding: 'utf8',
    timeout: 15000,
    cwd: dir,
  })
  let scorecard = null
  try { scorecard = JSON.parse(readFileSync(join(out, 'scorecard.json'), 'utf8')) } catch { /* may not exist for usage errors */ }
  const htmlExists = existsSync(join(out, 'scorecard.html'))
  rmSync(dir, { recursive: true, force: true })
  return { ...res, scorecard, htmlExists }
}

function assertStatus(r, expected) {
  if (r.status !== expected) {
    assert.fail(
      `Expected exit code ${expected} but got ${r.status}.\n\n` +
      `--- STDOUT ---\n${r.stdout || ''}\n\n` +
      `--- STDERR ---\n${r.stderr || ''}`
    );
  }
}

test('run --fixture clean: exits 0, writes scorecard.json + scorecard.html', () => {
  const r = runCli(['run', '--fixture', fixture('clean')])
  assertStatus(r, 0)
  assert.match(r.stdout, /READY/)
  assert.equal(r.scorecard.pass, true)
  assert.equal(r.scorecard.summary.blocker, 0)
  assert.ok(r.htmlExists)
})

test('run --fixture broken: exits 1, lists blockers in the console summary', () => {
  const r = runCli(['run', '--fixture', fixture('broken')])
  assertStatus(r, 1)
  assert.match(r.stdout, /NOT READY/)
  assert.match(r.stdout, /BLOCKER/)
  assert.equal(r.scorecard.pass, false)
  assert.ok(r.scorecard.summary.blocker > 0)
})

test('--only filters categories end-to-end', () => {
  const r = runCli(['run', '--fixture', fixture('broken'), '--only', 'seo'])
  assert.equal(r.scorecard.categories.length, 1)
  assert.ok(r.scorecard.findings.every((f) => f.category === 'seo'))
})

test('--only with an unknown check exits 2', () => {
  const r = runCli(['run', '--fixture', fixture('clean'), '--only', 'seo,nonsense'])
  assertStatus(r, 2)
  assert.match(r.stderr, /unknown check/i)
})

test('--json prints the scorecard to stdout', () => {
  const r = runCli(['run', '--fixture', fixture('clean'), '--json'])
  assertStatus(r, 0)
  const parsed = JSON.parse(r.stdout)
  assert.equal(parsed.tool, '@irgendutils/prelaunch-auditor')
  assert.equal(parsed.pass, true)
})

test('run with neither a URL nor --fixture exits 2 with a usage hint', () => {
  const r = runCli(['run'])
  assertStatus(r, 2)
  assert.match(r.stderr, /Usage: audit run/)
})

test('unknown command exits 2', () => {
  const r = runCli(['bogus'])
  assertStatus(r, 2)
  assert.match(r.stderr, /Unknown command/)
})

test('--help prints usage and exits 0', () => {
  const r = runCli(['--help'])
  assertStatus(r, 0)
  assert.match(r.stdout, /audit run/)
})

test('missing fixture directory exits 2 with a clear error', () => {
  const r = runCli(['run', '--fixture', join(appDir, 'test', 'fixtures', 'nope')])
  assertStatus(r, 2)
  assert.match(r.stderr, /Error:/)
})
