import re
from typing import Dict, Any, List, Optional

DEFAULT_POLICY = {
    "flag_inactive": True,
    "flag_unknown_version": True,
    "flag_update_available": True,
    "min_core_version": None,
    "allowed_plugins": [],
    "disallowed_plugins": [],
    "allowed_themes": [],
    "disallowed_themes": [],
    "severity_rules": {
        "inactive": "medium",
        "unknown_version": "medium",
        "update_available": "high",
        "disallowed": "critical",
        "core_outdated": "critical",
        "not_allowed": "high"
    }
}

def parse_version(v_str: Optional[str]) -> tuple:
    """
    Parse a version string into a comparable tuple of integers.
    E.g., "6.5.2-beta" -> (6, 5, 2)
    """
    if not v_str:
        return (0,)
    parts = []
    # Extract consecutive digit matches
    for part in re.findall(r'\d+', str(v_str)):
        try:
            parts.append(int(part))
        except ValueError:
            parts.append(0)
    return tuple(parts) if parts else (0,)

def is_version_less_than(v1: Optional[str], v2: Optional[str]) -> bool:
    """
    Return True if version v1 is strictly less than version v2.
    """
    t1 = parse_version(v1)
    t2 = parse_version(v2)
    max_len = max(len(t1), len(t2))
    # Pad shorter tuple with zeros
    t1_padded = t1 + (0,) * (max_len - len(t1))
    t2_padded = t2 + (0,) * (max_len - len(t2))
    return t1_padded < t2_padded


