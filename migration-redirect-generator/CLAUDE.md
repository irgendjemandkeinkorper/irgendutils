# CLAUDE.md — Migration Redirect Generator

Generate reviewable redirect maps from migration crawl manifests before launch, proposing deterministic matches, detecting issues (loops, chains, collisions), and emitting server rules (Apache, Nginx).

## Architecture map
- **Stack:** Node ESM CLI (`bin: redirect-gen → src/cli.js`). Built using standard Node ESM + `commander`.
- **Data flow:**
  - `cli.js generate` -> Loads source manifest (and optional destination manifest/sitemap & overrides) -> Proposes matches via `matcher.js` -> Classifies matches -> Emits CSV/JSON files and Apache/Nginx rewrite rules via `generator.js`.
  - `cli.js validate` -> Loads generated redirect map -> Verifies integrity via `validator.js` (detects loops, chains, collisions, unsafe regexes, external targets, and optionally verifies destinations over HTTP).
- **Core modules:**
  - `src/cli.js` — Entry / command registration and dispatch.
  - `src/engine/matcher.js` — Core path normalization, matching algorithms, and classification logic.
  - `src/engine/validator.js` — Redirect graph trace, cycle/loop/chain detection, conflict resolution, HTTP verification.
  - `src/engine/generator.js` — Safe escaping, formatting, and emission of CSV/JSON maps, Nginx rewrite/map config, and Apache `.htaccess` rules.

## Config & Files
- **Source manifest:** JSON containing an array of pages: `{ url, title, slug, canonical }`.
- **Destination manifest/sitemap:** Optional JSON manifest or standard sitemap XML containing destination URLs.
- **Overrides:** Optional JSON/CSV file mapping source path -> target path (or status e.g., 410 / "gone").

## Commands
```sh
redirect-gen generate --source <file> [--destination <file>] [--overrides <file>] [--out <dir>]
redirect-gen validate --map <file> [--verify]
```

## Conventions
- **Deterministic & Safe:** Never silently chooses ambiguous matches; always flags them for human review.
- **Strict Validation:** Non-zero exit for cycles/loops, broken HTTP destinations (when `--verify` is set), or unresolved required/critical URLs.
- **Idempotent, Reversible:** Does not mutate live servers by default; performs read-only validations.

## Do NOT
- Don't edit this file mid-task (breaks prompt cache).
- Don't assume destination URLs are valid without `--verify` check, but fail immediately on loops or duplicate rules.
