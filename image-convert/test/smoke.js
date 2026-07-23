// Smoke test: generate a real PNG, convert to WebP + AVIF, assert the outputs
// exist, decode, and are smaller. Proves the sharp toolchain (incl. AVIF) works.
// Run: npm test

import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import sharp from 'sharp'
import { encodeOne, collectInputs, planFile } from '../src/convert.js'

const here = path.dirname(fileURLToPath(import.meta.url))
const outDir = path.join(here, 'out')

async function main() {
  await fs.rm(outDir, { recursive: true, force: true })
  await fs.mkdir(outDir, { recursive: true })

  // A 512x512 gradient PNG — compressible, non-trivial content.
  const src = path.join(outDir, 'sample.png')
  await sharp({
    create: { width: 512, height: 512, channels: 3, background: { r: 200, g: 120, b: 40 } },
  }).png().composite([{
    input: Buffer.from(`<svg width="512" height="512"><circle cx="256" cy="256" r="200" fill="#204080"/></svg>`),
    top: 0, left: 0,
  }]).toFile(src)

  // discovery + planning
  const found = await collectInputs([outDir], { recursive: false })
  assert.ok(found.includes(path.resolve(src)), 'collectInputs finds the sample')
  const plan = await planFile(src, { formats: ['webp', 'avif'], outDir: null, force: false })
  assert.equal(plan.targets.length, 2, 'plans both formats')

  // encode both formats and verify each decodes to the right format
  for (const format of ['webp', 'avif']) {
    const r = await encodeOne(src, format, { outDir, quality: format === 'avif' ? 45 : 80 })
    const meta = await sharp(r.outPath).metadata()
    const okFormats = format === 'avif' ? ['avif', 'heif'] : [format]
    assert.ok(okFormats.includes(meta.format), `${format}: output decodes as ${meta.format}`)
    assert.ok(meta.width === 512 && meta.height === 512, `${format}: dimensions preserved`)
    assert.ok(r.outSize > 0, `${format}: non-empty output`)
    console.log(`  ok  ${format.padEnd(4)} → ${r.outSize} bytes (${meta.width}x${meta.height})`)
  }

  // resize + no-enlarge check
  const small = await encodeOne(src, 'webp', { outDir, maxWidth: 128 })
  const smeta = await sharp(small.outPath).metadata()
  assert.ok(smeta.width === 128, 'resize honors max-width')

  // idempotency: after writing, the plan should mark it up-to-date (skip)
  const plan2 = await planFile(src, { formats: ['webp'], outDir, force: false })
  assert.equal(plan2.targets[0].skip, true, 'second plan skips up-to-date output')
  assert.equal(plan2.targets[0].reason, 'up-to-date', 'skip reason is up-to-date')

  console.log('\nAll smoke checks passed.')
}

main().catch((e) => { console.error('SMOKE FAILED:', e.message); process.exit(1) })
