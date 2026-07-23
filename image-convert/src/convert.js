// Core conversion logic for @irgendutils/image-convert.
// Pure-ish module: no process.exit, no arg parsing — just functions the CLI drives.
// Encoding is handled by sharp (libvips); we support WebP and AVIF output.

import fs from 'node:fs/promises'
import path from 'node:path'
import sharp from 'sharp'

// Disable libvips' operation cache: this is a one-shot batch process (each file is
// encoded once), and the cache can otherwise return a stale pipeline result when the
// same source is re-encoded in one run. No benefit here, real correctness risk.
sharp.cache(false)

// Raster inputs sharp can decode that make sense to re-encode to webp/avif.
export const INPUT_EXTS = new Set([
  '.jpg', '.jpeg', '.png', '.tif', '.tiff', '.webp', '.avif', '.gif', '.heic', '.heif',
])

export const OUTPUT_FORMATS = new Set(['webp', 'avif'])

// Per-format default quality (sensible, visually-lossless-ish, weight-conscious).
// AVIF's quality scale is not the same as WebP's; ~50 is a good default.
const DEFAULT_QUALITY = { webp: 80, avif: 50 }

export function humanBytes(n) {
  if (n < 1024) return `${n} B`
  const u = ['KB', 'MB', 'GB']
  let i = -1
  do { n /= 1024; i++ } while (n >= 1024 && i < u.length - 1)
  return `${n.toFixed(n < 10 ? 1 : 0)} ${u[i]}`
}

// Recursively collect image files from a list of files/dirs.
export async function collectInputs(inputPaths, { recursive } = {}) {
  const out = []
  const seen = new Set()
  for (const p of inputPaths) {
    let st
    try { st = await fs.stat(p) } catch { throw new Error(`Input not found: ${p}`) }
    if (st.isDirectory()) {
      await walkDir(p, recursive, out, seen)
    } else if (st.isFile() && isConvertibleInput(p)) {
      addUnique(out, seen, path.resolve(p))
    }
  }
  return out
}

async function walkDir(dir, recursive, out, seen) {
  const entries = await fs.readdir(dir, { withFileTypes: true })
  for (const e of entries) {
    const full = path.join(dir, e.name)
    if (e.isDirectory()) {
      if (recursive) await walkDir(full, recursive, out, seen)
    } else if (e.isFile() && isConvertibleInput(full)) {
      addUnique(out, seen, path.resolve(full))
    }
  }
}

function addUnique(out, seen, resolved) {
  if (!seen.has(resolved)) { seen.add(resolved); out.push(resolved) }
}

export function isConvertibleInput(file) {
  return INPUT_EXTS.has(path.extname(file).toLowerCase())
}

// Where each output lands. Alongside the source by default; into outDir (flat) if given.
export function outputPathFor(srcFile, format, outDir) {
  const base = path.basename(srcFile, path.extname(srcFile)) + '.' + format
  return outDir ? path.join(outDir, base) : path.join(path.dirname(srcFile), base)
}

// Skip when the output already exists and is at least as new as the source.
async function isUpToDate(srcFile, outPath) {
  try {
    const [s, o] = await Promise.all([fs.stat(srcFile), fs.stat(outPath)])
    return o.mtimeMs >= s.mtimeMs
  } catch {
    return false // output missing → not up to date
  }
}

// Build the plan for one source: one entry per requested format, marked skip/convert.
export async function planFile(srcFile, { formats, outDir, force }) {
  const srcSize = (await fs.stat(srcFile)).size
  const targets = []
  for (const format of formats) {
    const outPath = outputPathFor(srcFile, format, outDir)
    const sameFile = path.resolve(outPath) === path.resolve(srcFile)
    const upToDate = !force && (await isUpToDate(srcFile, outPath))
    targets.push({ format, outPath, skip: sameFile || upToDate, reason: sameFile ? 'same-file' : upToDate ? 'up-to-date' : null })
  }
  return { srcFile, srcSize, targets }
}

// Encode one source to one format, then re-open the result to prove it decodes.
export async function encodeOne(srcFile, format, { quality, maxWidth, maxHeight, keepMetadata, effort, outDir }) {
  const outPath = outputPathFor(srcFile, format, outDir)
  await fs.mkdir(path.dirname(outPath), { recursive: true })

  let img = sharp(srcFile, { animated: format === 'webp' }) // keep animation for webp when present
  if (keepMetadata) img = img.withMetadata()
  if (maxWidth || maxHeight) {
    img = img.resize({ width: maxWidth || null, height: maxHeight || null, fit: 'inside', withoutEnlargement: true })
  }
  const q = quality ?? DEFAULT_QUALITY[format]
  if (format === 'webp') img = img.webp({ quality: q, effort: effort ?? 4 })
  else if (format === 'avif') img = img.avif({ quality: q, effort: effort ?? 4 })

  const info = await img.toFile(outPath)

  // Verify: independently re-read the written file's metadata. Note sharp reports
  // an AVIF file's container as 'heif' (AVIF = AV1 in a HEIF container), so accept both.
  const okFormats = format === 'avif' ? ['avif', 'heif'] : [format]
  const meta = await sharp(outPath).metadata()
  if (!okFormats.includes(meta.format) || !meta.width) {
    throw new Error(`verification failed for ${outPath} (got format=${meta.format})`)
  }
  const outSize = (await fs.stat(outPath)).size
  return { format, outPath, width: info.width, height: info.height, outSize }
}

// Simple bounded-concurrency map.
export async function pool(items, limit, worker) {
  const results = new Array(items.length)
  let i = 0
  const runners = new Array(Math.min(limit, items.length || 1)).fill(0).map(async () => {
    while (i < items.length) {
      const idx = i++
      results[idx] = await worker(items[idx], idx)
    }
  })
  await Promise.all(runners)
  return results
}
