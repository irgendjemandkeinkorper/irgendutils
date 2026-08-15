import json
import os
import re
import subprocess
from pathlib import Path
from typing import List, Dict, Any, Optional

# Secret keys pattern to mask (case-insensitive)
SECRET_PATTERNS = [
    re.compile(r"(pass(?:word)?|sec(?:ret)?|key|token|auth|pwd)(?:_|=|\b)", re.IGNORECASE)
]

def mask_secrets(text: str) -> str:
    """
    Mask sensitive information in a string.
    Specifically targets password, secret, key, token, auth, pwd patterns.
    """
    if not text:
        return text

    # Redact common command-line flag patterns like --dbpass=secret, --password=secret
    masked = re.sub(
        r"(--(?:dbpass|pass|password|secret|key|token|auth|pwd)=)([^\s'\"]+)",
        r"\1[MASKED]",
        text,
        flags=re.IGNORECASE
    )
    # Also mask values enclosed in quotes
    masked = re.sub(
        r"(--(?:dbpass|pass|password|secret|key|token|auth|pwd)=)(['\"])(.*?)\2",
        r"\1\2[MASKED]\2",
        masked,
        flags=re.IGNORECASE
    )
    return masked

def mask_cmd(cmd_list: List[str]) -> List[str]:
    """
    Mask sensitive arguments in a command list.
    """
    masked = []
    for arg in cmd_list:
        if "=" in arg:
            parts = arg.split("=", 1)
            # Check if left hand side is sensitive
            is_sensitive = any(p.search(parts[0]) for p in SECRET_PATTERNS)
            if is_sensitive:
                masked.append(f"{parts[0]}=[MASKED]")
                continue
        # Also check if the previous arg was a flag and this is a sensitive value (heuristically)
        masked.append(arg)
    return masked


class SafeCommandError(ValueError):
    """Exception raised when a command is determined to be unsafe."""
    pass


def validate_safe_wp_command(cmd_args: List[str]) -> None:
    """
    Verify that the command list is strictly a safe read-only WP-CLI command.
    Raises SafeCommandError if the command contains any potentially mutating keywords.
    """
    if not cmd_args:
        raise SafeCommandError("Empty command is not allowed")

    # Must start with wp
    if cmd_args[0] != "wp":
        raise SafeCommandError("Commands must invoke 'wp' directly")

    # Filter out --path arguments and their values to avoid false-positives
    # if the WordPress directory path contains forbidden words (e.g. "update", "db").
    check_args = []
    skip_next = False
    for arg in cmd_args:
        if skip_next:
            skip_next = False
            continue
        if arg == "--path":
            skip_next = True
            continue
        if arg.startswith("--path="):
            continue
        check_args.append(arg)

    # Flatten filtered args to check for illegal/mutating keywords
    joined = " ".join(check_args).lower()

    # Prohibited mutating keywords
    forbidden = [
        "update", "delete", "install", "activate", "deactivate",
        "uninstall", "upgrade", "import", "export", "db",
        "eval", "eval-file", "user create", "user update", "user delete",
        "post create", "post update", "post delete", "option update",
        "option add", "option delete", "config set"
    ]

    for word in forbidden:
        # Check word boundaries or exact matches
        if word in joined:
            if word == "update" and "check-update" in joined:
                continue
            if word == "install" and "is-installed" in joined:
                continue
            raise SafeCommandError(f"Mutating keyword '{word}' is strictly prohibited for security reasons")

    # Ensure command is strictly one of the expected read-only operations
    allowed_subcommands = [
        "core version", "core check-update", "core is-installed",
        "plugin list", "theme list", "mu-plugin list", "config get"
    ]

    # Clean the joined command of flag options to see if standard subcommand is present
    cleaned_joined = re.sub(r"--[a-z0-9_-]+(=[^\s]+)?", "", joined).strip()
    # Remove wp prefix
    if cleaned_joined.startswith("wp "):
        cleaned_joined = cleaned_joined[3:].strip()

    has_allowed = any(sub in cleaned_joined for sub in allowed_subcommands)
    if not has_allowed:
        raise SafeCommandError(f"Command '{' '.join(cmd_args)}' is not in the allowed list of read-only queries.")


class BaseAdapter:
    """Base class for WP-CLI / Fixture adapters."""
    def get_core_version(self, path: Optional[str] = None) -> str:
        raise NotImplementedError()

    def check_core_update(self, path: Optional[str] = None) -> List[Dict[str, Any]]:
        raise NotImplementedError()

    def get_plugins(self, path: Optional[str] = None) -> List[Dict[str, Any]]:
        raise NotImplementedError()

    def get_themes(self, path: Optional[str] = None) -> List[Dict[str, Any]]:
        raise NotImplementedError()

    def get_mu_plugins(self, path: Optional[str] = None) -> List[Dict[str, Any]]:
        raise NotImplementedError()

    def is_multisite(self, path: Optional[str] = None) -> bool:
        raise NotImplementedError()


