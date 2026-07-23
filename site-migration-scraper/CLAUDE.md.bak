# CLAUDE.md — Site Migration Scraper  (brainstorm pick #1)

## Why this one
It sits upstream of two apps you already want: it turns an existing/legacy site
into **clean, structured content** that feeds the **HTML→Gutenberg** converter and
seeds an **Obsidian vault** with the site inventory. It's the "get the old content
out cleanly" step that every WordPress rebuild needs.

## What it does
Crawl a source site (old CMS, static HTML, or a competitor page you're rebuilding)
and extract each page's **main content** as clean HTML/Markdown + a metadata
manifest (title, slug, meta description, images, internal link graph). Deliberately
strips nav/ads/boilerplate so what's left is body content ready for conversion.

## Shared house rules
- **Stack:** **Node/TypeScript** + **Playwright** (handles JS-rendered pages that a
  plain fetch would miss). Output is plain files (HTML/MD/JSON) — no DB.
- **Read-only + polite.** Respect `robots.txt`, rate-limit, set a real user agent,
  and cap crawl depth/pages via config. This never logs into or mutates the source.
- Deterministic output filenames keyed to URL slug so re-runs are diffable.
- Only crawl domains explicitly listed in config — never follow off-site links.

## Config
```yaml
start_urls: [https://old.example.com]
allow_domains: [old.example.com]
max_pages: 200
max_depth: 4
rate_limit_ms: 800
content_selector: "main, article, .entry-content"   # main-content hint
strip_selectors: ["nav", "footer", ".ads", ".cookie"]
output: ./out/<slug>/
formats: [html, markdown, json]
```

## Workflow
1. Crawl from `start_urls`, staying within `allow_domains`, honoring depth/page
   caps and rate limit.
2. For each page: render, isolate main content (readability heuristic + the
   `content_selector` hint), strip `strip_selectors`, and normalize (absolute URLs,
   deduped whitespace).
3. Emit per page: `content.html`, `content.md`, and `meta.json` (title, slug, meta
   desc, canonical, h1, image list with alt text, outbound internal links).
4. Emit a site-level `manifest.json`: full URL list, the internal link graph, an
   image inventory, and a redirect map (old path → proposed new path).
5. **Handoff:** the per-page `content.html` is valid input for `h2g convert`; the
   `manifest.json` drops straight into `obsidian-vault-forge`'s Site Inventory.

## Key commands
```
scrape run                      # full crawl per config
scrape run <url> --single       # one page only
scrape manifest --graph         # emit link graph + redirect map
```

## Acceptance criteria
- Main-content extraction on a fixture page keeps the body and drops nav/footer
  (assert known boilerplate strings are absent, known body strings present).
- Every page in `manifest.json` has a reachable output file; counts match.
- Redirect map has no duplicate source paths and no self-redirects.
- Re-running produces identical output for unchanged pages.

## Gotchas
- Readability heuristics fail on unusual layouts — always allow the per-site
  `content_selector` override.
- Infinite crawls via calendars/faceted params — enforce max_pages AND a
  query-param denylist.
- Don't scrape sites you don't have rights to rebuild; keep this pointed at the
  client's own properties.
