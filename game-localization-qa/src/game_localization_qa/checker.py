import re
from typing import Dict, List, Set, Tuple, Optional, Any
from .config import QAConfig

class QAIssue:
    """Represents a localized QA finding/issue."""
    def __init__(self, string_id: str, check_type: str, message: str, canonical_val: Optional[str] = None, locale_val: Optional[str] = None):
        self.string_id = string_id
        self.check_type = check_type
        self.message = message
        self.canonical_val = canonical_val
        self.locale_val = locale_val

    def to_dict(self) -> Dict[str, Any]:
        return {
            "id": self.string_id,
            "check_type": self.check_type,
            "message": self.message,
            "canonical": self.canonical_val,
            "translation": self.locale_val
        }

class LocalizationChecker:
    """Core translation validation and QA checker engine."""
    def __init__(self, config: Optional[QAConfig] = None):
        self.config = config or QAConfig()

    def _extract_placeholders(self, text: str) -> List[str]:
        placeholders = []
        for pattern in self.config.get_placeholder_patterns():
            matches = re.findall(pattern, text)
            placeholders.extend(matches)
        return sorted(placeholders)

    def _extract_tags(self, text: str) -> List[str]:
        # Simple HTML/XML tag finder
        # Captures open and close tag names, like 'b' from <b> or '</b>'
        tags = re.findall(r'</?([a-zA-Z0-9_\-]+)(?:\s+[^>]*?)?>', text)
        return tags

    def _is_tag_imbalanced(self, text: str) -> bool:
        # Check standard matching tags
        # We can use a stack to verify balanced tags (e.g. <b>...</b>)
        # We find all complete tags in the string in order of appearance
        # For simplicity, we ignore self-closing tags like <br/> or <img/>
        tag_tokens = re.findall(r'<(/?)([a-zA-Z0-9_\-]+)(?:\s+[^>]*?)?(/?)>', text)
        stack = []
        for close_slash, tag_name, self_close_slash in tag_tokens:
            if self_close_slash == '/': # self-closing tag
                continue
            if close_slash == '/': # closing tag
                if not stack or stack[-1] != tag_name:
                    return True # Unbalanced closing tag
                stack.pop()
            else: # opening tag
                stack.append(tag_name)
        return len(stack) > 0 # Leftover open tags

    def check(self, canonical: Dict[str, str], locale: Dict[str, str], locale_name: str) -> List[QAIssue]:
        issues: List[QAIssue] = []

        canonical_ids = set(canonical.keys())
        locale_ids = set(locale.keys())

        # 1. Check Missing and Extra Keys
        missing_keys = canonical_ids - locale_ids
        extra_keys = locale_ids - canonical_ids

        for k in sorted(missing_keys):
            if not self.config.is_ignored(k, locale_name, "missing_key"):
                issues.append(QAIssue(
                    string_id=k,
                    check_type="missing_key",
                    message="String ID is present in canonical but missing in locale catalog.",
                    canonical_val=canonical[k]
                ))

        for k in sorted(extra_keys):
            if not self.config.is_ignored(k, locale_name, "extra_key"):
                issues.append(QAIssue(
                    string_id=k,
                    check_type="extra_key",
                    message="String ID is present in locale but missing in canonical catalog.",
                    locale_val=locale[k]
                ))

        # Check for duplicate IDs: since we parsed into Dict, native Python dict resolves keys uniquely.
        # But wait! If the user inputs files that have duplicates, the CLI/adapters can track duplicates.
        # Let's support checking matching keys for translation defects
        common_keys = canonical_ids & locale_ids

        for k in sorted(common_keys):
            canon_val = canonical[k]
            loc_val = locale[k]

            # --- Check: Placeholder/Token Drift ---
            if not self.config.is_ignored(k, locale_name, "placeholder_drift"):
                canon_placeholders = self._extract_placeholders(canon_val)
                loc_placeholders = self._extract_placeholders(loc_val)
                if canon_placeholders != loc_placeholders:
                    issues.append(QAIssue(
                        string_id=k,
                        check_type="placeholder_drift",
                        message=f"Placeholder tokens do not match. Canonical: {canon_placeholders}, Locale: {loc_placeholders}",
                        canonical_val=canon_val,
                        locale_val=loc_val
                    ))

            # --- Check: Tag Imbalance / Mismatch ---
            if not self.config.is_ignored(k, locale_name, "tag_imbalance"):
                # Detect imbalances inside the locale string itself
                if self._is_tag_imbalanced(loc_val):
                    issues.append(QAIssue(
                        string_id=k,
                        check_type="tag_imbalance",
                        message="Locale string has imbalanced or malformed markup tags.",
                        canonical_val=canon_val,
                        locale_val=loc_val
                    ))
                else:
                    # Detect tag drift between canonical and locale
                    canon_tags = sorted(self._extract_tags(canon_val))
                    loc_tags = sorted(self._extract_tags(loc_val))
                    if canon_tags != loc_tags:
                        issues.append(QAIssue(
                            string_id=k,
                            check_type="tag_imbalance",
                            message=f"Markup tag list does not match canonical. Canonical: {canon_tags}, Locale: {loc_tags}",
                            canonical_val=canon_val,
                            locale_val=loc_val
                        ))

            # --- Check: Line-break Constraints ---
            if not self.config.is_ignored(k, locale_name, "line_break_drift"):
                # We check two things: literal '\\n' sequences and raw '\n' newlines
                canon_literal_newlines = canon_val.count("\\n")
                loc_literal_newlines = loc_val.count("\\n")
                canon_raw_newlines = canon_val.count("\n")
                loc_raw_newlines = loc_val.count("\n")

                if (canon_literal_newlines != loc_literal_newlines) or (canon_raw_newlines != loc_raw_newlines):
                    issues.append(QAIssue(
                        string_id=k,
                        check_type="line_break_drift",
                        message=f"Line break count/type mismatch. Canonical: ({canon_literal_newlines} literal, {canon_raw_newlines} raw), Locale: ({loc_literal_newlines} literal, {loc_raw_newlines} raw)",
                        canonical_val=canon_val,
                        locale_val=loc_val
                    ))

            # --- Check: Untranslated String ---
            if not self.config.is_ignored(k, locale_name, "untranslated"):
                min_len = self.config.get_min_untranslated_length()
                # Skip if empty or digit-only or shorter than min length
                is_digit = loc_val.strip().isdigit()
                if loc_val == canon_val and len(loc_val.strip()) >= min_len and not is_digit:
                    issues.append(QAIssue(
                        string_id=k,
                        check_type="untranslated",
                        message="String is untranslated (matches canonical string exactly).",
                        canonical_val=canon_val,
                        locale_val=loc_val
                    ))

            # --- Check: Text Expansion ---
            if not self.config.is_ignored(k, locale_name, "text_expansion"):
                canon_len = len(canon_val)
                loc_len = len(loc_val)
                if canon_len > 0:
                    multiplier = self.config.get_expansion_multiplier(canon_len)
                    max_allowed = int(canon_len * multiplier)
                    if loc_len > max_allowed:
                        issues.append(QAIssue(
                            string_id=k,
                            check_type="text_expansion",
                            message=f"Locale string exceeds expansion limits. Length: {loc_len}, Allowed: {max_allowed} (multiplier {multiplier}x for canon length {canon_len})",
                            canonical_val=canon_val,
                            locale_val=loc_val
                        ))

        return issues
