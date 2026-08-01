#!/usr/bin/env python3
"""
JSON-LD and Structured Data Extractor

An offline, zero-dependency utility to extract, normalize, analyze, and inventory
JSON-LD from saved HTML files or a crawl manifest.
"""

import os
import re
import sys
import json
import csv
import argparse
from html.parser import HTMLParser
from typing import List, Dict, Any, Tuple, Optional, Set


class JSONLDParser(HTMLParser):
    """
    An HTML parser that extracts raw contents of <script type="application/ld+json"> blocks.
    """
    def __init__(self):
        super().__init__()
        self.blocks: List[Tuple[int, str]] = []
        self.in_json_ld = False
        self.current_block: List[str] = []
        self.current_line = 1

    def handle_starttag(self, tag: str, attrs: List[Tuple[str, Optional[str]]]) -> None:
        if tag.lower() == 'script':
            is_json_ld = False
            for attr, val in attrs:
                if attr.lower() == 'type' and val and val.lower().strip() == 'application/ld+json':
                    is_json_ld = True
                    break
            if is_json_ld:
                self.in_json_ld = True
                self.current_block = []
                self.current_line = self.getpos()[0]

    def handle_endtag(self, tag: str) -> None:
        if tag.lower() == 'script' and self.in_json_ld:
            self.in_json_ld = False
            self.blocks.append((self.current_line, "".join(self.current_block)))
            self.current_block = []

    def handle_data(self, data: str) -> None:
        if self.in_json_ld:
            self.current_block.append(data)


def clean_json_ld_text(text: str) -> str:
    """
    Clean up JS comments, HTML comments, and CDATA wrappers around JSON-LD content.
    """
    text = text.strip()

    # Strip HTML comment wraps <!-- ... --> if they wrap the entire thing
    if text.startswith("<!--") and text.endswith("-->"):
        text = text[4:-3].strip()

    # Strip CDATA wrappers
    # Matches patterns like //<![CDATA[ or /* <![CDATA[ */ or // ]]> or /* ]]> */
    text = re.sub(r'(?://|/\*)\s*<!\[CDATA\[\s*(?:\*/)?', '', text, flags=re.IGNORECASE)
    text = re.sub(r'(?://|/\*)\s*\]\]>\s*(?:\*/)?', '', text, flags=re.IGNORECASE)
    text = re.sub(r'<!\[CDATA\[|\]\]>', '', text, flags=re.IGNORECASE)

    return text.strip()


# Global constant to avoid set allocation on every call of is_node
EXCLUDED_KEYS = {"@id", "@context", "@graph"}

def is_node(val: Any) -> bool:
    """
    Determines if a dictionary is a structured data Node (as opposed to a pure reference or literal).
    An object is a Node if it is a dictionary, is not empty, and either:
    1. Has a '@type' key.
    2. Has keys other than '@id', '@context', and '@graph'.
    """
    if not isinstance(val, dict):
        return False
    if not val:
        return False
    if "@type" in val:
        return True

    # Avoid set creation or subtraction on hot loops
    for k in val:
        if k not in EXCLUDED_KEYS:
            return True
    return False


def check_old_domains(val: Any, old_domains: List[str]) -> bool:
    """
    Recursively scans JSON value to check if any string contains any of the specified old domains.
    """
    if not old_domains:
        return False

    if isinstance(val, str):
        val_lower = val.lower()
        for domain in old_domains:
            if domain.lower() in val_lower:
                return True
    elif isinstance(val, list):
        for item in val:
            if check_old_domains(item, old_domains):
                return True
    elif isinstance(val, dict):
        for k, v in val.items():
            if check_old_domains(k, old_domains) or check_old_domains(v, old_domains):
                return True
    return False


