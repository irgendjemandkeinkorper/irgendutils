# @irgendutils/secrets-env-audit

Secure your applications with a comprehensive, two-in-one security scanner: (1) **Secret Scan** — find leaked credentials, tokens, passwords, and private keys committed to git history or left in files; (2) **Env Drift Audit** — detect missing variables and structure drift across local, staging, and production environment files.

**Safe and Read-Only.** This utility only reads files and performs static analysis. It **never prints plain-text secret values** in reports (all findings are masked, e.g. `sk-****abcd`) and never modifies files or Git history.

```
                  secrets-env-audit (secaudit)
                    ├── Secret Pattern & Entropy Scan (incl. Git History)
                    ├── Environment Drift Comparison (Keys & Types)
                    └── Public Web Exposure Probe (Exposed config files)
```

## Install

Requires Node.js ≥ 18 ESM and a system `git` installation for scanning repository history.

```sh
cd secrets-env-audit
npm install
npm link                               # optional: `secaudit` on PATH
# or just: node src/cli.js
```

## Quickstart

1. **Configure:** Copy `config.example.yml` to `config.yml` and specify the directory roots, git rules, and environment file locations.
2. **Execute Complete Audit:** Run the complete audit suite (Secrets, Drift, and Web Exposure probes):
   ```sh
   secaudit run
   ```
3. **Scan Secrets Only:** Walk local directories and Git logs to identify potential leaks:
   ```sh
   secaudit scan
   ```
4. **Audit Env Drift:** Review environment configuration synchronization:
   ```sh
   secaudit drift
   ```

## Commands

```sh
secaudit run                     # execute the secret scanner, env-drift, and web-probe
secaudit scan                    # execute only the static secret & pattern scanner
secaudit drift                   # execute only the environment file synchronization audit
secaudit web-probe               # execute only the public configuration exposure test
```

Useful flags:
- `-c, --config <file>`: path to config file (default: `config.yml`)
- `--no-git`: skip scanning git commit history during secret analysis

## Features

### 1. Secret Scanner (`scan.js` + `rules.js`)
- **Pattern Matching:** Detects structured credentials such as AWS keys, Google API keys, Stripe tokens, GitHub Personal Access Tokens (PATs), Database connection strings, and WordPress Salts.
- **High-Entropy Scanner:** Analyzes source files for randomized high-entropy strings (such as private encryption keys or generic passwords) that don't match typical keywords.
- **Git History Auditing:** Searches your **entire git commit history** to find secrets that were deleted from active files but still reside in older commits.
- **Supported source files:** The default scan walks text files in configured roots, including Python (`*.py`), JavaScript/TypeScript, PHP, YAML, JSON, shell, and configuration files. Binary files, lockfiles, examples, and configured ignore paths are skipped as appropriate.

### 2. Environment Drift (`drift.js`)
- Loads multiple environment variables from specified files (e.g. `.env`, `.env.staging`, `.env.prod`).
- Calculates the **union of all keys** across files and reports missing keys in each environment.
- **Shape Comparison:** Safely evaluates and alerts if variable structures differ between files (e.g. if a variable is configured as a `bool` in staging but as a `number` or empty in production) without ever revealing the underlying secret values.
- **Python package coverage:** Python projects may declare `.env`, `.env.local`, or other environment files in `env_drift.envs` exactly like Node projects. The current Python utilities do not ship an `.env.example`; when one is added, list it explicitly alongside the corresponding local/staging files.

### 3. Public Web Exposure Probe (`webprobe.js`)
- Probes target domain URLs to verify if configuration and source control structures are exposed to the public internet.
- Checks classic vulnerable endpoints, including `/.env`, `/wp-config.php.bak`, `/.git/config`, and `/config.php~`.

## Filtering False Positives

To avoid noise from test values or mock keys in code, `secaudit` supports a hashed allowlist:
- Name your allowlist file in `config.yml` (default: `.secretsallow`).
- Add the SHA-256 hashes of known-safe strings (such as development mock tokens) to `.secretsallow` (one hash per line). The scanner will safely skip these matches.

## Configuration (`config.yml`)

```yaml
scan:
  roots: [~/sites/acme, ~/sites/beta]
  include_git_history: true
  ignore: [node_modules, vendor, .git/objects, "*.min.js", "*.lock", report]
  allowlist_file: .secretsallow       # SHA-256 hashes of mock/development test keys

rules: [aws, gcp, stripe, github_pat, private_key, generic_high_entropy, db_url, wp_salts]

web_probe:                            # public config exposure checks
  urls: [https://acme.example.com]
  paths: [/.env, /wp-config.php.bak, /.git/config, /config.php~]

env_drift:
  envs:
    - { name: local,   file: .env }
    - { name: staging, file: .env.staging }
    - { name: prod,    file: .env.prod }
  compare: keys_and_shape             # "keys" | "keys_and_shape"
```

## Scorecard Reports

The auditor generates files inside `report/`:
- **`report_<timestamp>.md`**: Detailed markdown dossier highlighting leaks and drift. Leaks include filenames, line numbers, and masked snippets (`sk-****abcd`) with clear mitigation instructions. **Never commit this report file to public Git repositories.**
- **`report_<timestamp>.json`**: Structured audit statistics for pipeline verification.

## Gotchas

- **Git Purging:** Deleting a secret from the active codebase is **insufficient**. If `secaudit` flags a secret in Git history, the credential has been compromised. You must immediately **rotate the credential** with the provider and then purge the commit history using tools like `git-filter-repo` or BFG.
- **Mock Variable Warnings:** Never use `.env.example` placeholder text as a production key list; ensure your comparison rules ignore example placeholder keys.
- **Lockfile Noise:** High-entropy searches can flag minified files or package lockfiles. Ensure `node_modules` and lockfile patterns are included in your `ignore` rules list.
