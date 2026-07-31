import json
from typing import Dict, List, Optional, Any, Set

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
        # Check global ignore rules
        global_rules = self.data.get("ignore_rules", {}).get("global", {})
        global_ignored_ids = set(global_rules.get("ignored_ids", []))
        global_ignored_checks = set(global_rules.get("ignored_checks", []))

        if string_id in global_ignored_ids:
            return True
        if check_type and check_type in global_ignored_checks:
            return True

        # Check locale-specific rules
        if locale:
            locale_rules = self.data.get("ignore_rules", {}).get("locales", {}).get(locale, {})
            locale_ignored_ids = set(locale_rules.get("ignored_ids", []))
            locale_ignored_checks = set(locale_rules.get("ignored_checks", []))

            if string_id in locale_ignored_ids:
                return True
            if check_type and check_type in locale_ignored_checks:
                return True

        return False

    def get_placeholder_patterns(self) -> List[str]:
        return self.data.get("placeholder_patterns", [])

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
