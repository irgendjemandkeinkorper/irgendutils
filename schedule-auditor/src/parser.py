import os
import re
import configparser
from typing import Dict, List, Any, Optional

# Constants
CRON_SHORTCODES = {
    "@reboot": "At reboot",
    "@yearly": "0 0 1 1 *",
    "@annually": "0 0 1 1 *",
    "@monthly": "0 0 1 * *",
    "@weekly": "0 0 * * 0",
    "@daily": "0 0 * * *",
    "@midnight": "0 0 * * *",
    "@hourly": "0 * * * *",
}

class Parser:
    @staticmethod
    def clean_line(line: str) -> str:
        """Removes comments and trims whitespace."""
        line = line.strip()
        if not line or line.startswith('#'):
            return ""
        return line

    @staticmethod
    def parse_cron_line(line: str, default_owner: str, has_user_field: bool) -> Optional[Dict[str, Any]]:
        """
        Parses a single cron line.
        If has_user_field is True (system-wide cron like /etc/crontab or /etc/cron.d/*),
        the format is: m h dom mon dow user command
        If has_user_field is False (user crontab),
        the format is: m h dom mon dow command
        """
        line = line.strip()
        if not line or line.startswith('#') or '=' in line.split()[0]:
            # Skip empty, comments, or env var declarations (e.g. SHELL=/bin/sh)
            return None

        parts = line.split()
        if len(parts) == 0:
            return None

        # Check for shortcodes like @daily
        if parts[0].startswith('@'):
            shortcode = parts[0]
            if shortcode not in CRON_SHORTCODES and shortcode != "@reboot":
                # Unknown shortcode, ignore or handle as schedule
                pass

            if has_user_field:
                if len(parts) < 3:
                    return None
                owner = parts[1]
                command = " ".join(parts[2:])
            else:
                if len(parts) < 2:
                    return None
                owner = default_owner
                command = " ".join(parts[1:])

            schedule = shortcode
            return {
                "owner": owner,
                "command_or_unit": command,
                "next_run": "N/A",
                "persistent": "N/A",
                "schedule": schedule,
                "source": "cron",
                "raw_details": line,
                "type": "cron",
                "target_script": Parser.extract_script_path(command)
            }

        # Standard cron schedule (5 fields)
        if len(parts) < 5:
            return None

        schedule_fields = parts[:5]
        schedule = " ".join(schedule_fields)
        remaining = parts[5:]

        if has_user_field:
            if len(remaining) < 2:
                return None
            owner = remaining[0]
            command = " ".join(remaining[1:])
        else:
            if len(remaining) < 1:
                return None
            owner = default_owner
            command = " ".join(remaining)

        return {
            "owner": owner,
            "command_or_unit": command,
            "next_run": "N/A",
            "persistent": "N/A",
            "schedule": schedule,
            "source": "cron",
            "raw_details": line,
            "type": "cron",
            "target_script": Parser.extract_script_path(command)
        }

    @staticmethod
    def extract_script_path(command: str) -> str:
        """
        Extracts the primary target script or executable from a command.
        E.g., '/usr/local/bin/backup.sh --secret=xyz' -> '/usr/local/bin/backup.sh'
        """
        if not command:
            return ""
        # Remove env variables prefix like 'ENV_VAR=value /path/to/script'
        cmd_clean = command.strip()
        while True:
            match = re.match(r'^[A-Za-z0-9_]+=[^\s]+\s+(.*)$', cmd_clean)
            if match:
                cmd_clean = match.group(1).strip()
            else:
                break

        if not cmd_clean:
            return ""

        # Check if it starts with single or double quote
        if cmd_clean.startswith('"'):
            end_idx = cmd_clean.find('"', 1)
            if end_idx != -1:
                return cmd_clean[1:end_idx]
        elif cmd_clean.startswith("'"):
            end_idx = cmd_clean.find("'", 1)
            if end_idx != -1:
                return cmd_clean[1:end_idx]

        # Split by space, take the first element (ignoring quotes for simplicity or stripping them)
        parts = cmd_clean.split()
        if not parts:
            return ""

        first_part = parts[0]
        # Remove quotes
        first_part = first_part.strip('\'"')
        return first_part

    @staticmethod
    def parse_systemd_timer(timer_content: str, service_content: Optional[str], timer_source: str, service_source: Optional[str]) -> Dict[str, Any]:
        """
        Parses systemd .timer content and optionally the matching .service content.
        """
        timer_config = configparser.ConfigParser(interpolation=None, strict=False)
        # Handle case-insensitive keys correctly while preserving casing for certain parts
        timer_config.optionxform = str  # type: ignore
        try:
            timer_config.read_string(timer_content)
        except Exception:
            # Fallback manual parser if configparser fails
            pass

        schedule = "N/A"
        persistent = "false"
        unit_name = ""

        if "Timer" in timer_config:
            # OnCalendar is the most common scheduling directive
            schedule = timer_config["Timer"].get("OnCalendar", "N/A")
            persistent = timer_config["Timer"].get("Persistent", "false")
            unit_name = timer_config["Timer"].get("Unit", "")

        # Default owner and command
        owner = "root"
        command = f"systemd:{unit_name}" if unit_name else f"systemd:{os.path.basename(timer_source).replace('.timer', '.service')}"
        target_script = ""
        env_vars = {}
        env_files = []

        if service_content:
            service_config = configparser.ConfigParser(interpolation=None, strict=False)
            service_config.optionxform = str  # type: ignore
            try:
                service_config.read_string(service_content)
                if "Service" in service_config:
                    srv = service_config["Service"]
                    owner = srv.get("User", "root")
                    command = srv.get("ExecStart", command)
                    target_script = Parser.extract_script_path(command)

                    # Extract environment variables
                    for key, val in srv.items():
                        if key == "Environment":
                            # Extract key=value
                            # Multiple Environment= can exist or space separated
                            # e.g. Environment="A=B" "C=D" or Environment=A=B
                            # We can parse them using regex
                            matches = re.findall(r'([^"\'\s=]+)=("[^"]*"|\'[^\']*\'|[^\s]+)', val)
                            for k, v in matches:
                                env_vars[k] = v.strip('"\'')
                        elif key == "EnvironmentFile":
                            env_files.append(val.strip('"\''))
            except Exception:
                pass

        return {
            "owner": owner,
            "command_or_unit": command,
            "next_run": "N/A",  # To be filled by live adapter or left N/A
            "persistent": persistent.lower() == "true",
            "schedule": schedule,
            "source": f"systemd ({os.path.basename(timer_source)})",
            "raw_details": f"Timer Calendar: {schedule}",
            "type": "systemd",
            "target_script": target_script,
            "env_vars": env_vars,
            "env_files": env_files,
            "service_file": os.path.basename(service_source) if service_source else None,
            "timer_file": os.path.basename(timer_source)
        }
