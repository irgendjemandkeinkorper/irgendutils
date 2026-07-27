# @irgendutils/wp-charset-collation-checker

Scan database tables and columns for **character set and collation mismatches** — the invisible, silent culprits behind corrupt text, missing emojis, and mojibake (e.g. smart quotes or accented letters rendering as ``, `Ã©`, or `??`).

Generates ordered, safe Data Definition Language (DDL) conversion SQL to unify your tables, columns, and database collations to modern `utf8mb4`.

**Read-only by default.** All scans are completely non-destructive and use a read-only database user. Database conversion via the `--apply` flag is strictly opt-in and **gated by a mandatory, verified database backup check**.

## Install

Requires Node.js ≥ 18 ESM.

```sh
cd wp-charset-collation-checker
npm install
npm link                               # optional: `charset` on PATH
# or just: node src/cli.js
```

## Quickstart

1. **Configure:** Copy `config.example.yml` to `config.yml` and adjust connection parameters.
2. **Set secrets:** Create a `.env` file containing your database passwords:
   ```env
   DB_RO_PASSWORD=your_readonly_password
   DB_RW_PASSWORD=your_write_password_for_conversions   # only needed for --apply
   ```
3. **Scan Database:** Perform a read-only inspection for mismatches:
   ```sh
   charset scan
   ```
4. **Generate DDL SQL:** Output the recommended migration SQL statements to review:
   ```sh
   charset ddl
   ```
5. **Apply Conversion:** Convert the database tables (requires a fresh, verified local backup file to pass safety gates):
   ```sh
   charset convert --apply
   ```

## Commands

```sh
charset scan                     # report character set/collation mismatches (read-only)
charset scan --scope tables:wp_postmeta # scan only the specified table list
charset ddl                      # compile and emit recommended conversion SQL
charset convert --apply          # execute conversion statements on the database
```

Useful flags:
- `-c, --config <file>`: path to config file (default: `config.yml`)
- `--scope <all|tables:[list]>`: filter the table scope of the operation
- `--apply`: run the conversion statement queue (needs read-write credentials)

## The Three-Level Deep Scan

Many migration tools only check table-level defaults. This utility inspects **three critical levels** to find hidden encoding bugs:
1. **Database default:** Verifies the base schema default collation.
2. **Table default:** Audits table-level creation parameters.
3. **Column definitions:** Examines the encoding of *each individual character column* (e.g., `VARCHAR`, `TEXT`, `LONGTEXT`). This is where real encoding bugs hide: a column can retain a `latin1` encoding even after the parent table has been altered to `utf8mb4`.
4. **Connection check:** Measures the connection encoding. A `utf8mb4` database queried over a `latin1` driver connection will still return corrupt characters to the application.

## WordPress Integration

If you specify the path to `wp-config.php` in `config.yml`, the checker:
- Parses active `DB_CHARSET` and `DB_COLLATE` configuration variables.
- Cross-checks them against the database targets.
- Warns you if the WordPress configuration itself is on legacy 3-byte `utf8` instead of `utf8mb4` (WordPress configurations on `utf8` will trigger MySQL's 3-byte UTF-8 implementation, which breaks 4-byte characters like emojis and mathematical symbols).

## The Safety Backup Gate

Database conversion is a highly destructive operation if anything goes wrong. To prevent accidental data loss, the `charset convert --apply` command enforces safety checks:
- It **refuses to run** unless a fresh database backup dump file exists at the path specified in `config.yml` under `backup.path`.
- It validates the timestamp of the backup file, ensuring it is no older than the configured limit (default: `24 hours`).

## Config (`config.yml`)

```yaml
db:
  host: 127.0.0.1
  port: 3306
  name: sitedb
  user: readonly
  pass_env: DB_RO_PASSWORD            # read-only connection credentials
  apply_user: admin                 # admin credentials for actual conversion
  apply_pass_env: DB_RW_PASSWORD

target_charset: utf8mb4
target_collation: utf8mb4_unicode_ci

scope: all                            # all | tables:[wp_posts,wp_postmeta]

wp_config: /var/www/site/wp-config.php # parsed to crosscheck active WP settings

require_backup_before_apply: true
backup:
  path: backups/sitedb.sql            # database dump file must exist
  max_age_hours: 24                   # backup must be fresh (within 24 hours)

report_dir: report
```

## Gotchas

- **Index Length Pitfall:** MySQL's `utf8` maps characters to a maximum of 3 bytes, while `utf8mb4` maps to 4 bytes. Converting columns to `utf8mb4` expands index footprints. On legacy MySQL servers with a 767-byte unique index key limit, converting a `VARCHAR(255)` index will cause an overflow error (`255 * 4 = 1020 bytes > 767 bytes`). The checker identifies these columns and issues warnings.
- **`utf8` vs `utf8mb4`:** In MySQL, `utf8` is a legacy alias for `utf8mb3` (3-byte). Always convert to `utf8mb4` to support modern Unicode standards.
- **Connection Alignment:** Fixing the tables is only half the battle. Ensure your application driver specifies `utf8mb4` connection parameters, or WordPress will continue saving/retrieving data with the wrong encoding.
