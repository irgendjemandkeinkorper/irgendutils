import os
import sys
import argparse
import json
from typing import List, Dict, Any

# Ensure we can import parser, adapters, and analyzer relative to this script's directory
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from adapters import OfflineAdapter, LiveAdapter
from analyzer import Analyzer

def format_table(headers: List[str], rows: List[List[str]]) -> str:
    """Simple ASCII table formatter to avoid any external dependencies."""
    if not rows:
        return "No entries."

    # Calculate column widths
    widths = [len(h) for h in headers]
    for row in rows:
        for idx, cell in enumerate(row):
            widths[idx] = max(widths[idx], len(str(cell)))

    # Format line separator
    separator = "+" + "+".join("-" * (w + 2) for w in widths) + "+"

    # Header row
    header_str = "|" + "|".join(f" {headers[idx].ljust(widths[idx])} " for idx in range(len(headers))) + "|"

    lines = [separator, header_str, separator]
    for row in rows:
        row_str = "|" + "|".join(f" {str(row[idx]).ljust(widths[idx])} " for idx in range(len(row))) + "|"
        lines.append(row_str)

    lines.append(separator)
    return "\n".join(lines)

def print_terminal_report(schedules: List[Dict[str, Any]], confirmed: List[Dict[str, Any]], risks: List[Dict[str, Any]]):
    """Prints a beautiful, readable terminal report."""
    print("=" * 80)
    print(" SYSTEMD & CRON SCHEDULE AUDITOR REPORT")
    print("=" * 80)
    print()

    print("## 1. INVENTORIED WORK SCHEDULES")
    headers = ["Owner", "Schedule", "Source", "Command/Unit"]
    rows = []
    for s in schedules:
        rows.append([
            s.get("owner", "N/A"),
            s.get("schedule", "N/A"),
            s.get("source", "N/A"),
            s.get("command_or_unit", "N/A")
        ])
    print(format_table(headers, rows))
    print()

    print("## 2. CONFIRMED FINDINGS (DEFINITIVE FACTS)")
    if confirmed:
        headers_conf = ["Category", "Severity", "Source", "Item", "Details"]
        rows_conf = []
        for c in confirmed:
            rows_conf.append([
                c.get("category", "N/A"),
                c.get("severity", "N/A"),
                c.get("source", "N/A"),
                c.get("item", "N/A"),
                c.get("details", "N/A")
            ])
        print(format_table(headers_conf, rows_conf))
        print()
        print("REMEDIATION TIPS FOR CONFIRMED FINDINGS:")
        for idx, c in enumerate(confirmed, 1):
            print(f" {idx}. [{c['category']} - {c['severity']}] {c['item']}:")
            print(f"    Fact: {c['details']}")
            print(f"    Hint: {c['remediation']}")
            print()
    else:
        print("No critical confirmed findings found! Clean bill of health.")
        print()

    print("## 3. HEURISTICS & RISKS (POTENTIAL CONFLICTS)")
    if risks:
        headers_risk = ["Category", "Severity", "Source", "Item", "Details"]
        rows_risk = []
        for r in risks:
            rows_risk.append([
                r.get("category", "N/A"),
                r.get("severity", "N/A"),
                r.get("source", "N/A"),
                r.get("item", "N/A"),
                r.get("details", "N/A")
            ])
        print(format_table(headers_risk, rows_risk))
        print()
        print("REMEDIATION TIPS FOR HEURISTICS & RISKS:")
        for idx, r in enumerate(risks, 1):
            print(f" {idx}. [{r['category']} - {r['severity']}] {r['item']}:")
            print(f"    Risk: {r['details']}")
            print(f"    Hint: {r['remediation']}")
            print()
    else:
        print("No potential conflicts or high-frequency risks detected.")
        print()

def main():
    parser = argparse.ArgumentParser(
        description="Audit systemd and cron schedules for conflicts, missing files, credential leaks, and permission risks."
    )
    group = parser.add_mutually_exclusive_group()
    group.add_argument(
        "--fixture-dir",
        type=str,
        help="Path to an offline mock root directory containing system config files."
    )
    group.add_argument(
        "--live",
        action="store_true",
        help="Audit the live host system using read-only terminal commands (default)."
    )
    parser.add_argument(
        "--json",
        action="store_true",
        help="Output the audit results in JSON format."
    )

    args = parser.parse_args()

    # Determine default behavior
    # If neither is explicitly provided, we try to see if our mock_root fixture is available,
    # otherwise we default to live (or warn if not possible).
    fixture_dir = args.fixture_dir
    is_live = args.live

    if not fixture_dir and not is_live:
        # Check if the repository's mock_root exists
        default_fixture = os.path.join(
            os.path.dirname(os.path.dirname(os.path.abspath(__file__))),
            "fixtures", "mock_root"
        )
        if os.path.exists(default_fixture):
            fixture_dir = default_fixture
        else:
            is_live = True

    # Load Adapter
    if fixture_dir:
        adapter = OfflineAdapter(fixture_dir)
        analyzer = Analyzer(root_dir=fixture_dir)
    else:
        adapter = LiveAdapter()
        analyzer = Analyzer()

    # Retrieve work schedules
    schedules = adapter.get_schedules()

    # Run Analyzer
    masked_schedules, confirmed_findings, heuristics_risks = analyzer.analyze(schedules)

    if args.json:
        # Emit as JSON
        output = {
            "schedules": masked_schedules,
            "confirmed_findings": confirmed_findings,
            "heuristics_risks": heuristics_risks
        }
        print(json.dumps(output, indent=2))
    else:
        # Emit terminal-friendly format
        print_terminal_report(masked_schedules, confirmed_findings, heuristics_risks)

if __name__ == "__main__":
    main()
