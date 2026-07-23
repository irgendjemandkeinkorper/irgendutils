# CLAUDE.md — Charset / Collation Consistency Checker

Scan a database (WordPress or otherwise) for **charset/collation mismatches** — the
invisible cause of "emoji / accents / smart quotes turn into ��� / Ã© mojibake."
Reports every table/column not on the intended charset (almost always `utf8mb4`) and
generates safe conversion DDL. Read-only by default; conversion is opt-in and gated.

## Architecture map
- **Stack:** Node ESM CLI (`node >=18`). Entry: `src/cli.js` (bin `charset`).
- **Core:** `src/inspect.js` (three-level `information_schema` read: DB / table /
  column charset), `src/ddl.js` (emit ordered `ALTER … CONVERT TO … utf8mb4`),
  `src/convert.js` (gated `--apply` runner), `src/backup.js` (fresh-dump precondition),
  `src/wpconfig.js` (parse `DB_CHARSET`/`DB_COLLATE` from `wp-config.php`),
  `src/report.js`, `src/config.js` + `src/yaml.js` (`config.example.yml`).
- **Adapters** (`src/adapters/`): `mysql.js` (live read-only DB), `fixture.js` (JSON test double).
- **Tests/fixtures:** `test/*.test.js`; `fixtures/{clean-utf8mb4,legacy-mess,mixed-latin1}.json`
  and `wp-config-utf8{,mb4}.php`.
- **Where NOT to look:** `node_modules/`, generated `report/`, `convert.sql`.

## Deeper context lives in the vault
Durable knowledge (index-length pitfalls, host defaults) goes in the Obsidian vault
under `vault/`. Open the matching note before reading source.

## Config (`config.example.yml`)
```yaml
db: { host: 127.0.0.1, name: sitedb, user: readonly, pass_env: DB_RO_PASSWORD }
target_charset: utf8mb4
target_collation: utf8mb4_unicode_ci
scope: all                 # all | tables:[wp_posts,wp_postmeta]
require_backup_before_apply: true
```

## Key commands
```
charset scan                     # report mismatches (read-only)
charset scan --scope tables:wp_postmeta
charset ddl                      # emit conversion SQL, don't run it
charset convert --apply          # gated: requires backup, converts + re-verifies
npm test                         # node --test
```

## Conventions / house rules
- **Read-only inspection** via a read-only DB user; charset lives in `information_schema`,
  not REST. For WP, cross-reference `wp-config.php` so "intended" charset matches the site;
  warn if the site config itself disagrees with `utf8mb4`.
- Inspect **three levels** (DB / table / **column** — columns can differ from their
  table, where the real bugs hide) AND the **connection charset** (a utf8mb4 DB over a
  latin1 connection still corrupts).
- **Never convert without a verified backup:** `--apply` refuses unless a fresh dump
  exists (ideally hand off to backup-restore-verifier first). Idempotent — a re-run
  after conversion reports zero mismatches.
- Verify: a `latin1` fixture column is flagged with correct DDL; a full-`utf8mb4`
  fixture reports zero; `--apply` refuses with no backup; post-conversion re-scan is
  clean and a 4-byte emoji round-trips intact.

## Gotchas
- MySQL `utf8` is 3-byte and can't store emoji/some CJK — `utf8mb4` is the real UTF-8;
  never treat `utf8` as correct.
- Converting to `utf8mb4` can overflow the 191/767-byte index prefix on old row formats —
  check `VARCHAR(255)` unique indexes and warn.
- Conversion **changes bytes on disk** — the one destructive op here; the backup gate is
  not optional.
- Fixing tables but leaving the connection charset wrong re-corrupts new data — check both.

## Do NOT
- Don't edit this file mid-task (breaks the prompt cache). Don't run `--apply` without a
  backup. Don't treat `utf8` as `utf8mb4`. Don't reformat outside task scope.
