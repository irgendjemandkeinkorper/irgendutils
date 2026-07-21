# CLAUDE.md — Backup Dump + Restore-to-Scratch Verifier

## What this app does
Prove that backups actually work by doing the only test that counts: **restore them
into a throwaway environment and check the result.** Dump the DB (and optionally
files), restore into a scratch database/subdomain, run integrity + smoke checks,
report pass/fail, then tear the scratch environment down. "A backup you've never
restored isn't a backup."

## Shared house rules
- **Stack:** **WP-CLI / mysqldump / PHP** for DB work; can call **subdomain-spinup
  (#1)** to create a scratch site and **wp-qa-playwright (#2)** to smoke-test the
  restored front end. Composes with the toolkit rather than reinventing.
- **REST-first, SSH-optional:** DB dump/restore prefers `wp db export/import` or
  `mysqldump`/`mysql` where shell access exists; falls back to a REST-driven export
  where it must. Detect and degrade.
- **Scratch is disposable and isolated.** Restore into a clearly-named throwaway DB
  (`verify_<ts>`) or subdomain — NEVER over an existing environment. Always tear it
  down, even on failure (trap + cleanup).
- **Read-from-source only.** Never mutate the production backup or source DB.
- Designed to run **on a schedule** (weekly/nightly) and alert on failure.

## Config
```yaml
source:
  type: file             # file | s3 | wp-cli-export
  db_dump: /backups/latest.sql.gz
  files_archive: /backups/uploads-latest.tar.gz   # optional
scratch:
  db_name_prefix: verify_
  mysql_host: 127.0.0.1
  mysql_admin_env: MYSQL_ADMIN_PW
  spinup_subdomain: verify   # optional: use subdomain-spinup for a live smoke test
checks: [row_counts, key_tables, wp_bootstrap, smoke_urls]
retain_on_failure: false     # keep scratch DB for debugging if true
notify_on: [failure]
```

## Workflow
1. **Locate + fetch** the latest backup (local path, S3, or a fresh `wp db export`).
   Record its age and size — a stale or tiny dump is itself a finding.
2. **Restore into scratch:** create `verify_<timestamp>` DB, import the dump. Time
   it and capture any import errors/warnings.
3. **Integrity checks:**
   - Dump restored without error; expected tables all present.
   - Row counts for key tables are non-zero and within sane bounds vs the last run.
   - `CHECK TABLE` / no corruption on critical tables.
   - For WP: `wp core is-installed` against the scratch DB succeeds; option
     `siteurl` present; user table has admins.
4. **Optional live smoke test:** point a scratch subdomain (via #1) at the restored
   DB and run a small QA pass (via #2) — homepage 200, no fatal errors, login works.
5. **Report** pass/fail with timing, backup age, row-count deltas, and any warnings.
6. **Tear down** the scratch DB/subdomain (always — cleanup runs in a trap). Alert
   if `notify_on` matches.

## Key commands
```
verifybak run                    # full dump-fetch → restore → check → teardown
verifybak run --with-smoke       # also spin up a scratch site and QA it
verifybak run --retain-on-failure
verifybak history                # trend: pass/fail, restore time, backup size over runs
```

## Output
- `report/<timestamp>.json` + `.md` — pass/fail, backup age/size, restore duration,
  row-count table, warnings. History file for trend lines.
- Non-zero exit on failure so a scheduled task can alert.

## Acceptance criteria (verification step)
- A good backup restores clean and passes all checks.
- A deliberately truncated/corrupt dump fixture FAILS with a clear reason (this is
  the whole point — prove it catches bad backups).
- Scratch DB/subdomain is gone after every run (assert it no longer exists), even
  when the run failed.
- Row-count deltas vs previous run are reported, so a silently-shrinking backup is
  visible.

## Gotchas
- Restoring a huge dump can be slow / fill disk — check free space first and stream
  the import; clean up the fetched dump after.
- `mysqldump` without `--single-transaction` on InnoDB can lock or produce
  inconsistent dumps — validate the dump source, not just the restore.
- The scratch subdomain must be `noindex` and firewalled from real traffic — it
  holds real (possibly PII) data briefly.
- Don't reuse a fixed scratch DB name across concurrent runs — timestamp it.
