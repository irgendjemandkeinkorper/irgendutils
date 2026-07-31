# Game Localization QA Toolkit

The Game Localization QA Toolkit is a fast, highly-customizable, zero-dependency command-line interface (CLI) written in Python (3.11+) designed specifically for narrative games. It parses game-string catalogs (canonical vs. translated locale files) to detect missing translations, extra strings, duplicate keys, tag/formatting imbalances, placeholder drifts, line break inconsistencies, and expansion limits.

## Project Structure
```
game-localization-qa/
├── README.md               # User guide & CLI usage reference
├── CLAUDE.md               # Authoritative module-level spec
├── fixtures/               # Reference translation catalogs & configs
│   ├── canonical.json      # Canonical English JSON reference catalog
│   ├── locale_fr.json      # French translation JSON catalog
│   ├── canonical.csv      # Canonical English CSV reference catalog
│   ├── locale_es.csv      # Spanish translation CSV catalog
│   ├── canonical.po        # Canonical English PO reference catalog
│   ├── locale_de.po        # German translation PO catalog
│   └── config.json         # Custom config with ignore rules & thresholds
├── src/
│   └── game_localization_qa/
│       ├── __init__.py
│       ├── adapters.py     # Clean custom CSV, JSON, and PO parsers
│       ├── config.py       # Configuration and ignore rules manager
│       ├── checker.py      # Core translation validation checks
│       └── cli.py          # CLI entry point, output formatter & reporters
└── tests/
    ├── __init__.py
    ├── test_adapters.py    # Unit tests for custom file adapters
    ├── test_checker.py     # Unit tests for individual validation rules
    └── test_cli.py         # Integration tests verifying exit codes & outputs
```

## Features

- **Multi-Format Adapters**: Built-in, lightweight custom parsers for standard localization formats (JSON, CSV, PO/gettext) with absolutely zero runtime dependencies.
- **Robust Key Comparison**: Locates missing string IDs, extra translated strings, and tracks duplicate IDs in source catalogs.
- **Placeholder & Markup Integrity**: Uses configured regex patterns to identify typos or drift in custom variable tokens (e.g., `{player_name}` vs. `{player_nam}`) and HTML/XML tag structures (e.g., mismatched or unmatched markup tags like `<b>` / `</b>`).
- **Layout & Line break Drift**: Flags discrepancies in layout directives (literal `\n` character strings or raw newlines) to avoid text box overflow.
- **Locale-Specific Ignores**: Configurable global and language-specific rules to bypass checks on specific keys or categories.
- **Expansion Metrics**: Sets customized length-based multipliers to highlight strings that exceed visual text container bounds.

---

## Authoritative Specifications

### 1. Verification Command
To run the complete test suite and verify compliance:
```bash
PYTHONPATH=src python3 -m unittest discover -s tests -p "test_*.py"
```

### 2. Supported Formats & Rules
- **JSON Adapter**: Handles both simple flat key-value pairs (e.g. `{"ID": "Value"}`) and complex key-metadata maps or arrays containing `id` and `text` properties.
- **CSV Adapter**: Employs an RFC-4180-compliant state-machine parser. Auto-detects identity columns (e.g., `id`, `key`, `string_id`) and translation values (e.g., `text`, `value`, `translation`).
- **PO/gettext Adapter**: Hand-crafted extractor that handles standard PO-style metadata, comments, multi-line segments, and string unescaping.

---

## Core Code Conventions
- Keep code entirely dependency-free: do not import third-party libraries (e.g., do not import `pandas`, `polib`, etc.). Rely exclusively on Python standard library modules (`json`, `csv`, `re`, `argparse`, `unittest`, `subprocess`).
- Return deterministic status/exit codes:
  - `0`: Completed successfully with no errors or issues.
  - `1`: Syntax, configuration, missing files, or system execution errors.
  - `2`: Completed check successfully but localization flaws or duplicate keys were found.
