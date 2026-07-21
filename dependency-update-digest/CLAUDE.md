# CLAUDE.md — Dependency-Update Digest

## What this app does
Run the "what's outdated?" check across many projects at once (Composer, npm, and WP
plugins/themes) and roll the results into **one readable digest** that separates
routine bumps from **security updates** and **major-version** jumps. Replaces the
chore of logging into each repo/site to check by hand. Read-only reporting — it never
installs anything.

## Shared house rules
- **Stack:** small **Node/TS** (or PHP) orchestrator that shells out to the native
  tools (`composer outdated`, `npm outdated`, `wp plugin/theme list --update`) and
  merges their JSON. Doesn't reimplement version logic — trusts the ecosystem tools.
- **REST-first for WP sites:** where there's no shell, use the WP REST API / a
  read-only `wp` over SSH to list plugin/theme update availability. Detect and
  degrade.
- **Report-only, never auto-update.** Applying updates is a human decision (or a
  separate gated tool). This app informs.
- Runs well **on a schedule** (weekly digest) and is idempotent.

## Config
```yaml
projects:
  - { name: acme,  path: ~/sites/acme,  types: [composer, npm, wp] }
  - { name: beta,  path: ~/sites/beta,  types: [npm] }
  - { name: gamma, wp_rest: https://gamma.example.com, app_password_env: WP_APP_PASSWORD, types: [wp] }
severity:
  flag_major: true
  security_source: [composer-audit, npm-audit, wpvulndb]   # where available
digest:
  group_by: severity        # severity | project
notify: [email]
```

## Workflow
1. For each project + type, run the native outdated/audit command and capture JSON:
   - **Composer:** `composer outdated --direct --format=json` + `composer audit`.
   - **npm:** `npm outdated --json` + `npm audit --json`.
   - **WP:** `wp plugin list --update=available --format=json` (or REST); cross-check
     known-vulnerability feeds where available.
2. **Normalize** into one row shape: project, package, current, latest, jump type
   (patch/minor/major), and whether a known **security** advisory applies.
3. **Classify severity:** security > major > minor > patch. Security fixes float to
   the top regardless of version jump size.
4. **Assemble the digest** grouped by severity (default): "Security — update now",
   "Major — needs testing", "Routine — batch when convenient." Include counts per
   project so you can see which sites are furthest behind.
5. Emit + optionally notify. Keep a history file so the digest can show "new since
   last week."

## Key commands
```
depdigest run                    # scan all projects, emit digest
depdigest run --project acme
depdigest run --only security    # just the urgent stuff
depdigest report --open
```

## Output
- `digest/<timestamp>.md` (+ `.json`) — grouped, with security items first, majors
  flagged for testing, and a per-project "how far behind" summary.
- Non-zero exit if any **security** advisory is unresolved (so a schedule can nag).

## Acceptance criteria (verification step)
- On a fixture project pinned to an old, known-vulnerable package, the digest lists
  it under Security and exits non-zero.
- Major vs minor vs patch classification is correct on a fixture with one of each.
- A fully up-to-date project produces an empty (green) section, not an error.
- "New since last run" correctly diffs against the prior history file.

## Gotchas
- `npm outdated` exits non-zero when anything is outdated — capture output, don't let
  the exit code abort the run.
- Transitive vs direct deps: default to **direct** to keep the digest actionable;
  offer a `--deep` flag for the full tree.
- WP plugin update availability ≠ security fix — only mark security when a real
  advisory backs it, or you'll cry wolf.
- Private registries need auth (`.npmrc` / `auth.json`) — read from env, never commit
  tokens.
