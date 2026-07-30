# CLAUDE.md — image-convert

Node CLI (`image-convert` / `imgconv`) that batch-converts raster images (JPG,
PNG, TIFF, GIF, HEIC, plus re-encoding existing WebP/AVIF) into WebP and/or
AVIF, with optional resize, quality control, and a verify-by-decoding step.
Dry-run by default; `--apply` to actually write. General-purpose — not
WordPress-specific — but sized for shrinking a media library or a migration's
image folder before it goes anywhere near a site.

## Architecture map
- **Stack:** Node ESM CLI (`bin: image-convert`/`imgconv` → `src/cli.js`). Uses
  **sharp** (libvips) for decode/encode — the justified Node exception here:
  there's no equivalent WP-CLI/PHP path for AVIF encoding.
- **Data flow:** `cli.js` (arg parsing, dry-run/apply orchestration, console
  output, exit code) → `convert.js`:
  - `collectInputs()` — walk files/dirs (optionally recursive), dedupe, filter
    to convertible extensions.
  - `planFile()` — per source, per requested format: decide `skip` (same-file
    output, or output newer than source and `--force` not set) vs. convert.
  - `encodeOne()` — sharp encode (+ optional resize/metadata strip), then
    re-open the written file and check its decoded format/dimensions before
    trusting it.
  - `pool()` — small bounded-concurrency runner driving the encode jobs.
- **Where NOT to look:** `node_modules/`, `test/out/` (generated fixture output).

## Deeper context lives in the vault
Durable knowledge (encoder quality/effort tradeoffs, format gotchas) belongs in
the monorepo Obsidian vault under `vault/`. Open the matching note before
reading source; keep transient "for this session" notes there, not here.

## Key flags (see `image-convert --help` for the full list)
```
image-convert <files-or-dirs...> [options]         # dry-run: prints the plan
image-convert <files-or-dirs...> --apply [options]  # actually writes

-f, --format <list>   webp,avif (default: webp)
-q, --quality <n>     per-run override (defaults: webp 80, avif 50)
    --max-width/-height <n>   downscale only, never enlarges
-o, --out <dir>       flat output dir (default: alongside each source)
-r, --recursive       recurse into subdirectories
    --force            reconvert even if output is newer than source
    --delete-original  delete source once ALL its requested outputs succeed (needs --apply)
```

## Conventions
- **Dry-run by default**, matching every other app in this repo — `--apply` to
  write, nothing is ever deleted without both `--apply` and `--delete-original`.
- **Verify, don't assume:** every encode is re-opened and its decoded
  format/dimensions checked before the job counts as a success.
- `sharp.cache(false)` is deliberate (see `convert.js` comment) — this is a
  one-shot batch process, and libvips' operation cache can return a stale
  result if the same source is re-encoded within one run.
- `pool()` bounds concurrency to `--concurrency`/CPU-core-count; don't remove
  the bound even for "just a few files."

## Gotchas
- sharp reports an AVIF file's container as `heif` (AVIF = AV1-in-HEIF) — the
  verify step accepts both `avif` and `heif`, don't tighten that to `avif` only.
- `--delete-original` only deletes a source once **every** requested format for
  it succeeded — a partial failure (e.g. webp ok, avif failed) must leave the
  original in place.
- Up-to-date skip compares mtimes; a source touched without content changes
  (e.g. `git checkout`) can cause an unwanted re-encode — `--force` bypasses,
  never silently "fixes" this by hashing content (adds cost with little payoff
  at this app's scale).
- Animation is preserved only for WebP output (`animated: format === 'webp'`
  in `encodeOne`); AVIF animation support in sharp/libvips is inconsistent, so
  animated sources encoded to AVIF currently just get the first frame — flag
  this to a user converting GIFs to AVIF rather than silently dropping frames.

## Working agreement (token discipline)
- Use this map before grepping `src/`. When I name a function, start there —
  `convert.js` is small and pure; read the whole file only when editing it.
- Side investigations go to a subagent.

## Do NOT
- Don't edit this file mid-task (invalidates the prompt cache from here rightward).
- Don't make `--delete-original` implicit or default-on under any flag combination.
- Don't add a config-file layer — this app's whole surface is CLI flags; keep it
  that way unless a real multi-project use case demands otherwise.
- Don't reformat/mass-rename outside the task's scope.
