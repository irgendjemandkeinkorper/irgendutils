# WordPress Extension Inventory and Risk Reporter

A robust, read-only Python 3.11+ CLI tool to inventory WordPress core, plugins, themes, and must-use (MU) plugins from live WP-CLI environments or offline fixtures. It flags inactive, unknown-version, and update-available extensions using a configurable risk policy engine and emits deterministic outputs in JSON, CSV, and formatted terminal reports.

## Features

- **Multi-Source Adapters**:
  - **Live WP-CLI**: Executes safe subprocess commands securely (zero shell interpolation).
  - **Offline Fixtures**: Direct JSON file mocks for air-gapped environment audits.
- **Configurable Risk Policies**:
  - Flags inactive plugins and themes (a common entry point for exploits).
  - Flags unknown or missing versions (blocking vulnerability scans).
  - Flags update-available extensions and core updates.
  - Custom rules for **disallowed** and **allowed** extensions lists.
  - Enforces minimum required WordPress core version.
  - Configurable risk severity level mapping (`low`, `medium`, `high`, `critical`).
- **Strict Safety first**:
  - Restricts subprocess execution exclusively to safe query operations.
  - Automatic masking of passwords, secrets, and authorization keys in standard outputs and logging.
  - Never mutates state (no install, activate, update, delete, or upload operations).
- **Flexible Formats & CI-ready**:
  - Deterministic console output, JSON object exports, and CSV spreadsheet summaries.
  - Configurable exit gate behavior (`--fail-on-risk` and `--fail-severity`) to block CI/CD pipelines when high-risk findings are discovered.
  - Standard library only—zero external Python dependency requirements.

---

## Installation & Requirements

- **Python**: 3.11 or newer.
- **WP-CLI** (optional): Needed only for live WordPress scans.

```bash
# Clone or copy into your monorepo utilities
cd wp-extension-inventory
```

---

## Usage

### 1. Offline Mode (using fixtures)
```bash
python3 src/main.py --fixture-dir fixtures/
```

### 2. Live WP-CLI Mode
```bash
# From the root of a WordPress installation
python3 /path/to/wp-extension-inventory/src/main.py
```

### 3. Output Formats
- **Terminal Summary (Default)**:
  ```bash
  python3 src/main.py --fixture-dir fixtures/
  ```
- **JSON Format**:
  ```bash
  python3 src/main.py --fixture-dir fixtures/ --format json
  ```
- **CSV Export**:
  ```bash
  python3 src/main.py --fixture-dir fixtures/ --format csv --output-file inventory_report.csv
  ```

### 4. Policy Customization
Pass a policy JSON file to enforce specific rules:
```bash
python3 src/main.py --fixture-dir fixtures/ --policy my-policy.json
```

### 5. CI/CD Gate Enforcement
To block a deployment pipeline on critical or high risks:
```bash
python3 src/main.py --fixture-dir fixtures/ --fail-on-risk --fail-severity high
```

---

## Configuration Policy Format

Create a custom policy JSON file (e.g., `policy.json`):

```json
{
  "flag_inactive": true,
  "flag_unknown_version": true,
  "flag_update_available": true,
  "min_core_version": "6.5.0",
  "allowed_plugins": [],
  "disallowed_plugins": [
    "hello-dolly",
    "easy-wp-smtp"
  ],
  "allowed_themes": [],
  "disallowed_themes": [],
  "severity_rules": {
    "inactive": "medium",
    "unknown_version": "medium",
    "update_available": "high",
    "disallowed": "critical",
    "core_outdated": "critical",
    "not_allowed": "high"
  }
}
```

---

## Development & Testing

Run unit tests directly using the built-in python test runner:

```bash
python3 -m unittest discover -s tests
```
