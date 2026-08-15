import os
import re
import glob
import subprocess
from typing import List, Dict, Any, Optional

try:
    from parser import Parser
except ImportError:
    from .parser import Parser

class BaseAdapter:
    def get_schedules(self) -> List[Dict[str, Any]]:
        raise NotImplementedError

class OfflineAdapter(BaseAdapter):
    def __init__(self, root_dir: str):
        self.root_dir = os.path.abspath(root_dir)

    def _resolve_path(self, rel_path: str) -> str:
        return os.path.join(self.root_dir, rel_path.lstrip("/"))

    def get_schedules(self) -> List[Dict[str, Any]]:
        schedules = []

        # 1. Parse /etc/crontab
        etc_crontab = self._resolve_path("etc/crontab")
        if os.path.exists(etc_crontab):
            try:
                with open(etc_crontab, "r", errors="ignore") as f:
                    for line in f:
                        parsed = Parser.parse_cron_line(line, default_owner="root", has_user_field=True)
                        if parsed:
                            parsed["source"] = f"/etc/crontab"
                            schedules.append(parsed)
            except Exception:
                pass

        # 2. Parse /etc/cron.d/*
        etc_cron_d = self._resolve_path("etc/cron.d/*")
        for cron_file in glob.glob(etc_cron_d):
            if os.path.isfile(cron_file):
                try:
                    with open(cron_file, "r", errors="ignore") as f:
                        for line in f:
                            parsed = Parser.parse_cron_line(line, default_owner="root", has_user_field=True)
                            if parsed:
                                parsed["source"] = f"/etc/cron.d/{os.path.basename(cron_file)}"
                                schedules.append(parsed)
                except Exception:
                    pass

        # 3. Parse /var/spool/cron/crontabs/*
        # On some systems, spool path is /var/spool/cron/crontabs, on others /var/spool/cron/
        spool_paths = ["var/spool/cron/crontabs/*", "var/spool/cron/*"]
        for sp in spool_paths:
            full_sp = self._resolve_path(sp)
            for user_file in glob.glob(full_sp):
                # Ignore subdirectories (like crontabs itself if we matched var/spool/cron/*)
                if os.path.isfile(user_file):
                    username = os.path.basename(user_file)
                    try:
                        with open(user_file, "r", errors="ignore") as f:
                            for line in f:
                                parsed = Parser.parse_cron_line(line, default_owner=username, has_user_field=False)
                                if parsed:
                                    parsed["source"] = f"crontab -u {username}"
                                    schedules.append(parsed)
                    except Exception:
                        pass

        # 4. Parse systemd timers
        # Look for systemd timer files under /etc/systemd/system and /lib/systemd/system
        systemd_dirs = [
            "etc/systemd/system",
            "lib/systemd/system",
            "usr/lib/systemd/system"
        ]

        # Keep track of timers we've processed to avoid duplicates across directories
        processed_timers = set()

        for s_dir in systemd_dirs:
            full_dir = self._resolve_path(s_dir)
            if os.path.exists(full_dir):
                for timer_path in glob.glob(os.path.join(full_dir, "*.timer")):
                    timer_name = os.path.basename(timer_path)
                    if timer_name in processed_timers:
                        continue
                    processed_timers.add(timer_name)

                    try:
                        with open(timer_path, "r", errors="ignore") as f:
                            timer_content = f.read()

                        # Read matching service file
                        service_name = timer_name.replace(".timer", ".service")
                        service_content = None
                        service_source = None

                        # Find matching service file in any systemd directory
                        for sd in systemd_dirs:
                            srv_path = os.path.join(self._resolve_path(sd), service_name)
                            if os.path.exists(srv_path):
                                service_source = srv_path
                                try:
                                    with open(srv_path, "r", errors="ignore") as sf:
                                        service_content = sf.read()
                                    break
                                except Exception:
                                    pass

                        parsed = Parser.parse_systemd_timer(
                            timer_content, service_content, timer_path, service_source
                        )
                        schedules.append(parsed)
                    except Exception:
                        pass

        return schedules


class LiveAdapter(BaseAdapter):
    def get_schedules(self) -> List[Dict[str, Any]]:
        schedules = []

        # 1. Parse current user's crontab
        try:
            # Safe call, no shell interpolation, read-only
            res = subprocess.run(["crontab", "-l"], capture_output=True, text=True, errors="ignore")
            if res.returncode == 0 and res.stdout:
                current_user = os.environ.get("USER") or os.environ.get("LOGNAME") or "current_user"
                for line in res.stdout.splitlines():
                    parsed = Parser.parse_cron_line(line, default_owner=current_user, has_user_field=False)
                    if parsed:
                        parsed["source"] = f"crontab -l"
                        schedules.append(parsed)
        except Exception:
            # crontab command not available or failed
            pass

        # 2. Parse systemd timers via systemctl
        try:
            # Run: systemctl list-timers --all --no-legend
            res = subprocess.run(["systemctl", "list-timers", "--all", "--no-legend"], capture_output=True, text=True, errors="ignore")
            if res.returncode == 0 and res.stdout:
                for line in res.stdout.splitlines():
                    line = line.strip()
                    if not line:
                        continue

                    # Output columns format is normally:
                    # NEXT LEFT LAST PASSED UNIT ACTIVATES
                    # E.g.: Thu 2026-07-30 12:00:00 UTC 2h left Wed 2026-07-29 12:00:00 UTC 21h ago cleanup.timer cleanup.service
                    # Since dates can contain spaces, we can extract from the end of the line: UNIT and ACTIVATES are the last two fields.
                    parts = line.split()
                    if len(parts) < 2:
                        continue

                    timer_unit = parts[-2]
                    service_unit = parts[-1]

                    if not timer_unit.endswith(".timer"):
                        # If columns format is different, try to find the timer
                        continue

                    # Get timer content safely via `systemctl cat`
                    timer_content = ""
                    res_timer = subprocess.run(["systemctl", "cat", timer_unit], capture_output=True, text=True, errors="ignore")
                    if res_timer.returncode == 0 and res_timer.stdout:
                        # systemctl cat outputs a comment header first, configparser handles it or ignores it
                        timer_content = res_timer.stdout

                    # Get service content safely
                    service_content = None
                    res_srv = subprocess.run(["systemctl", "cat", service_unit], capture_output=True, text=True, errors="ignore")
                    if res_srv.returncode == 0 and res_srv.stdout:
                        service_content = res_srv.stdout

                    parsed = Parser.parse_systemd_timer(
                        timer_content, service_content, timer_unit, service_unit if service_content else None
                    )

                    # Try to extract actual Next execution time from the columns
                    # First 5 or so fields represent the NEXT run date
                    # Find indices or join
                    # For simplicity, we can regex the date part: YYYY-MM-DD HH:MM:SS
                    date_match = re.search(r'\d{4}-\d{2}-\d{2}\s+\d{2}:\d{2}:\d{2}', line)
                    if date_match:
                        parsed["next_run"] = date_match.group(0)

                    schedules.append(parsed)
        except Exception:
            # systemctl command not available or failed
            pass

        return schedules
