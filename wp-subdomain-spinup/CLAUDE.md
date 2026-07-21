# CLAUDE.md — WP Subdomain Spinup

## What this app does
Given a template site and a target subdomain, provision a new WordPress site as a
subdomain and seed it from the template so a fresh, branded, plugin-ready site is
live in one command. Example: `spinup acme` → `acme.example.com` cloned from the
`_template` site.

## Shared house rules (apply to every IRgendutils app)
- **Stack:** WP-native first. Use **WP-CLI** and **PHP** for anything that touches
  WordPress internals; reach for **Node** only where a JS-only tool is genuinely
  better (e.g. Playwright verification). Never hand-edit the database when WP-CLI
  can do it.
- **REST-first, SSH-optional (IMPORTANT):** the **default access path is the REST
  API + Application Passwords** — it works on essentially every modern WP host with
  zero server access, so build every capability on REST first. Treat **WP-CLI over
  SSH as an optional optimization** used ONLY for the one thing REST genuinely
  cannot do: creating a brand-new site inside a multisite network
  (`wp site create`). At startup, **detect** whether WP-CLI/SSH is reachable; if it
  is, use it for the multisite-create step, and if it isn't, fall back to a clear
  "manual step required" message rather than failing. Everything after site
  creation (cloning, brand tokens, URL rewrite, verification) runs over REST in
  both modes. Never assume SSH is present.
- **Idempotent + reversible:** re-running a command must not corrupt state. Every
  create action needs a matching teardown/rollback. Prompt (or require a flag)
  before anything destructive.
- **Secrets from env, never committed.** `.env` for local, real secrets injected
  at runtime. Provide `.env.example`.
- **Dry-run by default for destructive ops.** `--apply` to actually mutate.
- **Verify before declaring success** (see Acceptance criteria). A command that
  "ran" is not the same as one that worked.
- Log every external call (WP-CLI invocation, REST request) with timestamp to a
  run log so failures are debuggable after the fact.

## Config
`config.yml` (or `.env`) defines:
```yaml
mode: multisite            # multisite | standalone
network_url: https://example.com
wp_cli_ssh: user@host:/var/www/example.com   # for multisite over SSH
template_slug: _template                       # source site to clone
rest:
  base_url: https://{sub}.example.com
  user: automation
  app_password_env: WP_APP_PASSWORD            # read from env, not here
dns:
  provider: cloudflare       # cloudflare | route53 | manual
  zone: example.com
```

## Workflow (what Claude Code should implement)
1. **Validate input** — subdomain is lowercase, DNS-safe, not already taken
   (check the network site list / a `GET` to the URL). Abort on collision unless
   `--force`.
2. **DNS** — if `dns.provider` is set, create the A/CNAME record pointing the
   subdomain at the host. If `manual`, print the record the user must add and wait
   for confirmation. Poll until it resolves (with timeout).
3. **Provision the site** (the only step that may need SSH):
   - *Multisite:* creating the network site requires `wp site create --slug=<sub>
     --url=...` — this is the one operation with no REST equivalent. Use WP-CLI over
     SSH if detected; if SSH is unavailable, stop and emit the exact command for the
     user to run, then resume once the site exists. Activate the template's theme +
     plugin set afterward (REST is fine for activation).
   - *Standalone:* assume the vhost/WP core already exists (or provision via the
     host's API if available); everything here runs over REST — no SSH needed.
4. **Clone from template:** copy the template's active theme, plugin set + settings,
   menus, and a starter set of pages/posts. Prefer `wp site` export/import or a
   content-copy routine over raw SQL. Rewrite URLs from the template domain to the
   new subdomain (`wp search-replace`, dry-run first).
5. **Brand tokens:** apply per-site overrides (site title, tagline, logo, primary
   color) from a small `--brand` JSON so each spinup isn't identical.
6. **TLS:** ensure the subdomain has a cert (wildcard cert covers it, or trigger
   issuance). Fail loudly if the site only serves on http.
7. **Verify + report** (below), then print the live URL and admin login.

## Key commands (target CLI shape)
```
spinup create <sub> --brand brand.json [--apply]
spinup teardown <sub> [--apply]
spinup list
spinup verify <sub>
```

## Acceptance criteria (verification step — do not skip)
- The subdomain resolves over **https** and returns 200.
- `wp option get siteurl` (or REST `/wp-json`) reports the new subdomain, not the
  template's.
- No leftover template-domain URLs in content (`search-replace` count == 0 on a
  dry re-run).
- Template plugins are active; template theme is the active theme.
- Admin user can log in (smoke-test an authenticated REST call).
- `teardown` fully removes the site + DNS record and leaves the network clean.
  Confirm by re-running `list`.

## Gotchas
- Multisite subdomain vs subdirectory config — read `SUBDOMAIN_INSTALL`; the
  approach differs. Wildcard DNS + wildcard vhost must already exist for subdomain
  multisite.
- `wp search-replace` on serialized data: always use WP-CLI (it handles
  serialization); never a raw SQL `REPLACE`.
- Cloudflare proxied records can mask TLS/origin errors — verify against the origin
  too.
- REST-only mode can't create a whole WP install from nothing; document that
  standalone mode assumes the WP core is already installed at the target.
- Multisite site-creation is the single hard SSH dependency — everything else has a
  REST path. Keep that boundary explicit so the app degrades to "one manual command"
  on hosts without shell access rather than breaking.
- `wp search-replace` (serialization-safe URL rewrite) ideally wants WP-CLI; over
  REST, do the rewrite before import or via a small helper endpoint, and always
  dry-run the count first.
