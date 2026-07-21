# @irgendutils/wp-qa-playwright

QA a live WordPress site against a **template/reference** and flag where they
drift: structural differences, visual regressions, broken links/assets, console
errors, failing responsive breakpoints, and WP hygiene. Produces a human-readable
HTML report plus a machine-readable `results.json`, and exits non-zero when any
target fails a threshold — so it can gate a deploy.

**Read-only by design.** It only navigates and reads; it never submits forms,
posts comments, or mutates the site. No SSH is ever required — public checks run
against any URL, and the WP-hygiene checks use the REST API + an Application
Password when available and simply skip with a note when they're not.

## Install

Zero runtime dependencies for the offline/fixture path — plain Node.js ≥ 18 ESM.
The **live** browser adapter needs Playwright, installed only when you actually
run against a real site:

```sh
cd wp-qa-playwright
npm i -D playwright && npx playwright install chromium   # only for live runs
npm link                                                  # optional: `qa` on PATH
# or just: node src/cli.js run
```

## Quickstart

```sh
cp qa.config.example.yml qa.config.yml      # edit template_url + targets
qa run                                       # all targets, all checks
qa report --open                             # open the latest HTML report
```

Try it with **no browser and no network** first — the bundled fixture exercises
every check offline:

```sh
node src/cli.js run -c fixtures/qa.config.yml
# good.example.com passes clean; broken.example.com trips every check; exit 1
```

## Commands

```sh
qa run                          # every target in the config, all checks
qa run https://staging.site/    # a single target (test staging first)
qa run --checks visual,links    # only the named checks
qa baseline https://site/       # capture/refresh a visual baseline for a site
qa preflight                    # connectivity check only (reachability + auth)
qa report [--open]              # print (and optionally open) the latest report
```

Useful flags: `-c/--config <file>`, `-o/--out <dir>`, `--json` (print
`results.json` instead of the table), `--skip-preflight`, `--fixture
<capture.json>` (offline run), `--no-color`.

## Connectivity preflight

Before a **live** run, `qa run` performs a fast preflight: it confirms the
template and every target is reachable, and — when `auth` is configured — that
the Application Password actually works. This catches DNS/TLS/wrong-URL and
bad-credential problems in seconds, instead of as a browser run full of
confusing failures.

- An **unreachable** target aborts the run before the browser launches (exit 2).
- A reachable site with **failing auth** is a warning, not a stop — the public
  checks still run and `wp_hygiene` degrades to a skip note.
- `--skip-preflight` bypasses it; the fixture/offline adapter skips it (nothing
  to reach).

Run it on its own to validate setup before wiring anything into CI:

```sh
qa preflight        # exit 0 = all reachable, 2 = something is unreachable
```

```
Preflight — connectivity check
✓ template https://_template.example.com/  HTTP 200
✓ target   https://acme.example.com/  HTTP 200
    auth ok (Application Password valid)
✗ target   https://beta.example.com/  getaddrinfo ENOTFOUND beta.example.com

Preflight FAILED — one or more targets are unreachable. Aborting before the browser run.
```

Exit codes: `0` all targets passed, `1` at least one failure (wire this to your
deploy gate / rollback), `2` usage or config error.

## Config (`qa.config.yml`)

```yaml
template_url: https://_template.example.com/   # the reference to compare against
targets:
  - https://acme.example.com/
  - https://beta.example.com/
viewports: [360, 768, 1280]
thresholds:
  pixel_diff_pct: 0.15        # fail a page whose pixel diff exceeds this percent
  max_broken_links: 0         # fail when more links/assets than this are broken
checks: [visual, links, console, headings, responsive, wp_hygiene]
auth:                         # optional — authed WP-hygiene checks
  user: automation
  app_password_env: WP_APP_PASSWORD   # names an ENV VAR, never the secret itself
mask_selectors: [".post-date", ".carousel"]   # blacked out before visual diff
consent_selector: ".cookie-banner .accept"     # clicked once to dismiss a banner
baseline_dir: baseline
report_dir: report
adapter: playwright           # or "fake" with `fixture:` for offline runs
```

