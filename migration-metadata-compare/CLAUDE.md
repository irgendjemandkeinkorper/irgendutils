# Migration Metadata Compare

Python-based pre/post migration metadata comparator CLI that reports page-level migration regressions beyond redirects.

## Architecture map

- **Stack:** Python 3.11+ zero-dependency utility using standard library modules (`urllib.parse`, `json`, `csv`, `html`, `argparse`, `unittest`, etc.).
- **Modules:**
  - `src/compare.py`: Core comparison engine, URL normalization, and field-specific normalizations.
  - `src/parser.py`: Robust CSV/JSONL parsing for crawls and URL mapping files.
  - `src/report.py`: Terminal, JSON, and interactive standalone HTML report generators.
  - `src/cli.py`: Command-line argument parsing and exit code determination.

## Commands

```bash
# Run tests
python -m unittest discover -s migration-metadata-compare/tests -p "test_*.py"

# Run comparison tool
python -m migration-metadata-compare.src.cli --before old_crawl.csv --after new_crawl.jsonl --mapping url_map.csv
```

## Conventions
- **Zero external dependencies:** Rely purely on Python standard library modules.
- **Strict Typing:** Use PEP 484 type hints throughout the codebase.
- **Deterministic output:** Sorting and processing order must be fully deterministic.
- **Idempotent / safe:** No side effects on inputs; safe to run.
- **Deterministic Exit Codes:** Exit code 0 if no severity >= "error" (or configurable threshold) findings occur; non-zero (1 or similar) otherwise.
