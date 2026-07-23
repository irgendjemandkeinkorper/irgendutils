# Post-Deploy Smoke Test

Node CLI (`smoke`) that, right after a deploy, hits a small list of critical URLs and
asserts each returns the right status code and a known "proof of life" string. Catches
the "deploy succeeded but the homepage is a white screen / 500" class of failure in
seconds and exits non-zero so it can gate or trigger a rollback. Deliberately tiny and
fast — a gate, not a full QA suite.

## Architecture map

- **Stack:** Node ESM CLI (`bin: smoke → src/cli.js`). Plain HTTP checks for speed;
  optional Playwright only for the few flows needing JS/login.
- **Data flow:** `cli.js run` → load `smoke.yml` (`yaml.js`) → `runner.js` executes each
  check via an adapter (`adapters/http.js` default, `adapters/playwright.js` for authed
  JS flows) → `evaluate.js` asserts status/content/JSON/TLS → `report.js` prints a table
  + `results.json`, sets exit code.
- **Core modules:**
  - `src/cli.js` — entry / command dispatch
  - `src/runner.js` — orchestrates checks, per-check hard timeout
  - `src/evaluate.js` — status, content-contains, JSON, redirect, fatal-error, TLS assertions
  - `src/adapters/http.js` — plain HTTP probe · `src/adapters/playwright.js` — authed/JS flows
  - `src/report.js` — console table + `results.json` + exit code
  - `src/yaml.js` — config parse
- **Config:** `smoke.yml` — `base_url`, `timeout_ms`, `checks[]`
  (`{path,status,contains,json,redirects_to}`), `authed[]`
  (`{path,user,app_password_env,status}` via WP Application Password), `fail_fast`.
  See `smoke.example.yml`, `.env.example`.
- **Where NOT to look:** `fixtures/`, `test/`, `README.md`.

## Deeper context lives in the vault
Curated, durable knowledge (design decisions, gotchas) lives in the monorepo Obsidian
vault under `vault/`. Open the matching note before reading source; keep transient notes
there, not in this file.

## Checks per URL
Status code (incl. expected 301/302 + `Location`) · content-contains (proves it rendered)
· no fatal-error markers (`Fatal error`, `There has been a critical error`, stack traces,
tiny body) · valid JSON when `json:true` · TLS valid (quick) · response time vs soft budget.

## Conventions
- **Read-only, idempotent, fast** — no side effects, safe to run repeatedly. Hard timeout
  per check so a hung URL can't stall the pipeline. Keep the critical-path list SHORT.
- **REST-first for authed checks** — use an Application Password rather than scripting a
  full browser login when a simple authenticated request suffices.
- Config is per-site and lives with the site.
- Test the deploy target/origin directly, not just the CDN (a cached good copy masks a
  broken origin). Assert on stable proof strings, never volatile content (prices/timestamps).

## Commands
```
smoke run                                              # all checks vs base_url
smoke run --url https://staging.acme.example.com       # override target
smoke run --fail-fast                                  # stop at first failure
node --test                                            # tests
```
Exit code: 0 = all passed, non-zero = ≥1 failure → wire to rollback/alert.

## Working agreement (token discipline)
- Use this map before grepping `src/`. When I name a module, start there.
- Prefer signatures over full bodies for supporting modules; read a whole file only when
  editing it. Side investigations go to a subagent.

## Do NOT
- Don't edit this file mid-task (invalidates the prompt cache from here rightward).
- Don't let this grow into a full QA suite — deep coverage belongs in the QA app; this
  must stay fast enough to run on every deploy.
- Don't reformat/mass-rename outside the task's scope.
