import os
import sys
import unittest
import subprocess
import json

class TestCLI(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.cli_path = os.path.join(
            os.path.dirname(os.path.dirname(os.path.abspath(__file__))),
            "src", "cli.py"
        )
        cls.fixture_dir = os.path.join(
            os.path.dirname(os.path.dirname(os.path.abspath(__file__))),
            "fixtures", "mock_root"
        )
        # Git preserves the executable bit but not world-writable fixture modes.
        # Recreate the intentionally unsafe fixture permission on checkout.
        unsafe_script = os.path.join(cls.fixture_dir, "usr", "local", "bin", "unsafe-permission-script.sh")
        os.chmod(unsafe_script, 0o777)

    def test_cli_help(self):
        # Run help command to make sure arguments are set up correctly
        res = subprocess.run(
            [sys.executable, self.cli_path, "--help"],
            capture_output=True,
            text=True
        )
        self.assertEqual(res.returncode, 0)
        self.assertIn("usage:", res.stdout.lower() or res.stderr.lower())
        self.assertIn("--fixture-dir", res.stdout or res.stderr)
        self.assertIn("--live", res.stdout or res.stderr)
        self.assertIn("--json", res.stdout or res.stderr)

    def test_cli_fixture_human_report(self):
        # Run standard CLI execution with the mock fixture
        res = subprocess.run(
            [sys.executable, self.cli_path, "--fixture-dir", self.fixture_dir],
            capture_output=True,
            text=True
        )
        self.assertEqual(res.returncode, 0)
        self.assertIn("SYSTEMD & CRON SCHEDULE AUDITOR REPORT", res.stdout)
        self.assertIn("INVENTORIED WORK SCHEDULES", res.stdout)
        self.assertIn("CONFIRMED FINDINGS", res.stdout)
        self.assertIn("HEURISTICS & RISKS", res.stdout)

        # Verify credential masking in human report
        self.assertIn("[REDACTED]", res.stdout)
        self.assertNotIn("super_secret_token_123", res.stdout)
        self.assertNotIn("db_password_abc", res.stdout)
        self.assertNotIn("secret_env_token_value", res.stdout)

    def test_cli_fixture_json_report(self):
        # Run JSON execution
        res = subprocess.run(
            [sys.executable, self.cli_path, "--fixture-dir", self.fixture_dir, "--json"],
            capture_output=True,
            text=True
        )
        self.assertEqual(res.returncode, 0)

        # Load and verify JSON structure
        data = json.loads(res.stdout)
        self.assertIn("schedules", data)
        self.assertIn("confirmed_findings", data)
        self.assertIn("heuristics_risks", data)

        # Verify that schedules are parsed
        schedules = data["schedules"]
        self.assertTrue(len(schedules) > 0)

        # Check credential masking on parsed items in JSON
        for s in schedules:
            cmd = s.get("command_or_unit", "")
            self.assertNotIn("super_secret_token_123", cmd)
            self.assertNotIn("db_password_abc", cmd)

            # Check environment variables
            env_vars = s.get("env_vars", {})
            for k, v in env_vars.items():
                self.assertNotIn("secret_env_token_value", v)
                if "token" in k.lower():
                    self.assertEqual(v, "[REDACTED]")

        # Check confirmed findings
        confirmed = data["confirmed_findings"]
        categories = [c["category"] for c in confirmed]
        self.assertIn("Missing Script", categories)
        self.assertIn("Unsafe Executable Permissions", categories)
        self.assertIn("Mismatched State", categories)

        # Check heuristics risks
        risks = data["heuristics_risks"]
        risk_categories = [r["category"] for r in risks]
        self.assertIn("Unusual Frequency", risk_categories)
        self.assertIn("Conflicting Schedule / Overlap", risk_categories)

if __name__ == "__main__":
    unittest.main()
