# CLAUDE.md — WP QA (Playwright vs. Template)

Compare a **live site** against a **template/reference** and flag drift: visual diffs,
missing/extra elements, broken links, console errors, failing responsive breakpoints,
and WP hygiene. Emits a human report + machine JSON for CI, non-zero exit on failure.

## Architecture map
- **Stack:** the justified Node exception — **Playwright**, Node ESM (`node >=18.17`).
  Entry: `src/cli.js` (bin `qa` / `wp-qa`).
- **Core:** `src/runner.js` (orchestrates checks per target), `src/preflight.js`,
  `src/config.js` + `src/yaml.js` (`qa.config.yml`), `src/report.js`,
  `src/html.js` / `src/png.js` (report + screenshot output).
- **Checks** (`src/checks/`): `structural.js`, `visual.js`, `links.js`,
  `consoleCheck.js`, `responsive.js`, `wpHygiene.js`.
- **Adapters** (`src/adapters/`): `playwright.js` (real browser), `fake.js` (test double).
- **Tests/fixtures:** `test/*.test.js`; `fixtures/qa.config.yml` (good) +
  `qa.config.down.yml` (broken) prove the checker catches failures.
- **Where NOT to look:** `node_modules/`, `report/<timestamp>/` (generated output).

## Deeper context lives in the vault
Durable knowledge (flaky-screenshot fixes, threshold decisions) goes in the Obsidian
vault under `vault/`. Open the matching note before reading source.

## Config (`qa.config.example.yml`)
```yaml
template_url: https://_template.example.com
targets: [https://acme.example.com]
viewports: [360, 768, 1280]
thresholds: { pixel_diff_pct: 0.15, max_broken_links: 0 }
checks: [visual, links, console, headings, responsive, wp_hygiene]
auth: { user: automation, app_password_env: WP_APP_PASSWORD }   # optional
```

## Key commands
```
qa run                       # all targets, all checks
qa run <url> --checks visual,links
qa baseline <url>            # capture/refresh a visual baseline
qa report --open             # open latest HTML report
npm test                     # node --test
```

## Conventions / house rules
- **REST-first, no SSH ever:** read-only, mostly public front end — needs no server
  access. Public checks run against any URL; WP-hygiene checks use REST + Application
  Password when available and **skip with a note** when not. Degrade gracefully.
- **Non-destructive by definition** — only reads; never submits forms, posts comments,
  or mutates the site. Any state change is a bug.
- **Deterministic runs:** pin viewports, disable animations, freeze time/fonts before
  screenshots. Normalize template-vs-target host before diffing links.
- Verify the checker itself: template-vs-itself yields ~zero findings; the broken
  fixture produces ≥1 finding per implemented check; two runs of an unchanged page diff
  under threshold; exit code reflects pass/fail.

## Gotchas
- Lazy-loaded images/fonts cause flaky screenshots — wait for `networkidle` + fonts-ready
  and scroll to trigger lazy loads before capturing.
- Cookie/consent banners overlay everything — dismiss via config selector first.
- Don't flag cross-domain absolute URLs as differences — normalize hosts.
- Authenticated checks: Application Passwords over HTTPS only; never log the secret.

## Do NOT
- Don't edit this file mid-task (breaks the prompt cache). Don't mutate a target site.
  Don't require WP-CLI/SSH. Don't reformat outside task scope.
