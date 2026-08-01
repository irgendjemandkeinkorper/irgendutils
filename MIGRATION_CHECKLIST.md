# Irgendutils CLI Migration Checklist

This is a generated checklist detailing the standardization progress of JSON outputs, error envelopes, and exit codes across the irgendutils monorepo CLI utilities.

## Migration Status Summary

- **Total Utilities:** 15
- **Standardized:** 5 / 15 (33%)

## Standardized CLI Contract Details

Every standardized utility must support a `--json` parameter. When `--json` is active:
1. **Exit Codes:**
   - `0` (Success): all checks passed / operations succeeded.
   - `1` (Gate Failure): check failed or blocker triggered.
   - `2` (Invalid Input / Usage / Configuration).
   - `3` (Missing Dependency / Environment).
   - `4` (Unexpected Crash / Fatal error).
2. **Silence on stdout:** All logs, progress messages, and non-JSON output go to stderr (`console.error`). Only the standardized JSON contract goes to stdout.
3. **Redaction:** Secrets loaded from the environment or config are redacted from output.

## CLI Registry Checklists

### [x] @irgendutils/wp-subdomain-spinup

- **Path:** `wp-subdomain-spinup/`
- **Compliance Status:** Standardized and Contract Compliant
- **Features Implemented:** Standardized envelope, correct exit codes, stdout isolation, secret redaction, contract unit test.

### [x] @irgendutils/wp-qa-playwright

- **Path:** `wp-qa-playwright/`
- **Compliance Status:** Standardized and Contract Compliant
- **Features Implemented:** Standardized envelope, correct exit codes, stdout isolation, secret redaction, contract unit test.

### [x] @irgendutils/prelaunch-auditor

- **Path:** `prelaunch-auditor/`
- **Compliance Status:** Standardized and Contract Compliant
- **Features Implemented:** Standardized envelope, correct exit codes, stdout isolation, secret redaction, contract unit test.

### [x] @irgendutils/image-convert

- **Path:** `image-convert/`
- **Compliance Status:** Standardized and Contract Compliant
- **Features Implemented:** Standardized envelope, correct exit codes, stdout isolation, secret redaction, contract unit test.

### [x] @irgendutils/post-deploy-smoke-test

- **Path:** `post-deploy-smoke-test/`
- **Compliance Status:** Standardized and Contract Compliant
- **Features Implemented:** Standardized envelope, correct exit codes, stdout isolation, secret redaction, contract unit test.

### [ ] @irgendutils/html-to-gutenberg

- **Path:** `html-to-gutenberg/`
- **Compliance Status:** Pending Migration
- **TODO:** Add `--json`, route progress to stderr, implement standard `buildResultsJson` envelope, ensure standardized exit codes.

### [ ] @irgendutils/obsidian-vault-forge

- **Path:** `obsidian-vault-forge/`
- **Compliance Status:** Pending Migration
- **TODO:** Add `--json`, route progress to stderr, implement standard `buildResultsJson` envelope, ensure standardized exit codes.

### [ ] @irgendutils/site-migration-scraper

- **Path:** `site-migration-scraper/`
- **Compliance Status:** Pending Migration
- **TODO:** Add `--json`, route progress to stderr, implement standard `buildResultsJson` envelope, ensure standardized exit codes.

### [ ] @irgendutils/sql-slow-query-analyzer

- **Path:** `sql-slow-query-analyzer/`
- **Compliance Status:** Pending Migration
- **TODO:** Add `--json`, route progress to stderr, implement standard `buildResultsJson` envelope, ensure standardized exit codes.

### [ ] @irgendutils/wp-charset-collation-checker

- **Path:** `wp-charset-collation-checker/`
- **Compliance Status:** Pending Migration
- **TODO:** Add `--json`, route progress to stderr, implement standard `buildResultsJson` envelope, ensure standardized exit codes.

### [ ] @irgendutils/backup-restore-verifier

- **Path:** `backup-restore-verifier/`
- **Compliance Status:** Pending Migration
- **TODO:** Add `--json`, route progress to stderr, implement standard `buildResultsJson` envelope, ensure standardized exit codes.

### [ ] @irgendutils/dns-ssl-uptime-monitor

- **Path:** `dns-ssl-uptime-monitor/`
- **Compliance Status:** Pending Migration
- **TODO:** Add `--json`, route progress to stderr, implement standard `buildResultsJson` envelope, ensure standardized exit codes.

### [ ] @irgendutils/dependency-update-digest

- **Path:** `dependency-update-digest/`
- **Compliance Status:** Pending Migration
- **TODO:** Add `--json`, route progress to stderr, implement standard `buildResultsJson` envelope, ensure standardized exit codes.

### [ ] @irgendutils/secrets-env-audit

- **Path:** `secrets-env-audit/`
- **Compliance Status:** Pending Migration
- **TODO:** Add `--json`, route progress to stderr, implement standard `buildResultsJson` envelope, ensure standardized exit codes.

### [ ] @irgendutils/repo-template

- **Path:** `repo-template/`
- **Compliance Status:** Pending Migration
- **TODO:** Add `--json`, route progress to stderr, implement standard `buildResultsJson` envelope, ensure standardized exit codes.
