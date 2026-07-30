# @irgendutils/image-convert

Batch-convert JPG/PNG/TIFF/GIF/HEIC (and re-encode existing WebP/AVIF) into
**WebP and/or AVIF**, with optional resize, quality control, and a
verify-by-decoding step on every output. Dry-run by default — nothing is
written until you pass `--apply`, and originals are never touched unless you
also opt into `--delete-original`.

Not WordPress-specific — point it at a media-library export, a migration's
image folder, or any tree of images you want to shrink before it goes live.

## Install

```sh
cd image-convert
npm install
npm link          # optional, to get `image-convert` / `imgconv` on PATH
# or just: node src/cli.js <args>
```

## Usage

```sh
image-convert ./photos -r                          # preview: webp conversion of a tree
image-convert ./photos -r -f webp,avif --apply      # write both formats
image-convert hero.png -f avif -q 45 --max-width 1920 --apply
image-convert ./old-photos -r --apply --delete-original   # convert, then remove originals
```

### Options
```
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
```

Exit codes: `0` success, `1` no convertible inputs found or ≥1 encode failed,
`2` bad arguments.

## How it works

1. **Discover** — walk the given files/dirs (recursively with `-r`), keep only
   convertible extensions (`.jpg .jpeg .png .tif .tiff .webp .avif .gif .heic .heif`).
2. **Plan** — for each source × requested format, decide whether to convert or
   skip (same-file output, or output already newer than the source unless
   `--force`).
3. **Convert** (`--apply` only) — encode via [sharp](https://sharp.pixelplumbing.com/)
   (libvips) with your resize/quality/effort settings, then **re-open the
   written file and confirm it decodes** to the expected format at the
   expected dimensions before counting it as a success.
4. **Report** — per-file progress with size-saved percentage, then a summary
   (written / failed / skipped / deleted) and totals.

## Testing

```sh
npm test    # node --test — generates a real gradient PNG and round-trips it
            # through both webp and avif, checking dimensions, decode-ability,
            # resize, and idempotent skip-on-rerun behavior
```

## Notes

- AVIF output reports its container as `heif` when re-decoded (AVIF is AV1 in
  a HEIF container) — this is expected, not a bug.
- `--delete-original` is intentionally strict: it only removes a source once
  every format you asked for succeeded, and it refuses to run without
  `--apply`.
- Animated GIFs preserve animation when converted to WebP; AVIF output
  currently keeps only the first frame.
