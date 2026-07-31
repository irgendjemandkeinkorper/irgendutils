import os
import csv
import json
from typing import Dict, Any, List, Tuple, Optional
from .utils import format_bytes

class SnapshotLoadError(Exception):
    pass

def load_snapshot(filepath: str) -> Tuple[Dict[str, Dict[str, Any]], Dict[str, Any]]:
    """Loads a snapshot JSONL file, normalizing paths to forward slash.

    Returns a tuple:
        - Dict of path -> entry_dict
        - Dict of metadata (root, timestamp, errors, etc.)
    """
    entries = {}
    metadata = {
        "root_directory": "Unknown",
        "timestamp": 0.0,
        "error_count": 0,
        "total_count": 0,
    }

    if not os.path.isfile(filepath):
        raise SnapshotLoadError(f"Snapshot file does not exist: {filepath}")

    try:
        with open(filepath, 'r', encoding='utf-8') as f:
            for line_num, line in enumerate(f, 1):
                if not line.strip():
                    continue
                try:
                    data = json.loads(line)
                except json.JSONDecodeError as e:
                    raise SnapshotLoadError(f"Invalid JSON at line {line_num} in {filepath}: {e}")

                # Check for metadata header
                if "__snapshot_version__" in data:
                    metadata["root_directory"] = data.get("root_directory", "Unknown")
                    metadata["timestamp"] = data.get("timestamp", 0.0)
                    continue

                path = data.get("path")
                if path is None:
                    continue

                # Normalize path separators
                path = path.replace("\\", "/")

                # Store entry
                data["path"] = path
                entries[path] = data
                metadata["total_count"] += 1
                if "error" in data:
                    metadata["error_count"] += 1
    except OSError as e:
        raise SnapshotLoadError(f"Failed to read snapshot file {filepath}: {e}")

    return entries, metadata


def get_ancestors(path: str) -> List[str]:
    """Returns a list of directory ancestors for a given path.
    e.g., 'a/b/c.txt' -> ['.', 'a', 'a/b']
    """
    if path == "." or not path:
        return []
    ancestors = ["."]
    parts = path.split("/")
    current = ""
    for part in parts[:-1]:
        if not part:
            continue
        if current:
            current = f"{current}/{part}"
        else:
            current = part
        ancestors.append(current)
    return list(dict.fromkeys(ancestors))


def compute_cumulative_sizes(entries: Dict[str, Dict[str, Any]]) -> Dict[str, int]:
    """Computes the cumulative size for all directory trees based on files contained within them."""
    cumulative = {}

    # Initialize all directories with 0
    for path, entry in entries.items():
        if entry.get("type") == "dir":
            cumulative[path] = 0

    # Always ensure root is initialized
    cumulative["."] = 0

    # Add non-directory file/symlink/other sizes to their ancestors
    for path, entry in entries.items():
        if "error" in entry:
            continue
        if entry.get("type") != "dir":
            size = entry.get("size", 0)
            for ancestor in get_ancestors(path):
                cumulative[ancestor] = cumulative.get(ancestor, 0) + size

    return cumulative


