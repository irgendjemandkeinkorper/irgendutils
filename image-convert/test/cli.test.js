// End-to-end CLI tests: spawn src/cli.js against real temp files (sharp needs a
// real image to decode, no fake adapter here). Offline — no network.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, rmSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import sharp from 'sharp'

const appDir = fileURLToPath(new URL('..', import.meta.url))
const cli = join(appDir, 'src', 'cli.js')

function runCli(args, opts = {}) {
  return spawnSync(process.execPath, [cli, ...args], { encoding: 'utf8', timeout: 15000, ...opts })
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

function assertNonZero(r) {
  if (r.status === 0) {
    assert.fail(
      `Expected exit code to be non-zero but got 0.\n\n` +
      `--- STDOUT ---\n${r.stdout || ''}\n\n` +
      `--- STDERR ---\n${r.stderr || ''}`
    );
  }
}

async function withSample(fn) {
  const dir = mkdtempSync(join(tmpdir(), 'image-convert-test-'))
  const src = join(dir, 'sample.png')
  await sharp({ create: { width: 64, height: 64, channels: 3, background: { r: 10, g: 20, b: 30 } } })
    .png().toFile(src)
  try { return await fn(dir, src) }
  finally { rmSync(dir, { recursive: true, force: true }) }
}

test('--help prints usage and exits 0', () => {
  const r = runCli(['--help'])
  assertStatus(r, 0)
  assert.match(r.stdout, /image-convert/)
  assert.match(r.stdout, /--apply/)
})

test('no arguments prints usage and exits non-zero', () => {
  const r = runCli([])
  assertNonZero(r)
  assert.match(r.stdout, /image-convert/)
})

test('unsupported --format is rejected with exit 2', () => {
  const r = runCli(['.', '--format', 'jpegxl'])
  assertStatus(r, 2)
  assert.match(r.stderr, /unsupported format/i)
})

test('--delete-original without --apply is refused (dry runs never delete)', () => {
  const r = runCli(['.', '--delete-original'])
  assertStatus(r, 2)
  assert.match(r.stderr, /Refusing --delete-original without --apply/)
})

test('dry run (default) lists the plan and writes nothing', async () => {
  await withSample(async (dir, src) => {
    const r = runCli([src, '--format', 'webp'])
    assertStatus(r, 0)
    assert.match(r.stdout, /DRY RUN/)
    assert.match(r.stdout, /Dry run — nothing written/)
    assert.equal(existsSync(join(dir, 'sample.webp')), false)
  })
})

test('--apply writes the converted file', async () => {
  await withSample(async (dir, src) => {
    const r = runCli([src, '--format', 'webp', '--apply', '--quiet'])
    assertStatus(r, 0)
    assert.ok(existsSync(join(dir, 'sample.webp')))
  })
})

test('--apply --delete-original removes the source once conversion succeeds', async () => {
  await withSample(async (dir, src) => {
    const r = runCli([src, '--format', 'webp', '--apply', '--delete-original', '--quiet'])
    assertStatus(r, 0)
    assert.ok(existsSync(join(dir, 'sample.webp')))
    assert.equal(existsSync(src), false, 'original should be deleted after success')
  })
})

test('no convertible images found exits 1 with a hint', () => {
  const dir = mkdtempSync(join(tmpdir(), 'image-convert-empty-'))
  try {
    const r = runCli([dir])
    assertStatus(r, 1)
    assert.match(r.stderr, /No convertible images found/)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})
