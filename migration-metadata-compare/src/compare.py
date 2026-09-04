import json
import re
from typing import Dict, Any, List, Optional, Set, Tuple
from urllib.parse import urlparse
from dataclasses import dataclass, asdict

@dataclass(frozen=True)
class Finding:
    url_before: Optional[str]
    url_after: Optional[str]
    field: str
    before: str
    after: str
    severity: str

# Default Severity Policy
DEFAULT_SEVERITY_POLICY = {
    "status": "error",
    "title": "error",
    "canonical": "error",
    "robots": "error",
    "description": "warning",
    "H1": "warning",
    "content_fingerprint": "warning",
    "language": "warning",
    "schema_types": "info",
    "mapping": "warning",
    "duplicate": "warning",
}

def normalize_whitespace(text: Optional[str]) -> str:
    if text is None:
        return ""
    return re.sub(r"\s+", " ", str(text)).strip()

def normalize_url(url: Optional[str]) -> str:
    if not url:
        return ""
    url = url.strip()
    try:
        parsed = urlparse(url)
        path = parsed.path
        if not path:
            path = "/"
        if path != "/" and path.endswith("/"):
            path = path.rstrip("/")

        query = parsed.query
        normalized = path
        if query:
            # Sort query parameters for deterministic comparison
            params = query.split("&")
            sorted_params = sorted([p for p in params if p])
            if sorted_params:
                normalized = f"{path}?{'&'.join(sorted_params)}"
        return normalized
    except Exception:
        # Fallback to simple string-based cleanup if urlparse fails
        cleaned = url
        if "://" in cleaned:
            cleaned = cleaned.split("://", 1)[1]
            if "/" in cleaned:
                cleaned = "/" + cleaned.split("/", 1)[1]
            else:
                cleaned = "/"
        if cleaned != "/" and cleaned.endswith("/"):
            cleaned = cleaned.rstrip("/")
        return cleaned

def normalize_robots(robots: Optional[str]) -> str:
    if not robots:
        return ""
    directives = [d.strip().lower() for d in str(robots).split(",")]
    directives = [d for d in directives if d]
    directives.sort()
    return ", ".join(directives)

def _extract_types_from_json(data: Any) -> List[str]:
    types = []
    if isinstance(data, list):
        for item in data:
            if isinstance(item, (str, int, float)):
                types.append(str(item))
            else:
                types.extend(_extract_types_from_json(item))
    elif isinstance(data, dict):
        if "@type" in data:
            t = data["@type"]
            if isinstance(t, list):
                types.extend([str(x) for x in t])
            elif isinstance(t, (str, int, float)):
                types.append(str(t))
        for val in data.values():
            if isinstance(val, (dict, list)):
                types.extend(_extract_types_from_json(val))
    elif isinstance(data, (str, int, float)):
        types.append(str(data))
    return types

def normalize_schema_types(schema: Optional[str]) -> str:
    if not schema:
        return ""
    schema_str = str(schema).strip()
    if (schema_str.startswith("[") and schema_str.endswith("]")) or \
       (schema_str.startswith("{") and schema_str.endswith("}")):
        try:
            data = json.loads(schema_str)
            types = _extract_types_from_json(data)
            norm_types = sorted(list(set(t.strip() for t in types if t)))
            return ", ".join(norm_types)
        except Exception:
            pass
    # Fallback to comma-separated string splitting
    parts = [p.strip() for p in schema_str.split(",")]
    parts = sorted(list(set(p for p in parts if p)))
    return ", ".join(parts)

def normalize_language(lang: Optional[str]) -> str:
    if not lang:
        return ""
    # Standardize separator and case
    lang_str = str(lang).strip().lower().replace("_", "-")
    lang_str = lang_str.replace('"', '').replace("'", "")
    return lang_str

