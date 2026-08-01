# Disk Growth Analyzer

Python 3.11+ CLI (`disk-analyzer`) that captures filesystem snapshots, records metadata, handles permission/unreadable directories gracefully, and computes cumulative directory tree growth and shrinkage between snapshots. Read-only filesystem tool — it never modifies user files.

## Architecture map

- **Stack:** Pure Python 3.11+ standard library application (no external dependencies, zero NPM/pip installation overhead).
- **Files:**
  - `analyzer/cli.py` — Command dispatch, subcommand definitions, and CLI execution.
  - `analyzer/scanner.py` — Optimized os.scandir directory traversal, atomic JSONL stream writing, symlink prevention, and device-boundary checks.
  - `analyzer/reporter.py` — DiffEngine which compares JSONL files, computes directory tree hierarchies, ranks growth, shrinkage, additions, and deletions, and outputs terminal/CSV reports.
  - `analyzer/utils.py` — Human-readable byte formatting/parsing, path/glob exclusion checkers.

## Conventions

- **Never follow symlinks by default** — Symlinks are scanned as their own records (`type: symlink`) and their targets are ignored unless `--follow-symlinks` is explicitly supplied.
- **Fail-safe scan** — Permission errors on nested files or directories report warning callbacks but never abort the overall scan.
- **Atomic snapshot writing** — Snapshots are written to a temporary file in the destination folder, fsynced, and renamed using `os.replace` to prevent corrupted partial snapshots.
- **Hierarchical tree aggregation** — Directory sizes represent the sum of all leaf files contained recursively inside that path, so growth or shrinkage anywhere bubbles up to ancestors.

## Commands

```bash
# Capture directory snapshot
python3 -m analyzer.cli scan /path/to/scan snapshot.jsonl

# Capture with exclusions and mount boundaries
python3 -m analyzer.cli scan /path/to/scan snapshot.jsonl --exclude-path /path/to/scan/cache --exclude-glob "*.tmp" -x

# Diff two snapshots in console
python3 -m analyzer.cli diff snapshot1.jsonl snapshot2.jsonl -n 15

# Diff and export detailed CSV
python3 -m analyzer.cli diff snapshot1.jsonl snapshot2.jsonl --csv comparison.csv

# Run tests
python3 -m unittest discover -s tests
```
