import argparse
import sys
import os
import json
import csv
import re
from typing import Dict, List, Any, Optional

from .config import QAConfig
from .adapters import JSONAdapter, CSVAdapter, POAdapter
from .checker import LocalizationChecker, QAIssue

# ANSI colors
RED = "\033[91m"
GREEN = "\033[92m"
YELLOW = "\033[93m"
CYAN = "\033[96m"
BOLD = "\033[1m"
RESET = "\033[0m"

def get_adapter(file_path: str, key_col: Optional[str] = None, val_col: Optional[str] = None):
    ext = os.path.splitext(file_path)[1].lower()
    if ext == ".json":
        return JSONAdapter()
    elif ext == ".csv":
        return CSVAdapter(key_col=key_col, val_col=val_col)
    elif ext in (".po", ".pot"):
        return POAdapter()
    else:
        raise ValueError(f"Unsupported file format: {ext}")

def detect_duplicates(filepath: str, file_type: str, key_col: Optional[str] = None, val_col: Optional[str] = None) -> List[str]:
    """Inspects the raw file to count and report any duplicate keys/IDs before merging."""
    duplicates = []
    seen = set()
    ext = file_type.lower()

    try:
        if ext == "json":
            with open(filepath, "r", encoding="utf-8") as f:
                content = f.read().strip()
                # Simple parser of key-value JSON to find duplicate keys
                # We can use regex to find JSON keys since they are unique string constructs
                keys = re.findall(r'"([^"\\]*(?:\\.[^"\\]*)*)"\s*:', content)
                for k in keys:
                    if k in seen:
                        duplicates.append(k)
                    seen.add(k)
        elif ext == "csv":
            # Read first column or specific ID column
            with open(filepath, "r", encoding="utf-8") as f:
                reader = csv.reader(f)
                headers = next(reader, None)
                if headers:
                    key_idx = 0
                    if key_col:
                        key_col_l = key_col.lower()
                        for idx, h in enumerate(headers):
                            if h.strip().lower() == key_col_l:
                                key_idx = idx
                                break
                    else:
                        id_keywords = ["id", "key", "string_id", "stringid", "name"]
                        for idx, h in enumerate(headers):
                            if h.strip().lower() in id_keywords:
                                key_idx = idx
                                break

                    for row in reader:
                        if not row or len(row) <= key_idx:
                            continue
                        k = row[key_idx].strip()
                        if k:
                            if k in seen:
                                duplicates.append(k)
                            seen.add(k)
        elif ext in ("po", "pot"):
            with open(filepath, "r", encoding="utf-8") as f:
                for line in f:
                    line_str = line.strip()
                    if line_str.startswith("msgid"):
                        match = re.match(r'^msgid\s+"(.*)"$', line_str)
                        if match:
                            msgid = match.group(1)
                            if msgid: # ignore header
                                if msgid in seen:
                                    duplicates.append(msgid)
                                seen.add(msgid)
    except Exception:
        pass # Fallback gracefully if custom duplicate parser fails

    return sorted(list(set(duplicates)))

def print_terminal_report(issues: List[QAIssue], duplicates: List[str], locale_name: str) -> None:
    print(f"\n{BOLD}{CYAN}=== QA Report for Locale: {locale_name} ==={RESET}\n")

    if duplicates:
        print(f"{YELLOW}{BOLD}[!] DUPLICATE IDS DETECTED:{RESET}")
        for dup in duplicates:
            print(f"  - {dup}")
        print()

    if not issues:
        print(f"{GREEN}{BOLD}✓ No localization issues found!{RESET}\n")
        return

    # Group issues by check type
    by_type: Dict[str, List[QAIssue]] = {}
    for issue in issues:
        by_type.setdefault(issue.check_type, []).append(issue)

    for check_type, type_issues in by_type.items():
        print(f"{RED}{BOLD}✗ {check_type.upper()} ({len(type_issues)} issues):{RESET}")
        for issue in type_issues:
            print(f"  {BOLD}ID:{RESET} {issue.string_id}")
            print(f"    Message: {issue.message}")
            if issue.canonical_val is not None:
                print(f"    Canonical:   {repr(issue.canonical_val)}")
            if issue.locale_val is not None:
                print(f"    Translation: {repr(issue.locale_val)}")
            print()

