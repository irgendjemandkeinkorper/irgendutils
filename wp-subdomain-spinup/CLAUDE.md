# CLAUDE.md — WP Subdomain Spinup

Given a template site and a target subdomain, provision a new WordPress site and seed
it from the template so a fresh, branded, plugin-ready site is live in one command.
`spinup create acme` → `acme.example.com` cloned from `_template`.

## Architecture map
- **Stack:** Node ESM CLI (`node >=18`). Entry: `src/cli.js` (bin `spinup`).
- **Core:** `src/engine.js` (orchestrates validate → DNS → provision → clone → brand →
  TLS → verify), `src/subdomain.js` (input validation / collision check),
  `src/config.js` + `src/yaml.js` (load `config.example.yml`), `src/runlog.js`
  (timestamped log of every external call).
- **Adapters** (`src/adapters/`): `rest.js` (REST + Application Passwords — the
  default path), `wpcli-ssh.js` (WP-CLI over SSH — optional, only for multisite
  `wp site create`), `dns-cloudflare.js` / `dns-route53.js` / `dns-manual.js`,
  `index.js` (adapter selection).
- **Where NOT to look:** `node_modules/`, run logs.

## Deeper context lives in the vault
Durable knowledge (host quirks, multisite vs subdirectory decisions) goes in the
Obsidian vault under `vault/`. Open the matching note before reading source.

## Config (`config.example.yml`)
```yaml
mode: multisite            # multisite | standalone
network_url: https://example.com
wp_cli_ssh: user@host:/var/www/example.com   # multisite-create over SSH only
template_slug: _template
rest: { base_url: https://{sub}.example.com, user: automation, app_password_env: WP_APP_PASSWORD }
dns: { provider: cloudflare, zone: example.com }   # cloudflare | route53 | manual
```

## Key commands
```
spinup create <sub> --brand brand.json [--apply]
spinup teardown <sub> [--apply]
spinup list
spinup verify <sub>
npm test                         # node --test
```

## Conventions / house rules
- **REST-first, SSH-optional (IMPORTANT):** build every capability on REST +
  Application Passwords. WP-CLI over SSH is used ONLY for the one thing REST can't do —
  creating a multisite network site (`wp site create`). Detect SSH at startup; when
  absent, emit the exact manual command and resume, rather than failing. Everything
  after site creation runs over REST in both modes.
- **Idempotent + reversible:** every create has a matching teardown; **dry-run by
  default**, `--apply` to mutate. Never hand-edit the DB when WP-CLI can do it.
- Secrets from env (`.env`), never committed. Log every REST/WP-CLI call to a run log.
- **Verify before success:** subdomain resolves over https → 200; siteurl reports the
  new subdomain; `search-replace` count == 0 on a dry re-run; template plugins active +
  theme active; authed REST call works; `teardown` fully removes site + DNS (confirm via
  `list`).

## Gotchas
- Multisite subdomain vs subdirectory (`SUBDOMAIN_INSTALL`) differs; wildcard DNS +
  vhost must already exist for subdomain multisite.
- `wp search-replace` handles serialized data — never a raw SQL `REPLACE`; always
  dry-run the count first.
- Cloudflare proxied records can mask TLS/origin errors — verify the origin too.
- REST-only mode can't create a WP install from nothing; standalone mode assumes WP
  core already installed at the target.

## Do NOT
- Don't edit this file mid-task (breaks the prompt cache). Don't run destructive ops
  without `--apply`. Don't assume SSH is present. Don't reformat outside task scope.
