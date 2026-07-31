# @irgendutils/content-freshness-report

Analyze a scraper manifest or sitemap-backed crawl to create a recurring editorial maintenance backlog. It identifies pages with stale or unknown dates, thin substantive content, weak heading structures, duplicate metadata, and pages with no inbound links (orphans).

## Key Features

- **Multi-source Analysis:** Supports site-migration-scraper outputs (directories containing `manifest.json` and a `pages/` directory with `meta.json`/`content.md` per page) or single sitemap-backed JSON manifest files.
- **Substantive Word Counting:** Counts words in the core body content, ensuring navigation, headers, footers, and other layout boilerplate are ignored.
- **Robust Freshness Checks:** Flags stale pages based on modified/publish dates, but classifies missing or invalid dates as "unknown" rather than stale.
- **Heading Structure Evaluation:** Flags missing/multiple H1s, non-sequential heading levels, and empty heading structures.
- **Link Graph & Orphan Pages:** Analyzes internal link mappings to detect pages with no inbound links, while exempting configured entry pages (e.g. `/`, `/home`).
- **Priority Scoring:** Ranks findings and pages based on a clear, documented scoring system.
- **Deterministic Snapshot Comparisons:** Compare findings with a previous run's JSON snapshot to identify new, resolved, and unchanged issues.
- **Formats:** Emits highly readable HTML, Markdown, JSON, and CSV.

## Install

Requires Node.js ≥ 18.

```sh
cd content-freshness-report
npm install
npm link                               # optional: `freshness` on PATH
# or run directly:
node src/cli.js
```

## Quickstart

1. **Run against scraper output:**
   ```sh
   node src/cli.js run ./out/my-site-slug
   ```
2. **Configure custom thresholds and exclusions:**
   Create a `freshness.config.yml`:
   ```yaml
   defaults:
     freshness_threshold_days: 365
     thin_content_threshold: 300
     entry_pages:
       - "/"
       - "/index.html"
       - "/home"

   rules:
     - path: "^/privacy-policy$"
       exclude: true
     - path: "^/archive/.*"
       freshness_threshold_days: 1000
       thin_content_threshold: 100
     - path: "^/blog/.*"
       thin_content_threshold: 500
   ```
   Execute the audit:
   ```sh
   node src/cli.js run ./out/my-site-slug --config freshness.config.yml
   ```
3. **Compare snapshots:**
   ```sh
   node src/cli.js run ./out/my-site-slug --compare report/report.json
   ```

## Priority Scores

The tool calculates a Page Priority Score by summing active finding priorities.

| Finding Type | Score | Severity | Description |
|---|---|---|---|
| Orphan Page | 100 | Critical | The page has no inbound links from other crawled pages (and is not a configured entry page). |
| Duplicate Title | 80 | High | Multiple pages have the exact same title. |
| Duplicate Meta Description | 60 | Medium-High | Multiple pages have the exact same meta description. |
| Stale Content | 50 | Medium | Last modified/publish date is older than the threshold. |
| Multiple H1s | 40 | Medium | The page has more than one H1 heading. |
| Missing H1 | 40 | Medium | The page has no H1 headings. |
| Thin Content | 30 | Medium-Low | Word count of core content is below the threshold. |
| Non-Sequential Headings | 20 | Low | Headings skip levels (e.g., H2 followed by H4). |
| No Headings | 20 | Low | The page has no headings. |
| Unknown Date | 10 | Low | Last modified/publish date is missing or invalid. |

## Outputs

The tool writes reports to the output folder (default: `report`):
- `report.html`: Interactive editorial dashboard.
- `report.md`: Markdown summary and tables.
- `report.json`: Comprehensive data structure with all findings and metadata.
- `report.csv`: Tabular spreadsheet format listing every flagged page and issue.
