# Runbook — spin up a themed subdomain site

End-to-end process for taking a theme from the local template library to a
live, verified `<sub>.<zone>` site. Written for a human; the `/spinup-site`
skill automates the same steps. Placeholders: `<zone>` is your network domain
(see `network_url` in `config.yml`), `<theme>` the theme slug, `<sub>` the new
subdomain.

## 0. One-time prerequisites (already done if `spinup list` works)

- `config.yml` — copy from `config.example.yml`; gitignored because it names
  internal hosts. Key fields: `mode: multisite`, `wp_cli_ssh: <alias>:<webroot>`,
  `dns.provider` (`manual` if DNS/TLS/vhost are wildcarded — then no per-site
  DNS work is ever needed).
- `.env` — `WP_APP_PASSWORD` for the REST user in `config.yml`. Create one:
  `wp user application-password create <rest-user> spinup --porcelain`.
  The REST user must be a super admin.
- If the server is root-only, WP-CLI refuses to run without `--allow-root`.
  Fix once with a wrapper that non-interactive SSH picks up first:
  `printf '#!/bin/sh\nexec /usr/local/bin/wp --allow-root "$@"\n' > /usr/local/sbin/wp && chmod 755 /usr/local/sbin/wp`

## 1. Per-theme: create the template site (once per theme)

spinup clones a live **template site**, not a theme folder. Convention:
template site slug = `template-<theme>` (never plain `<theme>` — that slug
stays available for a real subdomain, and template slugs are reserved).

```sh
# from the template library on your machine
rsync -az path/to/<theme> <ssh-alias>:<webroot>/wp-content/themes/
ssh <ssh-alias> '
  chown -R www-data:www-data <webroot>/wp-content/themes/<theme>
  wp --path=<webroot> site create --slug=template-<theme> --title="<Theme> Template"
  wp --path=<webroot> theme enable <theme> --network
  wp --path=<webroot> --url=https://template-<theme>.<zone> theme activate <theme>'
```

## 2. Create the site

```sh
spinup create <sub> --template template-<theme>          # dry-run: review the plan
spinup create <sub> --template template-<theme> --apply
```

`--template` overrides the config's `template_slug` for this run — always pass
it explicitly so you can't clone from whatever template the last run used.
The engine handles DNS, `wp site create` (over SSH), clone, **theme activation**
(WP-CLI — WP's REST API cannot activate themes; without SSH it prints the exact
manual command), URL rewrite, TLS check, and full verify. Add
`--brand brand.json` to set title/tagline/logo/primary color.

## 3. Optional: add an admin user to the new site

```sh
# new network user:
ssh <ssh-alias> 'wp --path=<webroot> --url=https://<sub>.<zone> \
  user create <login> <email> --role=administrator'
# login already exists on the network (error: "already registered"):
ssh <ssh-alias> 'wp --path=<webroot> --url=https://<sub>.<zone> \
  user set-role <login> administrator'
```

Omit `--user_pass` to have WP generate a strong password (printed once).

## 4. Verify

```sh
spinup verify <sub> --template template-<theme>   # all 6 checks must pass
curl -s https://<sub>.<zone>/ | grep -o 'themes/<theme>'   # renders the theme
```

## 5. Teardown (full reverse)

```sh
spinup teardown <sub> --apply
spinup list      # confirm it's gone
```

Never tear down a `template-*` site — every future `create` for that theme
clones it.

## Known gotchas

- One verify FAIL on `template theme is the active theme` on older runs means
  the theme-activation step was skipped (no SSH) — run the printed
  `wp theme enable ... --activate` command and re-verify.
- `siteurl` on new subsites is `http://` (network default); sites serve https
  fine via the wildcard cert.
- Cloned sites inherit the template's title (e.g. "<Theme> Template") — rebrand
  with `--brand` or `wp option update blogname`.
