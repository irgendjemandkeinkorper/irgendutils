import argparse
import io
import json
import os
import sys
from pathlib import Path
from typing import Dict, Any, List

from adapters import FixtureAdapter, WPCLIAdapter, SafeCommandError
from policy import PolicyEngine
from reporter import build_unified_report, format_terminal_summary, generate_json, generate_csv_stream

SEVERITY_PRIORITY = {
    "low": 1,
    "medium": 2,
    "high": 3,
    "critical": 4
}

def load_policy_file(filepath: str) -> Dict[str, Any]:
    """
    Load and parse custom policy JSON file.
    """
    path = Path(filepath)
    if not path.exists():
        sys.stderr.write(f"Error: Policy file not found: {filepath}\n")
        sys.exit(1)
    try:
        with open(path, "r", encoding="utf-8") as f:
            return json.load(f)
    except json.JSONDecodeError as e:
        sys.stderr.write(f"Error: Invalid JSON format in policy file: {e}\n")
        sys.exit(1)


def parse_args(args_list: List[str]) -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="WordPress Extension Inventory & Risk Reporter CLI",
        formatter_class=argparse.ArgumentDefaultsHelpFormatter
    )

    # Target options
    parser.add_argument(
        "--fixture-dir",
        type=str,
        help="Path to offline JSON fixture directory. If specified, operates entirely offline."
    )
    parser.add_argument(
        "--wp-path",
        type=str,
        help="Path to local WordPress root installation directory (live WP-CLI mode)."
    )

    # Configuration options
    parser.add_argument(
        "--policy",
        type=str,
        help="Path to custom risk policy JSON file."
    )
    parser.add_argument(
        "--multisite",
        action="store_true",
        default=None,
        help="Force multisite scope. If omitted, tries to auto-detect."
    )

    # Output options
    parser.add_argument(
        "--format",
        choices=["terminal", "json", "csv"],
        default="terminal",
        help="Report output format."
    )
    parser.add_argument(
        "--output-file",
        type=str,
        help="Path to file where report should be saved (for CSV and JSON formats, or terminal text dump)."
    )

    # CI gate options
    parser.add_argument(
        "--fail-on-risk",
        action="store_true",
        help="Exit with non-zero code if any risks meeting or exceeding fail-severity are found."
    )
    parser.add_argument(
        "--fail-severity",
        choices=["low", "medium", "high", "critical"],
        default="medium",
        help="Minimum severity level that triggers failure when --fail-on-risk is active."
    )

    return parser.parse_args(args_list)


def main(args_list: List[str] = None):
    if args_list is None:
        args_list = sys.argv[1:]

    args = parse_args(args_list)

    # 1. Initialize Policy Engine
    policy_dict = None
    if args.policy:
        policy_dict = load_policy_file(args.policy)
    engine = PolicyEngine(policy_dict)

    # 2. Initialize Adapter
    if args.fixture_dir:
        fix_path = Path(args.fixture_dir)
        if not fix_path.exists() or not fix_path.is_dir():
            sys.stderr.write(f"Error: Fixture directory does not exist: {args.fixture_dir}\n")
            sys.exit(1)
        adapter = FixtureAdapter(args.fixture_dir)
    else:
        # Default to safe WP-CLI subprocess adapter
        adapter = WPCLIAdapter(wp_path=args.wp_path)

    # 3. Retrieve Data safely
    try:
        core_version = adapter.get_core_version()
        core_updates = adapter.check_core_update()
        plugins = adapter.get_plugins()
        themes = adapter.get_themes()
        mu_plugins = adapter.get_mu_plugins()

        is_ms = args.multisite if args.multisite is not None else adapter.is_multisite()
    except SafeCommandError as e:
        sys.stderr.write(f"Security Policy Error: {e}\n")
        sys.exit(1)
    except Exception as e:
        sys.stderr.write(f"Execution Error: {e}\n")
        sys.exit(1)

    # 4. Process and scan inventory
    inventory = {
        "core": {
            "version": core_version,
            "updates": core_updates
        },
        "plugins": plugins,
        "themes": themes,
        "mu_plugins": mu_plugins
    }

    findings = engine.evaluate(inventory)
    report = build_unified_report(inventory, findings, is_ms)

    # 5. Output Report
    if args.format == "json":
        json_output = generate_json(report)
        if args.output_file:
            filepath = args.output_file
            with open(filepath, "w", encoding="utf-8") as f:
                f.write(json_output)
        else:
            sys.stdout.write(json_output + "\n")

    elif args.format == "csv":
        if args.output_file:
            with open(args.output_file, mode="w", newline="", encoding="utf-8") as f:
                generate_csv_stream(report, f)
        else:
            generate_csv_stream(report, sys.stdout)

    else:  # terminal
        if args.output_file:
            with open(args.output_file, "w", encoding="utf-8") as f:
                format_terminal_summary(report, f)
        else:
            format_terminal_summary(report, sys.stdout)

    # 6. CI Gate Check / Exit Code Decision
    if args.fail_on_risk and findings:
        target_priority = SEVERITY_PRIORITY.get(args.fail_severity.lower(), 2)

        for f in findings:
            f_severity = f.get("severity", "medium").lower()
            f_priority = SEVERITY_PRIORITY.get(f_severity, 2)

            if f_priority >= target_priority:
                # Trigger failure exit code
                sys.stderr.write(f"\nCI/CD Gate: Risk discovered meeting or exceeding fail-severity '{args.fail_severity}'!\n")
                sys.exit(1)

    sys.exit(0)


if __name__ == "__main__":
    main()
