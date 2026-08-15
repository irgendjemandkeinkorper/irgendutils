# Python JSON-LD and Structured Data Extractor

An offline, zero-dependency Python 3.11+ tool designed to extract, unpack, normalize, validate, and inventory JSON-LD structured data from local HTML files or a crawl manifest.

## Features

- **Zero-Dependency Engine:** Operates entirely within Python's standard library (uses native `html.parser.HTMLParser` and `json`/`csv` modules).
- **Offline & Safe:** Never executes script tags or triggers network/external requests.
- **Deep Normalization:**
  - Unpacks single nodes, lists of objects, and complex `@graph` structures.
  - Automatically flattens `@graph` nodes into discrete entities while correctly mapping parent/child relationships (via `parent_id` tracking).
  - Generates stable and predictable identifiers (`_:b_1`, `_:b_2`) for blank nodes.
- **Resilient & Robust Error Handling:** Malformed or syntax-error JSON-LD blocks are captured as parse errors with file lines and block indexes without aborting execution.
- **Analytical Rule Detection:**
  - **Duplicate IDs:** Flags any objects sharing the same `@id` on a page.
  - **Missing Types:** Flags any objects that lack `@type`.
  - **Old Domain References:** Flags objects, contexts, or values containing occurrences of old/deprecated domains.
- **Deterministic & High-Quality Outputs:**
  - **Normalized JSON:** A predictable sorted JSON file containing complete structured metadata, summaries, nodes, and error reporting.
  - **Stable Flattened CSV:** Tabular schema listing page URL, source file, block index, entity index, entity ID, type, parent ID, findings, and complete lossless properties.

---

## Installation & Setup

Ensure you have Python 3.11+ installed. No external packages are required.

```bash
# Clone the repository and navigate to the directory
cd structured-data-extractor
```

---

## CLI Usage

The extractor provides a CLI with mutually exclusive input arguments (`--file`, `--dir`, or `--manifest`):

```bash
python3 extractor.py --file <path_to_html> [--url <source_url>] [--old-domain <domain>] [--output-dir <dir>] [--dry-run]
python3 extractor.py --dir <directory_path> [--old-domain <domain>] [--output-dir <dir>] [--dry-run]
python3 extractor.py --manifest <manifest_json_path> [--old-domain <domain>] [--output-dir <dir>] [--dry-run]
```

### Options

| Flag | Type | Description |
|---|---|---|
| `--file` | Filepath | Extract JSON-LD from a single local HTML file. |
| `--dir` | Directory | Recursively search and extract from all `.html`/`.htm` files in a directory. |
| `--manifest` | Filepath | Extract from files listed in a standard crawl manifest JSON file. |
| `--url` | String | Specify or override the provenance URL (use with `--file` only). |
| `--old-domain` | String | Define deprecated domain name(s) to scan for in JSON-LD fields. Can be supplied multiple times. |
| `--output-dir` | String | Where to save outputs. Defaults to `out`. |
| `--dry-run` | Flag | Perform extraction and display summary stats to stderr/stdout without writing files. |

---

## Output Formats

Every run that is not a dry-run writes two output files into the configured `--output-dir` (default: `out/`):

### 1. Deterministic JSON (`normalized_structured_data.json`)
Consists of a summary block followed by a sorted, deterministic list of pages containing errors and extracted nodes.

```json
{
  "summary": {
    "total_errors": 2,
    "total_findings": 3,
    "total_nodes": 13,
    "total_pages": 3
  },
  "pages": [
    {
      "provenance_url": "https://example.com/valid",
      "provenance_file": "/app/structured-data-extractor/tests/fixtures/valid.html",
      "errors": [],
      "nodes": [
        {
          "block_index": 0,
          "node_index": 0,
          "id": "https://example.com/valid",
          "type": "WebPage",
          "parent_id": null,
          "findings": [],
          "properties": {
            "description": "This is a valid page with standard JSON-LD structured data.",
            "name": "A Valid Page Example"
          }
        }
      ]
    }
  ]
}
```

### 2. Flattened CSV (`flattened_structured_data.csv`)
A robust CSV suitable for spreadsheet analysis or database importing. Includes standard headers:

- `provenance_url`: Source page URL
- `provenance_file`: Path to the processed HTML file
- `block_index`: Index of the `<script>` block on the page (0-indexed)
- `node_index`: Sequential index of the entity inside the parsed JSON block
- `id`: Unique URI or local blank node identifier (e.g. `_:b_1`)
- `type`: Node schema type (e.g. `WebPage`, `ListItem`)
- `parent_id`: Parent entity identifier (if nested under a parent object)
- `findings`: Commas-separated list of analytical flags (`duplicate_id`, `missing_type`, `old_domain_reference`)
- `properties_json`: A lossless serialized representation of the node's properties (keys sorted deterministically)

---

## Running Unit Tests

The test suite is fully self-contained and operates offline. Run tests using the native Python `unittest` module from the parent repository directory:

```bash
python3 -m unittest discover -s structured-data-extractor/tests -p 'test_*.py'
```
