# @irgendutils/sql-slow-query-analyzer

Parse a MySQL or MariaDB slow query log (or query the database `performance_schema`), collapse/normalize queries into standard logical shapes, rank the worst offenders by total execution time impact, run `EXPLAIN` on them, and suggest database indexes or query rewrites.

**Read-only and non-intrusive.** This utility never modifies database tables, never executes slow write queries, and only connects via a read-only DB user. Ad-hoc query checks use `EXPLAIN` queries, meaning the database server never actually executes the heavy query payloads during diagnosis.

## Install

Requires Node.js ≥ 18 ESM.

```sh
cd sql-slow-query-analyzer
npm install
npm link                               # optional: `slowq` on PATH
# or just: node src/cli.js
```

## Quickstart

1. **Configure:** Copy `config.example.yml` to `config.yml` and adjust connection parameters and log paths.
2. **Set secrets:** Create a `.env` file containing your read-only database password:
   ```env
   DB_RO_PASSWORD=your_readonly_password
   ```
3. **Analyze slow log:** Ingest and diagnose the standard MySQL slow log:
   ```sh
   slowq analyze
   ```
4. **Analyze performance_schema:** Query the active MySQL statement digest tables directly:
   ```sh
   slowq analyze --source perf_schema
   ```
5. **Ad-hoc Query Diagnostic:** Get an immediate EXPLAIN analysis and index suggestion for a single query:
   ```sh
   slowq explain "SELECT * FROM wp_postmeta WHERE meta_key = 'sidebar_layout' AND post_id = 123"
   ```

## Commands

```sh
slowq analyze                    # parse configured slow log & generate report
slowq analyze --source perf_schema # inspect the live performance_schema instead
slowq explain "<query>"          # run ad-hoc EXPLAIN on a specific query string
slowq report --open              # open the latest generated HTML/Markdown report
```

Useful flags:
- `-c, --config <file>`: path to config file (default: `config.yml`)
- `--source <slowlog|perf_schema>`: override the configuration analysis source
- `--no-db`: run log parsing in pure-offline mode (skips live database connection / EXPLAIN diagnostics)
- `--top <n>`: only diagnose the top N offending query shapes (default: 20)

## The Analysis & Diagnosis Pipeline

The utility evaluates database performance using these steps:
1. **Ingest:** Parses raw lines from a standard MySQL slow query log (`slowlog.js`) or queries the live `performance_schema.events_statements_summary_by_digest` table (`perfschema.js`).
2. **Normalize:** Normalizes raw query payloads into shapes (`digest.js`). It strips out specific literal values, number sequences, and inline lists (e.g., `WHERE id IN (1, 2, 3)` becomes `WHERE id IN (?)`). This collapses thousands of separate query events into single, identifiable "query shapes."
3. **Aggregate:** Calculates per-shape metrics including total count, cumulative run-time, mean latency, p95 latency, and the average ratio of rows examined versus rows actually returned (`aggregate.js`).
4. **Rank:** Sorts shapes by **Total Time Impact** (run-time × execution count), ensuring that a query that runs 1,000,000 times taking 10ms each is prioritized over a query that runs once taking 5 seconds.
5. **Diagnose:** Connects to the database and runs `EXPLAIN` against the normalized query structures with bound dummy variables (`diagnose.js`). It matches the execution plans against index rules and queries `information_schema` to identify missing keys.
6. **WordPress Hygiene Checks:** Identifies classic WordPress performance bottlenecks (`wp.js`), such as unindexed `wp_postmeta` joins or `wp_options` autoload bloat.

## WordPress Bloat Checks

When auditing a WordPress database, the analyzer runs targeted health checks:
- **`wp_options` Autoload Size:** Queries the database to calculate the total size of options marked with `autoload = 'yes'`. If this size exceeds the configured threshold (default `800 KB`), a warning is raised. Autoloaded option bloat directly slows down every single page request.
- **Unindexed Meta Key Queries:** Detects heavy query shapes targeting `wp_postmeta` and reports if composite index enhancements are missing.

## Config (`config.yml`)

```yaml
source: slowlog                  # slowlog | performance_schema
slow_log_path: /var/log/mysql/slow.log

# Database connection details (used for EXPLAIN diagnostics and index analysis).
# If the db block is omitted, slowq runs in log-only offline mode.
db:
  host: 127.0.0.1
  port: 3306
  name: sitedb
  user: readonly
  pass_env: DB_RO_PASSWORD       # names the environment variable holding the password

top_n: 20                        # limit diagnostic EXPLAINs to the top N query shapes
min_total_time_ms: 500           # exclude query digests with low total runtimes

wp:
  autoload_warn_kb: 800          # alert when WordPress autoload option size exceeds this limit
```

## Output Report

The analysis generates reports in the `report/` directory:
- **`report_<timestamp>.md`**: A detailed Markdown dossier classifying query offenders. Findings are categorized into **High Confidence (Actionable Index suggested)**, **Requires Investigation**, and **System/Internal** query groups.
- **`report_<timestamp>.json`**: The complete query statistics list, useful for automated performance tracking systems.

## Gotchas

- **Read-Only Verification:** Always verify that the DB credentials assigned to `slowq` are restricted to read-only capabilities (`SELECT` only).
- **EXPLAIN Constraints:** `EXPLAIN` results run against dummy bound literals can sometimes deviate slightly from production plans that utilize real client values. Propose and test index recommendations manually before applying them to a live production database.
- **Index Cost Warning:** Adding database indexes speeds up reads but incurs a tiny cost during write operations (`INSERT`/`UPDATE`). Be strategic and target only high-frequency query shapes.
