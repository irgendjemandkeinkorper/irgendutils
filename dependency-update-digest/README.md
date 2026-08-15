# @irgendutils/dependency-update-digest

Aggregate, classify, and digest outdated dependencies across multiple projects and package managers (Composer, npm, pip/requirements.txt, and WordPress plugins/themes) into a single actionable report.

**Read-only and risk-free.** This tool never updates package files, never installs modules, and never modifies files. It parses native outputs to help you separate urgent security patches and major-version jumps from routine minor/patch releases.

```
          dependency-update-digest (depdigest)
                ├── npm outdated (JavaScript)
                ├── pip list / pip-audit (Python)
                ├── composer outdated (PHP)
                └── wp plugin/theme list (WordPress)
```

## Install

Requires Node.js ≥ 18 ESM, and the native package managers (`npm`, `python`/`pip`, `composer`, or `wp-cli`) depending on the projects you wish to audit. Python projects use `pip list --outdated` and optionally `pip-audit`.

```sh
cd dependency-update-digest
npm install
npm link                               # optional: `depdigest` on PATH
# or just: node src/cli.js
```

## Quickstart

1. **Configure:** Create a `config.yml` detailing your project paths and target repositories:
   ```yaml
   projects:
     - name: Acme Frontend
       path: /var/www/acme/frontend
       types: [npm]
     - name: Acme Backend
       path: /var/www/acme/backend
       types: [composer]
     - name: Acme Python Tool
       path: /var/www/acme/python-tool
       types: [pip]
     - name: Acme WordPress
       wp_rest: https://acme-site.com
       app_password_env: WP_APP_PASSWORD
       types: [wordpress]
   ```
2. **Set secrets:** Create a `.env` file containing any necessary REST API credentials:
   ```env
   WP_APP_PASSWORD=xxxx xxxx xxxx xxxx xxxx xxxx
   ```
3. **Run Digest Scan:** Perform a complete check across all targets:
   ```sh
   depdigest run
   ```

## Commands

```sh
depdigest run                    # scan all configured projects and output the digest
depdigest run --project acme      # scan only the specified project name
depdigest run --only security    # filter output to display only urgent security advisories
depdigest report --open          # compile the analysis into HTML and open it in a browser
```

Useful flags:
- `-c, --config <file>`: path to config file (default: `config.yml`)
- `--project <name>`: limit the scan to a single project
- `--only <security|major>`: filter findings by update classification
- `--deep`: traverse nested dependency trees (default: direct dependencies only to reduce noise)

## The Normalization & Classification Pipeline

1. **Scan via Adapters:** Shells out to ecosystem tools using lightweight adapters (`adapters/live.js` executes `npm outdated --json`, `composer outdated --format=json`, and `wp plugin/theme list --format=json`). For remote WordPress sites with no SSH shell, it connects via the read-only WordPress REST API to fetch active plugin statuses.
2. **Normalize:** Aggregates multi-tool JSON outputs into a standardized row shape: `{ project, package, current, latest, jump, security }` (`normalize.js`).
3. **Classify:** Determines the update severity using semver algorithms (`classify.js`):
   - **Security:** High-severity advisory matches (checked against known database indexes).
   - **Major:** High-risk major-version jumps that can introduce breaking API changes.
   - **Minor / Patch:** Low-risk routine upgrades.
4. **Digest Compilation:** Group findings cleanly by severity and project (`digest.js`). It places urgent security patches at the very top of the report, followed by major jumps, and packages minor/patch updates in collapsed, low-priority blocks to keep reports concise.
5. **History Tracking:** Compares the active run against the previous run's database (`history.js`), highlighting "newly outdated" elements since your last scan.

## Configuration (`config.yml`)

```yaml
projects:
  - name: Corporate Portal
    path: /sites/corp
    types: [npm, composer]

  - name: Client WordPress Site
    wp_rest: https://client-site.com
    app_password_env: WP_APP_PASSWORD
    types: [wordpress]

severity:
  flag_major: true
  security_source: npm-audit     # or composer-audit / wordfence

digest:
  group_by: severity             # severity | project
  direct_deps_only: true         # only show direct dependencies by default
```

## Output Reports

The runner outputs files in the `digest/` folder:
- **`digest_<timestamp>.md`**: A beautifully formatted Markdown ledger. This file is ready to be committed to project vaults, pasted into Slack channels, or printed as a weekly client update.
- **`digest_<timestamp>.json`**: Structured statistical manifest of the run.

## Scheduled Digests

To establish a routine audit, wire `depdigest` into a weekly cron job. The utility is programmed to return a **non-zero exit code** if any unresolved security advisories are found, allowing it to easily trigger warnings in Slack channels or monitoring centers:

```sh
# Run every Monday morning at 8 AM
0 8 * * 1 cd /path/to/dependency-update-digest && node src/cli.js run --only security >/dev/null 2>&1
```

## Gotchas

- **Tool Failures:** `depdigest` is robust against ecosystem timeouts. If `npm outdated` exits non-zero (which it natively does when packages are outdated), the runner safely captures and parses the JSON output rather than crashing.
- **REST Limitations:** WordPress REST audits require an administrative Application Password to read the complete active plugin version tables.
- **Security False Positives:** Update availability does not automatically signify a security vulnerability. `depdigest` cross-references package names against advisories so you aren't forced to treat every patch as an emergency.
