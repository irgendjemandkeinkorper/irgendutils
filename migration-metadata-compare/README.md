# Migration Metadata Compare

A lightweight, zero-dependency Python 3.11+ CLI tool to compare pre/post migration page-level metadata. It reports regressions, missing mappings, and duplicate crawl rows, helping you catch SEO and content regressions beyond simple redirect mapping.

## Features

- **Multi-Format Parsing**: Supports CSV and JSONL crawls for both "before" (legacy) and "after" (migrated) sites.
- **Robust Column Mapping**: Case-insensitive and alias-aware column matching (e.g., matching `canonical_url` to `canonical`, or `H1` to `h1`).
- **Flexible URL Mappings**: Supports mapping legacy URLs to migrated URLs via two-column CSVs, key-value JSONs, or list of object CSVs/JSONLs. Falls back to path-based matching (domain/protocol-agnostic) for unmapped URLs if path-matching is enabled.
- **Advanced Normalizations**:
  - **Whitespace**: Collapses multiple spaces, tabs, and newlines.
  - **URLs**: Resolves and strips domains, protocols, and trailing slashes for clean root-relative comparisons of canonical links.
  - **Robots**: Case-insensitive and order-agnostic sorting of directives (e.g. `noindex, follow` matches `follow, NOINDEX`).
  - **Schema Types**: Sorts and normalizes lists or comma-separated strings of JSON-LD types.
  - **Language Codes**: Standardizes locale codes (e.g., `en_US` and `en-us` -> `en-us`).
- **Custom Severity & Ignore Policies**: Configure field-level severities (`error`, `warning`, `info`, `ignore`) via custom JSON configurations or command-line flags.
- **Rich Reports**: Emits clean Terminal (colored ANSI), structured JSON, and beautiful standalone interactive HTML reports (with CSS and built-in filtering).
- **Deterministic and CI-Friendly**: Exits with deterministic non-zero codes on unresolved regressions of high severity (e.g., errors).

## Installation

No external dependencies are required. Just ensure Python 3.11+ is installed.

```bash
git clone <repo-url>
cd migration-metadata-compare
```

## Quick Start

```bash
python -m migration-metadata-compare.src.cli \
  --before old_crawl.csv \
  --after new_crawl.jsonl \
  --mapping url_mapping.csv \
  --html report.html \
  --json report.json
```

## CLI Usage

```text
usage: python -m migration-metadata-compare.src.cli [-h] -b BEFORE -a AFTER [-m MAPPING] [--no-fallback-path-match]
                                                    [-p POLICY_CONFIG] [--severity FIELD=LEVEL] [--fail-on-severity {error,warning,info}]
                                                    [--html HTML_PATH] [--json JSON_PATH] [--no-color]

Compare pre/post migration metadata between crawls.

options:
  -h, --help            show this help message and exit
  -b BEFORE, --before BEFORE
                        Path to the "before" crawl file (CSV or JSONL)
  -a AFTER, --after AFTER
                        Path to the "after" crawl file (CSV or JSONL)
  -m MAPPING, --mapping MAPPING
                        Path to the URL mapping file (CSV or JSON/JSONL)
  --no-fallback-path-match
                        Disable path-based fallback URL matching for unmapped pages
  -p POLICY_CONFIG, --policy-config POLICY_CONFIG
                        Path to a JSON policy config specifying field severities or ignores
  --severity FIELD=LEVEL
                        Set severity for a specific field (e.g., --severity title=warning --severity language=ignore)
  --fail-on-severity {error,warning,info}
                        Minimum severity to trigger a non-zero exit code (default: error)
  --html HTML_PATH      Path to output a standalone interactive HTML report
  --json JSON_PATH      Path to output a structured JSON report
  --no-color            Disable terminal colors
```

## Default Field Severities

By default, the comparator evaluates fields using the following severity levels when mismatching:

- `status`: `error`
- `title`: `error`
- `canonical`: `error`
- `robots`: `error`
- `description`: `warning`
- `H1`: `warning`
- `content_fingerprint`: `warning`
- `language`: `warning`
- `schema_types`: `info`

You can override these levels using the `--severity` flag or a `--policy-config` JSON file.
