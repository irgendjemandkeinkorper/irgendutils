# CLAUDE.md — Post-Deploy Smoke Test

## What this app does
Right after a deploy, hit a small list of **critical URLs** and assert each returns
the right status code and contains a known "proof of life" string. Catches the
"deploy succeeded but the homepage is a white screen / 500 / missing content" class
of failure in seconds, and exits non-zero so it can gate or trigger a rollback.
Deliberately tiny and fast — this is a gate, not a full QA suite.

## Shared house rules
- **Stack:** minimal — plain HTTP checks (Node/TS or even curl+jq) for speed;
  optional **Playwright** only for the few flows that need JS/login. Reuses the
  QA app's helpers where useful but stays lightweight enough to run in a deploy
  pipeline in under a minute.
- **Read-only, idempotent, fast.** No side effects, safe to run repeatedly. Hard
  timeout per check so a hung URL can't stall the pipeline.
- **REST-first for authed checks** — use an Application Password to smoke-test a
  logged-in endpoint rather than scripting a full browser login when a simple
  authenticated request suffices.
- Config is per-site and lives with the site, so each project declares its own
  critical paths.

## Config
`smoke.yml`:
```yaml
base_url: https://acme.example.com
timeout_ms: 8000
checks:
  - { path: /,                 status: 200, contains: "Acme" }
  - { path: /shop,             status: 200, contains: "Add to cart" }
  - { path: /wp-json,          status: 200, json: true }
  - { path: /old-page,         status: 301, redirects_to: /new-page }
  - { path: /wp-login.php,     status: 200, contains: "Log In" }
authed:
  - { path: /wp-json/wp/v2/users/me, user: automation, app_password_env: WP_APP_PASSWORD, status: 200 }
fail_fast: false               # run all checks, report all failures
```

## Checks per URL
- **Status code** matches expected (200, or an expected 301/302 with the right
  `Location`).
- **Content assertion** — the response body contains the expected string (proves the
  page actually rendered, not just returned 200 with an error page).
- **No mixed content / no fatal-error markers** — flag `Fatal error`,
  `There has been a critical error`, stack traces, or a suspiciously tiny body.
- **JSON endpoints** parse as valid JSON when `json: true`.
- **TLS valid** — cert not expired, hostname matches (quick check; deep cert
  monitoring lives in the DNS/SSL monitor app).
- **Response time** under a soft budget (warn, don't fail, unless configured).

## Key commands
```
smoke run                        # run all checks against base_url
smoke run --url https://staging.acme.example.com   # override target (test staging first)
smoke run --fail-fast            # stop at first failure
```

## Output
- Compact console table: each check ✓/✗ with status, timing, and the failure reason.
- `results.json` for the pipeline.
- **Exit code** 0 = all passed, non-zero = at least one failure → wire to
  rollback/alert.

## Acceptance criteria (verification step)
- Against a healthy site, all checks pass and exit code is 0.
- Pointed at a fixture returning a 500 or a white screen, the matching check FAILS
  with a clear reason and non-zero exit.
- A content-assertion mismatch (200 but wrong body) is caught — proves it's not just
  a status-code check.
- Runs to completion inside the configured timeout even when a URL hangs.

## Gotchas
- Test the deploy target directly (origin), not just the CDN — a cached good copy
  can mask a broken origin. Add a cache-buster or `Host` override where needed.
- CDNs/WAFs may rate-limit or challenge rapid automated hits — allowlist the runner.
- Don't assert on volatile content (prices, timestamps); pick stable proof strings.
- Keep the critical-path list SHORT — this must stay fast enough to run on every
  deploy; deep coverage belongs in the QA app.
