import os
import stat
import re
from typing import Optional

# Sensitive keywords for credential masking
SECRET_KEYWORDS = re.compile(
    r'(password|secret|token|key|auth|pwd|credential|private|pass)',
    re.IGNORECASE
)

# Map common schedule identifiers to normalized names for overlap grouping
SCHEDULE_NORMALIZATION = {
    "daily": "0 0 * * *",
    "midnight": "0 0 * * *",
    "@daily": "0 0 * * *",
    "@midnight": "0 0 * * *",
    "hourly": "0 * * * *",
    "@hourly": "0 * * * *",
    "weekly": "0 0 * * 0",
    "@weekly": "0 0 * * 0",
    "monthly": "0 0 1 * *",
    "@monthly": "0 0 1 * *",
    "yearly": "0 0 1 1 *",
    "annually": "0 0 1 1 *",
    "@yearly": "0 0 1 1 *",
    "@annually": "0 0 1 1 *",
}

class Analyzer:
    def __init__(self, root_dir: Optional[str] = None):
        """
        :param root_dir: Path to the mock root directory if running in offline mode.
        """
        self.root_dir = os.path.abspath(root_dir) if root_dir else None

    def _resolve_path(self, path: str) -> str:
        """Resolves target path considering the root_dir fallback."""
        if not path:
            return ""
        if self.root_dir:
            # If path starts with root_dir already, don't duplicate
            if path.startswith(self.root_dir):
                return path
            return os.path.join(self.root_dir, path.lstrip("/"))
        return path

    def mask_credentials(self, item: dict) -> dict:
        """
        Returns a copy of the item with credentials and sensitive values masked in commands and environment.
        """
        masked = dict(item)

        # 1. Mask env vars inside the systemd service if any
        if "env_vars" in masked:
            masked_env = {}
            for k, v in masked["env_vars"].items():
                if SECRET_KEYWORDS.search(k) or SECRET_KEYWORDS.search(v):
                    masked_env[k] = "[REDACTED]"
                else:
                    masked_env[k] = v
            masked["env_vars"] = masked_env

        # 2. Mask secrets passed as command line options (e.g. --password=secret or -pwd secret or --secret=abc)
        cmd = masked.get("command_or_unit", "")
        if cmd:
            def mask_cmd_secrets(match):
                prefix = match.group(1) # --password= or --password
                quote = match.group(2) or "" # " or ' or empty
                val = match.group(3)
                return f"{prefix}{quote}[REDACTED]{quote}"

            # Match --option=value or --option value where option has secret keyword
            pattern = r'(-[A-Za-z0-9_-]*(?:password|secret|token|key|auth|pwd|credential|pass)[A-Za-z0-9_-]*\s*=\s*|-[A-Za-z0-9_-]*(?:password|secret|token|key|auth|pwd|credential|pass)[A-Za-z0-9_-]*\s+)(["\']?)([^"\'\s]+)\2'

            try:
                cmd_masked = re.sub(pattern, mask_cmd_secrets, cmd, flags=re.IGNORECASE)
                masked["command_or_unit"] = cmd_masked
            except Exception:
                pass

        return masked

    def analyze(self, items: list) -> tuple:
        """
        Analyzes normalized schedule items.
        Returns:
          - masked_items: Items with sensitive credentials redacted.
          - confirmed_findings: Confirmed facts (e.g., missing files, unsafe permissions, mismatched states).
          - heuristics_risks: Potential risks (e.g., unusual frequency, schedule overlaps).
        """
        masked_items = [self.mask_credentials(item) for item in items]
        confirmed_findings = []
        heuristics_risks = []

        # Track schedules for overlap detection
        # Key: normalized schedule expression, Value: list of (source, command_or_unit)
        schedule_groups = {}

        for i, item in enumerate(items):
            masked_item = masked_items[i]
            source = item["source"]
            cmd_or_unit = masked_item["command_or_unit"]
            target_script = item.get("target_script")
            sched = item.get("schedule", "").strip()

            # Group for overlaps
            norm_sched = SCHEDULE_NORMALIZATION.get(sched.lower(), sched)
            if norm_sched and norm_sched != "N/A":
                norm_sched_clean = " ".join(norm_sched.split())
                if norm_sched_clean not in schedule_groups:
                    schedule_groups[norm_sched_clean] = []
                schedule_groups[norm_sched_clean].append((source, cmd_or_unit))

            # 1. Check Unusual Frequency
            if item["type"] == "cron":
                if sched.startswith("* * * * *") or sched.startswith("*/1 * * * *"):
                    heuristics_risks.append({
                        "category": "Unusual Frequency",
                        "severity": "Warning",
                        "source": source,
                        "item": cmd_or_unit,
                        "details": f"Cron job runs every minute: '{sched}'",
                        "remediation": "Consider decreasing the frequency or migrating to a systemd timer with specific intervals."
                    })
            elif item["type"] == "systemd":
                if "OnCalendar" in item.get("raw_details", ""):
                    if "*:*:00" in sched or "*:00:00" in sched or "min" in sched:
                        heuristics_risks.append({
                            "category": "Unusual Frequency",
                            "severity": "Warning",
                            "source": source,
                            "item": cmd_or_unit,
                            "details": f"Systemd timer runs with high sub-hourly frequency: '{sched}'",
                            "remediation": "Audit if this execution rate is necessary or if randomized delay (AccuracySec) should be configured."
                        })

            # 2. Check systemd Mismatched States
            if item["type"] == "systemd":
                timer_file = item.get("timer_file")
                service_file = item.get("service_file")
                if timer_file and not service_file:
                    confirmed_findings.append({
                        "category": "Mismatched State",
                        "severity": "Critical",
                        "source": source,
                        "item": timer_file,
                        "details": f"Systemd timer '{timer_file}' exists, but no matching service file was found.",
                        "remediation": f"Create the service file '{timer_file.replace('.timer', '.service')}' or configure 'Unit=' under the '[Timer]' section."
                    })

            # 3. Check Target Script details (Existence & Permissions)
            if target_script:
                resolved_script = self._resolve_path(target_script)
                is_path = "/" in target_script or target_script.endswith(".sh") or target_script.endswith(".py")

                if is_path:
                    if not os.path.exists(resolved_script):
                        confirmed_findings.append({
                            "category": "Missing Script",
                            "severity": "High",
                            "source": source,
                            "item": cmd_or_unit,
                            "details": f"Target script '{target_script}' does not exist on the filesystem.",
                            "remediation": "Verify the command path, restore the missing script, or clean up the scheduling entry."
                        })
                    else:
                        # File exists, check permissions
                        try:
                            st = os.stat(resolved_script)
                            mode = st.st_mode

                            # Check group/world writable
                            world_writable = bool(mode & stat.S_IWOTH)
                            group_writable = bool(mode & stat.S_IWGRP)

                            if world_writable:
                                confirmed_findings.append({
                                    "category": "Unsafe Executable Permissions",
                                    "severity": "Critical",
                                    "source": source,
                                    "item": f"{target_script} (from {cmd_or_unit})",
                                    "details": f"Target executable is world-writable (mode: {oct(stat.S_IMODE(mode))}). Any local user can manipulate this executable.",
                                    "remediation": f"Run 'chmod o-w {target_script}' to secure the script."
                                })
                            elif group_writable:
                                confirmed_findings.append({
                                    "category": "Unsafe Executable Permissions",
                                    "severity": "Warning",
                                    "source": source,
                                    "item": f"{target_script} (from {cmd_or_unit})",
                                    "details": f"Target executable is group-writable (mode: {oct(stat.S_IMODE(mode))}).",
                                    "remediation": f"Run 'chmod g-w {target_script}' to secure the script."
                                })
                        except Exception:
                            pass

        # 4. Process Overlaps / Conflicting schedules
        for sched_val, jobs in schedule_groups.items():
            if len(jobs) > 1:
                conflict_details = []
                for job_source, job_cmd in jobs:
                    conflict_details.append(f"[{job_source}]: {job_cmd}")

                heuristics_risks.append({
                    "category": "Conflicting Schedule / Overlap",
                    "severity": "Warning",
                    "source": "Multiple",
                    "item": f"Schedule '{sched_val}'",
                    "details": f"{len(jobs)} jobs scheduled to run at the same time: {', '.join(conflict_details)}",
                    "remediation": "Stagger the timing or introduce RandomizedDelaySec / splay parameters to prevent resource spikes and CPU lockups."
                })

        return masked_items, confirmed_findings, heuristics_risks
