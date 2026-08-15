# CLAUDE.md — Content Freshness Report

Analyze a scraper manifest or sitemap-backed crawl to create a recurring editorial maintenance backlog.
Flags stale/unknown dates, thin substantive content, weak heading structure, duplicate metadata, and pages with no inbound links (orphans).
Supports excludes and thresholds by content type/path, prioritizes findings by score, and compares snapshots.

## Architecture map

- **Stack:** Node ESM orchestrator (`bin: freshness → src/cli.js`) that processes local manifest/scraper outputs and generates reports. Offline, read-only.
- **Data flow:** `cli.js run <path>` → loads config via `config.js` (+ `yaml.js`) → runs analysis in `analyzer.js` → formats findings in `report.js` → writes HTML/MD/JSON/CSV outputs.
- **Core modules:**
  - `src/cli.js` — Command-line interface and entry dispatch.
  - `src/config.js` — Loads configuration, merges defaults, and matches path rules.
  - `src/yaml.js` — Minimal, lightweight YAML loader.
  - `src/analyzer.js` — Main logic for directory/file crawling, word counting, date parsing, heading structure validation, metadata duplicate checking, link-graph orphan detection, and priority scoring.
  - `src/report.js` — Renders HTML, Markdown, JSON, and CSV reports, and performs deterministic snapshot comparisons.
- **Where NOT to look:** `node_modules/`, `report/`, `fixtures/`, `test/`.

## Key commands
```sh
freshness run <dir-or-manifest>                     # run audit against folder or manifest JSON
freshness run <dir> --config freshness.config.yml   # run with custom rules config
freshness run <dir> --compare prior-report.json      # run and compare with prior snapshot
node --test                                         # run test suite
```

## Conventions
- **Read-Only & Offline:** Never fetches or modifies anything online; operates entirely on locally saved scraper/crawler artifacts.
- **Determinism:** Date comparisons use an optional `--current-date` or default to a stable Date, and snapshot comparisons are fully deterministic using unique finding hashes.
- **Substantive Content:** Thin-content counts use parsed/cleaned words from core content, completely excluding headers, footer, navigation, and other template boilerplate.
- **Unreliable Dates:** If publish/modified dates are missing or invalid, they are flagged as "unknown", NOT stale.

## Do NOT
- Don't edit this file mid-task (prompt caching rule).
- Don't import bulky npm libraries (like `lodash` or `cheerio`) unless absolutely necessary. Stick to Node's built-ins.
- Don't skip verification. Each step of implementation must be verified.
