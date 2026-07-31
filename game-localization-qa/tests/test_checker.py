import unittest
from game_localization_qa.config import QAConfig
from game_localization_qa.checker import LocalizationChecker, QAIssue

class TestChecker(unittest.TestCase):
    def test_missing_and_extra_keys(self):
        checker = LocalizationChecker()
        canonical = {"K1": "V1", "K2": "V2"}
        locale = {"K1": "V1", "K3": "V3"}

        issues = checker.check(canonical, locale, "test_locale")
        issue_types = [i.check_type for i in issues]

        self.assertIn("missing_key", issue_types)
        self.assertIn("extra_key", issue_types)

        missing = [i for i in issues if i.check_type == "missing_key"][0]
        extra = [i for i in issues if i.check_type == "extra_key"][0]

        self.assertEqual(missing.string_id, "K2")
        self.assertEqual(extra.string_id, "K3")

    def test_placeholder_drift(self):
        checker = LocalizationChecker()
        canonical = {"K1": "Welcome to {world_name}!"}
        locale = {"K1": "Bienvenido a {world}!"}

        issues = checker.check(canonical, locale, "es")
        self.assertEqual(len(issues), 1)
        self.assertEqual(issues[0].check_type, "placeholder_drift")

    def test_tag_imbalance(self):
        checker = LocalizationChecker()
        canonical = {"K1": "<b>Bold text</b>"}
        # Mismatched closing tag
        locale1 = {"K1": "<b>Bold text</i>"}
        # Unclosed tag
        locale2 = {"K1": "<b>Bold text"}

        issues1 = checker.check(canonical, locale1, "test")
        self.assertEqual(len(issues1), 1)
        self.assertEqual(issues1[0].check_type, "tag_imbalance")

        issues2 = checker.check(canonical, locale2, "test")
        self.assertEqual(len(issues2), 1)
        self.assertEqual(issues2[0].check_type, "tag_imbalance")

    def test_line_break_drift(self):
        checker = LocalizationChecker()
        canonical = {"K1": "Line 1\nLine 2"}
        # Missing newline
        locale = {"K1": "Line 1 Line 2"}

        issues = checker.check(canonical, locale, "test")
        self.assertEqual(len(issues), 1)
        self.assertEqual(issues[0].check_type, "line_break_drift")

    def test_untranslated(self):
        checker = LocalizationChecker()
        canonical = {"K1": "Long enough string"}
        locale = {"K1": "Long enough string"}

        issues = checker.check(canonical, locale, "test")
        self.assertEqual(len(issues), 1)
        self.assertEqual(issues[0].check_type, "untranslated")

    def test_text_expansion(self):
        # Short strings: multiplier is 2.5x by default
        # "Hello" (length 5) -> max length allowed: 12
        # "This is a very long translation" (length 31) -> exceeds limit
        checker = LocalizationChecker()
        canonical = {"K1": "Hello"}
        locale = {"K1": "This is a very long translation"}

        issues = checker.check(canonical, locale, "test")
        self.assertEqual(len(issues), 1)
        self.assertEqual(issues[0].check_type, "text_expansion")

if __name__ == "__main__":
    unittest.main()