def extract_from_value(
    val: Any,
    parent_id: Optional[str],
    page_state: Dict[str, Any],
    block_index: int,
    old_domains: List[str]
) -> Any:
    """
    Recursively processes JSON values to:
    1. Unpack arrays & flatten @graph containers.
    2. Extract nested structured data nodes and add them to page_state["nodes"].
    3. Return a clean normalized value for parent/referencing property.
    """
    if isinstance(val, dict):
        # Handle @graph container
        if "@graph" in val:
            graph_val = val["@graph"]
            if isinstance(graph_val, list):
                for item in graph_val:
                    extract_from_value(item, None, page_state, block_index, old_domains)
            else:
                extract_from_value(graph_val, None, page_state, block_index, old_domains)

            # Extract nodes from any other keys in this container (e.g., top-level properties or contexts)
            for k, v in val.items():
                if k != "@graph":
                    extract_from_value(v, parent_id, page_state, block_index, old_domains)
            return None

        # Handle a standard Node
        if is_node(val):
            # Resolve Node ID
            node_id = val.get("@id")
            is_blank = False
            if not node_id:
                page_state["blank_node_counter"] += 1
                node_id = f"_:b_{page_state['blank_node_counter']}"
                is_blank = True

            # Resolve Type
            node_type = val.get("@type")

            # Create node record stub (preserve layout/order)
            node_record = {
                "id": node_id,
                "type": node_type,
                "parent_id": parent_id,
                "properties": {},
                "findings": [],
                "block_index": block_index,
                "node_index": len(page_state["nodes"]),
                "is_blank": is_blank,
                "raw_object": val
            }

            page_state["nodes"].append(node_record)

            # Populate normalized properties
            properties = {}
            for k, v in val.items():
                if k in ("@id", "@type", "@context"):
                    continue
                # Recurse on children, associating this node_id as their parent_id
                properties[k] = extract_from_value(v, node_id, page_state, block_index, old_domains)

            node_record["properties"] = properties

            # Apply analytical rules/findings
            # A. Missing expected type
            if not node_type:
                node_record["findings"].append("missing_type")

            # B. Duplicate ID detection
            if not is_blank:
                if node_id in page_state["seen_ids"]:
                    node_record["findings"].append("duplicate_id")
                page_state["seen_ids"].add(node_id)

            # C. Old Domain Reference detection
            if old_domains and check_old_domains(val, old_domains):
                node_record["findings"].append("old_domain_reference")

            # Return pointer/reference to this node
            return {"@id": node_id}

        else:
            # Not a Node (e.g., a pure reference like {"@id": "some_uri"} or empty object)
            norm_dict = {}
            for k, v in val.items():
                norm_dict[k] = extract_from_value(v, parent_id, page_state, block_index, old_domains)
            return norm_dict

    elif isinstance(val, list):
        norm_list = []
        for item in val:
            norm_item = extract_from_value(item, parent_id, page_state, block_index, old_domains)
            if norm_item is not None:
                norm_list.append(norm_item)
        return norm_list

    else:
        # Primitive type
        return val


def parse_html_file(
    filepath: str,
    url: Optional[str] = None,
    old_domains: Optional[List[str]] = None
) -> Dict[str, Any]:
    """
    Parses a single HTML file to extract, normalize, and validate JSON-LD structured data.
    """
    if old_domains is None:
        old_domains = []

    prov_url = url or ""
    prov_file = filepath

    page_state = {
        "nodes": [],
        "seen_ids": set(),
        "blank_node_counter": 0,
        "errors": []
    }

    # Read HTML content safely
    try:
        with open(filepath, "r", encoding="utf-8", errors="replace") as f:
            html_content = f.read()
    except Exception as e:
        return {
            "provenance_url": prov_url,
            "provenance_file": prov_file,
            "errors": [{
                "line": 0,
                "block_index": 0,
                "error": f"Failed to read file: {str(e)}"
            }],
            "nodes": []
        }

    # Extract JSON-LD script blocks
    parser = JSONLDParser()
    try:
        parser.feed(html_content)
    except Exception as e:
        page_state["errors"].append({
            "line": 0,
            "block_index": 0,
            "error": f"HTML Parsing exception: {str(e)}"
        })

    # Process each JSON-LD block
    for idx, (line_no, raw_text) in enumerate(parser.blocks):
        cleaned_text = clean_json_ld_text(raw_text)
        if not cleaned_text:
            continue

        try:
            parsed_json = json.loads(cleaned_text)
        except Exception as e:
            page_state["errors"].append({
                "line": line_no,
                "block_index": idx,
                "error": f"JSON parse error at line {line_no}: {str(e)}"
            })
            continue

        # Extract structured data recursively from parsed JSON
        extract_from_value(parsed_json, None, page_state, idx, old_domains)

    # Convert nodes into output format and clean internal fields
    cleaned_nodes = []
    for node in page_state["nodes"]:
        cleaned_node = {
            "id": node["id"],
            "type": node["type"],
            "parent_id": node["parent_id"],
            "block_index": node["block_index"],
            "node_index": node["node_index"],
            "findings": sorted(list(set(node["findings"]))),
            "properties": node["properties"]
        }
        cleaned_nodes.append(cleaned_node)

    return {
        "provenance_url": prov_url,
        "provenance_file": prov_file,
        "errors": page_state["errors"],
        "nodes": cleaned_nodes
    }


