# WordPress Media Reference Reconciler

A read-only, zero-dependency Python utility that reconciles a local WordPress uploads directory tree with database exports (WXR XML or custom JSON) and content references.

It extracts references from post content, metadata, `srcset`, Gutenberg blocks, and featured image IDs, and compares them with files on disk to identify:
1. **Referenced & Present**: Files referenced and correctly placed.
2. **Missing Files**: References in content or DB pointing to missing disk files (Original or Derivative).
3. **Unused Candidates**: Files existing in the uploads tree but never referenced (nor are any of their parent/child derivative families referenced).
4. **Broken Derivatives**: Generated thumbnail sizes whose parent file has been deleted.
5. **Filename Collisions**: Files with identical names/paths differing only by character case or folder nesting, which might collide during migrations.

---

## Safe Cleanup Documentation

This utility is strictly **read-only** and will **never modify or delete** any of your files. If you wish to use the output reports (such as `unused_candidates.csv`) to clean up disk space on your server, follow these best practices:

### Step 1: Perform a Full Backup
Before removing any files, create a complete, zipped archive of your `wp-content/uploads` directory.
```bash
tar -czf uploads-backup.tar.gz /path/to/wp-content/uploads
```

### Step 2: Carefully Review `unused_candidates.csv`
Open the generated `unused_candidates.csv` in a spreadsheet tool or text editor.
- Ensure that the base URLs and paths were normalized correctly.
- If `--old-url` or `--new-url` were not correctly passed during reconciliation, some used files might be falsely flagged as unused.
- Check a few random entries to ensure they are indeed safe to remove.

### Step 3: Test on a Staging Environment
Run your cleanup commands on a staging copy of the site first, then run a QA audit (e.g. crawler or Playwright tests) to ensure no images are broken on the frontend.

### Step 4: Perform the Cleanup
Once fully verified, you can delete files listed in `unused_candidates.csv`. A simple safe script (e.g., using Python or standard bash tools) can read the CSV and move files to a temporary "quarantine" directory first, or delete them directly:
```bash
# Example: Moving unused files to a quarantine folder first
mkdir -p /path/to/quarantine_uploads
# (Always inspect the file list before running mass deletion!)
```

---

## Installation & Requirements

- **Python**: Version 3.11 or later.
- **Dependencies**: None! The tool is built entirely on Python's built-in standard library.

---

## Command Line Interface

```bash
python3 -m src.cli [options]
```

### Required Options
- `-u`, `--uploads <path>`: Path to the local `wp-content/uploads/` directory.

### Optional Inputs
- `-w`, `--wxr <path>`: Path to a WordPress WXR XML export file.
- `-j`, `--json <path>`: Path to a normalized attachment JSON export file.

### Other Options
- `-o`, `--output-dir <path>`: Directory to write reports (default: `./reports`).
- `--old-url <url>`: Old site uploads base URL to strip/normalize.
- `--new-url <url>`: New site uploads base URL to strip/normalize.

### Output Reports
The reconciler generates five reports in your specified `--output-dir`:
1. `reconciliation_summary.json`: High-level metrics.
2. `missing_files.csv`: Referenced files missing from disk (with exact/heuristic evidence context).
3. `unused_candidates.csv`: Local files with zero references on the site.
4. `broken_derivatives.csv`: Local thumbnails whose parent files do not exist.
5. `collisions.csv`: Identical files with case conflicts or potential migration collision paths.

---

## Testing

Run the test suite using Python's native `unittest` framework:
```bash
python3 -m unittest discover -s tests -p "test_*.py"
```
