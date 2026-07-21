# CLAUDE.md — HTML → Gutenberg Blocks (single page)

## What this app does
Take a chunk of static HTML (a designed landing page, an exported page, a pasted
snippet) and convert it into **valid Gutenberg block markup** that can be pasted
into the WordPress block editor or pushed via REST — for a **single page** at a
time. Then render it in a real editor via Playwright to confirm it parses with no
"block recovery" errors and looks right.

## Shared house rules
- **Stack:** The converter core is best in **Node/TypeScript** (HTML parsing +
  block serialization). Pushing the result into WP uses **WP-CLI** (`wp post
  create`) or the **REST API** — support both. Playwright (TS) does the render
  verification.
- Output must be **canonical Gutenberg block grammar**: the `<!-- wp:block { ...
  attrs } -->` comment delimiters with correct attribute JSON and the expected
  inner HTML. Prefer **core blocks**; only emit `core/html` as a last resort and
  flag every time you do.
- **Lossless intent, not lossless markup.** Map semantic HTML to the right block,
  don't just wrap raw HTML. `<h2>`→`core/heading`, `<ul>`→`core/list`,
  `<figure><img>`→`core/image`, `<blockquote>`→`core/quote`, columns/grids→
  `core/columns`, etc.
- Single page only — do not build a crawler here. (Bulk/site migration is a
  separate app; this one is deliberately one-shot and high-fidelity.)
- Verify by rendering, never by eyeballing the string.

## Mapping table (implement + keep extensible)
| HTML | Block |
|------|-------|
| `h1–h6` | `core/heading` (with `level`) |
| `p` | `core/paragraph` |
| `ul` / `ol` | `core/list` (+ `core/list-item`) |
| `img`, `figure>img` | `core/image` (+ caption) |
| `a.button`, `.btn` | `core/button(s)` |
| `blockquote` | `core/quote` |
| `pre>code` | `core/code` |
| `hr` | `core/separator` |
| `table` | `core/table` |
| section with N children columns | `core/columns` + `core/column` |
| `<video>`/`<iframe>` (YouTube etc.) | `core/embed` or `core/video` |
| unknown / inline-styled soup | `core/html` (LAST RESORT — log it) |

## Workflow
1. **Parse + normalize** the input HTML (strip tracking scripts, normalize
   whitespace, resolve relative asset URLs to absolute or to a configured media
   base).
2. **Media handling:** for each `<img>`, either (a) upload to the WP media library
   (WP-CLI `wp media import` / REST `/wp/v2/media`) and reference the new
   attachment ID, or (b) keep the external URL — controlled by `--media import|link`.
   `core/image` should carry the resolved `id`/`url`.
3. **Walk the DOM** and emit blocks per the mapping table. Preserve heading order,
   alt text, captions, link targets.
4. **Serialize** to block markup and (optionally) create the page:
   `wp post create --post_type=page --post_status=draft` with the block content, or
   REST `POST /wp/v2/pages`.
5. **Render-verify with Playwright** (below).
6. Emit a **conversion report**: block counts, any `core/html` fallbacks, any
   dropped/unmapped nodes.

## Key commands
```
h2g convert input.html -o blocks.html        # just the block markup
h2g convert input.html --push --status draft  # create the WP page
h2g verify <page-url-or-id>                   # render check only
h2g convert input.html --media import         # pull images into WP
```

## Render verification (the important part)
Open the created draft in the block editor (or the front-end preview) with
Playwright and assert:
- **No block-recovery / "This block contains unexpected or invalid content"
  warnings** anywhere. This is the primary pass/fail signal.
- The block count and types in the editor match what the converter claims it wrote.
- Front-end render has no console errors, images load (no 404s), headings preserve
  their order/levels.
- Optional: pixel-diff the rendered front end against a screenshot of the original
  HTML to catch layout drift (reuse the QA app's diff util).

## Acceptance criteria
- A representative fixture page round-trips with **zero** invalid-block warnings and
  **zero** `core/html` fallbacks (or fallbacks only where truly unavoidable, each
  logged with a reason).
- Re-converting the same input is deterministic (identical output).
- All images resolve; alt text and captions survive.

## Gotchas
- Block attribute JSON must be valid and minimal — extra/misnamed attrs trigger
  recovery mode. When unsure of an attr, omit it and let defaults apply.
- Inline styles don't map cleanly to core blocks; decide per-project whether to
  drop them, translate to block supports (color/spacing), or fall back to
  `core/html`.
- The editor needs auth to open — use an Application Password or a logged-in
  Playwright storage state; never commit it.
- Nested columns/grids are the most error-prone mapping — cover them explicitly in
  fixtures.
