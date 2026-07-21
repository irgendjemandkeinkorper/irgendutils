# CLAUDE.md — WP QA (Playwright vs. Template)

## What this app does
Compare a **live site** against a **template/reference** and flag where they drift:
visual differences, missing/extra elements, broken links, console errors, failing
responsive breakpoints, and key WP hygiene checks. Output a human-readable QA
report plus a machine-readable JSON for CI.

## Shared house rules
- **Stack:** This app IS the justified Node exception — use **Playwright
  (TypeScript)**. WordPress facts (plugin versions, active theme) still come from
  **WP-CLI or the REST API**, not screen-scraping, when we have access.
- **REST-first, no SSH ever:** this app is read-only and mostly hits the public
  front end, so it needs **no server access at all**. Public checks (visual, links,
  console, structural, responsive) run against any URL; the WP-hygiene checks use
  the **REST API + Application Password** when available and simply **skip with a
  note** when they're not. Never require WP-CLI/SSH here — degrade gracefully to
  public-only checks. Works identically for multisite network sites and standalone
  sites.
- **Non-destructive by definition.** This app only reads. It must never submit
  forms, post comments, or mutate the live site. Treat any state change as a bug.
- Deterministic runs: pin viewport sizes, disable animations, freeze time/fonts
  before screenshots so diffs aren't noisy.
- Verify the checker itself: a known-good page must pass; a deliberately broken
  fixture must fail. Ship those fixtures.

## Config
`qa.config.yml`:
```yaml
template_url: https://_template.example.com
targets:
  - https://acme.example.com
  - https://beta.example.com
viewports: [360, 768, 1280]
thresholds:
  pixel_diff_pct: 0.15        # fail a page over this
  max_broken_links: 0
checks: [visual, links, console, headings, responsive, wp_hygiene]
auth:                         # optional, per target
  user: automation
  app_password_env: WP_APP_PASSWORD
```

## Checks to implement
1. **Structural diff** — crawl template + target, compare DOM landmarks (header,
   nav, footer, main), heading outline (h1–h3), and the set of Gutenberg block
   types present. Report missing/extra sections rather than raw HTML diffs.
2. **Visual regression** — full-page screenshots at each viewport, pixel-diff vs
   the template (or vs a stored baseline for the same site). Mask known-dynamic
   regions (dates, carousels) via selectors in config.
3. **Broken links / assets** — collect every `<a href>`, `<img src>`, script, and
   stylesheet; check status codes. Flag 4xx/5xx, mixed-content (http on https),
   and redirects chains.
4. **Console + network** — capture console errors/warnings and failed requests
   during load. Any error-level console message is a finding.
5. **Responsive** — no horizontal scroll at mobile widths, tap targets not
   overlapping, nav collapses as expected.
6. **WP hygiene** (when authenticated) — active theme matches template, required
   plugins present + up to date, no debug output, no default "Hello world"/sample
   page left behind, sitemap + robots present.

## Key commands
```
qa run                       # all targets, all checks
qa run <url> --checks visual,links
qa baseline <url>            # capture/refresh a visual baseline
qa report --open             # open latest HTML report
```

## Output
- `report/<timestamp>/index.html` — findings grouped by severity, with side-by-side
  screenshots and the diff overlay.
- `report/<timestamp>/results.json` — `{ pass, findings[], ... }` for CI gating.
- Exit non-zero when any target fails a threshold (so it can gate a deploy).

## Acceptance criteria (verification step)
- Running against the template itself yields ~zero findings (self-consistency).
- The broken-fixture site produces at least one finding per implemented check.
- Screenshots are stable across two consecutive runs of an unchanged page (diff
  under threshold) — proves determinism.
- JSON schema is valid and the exit code reflects pass/fail.

## Gotchas
- Lazy-loaded images/fonts cause flaky screenshots — wait for `networkidle` + a
  fonts-ready hook, and scroll the page to trigger lazy loads before capturing.
- Cookie/consent banners overlay everything — dismiss via config selector before
  screenshots.
- Don't compare absolute URLs across domains as "differences"; normalize the
  template vs target host before diffing links.
- Authenticated checks: use Application Passwords over HTTPS only; never log the
  secret.
