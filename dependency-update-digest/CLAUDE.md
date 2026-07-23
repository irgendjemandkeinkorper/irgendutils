# Dependency-Update Digest

Node CLI (`depdigest`) that runs the "what's outdated?" check across many projects at
once (Composer, npm, WP plugins/themes) and rolls the results into one readable digest
that separates routine bumps from security updates and major-version jumps. Read-only
reporting — it never installs anything.

## Architecture map

- **Stack:** Node ESM orchestrator (`bin: depdigest → src/cli.js`) that shells out to the
  native tools and merges their JSON. Does not reimplement version logic — trusts the
  ecosystem tools.
- **Data flow:** `cli.js run` → per project+type an adapter (`adapters/live.js` runs
  `composer outdated` / `npm outdated` / `wp plugin list`; `adapters/fixture.js` for tests)
  → `normalize.js` to one row shape → `classify.js` severity (security > major > minor >
  patch, using `semver.js`) → `digest.js` groups + renders → `history.js` diffs vs prior run.
- **Core modules:**
  - `src/cli.js` — entry / command dispatch
  - `src/run.js` — orchestration across projects
  - `src/normalize.js` — merge tool JSON into `{project,package,current,latest,jump,security}`
  - `src/classify.js` + `src/semver.js` — severity + patch/minor/major classification
  - `src/digest.js` — grouped Markdown/JSON output
  - `src/history.js` — "new since last run" diff
  - `src/adapters/live.js` (real tools) · `src/adapters/fixture.js` (tests)
- **Config:** YAML — `projects[]` (`{name,path,types}` or `{wp_rest,app_password_env}`),
  `severity{flag_major,security_source}`, `digest{group_by}`, `notify`.
- **Where NOT to look:** `fixtures/`, `test/`.

## Deeper context lives in the vault
Curated, durable knowledge (design decisions, gotchas) lives in the monorepo Obsidian
vault under `vault/`. Open the matching note before reading source; keep transient notes
there, not in this file.

## Conventions
- **Report-only, never auto-update** — applying updates is a human decision. This app informs.
- **REST-first for WP sites** where there's no shell (read-only `wp` over SSH or REST);
  detect and degrade.
- Runs well on a schedule (weekly digest) and is idempotent.
- Default to **direct** deps to keep the digest actionable; `--deep` for the full tree.
- Only mark **security** when a real advisory backs it — WP update availability ≠ security fix.

## Commands
```
depdigest run                    # scan all projects, emit digest
depdigest run --project acme
depdigest run --only security    # just the urgent stuff
depdigest report --open
node --test                      # tests
```
Output: `digest/<timestamp>.md` (+ `.json`) — security first, majors flagged for testing,
per-project "how far behind." Non-zero exit if any security advisory is unresolved.

## Working agreement (token discipline)
- Use this map before grepping `src/`. When I name a module, start there.
- Prefer signatures over full bodies for supporting modules; read a whole file only when
  editing it. Side investigations go to a subagent.

## Do NOT
- Don't edit this file mid-task (invalidates the prompt cache from here rightward).
- Don't let a tool's exit code abort the run — `npm outdated` exits non-zero when anything
  is outdated; capture output, ignore the code.
- Don't commit registry tokens — private registries (`.npmrc` / `auth.json`) read from env.
- Don't reformat/mass-rename outside the task's scope.
