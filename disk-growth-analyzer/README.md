# Disk Growth Analyzer

A lightweight, zero-dependency Python 3.11+ command-line utility for capturing filesystem snapshots and analyzing directory tree size changes over time.

It is designed to run efficiently on small or large directories, streaming snapshots atomically to line-oriented JSON (JSONL) files, and providing clean, ranked comparison reports (Terminal/CSV) showing exactly where disk growth or shrinkage has occurred.

---

## Key Features

- **Zero-dependency**: Built entirely on Python's standard library. No `pip install` required.
- **Fail-safe Scanning**: Reports permission failures and reading errors without aborting or losing current progress.
- **Atomic Operations**: Snapshots are written to a temporary file, flushed, and renamed atomically to ensure you never get partial or corrupted files.
- **Hierarchical Size Bubbling**: Accumulates leaf file sizes to ancestor directories, so you see cumulative growth across entire nested directory trees.
- **Symlink Prevention**: Never follows symlinks by default. Prevents infinite recursion loops.
- **Mount Boundary Checks**: Supports scanning single filesystems (`-x` / `--one-file-system`) without crossing mount points.
- **Custom Exclusions**: Exclude specific absolute/relative folders and glob patterns (e.g. `*.log`, `.git`, `node_modules`).

---

## CLI Usage

Run the utility as a Python module from inside the `disk-growth-analyzer` folder.

### 1. Capturing a Snapshot (`scan`)

Scans a target directory and writes the results to a `.jsonl` file.

```bash
python3 -m analyzer.cli scan <target_directory> <output_file.jsonl> [options]
```

#### Options:
- `-e`, `--exclude-path PATH`: Excludes an exact path from scanning (can be repeated).
- `-g`, `--exclude-glob PATTERN`: Excludes paths matching a wildcard glob (can be repeated, e.g. `*.tmp`, `node_modules`).
- `-x`, `--one-file-system`: Do not cross directory device/mount boundaries.
- `-m`, `--include-metadata`: Store extra metadata like inode (`inode`) and device ID (`dev`) for files.
- `--follow-symlinks`: Follow symlinks (not recommended; disabled by default).
- `-v`, `--verbose`: Prints warning details about permission-denied paths to standard error.

#### Examples:
```bash
# Basic scan
python3 -m analyzer.cli scan /var/www/html /opt/snapshots/html_today.jsonl

# Scan with exclusions and verbose output
python3 -m analyzer.cli scan /home/user /opt/snapshots/home.jsonl \
  --exclude-path /home/user/Downloads \
  --exclude-glob "*.tmp" \
  --exclude-glob ".git" \
  --verbose
```

---

### 2. Comparing Snapshots (`diff`)

Compares two JSONL snapshots and displays the files and directory trees that grew, shrank, were added, or were deleted.

```bash
python3 -m analyzer.cli diff <snapshot_earlier.jsonl> <snapshot_later.jsonl> [options]
```

#### Options:
- `-n`, `--limit INT`: Max number of rows to display in terminal report tables (default: 10).
- `-c`, `--csv PATH`: Path to export a flat, comprehensive CSV file with comparison results.
- `-v`, `--verbose`: Enable verbose output.

#### Example:
```bash
# Compare terminal report with top 15 results in each section
python3 -m analyzer.cli diff /opt/snapshots/html_yesterday.jsonl /opt/snapshots/html_today.jsonl -n 15

# Compare and export the full flat results to CSV
python3 -m analyzer.cli diff /opt/snapshots/html_yesterday.jsonl /opt/snapshots/html_today.jsonl --csv web_diff.csv
```

---

## Scheduling & Cron Integration

You can automate daily or weekly snapshots using `cron`. To do this, wrap the command in a cron job.

### Example Daily Snapshot Cron Setup
Create a daily cron job that scans `/var/www/` at 1 AM every day:

```cron
0 1 * * * cd /path/to/disk-growth-analyzer && python3 -m analyzer.cli scan /var/www /opt/snapshots/www_$(date +\%F).jsonl --exclude-glob "*.log" -x >/dev/null 2>&1
```

To automatically clean up snapshots older than 30 days:
```cron
30 1 * * * find /opt/snapshots/ -name "www_*.jsonl" -mtime +30 -delete
```

---

## Privacy and Safety Guidelines

- **Virtual Filesystems**: Never scan virtual directories like `/proc`, `/sys`, `/dev`, or `/run`. These are not real folders on disk; scanning them will result in virtual files containing endless null streams, virtual metadata, or potential system lockups. Always pass `-x` or `--one-file-system` if you are scanning a root folder `/` to prevent crossing into virtual paths.
- **Sensitive Directories**: Exclude paths that contain cryptographic keys, credentials, or private personal data (such as `/home/user/.ssh`, `/etc/shadow`, etc.) to prevent exporting absolute metadata of these paths into plaintext JSONL snapshot files.
- **Snapshot Storage**: Keep snapshot JSONL files secured with appropriate file permissions (e.g. `chmod 600`) as they contain lists of relative and absolute filenames which may expose your file structure.

---

## Schema Formats

### Snapshot File Schema (JSONL)

The first line is always a metadata header:
```json
{"__snapshot_version__": "1.0", "root_directory": "/home/user", "timestamp": 1700000000.0}
```

Subsequent lines contain serialized entries:
```json
{"path": ".", "type": "dir", "size": 4096, "mtime": 1700000000.0}
{"path": "notes.txt", "type": "file", "size": 1024, "mtime": 1699999000.0}
{"path": "docs", "type": "dir", "size": 4096, "mtime": 1700000100.0}
{"path": "docs/manual.pdf", "type": "file", "size": 451200, "mtime": 1699995000.0}
{"path": "broken_symlink", "type": "symlink", "size": 12, "mtime": 1699995100.0}
```

### CSV Output Schema

When exporting to CSV, the columns are:
- `path`: The relative path from the root directory.
- `type`: The type of path (`file`, `dir`, `symlink`, `other`).
- `status`: The difference classification (`NEW`, `DELETED`, `GROWN`, `SHRUNK`, `MODIFIED_MTIME`, `UNCHANGED`).
- `size_s1`: Cumulative size in Snapshot 1 (in bytes).
- `size_s2`: Cumulative size in Snapshot 2 (in bytes).
- `change`: Size change in bytes (`size_s2 - size_s1`).
- `mtime_s1`: Last modified epoch time in Snapshot 1.
- `mtime_s2`: Last modified epoch time in Snapshot 2.
