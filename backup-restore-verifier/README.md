# @irgendutils/backup-restore-verifier

Prove database and site backups actually work by running the only test that counts: **restore them into a temporary throwaway environment and verify the results.**

It fetches the latest backup archive, imports it into a dynamically provisioned, timestamped scratch database, performs deep schema and content integrity assertions, optionally spins up a live staging subdomain to execute browser-driven smoke tests, records performance metrics, and tears everything down safely.

*"A backup you've never restored is not a backup."*

```
          backup-restore-verifier (backup-restore-verifier)
                │ (with-smoke)
                ▼
        wp-subdomain-spinup ──► wp-qa-playwright (Visual & Smoke checks)
```

## Install

Requires Node.js ≥ 18 ESM, MySQL/MariaDB client tools, and optional WordPress-CLI depending on your environment adapters.

```sh
cd backup-restore-verifier
npm install
npm link                               # optional: `verifybak` on PATH
# or just: node src/cli.js
```

## Quickstart

1. **Configure:** Copy `config.example.yml` to `config.yml` and adjust connection parameters, thresholds, and target table assertions.
2. **Set secrets:** Create a `.env` file containing your admin credentials:
   ```env
   MYSQL_ADMIN_PW=your_mysql_root_password
   ```
3. **Run Integrity Check:** Perform a local database restore, run schema and content checks, and clean up the scratch database:
   ```sh
   verifybak run
   ```
4. **Run End-to-End Live Smoke Test:** Restore the backup, instruct `wp-subdomain-spinup` to provision a temporary site pointing to this database, run browser QA audits via `wp-qa-playwright`, and tear down:
   ```sh
   verifybak run --with-smoke
   ```

## Commands

```sh
verifybak run                    # fetch, restore, run integrity checks, and tear down
verifybak run --with-smoke       # execute checks and spin up a staging site for QA smoke testing
verifybak run --retain-on-failure # skip automatic teardown on failure for manual debugging
verifybak history                # display trends: pass/fail rates, restore timings, dump size growth
```

Useful flags:
- `-c, --config <file>`: path to config file (default: `config.yml`)
- `--with-smoke`: provision a temporary URL and execute Playwright tests
- `--retain-on-failure`: prevent database/subdomain destruction if errors occur (ideal for root-cause debugging)

## The Verification Workflow

1. **Fetch & Analyze:** Locates the latest backup archive (from local disk, AWS S3, or via a remote `wp db export`). Evaluates the age of the dump (warns if stale) and the size of the dump (fails if empty or suspiciously small).
2. **Provision Scratch Environment:** Generates a timestamped, isolated database named `<prefix><timestamp>` (e.g. `verify_1700000000`) on your target server.
3. **Restore Data:** Imports the backup into the scratch database, measuring performance timings and capturing standard import errors.
4. **Integrity Audit:** Runs deep internal assertions:
   - Verifies all configured critical tables exist (`expected_tables`).
   - Asserts that row counts in key tables are non-zero (`key_tables`).
   - Runs database-native checks (`CHECK TABLE`).
   - Queries table counts and alerts if a key table has shrunk by more than your defined threshold (e.g. `row_count_max_shrink_pct: 50`), which indicates a truncated or corrupted backup.
   - Cross-checks WordPress indicators: ensures `siteurl` option is valid and administrator roles exist.
5. **Live Browser Smoke Check (Optional):** Points a disposable subdomain at the restored database, runs a `wp-qa-playwright` pass (confirming home page responds 200, assets resolve, no JavaScript fatals, and admin login functions).
6. **Report:** Generates a summary detailing backup age, size trends, table row-count deltas, and execution warnings.
7. **Tear Down:** Destroys the scratch database and removes the subdomain. **Crucially, teardown is registered as a trap and will execute even if the import fails or throws exceptions.**

## Config (`config.yml`)

```yaml
source:
  type: file                         # file | s3 | wp-cli-export
  db_dump: /backups/latest.sql.gz
  files_archive: /backups/uploads-latest.tar.gz
  max_age_hours: 48                  # backup older than this fails (stale)
  min_size_bytes: 10240              # backup smaller than this fails (corrupt)

scratch:
  db_name_prefix: verify_            # timestamped databases prefix
  mysql_host: 127.0.0.1
  mysql_admin_user: root
  mysql_admin_env: MYSQL_ADMIN_PW    # env var holding the MySQL root password
  spinup_subdomain: verify           # base subdomain name for --with-smoke checks

checks: [row_counts, key_tables, wp_bootstrap, smoke_urls]

expected_tables: [wp_options, wp_users, wp_usermeta, wp_posts, wp_postmeta]
key_tables: [wp_posts, wp_users, wp_options]
row_count_max_shrink_pct: 50         # fail if key table shrinks by more than 50% vs last run

retain_on_failure: false             # true to keep the scratch database on failure
notify_on: [failure]

driver: mysql                        # mysql (live) | fake (offline testing)
wp_path: /var/www/example.com        # WP path used for WP-CLI checks

report_dir: report
history_file: report/history.json
```

## Scheduled Execution (CI/CD)

The utility is optimized to run as a weekly or nightly cron/scheduled task. It exits non-zero on failure, enabling immediate integration with alerting webhooks or pager integrations:

```sh
# Crontab entry: run every Sunday at 2 AM
0 2 * * 0 cd /path/to/backup-restore-verifier && node src/cli.js run --with-smoke --no-color
```

## Gotchas

- **Resource Limits:** Restoring huge databases can consume significant disk space and CPU. `verifybak` evaluates free disk space prior to importing, streams compressed dumps, and cleans up temporary downloads immediately.
- **Transactional Consistency:** Backups generated without `--single-transaction` can occasionally contain mismatched relation row counts. `verifybak` flags these anomalies so you can optimize your backup exporter.
- **Security & PII:** The scratch environment briefly holds real production data (including user emails and content). In `--with-smoke` mode, the scratch site is provisioned with `noindex` enabled and can optionally be firewalled to limit access.
