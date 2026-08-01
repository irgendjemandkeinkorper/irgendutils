# Limitations & Scope of Schedule Auditor

This document outlines the limitations and scope of the Python systemd and cron schedule auditor.

## 1. Operating System Compatibility
- **Primary Support**: Linux distributions with systemd (Ubuntu, Debian, CentOS, RHEL, Fedora) and standard Vixie-style cron or cronie.
- **Limited Support**: macOS (launchd instead of systemd, different cron implementation), Windows (Task Scheduler). The tool expects Linux file layouts or commands.

## 2. Parsing Limitations
- **Cron Expressions**: The parser handles standard 5-field cron patterns (`* * * * *`), common shortcodes (`@daily`, `@reboot`, `@hourly`, etc.), and some ranges/steps. Extremely complex or custom system-specific macro patterns may degrade to raw strings.
- **Systemd OnCalendar**: Systemd supports complex calendar expressions (e.g., `Mon,Tue 12:00`, `*-*-01 00:00:00`, etc.). The auditor normalizes these for overlap comparison using basic heuristics, but exact microsecond-level simulations are out of scope.
- **Anacron**: System-wide cron directories (`/etc/cron.daily`, `/etc/cron.weekly`, etc.) are monitored via their directories, but individual run-parts or detailed anacrontab timing checks might rely on standard fallback run hours.

## 3. Privilege / Permission Limitations
- Under offline mock execution, permissions are fully modeled.
- In live execution mode, the CLI runs with current user privileges. It will only audit cron jobs and systemd units accessible by that user (or via non-interactive read-only commands). For complete system audit, it may require read-only superuser permission to read files under `/etc/` or execute `crontab -u <user> -l`, but the tool will never escalate privileges or execute write commands.

## 4. Execution Integrity & Non-Intrusiveness
- This tool is strictly **read-only**. It never writes, modifies, disables, or enables any systemd unit or crontab file.
- Executables and target scripts are checked for existence and metadata (like permission bits) using standard filesystem calls without execution.
