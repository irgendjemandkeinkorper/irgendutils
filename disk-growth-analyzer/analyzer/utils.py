import os
import fnmatch
from typing import List, Union

def format_bytes(num_bytes: Union[int, float]) -> str:
    """Formats raw bytes into a human-readable string with units."""
    if num_bytes is None:
        return "0 B"

    # Handle negative bytes (for shrinkage)
    prefix = "-" if num_bytes < 0 else ""
    num_bytes = abs(num_bytes)

    for unit in ['B', 'KB', 'MB', 'GB', 'TB', 'PB', 'EB']:
        if num_bytes < 1024.0:
            # Avoid showing decimals for single bytes unless fractional
            if unit == 'B':
                return f"{prefix}{int(num_bytes)} B"
            return f"{prefix}{num_bytes:.2f} {unit}"
        num_bytes /= 1024.0
    return f"{prefix}{num_bytes:.2f} YB"


def parse_bytes(size_str: str) -> int:
    """Parses a human-readable size string (e.g., '1.5G', '100M', '500') into bytes.
    Case-insensitive, supports optional space before unit.
    """
    if not size_str:
        return 0

    size_str = size_str.strip().upper()

    # Find where the units start
    units = {
        'B': 1,
        'KB': 1024, 'K': 1024,
        'MB': 1024**2, 'M': 1024**2,
        'GB': 1024**3, 'G': 1024**3,
        'TB': 1024**4, 'T': 1024**4,
        'PB': 1024**5, 'P': 1024**5,
    }

    # Extract numeric part vs string part
    num_part = ""
    unit_part = ""
    for char in size_str:
        if char.isdigit() or char == '.':
            num_part += char
        else:
            unit_part += char

    unit_part = unit_part.strip()

    if not num_part:
        raise ValueError(f"No numeric value found in size string: {size_str}")

    val = float(num_part)
    if not unit_part:
        return int(val)

    if unit_part in units:
        return int(val * units[unit_part])
    else:
        raise ValueError(f"Unknown size unit: {unit_part}")


def should_exclude(
    path: str,
    exclude_paths: List[str] = None,
    exclude_globs: List[str] = None,
    root_dir: str = None
) -> bool:
    """Checks if a path should be excluded based on list of exact paths or glob patterns.

    All paths are normalized to absolute paths before comparison.
    If root_dir is provided, also checks relative paths.
    """
    if not path:
        return False

    # Performance optimization: Fast exit when no exclusion criteria are provided,
    # avoiding redundant os.path.abspath(), os.path.basename(), and os.path.relpath() allocations.
    if not exclude_paths and not exclude_globs:
        return False

    # Normalize target path to absolute
    abs_path = os.path.abspath(path)
    base_name = os.path.basename(abs_path)

    # Calculate relative path if root_dir is specified
    rel_path = None
    if root_dir:
        abs_root = os.path.abspath(root_dir)
        try:
            rel_path = os.path.relpath(abs_path, abs_root)
        except ValueError:
            # Different drives on Windows, etc.
            pass

    # Check exact/prefix paths
    if exclude_paths:
        for ex_p in exclude_paths:
            abs_ex_p = os.path.abspath(ex_p)
            # Exact match
            if abs_path == abs_ex_p:
                return True
            # Subdirectory match (must check with directory separator boundary)
            if abs_path.startswith(abs_ex_p + os.sep) or abs_path.startswith(abs_ex_p + "/"):
                return True

    # Check glob patterns
    if exclude_globs:
        for pattern in exclude_globs:
            # Match base name (e.g. *.log)
            if fnmatch.fnmatch(base_name, pattern):
                return True
            # Match whole absolute path
            if fnmatch.fnmatch(abs_path, pattern):
                return True
            # Match relative path if possible
            if rel_path and fnmatch.fnmatch(rel_path, pattern):
                return True
            # Match parts of path (e.g. dir names like '.git')
            parts = abs_path.split(os.sep)
            if any(fnmatch.fnmatch(part, pattern) for part in parts if part):
                return True

    return False
