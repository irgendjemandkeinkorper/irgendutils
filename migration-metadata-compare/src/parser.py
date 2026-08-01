import csv
import json
from typing import Dict, Any, List, Tuple, Optional

# Standard Column Aliases for Auto-Detection
COLUMN_ALIASES = {
    "url": ["url", "address", "address", "loc", "href", "link", "page url", "page_url", "slug"],
    "status": ["status", "status_code", "statuscode", "code", "http status", "http_status"],
    "title": ["title", "page_title", "page title", "seo title", "seo_title", "meta_title", "meta title"],
    "description": ["description", "meta_description", "meta description", "seo description", "seo_description"],
    "canonical": ["canonical", "canonical_url", "canonical url", "canonical_link", "canonical link"],
    "robots": ["robots", "meta_robots", "meta robots", "robots_meta", "robots meta"],
    "language": ["language", "lang", "locale", "html_lang", "html lang"],
    "H1": ["h1", "h1_content", "h1 content", "heading1", "heading 1", "h1s"],
    "schema_types": ["schema_types", "schema types", "schema", "schema_jsonld", "schemas", "jsonld"],
    "content_fingerprint": ["content_fingerprint", "content fingerprint", "fingerprint", "content_hash", "hash", "fingerprint_hash", "content hash"]
}

def _map_fields_from_rows(rows: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    mapped_rows = []
    for row in rows:
        row_lower = {str(k).strip().lower(): v for k, v in row.items() if k is not None}

        mapped = {}
        for std_key, aliases in COLUMN_ALIASES.items():
            val = None
            for alias in aliases:
                if alias in row_lower:
                    val = row_lower[alias]
                    break
            mapped[std_key] = val

        # Require url to be present and non-empty to include the row
        if mapped.get("url"):
            # Ensure url is treated as a clean string
            mapped["url"] = str(mapped["url"]).strip()
            # Ensure status is treated as a clean string if present
            if mapped.get("status") is not None:
                mapped["status"] = str(mapped["status"]).strip()
            mapped_rows.append(mapped)
    return mapped_rows

def parse_crawl_file(file_path: str) -> List[Dict[str, Any]]:
    """Parse a crawl file which can be either CSV or JSONL format."""
    path_lower = file_path.lower()
    if path_lower.endswith(".json") or path_lower.endswith(".jsonl"):
        return parse_jsonl_crawl(file_path)
    else:
        return parse_csv_crawl(file_path)

def parse_csv_crawl(file_path: str) -> List[Dict[str, Any]]:
    """Parse a CSV crawl file into standardized records."""
    with open(file_path, mode="r", encoding="utf-8-sig") as f:
        reader = csv.DictReader(f)
        rows = list(reader)
    return _map_fields_from_rows(rows)

def parse_jsonl_crawl(file_path: str) -> List[Dict[str, Any]]:
    """Parse a JSONL crawl file into standardized records."""
    rows = []
    with open(file_path, mode="r", encoding="utf-8") as f:
        # Also support standard JSON array if the whole file is wrapped in []
        content = f.read().strip()
        if not content:
            return []

        if content.startswith("[") and content.endswith("]"):
            try:
                data = json.loads(content)
                if isinstance(data, list):
                    rows = data
            except Exception:
                pass

        if not rows:
            # Reset to parse line-by-line JSONL
            lines = content.splitlines()
            for line in lines:
                line = line.strip()
                if not line:
                    continue
                try:
                    data = json.loads(line)
                    if isinstance(data, dict):
                        rows.append(data)
                except Exception:
                    pass

    return _map_fields_from_rows(rows)

def parse_url_mapping(file_path: str) -> List[Tuple[str, str]]:
    """Parse a URL mapping file which can be CSV, JSON, or JSONL."""
    path_lower = file_path.lower()
    if path_lower.endswith(".json") or path_lower.endswith(".jsonl"):
        return _parse_json_mapping(file_path)
    else:
        return _parse_csv_mapping(file_path)

def _extract_from_json_list(data: List[Any]) -> List[Tuple[str, str]]:
    pairs = []
    old_keys = ["old_url", "old", "source", "from", "legacy_url", "legacy", "before", "url_before"]
    new_keys = ["new_url", "new", "destination", "to", "migrated_url", "migrated", "after", "url_after"]
    for item in data:
        if isinstance(item, dict):
            item_lower = {str(k).strip().lower(): v for k, v in item.items() if k}
            src, dest = None, None
            for k in old_keys:
                if k in item_lower:
                    src = item_lower[k]
                    break
            for k in new_keys:
                if k in item_lower:
                    dest = item_lower[k]
                    break

            # Fallback if specific keys aren't matched: take first two values
            if (not src or not dest) and len(item) >= 2:
                vals = list(item.values())
                src, dest = vals[0], vals[1]

            if src is not None and dest is not None:
                pairs.append((str(src).strip(), str(dest).strip()))
    return pairs

def _parse_json_mapping(file_path: str) -> List[Tuple[str, str]]:
    with open(file_path, mode="r", encoding="utf-8") as f:
        content = f.read().strip()
        if not content:
            return []

        try:
            data = json.loads(content)
            if isinstance(data, dict):
                # Simple key-value format: {"old_url": "new_url"}
                return [(str(k).strip(), str(v).strip()) for k, v in data.items() if k is not None and v is not None]
            elif isinstance(data, list):
                return _extract_from_json_list(data)
        except json.JSONDecodeError:
            # Try line-by-line JSONL mapping
            lines = content.splitlines()
            objs = []
            for line in lines:
                if line.strip():
                    try:
                        objs.append(json.loads(line))
                    except Exception:
                        pass
            if objs:
                # If first item is direct dictionary, or list
                if isinstance(objs[0], dict) and len(objs) == 1:
                    return [(str(k).strip(), str(v).strip()) for k, v in objs[0].items() if k is not None and v is not None]
                return _extract_from_json_list(objs)
    return []

def _parse_csv_mapping(file_path: str) -> List[Tuple[str, str]]:
    pairs = []
    old_keys = ["old_url", "old", "source", "from", "legacy_url", "legacy", "before", "url_before"]
    new_keys = ["new_url", "new", "destination", "to", "migrated_url", "migrated", "after", "url_after"]

    with open(file_path, mode="r", encoding="utf-8-sig") as f:
        # Read first few lines to sniff header
        lines = [f.readline() for _ in range(5)]
        f.seek(0)

        has_header = False
        if lines:
            first_line = lines[0].lower()
            # Split by comma and strip to check if any field exactly matches header keywords
            fields = [field.strip() for field in first_line.split(",")]
            all_mapping_keys = old_keys + new_keys
            if any(f in all_mapping_keys for f in fields):
                has_header = True

        if has_header:
            reader = csv.DictReader(f)
            for row in reader:
                row_lower = {str(k).strip().lower(): v for k, v in row.items() if k is not None}
                src, dest = None, None
                for k in old_keys:
                    if k in row_lower:
                        src = row_lower[k]
                        break
                for k in new_keys:
                    if k in row_lower:
                        dest = row_lower[k]
                        break

                if (not src or not dest) and len(row) >= 2:
                    vals = list(row.values())
                    src, dest = vals[0], vals[1]

                if src is not None and dest is not None:
                    pairs.append((str(src).strip(), str(dest).strip()))
        else:
            # Headerless CSV: first column is old_url, second is new_url
            reader = csv.reader(f)
            for row in reader:
                if len(row) >= 2:
                    pairs.append((row[0].strip(), row[1].strip()))
    return pairs
