# CLAUDE.md — structured-data-extractor spec

Authoritative specification for the Python JSON-LD and Structured Data Extractor module.

## Core Purpose
An offline, zero-dependency Python tool to parse, normalize, and analyze JSON-LD blocks and graph nodes extracted from local HTML files or a crawl manifest.

## Architecture Guidelines
- **Zero-Dependency Policy:** Rely only on standard library Python modules (`html.parser.HTMLParser`, `json`, `csv`, `re`, `argparse`, `os`, `sys`). Do not import any external pip packages.
- **Strict Offline Mode:** No network connections are initiated. Do not download schemas or run page scripts.
- **Robust Error Tolerance:** Ensure syntactically malformed JSON-LD blocks generate an index error without aborting the run.
- **Data Fidelity:** Support deep recursively nested objects, lists, and complex `@graph` schemas. Track reference parents via `parent_id` hierarchy.
- **Deterministic Output:** Results must be ordered deterministically (e.g. sorted page URLs, sorted keys, stable blank node IDs).

## Key Commands & Usage

### Execute Extractor CLI
```bash
# Process a single HTML file with custom URL and check for old domains
python3 structured-data-extractor/extractor.py --file structured-data-extractor/tests/fixtures/valid.html --url "https://example.com/valid" --old-domain "old-site.com"

# Process multiple files from a crawl manifest
python3 structured-data-extractor/extractor.py --manifest structured-data-extractor/tests/fixtures/manifest.json --output-dir out/

# Dry run with stats logging only
python3 structured-data-extractor/extractor.py --dir structured-data-extractor/tests/fixtures/ --dry-run
```

### Run Unit Tests
Execute the tests from the repository root:
```bash
python3 -m unittest discover -s structured-data-extractor/tests -p 'test_*.py'
```

## Analytical Error & Finding Codes
- `duplicate_id`: Added to a node's findings if its `@id` was already registered on the page.
- `missing_type`: Added to a node if it has no `@type` defined.
- `old_domain_reference`: Added to a node if any key, value, or ID matches one of the specified old domains.