def write_json_report(issues: List[QAIssue], duplicates: List[str], filepath: str) -> None:
    report_data = {
        "summary": {
            "total_issues": len(issues),
            "duplicate_ids_count": len(duplicates)
        },
        "duplicate_ids": duplicates,
        "issues": [issue.to_dict() for issue in issues]
    }
    with open(filepath, "w", encoding="utf-8") as f:
        json.dump(report_data, f, indent=2, ensure_ascii=False)

def write_csv_report(issues: List[QAIssue], duplicates: List[str], filepath: str) -> None:
    with open(filepath, "w", encoding="utf-8", newline="") as f:
        writer = csv.writer(f)
        writer.writerow(["String ID", "Issue Type", "Message", "Canonical", "Translation"])

        for dup in duplicates:
            writer.writerow([dup, "duplicate_id", "String ID is duplicated in file", "", ""])

        for issue in issues:
            writer.writerow([
                issue.string_id,
                issue.check_type,
                issue.message,
                issue.canonical_val or "",
                issue.locale_val or ""
            ])

def main() -> int:
    parser = argparse.ArgumentParser(
        description="Python QA toolkit for narrative game localization translations."
    )
    parser.add_argument("--canonical", required=True, help="Path to canonical game-string catalog.")
    parser.add_argument("--locale", required=True, help="Path to locale game-string catalog.")
    parser.add_argument("--locale-name", required=True, help="Name/code of the locale (e.g. fr, es, de).")
    parser.add_argument("--config", help="Path to custom JSON configuration file.")
    parser.add_argument("--json-report", help="Path to export JSON report.")
    parser.add_argument("--csv-report", help="Path to export CSV report.")
    parser.add_argument("--key-col", help="CSV column header for ID/key.")
    parser.add_argument("--val-col", help="CSV column header for translation/text.")

    args = parser.parse_args()

    # Load configuration
    if args.config:
        config = QAConfig.load_from_file(args.config)
    else:
        config = QAConfig()

    # Initialize adapters
    try:
        canon_adapter = get_adapter(args.canonical, key_col=args.key_col, val_col=args.val_col)
        locale_adapter = get_adapter(args.locale, key_col=args.key_col, val_col=args.val_col)
    except ValueError as e:
        print(f"Configuration or usage error: {e}", file=sys.stderr)
        return 1

    # Load translation catalogs
    try:
        canonical_strings = canon_adapter.parse(args.canonical)
        locale_strings = locale_adapter.parse(args.locale)
    except Exception as e:
        print(f"Error reading translation files: {e}", file=sys.stderr)
        return 1

    # Check for duplicate IDs in original catalogs
    canon_ext = os.path.splitext(args.canonical)[1].lower().replace(".", "")
    loc_ext = os.path.splitext(args.locale)[1].lower().replace(".", "")

    canon_dups = detect_duplicates(args.canonical, canon_ext, key_col=args.key_col, val_col=args.val_col)
    locale_dups = detect_duplicates(args.locale, loc_ext, key_col=args.key_col, val_col=args.val_col)

    all_duplicates = sorted(list(set(canon_dups + locale_dups)))

    # Run core localization checker
    checker = LocalizationChecker(config)
    issues = checker.check(canonical_strings, locale_strings, args.locale_name)

    # Output Terminal Report
    print_terminal_report(issues, all_duplicates, args.locale_name)

    # Export JSON report if requested
    if args.json_report:
        try:
            write_json_report(issues, all_duplicates, args.json_report)
            print(f"Saved JSON report to {args.json_report}")
        except Exception as e:
            print(f"Error saving JSON report: {e}", file=sys.stderr)
            return 1

    # Export CSV report if requested
    if args.csv_report:
        try:
            write_csv_report(issues, all_duplicates, args.csv_report)
            print(f"Saved CSV report to {args.csv_report}")
        except Exception as e:
            print(f"Error saving CSV report: {e}", file=sys.stderr)
            return 1

    # Exit code: 2 if issues or duplicates are found, else 0
    if issues or all_duplicates:
        return 2

    return 0

if __name__ == "__main__":
    sys.exit(main())
