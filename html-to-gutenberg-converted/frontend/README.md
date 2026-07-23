# HTML to Gutenberg Converter — Frontend

Converts HTML snippets or full pages into WordPress Gutenberg blocks, entirely
in the browser. Built per the docs in the project root
(`HTML_TO_GUTENBERG_BUILD_GUIDE.md` et al.).

## Run

```bash
npm install
npm run dev      # http://localhost:5173
```

```bash
npm test         # 35 unit tests (vitest)
npm run build    # type-check + production build
```

## How it works

```
HTML string
   │  HtmlParser (cheerio)          → HtmlNode tree (whitespace filtered)
   │  FlagDetector                  → flags SVG/canvas, forms, grid/flex,
   │                                  absolute positioning, event handlers
   │  BlockMapper (flag-aware)      → Gutenberg blocks; flagged sections
   │                                  become placeholders in document order
   │  collectWarnings               → heading-hierarchy, alt-text,
   │                                  relative-URL, animation warnings
   ▼
ConversionResult ──(user resolves flags: Group / Columns / Cover /
   │                Custom HTML / Skip)
   │  applyResolutions              → final block tree
   │  WpExporter                    → Block JSON  or  WordPress HTML
   ▼                                  (`<!-- wp:heading -->…` with real
Paste into WP editor                   inner HTML, editable blocks)
```

Key implementation notes (deviations from the guide's sample code, which had
bugs):

- **Parser** walks the htmlparser2 DOM directly — the guide's sample
  re-`require()`d cheerio per element, which breaks in browser bundles.
- **Exporter** emits real serialized inner HTML and strips the `core/` prefix
  in block comments (`wp:heading`, not `wp:core/heading`) — the guide's sample
  produced empty/invalid blocks on paste.
- **Flag detector** checks `styles.position` for absolute/fixed — the sample
  checked `styles.display` for those values, so it never matched.
- **Nested lists** use `core/list-item` inner blocks (Gutenberg 17+).
- **Flagged sections** become placeholders during mapping, so their content is
  never double-converted and their document position is preserved.

## Not yet built (Phase 2+)

- Full-site crawling (`/api/crawl`, needs the Express backend + Puppeteer)
- WordPress template reference matching
- Side-by-side visual block preview
