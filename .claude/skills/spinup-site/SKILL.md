---
name: spinup-site
description: Spin up a new themed subdomain site on the WP multisite network using wp-subdomain-spinup — deploy the theme, create/reuse its template site, create the subsite, add an admin, verify. Use when asked to "spin up" a new subdomain/site from a template-library theme.
---

# Spin up a themed subdomain site

Automates `wp-subdomain-spinup/RUNBOOK.md` (read it for the full rationale).
Args (ask if missing): **subdomain**, **theme** (a slug under
`~/projects/template-library/block-themes/` or `classic-themes/`), optional
**admin user** (login/email/password) to add to the new site.

All commands run from `wp-subdomain-spinup/`. Network specifics (zone, SSH
alias, webroot) come from the gitignored `config.yml` — read `wp_cli_ssh` and
`network_url` from it; never hardcode them. Secrets are only in `.env`.

## Steps

1. **Preflight:** `config.yml` and `.env` exist; the theme directory exists
   locally. `node src/cli.js list` succeeds (proves SSH + config). If any of
   this fails, stop and follow RUNBOOK.md §0.
2. **Template site** (skip if `list` already shows `template-<theme>`):
   rsync the theme dir to `<webroot>/wp-content/themes/`, then over SSH:
   chown to www-data, `wp site create --slug=template-<theme>
   --title="<Theme> Template"`, `wp theme enable <theme> --network`, activate
   the theme on `template-<theme>.<zone>`.
3. **Dry-run, then create:**
   `node src/cli.js create <sub> --template template-<theme>` — review plan —
   then re-run with `--apply`. ALWAYS pass `--template` explicitly; the
   config's `template_slug` is whatever the previous run left. Theme
   activation on the new site is automatic when SSH is up.
4. **Admin user** (if requested): over SSH with `--url=https://<sub>.<zone>`:
   `wp user create <login> <email> --role=administrator [--user_pass=...]`;
   if it errors "already registered", use `wp user set-role <login>
   administrator` instead (network user exists — just add to this site).
   If no password was specified, let WP generate one and report it.
5. **Verify:** `node src/cli.js verify <sub> --template template-<theme>`
   must pass 6/6, and `curl` the homepage to confirm `themes/<theme>` appears
   in the HTML. Report the live URL, wp-admin URL, and any admin credentials.

Teardown on request: `node src/cli.js teardown <sub> --apply` (never for
`template-*` sites).
