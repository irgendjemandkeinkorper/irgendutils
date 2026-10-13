import json
import re
from typing import Dict, List, Optional, Any, Set, Tuple

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
        # Pre-cache compiled patterns and normalized lookup sets for fast checking
        self._cache_config()

    def _deep_update(self, base: Dict[str, Any], update: Dict[str, Any]) -> None:
        for k, v in update.items():
            if isinstance(v, dict) and k in base and isinstance(base[k], dict):
                self._deep_update(base[k], v)
            else:
                base[k] = v

    def _cache_config(self) -> None:
        """Cache pre-compiled regexes, sets, and thresholds to eliminate hot-loop overhead."""
        global_rules = self.data.get("ignore_rules", {}).get("global", {})
        self._global_ignored_ids: Set[str] = set(global_rules.get("ignored_ids", []))
        self._global_ignored_checks: Set[str] = set(global_rules.get("ignored_checks", []))

        self._locale_ignored_ids: Dict[str, Set[str]] = {}
        self._locale_ignored_checks: Dict[str, Set[str]] = {}
        for loc, rules in self.data.get("ignore_rules", {}).get("locales", {}).items():
            self._locale_ignored_ids[loc] = set(rules.get("ignored_ids", []))
            self._locale_ignored_checks[loc] = set(rules.get("ignored_checks", []))

        self._compiled_placeholder_patterns: List[re.Pattern] = [
            re.compile(pat) for pat in self.data.get("placeholder_patterns", [])
        ]
        self._min_untranslated_length: int = self.data.get("min_untranslated_length", 5)

        thresholds = self.data.get("expansion_thresholds", {})
        short = thresholds.get("short", {})
        medium = thresholds.get("medium", {})
        long_thresh = thresholds.get("long", {})

        self._short_max: int = short.get("max_length") or 15
        self._medium_max: int = medium.get("max_length") or 50
        self._short_mult: float = short.get("multiplier", 2.5)
        self._medium_mult: float = medium.get("multiplier", 1.8)
        self._long_mult: float = long_thresh.get("multiplier", 1.4)

    @classmethod
    def load_from_file(cls, filepath: str) -> "QAConfig":
        try:
            with open(filepath, "r", encoding="utf-8") as f:
                data = json.load(f)
                return cls(data)
        except (FileNotFoundError, json.JSONDecodeError):
            return cls()

    def get_active_ignores(self, locale: Optional[str] = None) -> Tuple[Set[str], Set[str]]:
        """Return combined (ignored_ids, ignored_checks) sets for global + locale once per run."""
        ignored_ids = set(self._global_ignored_ids)
        ignored_checks = set(self._global_ignored_checks)
        if locale:
            ignored_ids.update(self._locale_ignored_ids.get(locale, ()))
            ignored_checks.update(self._locale_ignored_checks.get(locale, ()))
        return ignored_ids, ignored_checks

    def is_ignored(self, string_id: str, locale: Optional[str] = None, check_type: Optional[str] = None) -> bool:
        """Fast lookup using pre-computed sets to avoid set allocations in hot loops."""
        if string_id in self._global_ignored_ids:
            return True
        if check_type and check_type in self._global_ignored_checks:
            return True

        if locale:
            if string_id in self._locale_ignored_ids.get(locale, ()):
                return True
            if check_type and check_type in self._locale_ignored_checks.get(locale, ()):
                return True

        return False

    def get_placeholder_patterns(self) -> List[str]:
        return self.data.get("placeholder_patterns", [])

    def get_compiled_placeholder_patterns(self) -> List[re.Pattern]:
        """Return pre-compiled regex objects for placeholder extraction."""
        return self._compiled_placeholder_patterns

    def get_min_untranslated_length(self) -> int:
        return self._min_untranslated_length

    def get_expansion_multiplier(self, canonical_len: int) -> float:
        """Fast O(1) conditional check using cached threshold bounds."""
        if canonical_len <= self._short_max:
            return self._short_mult
        elif canonical_len <= self._medium_max:
            return self._medium_mult
        return self._long_mult
