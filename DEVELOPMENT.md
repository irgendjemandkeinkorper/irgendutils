# Contributor Guide & local CI Replication

This monorepo of lightweight utility apps is structured such that each utility is a self-contained, independent package under its own directory. Every package has its own `package.json`, dependencies, tests, and its own authoritative `CLAUDE.md` file specifying module behavior.

---

## Shared Testing Standards

1. **No External Network Dependencies in Unit Tests:** All package unit test suites (`node --test`) must run completely offline without needing API secrets, live web servers, or active database connections. They use mock adapters, pre-recorded responses, or localized file-system fixtures.

2. **Every package needs real tests:** CI rejects missing or placeholder test scripts and rejects Node or Python packages that report zero test files. A package is not considered covered merely because its test command exits successfully.
2. **Deterministic & Reversible:** Tests perform no state-mutating changes in production environments.
3. **Normalized Error Output:** CLI subprocess tests are normalized to explicitly output the subprocess's `stdout` and `stderr` upon test failure, enabling quick pinpointing of the underlying assertion failure rather than generic test errors.

---

## Local Development & Reliable Test Execution

### Running Tests for a Specific Package

Each package is fully independent. To run tests for a single package:

1. Navigate to the package directory or use `--prefix`:
   ```bash
   # Navigate and run
   cd image-convert
   npm install
   npm test

   # Or run from the monorepo root
   npm --prefix image-convert install
   npm --prefix image-convert test
   ```

2. All implemented utilities use Node.js's native test runner (`node --test`), which is fast and reliable.

### Python packages

Python utilities use Python 3.11+ and keep their tests offline and deterministic, following the same no-external-network standard as the Node packages above. From a package directory:

```bash
cd disk-growth-analyzer  # replace with the package you are working on
python3 -m venv .venv
. .venv/bin/activate

# Install only when the package declares dependencies.
python -m pip install -r requirements.txt  # if requirements.txt exists
python -m pip install -e '.[test]'        # if pyproject.toml exposes this extra

# Use the package's documented runner; these are the common forms.
python -m pytest -q
python -m unittest discover -s tests -p 'test_*.py'
```

Python unit tests must not require live HTTP services, credentials, databases, or other external network access. Use fixtures and local adapters instead. The CI matrix is being extended to discover Python packages in [issue #48](https://github.com/irgendjemandkeinkorper/irgendutils/issues/48); once that lands, its detected package list should be the authoritative cross-check for this local workflow.

---

## Reproducing CI Logic Locally

The monorepo uses a dynamic path-aware CI workflow to validate PRs and merges. It only tests packages that have files changed, unless global workflows/configurations are modified, or the workflow is run manually.

To reproduce and inspect the exact CI matrix discovery logic locally, you can execute the matrix detection script:

```bash
# Run detection simulating a workflow_dispatch event (matches all implemented packages)
GITHUB_EVENT_NAME=workflow_dispatch node scripts/detect-ci-matrix.mjs

# Run detection simulating a PR event compared to origin/main
GITHUB_EVENT_NAME=pull_request GITHUB_BASE_REF=main node scripts/detect-ci-matrix.mjs

# Run detection simulating a standard git push event
GITHUB_EVENT_NAME=push node scripts/detect-ci-matrix.mjs
```

### Running the Entire Monorepo Test Suite Locally

If you are preparing a large PR or want to be absolutely sure you haven't introduced regressions anywhere across the codebase, you can execute the offline test suite for all packages in a single run:

```bash
# Install dependencies and execute tests across all active packages
for pkg in backup-restore-verifier dependency-update-digest dns-ssl-uptime-monitor html-to-gutenberg image-convert obsidian-vault-forge post-deploy-smoke-test prelaunch-auditor secrets-env-audit sql-slow-query-analyzer wp-charset-collation-checker wp-qa-playwright wp-subdomain-spinup; do
  echo "=== Testing $pkg ==="
  npm --prefix "$pkg" install --no-audit --no-fund
  npm --prefix "$pkg" test
done
```

---

## CI Configuration (GitHub Actions)

The monorepo CI workflow is located in `.github/workflows/ci.yml`.

- **Pull Requests and Pushes to `main`:** The `detect` job identifies changed folders and passes a dynamic JSON matrix to the `test` job, spinning up parallel test runners for each changed package.
- **Dependency Caching & Safe Installs:** The workflow uses lockfile-aware dependency installs (`npm ci` if `package-lock.json` exists, fallback to `npm install` otherwise) and utilizes `actions/setup-node@v4`'s global npm dependency cache to speed up runs.
- **Production Secrets & Live Tests:** Offline CI requires zero application credentials/secrets. Existing live testing workflows (such as Daily Visual QA) remain separate and run only on scheduled triggers or manual dispatch.
