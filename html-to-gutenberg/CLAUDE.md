# CLAUDE.md — HTML → Gutenberg Blocks (single page)

Convert a chunk of static HTML into **valid Gutenberg block markup** (paste into the
block editor or push via REST) — one page at a time — then render it in a real editor
via Playwright to confirm it parses with no "block recovery" errors.

## Architecture map
- **Stack:** Node ESM CLI (`node >=18`). Entry: `src/cli.js` (bin `h2g`).
- **Pipeline:** `src/htmlparser.js` (parse) → `src/normalize.js` (strip scripts,
  resolve URLs, whitespace) → `src/convert.js` (walk DOM → blocks per mapping table) →
  `src/grammar.js` (serialize canonical `<!-- wp:… -->` block markup) →
  `src/push.js` (WP-CLI `wp post create` / REST `/wp/v2/pages`) →
  `src/verify.js` (Playwright render check).
- **Support:** `src/media.js` (import to media library / link external),
  `src/report.js` (block counts + fallbacks), `src/config.js` (`h2g.config.example.yml`).
- **Where NOT to look:** `node_modules/`, generated `blocks.html`/reports.

## Deeper context lives in the vault
Durable knowledge (block-attr edge cases, mapping decisions) goes in the Obsidian
vault under `vault/`. Open the matching note before reading source.

## Mapping table (in `src/convert.js` — keep extensible)
`h1–h6`→`core/heading` (level) · `p`→`core/paragraph` · `ul`/`ol`→`core/list`(+item) ·
`img`/`figure>img`→`core/image`(+caption) · `a.button`/`.btn`→`core/button(s)` ·
`blockquote`→`core/quote` · `pre>code`→`core/code` · `hr`→`core/separator` ·
`table`→`core/table` · column sections→`core/columns`+`core/column` ·
`video`/`iframe`→`core/embed`|`core/video` · unmappable soup→`core/html` (LAST RESORT, log it).

## Key commands
```
h2g convert input.html -o blocks.html         # just the block markup
h2g convert input.html --push --status draft   # create the WP page
h2g convert input.html --media import          # pull images into WP (else link)
h2g verify <page-url-or-id>                    # render check only
npm test                                       # node --test
```

## Conventions / house rules
- Output must be **canonical Gutenberg block grammar** — correct attr JSON + expected
  inner HTML. Prefer core blocks; emit `core/html` only as a last resort and flag it.
- **Lossless intent, not lossless markup:** map semantic HTML to the right block, don't
  wrap raw HTML.
- **Single page only** — no crawler here (bulk migration is site-migration-scraper).
- **Verify by rendering, never by eyeballing the string.** Playwright asserts: zero
  block-recovery / "invalid content" warnings (primary pass/fail); block counts match
  the report; front end no console errors, images load, heading order preserved.
- Acceptance: a fixture round-trips with zero invalid-block warnings and zero
  `core/html` fallbacks (or each logged with a reason); re-conversion is deterministic;
  all images resolve, alt/captions survive.

## Gotchas
- Block attr JSON must be valid + minimal — extra/misnamed attrs trigger recovery mode;
  when unsure of an attr, omit it and let defaults apply.
- Inline styles don't map cleanly — decide per-project: drop, translate to block
  supports, or `core/html`.
- The editor needs auth — Application Password or a logged-in Playwright storage state;
  never commit it.
- Nested columns/grids are the most error-prone mapping — cover them in fixtures.

## Do NOT
- Don't edit this file mid-task (breaks the prompt cache). Don't emit `core/html`
  silently. Don't build a crawler. Don't reformat outside task scope.
