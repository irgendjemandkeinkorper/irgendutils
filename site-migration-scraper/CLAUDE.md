# CLAUDE.md — Site Migration Scraper

Crawl a source site (old CMS, static HTML, a page you're rebuilding) and extract each
page's **main content** as clean HTML/Markdown + a metadata manifest. Strips
nav/ads/boilerplate so what's left is body content ready for conversion. Sits upstream
of **html-to-gutenberg** (per-page `content.html` is valid `h2g convert` input) and
seeds **obsidian-vault-forge**'s site inventory (`manifest.json`).

## Architecture map
- **Stack:** Node/TypeScript + **Playwright** (handles JS-rendered pages a plain fetch
  would miss). Output is plain files (HTML/MD/JSON) — no DB. Planned CLI: `scrape`.
- **Status:** spec + scaffold stage — `src/`, `src/adapters/`, `test/` and
  `fixtures/site/` (about, blog) / `fixtures/broken/` dirs exist but are empty.
  Implement to the workflow below; a good-vs-broken fixture pair proves extraction.
- **Where NOT to look:** `node_modules/` (once added), generated `out/<slug>/`.

## Deeper context lives in the vault
Durable knowledge (readability-heuristic tuning, per-site selectors) goes in the
Obsidian vault under `vault/`. Open the matching note before reading source.

## Config
```yaml
start_urls: [https://old.example.com]
allow_domains: [old.example.com]
max_pages: 200
max_depth: 4
rate_limit_ms: 800
content_selector: "main, article, .entry-content"
strip_selectors: ["nav", "footer", ".ads", ".cookie"]
output: ./out/<slug>/
formats: [html, markdown, json]
```

## Workflow (to implement)
1. Crawl from `start_urls`, staying within `allow_domains`, honoring depth/page caps + rate limit.
2. Per page: render, isolate main content (readability heuristic + `content_selector`
   hint), strip `strip_selectors`, normalize (absolute URLs, deduped whitespace).
3. Emit per page: `content.html`, `content.md`, `meta.json` (title, slug, meta desc,
   canonical, h1, image list with alt, outbound internal links).
4. Emit site-level `manifest.json`: URL list, internal link graph, image inventory,
   redirect map (old path → proposed new path).
5. **Handoff:** `content.html` → `h2g convert`; `manifest.json` → obsidian-vault-forge.

## Key commands
```
scrape run                      # full crawl per config
scrape run <url> --single       # one page only
scrape manifest --graph         # emit link graph + redirect map
```

## Conventions / house rules
- **Read-only + polite:** respect `robots.txt`, rate-limit, real user agent, cap
  depth/pages. Never log into or mutate the source. Only crawl domains in
  `allow_domains` — never follow off-site links.
- Deterministic output filenames keyed to URL slug so re-runs are diffable.
- Verify: extraction keeps body + drops nav/footer (assert boilerplate strings absent,
  body strings present); every manifest page has a reachable output file (counts match);
  redirect map has no duplicate sources / self-redirects; re-runs are identical.

## Gotchas
- Readability fails on unusual layouts — always allow the per-site `content_selector` override.
- Infinite crawls via calendars/faceted params — enforce `max_pages` AND a query-param denylist.
- Don't scrape sites you don't have rights to rebuild; keep it on the client's own properties.

## Do NOT
- Don't edit this file mid-task (breaks the prompt cache). Don't crawl off-listed
  domains or ignore rate limits. Don't reformat outside task scope.