`headings` is an alias for `structural`. Secrets never live in this file — the
Application Password comes from the env var named by `auth.app_password_env`
(a `.env` in the cwd is loaded if present; the real environment wins).

## The checks

1. **Structural** — compares DOM landmarks (header/nav/main/footer), the h1–h3
   outline, and the set of Gutenberg block types present. Reports missing/extra
   sections, not raw HTML diffs. Missing landmarks are errors; heading/block
   drift is a warning.
2. **Visual** — full-page screenshots at each viewport, pixel-diffed against the
   template (or a stored **baseline** for the same site). Dynamic regions named
   in `mask_selectors` are blacked out on both sides. Over `pixel_diff_pct` fails.
3. **Links / assets** — every `<a href>`, `<img src>`, `<script src>`, and
   stylesheet is status-checked. 4xx/5xx and unreachable assets count toward
   `max_broken_links`; **mixed content** (http asset on an https page) is always
   an error; long redirect chains warn.
4. **Console + network** — an error-level console message or a genuinely failed
   resource request is a finding. Two benign patterns are downgraded so they
   don't fail every real site: third-party **analytics/beacon** endpoints
   (Google Analytics, GTM, Meta Pixel, …) are info-only, and **aborted**
   requests (`net::ERR_ABORTED`, common for beacons cancelled on unload) are
   warnings. Real breakage — `ERR_NAME_NOT_RESOLVED`, `ERR_CONNECTION_REFUSED`,
   timeouts, 4xx/5xx — stays an error.
5. **Responsive** — no horizontal scroll at mobile widths, tap targets don't
   overlap, and the nav collapses where expected.
6. **WP hygiene** (when authenticated) — active theme matches the template,
   required plugins present and up to date, no debug output, no leftover
   "Hello world" / "Sample Page", sitemap + robots reachable. Degrades to a
   single skip note when the REST API or credentials are unavailable.

## Output

Each run writes `report/<timestamp>/`:

- `index.html` — findings grouped by target and severity, with side-by-side
  template / target / diff screenshots per viewport.
- `results.json` — `{ pass, summary, results[] }` for CI gating (no image blobs).
- `screenshots/<site>/<viewport>-{target,reference,diff}.png`.

## Gate a deploy (CI)

```yaml
# .github/workflows/deploy.yml (excerpt)
  qa:
    needs: deploy
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: 20 }
      - working-directory: wp-qa-playwright
        run: npm i -D playwright && npx playwright install --with-deps chromium
      - working-directory: wp-qa-playwright
        env:
          WP_APP_PASSWORD: ${{ secrets.WP_APP_PASSWORD }}
        run: node src/cli.js run --no-color        # non-zero exit fails the job
      - if: always()
        uses: actions/upload-artifact@v4
        with: { name: qa-report, path: wp-qa-playwright/report }
```

## Visual baselines

With no `template_url`, visual regression compares each target against a stored
baseline instead:

```sh
qa baseline https://acme.example.com/    # capture the "known good" look
# ...later, after a change...
qa run https://acme.example.com/         # diffs against the saved baseline
```

## Tests

```sh
npm test    # node --test — offline, fixture-driven, nothing to install
```

Covers the acceptance criteria: the template checked against itself yields zero
findings (self-consistency); the broken fixture produces at least one finding per
check; two runs of an unchanged page produce byte-identical screenshots (0% diff,
proving determinism); and the JSON schema + exit codes reflect pass/fail.

## Determinism & gotchas

- Screenshots are made stable by pinning viewport sizes, disabling animations,
  scrolling to trigger lazy loads, and waiting for `networkidle` + fonts-ready
  before capture. Still-flaky regions (dates, carousels) belong in
  `mask_selectors`.
- Cookie/consent banners overlay everything — set `consent_selector` to dismiss
  one before capture (dismissal only; never a form submission).
- Cross-domain URLs (template vs target host) are normalized before link diffing,
  so a different hostname isn't reported as a "difference".
- Authenticated checks use Application Passwords over **HTTPS only**; the secret
  is never logged.
