---
type: decision
id: 0001
status: accepted
date: 2026-07-25
---

# ADR 0001: html-to-gutenberg is a Node CLI, not a React SPA

> **TL;DR:** We chose a **Node ESM CLI with REST/WP-CLI/Playwright adapters**
> over the originally-scaffolded **React/Vite frontend app**, because this
> monorepo's whole convention is server-side WP-native CLIs, and a browser SPA
> can't drive WP-CLI or push through a REST Application Password without a
> backend anyway.

## Context
The first pass at this app (commit `8c143ff`) scaffolded a full client-side
React + Vite + TypeScript single-page app under what's now
`html-to-gutenberg-converted/frontend/` — upload/paste HTML in the browser,
convert client-side, review flags, export. It has its own parser,
block-mapper, flag-detector, and WP-exporter services, plus ~30 tracked files
and generated planning docs (`HTML_TO_GUTENBERG_BUILD_GUIDE.md`,
`API_SPECIFICATIONS.md`, `IMPLEMENTATION_GOTCHAS.md`, `QUICK_START.md`).

## Decision
Rebuilt as `html-to-gutenberg/` — a Node ESM CLI (`src/cli.js`) with
`src/htmlparser.js` + `src/grammar.js` + `src/convert.js` for the actual
HTML → block conversion, and `src/adapters/{rest,wpcli,playwright}.js` for
pushing to and verifying against a real WordPress site. This matches every
other app in the repo: REST-first, WP-CLI-optional, dry-run by default,
verify-don't-assume.

## Alternatives considered
- **Keep the React SPA** — rejected: a browser app has no path to WP-CLI, and
  routing REST calls (with an Application Password) through a browser means
  either exposing credentials client-side or standing up a bespoke backend
  just to proxy them — which is itself most of a CLI's job, done worse.
- **Keep both** — rejected: no shared code between them (different language,
  different architecture), so "both" is pure maintenance cost with no benefit.
  See [[html-to-gutenberg-converted salvage]] in 40-Gotchas for what, if
  anything, survived from the prototype.

## Consequences
- Good: one implementation, consistent with the rest of the monorepo; verified
  working end-to-end against a live WP editor (see 2026-07-25 session).
- Cost: the prototype's block-mapping heuristics and its 14-item gotchas list
  were thrown away as *code*, though most were reference-checked against the
  real implementation before deletion — see the linked Gotcha note for the one
  substantive gap that didn't make it into the rebuild.
- Now-forbidden: don't resurrect `html-to-gutenberg-converted/` as a parallel
  frontend for this app; if a browser-based reviewer UI is ever wanted, it
  should be a thin client over the CLI's own JSON output, not a reimplementation.

## Supersedes
- The unmerged `html-to-gutenberg-converted/` prototype (deleted; see git
  history at commit `8c143ff` if the old code is ever needed for reference).
