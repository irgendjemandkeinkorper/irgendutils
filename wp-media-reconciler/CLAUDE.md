# CLAUDE.md — wp-media-reconciler

Python utility (`wp-media-reconciler`) that reconciles a WordPress uploads tree against an attachment export (WXR XML and/or attachment JSON) and content references to identify missing files, unused candidates, broken derivatives, and filename collisions without ever modifying any data.

## Command-line Usage
```bash
# Run the reconciler with WXR and/or JSON reference inputs
python3 -m src.cli --uploads /path/to/uploads --wxr /path/to/export.xml --json /path/to/attachments.json --output-dir ./reports

# Run with custom base URL normalization
python3 -m src.cli --uploads ./uploads --wxr ./export.xml --old-url https://old.com/wp-content/uploads --new-url https://new.com/wp-content/uploads
```

## Core Flags
- `-u`, `--uploads`: (Required) Path to the local `wp-content/uploads` directory.
- `-w`, `--wxr`: Path to the WordPress WXR XML export file.
- `-j`, `--json`: Path to the normalized attachment JSON export file.
- `-o`, `--output-dir`: Output directory for CSV/JSON reports (default: `./reports`).
- `--old-url`: Old media base URL to normalize (e.g. `https://oldwebsite.com/wp-content/uploads`).
- `--new-url`: New media base URL to normalize (e.g. `https://newwebsite.com/wp-content/uploads`).

## Testing and Development
- **Run Unit Tests**:
  ```bash
  python3 -m unittest discover -s tests -p "test_*.py"
  ```
- **Code Style**:
  - Python 3.11+ compliance.
  - Zero external dependencies where possible (rely entirely on python standard libraries: `pathlib`, `re`, `xml.etree.ElementTree`, `json`, `csv`, `urllib.parse`, `argparse`).
  - Safe, read-only operations. Never touch or delete filesystem entries.
