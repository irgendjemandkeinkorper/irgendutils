import argparse
import sys
from pathlib import Path

from .normalizer import normalize_url_to_path
from .parser import parse_wxr, parse_json
from .classifier import ReconciliationEngine
from .exporter import export_reports

def parse_args(args=None):
    parser = argparse.ArgumentParser(
        description="WordPress Media Reference Reconciler - A safe, read-only audit tool."
    )
    parser.add_argument(
        "-u", "--uploads",
        required=True,
        type=str,
        help="Path to the local wp-content/uploads/ directory."
    )
    parser.add_argument(
        "-w", "--wxr",
        type=str,
        help="Path to a WordPress WXR XML export file."
    )
    parser.add_argument(
        "-j", "--json",
        type=str,
        help="Path to a normalized attachment JSON export file."
    )
    parser.add_argument(
        "-o", "--output-dir",
        type=str,
        default="./reports",
        help="Directory to write reports (default: ./reports)."
    )
    parser.add_argument(
        "--old-url",
        type=str,
        help="Old uploads base URL to normalize (e.g. https://old.com/wp-content/uploads)."
    )
    parser.add_argument(
        "--new-url",
        type=str,
        help="New uploads base URL to normalize (e.g. https://new.com/wp-content/uploads)."
    )
    return parser.parse_args(args)

def main(args_list=None):
    args = parse_args(args_list)

    uploads_path = Path(args.uploads)
    if not uploads_path.exists() or not uploads_path.is_dir():
        print(f"Error: Local uploads path '{args.uploads}' does not exist or is not a directory.")
        return 1

    print("WordPress Media Reference Reconciler")
    print("=====================================")
    print(f"Uploads Path: {uploads_path.resolve()}")
    if args.wxr:
        print(f"WXR Path:     {Path(args.wxr).resolve()}")
    if args.json:
        print(f"JSON Path:    {Path(args.json).resolve()}")
    print(f"Output Dir:   {Path(args.output_dir).resolve()}")
    if args.old_url:
        print(f"Old Base URL: {args.old_url}")
    if args.new_url:
        print(f"New Base URL: {args.new_url}")
    print()

    # Initialize Engine
    engine = ReconciliationEngine(
        uploads_dir=uploads_path,
        old_url=args.old_url,
        new_url=args.new_url
    )

    # 1. Build Physical Disk Inventory
    print("Building disk inventory...")
    engine.build_disk_inventory()
    print(f"Found {len(engine.all_files_on_disk)} files on disk, organized into {len(engine.families)} media families.")
    print()

    # 2. Extract References from Database Exports
    all_references = []
    attachment_id_to_path = {}

    if args.wxr:
        wxr_file = Path(args.wxr)
        if not wxr_file.exists():
            print(f"Error: WXR file '{args.wxr}' does not exist.")
            return 1
        print("Extracting references from WXR XML...")
        wxr_refs, wxr_attachments = parse_wxr(wxr_file, args.old_url, args.new_url)
        all_references.extend(wxr_refs)
        attachment_id_to_path.update(wxr_attachments)
        print(f"Extracted {len(wxr_refs)} references and {len(wxr_attachments)} registered attachments from WXR.")
        print()

    if args.json:
        json_file = Path(args.json)
        if not json_file.exists():
            print(f"Error: JSON file '{args.json}' does not exist.")
            return 1
        print("Extracting references from JSON...")
        json_refs = parse_json(json_file, args.old_url, args.new_url)
        all_references.extend(json_refs)
        print(f"Extracted {len(json_refs)} references from JSON.")
        print()

    if not args.wxr and not args.json:
        print("Warning: No WXR or JSON references provided. Running in disk-only audit mode.")
        print("Without database reference inputs, all files on disk will be treated as 'Unused Candidates' (except for derivatives of each other).")
        print()

    # 3. Perform Reconciliation & Classification
    print("Reconciling references and classifying media library...")
    results = engine.reconcile(all_references, attachment_id_to_path)

    # 4. Save and Export Reports
    export_reports(results, Path(args.output_dir))
    print()

    # 5. Output Console Summary
    summary = results["summary"]
    print("Reconciliation Summary")
    print("----------------------")
    print(f"Total Files on Disk:             {summary['total_files_on_disk']}")
    print(f"Referenced & Present on Disk:    {summary['total_referenced_and_present']}")
    print(f"Missing Files (referenced):      {summary['total_missing_files']}")
    print(f"Unused Candidates on Disk:       {summary['total_unused_candidates']}")
    print(f"Broken Derivatives on Disk:      {summary['total_broken_derivatives']}")
    print(f"Filename Collisions / Divergence: {summary['total_collisions']}")
    print()
    print("Reconciliation complete. Please refer to CSV files in output directory for full detail.")
    return 0

if __name__ == "__main__":
    sys.exit(main())