class PolicyEngine:
    """Engine that checks inventory items against a risk/safety policy."""
    def __init__(self, policy_dict: Optional[Dict[str, Any]] = None):
        self.policy = dict(DEFAULT_POLICY)
        if policy_dict:
            # Deep merge / override policy config
            for k, v in policy_dict.items():
                if k == "severity_rules" and isinstance(v, dict):
                    self.policy["severity_rules"] = {
                        **self.policy["severity_rules"],
                        **v
                    }
                else:
                    self.policy[k] = v

    def get_severity(self, rule_name: str) -> str:
        """Get severity of a rule from the rules dictionary, fallback to 'medium'."""
        rules = self.policy.get("severity_rules", {})
        return rules.get(rule_name, "medium")

    def evaluate(self, inventory: Dict[str, Any]) -> List[Dict[str, Any]]:
        """
        Evaluate full inventory and return list of risk findings.
        """
        findings = []

        # 1. Core Evaluation
        core = inventory.get("core", {})
        core_version = core.get("version")

        # Core outdated check
        min_core = self.policy.get("min_core_version")
        if min_core and core_version:
            if is_version_less_than(core_version, min_core):
                findings.append({
                    "type": "core",
                    "name": "WordPress Core",
                    "rule": "core_outdated",
                    "severity": self.get_severity("core_outdated"),
                    "message": f"WordPress Core version ({core_version}) is below the required minimum version ({min_core})."
                })

        # Core updates available check
        core_updates = core.get("updates", [])
        if self.policy.get("flag_update_available") and core_updates:
            # Check if there's a newer version recommended
            # Usually wp core check-update outputs a list of updates
            latest_update = core_updates[0].get("version") if isinstance(core_updates, list) and core_updates else None
            if latest_update and is_version_less_than(core_version, latest_update):
                findings.append({
                    "type": "core",
                    "name": "WordPress Core",
                    "rule": "update_available",
                    "severity": self.get_severity("update_available"),
                    "message": f"WordPress Core update available: {latest_update} (Current: {core_version})."
                })

        # 2. Plugins Evaluation
        plugins = inventory.get("plugins", [])
        allowed_plugins = self.policy.get("allowed_plugins", [])
        disallowed_plugins = self.policy.get("disallowed_plugins", [])

        for plugin in plugins:
            name = plugin.get("name")
            version = plugin.get("version")
            status = plugin.get("status")
            update = plugin.get("update")

            # Unknown version check
            if self.policy.get("flag_unknown_version") and not version:
                findings.append({
                    "type": "plugin",
                    "name": name,
                    "rule": "unknown_version",
                    "severity": self.get_severity("unknown_version"),
                    "message": f"Plugin '{name}' has an unknown or missing version."
                })

            # Disallowed plugins list check
            if name in disallowed_plugins:
                findings.append({
                    "type": "plugin",
                    "name": name,
                    "rule": "disallowed",
                    "severity": self.get_severity("disallowed"),
                    "message": f"Plugin '{name}' is explicitly disallowed by policy."
                })

            # Allowed plugins list check (enforce only if allowed_plugins is specified/non-empty)
            if allowed_plugins and name not in allowed_plugins:
                findings.append({
                    "type": "plugin",
                    "name": name,
                    "rule": "not_allowed",
                    "severity": self.get_severity("not_allowed"),
                    "message": f"Plugin '{name}' is not in the allowed plugins list."
                })

            # Inactive plugin check
            if self.policy.get("flag_inactive") and status == "inactive":
                findings.append({
                    "type": "plugin",
                    "name": name,
                    "rule": "inactive",
                    "severity": self.get_severity("inactive"),
                    "message": f"Plugin '{name}' is inactive (unused extensions pose security risk)."
                })

            # Update available check
            if self.policy.get("flag_update_available") and update == "available":
                up_ver = plugin.get("update_version", "newer version")
                findings.append({
                    "type": "plugin",
                    "name": name,
                    "rule": "update_available",
                    "severity": self.get_severity("update_available"),
                    "message": f"Plugin '{name}' has an update available to version {up_ver} (Installed: {version})."
                })

        # 3. Themes Evaluation
        themes = inventory.get("themes", [])
        allowed_themes = self.policy.get("allowed_themes", [])
        disallowed_themes = self.policy.get("disallowed_themes", [])

        for theme in themes:
            name = theme.get("name")
            version = theme.get("version")
            status = theme.get("status")
            update = theme.get("update")

            # Unknown version check
            if self.policy.get("flag_unknown_version") and not version:
                findings.append({
                    "type": "theme",
                    "name": name,
                    "rule": "unknown_version",
                    "severity": self.get_severity("unknown_version"),
                    "message": f"Theme '{name}' has an unknown or missing version."
                })

            # Disallowed themes list check
            if name in disallowed_themes:
                findings.append({
                    "type": "theme",
                    "name": name,
                    "rule": "disallowed",
                    "severity": self.get_severity("disallowed"),
                    "message": f"Theme '{name}' is explicitly disallowed by policy."
                })

            # Allowed themes list check (enforce only if allowed_themes is specified/non-empty)
            if allowed_themes and name not in allowed_themes:
                findings.append({
                    "type": "theme",
                    "name": name,
                    "rule": "not_allowed",
                    "severity": self.get_severity("not_allowed"),
                    "message": f"Theme '{name}' is not in the allowed themes list."
                })

            # Inactive theme check
            if self.policy.get("flag_inactive") and status == "inactive":
                findings.append({
                    "type": "theme",
                    "name": name,
                    "rule": "inactive",
                    "severity": self.get_severity("inactive"),
                    "message": f"Theme '{name}' is inactive (unused extensions pose security risk)."
                })

            # Update available check
            if self.policy.get("flag_update_available") and update == "available":
                up_ver = theme.get("update_version", "newer version")
                findings.append({
                    "type": "theme",
                    "name": name,
                    "rule": "update_available",
                    "severity": self.get_severity("update_available"),
                    "message": f"Theme '{name}' has an update available to version {up_ver} (Installed: {version})."
                })

        # 4. Must-Use Plugins Evaluation
        mu_plugins = inventory.get("mu_plugins", [])
        for mu in mu_plugins:
            name = mu.get("name")
            version = mu.get("version")

            # Unknown version check for MU plugins
            if self.policy.get("flag_unknown_version") and not version:
                findings.append({
                    "type": "mu-plugin",
                    "name": name,
                    "rule": "unknown_version",
                    "severity": self.get_severity("unknown_version"),
                    "message": f"Must-use plugin '{name}' has an unknown or missing version."
                })

            # Disallowed check for MU plugins
            if name in disallowed_plugins:
                findings.append({
                    "type": "mu-plugin",
                    "name": name,
                    "rule": "disallowed",
                    "severity": self.get_severity("disallowed"),
                    "message": f"Must-use plugin '{name}' is explicitly disallowed by policy."
                })

            # Allowed check for MU plugins
            if allowed_plugins and name not in allowed_plugins:
                findings.append({
                    "type": "mu-plugin",
                    "name": name,
                    "rule": "not_allowed",
                    "severity": self.get_severity("not_allowed"),
                    "message": f"Must-use plugin '{name}' is not in the allowed plugins list."
                })

        return findings
