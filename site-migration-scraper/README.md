# @irgendutils/site-migration-scraper

Crawl a legacy source site (such as an old CMS or a static HTML site) and extract each page's core content as clean, normalized HTML and Markdown, along with structured metadata. It strips away navigation bars, sidebars, ads, headers, and footers, leaving only high-value main body content.

Sits upstream of:
- **`html-to-gutenberg`**: The generated `content.html` of each scraped page acts as the perfect input for `h2g convert`.
- **`obsidian-vault-forge`**: The generated site-level `manifest.json` can be imported directly to scaffold a rich project documentation vault.

```
site-migration-scraper (site-migration-scraper)
             │ clean HTML          │ manifest
             ▼                     ▼
     html-to-gutenberg     obsidian-vault-forge
```

## Install

Requires Node.js ≥ 18 ESM, TypeScript, and Playwright.

```sh
cd site-migration-scraper
npm install
npx playwright install chromium
npm link                               # optional: `scrape` on PATH
# or just: npx ts-node src/cli.ts
```

## Quickstart

1. **Configure:** Create a configuration file (e.g., `scrape.yml`) containing the target rules:
   ```yaml
   start_urls: [https://old.example.com]
   allow_domains: [old.example.com]
   max_pages: 50
   max_depth: 3
   content_selector: "main, article, .entry-content"
   strip_selectors: ["nav", "footer", ".sidebar", ".ads", ".cookie-banner"]
   output: ./out/old-site-slug/
   formats: [html, markdown, json]
   ```
2. **Crawl & Scraping Run:** Execute the crawl of the target site:
   ```sh
   scrape run -c scrape.yml
   ```
3. **Single Page Probe:** Test extraction rules on a single page before running a full crawl:
   ```sh
   scrape run https://old.example.com/about-us --single -c scrape.yml
   ```

## Commands

```sh
scrape run                            # full crawl using default config.yml
scrape run <url> --single             # scrapers a single page only
scrape manifest --graph               # analyzes results to output link graph + redirect map
```

Useful flags:
- `-c, --config <file>`: path to config file
- `-o, --out <dir>`: override output directory
- `--single`: skip crawling and extract only the single provided URL
- `--depth <n>`: maximum crawl depth
- `--pages <n>`: maximum total crawled pages

## Output Structure

The scraper outputs plain, deterministic files inside your designated output directory, organized by URL slug:

```
out/<slug>/
  manifest.json              # site-level summary (URL list, link graph, media list, redirect map)
  pages/
    about-us/
      content.html           # main body text as clean HTML (ready for html-to-gutenberg)
      content.md             # main body text as readable Markdown
      meta.json              # page-level metadata (title, slug, headings, images, links)
    blog/hello-world/
      content.html
      content.md
      meta.json
```

### The `manifest.json` Schema
Emits a comprehensive site map:
- **URL List:** All successfully scraped internal paths.
- **Link Graph:** A parent-child and cross-reference tree of internal links.
- **Image Inventory:** A consolidated list of images, their dimensions, alternative text, and where they were referenced.
- **Redirect Map:** A generated mapping of `old path` → `proposed new path` (useful for configuring redirects during migration).

## The Extraction Pipeline

For every visited page, the scraper orchestrates these operations:
1. **Render:** Loads the page in a headless Playwright browser to resolve Client-side JavaScript (SPAs), hydration, and lazy-loaded assets.
2. **Isolate Content:** Employs readability-style heuristics alongside the custom `content_selector` to locate the main content wrapper.
3. **Boilerplate Stripping:** Purges all nodes matching the CSS rules in `strip_selectors` (e.g. cookie notices, sidebars, social widgets).
4. **Normalize:** Resolves all relative URLs (anchors and image sources) into absolute URLs. Normalizes whitespace, entities, and attributes.
5. **Serialize:** Formats the content cleanly into HTML and compiles it to semantic Markdown. Extracts metadata (headings list, image inventory, meta description).

## Conventions & Polite Crawling

- **Polite Crawling:** Honors `robots.txt` rules, includes a custom, identifiable User-Agent, and enforces a rate limit (`rate_limit_ms`) to avoid overwhelming the server.
- **Read-Only:** The scraper never logs in, registers accounts, or attempts to modify state on the source server.
- **Domain-Locked:** Will never follow off-site links; stays strictly within the declared `allow_domains`.
- **Deterministic:** Page names are hashed/slugified deterministically from their relative URL so subsequent scraping runs are diffable with standard git or directory comparison tools.

## Gotchas

- **Readability Limits:** Pages with highly unconventional layouts (e.g., heavy landing pages with zero actual text paragraphs) can sometimes trigger false-positives in readability algorithms. Always use a targeted `content_selector` override for these pages.
- **Infinite Loops:** Watch out for calendar widgets, dynamic pagination, and faceted filters. Always enforce reasonable `max_pages` and specify query-parameter denylists if needed.
