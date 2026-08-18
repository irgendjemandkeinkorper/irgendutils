import json
import re
from typing import Dict, List, Optional, Any, Set, Pattern

DEFAULT_CONFIG = {
    "ignore_rules": {
        "global": {
            "ignored_ids": [],
            "ignored_checks": []
        },
        "locales": {}
    },
    "expansion_thresholds": {
        "short": {
            "max_length": 15,
            "multiplier": 2.5
        },
        "medium": {
            "max_length": 50,
            "multiplier": 1.8
        },
        "long": {
            "max_length": None,
            "multiplier": 1.4
        }
    },
    "placeholder_patterns": [
        r"\{[a-zA-Z_0-9]+\}",
        r"%[dsf]"
    ],
    "min_untranslated_length": 5
}

class QAConfig:
    def __init__(self, config_data: Optional[Dict[str, Any]] = None):
        self.data = DEFAULT_CONFIG.copy()
        if config_data:
            self._deep_update(self.data, config_data)
        self._rebuild_cache()

    def _rebuild_cache(self) -> None:
        """Pre-computes sets and pre-compiles regexes for hot loop lookups."""
        global_rules = self.data.get("ignore_rules", {}).get("global", {})
        self._global_ignored_ids: Set[str] = set(global_rules.get("ignored_ids", []))
        self._global_ignored_checks: Set[str] = set(global_rules.get("ignored_checks", []))

        self._locale_ignored_ids: Dict[str, Set[str]] = {}
        self._locale_ignored_checks: Dict[str, Set[str]] = {}
        for loc, rules in self.data.get("ignore_rules", {}).get("locales", {}).items():
            self._locale_ignored_ids[loc] = set(rules.get("ignored_ids", []))
            self._locale_ignored_checks[loc] = set(rules.get("ignored_checks", []))

        raw_patterns = self.data.get("placeholder_patterns", [])
        self._compiled_placeholder_patterns: List[Pattern[str]] = [
            re.compile(p) for p in raw_patterns
        ]

    def _deep_update(self, base: Dict[str, Any], update: Dict[str, Any]) -> None:
        for k, v in update.items():
            if isinstance(v, dict) and k in base and isinstance(base[k], dict):
                self._deep_update(base[k], v)
            else:
                base[k] = v

    @classmethod
    def load_from_file(cls, filepath: str) -> "QAConfig":
        try:
            with open(filepath, "r", encoding="utf-8") as f:
                data = json.load(f)
                return cls(data)
        except (FileNotFoundError, json.JSONDecodeError):
            return cls()

    def is_ignored(self, string_id: str, locale: Optional[str] = None, check_type: Optional[str] = None) -> bool:
        # Check global ignore rules (O(1) set lookups)
        if string_id in self._global_ignored_ids:
            return True
        if check_type and check_type in self._global_ignored_checks:
            return True

        # Check locale-specific rules (O(1) set lookups)
        if locale:
            if string_id in self._locale_ignored_ids.get(locale, set()):
                return True
            if check_type and check_type in self._locale_ignored_checks.get(locale, set()):
                return True

        return False

    def get_placeholder_patterns(self) -> List[str]:
        return self.data.get("placeholder_patterns", [])

    def get_compiled_placeholder_patterns(self) -> List[Pattern[str]]:
        return self._compiled_placeholder_patterns

    def get_min_untranslated_length(self) -> int:
        return self.data.get("min_untranslated_length", 5)

    def get_expansion_multiplier(self, canonical_len: int) -> float:
        thresholds = self.data.get("expansion_thresholds", {})

        # Sort keys to evaluate systematically
        short = thresholds.get("short", {})
        medium = thresholds.get("medium", {})
        long_thresh = thresholds.get("long", {})

        short_max = short.get("max_length") or 15
        medium_max = medium.get("max_length") or 50

        if canonical_len <= short_max:
            return short.get("multiplier", 2.5)
        elif canonical_len <= medium_max:
            return medium.get("multiplier", 1.8)
        else:
            return long_thresh.get("multiplier", 1.4)
