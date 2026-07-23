# CLAUDE.md — Backup Dump + Restore-to-Scratch Verifier

Prove backups work by the only test that counts: **restore into a throwaway
environment and check the result.** Dump the DB (optionally files), restore into a
scratch `verify_<ts>` DB/subdomain, run integrity + smoke checks, report pass/fail,
then tear it down. "A backup you've never restored isn't a backup."

## Architecture map
- **Stack:** Node ESM CLI (`node >=18`). Planned entry: `src/cli.js` (bin `verifybak`).
- **Status:** spec + scaffold stage — currently `package.json`, `config.example.yml`,
  `.env.example`. `src/` not yet built; implement to the workflow below.
- **Composes with the toolkit** rather than reinventing: calls **wp-subdomain-spinup**
  to create a scratch site and **wp-qa-playwright** to smoke-test the restored front
  end. DB work uses **WP-CLI / mysqldump / mysql** where shell access exists, REST
  export where it must.
- **Where NOT to look:** `node_modules/`, generated `report/`.

## Deeper context lives in the vault
Durable knowledge (restore-timing baselines, host-specific gotchas) goes in the
Obsidian vault under `vault/`. Open the matching note before reading source.

## Config (`config.example.yml`)
```yaml
source: { type: file, db_dump: /backups/latest.sql.gz, files_archive: /backups/uploads-latest.tar.gz }
scratch: { db_name_prefix: verify_, mysql_host: 127.0.0.1, mysql_admin_env: MYSQL_ADMIN_PW, spinup_subdomain: verify }
checks: [row_counts, key_tables, wp_bootstrap, smoke_urls]
retain_on_failure: false
notify_on: [failure]
```

## Workflow (to implement)
1. **Locate + fetch** latest backup (local/S3/`wp db export`); record age + size (stale
   or tiny dump is itself a finding).
2. **Restore into scratch:** create `verify_<timestamp>` DB, import, time it, capture errors.
3. **Integrity:** all expected tables present; key-table row counts non-zero + within
   sane bounds vs last run; `CHECK TABLE`; `wp core is-installed`, `siteurl` present, admins exist.
4. **Optional live smoke** (`--with-smoke`): point a scratch subdomain (spinup) at the
   restored DB, run a small QA pass (wp-qa-playwright) — home 200, no fatals, login works.
5. **Report** pass/fail with timing, backup age, row-count deltas, warnings.
6. **Tear down** scratch DB/subdomain — **always, via a trap, even on failure**.

## Key commands
```
verifybak run                    # fetch → restore → check → teardown
verifybak run --with-smoke       # also spin up a scratch site and QA it
verifybak run --retain-on-failure
verifybak history                # trend: pass/fail, restore time, backup size
npm test                         # node --test
```

## Conventions / house rules
- **Scratch is disposable + isolated** — clearly-named throwaway DB/subdomain, NEVER
  over an existing env; timestamp the name (no fixed name across concurrent runs).
- **Read-from-source only** — never mutate the production backup or source DB.
- Runs **on a schedule** (weekly/nightly); non-zero exit on failure so it alerts.
- Verify: good backup restores clean; a truncated/corrupt fixture FAILS with a clear
  reason (the whole point); scratch is gone after every run (assert it), even on
  failure; row-count deltas vs previous run are reported.

## Gotchas
- Huge dumps are slow / fill disk — check free space first, stream the import, clean up
  the fetched dump after.
- `mysqldump` without `--single-transaction` on InnoDB can produce inconsistent dumps —
  validate the dump source, not just the restore.
- The scratch subdomain must be `noindex` + firewalled — it briefly holds real PII.

## Do NOT
- Don't edit this file mid-task (breaks the prompt cache). Don't restore over a real
  env. Don't skip teardown. Don't reformat outside task scope.
