import unittest
from pathlib import Path
import sys

sys.path.insert(0, str(Path(__file__).parent.parent / "src"))

from policy import (
    parse_version,
    is_version_less_than,
    PolicyEngine,
    DEFAULT_POLICY
)

class TestPolicy(unittest.TestCase):

    def test_parse_version(self):
        self.assertEqual(parse_version(""), (0,))
        self.assertEqual(parse_version(None), (0,))
        self.assertEqual(parse_version("6.5"), (6, 5))
        self.assertEqual(parse_version("6.5.2"), (6, 5, 2))
        self.assertEqual(parse_version("6.5.2-beta1"), (6, 5, 2, 1))
        self.assertEqual(parse_version("v2.10.45"), (2, 10, 45))

    def test_is_version_less_than(self):
        self.assertTrue(is_version_less_than("6.4.3", "6.5"))
        self.assertTrue(is_version_less_than("6.4.3", "6.4.4"))
        self.assertTrue(is_version_less_than("6.0", "6.5.2"))

        self.assertFalse(is_version_less_than("6.5", "6.5"))
        self.assertFalse(is_version_less_than("6.5.1", "6.5"))
        self.assertFalse(is_version_less_than("6.5.2", "6.4.9"))
        self.assertTrue(is_version_less_than("", "6.0"))

    def test_policy_engine_core_outdated(self):
        policy = {
            "min_core_version": "6.4.0"
        }
        engine = PolicyEngine(policy)

        # Test case where core is outdated
        inventory = {
            "core": {"version": "6.3.2", "updates": []},
            "plugins": [],
            "themes": [],
            "mu_plugins": []
        }
        findings = engine.evaluate(inventory)
        self.assertEqual(len(findings), 1)
        self.assertEqual(findings[0]["rule"], "core_outdated")
        self.assertEqual(findings[0]["severity"], "critical")

        # Test case where core is up to date
        inventory_clean = {
            "core": {"version": "6.4.0", "updates": []},
            "plugins": [],
            "themes": [],
            "mu_plugins": []
        }
        findings_clean = engine.evaluate(inventory_clean)
        self.assertEqual(len(findings_clean), 0)

    def test_policy_engine_disallowed_and_allowed_plugins(self):
        policy = {
            "disallowed_plugins": ["hello-dolly", "easy-wp-smtp"],
            "allowed_plugins": ["akismet", "wp-seo"]
        }
        engine = PolicyEngine(policy)

        # 1. Test disallowed plugin
        inventory = {
            "core": {"version": "6.5.0"},
            "plugins": [
                {"name": "hello-dolly", "version": "1.7.2", "status": "active"}
            ],
            "themes": [],
            "mu_plugins": []
        }
        findings = engine.evaluate(inventory)
        # Should flag disallowed, and also "not_allowed" since it's not in the allowed list!
        rules = [f["rule"] for f in findings]
        self.assertIn("disallowed", rules)
        self.assertIn("not_allowed", rules)

        # 2. Test allowed plugin
        inventory_allowed = {
            "core": {"version": "6.5.0"},
            "plugins": [
                {"name": "akismet", "version": "5.3", "status": "active"}
            ],
            "themes": [],
            "mu_plugins": []
        }
        findings_allowed = engine.evaluate(inventory_allowed)
        self.assertEqual(len(findings_allowed), 0)

    def test_policy_engine_inactive_and_unknown_version(self):
        engine = PolicyEngine() # Default policy (flag_inactive=True, flag_unknown_version=True)

        inventory = {
            "core": {"version": "6.5.0"},
            "plugins": [
                {"name": "custom-plugin", "version": "", "status": "inactive"}
            ],
            "themes": [
                {"name": "twentytwentythree", "version": "1.0", "status": "inactive"}
            ],
            "mu_plugins": [
                {"name": "index.php", "version": ""}
            ]
        }
        findings = engine.evaluate(inventory)
        rules = [(f["type"], f["rule"]) for f in findings]

        # Plugin should flag "unknown_version" and "inactive"
        self.assertIn(("plugin", "unknown_version"), rules)
        self.assertIn(("plugin", "inactive"), rules)

        # Theme should flag "inactive"
        self.assertIn(("theme", "inactive"), rules)

        # MU plugin should flag "unknown_version"
        self.assertIn(("mu-plugin", "unknown_version"), rules)

    def test_policy_engine_updates_available(self):
        engine = PolicyEngine()

        inventory = {
            "core": {"version": "6.4.0"},
            "plugins": [
                {"name": "akismet", "version": "5.0", "status": "active", "update": "available", "update_version": "5.3"}
            ],
            "themes": [],
            "mu_plugins": []
        }
        findings = engine.evaluate(inventory)
        self.assertEqual(len(findings), 1)
        self.assertEqual(findings[0]["rule"], "update_available")
        self.assertEqual(findings[0]["severity"], "high")


if __name__ == "__main__":
    unittest.main()
