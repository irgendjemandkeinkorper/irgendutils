# SQL Slow-Query Analyzer

Node CLI (`slowq`) that parses a MySQL/MariaDB slow query log (or `performance_schema`),
groups queries by normalized shape, ranks the worst offenders by total time impact, and
suggests indexes / rewrites. Read-only — never touches production data.

## Architecture map

- **Stack:** Node ESM CLI (`bin: slowq → src/cli.js`), no heavy APM. Input = log file or
  read-only DB connection; output = a report.
- **Data flow:** ingest (`slowlog.js` | `perfschema.js`) → `digest.js` normalize each
  query to a shape (strip literals/IN-lists) → `aggregate.js` per-digest stats
  (count, total/mean/p95, rows examined vs sent) → rank by total time impact →
  `diagnose.js` runs `EXPLAIN` via the DB adapter → `report.js` emits Markdown + JSON.
- **Core modules:**
  - `src/cli.js` — entry / command dispatch
  - `src/slowlog.js` — standard MySQL slow-log parser
  - `src/perfschema.js` — `events_statements_summary_by_digest` path
  - `src/digest.js` — query normalization / shape collapsing
  - `src/aggregate.js` — per-digest stats + ranking
  - `src/diagnose.js` — EXPLAIN analysis, index suggestions, `information_schema` cross-check
  - `src/wp.js` — WordPress culprit checks (`wp_postmeta`, `wp_options` autoload bloat)
  - `src/report.js` — report output
  - `src/adapters/mysql.js` (read-only live) · `src/adapters/fake.js` (tests)
  - `src/readonly.js`, `src/env.js`, `src/yaml.js` — connection safety, env, config
- **Config:** `config.yml` — `source` (slowlog|performance_schema), `slow_log_path`,
  `db{host,name,user,pass_env}`, `top_n`, `min_total_time_ms`. See `config.example.yml`,
  `.env.example`.
- **Where NOT to look:** `fixtures/` (sample logs), `src/adapters/fake.js` (test double).

## Deeper context lives in the vault
Curated, durable knowledge (design decisions, gotchas) lives in the monorepo Obsidian
vault under `vault/`. Open the matching note before reading source; keep transient notes
there, not in this file.

## Conventions
- **Read-only + safe:** connect with a read-only user; run `EXPLAIN` (never the query
  itself) to assess plans. Recommend indexes; a human applies them — never auto-add.
- **Rank by total time impact** (count × mean), not slowest single query — a fast query
  run a million times usually matters more.
- **Deterministic:** same log → identical ranked output, so runs are diffable over time.
- Cross-check existing indexes before suggesting new ones; don't propose a redundant
  index a composite already covers.

## Commands
```
slowq analyze                    # parse configured log, emit report
slowq analyze --source perf_schema
slowq explain "<query>"          # ad-hoc EXPLAIN + index suggestion
slowq report --open
node --test                      # tests
```
Output: `report/<timestamp>.md` (+ `.json`) — ranked offenders, stats, EXPLAIN verdict,
suggestions grouped "high confidence / worth investigating."

## Working agreement (token discipline)
- Use this map before grepping `src/`. When I name a module, start there.
- Prefer signatures over full bodies for supporting modules; read a whole file only when
  editing it. Side investigations go to a subagent.

## Do NOT
- Don't edit this file mid-task (invalidates the prompt cache from here rightward).
- **Never issue a write statement** — verify the DB user has no write grant / use a replica.
- Don't present suggestions as certainties: EXPLAIN with bound literals can differ from
  the real plan; a new index costs insert performance on write-heavy tables — flag it.
- Don't reformat/mass-rename outside the task's scope.
