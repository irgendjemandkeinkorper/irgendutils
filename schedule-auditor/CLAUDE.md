# Schedule Auditor

A read-only Python CLI that inventories scheduled work from systemd timers and cron, then identifies risky or conflicting schedules.

## Architecture Map

- **Stack**: Python 3.11+, zero external dependencies (standard library only).
- **Files**:
  - `src/cli.py`: Entrypoint, parses CLI arguments and formats outputs.
  - `src/parser.py`: Low-level cron and systemd parser.
  - `src/adapters.py`: Abstracted access to offline (mock files) and live (read-only subprocess calls) data.
  - `src/analyzer.py`: Identifies overlaps, missing files, unsafe permissions, unusual frequencies, and masks secret keys.
- **Scope**: Exclusive file scope is `schedule-auditor/`.

## Running Tests
Run tests with standard `unittest`:
```bash
python3 -m unittest discover -s schedule-auditor/test/
```

## Conventions
- **Read-only**: Never modify crontabs, systemd timers, or service units.
- **Subprocess Security**: Do not use `shell=True` or perform shell interpolation when calling external utilities.
- **Credential Masking**: Any environment variables, configuration strings, or command line arguments containing standard sensitive substrings (e.g. `PASSWORD`, `SECRET`, `TOKEN`, `KEY`, `AUTH`, `PWD`) or raw credentials must be redacted or masked.
- **Distinguish Findings**: Separate "Confirmed Findings" (certain facts, e.g. file missing, world-writable permission) from "Heuristics / Risks" (potential issues, e.g. high frequency, schedule overlap).
