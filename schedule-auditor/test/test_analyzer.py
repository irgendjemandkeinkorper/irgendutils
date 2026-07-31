import os
import sys
import unittest
import tempfile
import stat

# Ensure src/ is in path
sys.path.insert(0, os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "src"))

from analyzer import Analyzer

class TestAnalyzer(unittest.TestCase):
    def test_mask_credentials(self):
        analyzer = Analyzer()

        # Test command line option masking
        item = {
            "command_or_unit": "/usr/local/bin/backup.sh --password=secret_val --token 12345 --safe-option=yes",
            "env_vars": {
                "SECRET_KEY": "my_hidden_key",
                "SAFE_VAR": "public_data"
            }
        }

        masked = analyzer.mask_credentials(item)
        self.assertIn("--password=[REDACTED]", masked["command_or_unit"])
        self.assertIn("--token [REDACTED]", masked["command_or_unit"])
        self.assertIn("--safe-option=yes", masked["command_or_unit"])
        self.assertEqual(masked["env_vars"]["SECRET_KEY"], "[REDACTED]")
        self.assertEqual(masked["env_vars"]["SAFE_VAR"], "public_data")

    def test_analyzer_checks(self):
        # Create a temporary directory structure to simulate a filesystem for permission/existence checks
        with tempfile.TemporaryDirectory() as tmpdir:
            # Create a safe script
            safe_script_path = os.path.join(tmpdir, "safe.sh")
            with open(safe_script_path, "w") as f:
                f.write("#!/bin/sh\n")
            os.chmod(safe_script_path, 0o755)

            # Create an unsafe world-writable script
            unsafe_script_path = os.path.join(tmpdir, "unsafe.sh")
            with open(unsafe_script_path, "w") as f:
                f.write("#!/bin/sh\n")
            os.chmod(unsafe_script_path, 0o777)

            # Prepare items for analyzer
            items = [
                # 1. Safe script
                {
                    "owner": "root",
                    "command_or_unit": safe_script_path,
                    "schedule": "0 2 * * *",
                    "source": "cron",
                    "type": "cron",
                    "target_script": safe_script_path
                },
                # 2. Unsafe permissions
                {
                    "owner": "root",
                    "command_or_unit": unsafe_script_path,
                    "schedule": "30 2 * * *",
                    "source": "cron",
                    "type": "cron",
                    "target_script": unsafe_script_path
                },
                # 3. Missing script
                {
                    "owner": "root",
                    "command_or_unit": "/usr/local/bin/non-existent.sh",
                    "schedule": "0 3 * * *",
                    "source": "cron",
                    "type": "cron",
                    "target_script": "/usr/local/bin/non-existent.sh"
                },
                # 4. Unusual frequency (cron runs every minute)
                {
                    "owner": "root",
                    "command_or_unit": safe_script_path,
                    "schedule": "* * * * *",
                    "source": "cron",
                    "type": "cron",
                    "target_script": safe_script_path
                },
                # 5. Mismatched systemd state (timer with no service)
                {
                    "owner": "root",
                    "command_or_unit": "systemd:mismatch.service",
                    "schedule": "daily",
                    "source": "systemd",
                    "type": "systemd",
                    "timer_file": "mismatch.timer",
                    "service_file": None
                }
            ]

            analyzer = Analyzer(root_dir=tmpdir)
            _, confirmed, risks = analyzer.analyze(items)

            # Assert Confirmed Findings
            categories_conf = [c["category"] for c in confirmed]
            self.assertIn("Unsafe Executable Permissions", categories_conf)
            self.assertIn("Missing Script", categories_conf)
            self.assertIn("Mismatched State", categories_conf)

            # Verify specific unsafe permission finding details
            unsafe_finding = [c for c in confirmed if c["category"] == "Unsafe Executable Permissions"][0]
            self.assertEqual(unsafe_finding["severity"], "Critical")
            self.assertIn("world-writable", unsafe_finding["details"])

            # Assert Risks
            categories_risk = [r["category"] for r in risks]
            self.assertIn("Unusual Frequency", categories_risk)

    def test_overlaps_and_normalization(self):
        items = [
            # Two tasks running on 'daily'
            {
                "owner": "root",
                "command_or_unit": "backup.sh",
                "schedule": "daily",
                "source": "systemd (backup.timer)",
                "type": "systemd"
            },
            {
                "owner": "root",
                "command_or_unit": "cleanup.sh",
                "schedule": "0 0 * * *",
                "source": "cron",
                "type": "cron"
            }
        ]

        analyzer = Analyzer()
        _, _, risks = analyzer.analyze(items)

        overlap_findings = [r for r in risks if r["category"] == "Conflicting Schedule / Overlap"]
        self.assertEqual(len(overlap_findings), 1)
        self.assertIn("0 0 * * *", overlap_findings[0]["item"])
        self.assertIn("backup.sh", overlap_findings[0]["details"])
        self.assertIn("cleanup.sh", overlap_findings[0]["details"])

if __name__ == "__main__":
    unittest.main()
