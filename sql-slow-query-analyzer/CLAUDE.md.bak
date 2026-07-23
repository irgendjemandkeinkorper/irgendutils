# CLAUDE.md — SQL Slow-Query Analyzer

## What this app does
Parse a MySQL/MariaDB **slow query log** (or `performance_schema`), group queries by
normalized shape, rank the worst offenders by total time impact, and suggest
indexes / rewrites. Turns a giant noisy log into a short "fix these five queries"
list. Read-only — it never touches production data.

## Shared house rules
- **Stack:** a small **Node/TS or PHP** CLI. No heavy APM. Input is a log file or a
  read-only DB connection; output is a report.
- **Read-only + safe.** Connects with a read-only user; runs `EXPLAIN` (never the
  query itself) to assess plans. Never writes, never adds the suggested indexes
  automatically — it *recommends*, a human applies.
- Works against standalone DBs and WP databases alike. For WP, understand the common
  culprits (`wp_postmeta` / `wp_options` autoload / unindexed meta_key lookups).
- Deterministic: same log → same ranked output, so runs are diffable over time.

## Config
```yaml
source: slowlog            # slowlog | performance_schema
slow_log_path: /var/log/mysql/slow.log
db:                        # only needed for EXPLAIN + schema lookup
  host: 127.0.0.1
  name: sitedb
  user: readonly
  pass_env: DB_RO_PASSWORD
top_n: 20
min_total_time_ms: 500     # ignore trivial queries
```

## Workflow
1. **Ingest** the slow log (support the standard MySQL slow-log format and, if
   `performance_schema`, `events_statements_summary_by_digest`).
2. **Normalize** each query to a digest — strip literals/IN-lists so
   `WHERE id=1` and `WHERE id=2` collapse to one shape.
3. **Aggregate** per digest: count, total time, mean/p95 time, rows examined vs
   rows sent (a big ratio = missing index smell).
4. **Rank** by *total* time impact (count × mean), not just slowest single query —
   a fast query run a million times often matters more.
5. **Diagnose** the top N: run `EXPLAIN` (and `EXPLAIN ANALYZE` where safe), flag
   full table scans, filesorts, temp tables, and unused/missing indexes. Cross-check
   `information_schema` for existing indexes before suggesting new ones.
6. **Report** each offender with: the normalized query, its stats, the EXPLAIN
   verdict, and a concrete suggestion (candidate index DDL, or a rewrite) — clearly
   labeled as a recommendation to review.

## Key commands
```
slowq analyze                    # parse configured log, emit report
slowq analyze --source perf_schema
slowq explain "<query>"          # ad-hoc EXPLAIN + index suggestion
slowq report --open
```

## Output
- `report/<timestamp>.md` (+ `.json`) — ranked offenders, stats, EXPLAIN, suggested
  fixes. Suggestions grouped as "high confidence / worth investigating."

## Acceptance criteria (verification step)
- On a fixture log with a known unindexed query, the tool ranks it and suggests the
  correct index.
- Digest normalization collapses parameter-only variants into one group (assert
  count).
- No write statement is ever issued (assert the DB user has no write grant, or run
  against a read replica).
- Re-running on the same log yields identical rankings.

## Gotchas
- `EXPLAIN` on a query with bound literals can differ from the real plan — note that
  suggestions are advisory.
- A suggested index isn't free: flag write-heavy tables where a new index costs
  insert performance.
- WP `autoload` bloat in `wp_options` won't show in the slow log but is a frequent
  real cause of slowness — add a specific check for large autoloaded option totals.
- Don't suggest a redundant index that a composite already covers — check existing
  indexes first.
