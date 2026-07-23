#!/usr/bin/env node
// @irgendutils/image-convert — batch-convert images to WebP and/or AVIF.
// Dry-run by default (repo convention): prints the plan and writes nothing until
// you pass --apply. Originals are never modified or deleted unless you opt in.

import { parseArgs } from 'node:util'
import os from 'node:os'
import path from 'node:path'
import fs from 'node:fs/promises'
import {
  collectInputs, planFile, encodeOne, pool, humanBytes, OUTPUT_FORMATS,
} from './convert.js'

const C = {
  reset: '\x1b[0m', dim: '\x1b[2m', red: '\x1b[31m', green: '\x1b[32m',
  yellow: '\x1b[33m', blue: '\x1b[34m', cyan: '\x1b[36m', bold: '\x1b[1m',
}
const paint = (s, c) => `${C[c] || ''}${s}${C.reset}`

const HELP = `${paint('image-convert', 'bold')} — batch convert images to WebP / AVIF

${paint('USAGE', 'yellow')}
  image-convert <files-or-dirs...> [options]        ${paint('# dry-run: shows the plan', 'dim')}
  image-convert <files-or-dirs...> --apply [options] ${paint('# actually writes', 'dim')}

${paint('OPTIONS', 'yellow')}
  -f, --format <list>    Output formats, comma-separated: webp,avif  (default: webp)
  -q, --quality <n>      Quality for all formats (default: webp 80, avif 50)
      --max-width <n>    Downscale so width  <= n (never enlarges)
      --max-height <n>   Downscale so height <= n (never enlarges)
  -o, --out <dir>        Write outputs here (default: alongside each source)
  -r, --recursive        Recurse into subdirectories
      --effort <0-6>     Encoder effort/speed tradeoff (default: 4)
      --keep-metadata    Preserve EXIF/ICC (default: stripped for size)
  -c, --concurrency <n>  Parallel encodes (default: # CPU cores)
      --force            Reconvert even if the output is newer than the source
      --delete-original  Delete each source after ALL its outputs succeed (needs --apply)
      --apply            Perform the conversion (omit for a dry run)
      --quiet            Only print the final summary
  -h, --help             Show this help

${paint('EXAMPLES', 'yellow')}
  image-convert ./photos -r                          ${paint('# preview webp conversion of a tree', 'dim')}
  image-convert ./photos -r -f webp,avif --apply     ${paint('# write both formats', 'dim')}
  image-convert hero.png -f avif -q 45 --max-width 1920 --apply
`

function parse() {
  const { values, positionals } = parseArgs({
    allowPositionals: true,
    options: {
      format: { type: 'string', short: 'f', default: 'webp' },
      quality: { type: 'string', short: 'q' },
      'max-width': { type: 'string' },
      'max-height': { type: 'string' },
      out: { type: 'string', short: 'o' },
      recursive: { type: 'boolean', short: 'r', default: false },
      effort: { type: 'string' },
      'keep-metadata': { type: 'boolean', default: false },
      concurrency: { type: 'string', short: 'c' },
      force: { type: 'boolean', default: false },
      'delete-original': { type: 'boolean', default: false },
      apply: { type: 'boolean', default: false },
      quiet: { type: 'boolean', default: false },
      help: { type: 'boolean', short: 'h', default: false },
    },
  })
  return { values, positionals }
}

function toInt(v, name) {
  if (v === undefined) return undefined
  const n = Number(v)
  if (!Number.isFinite(n) || n < 0) throw new Error(`--${name} must be a non-negative number (got "${v}")`)
  return Math.floor(n)
}

