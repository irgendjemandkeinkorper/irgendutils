import unittest
import io
import json
import tempfile
import csv
from pathlib import Path
import sys

sys.path.insert(0, str(Path(__file__).parent.parent / "src"))

from reporter import (
    build_unified_report,
    format_terminal_summary,
    generate_json,
    generate_csv_stream
)

class TestReporter(unittest.TestCase):

    def setUp(self):
        self.inventory = {
            "core": {
                "version": "6.5.2",
                "updates": []
            },
            "plugins": [
                {"name": "akismet", "version": "5.3", "status": "active", "auto_update": "on", "update": "none"},
                {"name": "hello-dolly", "version": "1.7.2", "status": "inactive", "auto_update": "off", "update": "available", "update_version": "1.8"}
            ],
            "themes": [
                {"name": "twentytwentyfour", "version": "1.1", "status": "active", "auto_update": "on", "update": "none"}
            ],
            "mu_plugins": [
                {"name": "disallow-indexing", "version": "1.0.0"}
            ]
        }
        self.findings = [
            {
                "type": "plugin",
                "name": "hello-dolly",
                "rule": "inactive",
                "severity": "medium",
                "message": "Plugin 'hello-dolly' is inactive."
            },
            {
                "type": "plugin",
                "name": "hello-dolly",
                "rule": "update_available",
                "severity": "high",
                "message": "Plugin 'hello-dolly' has an update available."
            }
        ]

    def test_build_unified_report(self):
        report = build_unified_report(self.inventory, self.findings, is_multisite_scope=False)

        # Verify metadata counts
        meta = report["metadata"]
        self.assertEqual(meta["scope"], "single-site")
        self.assertEqual(meta["counts"]["plugins"]["total"], 2)
        self.assertEqual(meta["counts"]["plugins"]["active"], 1)
        self.assertEqual(meta["counts"]["plugins"]["inactive"], 1)
        self.assertEqual(meta["counts"]["themes"]["total"], 1)
        self.assertEqual(meta["counts"]["themes"]["active"], 1)
        self.assertEqual(meta["counts"]["findings"]["total"], 2)
        self.assertEqual(meta["counts"]["findings"]["by_severity"]["high"], 1)
        self.assertEqual(meta["counts"]["findings"]["by_severity"]["medium"], 1)

    def test_format_terminal_summary(self):
        report = build_unified_report(self.inventory, self.findings, is_multisite_scope=True)

        stream = io.StringIO()
        format_terminal_summary(report, stream)
        output = stream.getvalue()

        # Verify critical elements in visual output
        self.assertIn("WORDPRESS EXTENSION & RISK REPORT", output)
        self.assertIn("Scope:          MULTISITE", output)
        self.assertIn("akismet", output)
        self.assertIn("hello-dolly", output)
        self.assertIn("twentytwentyfour", output)
        self.assertIn("disallow-indexing", output)
        self.assertIn("[HIGH] hello-dolly", output)
        self.assertIn("Total Risks:    2", output)

    def test_generate_json(self):
        report = build_unified_report(self.inventory, self.findings, is_multisite_scope=False)
        json_str = generate_json(report)

        # Parse it back to assert
        parsed = json.loads(json_str)
        self.assertEqual(parsed["metadata"]["scope"], "single-site")
        self.assertEqual(len(parsed["findings"]), 2)

    def test_generate_csv(self):
        report = build_unified_report(self.inventory, self.findings, is_multisite_scope=False)

        with tempfile.NamedTemporaryFile(mode="w+", delete=False, suffix=".csv") as tmp:
            tmp_name = tmp.name

        try:
            with open(tmp_name, "w", newline="", encoding="utf-8") as f:
                generate_csv_stream(report, f)

            # Read CSV back and check headers/rows
            rows = []
            with open(tmp_name, "r", newline="", encoding="utf-8") as f:
                reader = csv.reader(f)
                rows = list(reader)

            self.assertEqual(len(rows), 6) # Header + 1 Core + 2 Plugins + 1 Theme + 1 MU

            headers = rows[0]
            self.assertEqual(headers[0], "Type")
            self.assertEqual(headers[1], "Name")
            self.assertEqual(headers[2], "Installed Version")
            self.assertEqual(headers[6], "Risk Findings")
            self.assertEqual(headers[7], "Highest Severity")

            # Verify WordPress Core row
            core_row = rows[1]
            self.assertEqual(core_row[0], "core")
            self.assertEqual(core_row[1], "WordPress Core")
            self.assertEqual(core_row[2], "6.5.2")

            # Verify hello-dolly row
            dolly_row = [r for r in rows if r[1] == "hello-dolly"][0]
            self.assertEqual(dolly_row[0], "plugin")
            self.assertEqual(dolly_row[3], "inactive")
            self.assertEqual(dolly_row[7], "HIGH") # Highest of inactive(medium) vs update_available(high)
        finally:
            Path(tmp_name).unlink()


if __name__ == "__main__":
    unittest.main()
