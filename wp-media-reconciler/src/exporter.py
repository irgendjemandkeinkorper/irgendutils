import json
import csv
from pathlib import Path

def export_reports(results: dict, output_dir: Path):
    """
    Exports reconciliation results to JSON and CSV formats.
    """
    output_dir = Path(output_dir)
    output_dir.mkdir(parents=True, exist_ok=True)

    # 1. Export summary and full structure to JSON
    summary_path = output_dir / "reconciliation_summary.json"
    with open(summary_path, "w", encoding="utf-8") as f:
        json.dump(results, f, indent=2, ensure_ascii=False)
    print(f"Summary and detailed JSON saved to: {summary_path}")

    # 2. Export Missing Files CSV
    missing_path = output_dir / "missing_files.csv"
    with open(missing_path, "w", encoding="utf-8", newline="") as f:
        writer = csv.writer(f)
        writer.writerow([
            "Referenced Path",
            "Type",
            "Parent Path (if derivative)",
            "Heuristic Candidates on Disk",
            "Source References & Context"
        ])
        for item in results["missing_files"]:
            heuristics = "; ".join(item["heuristic_candidates"])
            sources = "; ".join(
                f"{ref['source']} ({ref['context']})" for ref in item["references"]
            )
            writer.writerow([
                item["referenced_path"],
                item["type"],
                item["parent_path"] or "",
                heuristics,
                sources
            ])
    print(f"Missing Files CSV saved to:          {missing_path}")

    # 3. Export Unused Candidates CSV
    unused_path = output_dir / "unused_candidates.csv"
    with open(unused_path, "w", encoding="utf-8", newline="") as f:
        writer = csv.writer(f)
        writer.writerow([
            "File Path",
            "Is Derivative",
            "Parent Path",
            "File Size (Bytes)"
        ])
        for item in results["unused_candidates"]:
            writer.writerow([
                item["file_path"],
                "Yes" if item["is_derivative"] else "No",
                item["parent_path"] or "",
                item["file_size"]
            ])
    print(f"Unused Candidates CSV saved to:      {unused_path}")

    # 4. Export Broken Derivatives CSV
    broken_path = output_dir / "broken_derivatives.csv"
    with open(broken_path, "w", encoding="utf-8", newline="") as f:
        writer = csv.writer(f)
        writer.writerow([
            "File Path",
            "Missing Parent Path",
            "File Size (Bytes)",
            "Is Referenced on Site"
        ])
        for item in results["broken_derivatives"]:
            writer.writerow([
                item["file_path"],
                item["parent_path"],
                item["file_size"],
                "Yes" if item["is_used"] else "No"
            ])
    print(f"Broken Derivatives CSV saved to:     {broken_path}")

    # 5. Export Collisions CSV
    collisions_path = output_dir / "collisions.csv"
    with open(collisions_path, "w", encoding="utf-8", newline="") as f:
        writer = csv.writer(f)
        writer.writerow([
            "Filename",
            "Collision Type",
            "Matching Paths on Disk"
        ])
        for item in results["collisions"]:
            writer.writerow([
                item["filename"],
                item["type"],
                "; ".join(item["matching_paths"])
            ])
    print(f"Filename Collisions CSV saved to:    {collisions_path}")
