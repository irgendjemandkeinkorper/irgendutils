# CLAUDE.md — WordPress Extension Inventory and Risk Reporter

A read-only Python CLI that inventories WordPress core, plugins, themes, and must-use plugins from WP-CLI output or offline fixtures. It scans the inventory against customizable safety and risk policies, highlighting inactive, outdated, disallowed, or unknown version components, and generates JSON, CSV, or terminal reports.

## Architecture map
- **Stack:** Python 3.11+. Standard library only (zero external npm/pip dependencies for production).
- **Entry:** `src/main.py`
- **Modules:**
  - `src/adapters.py` — Raw WP-CLI subprocess wrappers and JSON fixture readers with credential masking and command safety validation.
  - `src/policy.py` — Engine for validating inventory items against customizable security rules (disallowed lists, outdated versions, inactive statuses).
  - `src/reporter.py` — Visual layout formatter for terminal stdout, CSV file dumps, and JSON file exports.
- **Tests & Fixtures:**
  - `tests/` — Test suite utilizing python's native `unittest` runner.
  - `fixtures/` — Offline mock WP-CLI payloads.

## Key commands
```bash
# Run CLI (using local fixtures or active WP-CLI)
python3 src/main.py --fixture-dir fixtures/
python3 src/main.py --fixture-dir fixtures/ --format json
python3 src/main.py --fixture-dir fixtures/ --format csv --output-file report.csv

# Running tests
python3 -m unittest discover -s tests
```

## Conventions / house rules
- **Zero non-standard imports:** Standard library modules only (`subprocess`, `argparse`, `json`, `csv`, `unittest`, `pathlib`, `re`, `logging`).
- **Strict Read-Only Enforcement:** WP-CLI subprocess adapter must explicitly reject any command string that could write, update, modify, delete, or activate any plugin, theme, or core.
- **Credential Masking:** Automatically scrub database passwords, application passwords, auth keys, salts, and tokens from all log outputs and subprocess invocation traces.
- **No Shell Interpolation:** Run commands with list arguments `subprocess.run(..., shell=False)` to prevent shell injection vectors.
- **Configurable Exit Gate:** Support `--fail-on-risk` (and `--fail-severity`) to exit with code `1` in CI/CD when risks exceed configurable severity levels.