def write_outputs(
    results: List[Dict[str, Any]],
    output_dir: str
) -> Tuple[str, str]:
    """
    Writes the deterministic normalized JSON and stable flattened CSV outputs.
    Returns paths to written files.
    """
    os.makedirs(output_dir, exist_ok=True)

    # Sort results by provenance_url then provenance_file to be deterministic
    results.sort(key=lambda x: (x["provenance_url"], x["provenance_file"]))

    # 1. Generate Deterministic Normalized JSON
    total_pages = len(results)
    total_nodes = sum(len(p["nodes"]) for p in results)
    total_errors = sum(len(p["errors"]) for p in results)
    total_findings = sum(sum(len(n["findings"]) for n in p["nodes"]) for p in results)

    output_data = {
        "summary": {
            "total_pages": total_pages,
            "total_nodes": total_nodes,
            "total_errors": total_errors,
            "total_findings": total_findings
        },
        "pages": results
    }

    json_path = os.path.join(output_dir, "normalized_structured_data.json")
    with open(json_path, "w", encoding="utf-8") as f:
        # Use sort_keys and indent for perfect, predictable, lossless format
        json.dump(output_data, f, indent=2, sort_keys=True)

    # 2. Generate Stable Flattened CSV
    csv_path = os.path.join(output_dir, "flattened_structured_data.csv")
    csv_headers = [
        "provenance_url",
        "provenance_file",
        "block_index",
        "node_index",
        "id",
        "type",
        "parent_id",
        "findings",
        "properties_json"
    ]

    with open(csv_path, "w", encoding="utf-8", newline="") as f:
        writer = csv.writer(f)
        writer.writerow(csv_headers)

        for page in results:
            prov_url = page["provenance_url"]
            prov_file = page["provenance_file"]

            # Order of nodes is naturally stable due to extraction sequence
            for node in page["nodes"]:
                node_type = node["type"]
                # Normalize type if list
                if isinstance(node_type, list):
                    type_str = ",".join(str(t) for t in node_type)
                else:
                    type_str = str(node_type) if node_type is not None else ""

                findings_str = ",".join(node["findings"])

                # Deterministic serialized properties string
                properties_str = json.dumps(node["properties"], sort_keys=True)

                row = [
                    prov_url,
                    prov_file,
                    node["block_index"],
                    node["node_index"],
                    node["id"],
                    type_str,
                    node["parent_id"] or "",
                    findings_str,
                    properties_str
                ]
                writer.writerow(row)

    return json_path, csv_path