def normalize_h1(h1: Optional[str]) -> str:
    if not h1:
        return ""
    h1_str = str(h1).strip()
    if h1_str.startswith("[") and h1_str.endswith("]"):
        try:
            data = json.loads(h1_str)
            if isinstance(data, list):
                items = [normalize_whitespace(str(item)) for item in data if item]
                return " | ".join(sorted(items))
        except Exception:
            pass
    if "\n" in h1_str:
        parts = [normalize_whitespace(p) for p in h1_str.split("\n") if p.strip()]
        return " | ".join(sorted(parts))
    return normalize_whitespace(h1_str)

def normalize_field(field: str, value: Any) -> str:
    """Normalize a specific field based on its comparison rules."""
    if value is None:
        return ""

    val_str = str(value).strip()
    if field == "status":
        return val_str
    elif field == "title":
        return normalize_whitespace(val_str)
    elif field == "description":
        return normalize_whitespace(val_str)
    elif field == "canonical":
        return normalize_url(val_str)
    elif field == "robots":
        return normalize_robots(val_str)
    elif field == "language":
        return normalize_language(val_str)
    elif field == "H1":
        return normalize_h1(val_str)
    elif field == "schema_types":
        return normalize_schema_types(val_str)
    elif field == "content_fingerprint":
        return val_str.strip()

    return val_str

