# CLAUDE.md — Charset / Collation Consistency Checker

## What this app does
Scan a database (WordPress or otherwise) for **character set and collation
mismatches** — the invisible cause of the classic "emoji, accented characters, and
smart quotes turn into ��� / Ã© mojibake" bug. Reports every table/column that
isn't on the intended charset (almost always `utf8mb4`) and generates the safe
conversion DDL. Read-only by default; conversion is opt-in and gated.

## Shared house rules
- **Stack:** small **PHP or Node/TS** CLI. Read-only inspection uses a read-only DB
  user; any conversion runs only under `--apply` with a backup precondition.
- **REST-aware, DB-direct:** inspection is a direct DB read (charset lives in
  `information_schema`, not exposed over REST). For WP, cross-reference `wp db` /
  `DB_CHARSET` in `wp-config.php` so the app's "intended" charset matches the site's.
- **Never convert without a verified backup.** `--apply` must refuse unless a fresh
  dump exists (ideally hand off to the backup-restore-verifier first).
- Idempotent: a second run after conversion reports zero mismatches.

## Config
```yaml
db:
  host: 127.0.0.1
  name: sitedb
  user: readonly
  pass_env: DB_RO_PASSWORD
target_charset: utf8mb4
target_collation: utf8mb4_unicode_ci
scope: all                 # all | tables:[wp_posts,wp_postmeta]
require_backup_before_apply: true
```

## Workflow
1. **Read intended charset:** from config and, for WP, from `wp-config.php`
   (`DB_CHARSET`/`DB_COLLATE`) and the WP version's default. Warn if the site config
   itself disagrees with `utf8mb4`.
2. **Inspect three levels** via `information_schema`:
   - Database default charset/collation.
   - Each table's charset/collation.
   - Each **text/varchar column's** charset/collation (columns can differ from their
     table — this is where the real bugs hide).
3. **Also check the connection charset** — a `utf8mb4` database served over a
   `latin1`/`utf8` connection still corrupts data. Flag `SET NAMES` / client-charset
   mismatch.
4. **Report** every mismatch grouped by table, with severity (a mismatched column
   holding user content = high).
5. **Generate conversion DDL** (`ALTER TABLE ... CONVERT TO CHARACTER SET utf8mb4 ...`)
   in dependency-safe order — but only *emit* it by default. `--apply` runs it after
   the backup gate.
6. Re-inspect and confirm zero mismatches post-conversion.

## Key commands
```
charset scan                     # report mismatches (read-only)
charset scan --scope tables:wp_postmeta
charset ddl                      # emit conversion SQL, don't run it
charset convert --apply          # gated: requires backup, then converts + re-verifies
```

## Output
- `report/<timestamp>.md` — mismatches by table/column + connection-charset check.
- `convert.sql` — the ordered ALTER statements, ready to review.

## Acceptance criteria (verification step)
- On a fixture DB with a deliberately `latin1` column, the tool flags exactly that
  column and produces correct `utf8mb4` DDL.
- A fully-`utf8mb4` fixture reports zero mismatches.
- `--apply` refuses when no backup is present.
- Post-conversion re-scan is clean and a round-trip of a 4-byte emoji through the
  converted column survives intact (assert the stored bytes).

## Gotchas
- `utf8` in MySQL is only 3 bytes and can't store emoji/some CJK — `utf8mb4` is the
  real UTF-8. Never treat `utf8` as correct.
- Index length limits: converting to `utf8mb4` can overflow the 191/767-byte index
  prefix on old row formats — check for `VARCHAR(255)` unique indexes and warn.
- Converting *changes bytes on disk* — this is the one destructive op here; the
  backup gate is not optional.
- Fixing the tables but leaving the connection charset wrong re-corrupts new data —
  always check both.
