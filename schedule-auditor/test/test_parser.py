import os
import sys
import unittest

# Ensure src/ is in path
sys.path.insert(0, os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "src"))

from parser import Parser

class TestParser(unittest.TestCase):
    def test_clean_line(self):
        self.assertEqual(Parser.clean_line("  "), "")
        self.assertEqual(Parser.clean_line("# comment"), "")
        self.assertEqual(Parser.clean_line("  # comment"), "")
        self.assertEqual(Parser.clean_line("  0 0 * * * root script.sh  "), "0 0 * * * root script.sh")

    def test_parse_cron_line_system(self):
        # Format: m h dom mon dow user command
        line = "30 4 * * * backup_user /usr/local/bin/backup.sh --secret=abc"
        parsed = Parser.parse_cron_line(line, default_owner="root", has_user_field=True)
        self.assertIsNotNone(parsed)
        self.assertEqual(parsed["owner"], "backup_user")
        self.assertEqual(parsed["schedule"], "30 4 * * *")
        self.assertEqual(parsed["command_or_unit"], "/usr/local/bin/backup.sh --secret=abc")
        self.assertEqual(parsed["target_script"], "/usr/local/bin/backup.sh")

    def test_parse_cron_line_user(self):
        # Format: m h dom mon dow command
        line = "*/5 * * * * /usr/local/bin/heartbeat.sh"
        parsed = Parser.parse_cron_line(line, default_owner="john", has_user_field=False)
        self.assertIsNotNone(parsed)
        self.assertEqual(parsed["owner"], "john")
        self.assertEqual(parsed["schedule"], "*/5 * * * *")
        self.assertEqual(parsed["command_or_unit"], "/usr/local/bin/heartbeat.sh")
        self.assertEqual(parsed["target_script"], "/usr/local/bin/heartbeat.sh")

    def test_parse_cron_shortcode(self):
        line = "@daily /usr/local/bin/daily-report.sh"
        parsed = Parser.parse_cron_line(line, default_owner="john", has_user_field=False)
        self.assertIsNotNone(parsed)
        self.assertEqual(parsed["schedule"], "@daily")
        self.assertEqual(parsed["owner"], "john")
        self.assertEqual(parsed["command_or_unit"], "/usr/local/bin/daily-report.sh")

    def test_extract_script_path(self):
        self.assertEqual(Parser.extract_script_path("/bin/sh /usr/bin/script.sh"), "/bin/sh")
        self.assertEqual(Parser.extract_script_path("PYTHONPATH=/app python3 /app/main.py"), "python3")
        self.assertEqual(Parser.extract_script_path("'/usr/local/bin/spaced script.sh' arg1"), "/usr/local/bin/spaced script.sh")

    def test_parse_systemd_timer(self):
        timer_content = """[Unit]
Description=Test Timer

[Timer]
OnCalendar=daily
Persistent=true
Unit=test.service
"""
        service_content = """[Unit]
Description=Test Service

[Service]
User=test_user
ExecStart=/usr/local/bin/test-exec.sh --password=xyz
Environment="MY_KEY=abc" "SEC_TOKEN=secret"
"""
        parsed = Parser.parse_systemd_timer(
            timer_content, service_content, "test.timer", "test.service"
        )
        self.assertEqual(parsed["owner"], "test_user")
        self.assertEqual(parsed["schedule"], "daily")
        self.assertEqual(parsed["persistent"], True)
        self.assertEqual(parsed["command_or_unit"], "/usr/local/bin/test-exec.sh --password=xyz")
        self.assertEqual(parsed["target_script"], "/usr/local/bin/test-exec.sh")
        self.assertEqual(parsed["env_vars"]["MY_KEY"], "abc")
        self.assertEqual(parsed["env_vars"]["SEC_TOKEN"], "secret")

if __name__ == "__main__":
    unittest.main()
