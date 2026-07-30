---
type: gotcha
severity: low
area: html-to-gutenberg
updated: 2026-07-30
---

# Gotcha: heading hierarchy jumps convert silently, unflagged

> **TL;DR:** `html-to-gutenberg` maps `<h2>`–`<h6>` straight through to
> `core/heading` by tag name with no hierarchy check — a source page that
> jumps from `<h2>` to `<h4>` converts cleanly and silently. Nothing currently
> warns the editor.

## What bites you
The abandoned React-prototype (`html-to-gutenberg-converted/`, deleted — see
[[30-Decisions/0001-html-to-gutenberg-cli-over-spa]]) flagged this case
explicitly in its gotchas doc: a heading level jump (e.g. h2 → h4 with no h3)
is usually a symptom of source HTML that used heading tags for visual sizing
rather than document structure. The real CLI (`src/convert.js` →
`headingBlock()`) doesn't carry that check forward — it just reads `n.tag`
and emits the matching `core/heading` level.

Everything else worth salvaging from that prototype's gotchas/mapping-rules
docs (button-vs-link heuristics, list nesting, image alt/URL handling, table/
embed/video mapping) was checked against the current `convert.js` during the
2026-07-30 cleanup pass and found to already be implemented — often more
robustly (e.g. real youtube/vimeo canonical-URL detection in
`canonicalEmbedUrl()`). This heading-hierarchy check is the one gap that
didn't make it into the rebuild.

## Why
Not a regression — the CLI was rebuilt from scratch as a different
architecture ([[30-Decisions/0001-html-to-gutenberg-cli-over-spa]]) and this
specific check was simply never ported over.

## Do this instead
Not urgent enough to block anything today (it's a content-quality nit, not a
correctness bug — the output is valid Gutenberg markup either way). If/when
someone hits a real page with broken heading hierarchy, add a check in
`grammar.js`/`convert.js` that pushes a `warnings` entry (reusing the existing
grammar-warnings channel already surfaced in `report.js`) when a heading's
level is more than 1 greater than the previous heading's level.

## Seen in
- 2026-07-30 cleanup of `html-to-gutenberg-converted/` (abandoned prototype)
