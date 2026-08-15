# @irgendutils/migration-redirect-generator

A Node.js ESM CLI tool to generate and validate reviewable redirect maps from site migration crawl manifests before launching.

## Workflow Integration

This tool sits at the end of the site migration workflow, bridging the gap between scraping/content conversion and site launch:

```text
site-migration-scraper (manifest/crawl results)
                  │
                  ▼
    migration-redirect-generator (Propose matches, validate, detect loops/chains/collisions)
                  │
                  ├──► JSON/CSV reviewable redirect maps
                  └──► Server configuration rules (Apache .htaccess, Nginx rewrite/map)
```

1. **Scrape:** Use `site-migration-scraper` to crawl the legacy site and generate a source `manifest.json`.
2. **Generate:** Run `redirect-gen generate` to compare the old URLs against your new sitemap/manifest. It will propose matches based on slugs, canonicals, titles, and paths, flagging ambiguous ones for review.
3. **Review/Override:** Manually review any ambiguous or missing matches and provide overrides in a simple JSON/CSV file.
4. **Validate:** Run `redirect-gen validate` to ensure there are no redirect loops, multi-hop chains, or collisions. Use the optional `--verify` flag to check live destinations over HTTP.
5. **Configure:** Deploy the safely escaped Apache `.htaccess` rules or Nginx rewrite/map rules directly to your web server.

## Installation

```sh
cd migration-redirect-generator
npm install
npm link
```

## Commands

### 1. Generate Redirect Map and Rules

```sh
redirect-gen generate \
  --source path/to/source-manifest.json \
  --destination path/to/destination-sitemap.xml \
  --overrides path/to/manual-overrides.csv \
  --out path/to/output-dir
```

Options:
- `-s, --source <file>`: (Required) Path to the legacy crawl manifest JSON.
- `-d, --destination <file>`: (Optional) Path to the new sitemap XML or sitemap JSON manifest.
- `-ov, --overrides <file>`: (Optional) Path to manual overrides (JSON or CSV file).
- `-o, --out <dir>`: (Optional) Path to the directory where results will be written. Defaults to `./out`.

### 2. Validate Redirect Map

```sh
redirect-gen validate --map path/to/redirect-map.json --verify
```

Options:
- `-m, --map <file>`: (Required) Path to the generated redirect map JSON file.
- `-v, --verify`: (Optional) Read-only HTTP validation to verify destinations are alive (return HTTP 200).

## Features

- **Normalization:** Paths are normalized for trailing slashes, queries, case, and Unicode NFC/percent-encoding.
- **Deterministic Match Classification:**
  - `exact`: Exact path match (normalized).
  - `confident`: Match via canonical, slug, or title.
  - `ambiguous`: Flagged for review when multiple destinations match a single source. Never silently chosen.
  - `missing`: No target match found.
- **Transitive Graph Resolution:** Automatically flattens multi-hop redirect chains (e.g. A -> B -> C becomes A -> C), while identifying and warning about the chain.
- **Safety Checks:** Detects infinite loops (A -> B -> A), collisions (multiple rules/targets for the same source URL), and unsafe regular expressions.
- **Deterministic & Safe Server Rules:** Escapes regex patterns and target paths for Apache `.htaccess` and Nginx rules safely.

## License

MIT