class FixtureAdapter(BaseAdapter):
    """Adapter that reads from JSON fixture files (offline/mock mode)."""
    def __init__(self, fixture_dir: str):
        self.fixture_dir = Path(fixture_dir)

    def _read_json(self, filename: str, default: Any = None) -> Any:
        filepath = self.fixture_dir / filename
        if not filepath.exists():
            if default is not None:
                return default
            raise FileNotFoundError(f"Fixture file not found: {filepath}")
        with open(filepath, "r", encoding="utf-8") as f:
            return json.load(f)

    def get_core_version(self, path: Optional[str] = None) -> str:
        data = self._read_json("core_version.json")
        if isinstance(data, dict):
            return data.get("version", "0.0.0")
        return str(data).strip()

    def check_core_update(self, path: Optional[str] = None) -> List[Dict[str, Any]]:
        # Returns empty list if clean, or updates if available
        return self._read_json("core_check_update.json", default=[])

    def get_plugins(self, path: Optional[str] = None) -> List[Dict[str, Any]]:
        return self._read_json("plugin_list.json", default=[])

    def get_themes(self, path: Optional[str] = None) -> List[Dict[str, Any]]:
        return self._read_json("theme_list.json", default=[])

    def get_mu_plugins(self, path: Optional[str] = None) -> List[Dict[str, Any]]:
        return self._read_json("mu_plugin_list.json", default=[])

    def is_multisite(self, path: Optional[str] = None) -> bool:
        # Auto-detect if plugin list has network-active status
        try:
            plugins = self.get_plugins(path)
            for p in plugins:
                if p.get("status") == "network-active":
                    return True
        except FileNotFoundError:
            pass
        return False


class WPCLIAdapter(BaseAdapter):
    """Adapter that runs safe WP-CLI subprocess commands on a live WordPress site."""
    def __init__(self, wp_path: Optional[str] = None):
        self.wp_path = wp_path

    def _run_cmd(self, sub_args: List[str]) -> str:
        cmd = ["wp"]
        if self.wp_path:
            cmd.extend(["--path", self.wp_path])
        cmd.extend(sub_args)

        # Enforce command safety before execution
        validate_safe_wp_command(cmd)

        # Log/print masked command if needed
        masked_cmd = mask_cmd(cmd)

        try:
            # Avoid shell interpolation by passing lists directly
            res = subprocess.run(
                cmd,
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE,
                text=True,
                check=True,
                shell=False
            )
            return res.stdout
        except subprocess.CalledProcessError as e:
            masked_err = mask_secrets(e.stderr)
            masked_out = mask_secrets(e.stdout)
            raise RuntimeError(
                f"WP-CLI command failed: {' '.join(masked_cmd)}\n"
                f"Exit Code: {e.returncode}\n"
                f"STDOUT: {masked_out}\n"
                f"STDERR: {masked_err}"
            ) from e

    def get_core_version(self, path: Optional[str] = None) -> str:
        # Set temporary path override if provided
        old_path = self.wp_path
        if path:
            self.wp_path = path
        try:
            # We can run `wp core version`
            output = self._run_cmd(["core", "version"])
            return output.strip()
        finally:
            self.wp_path = old_path

    def check_core_update(self, path: Optional[str] = None) -> List[Dict[str, Any]]:
        old_path = self.wp_path
        if path:
            self.wp_path = path
        try:
            output = self._run_cmd(["core", "check-update", "--format=json"])
            if not output.strip():
                return []
            return json.loads(output)
        except (RuntimeError, json.JSONDecodeError) as e:
            # In some setups if up-to-date, it might exit with error or return empty
            # Let's handle it gracefully
            if "Success: WordPress is at the latest version" in str(e) or "is at the latest version" in str(e):
                return []
            # Otherwise, re-raise or return empty list
            return []
        finally:
            self.wp_path = old_path

    def get_plugins(self, path: Optional[str] = None) -> List[Dict[str, Any]]:
        old_path = self.wp_path
        if path:
            self.wp_path = path
        try:
            output = self._run_cmd(["plugin", "list", "--format=json"])
            if not output.strip():
                return []
            return json.loads(output)
        finally:
            self.wp_path = old_path

    def get_themes(self, path: Optional[str] = None) -> List[Dict[str, Any]]:
        old_path = self.wp_path
        if path:
            self.wp_path = path
        try:
            output = self._run_cmd(["theme", "list", "--format=json"])
            if not output.strip():
                return []
            return json.loads(output)
        finally:
            self.wp_path = old_path

    def get_mu_plugins(self, path: Optional[str] = None) -> List[Dict[str, Any]]:
        old_path = self.wp_path
        if path:
            self.wp_path = path
        try:
            # Some versions or setups of WP-CLI do not have standard mu-plugin list command
            # or it might fail if there are none. We wrap it in try-except.
            output = self._run_cmd(["mu-plugin", "list", "--format=json"])
            if not output.strip():
                return []
            return json.loads(output)
        except Exception:
            return []
        finally:
            self.wp_path = old_path

    def is_multisite(self, path: Optional[str] = None) -> bool:
        old_path = self.wp_path
        if path:
            self.wp_path = path
        try:
            # wp core is-installed --network exits with 0 if multisite, 1 if single site
            # Run manually so we can handle exit code safely without check=True throwing
            cmd = ["wp"]
            if self.wp_path:
                cmd.extend(["--path", self.wp_path])
            cmd.extend(["core", "is-installed", "--network"])

            validate_safe_wp_command(cmd)

            res = subprocess.run(
                cmd,
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE,
                text=True,
                shell=False
            )
            return res.returncode == 0
        except Exception:
            return False
        finally:
            self.wp_path = old_path
