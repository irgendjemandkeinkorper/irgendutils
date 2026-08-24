import os
import sys
import json
import tempfile
import time
from typing import Iterator, Dict, Any, List, Optional, Callable
from .utils import should_exclude

class ScanError(Exception):
    pass

def scan_directory(
    root_dir: str,
    exclude_paths: Optional[List[str]] = None,
    exclude_globs: Optional[List[str]] = None,
    one_file_system: bool = False,
    include_metadata: bool = False,
    follow_symlinks: bool = False,
    error_callback: Optional[Callable[[str, str], None]] = None
) -> Iterator[Dict[str, Any]]:
    """Recursively scans a directory tree and yields metadata dictionaries for each entry.

    Ensures that:
    - Symlinks are NOT followed by default (follow_symlinks=False).
    - Device boundaries are respected if one_file_system is True.
    - Exclusions (paths and globs) are respected.
    - Failures/Permission errors do not abort the scan.
    """
    abs_root = os.path.abspath(root_dir)
    if not os.path.isdir(abs_root):
        raise ScanError(f"Root path is not a directory: {root_dir}")

    # Pre-compute root path prefix for fast relative path string slicing (~15x speedup vs os.path.relpath)
    root_prefix = abs_root if abs_root.endswith(os.sep) else abs_root + os.sep
    root_prefix_len = len(root_prefix)

    # Get root device ID
    try:
        root_stat = os.stat(abs_root)
        root_dev = root_stat.st_dev
    except Exception as e:
        msg = f"Failed to stat root directory: {e}"
        if error_callback:
            error_callback(abs_root, msg)
        else:
            print(f"Error: {msg}", file=sys.stderr)
        return

    # Helper to clean up path relative to scan root
    def get_rel_path(p: str) -> str:
        if p == abs_root:
            return "."
        if p.startswith(root_prefix):
            return p[root_prefix_len:]
        try:
            return os.path.relpath(p, abs_root)
        except ValueError:
            return p

    # Recursive directory walker using os.scandir for performance and lazy traversal
    def _walk(current_dir: str) -> Iterator[Dict[str, Any]]:
        # Exclude check for the current directory itself
        if should_exclude(current_dir, exclude_paths, exclude_globs, abs_root):
            return

        entries = []
        try:
            # os.scandir is an iterator and must be consumed or closed
            with os.scandir(current_dir) as it:
                for entry in it:
                    entries.append(entry)
        except Exception as e:
            rel = get_rel_path(current_dir)
            msg = f"Permission denied or unreadable directory: {e}"
            if error_callback:
                error_callback(current_dir, msg)
            yield {
                "path": rel,
                "type": "dir",
                "size": 0,
                "mtime": 0.0,
                "error": str(e)
            }
            return

        for entry in entries:
            try:
                # Resolve full path
                full_path = entry.path
                rel_path = get_rel_path(full_path)

                # Check exclusions
                if should_exclude(full_path, exclude_paths, exclude_globs, abs_root):
                    continue

                # Check symlink (never follow by default)
                is_sym = entry.is_symlink()

                # If it's a symlink and we are not following symlinks
                if is_sym and not follow_symlinks:
                    try:
                        # Get symlink's own stat
                        stat_info = entry.stat(follow_symlinks=False)
                        info = {
                            "path": rel_path,
                            "type": "symlink",
                            "size": stat_info.st_size,
                            "mtime": stat_info.st_mtime,
                        }
                        if include_metadata:
                            info["inode"] = stat_info.st_ino
                            info["dev"] = stat_info.st_dev
                        yield info
                    except Exception as e:
                        yield {
                            "path": rel_path,
                            "type": "symlink",
                            "size": 0,
                            "mtime": 0.0,
                            "error": str(e)
                        }
                    continue

                # Get stat info
                # If follow_symlinks is True and it is a symlink, we follow it
                try:
                    stat_info = entry.stat(follow_symlinks=follow_symlinks)
                except Exception as e:
                    yield {
                        "path": rel_path,
                        "type": "unknown",
                        "size": 0,
                        "mtime": 0.0,
                        "error": str(e)
                    }
                    continue

                # Device boundary check
                if one_file_system and stat_info.st_dev != root_dev:
                    continue

                # Determine type
                if entry.is_dir(follow_symlinks=follow_symlinks):
                    entry_type = "dir"
                elif entry.is_file(follow_symlinks=follow_symlinks):
                    entry_type = "file"
                else:
                    entry_type = "other"

                info = {
                    "path": rel_path,
                    "type": entry_type,
                    "size": stat_info.st_size,
                    "mtime": stat_info.st_mtime,
                }
                if include_metadata:
                    info["inode"] = stat_info.st_ino
                    info["dev"] = stat_info.st_dev

                yield info

                # Recurse into directories
                if entry_type == "dir":
                    yield from _walk(full_path)

            except Exception as e:
                # Capture and record individual entry error, continue scanning other files
                try:
                    r_path = get_rel_path(entry.path)
                except Exception:
                    r_path = entry.name
                yield {
                    "path": r_path,
                    "type": "unknown",
                    "size": 0,
                    "mtime": 0.0,
                    "error": str(e)
                }

    # Yield root directory first
    try:
        root_info = {
            "path": ".",
            "type": "dir",
            "size": root_stat.st_size,
            "mtime": root_stat.st_mtime,
        }
        if include_metadata:
            root_info["inode"] = root_stat.st_ino
            root_info["dev"] = root_stat.st_dev
        yield root_info
    except Exception as e:
        yield {
            "path": ".",
            "type": "dir",
            "size": 0,
            "mtime": 0.0,
            "error": str(e)
        }

    yield from _walk(abs_root)


def write_snapshot_atomic(
    output_filepath: str,
    root_dir: str,
    scan_generator: Iterator[Dict[str, Any]]
) -> int:
    """Writes the snapshot stream to the given output_filepath atomically using a temporary file.

    First writes metadata header.
    Returns the number of entries successfully written.
    """
    abs_out = os.path.abspath(output_filepath)
    out_dir = os.path.dirname(abs_out)
    if out_dir and not os.path.exists(out_dir):
        os.makedirs(out_dir, exist_ok=True)

    # Use named temporary file in the destination directory to ensure atomic os.replace is on same mount
    count = 0
    with tempfile.NamedTemporaryFile('w', dir=out_dir, delete=False, encoding='utf-8') as temp_file:
        temp_name = temp_file.name
        try:
            # Write metadata header first
            header = {
                "__snapshot_version__": "1.0",
                "root_directory": os.path.abspath(root_dir),
                "timestamp": time.time(),
            }
            temp_file.write(json.dumps(header) + "\n")

            for entry in scan_generator:
                temp_file.write(json.dumps(entry) + "\n")
                count += 1

            temp_file.flush()
            os.fsync(temp_file.fileno())
        except Exception:
            # Clean up temp file on error
            temp_file.close()
            try:
                os.remove(temp_name)
            except OSError:
                pass
            raise

    # Atomic rename/replace
    os.replace(temp_name, abs_out)
    return count
