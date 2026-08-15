import unittest
from unittest.mock import patch
import sys
import tempfile
import json
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent / "src"))

import main

class TestCLI(unittest.TestCase):

    def setUp(self):
        # Locate the real fixtures
        self.fixtures_dir = str(Path(__file__).parent.parent / "fixtures")
        self.clean_fixtures = str(Path(self.fixtures_dir) / "clean")
        self.risky_fixtures = str(Path(self.fixtures_dir) / "risky")

    def test_cli_help(self):
        with self.assertRaises(SystemExit) as cm:
            main.main(["--help"])
        self.assertEqual(cm.exception.code, 0)

    def test_cli_clean_fixtures(self):
        # Running against clean fixtures should succeed and return exit code 0
        with self.assertRaises(SystemExit) as cm:
            main.main(["--fixture-dir", self.clean_fixtures])
        self.assertEqual(cm.exception.code, 0)

    def test_cli_risky_fixtures_no_gate(self):
        # Running against risky fixtures without --fail-on-risk should succeed with code 0
        with self.assertRaises(SystemExit) as cm:
            main.main(["--fixture-dir", self.risky_fixtures])
        self.assertEqual(cm.exception.code, 0)

    def test_cli_risky_fixtures_with_gate_fail(self):
        # Running against risky fixtures with --fail-on-risk should fail (exit code 1)
        # because risky has high and medium risks by default, and fail-severity defaults to medium
        with self.assertRaises(SystemExit) as cm:
            main.main(["--fixture-dir", self.risky_fixtures, "--fail-on-risk"])
        self.assertEqual(cm.exception.code, 1)

    def test_cli_risky_fixtures_with_gate_pass_severity_critical(self):
        # Running with --fail-severity critical should succeed (exit code 0)
        # because risky has high/medium/low risks but NO critical risks by default (since no disallowed elements are specified)
        with self.assertRaises(SystemExit) as cm:
            main.main([
                "--fixture-dir", self.risky_fixtures,
                "--fail-on-risk",
                "--fail-severity", "critical"
            ])
        self.assertEqual(cm.exception.code, 0)

    def test_cli_json_export(self):
        with tempfile.NamedTemporaryFile(suffix=".json", delete=False) as tmp:
            tmp_path = tmp.name

        try:
            with self.assertRaises(SystemExit) as cm:
                main.main([
                    "--fixture-dir", self.clean_fixtures,
                    "--format", "json",
                    "--output-file", tmp_path
                ])
            self.assertEqual(cm.exception.code, 0)

            # Read JSON back
            with open(tmp_path, "r", encoding="utf-8") as f:
                data = json.load(f)

            self.assertEqual(data["metadata"]["scope"], "single-site")
            self.assertEqual(len(data["inventory"]["plugins"]), 2)
        finally:
            Path(tmp_path).unlink()

    def test_cli_csv_export(self):
        with tempfile.NamedTemporaryFile(suffix=".csv", delete=False) as tmp:
            tmp_path = tmp.name

        try:
            with self.assertRaises(SystemExit) as cm:
                main.main([
                    "--fixture-dir", self.clean_fixtures,
                    "--format", "csv",
                    "--output-file", tmp_path
                ])
            self.assertEqual(cm.exception.code, 0)

            # Check file size/existence
            self.assertTrue(Path(tmp_path).exists())
            self.assertGreater(Path(tmp_path).stat().st_size, 100)
        finally:
            Path(tmp_path).unlink()


if __name__ == "__main__":
    unittest.main()
