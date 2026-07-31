# Python Systemd and Cron Schedule Auditor

A read-only Python CLI that inventories scheduled work from systemd timers and cron, then identifies risky or conflicting schedules.

## Goal
To inventory scheduled work from systemd timers and cron, and flag overlaps, missing scripts, unsafe executable permissions, mismatched timer/service state, unusual frequency, and credentials/secrets leak.

## Structure
- `src/`: Core Python modules (CLI, parser, adapter, analyzer).
- `test/`: Test cases.
- `fixtures/`: Mock root directories containing mock cron/systemd configurations and target scripts.

## Usage
To audit in offline (fixture-backed) mode:
```bash
python3 schedule-auditor/src/cli.py --fixture-dir schedule-auditor/fixtures/mock_root
```

To run with JSON output:
```bash
python3 schedule-auditor/src/cli.py --fixture-dir schedule-auditor/fixtures/mock_root --json
```

To audit live host (read-only):
```bash
python3 schedule-auditor/src/cli.py --live
```