def load_manifest(manifest_path: str) -> List[Dict[str, str]]:
    """
    Loads and resolves entries from a crawl manifest file.
    """
    manifest_dir = os.path.dirname(os.path.abspath(manifest_path))
    with open(manifest_path, "r", encoding="utf-8") as f:
        data = json.load(f)

    if not isinstance(data, list):
        raise ValueError("Manifest content must be a JSON array of page definitions.")

    resolved_entries = []
    for entry in data:
        url = entry.get("url")
        file_path = entry.get("file")
        if not file_path:
            continue

        # Resolve relative path relative to manifest location
        if not os.path.isabs(file_path):
            file_path = os.path.normpath(os.path.join(manifest_dir, file_path))

        resolved_entries.append({
            "url": url,
            "file": file_path
        })
    return resolved_entries


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Extract, normalize, validate, and inventory JSON-LD structured data from HTML or crawl manifests."
    )

    # Input selection
    group = parser.add_mutually_exclusive_group(required=True)
    group.add_argument("--file", help="Path to a single local HTML file.")
    group.add_argument("--dir", help="Path to a directory of HTML files.")
    group.add_argument("--manifest", help="Path to a crawl manifest JSON file.")

    parser.add_argument("--url", help="Override or specify URL for the single HTML file (optional, used with --file).")
    parser.add_argument("--old-domain", action="append", help="Old domain(s) to check for. Can be specified multiple times.")
    parser.add_argument("--output-dir", default="out", help="Directory where results will be saved (defaults to 'out').")
    parser.add_argument("--dry-run", action="store_true", help="Perform extraction and display summary without writing output files.")

    args = parser.parse_args()

    old_domains = args.old_domain or []
    results = []

    # Identify HTML file inputs
    if args.file:
        if not os.path.isfile(args.file):
            print(f"Error: Specified file does not exist: {args.file}", file=sys.stderr)
            return 1
        results.append(parse_html_file(args.file, args.url, old_domains))

    elif args.dir:
        if not os.path.isdir(args.dir):
            print(f"Error: Specified directory does not exist: {args.dir}", file=sys.stderr)
            return 1
        # Find all HTML files recursively
        for root, _, files in os.walk(args.dir):
            for file in files:
                if file.lower().endswith((".html", ".htm")):
                    full_path = os.path.join(root, file)
                    results.append(parse_html_file(full_path, None, old_domains))

    elif args.manifest:
        if not os.path.isfile(args.manifest):
            print(f"Error: Specified manifest file does not exist: {args.manifest}", file=sys.stderr)
            return 1
        try:
            entries = load_manifest(args.manifest)
        except Exception as e:
            print(f"Error: Failed to load manifest: {str(e)}", file=sys.stderr)
            return 1

        for entry in entries:
            if not os.path.isfile(entry["file"]):
                print(f"Warning: Manifest file target not found, skipping: {entry['file']}", file=sys.stderr)
                continue
            results.append(parse_html_file(entry["file"], entry["url"], old_domains))

    # Output Summary
    total_pages = len(results)
    total_nodes = sum(len(p["nodes"]) for p in results)
    total_errors = sum(len(p["errors"]) for p in results)
    total_findings = sum(sum(len(n["findings"]) for n in p["nodes"]) for p in results)

    print("--- Extraction Complete ---")
    print(f"Total Pages Processed: {total_pages}")
    print(f"Total Extracted Nodes: {total_nodes}")
    print(f"Total Parse Errors:    {total_errors}")
    print(f"Total Findings:        {total_findings}")

    if total_errors > 0:
        print("\nParse Errors Encountered:")
        for page in results:
            if page["errors"]:
                print(f"  In file: {page['provenance_file']}")
                for err in page["errors"]:
                    print(f"    Block {err['block_index']} at line {err['line']}: {err['error']}")

    if args.dry_run:
        print("\nDry-run mode. Skipping output generation.")
        return 0

    # Write output JSON and CSV
    try:
        json_file, csv_file = write_outputs(results, args.output_dir)
        print(f"\nSaved normalized JSON to: {json_file}")
        print(f"Saved flattened CSV to:    {csv_file}")
    except Exception as e:
        print(f"Error writing output files: {str(e)}", file=sys.stderr)
        return 1

    return 0


if __name__ == "__main__":
    sys.exit(main())
