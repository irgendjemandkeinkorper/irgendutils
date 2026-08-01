# Game Localization QA Toolkit

The **Game Localization QA Toolkit** is a lightweight, zero-dependency Python CLI designed to audit localized game strings for narrative-heavy projects. It parses a canonical reference catalog (English or source) and compares it against language-specific locale files to catch critical localization defects before they make it into a build.

## Key Checks

1. **Missing & Extra Keys**: Locates string IDs that are missing in the target locale or keys that exist in the target locale but not in the canonical reference.
2. **Duplicate IDs**: Detects repeated keys/IDs inside individual localization files.
3. **Placeholder / Token Drift**: Validates that all variable tokens (such as `{world_name}` or `%d`) are preserved exactly in the translation without spelling errors or mismatch.
4. **Tag Imbalance**: Confirms XML/HTML markup tags (like `<b>` and `</b>`) are properly structured and balanced inside the translation.
5. **Line-Break Drift**: Warns when the number or type (literal `\n` vs raw newlines) of line breaks differs from the source.
6. **Untranslated Strings**: Identifies translations that match the canonical string exactly (with exceptions for numbers or short strings).
7. **Text Expansion**: Flags strings that are significantly longer than the canonical original, using a tiered multiplier based on the length of the source text.

---

## Installation

This toolkit runs on **Python 3.11+** with absolutely **zero external dependencies**. All you need is standard Python.

1. Clone or download this directory:
   ```bash
   cd game-localization-qa
   ```

2. Verify your installation by running the test suite:
   ```bash
   PYTHONPATH=src python3 -m unittest discover -s tests -p "test_*.py"
   ```

---

## Usage

Run the tool through Python using its main module path:

```bash
PYTHONPATH=src python3 -m game_localization_qa.cli \
  --canonical <path_to_reference> \
  --locale <path_to_translation> \
  --locale-name <code_of_locale> \
  [optional arguments]
```

### Options

| Flag | Required | Description |
|---|---|---|
| `--canonical` | Yes | Path to the reference catalog (JSON, CSV, PO). |
| `--locale` | Yes | Path to the locale catalog to be tested (JSON, CSV, PO). |
| `--locale-name` | Yes | Code/name for the locale (e.g., `fr`, `de`, `es`). |
| `--config` | No | Path to custom ignore/expansion configuration JSON. |
| `--json-report` | No | Export details of all detected issues as a JSON report file. |
| `--csv-report` | No | Export details of all detected issues as a CSV report file. |
| `--key-col` | No | Column header name for ID/key (CSV only). |
| `--val-col` | No | Column header name for translation/text (CSV only). |

---

## Exit Codes

- `0`: Complete success! No issues or duplicates found.
- `1`: CLI usage, configuration, or file reading/parsing error.
- `2`: Complete run, but localization issues (e.g., missing keys, broken tags) or duplicate IDs were found.

---

## Configuration & Ignore Rules

To customize thresholds and ignore false positives, create a JSON configuration file. Refer to the default template (`fixtures/config.json`):

```json
{
  "ignore_rules": {
    "global": {
      "ignored_ids": ["TXT_DUPLICATE_KEY_TEST"],
      "ignored_checks": []
    },
    "locales": {
      "fr": {
        "ignored_ids": ["TXT_MENU_OPTIONS"],
        "ignored_checks": ["tag_imbalance"]
      }
    }
  },
  "expansion_thresholds": {
    "short": {
      "max_length": 15,
      "multiplier": 2.5
    },
    "medium": {
      "max_length": 50,
      "multiplier": 1.8
    },
    "long": {
      "max_length": null,
      "multiplier": 1.4
    }
  },
  "placeholder_patterns": [
    "\\{[a-zA-Z_0-9]+\\}",
    "%[dsf]"
  ],
  "min_untranslated_length": 5
}
```

- **ignore_rules**: Define specific key IDs or full QA check types to ignore globally or only for specific locales.
- **expansion_thresholds**: Define maximum characters and scaling multiplier tiers (short, medium, long) to control when a translation triggers an expansion warning.
- **placeholder_patterns**: Specify regex patterns for finding dynamic placeholders in your strings.
- **min_untranslated_length**: Length limit below which untranslated identical words (such as "OK" or "Exit") are ignored to prevent noise.
