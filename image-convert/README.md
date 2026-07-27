# @irgendutils/image-convert

A lightweight, extremely fast batch image optimizer and converter. Converts popular formats (JPG, PNG, TIFF, HEIC, etc.) into highly optimized **WebP** and/or **AVIF** formats. It supports smart resizing, quality scaling, automatic post-write verification, and concurrency limits.

**Dry-run by default (safety first).** Omit the `--apply` flag to preview conversion changes, path mappings, and estimated sizes without writing any files. Source images are never altered or deleted unless you explicitly request deletion with `--delete-original --apply`.

## Install

Requires Node.js ≥ 18 ESM. Built on top of the ultra-fast `sharp` image engine (libvips).

```sh
cd image-convert
npm install
npm link                               # optional: `image-convert` and `imgconv` on PATH
# or just: node src/cli.js
```

## Quickstart

1. **Dry-Run (Preview):** Scan and preview WebP conversion of a directory recursively:
   ```sh
   image-convert ./photos -r
   ```
2. **Apply Conversion (WebP):** Convert and save WebP files alongside their originals:
   ```sh
   image-convert ./photos -r --apply
   ```
3. **Dual Formats + Downscale:** Generate both WebP and AVIF files, constrained to a maximum width of 1920 pixels (visually lossless, highly compressed):
   ```sh
   image-convert hero.png -f webp,avif -q 80 --max-width 1920 --apply
   ```

## USAGE

```sh
image-convert <files-or-dirs...> [options]        # dry-run: displays the execution plan
image-convert <files-or-dirs...> --apply [options] # actually executes and writes
```

## Options

```
  -f, --format <list>    Output formats, comma-separated: webp,avif  (default: webp)
  -q, --quality <n>      Quality for all formats (default: webp 80, avif 50)
      --max-width <n>    Downscale so width  <= n (never enlarges smaller images)
      --max-height <n>   Downscale so height <= n (never enlarges smaller images)
  -o, --out <dir>        Write output files here (default: alongside each source)
  -r, --recursive        Recurse into subdirectories
      --effort <0-6>     Encoder effort/speed tradeoff; 0=fastest, 6=smallest (default: 4)
      --keep-metadata    Preserve EXIF, ICC profiles, and color-spaces (default: stripped)
  -c, --concurrency <n>  Parallel encode threads (default: CPU cores)
      --force            Reconvert even if target output is newer than source
      --delete-original  Delete source file after all its outputs write successfully (needs --apply)
      --apply            Perform the conversion (must be passed to write files)
      --quiet            Suppress per-file logs; only print the final statistics summary
  -h, --help             Show the help prompt
```

## Features

### 1. Supported Input Formats
Decodes any raster image format supported by `sharp` including:
`.jpg`, `.jpeg`, `.png`, `.tif`, `.tiff`, `.webp`, `.avif`, `.gif` (including animations), `.heic`, and `.heif`.

### 2. Multi-Format Planning
Specify multiple output targets simultaneously. The utility will build an execution queue and output formats accordingly:
```sh
image-convert logo.png -f webp,avif --apply
# Generates both logo.webp and logo.avif
```

### 3. Smart Aspect-Ratio Downscaling
Specify `--max-width` or `--max-height`. The engine scales images to fit **inside** those boundaries while preserving the exact original aspect ratio. It features a safety mechanism that **never enlarges** small images, preventing pixelation.

### 4. Automated Post-Write Verification
Every generated file is immediately re-opened by `sharp` post-write. The utility validates that the container is readable, metadata registers correctly, and width/height dimensions match the conversion plan, throwing errors if corruption is found.

### 5. Idempotent & Fast
Skipped files save significant CPU. If you re-run the converter over directories, it automatically compares timestamps and skips files that are already up-to-date, unless `--force` is specified.

### 6. Original Deletion (Clean Migrations)
Ideal for migrating massive libraries. When `--delete-original` is combined with `--apply`, `image-convert` deletes the original source file **only** after *all* requested outputs (e.g., both WebP and AVIF) have successfully written and passed verification.

## Performance & Optimization Defaults

- **AVIF quality defaults to `50`**: The AVIF quality scale is non-linear compared to JPG/WebP. A quality of `50` yields excellent compression ratios with visually lossless results.
- **WebP quality defaults to `80`**: Standard balance of visual fidelity and byte size.
- **Cache Disabled**: Libvips' internal cache is disabled during conversion to prevent stale pipeline issues during single-batch re-runs.

## Smoke Testing

To run the built-in end-to-end smoke test suite (verifies PNG generation, encoding, resizing, and idempotency states):

```sh
npm test
```
