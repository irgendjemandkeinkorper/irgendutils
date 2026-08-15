import os
import sys
import json
import argparse
from typing import List, Dict, Any, Optional

from .validator import TiledValidator

def parse_args(args: Optional[List[str]] = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Tiled map and tileset validator for 2D games. Validates TMJ/TSJ maps/tilesets."
    )
    parser.add_argument(
        "target",
        nargs="?",
        default=".",
        help="Path to a map file (.tmj), tileset file (.tsj), or a directory to recursively scan."
    )
    parser.add_argument(
        "--config", "-c",
        help="Path to JSON configuration file for custom/required validation rules."
    )
    parser.add_argument(
        "--format", "-f",
        choices=["json", "pretty"],
        default="pretty",
        help="Output format (default: pretty)."
    )
    return parser.parse_args(args)

def scan_directory(directory: str) -> List[str]:
    """Recursively find all TMJ and TSJ files under directory."""
    files = []
    for root, _, filenames in os.walk(directory):
        for name in filenames:
            ext = os.path.splitext(name)[1].lower()
            if ext in (".tmj", ".tsj"):
                files.append(os.path.join(root, name))
    return sorted(files)

def run_cli(args_list: Optional[List[str]] = None) -> int:
    args = parse_args(args_list)

    # Load optional config
    config = {}
    if args.config:
        if not os.path.exists(args.config):
            sys.stderr.write(f"Error: Config file not found at '{args.config}'\n")
            return 2
        try:
            with open(args.config, 'r', encoding='utf-8') as f:
                config = json.load(f)
        except Exception as e:
            sys.stderr.write(f"Error: Failed to parse config JSON: {str(e)}\n")
            return 2

    target = args.target
    if not os.path.exists(target):
        sys.stderr.write(f"Error: Target path '{target}' does not exist\n")
        return 2

    # Collect files to validate
    files_to_validate = []
    if os.path.isdir(target):
        files_to_validate = scan_directory(target)
    else:
        files_to_validate = [target]

    if not files_to_validate:
        sys.stderr.write(f"Warning: No .tmj or .tsj files found in '{target}'\n")
        # Returning 0 as there were no errors, but could be seen as success
        return 0

    validator = TiledValidator(config)
    all_findings = []
    scanned_files = []

    # Keep track of already validated tilesets to prevent duplicate validations
    # if they are also mapped files or referenced by maps.
    validated_files = set()

    for path in files_to_validate:
        normalized_path = os.path.abspath(path)
        if normalized_path in validated_files:
            continue

        ext = os.path.splitext(path)[1].lower()
        if ext == ".tmj":
            scanned_files.append(path)
            findings = validator.validate_map(path)
            all_findings.extend(findings)
            # External tilesets referenced by maps are validated inside validate_map,
            # but if they are explicitly in files_to_validate we want to avoid double-logging
            # or maybe we want to run them anyway? Let's add them to validated_files.
            validated_files.add(normalized_path)
        elif ext == ".tsj":
            scanned_files.append(path)
            findings = validator.validate_tileset(path)
            all_findings.extend(findings)
            validated_files.add(normalized_path)

    # Summarize results
    errors_count = sum(1 for f in all_findings if f["severity"] == "error")
    warnings_count = sum(1 for f in all_findings if f["severity"] == "warning")

    results = {
        "success": errors_count == 0,
        "scanned_files": scanned_files,
        "summary": {
            "errors": errors_count,
            "warnings": warnings_count,
            "total_findings": len(all_findings)
        },
        "findings": all_findings
    }

    if args.format == "json":
        print(json.dumps(results, indent=2))
    else:
        # Pretty printing
        print(f"Scanned {len(scanned_files)} file(s).")
        print(f"Validation summary: {errors_count} error(s), {warnings_count} warning(s)")
        print("-" * 60)
        for f in all_findings:
            severity_tag = f"[{f['severity'].upper()}]"
            print(f"{severity_tag} ({f['category']}) in {f['file']}:")
            print(f"  {f['message']}")
            if f.get("context"):
                print(f"  Context: {json.dumps(f['context'])}")
            print("-" * 60)

        if errors_count == 0:
            print("Validation PASSED successfully.")
        else:
            print("Validation FAILED.")

    return 1 if errors_count > 0 else 0

if __name__ == "__main__":
    sys.exit(run_cli())
