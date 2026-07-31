import os
import sys
import argparse
from typing import List, Optional
from .scanner import scan_directory, write_snapshot_atomic, ScanError
from .reporter import DiffEngine, SnapshotLoadError

def create_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description="Disk Growth Analyzer: Captures filesystem snapshots and analyzes growth between them."
    )
    subparsers = parser.add_subparsers(dest="command", required=True, help="Subcommand to run")

    # SCAN subcommand
    scan_parser = subparsers.add_parser("scan", help="Capture a directory snapshot and save it to a JSONL file")
    scan_parser.add_argument("directory", help="The root directory to scan")
    scan_parser.add_argument("output_file", help="The destination filepath for the JSONL snapshot")
    scan_parser.add_argument(
        "--exclude-path", "-e",
        action="append",
        default=[],
        help="Path to exclude (can be specified multiple times)"
    )
    scan_parser.add_argument(
        "--exclude-glob", "-g",
        action="append",
        default=[],
        help="Glob pattern to exclude (can be specified multiple times)"
    )
    scan_parser.add_argument(
        "--one-file-system", "-x",
        action="store_true",
        help="Do not cross filesystem mount boundaries"
    )
    scan_parser.add_argument(
        "--include-metadata", "-m",
        action="store_true",
        help="Include extra inode and device metadata"
    )
    scan_parser.add_argument(
        "--follow-symlinks",
        action="store_true",
        help="Follow symlinks (never followed by default)"
    )
    scan_parser.add_argument(
        "--verbose", "-v",
        action="store_true",
        help="Enable verbose output (shows unreadable directories and files)"
    )

    # DIFF subcommand
    diff_parser = subparsers.add_parser("diff", help="Analyze and display growth between two snapshots")
    diff_parser.add_argument("snapshot1", help="Path to the earlier JSONL snapshot")
    diff_parser.add_argument("snapshot2", help="Path to the later JSONL snapshot")
    diff_parser.add_argument(
        "--limit", "-n",
        type=int,
        default=10,
        help="Limit number of rows shown in terminal report tables (default: 10)"
    )
    diff_parser.add_argument(
        "--csv", "-c",
        help="Path to export the full detailed comparison as a CSV file"
    )
    diff_parser.add_argument(
        "--verbose", "-v",
        action="store_true",
        help="Enable verbose output"
    )

    return parser


def run_scan(args: argparse.Namespace) -> int:
    """Handles execution of the scan command."""
    root_dir = args.directory
    output_file = args.output_file

    if args.verbose:
        print(f"Scanning directory: {os.path.abspath(root_dir)}", file=sys.stderr)

    error_count = 0
    def handle_error(path: str, message: str):
        nonlocal error_count
        error_count += 1
        if args.verbose:
            print(f"Warning: {path} - {message}", file=sys.stderr)

    try:
        # Resolve initial generator
        generator = scan_directory(
            root_dir=root_dir,
            exclude_paths=args.exclude_path,
            exclude_globs=args.exclude_glob,
            one_file_system=args.one_file_system,
            include_metadata=args.include_metadata,
            follow_symlinks=args.follow_symlinks,
            error_callback=handle_error
        )

        # Write to JSONL atomically
        count = write_snapshot_atomic(output_file, root_dir, generator)

        print(f"Successfully captured snapshot of {os.path.abspath(root_dir)}", file=sys.stderr)
        print(f"Wrote {count} entries atomically to {os.path.abspath(output_file)}", file=sys.stderr)
        if error_count > 0:
            print(f"Encountered {error_count} permission / scan warnings during the scan.", file=sys.stderr)
        return 0

    except ScanError as e:
        print(f"Scan failed: {e}", file=sys.stderr)
        return 1
    except OSError as e:
        print(f"I/O error during scan: {e}", file=sys.stderr)
        return 1
    except Exception as e:
        print(f"An unexpected error occurred: {e}", file=sys.stderr)
        return 1


def run_diff(args: argparse.Namespace) -> int:
    """Handles execution of the diff command."""
    s1 = args.snapshot1
    s2 = args.snapshot2

    try:
        if args.verbose:
            print(f"Loading and diffing snapshots:\n  S1: {s1}\n  S2: {s2}", file=sys.stderr)

        engine = DiffEngine(s1, s2)

        # Render terminal report to stdout
        engine.print_terminal_report(limit=args.limit)

        # Export CSV if specified
        if args.csv:
            engine.export_csv(args.csv)
            print(f"Exported detailed flat comparison CSV to {os.path.abspath(args.csv)}", file=sys.stderr)

        return 0

    except SnapshotLoadError as e:
        print(f"Failed to load snapshot: {e}", file=sys.stderr)
        return 1
    except Exception as e:
        print(f"An unexpected error occurred during diffing: {e}", file=sys.stderr)
        return 1


def main(argv: Optional[List[str]] = None) -> int:
    """The main CLI entrypoint."""
    parser = create_parser()
    args = parser.parse_args(argv)

    if args.command == "scan":
        return run_scan(args)
    elif args.command == "diff":
        return run_diff(args)

    return 0


if __name__ == "__main__":
    sys.exit(main())