class ComparisonRunner:
    def __init__(self, policy: Optional[Dict[str, str]] = None, fallback_path_match: bool = True):
        self.policy = dict(DEFAULT_SEVERITY_POLICY)
        if policy:
            self.policy.update(policy)
        self.fallback_path_match = fallback_path_match

    def get_severity(self, field: str) -> str:
        return self.policy.get(field, "warning")

    def compare(
        self,
        before_data: List[Dict[str, Any]],
        after_data: List[Dict[str, Any]],
        mapping_pairs: Optional[List[Tuple[str, str]]] = None
    ) -> List[Finding]:
        findings: List[Finding] = []

        # 1. Check for duplicates in before and after datasets
        before_by_url: Dict[str, List[Dict[str, Any]]] = {}
        for row in before_data:
            url = row.get("url")
            if url:
                before_by_url.setdefault(url, []).append(row)

        after_by_url: Dict[str, List[Dict[str, Any]]] = {}
        for row in after_data:
            url = row.get("url")
            if url:
                after_by_url.setdefault(url, []).append(row)

        # Record duplicates in 'before'
        for url, rows in sorted(before_by_url.items()):
            if len(rows) > 1:
                severity = self.get_severity("duplicate")
                if severity != "ignore":
                    findings.append(Finding(
                        url_before=url,
                        url_after=None,
                        field="duplicate",
                        before=f"{len(rows)} duplicate rows found",
                        after="",
                        severity=severity
                    ))

        # Record duplicates in 'after'
        for url, rows in sorted(after_by_url.items()):
            if len(rows) > 1:
                severity = self.get_severity("duplicate")
                if severity != "ignore":
                    findings.append(Finding(
                        url_before=None,
                        url_after=url,
                        field="duplicate",
                        before="",
                        after=f"{len(rows)} duplicate rows found",
                        severity=severity
                    ))

        # Flattened representations (taking first occurrence for duplicates to continue comparison)
        flat_before: Dict[str, Dict[str, Any]] = {url: rows[0] for url, rows in before_by_url.items()}
        flat_after: Dict[str, Dict[str, Any]] = {url: rows[0] for url, rows in after_by_url.items()}

        # 2. Build final map of URL pairs to compare
        # Keep track of which URLs are mapped / compared
        mapped_before_urls: Set[str] = set()
        mapped_after_urls: Set[str] = set()
        compare_pairs: List[Tuple[str, str]] = []

        # Explicit mappings first
        if mapping_pairs:
            # Let's check for duplicate mapping sources or destinations
            seen_sources: Set[str] = set()
            seen_dests: Set[str] = set()
            for src, dest in mapping_pairs:
                if src in seen_sources or dest in seen_dests:
                    severity = self.get_severity("duplicate")
                    if severity != "ignore":
                        findings.append(Finding(
                            url_before=src,
                            url_after=dest,
                            field="duplicate",
                            before=f"Mapping source duplication: {src in seen_sources}" if src in seen_sources else "",
                            after=f"Mapping destination duplication: {dest in seen_dests}" if dest in seen_dests else "",
                            severity=severity
                        ))
                seen_sources.add(src)
                seen_dests.add(dest)

                if src in flat_before and dest in flat_after:
                    compare_pairs.append((src, dest))
                    mapped_before_urls.add(src)
                    mapped_after_urls.add(dest)
                else:
                    # Explicit mapping specified but either before or after is missing from crawl
                    severity = self.get_severity("mapping")
                    if severity != "ignore":
                        if src not in flat_before and src in before_by_url:
                            # It's in before_by_url but flat_before didn't have it? Shouldn't happen
                            pass
                        before_status = "present" if src in flat_before else "absent in crawl"
                        after_status = "present" if dest in flat_after else "absent in crawl"
                        findings.append(Finding(
                            url_before=src,
                            url_after=dest,
                            field="mapping",
                            before=f"Mapping target legacy URL ({before_status})",
                            after=f"Mapping target migrated URL ({after_status})",
                            severity=severity
                        ))
                        if src in flat_before:
                            mapped_before_urls.add(src)
                        if dest in flat_after:
                            mapped_after_urls.add(dest)

        # Fallback path-matching for unmapped before URLs
        unmapped_before = [u for u in flat_before.keys() if u not in mapped_before_urls]
        unmapped_after = [u for u in flat_after.keys() if u not in mapped_after_urls]

        if self.fallback_path_match:
            # Index unmapped after URLs by their normalized path
            after_path_to_url: Dict[str, str] = {}
            for u in unmapped_after:
                norm_p = normalize_url(u)
                if norm_p and norm_p not in after_path_to_url:
                    after_path_to_url[norm_p] = u

            for src in unmapped_before:
                norm_src = normalize_url(src)
                if norm_src in after_path_to_url:
                    # Performance optimization: Use O(1) dict.pop() instead of O(N) list.remove()
                    dest = after_path_to_url.pop(norm_src)
                    compare_pairs.append((src, dest))
                    mapped_before_urls.add(src)
                    mapped_after_urls.add(dest)

        # 3. Report missing mappings for remaining unmapped URLs
        # Remaining unmapped before URLs
        for src in sorted(list(set(flat_before.keys()) - mapped_before_urls)):
            severity = self.get_severity("mapping")
            if severity != "ignore":
                findings.append(Finding(
                    url_before=src,
                    url_after=None,
                    field="mapping",
                    before="Legacy URL is unmapped and has no matching path in migrated crawl",
                    after="",
                    severity=severity
                ))

        # Remaining unmapped after URLs
        for dest in sorted(list(set(flat_after.keys()) - mapped_after_urls)):
            severity = self.get_severity("mapping")
            if severity != "ignore":
                findings.append(Finding(
                    url_before=None,
                    url_after=dest,
                    field="mapping",
                    before="",
                    after="Migrated URL has no legacy URL mapping to it",
                    severity=severity
                ))

        # 4. Compare fields for all mapped URL pairs
        fields_to_compare = [
            "status", "title", "description", "canonical",
            "robots", "language", "H1", "schema_types", "content_fingerprint"
        ]

        # Ensure deterministic pair order (sort by before URL)
        compare_pairs.sort(key=lambda p: p[0])

        for src, dest in compare_pairs:
            row_before = flat_before[src]
            row_after = flat_after[dest]

            for field in fields_to_compare:
                raw_before = row_before.get(field)
                raw_after = row_after.get(field)

                norm_before = normalize_field(field, raw_before)
                norm_after = normalize_field(field, raw_after)

                if norm_before != norm_after:
                    severity = self.get_severity(field)
                    if severity != "ignore":
                        findings.append(Finding(
                            url_before=src,
                            url_after=dest,
                            field=field,
                            before=str(raw_before) if raw_before is not None else "",
                            after=str(raw_after) if raw_after is not None else "",
                            severity=severity
                        ))

        return findings
