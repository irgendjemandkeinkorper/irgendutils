import json
import re
import csv
from typing import Dict, List, Tuple, Union, Optional

class BaseAdapter:
    """Base class for adapters that read localizations and returns a dictionary of key-value pairs."""
    def parse(self, filepath: str) -> Dict[str, str]:
        raise NotImplementedError("Subclasses must implement parse()")

class JSONAdapter(BaseAdapter):
    """Parses JSON files. Can accept key-value dicts or a list of objects containing id and text keys."""
    def parse(self, filepath: str) -> Dict[str, str]:
        with open(filepath, "r", encoding="utf-8") as f:
            data = json.load(f)

        result: Dict[str, str] = {}
        if isinstance(data, dict):
            for k, v in data.items():
                if isinstance(v, str):
                    result[k] = v
                elif isinstance(v, dict) and "text" in v:
                    result[k] = str(v["text"])
        elif isinstance(data, list):
            for idx, item in enumerate(data):
                if isinstance(item, dict):
                    # Try to locate key/id and value/text
                    item_id = item.get("id") or item.get("key")
                    item_text = item.get("text") or item.get("value")
                    if item_id is not None and item_text is not None:
                        result[str(item_id)] = str(item_text)
                    else:
                        # Fallback: if there are only 2 keys, use first as key, second as value
                        keys = list(item.keys())
                        if len(keys) == 2:
                            result[str(item[keys[0]])] = str(item[keys[1]])
        return result

class CSVAdapter(BaseAdapter):
    """
    Parses RFC-4180 style CSV files with zero external dependencies.
    Auto-detects common ID/key and text/value header columns if not explicitly provided.
    """
    def __init__(self, key_col: Optional[str] = None, val_col: Optional[str] = None):
        self.key_col = key_col
        self.val_col = val_col

    def parse(self, filepath: str) -> Dict[str, str]:
        rows: List[List[str]] = []
        with open(filepath, "r", encoding="utf-8", newline="") as f:
            reader = csv.reader(f)
            for row in reader:
                rows.append(row)

        if not rows:
            return {}

        headers = [h.strip().lower() for h in rows[0]]

        # Auto-detect key and value columns
        key_idx = -1
        val_idx = -1

        if self.key_col:
            key_col_lower = self.key_col.lower()
            if key_col_lower in headers:
                key_idx = headers.index(key_col_lower)
        else:
            # Look for common ID header names
            id_keywords = ["id", "key", "string_id", "stringid", "name"]
            for kw in id_keywords:
                if kw in headers:
                    key_idx = headers.index(kw)
                    break
            if key_idx == -1 and len(headers) > 0:
                key_idx = 0

        if self.val_col:
            val_col_lower = self.val_col.lower()
            if val_col_lower in headers:
                val_idx = headers.index(val_col_lower)
        else:
            # Look for common text/value header names
            val_keywords = ["text", "value", "translation", "string", "content", "source"]
            for kw in val_keywords:
                if kw in headers:
                    val_idx = headers.index(kw)
                    break
            if val_idx == -1 and len(headers) > 1:
                val_idx = 1
                if val_idx == key_idx:
                    val_idx = 0 if key_idx != 0 else 1

        if key_idx == -1 or val_idx == -1 or key_idx >= len(headers) or val_idx >= len(headers):
            # If auto-detection fails, fallback to 0 and 1
            key_idx = 0
            val_idx = 1 if len(headers) > 1 else 0

        result: Dict[str, str] = {}
        for row in rows[1:]:
            if not row:
                continue
            if len(row) > max(key_idx, val_idx):
                k = row[key_idx].strip()
                v = row[val_idx]
                if k:
                    result[k] = v
        return result

class POAdapter(BaseAdapter):
    """
    Parses PO/gettext localization files with zero external dependencies.
    Extracts msgid and msgstr, processing escaped characters and multiline values.
    """
    def _unescape(self, s: str) -> str:
        # Standard escapes to replace
        escapes = {
            '\\n': '\n',
            '\\t': '\t',
            '\\r': '\r',
            '\\"': '"',
            '\\\\': '\\'
        }
        # Use regex to replace escaped sequences correctly
        def replace(match):
            seq = match.group(0)
            return escapes.get(seq, seq)
        return re.sub(r'\\[ntr"\\]', replace, s)

    def parse(self, filepath: str) -> Dict[str, str]:
        result: Dict[str, str] = {}

        with open(filepath, "r", encoding="utf-8") as f:
            lines = f.readlines()

        current_msgid: List[str] = []
        current_msgstr: List[str] = []
        in_msgid = False
        in_msgstr = False

        def save_entry():
            nonlocal current_msgid, current_msgstr
            if current_msgid:
                # Merge multiline strings
                msgid_str = "".join(current_msgid)
                msgstr_str = "".join(current_msgstr)
                # Unescape standard character sequences
                msgid_str = self._unescape(msgid_str)
                msgstr_str = self._unescape(msgstr_str)
                if msgid_str: # Avoid saving header entries where msgid is empty
                    result[msgid_str] = msgstr_str
            current_msgid = []
            current_msgstr = []

        for line in lines:
            line_str = line.strip()
            if not line_str or line_str.startswith("#"):
                continue

            # msgid pattern
            if line_str.startswith("msgid"):
                save_entry() # Save any previous accumulated entry
                in_msgid = True
                in_msgstr = False
                # Extract starting string
                match = re.match(r'^msgid\s+"(.*)"$', line_str)
                if match:
                    current_msgid.append(match.group(1))
            # msgstr pattern
            elif line_str.startswith("msgstr"):
                in_msgid = False
                in_msgstr = True
                match = re.match(r'^msgstr\s+"(.*)"$', line_str)
                if match:
                    current_msgstr.append(match.group(1))
            # Continuing multi-line quoted string
            elif line_str.startswith('"') and line_str.endswith('"'):
                match = re.match(r'^"(.*)"$', line_str)
                if match:
                    val = match.group(1)
                    if in_msgid:
                        current_msgid.append(val)
                    elif in_msgstr:
                        current_msgstr.append(val)

        # Save the final entry in the file
        save_entry()
        return result
