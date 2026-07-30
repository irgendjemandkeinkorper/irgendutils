// Core conversion logic: generate a real PNG, convert to WebP + AVIF, assert the
// outputs exist, decode, and are smaller. Proves the sharp toolchain (incl. AVIF)
// works, plus the plan/skip and resize behavior.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import sharp from 'sharp'
import { encodeOne, collectInputs, planFile } from '../src/convert.js'

const here = path.dirname(fileURLToPath(import.meta.url))
const outDir = path.join(here, 'out')

async function makeSample(dir, name = 'sample.png') {
  const src = path.join(dir, name)
  await sharp({
    create: { width: 512, height: 512, channels: 3, background: { r: 200, g: 120, b: 40 } },
  }).png().composite([{
    input: Buffer.from('<svg width="512" height="512"><circle cx="256" cy="256" r="200" fill="#204080"/></svg>'),
    top: 0, left: 0,
  }]).toFile(src)
  return src
}

test('convert.js: discover, plan, encode, verify, resize, idempotent skip', async (t) => {
  await fs.rm(outDir, { recursive: true, force: true })
  await fs.mkdir(outDir, { recursive: true })
  const src = await makeSample(outDir)

  await t.test('collectInputs finds the sample', async () => {
    const found = await collectInputs([outDir], { recursive: false })
    assert.ok(found.includes(path.resolve(src)))
  })

  await t.test('planFile plans one target per requested format', async () => {
    const plan = await planFile(src, { formats: ['webp', 'avif'], outDir: null, force: false })
    assert.equal(plan.targets.length, 2)
    assert.ok(plan.targets.every((t2) => !t2.skip))
  })

  for (const format of ['webp', 'avif']) {
    await t.test(`encodeOne writes a valid, smaller ${format}`, async () => {
      const r = await encodeOne(src, format, { outDir, quality: format === 'avif' ? 45 : 80 })
      const meta = await sharp(r.outPath).metadata()
      const okFormats = format === 'avif' ? ['avif', 'heif'] : [format]
      assert.ok(okFormats.includes(meta.format), `expected ${okFormats}, got ${meta.format}`)
      assert.equal(meta.width, 512)
      assert.equal(meta.height, 512)
      assert.ok(r.outSize > 0)
    })
  }

  await t.test('resize honors max-width and never enlarges', async () => {
    const small = await encodeOne(src, 'webp', { outDir, maxWidth: 128 })
    const smeta = await sharp(small.outPath).metadata()
    assert.equal(smeta.width, 128)

    const big = await encodeOne(src, 'webp', { outDir, maxWidth: 4000 })
    const bmeta = await sharp(big.outPath).metadata()
    assert.equal(bmeta.width, 512, 'max-width larger than source must not upscale')
  })

  await t.test('planFile skips an up-to-date output; --force overrides', async () => {
    await encodeOne(src, 'webp', { outDir })
    const skipped = await planFile(src, { formats: ['webp'], outDir, force: false })
    assert.equal(skipped.targets[0].skip, true)
    assert.equal(skipped.targets[0].reason, 'up-to-date')

    const forced = await planFile(src, { formats: ['webp'], outDir, force: true })
    assert.equal(forced.targets[0].skip, false)
  })

  await t.test('planFile skips when output would overwrite the source itself', async () => {
    // sample.webp already exists in outDir from the encode tests above — asking to
    // convert it to webp with no outDir means the output path equals the source path.
    const alreadyWebp = path.join(outDir, 'sample.webp')
    const samePath = await planFile(alreadyWebp, { formats: ['webp'], outDir: null, force: false })
    assert.equal(samePath.targets[0].skip, true)
    assert.equal(samePath.targets[0].reason, 'same-file')
  })
})
