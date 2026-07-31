import unittest
import os
import sys
import tempfile
import subprocess
import json
import csv

class TestCLIIntegration(unittest.TestCase):
    def setUp(self):
        # We find the paths to fixtures
        self.fixtures_dir = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "fixtures"))
        self.canonical_json = os.path.join(self.fixtures_dir, "canonical.json")
        self.locale_fr_json = os.path.join(self.fixtures_dir, "locale_fr.json")
        self.config_json = os.path.join(self.fixtures_dir, "config.json")

        # Add src to pythonpath
        self.src_dir = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "src"))
        self.env = os.environ.copy()
        self.env["PYTHONPATH"] = self.src_dir

    def run_cli(self, args):
        cmd = [sys.executable, "-m", "game_localization_qa.cli"] + args
        res = subprocess.run(cmd, capture_output=True, text=True, env=self.env)
        return res

    def test_cli_help(self):
        res = self.run_cli(["--help"])
        self.assertEqual(res.returncode, 0)
        self.assertIn("Python QA toolkit for narrative game localization", res.stdout)

    def test_cli_invalid_args(self):
        res = self.run_cli([])
        self.assertEqual(res.returncode, 2) # argparse returns 2 on error

    def test_cli_unsupported_format(self):
        res = self.run_cli(["--canonical", "invalid.txt", "--locale", "invalid.txt", "--locale-name", "fr"])
        self.assertEqual(res.returncode, 1)
        self.assertIn("Unsupported file format", res.stderr)

    def test_cli_integration_with_issues(self):
        # Using real fixtures
        # Canonical vs locale_fr has missing_key (TXT_MENU_OPTIONS is missing in French)
        # It also has other issues. It should exit with 2.
        res = self.run_cli([
            "--canonical", self.canonical_json,
            "--locale", self.locale_fr_json,
            "--locale-name", "fr"
        ])
        self.assertEqual(res.returncode, 2)
        self.assertIn("TXT_MENU_OPTIONS", res.stdout)

    def test_cli_reports_generation(self):
        with tempfile.TemporaryDirectory() as tmpdir:
            json_report = os.path.join(tmpdir, "report.json")
            csv_report = os.path.join(tmpdir, "report.csv")

            res = self.run_cli([
                "--canonical", self.canonical_json,
                "--locale", self.locale_fr_json,
                "--locale-name", "fr",
                "--config", self.config_json,
                "--json-report", json_report,
                "--csv-report", csv_report
            ])

            # Check files exist
            self.assertTrue(os.path.exists(json_report))
            self.assertTrue(os.path.exists(csv_report))

            # Verify JSON content
            with open(json_report, "r", encoding="utf-8") as f:
                data = json.load(f)
                self.assertIn("summary", data)
                self.assertIn("issues", data)
                self.assertIn("duplicate_ids", data)

            # Verify CSV content
            with open(csv_report, "r", encoding="utf-8") as f:
                reader = csv.reader(f)
                headers = next(reader)
                self.assertEqual(headers, ["String ID", "Issue Type", "Message", "Canonical", "Translation"])

if __name__ == "__main__":
    unittest.main()
