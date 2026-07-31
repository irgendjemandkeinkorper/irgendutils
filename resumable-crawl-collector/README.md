# Resumable Crawl Collector

A polite, resumable, and rate-limited Python crawl collector for targeted content research. It can pause, resume, cache responses, respect `robots.txt`, and export a normalized manifest.

## Features

- **Scope Control:** Restricts crawling to explicitly allowed origins and path prefixes to prevent runaway crawls.
- **Polite Crawling:** Respects `robots.txt` directive constraints and handles `Crawl-delay` and `Retry-After` HTTP headers.
- **Resumability:** Saves checkpoints atomically on pause, completion, or `Ctrl-C` to prevent data loss.
- **Bounded Resource Consumption:** Places strict upper bounds on depth, crawled page count, total bytes, redirect counts, retries, and thread concurrency.
- **Zero Heavy Dependencies:** Implemented entirely using Python 3.11+ standard library modules (`urllib`, `threading`, `json`, `csv`, `html.parser`, etc.).
- **Flexible Exporting:** Supports exporting crawled URL metadata and body hashes to normalized CSV and JSONL formats. Response body storage is opt-in.

## Requirements

- Python 3.11 or higher. No external pip libraries are required.

## Installation

No installation steps or external packages are necessary. Simply clone the repository or download the package, and make sure `resumable-crawl-collector` is on your path.

## Command Line Usage

### Starting a Fresh Crawl

To start a new crawl, you must specify the allowed origins (via `--origins`) and seed URL(s) (via `--seeds`).

```bash
python3 -m resumable_crawl_collector.cli \
  --origins "http://localhost:8080" \
  --seeds "http://localhost:8080/index.html" \
  --state-file my_crawl.json \
  --export-jsonl output.jsonl \
  --export-csv output.csv
```

### Resuming an Existing Crawl

If a crawl was paused or interrupted (e.g., via `Ctrl-C`), you can resume it using the `--resume` flag with the same state file:

```bash
python3 -m resumable_crawl_collector.cli \
  --resume \
  --state-file my_crawl.json \
  --export-jsonl output.jsonl \
  --export-csv output.csv
```

### Full Options List

```text
options:
  -h, --help            show this help message and exit
  --origins ORIGINS     Comma-separated allowed origins (e.g. http://example.com).
                        Required for starting fresh.
  --paths PATHS         Comma-separated allowed paths (e.g. /blog,/news).
                        Empty means any path is allowed.
  --seeds SEEDS         Comma-separated seed URLs to start crawling.
                        Required for starting fresh.
  --state-file STATE_FILE
                        Path to state file (default: crawl_state.json).
  --resume              Resume from the existing state file.
  --depth DEPTH         Max depth limit (default: 3).
  --max-pages MAX_PAGES
                        Max pages limit (default: 100).
  --max-bytes MAX_BYTES
                        Max bytes crawled limit (default: 10MB).
  --max-redirects MAX_REDIRECTS
                        Max redirects limit (default: 5).
  --max-retries MAX_RETRIES
                        Max retries for transient errors (default: 3).
  --concurrency CONCURRENCY
                        Max crawler concurrency/threads (default: 1).
  --delay DELAY         Politeness crawl delay in seconds (default: 1.0).
  --store-bodies        Opt-in to store HTML/response bodies.
  --ignore-robots       Ignore robots.txt file constraints.
  --export-jsonl EXPORT_JSONL
                        Filepath to export crawled data in JSONL format.
  --export-csv EXPORT_CSV
                        Filepath to export crawled data in CSV format.
```

## Responsible Use Guidelines

This crawler is designed specifically for polite and responsible content research.
1. **Always Set a Politeness Delay:** Keep `--delay` to at least 1.0s (default) to avoid overloading small web servers.
2. **Do Not Ignore Robots.txt:** Ensure `--ignore-robots` is only used on environments you own or have explicit authorization to crawl.
3. **Limit Resource Bounds:** Always run with a reasonable `--max-pages` and `--max-bytes` configuration to stay within bounds.
4. **Identify Your Crawler:** Standard user-agent is set to `ResumableCrawlCollector/1.0` to ensure transparency.

## Design Decisions

- **Atomic Checkpoints:** Checkpoints are written to a temporary file (e.g., `crawl_state.json.tmp`) and atomically replaced (`os.replace`) to ensure the state remains uncorrupted if the process is terminated abruptly (e.g., `Ctrl-C` or sudden power-loss).
- **Graceful Interruption Handler:** Interruption via `KeyboardInterrupt` signals all threads to stop, joins them, saves the final correct checkpoint state, and exits with status `130`.
- **Custom HTML Parser:** Built on Python's native `html.parser.HTMLParser` for zero dependencies and high speed.
- **Robust Exception/Retry Handling:** Categorizes errors into transient (5xx, 429 status codes, network dropouts) versus permanent (404, robots.txt exclusions, etc.). Transient errors undergo exponential backoff and respect server-suggested `Retry-After` headers before failing.
