# @irgendutils/prelaunch-auditor

Answers "is this site objectively ready to go live?" — regardless of any
template. Runs an opinionated pre-launch audit across SEO, accessibility,
performance, security headers, content readiness, and analytics/consent, and
produces a single pass/fail scorecard with prioritized, actionable fixes.
Point it at a staging URL before flipping DNS. Read-only: GETs pages and
resources, never submits forms or mutates the site.

Complements `wp-qa-playwright` (which compares a live site against a
template) — this app has no notion of a template; it checks the site against
absolute, opinionated launch criteria instead.

## Install

Zero mandatory dependencies — plain Node.js >= 18 ESM.

```sh
cd prelaunch-auditor
npm link          # optional, to get the `audit` / `prelaunch-auditor` command on PATH
# or just: node src/cli.js run <url>
```

Live performance budgets need Lighthouse + a headless Chrome, installed only
when you want that check (see **Performance** below):

```sh
npm i -D lighthouse chrome-launcher
```

## Usage

```sh
audit run https://staging.acme.example.com               # every check, all pages
audit run https://staging.acme.example.com --only seo,a11y
audit run https://staging.acme.example.com --env production --budget budgets.json
audit run --fixture test/fixtures/clean                  # offline, no network
```

### Options
```
-c, --config <file>   config file (default: audit.config.yml if present)
    --env <env>       staging | production (default: staging, or config)
    --only <list>     comma-separated subset: seo, a11y, perf, security, content, analytics
    --budget <file>   perf budget JSON (default: budgets.json if present)
    --runs <n>        performance samples to aggregate (default: 3)
    --fixture <dir>   run offline against a fixture directory, no network
-o, --out <dir>       report output dir (default: report)
    --json            print scorecard.json to stdout instead of the table
    --no-color        disable ANSI colors
-h, --help            show this help
```

Exit codes: `0` ready (no blockers), `1` at least one blocker, `2` usage or
config error — wire `0`/non-zero into a launch gate.

## Config

Copy `audit.config.example.yml` to `audit.config.yml` (all keys optional; CLI
flags override the file):

```yaml
environment: staging     # staging | production — changes the noindex/robots verdict
runs: 3                   # performance samples to aggregate (median, not single-run)
max_pages: 25             # live adapter crawl limit (homepage + sitemap + same-host links)
analytics:
  waived: false           # true to explicitly accept launching with no tracking tag
consent:
  required: false          # true if a cookie-consent banner/CMP is legally required
```

Performance budgets live in a separate JSON file (`budgets.example.json` →
`budgets.json`, or pass `--budget`):

```json
{
  "mobile":  { "lcp_ms": 2500, "cls": 0.1, "tbt_ms": 300, "performance_score": 0.8 },
  "desktop": { "lcp_ms": 1800, "cls": 0.1, "tbt_ms": 200, "performance_score": 0.9 }
}
```

Auth-gated staging sites: set `AUDIT_HTTP_USER` / `AUDIT_HTTP_PASS` in `.env`
(Basic auth, sent only over HTTPS — see `.env.example`).

## The checks

- **seo** — unique title/meta description per page, exactly one `<h1>`,
  canonical present (and not still pointing at a staging host), robots
  meta/`X-Robots-Tag` correctness for the target environment, Open Graph +
  Twitter Card tags, `robots.txt` + XML sitemap present.
- **a11y** — images missing alt text, form fields without an accessible
  label, missing `lang`, missing landmark regions, low text/background
  contrast (from inline styles), focus outlines removed with no visible
  replacement. Automated checks only — not a substitute for a manual pass
  with assistive technology (always noted in the output).
- **perf** — Lighthouse mobile + desktop against your budgets; medians of
  several runs, never a single sample (perf numbers vary run to run). Missing
  the optional Lighthouse dependency degrades to an informational note, not
  a failure.
- **security** — HTTPS enforced (and HTTP redirected, not just present),
  HSTS/`X-Content-Type-Options`/frame-protection/`Referrer-Policy` headers,
  no mixed content, no exposed WordPress version/`readme.html`, no visible
  PHP debug output, default `admin` username exposure via the REST API.
- **content** — no leftover `lorem ipsum` or default WP sample content,
  broken internal links, empty nav menus, a favicon, and a real (styled) 404
  page rather than a soft-404.
- **analytics** — an analytics/tracking tag present (or explicitly waived),
  and a consent banner/CMP when your config says one is legally required.

Every finding carries a **severity** (`blocker` | `warning` | `info`) and an
**actionable fix** — never just a raw metric. `noindex`/robots-disallow are
environment-aware: correct on staging, a blocker on production.

## Output

`report/scorecard.html` (verdict, then every non-info finding, blockers
first) + `report/scorecard.json` (machine-readable, for CI). Exit code
reflects pass/fail so it can gate a launch.

## Tests

```sh
npm test    # node --test — offline, fixture-driven, nothing to install
```

Covers the acceptance criteria: a clean fixture (`test/fixtures/clean/`)
audits with zero blockers and zero warnings; a deliberately broken fixture
(`test/fixtures/broken/`) trips a blocker in every exercised category;
findings are deterministically ordered and byte-identical across repeat
runs; and the CLI's exit-code/JSON/`--only` contract holds end to end.

## Gotchas

- Perf numbers are the **median of N runs**, never a single Lighthouse
  sample — don't gate on one run.
- `noindex` is correct on staging but a blocker on production — always pass
  `--env` (or set it in config) to match what you're actually auditing.
- The live adapter's HTML extractor is a small regex-based parser (see
  `src/html.js`), not a full DOM — good enough for meta tags, headings,
  images, forms, and inline styles, but it won't evaluate anything that only
  exists after client-side JS runs.
