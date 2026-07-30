# @irgendutils/html-to-gutenberg

Convert a static HTML file into valid, canonical Gutenberg block markup (ready to paste into the block editor or push via REST) — then verify the conversion by rendering it in a real WordPress block editor via Playwright to ensure zero "block recovery" errors.

```
h2g convert input.html --push --status draft
# HTML parsed → normalized → mapped to core/heading + core/paragraph → page created (ID 42) → verified with Playwright!
```

## Install

Requires Node.js ≥ 18 ESM.

```sh
cd html-to-gutenberg
npm install
# Playwright is required only for the `verify` command
npx playwright install chromium
npm link                               # optional: `h2g` on PATH
# or just: node src/cli.js
```

## Quickstart

1. **Configure:** Copy `h2g.config.example.yml` to `h2g.config.yml` and adjust your target WordPress URL and credentials.
2. **Set secrets:** Create a `.env` file containing your WordPress credentials:
   ```env
   WP_APP_PASSWORD=xxxx xxxx xxxx xxxx xxxx xxxx
   WP_USER=automation
   ```
3. **Convert to local file:** Convert HTML to Gutenberg block markup without pushing to WordPress:
   ```sh
   h2g convert input.html -o blocks.html
   ```
4. **Push & Verify:** Convert, import referenced media, push as a draft page to WordPress, and render-verify it using Playwright:
   ```sh
   h2g convert input.html --push --status draft --media import --verify
   ```

## Commands

```sh
h2g convert <input.html> -o <output.html>     # convert input to block markup file
h2g convert <input.html> --push --status draft # create page/post in WP
h2g convert <input.html> --media import        # import images into WP media library
h2g verify <page-url-or-id>                    # render-verify an existing WP page
```

Useful flags:
- `-c, --config <file>`: path to config file (defaults to `h2g.config.yml`)
- `--push`: push conversion output directly to WordPress
- `--status <draft|publish>`: WordPress page status (default: `draft`)
- `--media <link|import>`: how to handle image sources (`link` or `import`)
- `--verify`: run Playwright render verification after pushing
- `--strict`: fail if any unmappable node falls back to `core/html` or is dropped

## Mapping Rules

The engine (`src/convert.js`) traverses the HTML DOM and maps elements to canonical Gutenberg block representations:

| HTML Element | Gutenberg Block | Details |
|--------------|-----------------|---------|
| `h1` – `h6` | `core/heading` | Preserves heading levels and IDs |
| `p` | `core/paragraph` | Retains basic inline styles (bold, italic, links) |
| `ul` / `ol` | `core/list` | Generates `core/list-item` children |
| `img` / `figure > img` | `core/image` | Retains alt text, captions, and classes |
| `a.button` / `.btn` | `core/buttons` + `core/button` | Maps button style components |
| `blockquote` | `core/quote` | Maps blockquotes and citations |
| `pre > code` | `core/code` | Preserves code formatting and syntax |
| `hr` | `core/separator` | Renders canonical separator block |
| `table` | `core/table` | Maps table headers, body, rows, and cells |
| grids / columns | `core/columns` + `core/column` | Maps column sections and nested structures |
| `video` / `iframe` | `core/embed` or `core/video` | Extracts media URLs and maps embeds |
| *unmappable elements* | `core/html` | Last resort fallback. Logs warnings |

## Config (`h2g.config.yml`)

```yaml
wp:
  mode: rest                         # rest | wpcli — how --push and --media talk to WP
  base_url: https://example.com      # REST base URL (can also be loaded via WP_BASE_URL env)
  wp_path: /var/www/example          # WP-CLI install path (for wpcli mode)

media:
  mode: link                         # link (keep external URLs) | import (upload to WP media library)
  base: https://example.com          # Base URL used to resolve relative src attributes in HTML

convert:
  strict: false                      # set true to exit non-zero on any fallback to core/html
```

## The Conversion Pipeline

1. **Parse:** `src/htmlparser.js` parses raw input HTML into a DOM tree.
2. **Normalize:** `src/normalize.js` strips scripts, unneeded classes/IDs, excessive whitespace, and resolves relative URLs using the configured `media.base`.
3. **Convert:** `src/convert.js` maps elements to Gutenberg block representations.
4. **Serialize:** `src/grammar.js` translates the block representation into WordPress-compliant HTML comment-delimited blocks (`<!-- wp:paragraph -->...<!-- /wp:paragraph -->`).
5. **Push:** `src/push.js` pushes the compiled block markup to WordPress (creating a new page/post or updating an existing one).
6. **Verify:** `src/verify.js` opens Playwright, logs into WordPress (using the Application Password or saved storage state), loads the page in the block editor, and verifies that the blocks parsed successfully.

## Render Verification (Playwright)

To guarantee the conversion was perfect, `h2g verify` automates a browser to check for:
- **Zero Block-Recovery Alerts:** Asserts that the editor did not trigger "This block contains unexpected or invalid content" or show "Block Recovery" prompts.
- **Block Consistency:** Counts the parsed blocks in the editor's DOM and matches them to the conversion report.
- **Console Errors:** Monitors browser logs for JavaScript errors.
- **Semantic Outline:** Asserts heading hierarchy is correct and media references resolved.

## Gotchas

- **Minimal Attributes:** Gutenberg's block validator is highly sensitive. Extraneous or misaligned block JSON attributes will cause the editor to flag "Block Recovery". The serializer uses minimal JSON representations and relies on Gutenberg defaults.
- **Inline Styles:** CSS inline styles are generally dropped during normalization. They can be translated to Gutenberg block classes or inline HTML within a `core/html` block if needed.
- **Media Uploads:** Importing media requires valid WordPress REST credentials with authorization to write to the `/wp/v2/media` endpoint.
