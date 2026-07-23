<!--
  L0 map + rules for the irgendutils monorepo. ALWAYS loaded and prompt-cached.
  Keep it SMALL, STABLE, DURABLE. Edit BETWEEN tasks, never mid-task.
-->

# irgendutils — working guide

Monorepo of small, single-purpose utilities for a WordPress + knowledge-management
workflow. Each app is self-contained in its own folder with its **own `CLAUDE.md`**
(the authoritative module-level spec — read it first when working an app).

## Architecture map
<!-- Read this instead of grepping the tree to learn what lives where. -->

Each subfolder is an independent CLI app (`@irgendutils/<name>`, Node ESM, `bin` → `src/cli.js`):

- **wp-subdomain-spinup** → provision a new WP subdomain site cloned from a template (DNS, site create, brand tokens, verify).
- **wp-qa-playwright** → QA a live site vs a template: visual/structural diff, links, console, responsive, WP hygiene.
- **html-to-gutenberg** → convert one HTML page to canonical Gutenberg block markup, push to WP, render-verify.
- **site-migration-scraper** → crawl a legacy site, extract clean main-content + a manifest (feeds html-to-gutenberg).
- **backup-restore-verifier** → restore a backup into a throwaway env and prove it works, then tear down.
- **dns-ssl-uptime-monitor** → scheduled fleet watch for cert expiry, DNS drift, and downtime.
- **wp-charset-collation-checker** → find charset/collation mismatches (mojibake cause) and emit safe conversion DDL.
- Other apps (dependency-update-digest, post-deploy-smoke-test, prelaunch-auditor, secrets-env-audit, sql-slow-query-analyzer, obsidian-vault-forge, repo-template, quick-issue) follow the same shape — see each one's `CLAUDE.md`.
- **Where NOT to look:** `node_modules/`, `report/`, `out/`, `.git/`, generated fixtures.

See `README.md` for the full app roster.

## Deeper context lives in the vault
Curated, durable cross-app knowledge (architecture deep-dives, decisions, gotchas)
belongs in the Obsidian vault under `vault/`. Open the matching note before reading
source. Keep transient "for this session" notes there, not in this file.

## Repo conventions (from README)
- **REST API + Application Passwords** is the default access path for every app;
  WP-CLI over SSH is an optional optimization. Detect SSH at startup; degrade
  gracefully when absent. WP-native first — Node only where a JS-only tool wins.
- **Idempotent, reversible, dry-run by default.** `--apply` to mutate; teardown for
  every create.
- **Secrets from env, never committed.** `.env.example` in every app.
- **Verify, don't assume.** Each app ships a verification step and pass/fail
  fixtures; "it ran" ≠ "it worked."

## Working agreement (token discipline — read this first)
Many independent apps make it tempting to fan out a swarm of agents. **Don't.**
Parallel subagents each carry their own context and re-read their own files — cost
is *multiplicative*, not shared.

- **Sequential over parallel.** Default to one app at a time in the main
  conversation. Spawn a subagent only when a task is genuinely independent AND
  read-heavy enough that isolating it beats its own overhead. Never fan out more
  than 2–3 at once; batch across turns instead.
- **Delegate by model tier.** Haiku 4.5 for mechanical work (lint, format, renames,
  boilerplate, fixtures); Sonnet for normal feature implementation; Opus for
  architecture, cross-app design, and hard debugging only. Pass an explicit `model`
  override matched to the task.
- **Scope tool output — the silent drain.** Read line ranges, not whole files, once
  you know where you're going. Grep/Glob to locate; never `ls -R`/`find` a tree into
  context. Never pipe raw build/test/install logs in — capture pass/fail + the
  relevant error lines only.
- **Checkpoint often.** Commit each app (or unit) as soon as it works; small frequent
  commits let context compact without losing progress.
- **Use the map + each app's CLAUDE.md before searching.** When I name a file or
  symbol, that's your pivot — don't re-scan to "confirm" it.

## Do NOT
- Don't edit this file (or any CLAUDE.md) mid-task — it invalidates the prompt cache
  from that byte rightward. Edit between tasks.
- Don't switch models or MCP servers mid-task; lock them before a long run.
- Don't fan out one agent per app, or dump directory listings / raw logs into context.
- Don't reformat or mass-rename outside a task's scope.
