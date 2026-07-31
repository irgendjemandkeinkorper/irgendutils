import unittest
from unittest.mock import patch, MagicMock
import os
import tempfile
import json
from pathlib import Path

import sys
sys.path.insert(0, str(Path(__file__).parent.parent / "src"))

from adapters import (
    mask_secrets,
    mask_cmd,
    validate_safe_wp_command,
    SafeCommandError,
    FixtureAdapter,
    WPCLIAdapter
)

class TestAdapters(unittest.TestCase):

    def test_mask_secrets(self):
        # Basic patterns
        self.assertEqual(mask_secrets(""), "")
        self.assertEqual(mask_secrets(None), None)
        self.assertEqual(mask_secrets("wp plugin list"), "wp plugin list")

        # Flag-based credential patterns
        self.assertEqual(mask_secrets("--dbpass=supersecret"), "--dbpass=[MASKED]")
        self.assertEqual(mask_secrets("--password='my-secret'"), "--password='[MASKED]'")
        self.assertEqual(mask_secrets('--pwd="some-pwd"'), '--pwd="[MASKED]"')

        # Mixed command line
        cmd_line = "wp core version --dbpass=secret --user=root"
        self.assertEqual(mask_secrets(cmd_line), "wp core version --dbpass=[MASKED] --user=root")

    def test_mask_cmd(self):
        cmd = ["wp", "core", "version", "--dbpass=secret", "--user=root"]
        expected = ["wp", "core", "version", "--dbpass=[MASKED]", "--user=root"]
        self.assertEqual(mask_cmd(cmd), expected)

    def test_validate_safe_wp_command_success(self):
        # Valid read-only commands
        valid_commands = [
            ["wp", "core", "version"],
            ["wp", "plugin", "list", "--format=json"],
            ["wp", "theme", "list", "--status=active"],
            ["wp", "mu-plugin", "list", "--format=json"],
            ["wp", "core", "check-update"],
            ["wp", "core", "is-installed", "--network"],
            ["wp", "--path", "/var/www/wordpress-updates/site-db", "plugin", "list", "--format=json"],
            ["wp", "--path=/var/www/wordpress-updates/site-db", "plugin", "list", "--format=json"]
        ]
        for cmd in valid_commands:
            try:
                validate_safe_wp_command(cmd)
            except SafeCommandError as e:
                self.fail(f"Safe command {cmd} triggered SafeCommandError: {e}")

    def test_validate_safe_wp_command_failures(self):
        # Prohibited/mutating commands or shell scripts
        unsafe_commands = [
            ["wp", "plugin", "install", "akismet"],
            ["wp", "plugin", "update", "--all"],
            ["wp", "theme", "delete", "twentytwentytwo"],
            ["wp", "plugin", "activate", "wp-seo"],
            ["wp", "config", "set", "DB_PASSWORD", "hacked"],
            ["wp", "db", "query", "DROP TABLE wp_posts;"],
            ["wp", "eval", "echo 'hello';"],
            ["wp", "eval-file", "exploit.php"],
            ["wp", "user", "create", "hacker", "hacker@evil.com"],
            ["wp", "user", "delete", "admin"],
            ["bash", "wp", "plugin", "list"], # Must start with wp
            []
        ]
        for cmd in unsafe_commands:
            with self.assertRaises(SafeCommandError):
                validate_safe_wp_command(cmd)

    def test_fixture_adapter_clean(self):
        # Let's verify FixtureAdapter parses mock files correctly
        # We can construct temporary fixture directory for self-contained testing
        with tempfile.TemporaryDirectory() as tmpdir:
            tmp_path = Path(tmpdir)

            # Write mini fixtures
            with open(tmp_path / "core_version.json", "w") as f:
                json.dump({"version": "6.5.0"}, f)
            with open(tmp_path / "core_check_update.json", "w") as f:
                json.dump([], f)
            with open(tmp_path / "plugin_list.json", "w") as f:
                json.dump([{"name": "akismet", "status": "active", "version": "5.3"}], f)
            with open(tmp_path / "theme_list.json", "w") as f:
                json.dump([{"name": "twentytwentyfour", "status": "active", "version": "1.1"}], f)
            with open(tmp_path / "mu_plugin_list.json", "w") as f:
                json.dump([], f)

            adapter = FixtureAdapter(tmpdir)
            self.assertEqual(adapter.get_core_version(), "6.5.0")
            self.assertEqual(adapter.check_core_update(), [])
            self.assertEqual(len(adapter.get_plugins()), 1)
            self.assertEqual(adapter.get_plugins()[0]["name"], "akismet")
            self.assertEqual(len(adapter.get_themes()), 1)
            self.assertFalse(adapter.is_multisite())

    def test_fixture_adapter_multisite_autodetect(self):
        with tempfile.TemporaryDirectory() as tmpdir:
            tmp_path = Path(tmpdir)

            # Write mini fixtures with network-active plugin
            with open(tmp_path / "core_version.json", "w") as f:
                json.dump({"version": "6.5.0"}, f)
            with open(tmp_path / "plugin_list.json", "w") as f:
                json.dump([{"name": "wp-multisite-sync", "status": "network-active", "version": "1.0.0"}], f)

            adapter = FixtureAdapter(tmpdir)
            self.assertTrue(adapter.is_multisite())

    @patch("subprocess.run")
    def test_wp_cli_adapter_calls(self, mock_run):
        # Setup mock subprocess execution
        mock_response = MagicMock()
        mock_response.stdout = '[{"name": "akismet", "status": "active", "version": "5.3"}]'
        mock_response.returncode = 0
        mock_run.return_value = mock_response

        adapter = WPCLIAdapter(wp_path="/var/www/html")
        plugins = adapter.get_plugins()

        # Verify subprocess was called correctly with shell=False
        mock_run.assert_called_once_with(
            ["wp", "--path", "/var/www/html", "plugin", "list", "--format=json"],
            stdout=-1, # subprocess.PIPE is -1
            stderr=-1,
            text=True,
            check=True,
            shell=False
        )
        self.assertEqual(len(plugins), 1)
        self.assertEqual(plugins[0]["name"], "akismet")


if __name__ == "__main__":
    unittest.main()