async function main() {
  let values, positionals
  try { ({ values, positionals } = parse()) }
  catch (e) { console.error(paint(`Error: ${e.message}`, 'red')); process.exit(2) }

  if (values.help || positionals.length === 0) {
    console.log(HELP)
    process.exit(positionals.length === 0 && !values.help ? 1 : 0)
  }

  const formats = values.format.split(',').map((s) => s.trim().toLowerCase()).filter(Boolean)
  const bad = formats.filter((f) => !OUTPUT_FORMATS.has(f))
  if (bad.length) {
    console.error(paint(`Error: unsupported format(s): ${bad.join(', ')}. Use webp and/or avif.`, 'red'))
    process.exit(2)
  }
  if (values['delete-original'] && !values.apply) {
    console.error(paint('Refusing --delete-original without --apply (dry runs never delete).', 'red'))
    process.exit(2)
  }

  const opts = {
    formats,
    outDir: values.out ? path.resolve(values.out) : null,
    quality: toInt(values.quality, 'quality'),
    maxWidth: toInt(values['max-width'], 'max-width'),
    maxHeight: toInt(values['max-height'], 'max-height'),
    effort: toInt(values.effort, 'effort'),
    keepMetadata: values['keep-metadata'],
    force: values.force,
  }
  const concurrency = toInt(values.concurrency, 'concurrency') || os.cpus().length || 4
  const log = values.quiet ? () => {} : (...a) => console.log(...a)

  // Discover inputs.
  let inputs
  try { inputs = await collectInputs(positionals, { recursive: values.recursive }) }
  catch (e) { console.error(paint(`Error: ${e.message}`, 'red')); process.exit(1) }

  if (inputs.length === 0) {
    console.error(paint('No convertible images found. Supported: jpg, png, tif, webp, avif, gif, heic.', 'yellow'))
    if (!values.recursive) console.error(paint('(Pass -r to recurse into subdirectories.)', 'dim'))
    process.exit(1)
  }

  if (opts.outDir) await fs.mkdir(opts.outDir, { recursive: true })

  // Build the plan.
  const plans = await Promise.all(inputs.map((f) => planFile(f, opts)))
  const jobs = []
  for (const plan of plans) {
    for (const t of plan.targets) {
      if (!t.skip) jobs.push({ srcFile: plan.srcFile, srcSize: plan.srcSize, format: t.format, outPath: t.outPath })
    }
  }
  const skipped = plans.flatMap((p) => p.targets.filter((t) => t.skip))

  const mode = values.apply ? paint('APPLY', 'green') : paint('DRY RUN', 'yellow')
  log(`\n${paint('image-convert', 'bold')}  ${mode}   ${inputs.length} source(s) → ${formats.join(' + ')}   ${paint(`(${jobs.length} to write, ${skipped.length} skipped)`, 'dim')}\n`)

  if (!values.apply) {
    for (const j of jobs) {
      log(`  ${paint('+', 'green')} ${rel(j.srcFile)} ${paint('→', 'dim')} ${rel(j.outPath)}`)
    }
    for (const s of skipped) log(`  ${paint('·', 'dim')} ${paint(`skip ${path.basename(s.outPath)} (${s.reason})`, 'dim')}`)
    log(`\n${paint('Dry run — nothing written.', 'yellow')} Re-run with ${paint('--apply', 'green')} to convert.`)
    return
  }

  // Convert.
  let ok = 0, failed = 0, origTotal = 0, outTotal = 0
  const results = await pool(jobs, concurrency, async (j) => {
    try {
      const r = await encodeOne(j.srcFile, j.format, opts)
      ok++
      const saved = 1 - r.outSize / j.srcSize
      log(`  ${paint('✓', 'green')} ${rel(r.outPath)}  ${paint(`${humanBytes(j.srcSize)} → ${humanBytes(r.outSize)}  (${(saved * 100).toFixed(0)}% smaller)`, saved >= 0 ? 'cyan' : 'yellow')}`)
      return { ...r, srcFile: j.srcFile, srcSize: j.srcSize }
    } catch (e) {
      failed++
      console.error(`  ${paint('✗', 'red')} ${rel(j.srcFile)} → ${j.format}: ${e.message}`)
      return { failed: true, srcFile: j.srcFile }
    }
  })

  // Optionally delete originals whose every requested output succeeded.
  let deleted = 0
  if (values['delete-original']) {
    for (const src of new Set(jobs.map((j) => j.srcFile))) {
      const wanted = jobs.filter((j) => j.srcFile === src).length
      const done = results.filter((r) => r && !r.failed && r.srcFile === src).length
      if (wanted === done) { await fs.rm(src); deleted++ }
    }
  }

  for (const r of results) if (r && !r.failed) { origTotal += r.srcSize; outTotal += r.outSize }
  const totalSaved = origTotal ? (1 - outTotal / origTotal) * 100 : 0

  log(`\n${paint('Done.', 'bold')}  ${paint(`${ok} written`, 'green')}${failed ? paint(`, ${failed} failed`, 'red') : ''}${skipped.length ? paint(`, ${skipped.length} skipped`, 'dim') : ''}${deleted ? paint(`, ${deleted} originals deleted`, 'yellow') : ''}`)
  if (ok) log(`${paint('Total:', 'dim')} ${humanBytes(origTotal)} → ${humanBytes(outTotal)}  ${paint(`(${totalSaved.toFixed(0)}% smaller)`, 'cyan')}`)
  if (failed) process.exit(1)
}

function rel(p) {
  const r = path.relative(process.cwd(), p)
  return r.startsWith('..') ? p : r
}

main().catch((e) => { console.error(paint(`Fatal: ${e.stack || e.message}`, 'red')); process.exit(1) })
