import argparse
import json
import sys
import os
from typing import Dict, Any, List, Optional

from .parser import parse_crawl_file, parse_url_mapping
from .compare import ComparisonRunner, DEFAULT_SEVERITY_POLICY
from .report import TerminalReporter, JSONReporter, HTMLReporter

def parse_args(args_list: List[str]) -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Compare pre/post migration metadata between crawls.",
        formatter_class=argparse.RawTextHelpFormatter,
        prog="python -m migration-metadata-compare.src.cli"
    )
    parser.add_argument(
        "-b", "--before",
        required=True,
        help='Path to the "before" crawl file (CSV or JSONL)'
    )
    parser.add_argument(
        "-a", "--after",
        required=True,
        help='Path to the "after" crawl file (CSV or JSONL)'
    )
    parser.add_argument(
        "-m", "--mapping",
        help="Path to the URL mapping file (CSV or JSON/JSONL)"
    )
    parser.add_argument(
        "--no-fallback-path-match",
        action="store_true",
        help="Disable path-based fallback URL matching for unmapped pages"
    )
    parser.add_argument(
        "-p", "--policy-config",
        help="Path to a JSON policy config specifying field severities or ignores"
    )
    parser.add_argument(
        "--severity",
        action="append",
        help="Set severity for a specific field (e.g., --severity title=warning --severity language=ignore)"
    )
    parser.add_argument(
        "--fail-on-severity",
        choices=["error", "warning", "info"],
        default="error",
        help="Minimum severity to trigger a non-zero exit code (default: error)"
    )
    parser.add_argument(
        "--html",
        dest="html_path",
        help="Path to output a standalone interactive HTML report"
    )
    parser.add_argument(
        "--json",
        dest="json_path",
        help="Path to output a structured JSON report"
    )
    parser.add_argument(
        "--no-color",
        action="store_true",
        help="Disable terminal colors"
    )
    return parser.parse_args(args_list)

def main() -> None:
    try:
        args = parse_args(sys.argv[1:])

        # 1. Resolve and load policy/severity rules
        policy_overrides: Dict[str, str] = {}

        # Load from file if specified
        if args.policy_config:
            if not os.path.exists(args.policy_config):
                print(f"Error: Policy config file not found: {args.policy_config}", file=sys.stderr)
                sys.exit(2)
                return
            try:
                with open(args.policy_config, mode="r", encoding="utf-8") as f:
                    file_policy = json.load(f)
                    if isinstance(file_policy, dict):
                        for k, v in file_policy.items():
                            if str(v).lower() in ("error", "warning", "info", "ignore"):
                                policy_overrides[k] = str(v).lower()
            except Exception as e:
                print(f"Error parsing policy config: {e}", file=sys.stderr)
                sys.exit(2)
                return

        # Load from command-line overrides
        if args.severity:
            for s_override in args.severity:
                if "=" in s_override:
                    field, lvl = s_override.split("=", 1)
                    field = field.strip()
                    lvl = lvl.strip().lower()
                    if lvl in ("error", "warning", "info", "ignore"):
                        policy_overrides[field] = lvl
                    else:
                        print(f"Warning: Invalid severity level '{lvl}' for field '{field}'. Ignored.", file=sys.stderr)
                else:
                    print(f"Warning: Invalid severity format '{s_override}'. Expected field=level.", file=sys.stderr)

        # 2. Parse crawls and mappings
        if not os.path.exists(args.before):
            print(f"Error: 'Before' crawl file not found: {args.before}", file=sys.stderr)
            sys.exit(2)
            return
        if not os.path.exists(args.after):
            print(f"Error: 'After' crawl file not found: {args.after}", file=sys.stderr)
            sys.exit(2)
            return

        try:
            before_crawl = parse_crawl_file(args.before)
        except Exception as e:
            print(f"Error reading 'before' crawl: {e}", file=sys.stderr)
            sys.exit(2)
            return

        try:
            after_crawl = parse_crawl_file(args.after)
        except Exception as e:
            print(f"Error reading 'after' crawl: {e}", file=sys.stderr)
            sys.exit(2)
            return

        mapping_pairs: Optional[List[tuple]] = None
        if args.mapping:
            if not os.path.exists(args.mapping):
                print(f"Error: URL mapping file not found: {args.mapping}", file=sys.stderr)
                sys.exit(2)
                return
            try:
                mapping_pairs = parse_url_mapping(args.mapping)
            except Exception as e:
                print(f"Error reading mapping file: {e}", file=sys.stderr)
                sys.exit(2)
                return

        # 3. Run the Comparison
        runner = ComparisonRunner(
            policy=policy_overrides,
            fallback_path_match=not args.no_fallback_path_match
        )

        findings = runner.compare(
            before_data=before_crawl,
            after_data=after_crawl,
            mapping_pairs=mapping_pairs
        )

        # 4. Compute statistics
        active_findings = [f for f in findings if f.severity != "ignore"]

        severity_counts = {"error": 0, "warning": 0, "info": 0, "ignore": 0}
        for f in findings:
            severity_counts[f.severity] = severity_counts.get(f.severity, 0) + 1

        summary = {
            "total_pages_before": len(before_crawl),
            "total_pages_after": len(after_crawl),
            "total_findings": len(active_findings),
            "severity_counts": {
                "error": severity_counts.get("error", 0),
                "warning": severity_counts.get("warning", 0),
                "info": severity_counts.get("info", 0),
            }
        }

        # 5. Output Reports
        # Standard Terminal Output
        reporter = TerminalReporter(use_color=not args.no_color)
        term_report = reporter.generate(findings, args.before, args.after, summary)
        print(term_report)

        # Save HTML Report if requested
        if args.html_path:
            try:
                html_content = HTMLReporter.generate(
                    findings, args.before, args.after, args.mapping, summary
                )
                with open(args.html_path, mode="w", encoding="utf-8") as f:
                    f.write(html_content)
                print(f"Saved interactive HTML report to: {args.html_path}")
            except Exception as e:
                print(f"Error saving HTML report: {e}", file=sys.stderr)
                sys.exit(2)

        # Save JSON Report if requested
        if args.json_path:
            try:
                json_content = JSONReporter.generate(
                    findings, args.before, args.after, args.mapping, summary
                )
                with open(args.json_path, mode="w", encoding="utf-8") as f:
                    f.write(json_content)
                print(f"Saved structured JSON report to: {args.json_path}")
            except Exception as e:
                print(f"Error saving JSON report: {e}", file=sys.stderr)
                sys.exit(2)

        # 6. Exit Code Determination
        # The exit code should be non-zero if there are any findings of severity >= fail_on_severity
        fail_sevs = []
        if args.fail_on_severity == "info":
            fail_sevs = ["error", "warning", "info"]
        elif args.fail_on_severity == "warning":
            fail_sevs = ["error", "warning"]
        else: # "error"
            fail_sevs = ["error"]

        trigger_failures = [f for f in active_findings if f.severity in fail_sevs]

        if trigger_failures:
            print(f"Comparison completed with {len(trigger_failures)} regression(s) triggering failure threshold ({args.fail_on_severity}+).", file=sys.stderr)
            sys.exit(1)

        sys.exit(0)

    except KeyboardInterrupt:
        print("\nAborted.", file=sys.stderr)
        sys.exit(130)

if __name__ == "__main__":
    main()
