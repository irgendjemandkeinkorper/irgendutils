# @irgendutils/wp-subdomain-spinup

Provision a fresh, branded, plugin-ready WordPress subdomain site cloned from a reference template in a single command.

```
spinup create acme --template template-classic --apply
# DNS updated → multisite clone complete → URLs rewritten → theme activated → SSL verified!
```

**REST-first, SSH-optional.** Built on the standard WordPress REST API and Application Passwords. It uses SSH/WP-CLI *only* for the one thing REST cannot do: creating a sub-site inside a WordPress Multisite network (`wp site create`). It detects SSH at startup and, if absent, degrades gracefully by printing the exact manual command to run on the server while proceeding with everything else over REST.

## Install

Requires Node.js ≥ 18 ESM.

```sh
cd wp-subdomain-spinup
npm install
npm link                               # optional: `spinup` on PATH
# or just: node src/cli.js
```

## Quickstart

1. **Configure:** Copy `config.example.yml` to `config.yml` and adjust your network domain and adapters.
2. **Set secrets:** Create a `.env` file containing your WordPress Application Password:
   ```env
   WP_APP_PASSWORD=xxxx xxxx xxxx xxxx xxxx xxxx
   ```
3. **Dry-run:** Preview the provisioning plan without making any changes:
   ```sh
   spinup create acme --template template-classic
   ```
4. **Apply:** Provision the live subdomain:
   ```sh
   spinup create acme --template template-classic --apply
   ```

## Commands

```sh
spinup list                                                    # list all subsites in the network
spinup create <sub> --template <template> [--brand brand.json] # dry-run: review the plan
spinup create <sub> --template <template> --apply              # actually provision
spinup verify <sub> --template <template>                      # run all 6 verification checks
spinup teardown <sub>                                          # dry-run teardown
spinup teardown <sub> --apply                                  # fully remove site & DNS records
```

Run logs are written to `runs/` for troubleshooting. The logger automatically
removes logs older than 30 days and caps the directory at the 50 newest log
files. These files may contain internal hostnames, URLs, and provisioning
details; `runs/*.log` is intentionally ignored by Git and must never be
force-added to a commit.

## Config (`config.yml`)

The configuration file defines the operating mode, endpoints, and adapters for DNS and server access:

```yaml
mode: multisite                        # multisite | standalone
network_url: https://example.com
wp_cli_ssh: user@host:/var/www/example.com  # WP-CLI over SSH (multisite create only; optional)
template_slug: _template               # default template to clone
rest:
  base_url: https://{sub}.example.com  # target site REST URL pattern
  user: automation                     # REST super-admin user
  app_password_env: WP_APP_PASSWORD    # names the environment variable
dns:
  provider: cloudflare                 # cloudflare | route53 | manual
  zone: example.com
```

## Adapters

### 1. WordPress Access (REST & SSH)
- **REST Adapter** (`rest.js`): Authenticates via WordPress Application Passwords. Handles cloning content, option updates, branding, and status verification.
- **WP-CLI SSH Adapter** (`wpcli-ssh.js`): Optional. Runs `wp site create` via non-interactive SSH. If SSH is not configured or unavailable, the app will pause and prompt you to run the command manually, continuing seamlessly once confirmed.

### 2. DNS Providers
- **Cloudflare** (`dns-cloudflare.js`): Uses Cloudflare's API to add/remove `A` records dynamically. Requires `CLOUDFLARE_API_TOKEN` in `.env`.
- **Route53** (`dns-route53.js`): Interacts with AWS Route53 to update hosted zones. Requires AWS credentials in `.env` or system keychain.
- **Manual** (`dns-manual.js`): Prints required DNS records for you to configure manually (ideal when wildcard DNS is already in place).

## The Provisioning Pipeline

When you run `spinup create <sub> --apply`, the engine orchestrates these steps:
1. **Input Validation:** Confirms subdomain slug is valid and doesn't conflict with existing sites or reserved paths.
2. **DNS Setup:** Creates target `A`/`CNAME` records via the configured provider.
3. **Provisioning:** Provisions a empty/placeholder subsite on the network (using SSH or manual pause).
4. **Cloning:** Copies posts, pages, terms, media references, and custom menus from the `--template` site.
5. **URL Rewrite:** Performs a serialized-safe search-and-replace to update URLs from the template to the new subdomain.
6. **Branding:** (Optional) Applies title, tagline, logo, primary colors from `--brand brand.json`.
7. **TLS/SSL Check:** Validates that the SSL certificate is active and serving content over HTTPS.
8. **Verification:** Executes the suite of 6 verification checks.

## Verification Checks

`spinup verify` validates site readiness across 6 dimensions:
1. **DNS Resolution:** Subdomain resolves to the expected IP address over HTTPS.
2. **HTTP Status:** Target home page responds with HTTP `200`.
3. **Rewrite Check:** Confirms `search-replace` has zero remaining references to the template domain.
4. **Theme Activation:** Confirms the template's active theme is active on the subsite.
5. **Plugins Check:** Confirms all plugins that were active on the template are active on the subsite.
6. **REST Auth:** Verifies that administrative REST API operations are functional.

## Human Runbook & Automation

While the CLI can automate the entire flow, some steps (like uploading physical theme directories) are manual. Refer to [RUNBOOK.md](./RUNBOOK.md) for step-by-step instructions on setting up themes, building templates, creating administrative network users, and dealing with edge cases.

## Gotchas

- **Wildcards:** For subdomain multisites, wildcard DNS (`*.example.com`) and wildcard server vhosts must already exist for subdomains to resolve without per-site server configuration.
- **`wp search-replace` Safety:** Cloned database strings contain serialized data. The rewrite engine parses serialized strings safely. Never use a raw SQL `REPLACE` to update domains, as it will break serialized options.
- **Cloudflare Proxying:** Cloudflare's CDN proxy (orange cloud) can mask origin-level SSL or connectivity issues during initial setup.
- **Standalone Mode:** Standalone mode assumes a WordPress core installation is already present at the target directory/server, and uses REST to seed it.
