# Pre-launch Auditor

Node CLI (`audit` / `prelaunch-auditor`) that answers "is this site objectively ready to
go live?" — regardless of any template. Runs an opinionated pre-launch audit across SEO,
accessibility, performance, security headers, content readiness, and WP hygiene, and
produces a single pass/fail scorecard with prioritized fixes. Point it at a staging URL
before flipping DNS. Read-only. (Complements the QA app, which compares against a template.)

## Architecture map

- **Stack:** Node ESM CLI (`bin: audit`/`prelaunch-auditor` → `src/cli.js`). Zero
  mandatory dependencies — the live adapter is plain `fetch` + a small regex-based HTML
  extractor (`src/html.js`), not a headless browser. Lighthouse + `chrome-launcher` are
  imported **lazily** by the perf check only (`npm i -D lighthouse chrome-launcher` to
  enable it), exactly like `wp-qa-playwright`'s Playwright adapter — everything else
  never touches them.
- **Data flow:** `cli.js` → `config.js` loads `audit.config.yml` + a budgets JSON →
  `audit.js` (`runAudit`) runs the enabled checks against an adapter
  (`adapters/live.js` for a real URL, `adapters/fixture.js` for tests/offline) → each
  check emits `findings.js` records (severity blocker/warning/info + actionable fix) →
  `scorecard.js` renders `scorecard.html` + `scorecard.json`; `cli.js` exits non-zero on
  any blocker.
- **Checks (`src/checks/`)** — each is a pure `async run(site) => findings[]`, no I/O of
  its own; `site.resource()`/`site.perfRuns()` come from the adapter:
  - `seo.js` — unique title/meta, one h1, canonical, robots+sitemap, no stray `staging`/noindex on prod
  - `a11y.js` — static-HTML heuristics: alt text, unlabeled form fields, lang, landmarks,
    inline-style contrast ratio, `:focus{outline:none}` with no replacement. Not axe-core —
    always appends an "automated checks only" info note.
  - `perf.js` — Lighthouse mobile+desktop, LCP/TBT/CLS + score vs. budget, **median of N
    runs** (never a single sample); degrades to an info note if Lighthouse isn't installed
  - `security.js` — HTTPS enforced (redirect, not just present), HSTS + headers, no mixed
    content, no WP version/readme/xmlrpc/admin-username exposure, no visible debug output
  - `content.js` — no lorem/sample pages, no broken internal links, empty-nav detection,
    favicon, a real (non-soft) styled 404
  - `analytics.js` — tracking tag present (or waived), cookie consent wired
- **Supporting:** `src/audit.js` (orchestrator + `CATEGORIES` registry), `src/findings.js`
  (severity model + deterministic sort), `src/config.js` (merge order: defaults < config
  file < fixture's own environment < CLI flags), `src/html.js` (the HTML *extractor* used
  by checks — not the report renderer), `src/scorecard.js` (the report renderer),
  `src/yaml.js`.
- **Config:** `audit.config.yml` (copy from `.example`) + a budgets JSON (copy from
  `budgets.example.json`, or pass `--budget`).
- **Where NOT to look:** `node_modules/`, `report/` (generated). `test/fixtures/*/site.json`
  + `pages/*.html` are checked-in acceptance fixtures (clean vs. broken), not generated —
  read them when touching a check's pass/fail boundary.

## Deeper context lives in the vault
Curated, durable knowledge (design decisions, gotchas) lives in the monorepo Obsidian
vault under `vault/`. Open the matching note before reading source; keep transient notes
there, not in this file.

## Conventions
- **Read-only.** Works for multisite and standalone; auth-gated checks degrade gracefully
  when only public access is available.
- **Every finding has a severity** (blocker/warning/info) and an actionable fix, not just
  a raw metric.
- **Environment-aware:** `noindex` is correct on staging but a blocker on production — the
  check must know which environment it's auditing (config flag).
- Label the report as automated-checks-only, not a full manual audit.

## Commands
```
audit run <staging-url>
audit run <url> --only seo,a11y
audit run <url> --env production --budget budgets.json
audit run --fixture test/fixtures/clean    # offline, no network — see test/fixtures/broken too
node --test                                # tests
```
Output: `scorecard.html` (blockers at top, each with offending URL + fix) + `scorecard.json`.
Exit non-zero if any blocker remains → can gate the launch.

## Working agreement (token discipline)
- Use this map before grepping `src/`. When I name a check or module, start there.
- Prefer signatures over full bodies for supporting modules; read a whole file only when
  editing it. Side investigations go to a subagent.

## Do NOT
- Don't edit this file mid-task (invalidates the prompt cache from here rightward).
- Don't gate on a single Lighthouse run — perf numbers vary; average 3–5 runs, compare medians.
- Don't reformat/mass-rename outside the task's scope.