class DiffEngine:
    def __init__(self, s1_path: str, s2_path: str):
        self.s1_entries, self.s1_meta = load_snapshot(s1_path)
        self.s2_entries, self.s2_meta = load_snapshot(s2_path)

        # Cumulative directory tree sizes
        self.s1_cum_sizes = compute_cumulative_sizes(self.s1_entries)
        self.s2_cum_sizes = compute_cumulative_sizes(self.s2_entries)

        self.diff_data()

    def diff_data(self):
        # Files and dirs categorization
        self.new_files = []
        self.deleted_files = []
        self.grown_files = []
        self.shrunk_files = []
        self.mtime_only_files = []
        self.unchanged_files = []

        self.new_dirs = []
        self.deleted_dirs = []
        self.grown_dirs = []
        self.shrunk_dirs = []
        self.unchanged_dirs = []

        all_paths = set(self.s1_entries.keys()).union(self.s2_entries.keys())

        for path in all_paths:
            # Skip root directory path itself from detail diff lists
            if path == ".":
                continue

            e1 = self.s1_entries.get(path)
            e2 = self.s2_entries.get(path)

            # 1. NEW
            if e1 is None and e2 is not None:
                if e2.get("type") == "dir":
                    size = self.s2_cum_sizes.get(path, 0)
                    self.new_dirs.append((path, size, e2))
                else:
                    self.new_files.append((path, e2.get("size", 0), e2))

            # 2. DELETED
            elif e1 is not None and e2 is None:
                if e1.get("type") == "dir":
                    size = self.s1_cum_sizes.get(path, 0)
                    self.deleted_dirs.append((path, size, e1))
                else:
                    self.deleted_files.append((path, e1.get("size", 0), e1))

            # 3. EXISTING (diff sizes or mtime)
            elif e1 is not None and e2 is not None:
                t1 = e1.get("type")
                t2 = e2.get("type")

                if t2 == "dir":
                    size1 = self.s1_cum_sizes.get(path, 0)
                    size2 = self.s2_cum_sizes.get(path, 0)
                    diff = size2 - size1
                    if diff > 0:
                        self.grown_dirs.append((path, size1, size2, diff, e2))
                    elif diff < 0:
                        self.shrunk_dirs.append((path, size1, size2, diff, e2))
                    else:
                        self.unchanged_dirs.append((path, size1, size2, 0, e2))
                else:
                    sz1 = e1.get("size", 0)
                    sz2 = e2.get("size", 0)
                    diff = sz2 - sz1

                    if diff > 0:
                        self.grown_files.append((path, sz1, sz2, diff, e2))
                    elif diff < 0:
                        self.shrunk_files.append((path, sz1, sz2, diff, e2))
                    else:
                        # Same size, check mtime
                        if e1.get("mtime") != e2.get("mtime"):
                            self.mtime_only_files.append((path, sz2, e2))
                        else:
                            self.unchanged_files.append((path, sz2, e2))

        # Sort all lists
        # New files/dirs: sorted by size in S2 descending
        self.new_files.sort(key=lambda x: x[1], reverse=True)
        self.new_dirs.sort(key=lambda x: x[1], reverse=True)

        # Deleted files/dirs: sorted by size in S1 descending
        self.deleted_files.sort(key=lambda x: x[1], reverse=True)
        self.deleted_dirs.sort(key=lambda x: x[1], reverse=True)

        # Grown files/dirs: sorted by growth (diff) descending
        self.grown_files.sort(key=lambda x: x[3], reverse=True)
        self.grown_dirs.sort(key=lambda x: x[3], reverse=True)

        # Shrunk files/dirs: sorted by shrinkage magnitude (absolute diff) descending
        self.shrunk_files.sort(key=lambda x: abs(x[3]), reverse=True)
        self.shrunk_dirs.sort(key=lambda x: abs(x[3]), reverse=True)

    def print_terminal_report(self, limit: int = 10):
        """Prints a gorgeous terminal report."""
        s1_total_size = self.s1_cum_sizes.get(".", 0)
        s2_total_size = self.s2_cum_sizes.get(".", 0)
        net_diff = s2_total_size - s1_total_size

        print("=" * 80)
        print("                     DISK GROWTH ANALYSIS REPORT")
        print("=" * 80)
        print(f"Snapshot 1: {self.s1_meta['root_directory']}")
        print(f"            Files/Dirs: {self.s1_meta['total_count']} | Total Size: {format_bytes(s1_total_size)}")
        if self.s1_meta['error_count']:
            print(f"            Permission / Scan Errors: {self.s1_meta['error_count']}")

        print(f"Snapshot 2: {self.s2_meta['root_directory']}")
        print(f"            Files/Dirs: {self.s2_meta['total_count']} | Total Size: {format_bytes(s2_total_size)}")
        if self.s2_meta['error_count']:
            print(f"            Permission / Scan Errors: {self.s2_meta['error_count']}")

        print("-" * 80)
        print(f"NET CHANGE: {format_bytes(net_diff)} ({'+' if net_diff >= 0 else ''}{net_diff} bytes)")
        print("-" * 80)

        print(f"Summary of Changes:")
        print(f"  New:      {len(self.new_files)} files, {len(self.new_dirs)} directories")
        print(f"  Deleted:  {len(self.deleted_files)} files, {len(self.deleted_dirs)} directories")
        print(f"  Grown:    {len(self.grown_files)} files, {len(self.grown_dirs)} directories")
        print(f"  Shrunk:   {len(self.shrunk_files)} files, {len(self.shrunk_dirs)} directories")
        print(f"  Modified: {len(self.mtime_only_files)} files (mtime only)")
        print(f"  Unchanged: {len(self.unchanged_files)} files, {len(self.unchanged_dirs)} directories")
        print()

        def print_table(title: str, headers: List[str], rows: List[List[str]]):
            if not rows:
                return
            print(f"--- {title} ---")
            # Calculate column widths
            col_widths = [len(h) for h in headers]
            for r in rows:
                for i, val in enumerate(r):
                    col_widths[i] = max(col_widths[i], len(str(val)))

            # Header line
            hdr_format = " | ".join(f"{{:<{w}}}" for w in col_widths)
            print(hdr_format.format(*headers))
            print("-" * (sum(col_widths) + 3 * (len(headers) - 1)))

            # Row lines
            for r in rows[:limit]:
                print(hdr_format.format(*r))
            if len(rows) > limit:
                print(f"... and {len(rows) - limit} more items.")
            print()

        # 1. Top Grown Directory Trees
        print_table(
            "Top Grown Directory Trees",
            ["Directory Path", "Size S1", "Size S2", "Growth"],
            [[p, format_bytes(s1), format_bytes(s2), f"+{format_bytes(diff)}"] for p, s1, s2, diff, _ in self.grown_dirs]
        )

        # 2. Top Grown Files
        print_table(
            "Top Grown Files",
            ["File Path", "Size S1", "Size S2", "Growth"],
            [[p, format_bytes(s1), format_bytes(s2), f"+{format_bytes(diff)}"] for p, s1, s2, diff, _ in self.grown_files]
        )

        # 3. Top New Files
        print_table(
            "Top New Files",
            ["File Path", "Size"],
            [[p, format_bytes(sz)] for p, sz, _ in self.new_files]
        )

        # 4. Top Shrunk Directory Trees
        print_table(
            "Top Shrunk Directory Trees",
            ["Directory Path", "Size S1", "Size S2", "Shrinkage"],
            [[p, format_bytes(s1), format_bytes(s2), f"-{format_bytes(abs(diff))}"] for p, s1, s2, diff, _ in self.shrunk_dirs]
        )

        # 5. Top Shrunk Files
        print_table(
            "Top Shrunk Files",
            ["File Path", "Size S1", "Size S2", "Shrinkage"],
            [[p, format_bytes(s1), format_bytes(s2), f"-{format_bytes(abs(diff))}"] for p, s1, s2, diff, _ in self.shrunk_files]
        )

        # 6. Top Deleted Files
        print_table(
            "Top Deleted Files",
            ["File Path", "Size"],
            [[p, format_bytes(sz)] for p, sz, _ in self.deleted_files]
        )

    def export_csv(self, output_filepath: str):
        """Exports a flat CSV comparison file with columns:
        path, type, status, size_s1, size_s2, change, mtime_s1, mtime_s2
        """
        rows = []

        # We can reconstruct all file and dir rows and record their attributes
        all_paths = set(self.s1_entries.keys()).union(self.s2_entries.keys())

        for path in sorted(all_paths):
            if path == ".":
                continue

            e1 = self.s1_entries.get(path)
            e2 = self.s2_entries.get(path)

            # Determine type
            entry_type = "dir" if ((e1 and e1.get("type") == "dir") or (e2 and e2.get("type") == "dir")) else "file"
            if not e1 and e2 and e2.get("type") in ("symlink", "other"):
                entry_type = e2.get("type")
            elif e1 and not e2 and e1.get("type") in ("symlink", "other"):
                entry_type = e1.get("type")

            # Sizes and status
            if entry_type == "dir":
                sz1 = self.s1_cum_sizes.get(path, 0)
                sz2 = self.s2_cum_sizes.get(path, 0)
            else:
                sz1 = e1.get("size", 0) if e1 else 0
                sz2 = e2.get("size", 0) if e2 else 0

            change = sz2 - sz1

            # Status
            if e1 is None and e2 is not None:
                status = "NEW"
            elif e1 is not None and e2 is None:
                status = "DELETED"
            else:
                if change > 0:
                    status = "GROWN"
                elif change < 0:
                    status = "SHRUNK"
                else:
                    if entry_type != "dir" and e1.get("mtime") != e2.get("mtime"):
                        status = "MODIFIED_MTIME"
                    else:
                        status = "UNCHANGED"

            mtime_s1 = e1.get("mtime", "") if e1 else ""
            mtime_s2 = e2.get("mtime", "") if e2 else ""

            rows.append({
                "path": path,
                "type": entry_type,
                "status": status,
                "size_s1": sz1,
                "size_s2": sz2,
                "change": change,
                "mtime_s1": mtime_s1,
                "mtime_s2": mtime_s2,
            })

        # Write CSV
        with open(output_filepath, 'w', newline='', encoding='utf-8') as f:
            fieldnames = ["path", "type", "status", "size_s1", "size_s2", "change", "mtime_s1", "mtime_s2"]
            writer = csv.DictWriter(f, fieldnames=fieldnames)
            writer.writeheader()
            writer.writerows(rows)
