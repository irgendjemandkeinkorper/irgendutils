# Pre-launch Auditor

Node CLI (`audit` / `prelaunch-auditor`) that answers "is this site objectively ready to
go live?" — regardless of any template. Runs an opinionated pre-launch audit across SEO,
accessibility, performance, security headers, content readiness, and WP hygiene, and
produces a single pass/fail scorecard with prioritized fixes. Point it at a staging URL
before flipping DNS. Read-only. (Complements the QA app, which compares against a template.)

## Architecture map

- **Stack:** Node ESM CLI (`bin: audit → src/cli.js`). Playwright + Lighthouse for
  perf/a11y/SEO; WP-CLI/REST for WordPress-specific checks.
- **Data flow:** `cli.js` → `config.js` loads audit config + budgets → `audit.js` runs the
  enabled checks against a target (via `adapters/fixture.js` in tests) → each check emits
  `findings.js` records (severity blocker/warning/info + actionable fix) → `html.js`
  renders `scorecard.html` (+ JSON), exit non-zero on any blocker.
- **Checks (`src/checks/`):**
  - `seo.js` — unique title/meta, one h1, canonical, robots+sitemap, no stray `staging`/noindex on prod
  - `a11y.js` — axe-core via Playwright (alt text, labels, contrast, landmarks, focus, lang)
  - `perf.js` — Lighthouse mobile+desktop, LCP/CLS/TBT budgets, image/caching flags
  - `security.js` — HTTPS enforced, HSTS + headers, no mixed content, WP version/readme not exposed
  - `content.js` — no lorem/sample pages, no broken internal links, favicon, styled 404
  - `analytics.js` — tracking tag present (or waived), cookie consent wired
- **Supporting:** `src/audit.js`, `src/findings.js` (severity model), `src/config.js`,
  `src/html.js`, `src/yaml.js`.
- **Config:** `audit.config.yml` + `budgets.json` (perf thresholds). See the `.example` files.
- **Where NOT to look:** `src/adapters/fixture.js` (test double), fixture data.

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
audit run <url> --budget budgets.json      # custom perf thresholds
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
