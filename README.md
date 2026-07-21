# IRgendutils — Lightweight Utility Apps

A toolkit of small, single-purpose utilities for a WordPress + knowledge-management
workflow. Each app is self-contained with its own `CLAUDE.md` you can hand to Claude
Code as the working spec.

## Shared standards (baked into every CLAUDE.md)
- **WP-native first:** WP-CLI + PHP for WordPress internals; Node only where a
  JS-only tool wins (Playwright, HTML parsing).
- **REST-first, SSH-optional:** the **REST API + Application Passwords** is the
  default path for every app — it works on nearly every WP host with no server
  access. **WP-CLI over SSH is an optional optimization**, used only for the one
  thing REST can't do (creating a multisite subdomain in #1). Detect SSH at
  startup; degrade to a "manual step" message when it's absent. The read-only apps
  (#2, #5, #6) never need SSH at all.
- **Idempotent, reversible, dry-run by default.** `--apply` to mutate; teardown for
  every create.
- **Secrets from env**, never committed. `.env.example` in every app.
- **Verify, don't assume.** Each app ships a verification step and pass/fail
  fixtures; "it ran" ≠ "it worked."

## The apps

| # | App | Purpose | Primary stack |
|---|-----|---------|---------------|
| 1 | **wp-subdomain-spinup** | Provision a WP subdomain from a template (DNS→install→clone→brand→TLS) | WP-CLI + REST |
| 2 | **wp-qa-playwright** | QA live sites against a template: visual, structural, links, console, responsive, WP hygiene | Playwright (TS) |
| 3 | **html-to-gutenberg** | Convert single-page HTML into valid Gutenberg blocks; verify render with Playwright | Node/TS + WP-CLI |
| 4 | **obsidian-vault-forge** | Scaffold a contextualized Obsidian vault per project | Node/TS (Markdown) |
| 5 | **site-migration-scraper** | Crawl a source site → clean content + manifest (feeds #3 and #4) | Playwright (TS) |
| 6 | **prelaunch-auditor** | Go/no-go scorecard: SEO, a11y, perf, security, WP hygiene (extends #2) | Playwright + Lighthouse |
| 7 | **sql-slow-query-analyzer** | Parse slow query log → rank offenders → suggest indexes (read-only) | Node/TS or PHP + MySQL |
| 8 | **wp-charset-collation-checker** | Find utf8/utf8mb4 mismatches (the mojibake bug); emit safe conversion DDL | PHP/Node + MySQL |
| 9 | **backup-restore-verifier** | Restore backups to a scratch env + integrity/smoke checks, then tear down | WP-CLI/mysqldump (+#1,#2) |
| 10 | **post-deploy-smoke-test** | Hit critical URLs post-deploy, assert status + content, non-zero to gate | HTTP (+Playwright optional) |
| 11 | **dns-ssl-uptime-monitor** | Cert expiry, DNS drift, uptime across the fleet; alerts + status page | Node/TS (scheduled) |
| 12 | **dependency-update-digest** | Composer/npm/WP outdated across projects → one digest, security first | Node/TS (scheduled) |
| 13 | **secrets-env-audit** | Scan for leaked secrets (incl. git history) + .env drift + web-exposed config | Node/TS |

## How they compose
```
                 site-migration-scraper (5)
                    │ clean HTML          │ manifest
                    ▼                     ▼
            html-to-gutenberg (3)   obsidian-vault-forge (4)
                    │ page                 ▲ links reports in
                    ▼                      │
   wp-subdomain-spinup (1) ──► wp-qa-playwright (2) ──► prelaunch-auditor (6) ──► LAUNCH
```

Ops/DB utilities (7–13) run alongside the launch pipeline: #9 leans on #1 + #2 for
its scratch smoke test; #10 gates deploys the way #6 gates launches; #11, #12, #13
are scheduled/recurring fleet-wide checks. #7 and #8 are read-only DB doctors.

## Effort / risk at a glance
- **Read-only, low-risk first builds:** #2, #5, #6, #7, #10, #11, #12, #13.
- **Stateful / gated (need backups + `--apply`):** #1, #3, #8, #9.

## Brainstorm — more utility ideas
Picks #5 and #6 above are the two I speced because they plug straight into the first
four. Other candidates worth a use case, roughly ranked by how often an agency
workflow hits them:

- **Bulk media optimizer + alt-text** — batch-convert images to WebP/AVIF, resize,
  and auto-draft alt text (with human review) across a site's media library.
- **DNS / SSL / uptime monitor** — scheduled check of cert expiry, DNS records, and
  uptime across all managed subdomains; alerts before things break. (Good fit for a
  recurring scheduled task.)
- **Redirect-map builder** — during a migration, diff old vs new URL structure and
  generate the redirect rules (feeds off the scraper's manifest).
- **Client onboarding intake → vault** — a short form/manifest that spawns both an
  Obsidian vault (#4) and a spinup (#1) in one shot.
- **Plugin/theme audit across sites** — inventory versions, flag outdated or
  vulnerable components across every managed site.
- **Content freshness report** — find stale pages, thin content, and orphaned pages
  (no internal links in) for a content refresh backlog.
- **Backup/restore verifier** — periodically restore a backup to a throwaway
  subdomain (#1) and QA it (#2) to prove backups actually work.

Tell me which of these earns a spot and I'll write its CLAUDE.md too.
