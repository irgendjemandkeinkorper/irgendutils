# @irgendutils/post-deploy-smoke-test

Right after a deploy, hit a short list of critical URLs and assert each returns
the right status code and contains a known "proof of life" string. Catches the
"deploy succeeded but the homepage is a white screen / 500 / missing content"
class of failure in seconds, and exits non-zero so it can gate a pipeline or
trigger a rollback. Deliberately tiny and fast — a gate, not a QA suite.

Read-only and idempotent: no side effects, safe to run repeatedly. A hard
per-check timeout guarantees a hung URL cannot stall the pipeline.

## Install

Zero runtime dependencies — plain Node.js >= 18 ESM.

```sh
cd post-deploy-smoke-test
npm link          # optional, to get the `smoke` command on PATH
# or just: node src/cli.js run
```

## Usage

```sh
smoke run                                          # all checks against base_url from smoke.yml
smoke run --url https://staging.acme.example.com   # override target (test staging first)
smoke run --fail-fast                              # stop at first failure
smoke run -c path/to/smoke.yml -o out/results.json # explicit config / output paths
```

Exit codes: `0` all checks passed, `1` at least one failure (wire this to your
rollback/alert), `2` usage or config error.

Output: a compact console table (each check with `✓`/`✗`, status, timing, and
the failure reason) plus `results.json` for the pipeline.

```
  check                             status  time   reason
✓ /                                 200     142ms
✗ /shop                             200     35ms   suspiciously tiny body (0 bytes < 100) — possible white screen; body does not contain "Add to cart"
✗ /wp-login.php                     200     105ms  body does not contain "Log In"

FAIL  3/6 passed, 3 failed, 0 warnings  (312ms against https://acme.example.com)
```

## Config (`smoke.yml`)

Per-site config lives with the site. Copy `smoke.example.yml` and edit:

```yaml
base_url: https://acme.example.com
timeout_ms: 8000          # hard per-check timeout
soft_budget_ms: 2000      # slower than this warns (does not fail)
checks:
  - { path: /,             status: 200, contains: "Acme" }
  - { path: /wp-json,      status: 200, json: true }
  - { path: /old-page,     status: 301, redirects_to: /new-page }
authed:
  - { path: /wp-json/wp/v2/users/me, user: automation, app_password_env: WP_APP_PASSWORD, status: 200 }
fail_fast: false
```

What each check asserts:

- **Status code** matches (200, or an expected 301/302 with the right `Location`
  via `redirects_to`).
- **Content** — body contains the `contains` string (proves the page rendered,
  not just returned 200). Pick stable strings, not prices/timestamps.
- **Fatal-error markers** — `Fatal error`, `There has been a critical error`,
  PHP/Python/JS stack traces, and a suspiciously tiny body (white screen) all
  fail the check even on a 200.
- **JSON validity** when `json: true`.
- **Response time** — over `soft_budget_ms` warns; a per-check `max_ms` makes
  slowness a hard failure. Per-check `timeout_ms` overrides the hard timeout.
- **TLS** — expired certs / hostname mismatches surface as request errors and
  fail the check (deep cert monitoring lives in the DNS/SSL monitor app).
- `cache_bust: true` appends `?smoke=<ts>` so a CDN can't mask a broken origin.

Authed checks are REST-first: a simple authenticated request with a WordPress
Application Password (`Authorization: Basic`), no browser login scripting. The
secret comes from the env var named by `app_password_env` — never from the
config, never committed, never echoed. See `.env.example`; a `.env` in the cwd
is loaded if present (real environment wins).

## Plain-JS / adapter design

Core evaluation (`src/evaluate.js`) is pure: it judges an already-fetched
response, so the whole suite runs offline against fixtures with a fake adapter
(`npm test` needs no install and no network). Live fetching lives behind lazily
imported adapters:

- `src/adapters/http.js` — Node's global `fetch`, manual redirects, no-cache
  header, AbortController timeout. No install needed.
- `src/adapters/playwright.js` — only for checks marked `browser: true`. Not a
  dependency: run `npm i -D playwright` if you actually need JS-rendered checks.
- `--adapter <file>` lets tests (or you) inject any module exporting
  `fetchUrl(req)` — see `fixtures/fake-adapter.mjs`.

The YAML and `.env` loaders are tiny built-in parsers (`src/yaml.js`) — no
js-yaml/dotenv. The supported YAML is the flat shape shown above.

## Tests

```sh
npm test    # node --test — offline, fixture-driven
```

Covers the acceptance criteria: healthy fixture passes with exit 0; a 500 and a
white-screen fixture fail with clear reasons and non-zero exit; a 200-but-wrong-
body content mismatch is caught; a hanging URL is bounded by the hard timeout.

## Gotchas

- Test the deploy target directly (origin), not just the CDN — use
  `cache_bust: true` or point `--url` at the origin host.
- CDNs/WAFs may rate-limit or challenge rapid automated hits — allowlist the
  runner's IP.
- Keep the critical-path list short; deep coverage belongs in the QA app.
