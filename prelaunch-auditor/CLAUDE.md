# CLAUDE.md — Pre-launch Auditor  (brainstorm pick #2)

## Why this one
Your Playwright QA app compares a site to a *template*. This one answers the other
launch-day question: **"is this site objectively ready to go live?"** — regardless
of any template. It's the go/no-go checklist as code, and it reuses the QA app's
crawl + Playwright plumbing.

## What it does
Run an opinionated pre-launch audit across SEO, accessibility, performance,
security headers, and WP hygiene, and produce a single **pass/fail scorecard** with
prioritized fixes. Point it at a staging URL before flipping DNS.

## Shared house rules
- **Stack:** **Playwright + Lighthouse** (Node) for perf/a11y/SEO; **WP-CLI/REST**
  for WordPress-specific checks. Read-only.
- Works for multisite network sites and standalone sites; auth-gated checks degrade
  gracefully when only public access is available.
- Every finding has a **severity** (blocker / warning / info) and an actionable fix,
  not just a raw metric.

## Checks
1. **SEO** — every page has a unique title + meta description; one h1; canonical
   set; `robots.txt` + XML sitemap present and not `noindex` on production; Open
   Graph/Twitter cards; no `staging`/`dev` left in canonical URLs.
2. **Accessibility** — run axe-core via Playwright: images have alt text, form
   fields have labels, color-contrast passes, landmark regions present, focus
   visible, page has a lang attribute.
3. **Performance** — Lighthouse mobile + desktop; flag LCP/CLS/TBT over budget,
   oversized/unoptimized images, render-blocking resources, missing caching.
4. **Security/hygiene** — HTTPS enforced (http→https redirect), HSTS + basic
   security headers, no mixed content, WP version/readme not publicly exposed,
   `XML-RPC` state noted, no debug output, default admin username absent.
5. **Content readiness** — no lorem ipsum, no "Hello world"/sample page, no broken
   internal links, no empty menus, favicon present, 404 page styled.
6. **Analytics/consent** — tracking tag present (or explicitly waived), cookie
   consent wired if required.

## Output
- `scorecard.html` — one page, sections by category, blockers at top, each with the
  offending URL + fix.
- `scorecard.json` — for CI / to store in the project's Obsidian vault.
- Exit non-zero if any **blocker** remains → can gate the launch.

## Key commands
```
audit run <staging-url>
audit run <url> --only seo,a11y
audit run <url> --budget budgets.json      # custom perf thresholds
```

## Acceptance criteria
- A deliberately broken fixture (missing alt text, noindex, http-only) produces the
  expected blocker for each category.
- A clean fixture scores zero blockers.
- Scores are stable run-to-run on an unchanged page (within Lighthouse variance;
  average N runs for perf).

## Gotchas
- Lighthouse perf numbers vary run-to-run — average 3–5 runs and compare medians,
  don't gate on a single number.
- `noindex` is correct on staging but a blocker on production — the check must know
  which environment it's auditing (config flag).
- axe-core can't catch every a11y issue; label the report as automated-checks-only,
  not a full manual audit.
