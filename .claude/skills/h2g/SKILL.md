---
name: h2g
description: Convert a static HTML page into canonical Gutenberg block markup with html-to-gutenberg, optionally push it to WordPress as a draft and render-verify it in the real block editor. Use when asked to convert HTML to blocks/Gutenberg or migrate a page into WordPress.
---

# HTML → Gutenberg blocks (one page)

Runs from `html-to-gutenberg/`. Args (ask if missing): **input HTML file**;
optionally **target site** (must match `wp.base_url` in the gitignored
`h2g.config.yml`), **push?** (default: yes, as draft), **title**, **media mode**
(`link` default | `import` uploads images to the WP media library).

Site specifics live in `h2g.config.yml` + `.env` (never hardcode):
`WP_USER`/`WP_APP_PASSWORD` for REST push, `H2G_EDITOR_USER`/`H2G_EDITOR_PASSWORD`
for verify — that one needs a REAL wp-admin login (Application Passwords do not
work on wp-login.php), so the editor user must have a role on the target site.

## Steps

1. **Preflight:** `h2g.config.yml`, `.env`, `node_modules/` exist (else
   `npm install` — Playwright reuses wp-qa's browser cache). Input file exists.
2. **Convert only, review the report first:**
   `node src/cli.js convert <input.html> -o out/blocks.html`
   Inspect the printed report: `grammar warnings` must be 0; every `core/html`
   fallback and dropped node must be explainable (tracking scripts and layout
   junk are fine to drop; real content is not). If content is falling back,
   fix the mapping or flag it to the user — never push silently degraded
   markup (house rule).
3. **Push as draft:** re-run with `--push` (add `--title`, `--status`,
   `--media import` as needed). Never `--status publish` unless explicitly
   asked.
4. **Render-verify — mandatory before calling it done:**
   `node src/cli.js verify <page-id> --expect out/blocks.html.report.json`
   Must print `VERIFY PASS` (zero invalid blocks, editor block counts equal
   the report, no console errors). A FAIL means the markup triggers block
   recovery — diagnose the block named in the output; do not hand-edit the
   page in WP to make it pass.
5. **Report:** page id, front-end URL, editor URL, block counts, any
   fallbacks with reasons. The page is a draft — publishing is the user's
   call.

Bulk migration is NOT this skill — that's site-migration-scraper feeding this
converter one page at a time.
