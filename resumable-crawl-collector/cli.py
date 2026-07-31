import os
import sys
import argparse
import csv
import json
from datetime import datetime, timezone

# Add parent directory of this file to sys.path to enable zero-dependency local imports
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import collector
from collector import CrawlState, CrawlCollector, get_origin

def export_to_jsonl(visited, filepath):
    try:
        os.makedirs(os.path.dirname(os.path.abspath(filepath)), exist_ok=True)
        with open(filepath, 'w', encoding='utf-8') as f:
            for url, data in visited.items():
                record = {"url": url}
                record.update(data)
                f.write(json.dumps(record, ensure_ascii=False) + "\n")
        print(f"Exported {len(visited)} records to JSONL: {filepath}")
    except Exception as e:
        print(f"Error: Failed to export to JSONL {filepath}: {e}", file=sys.stderr)

def export_to_csv(visited, filepath):
    try:
        os.makedirs(os.path.dirname(os.path.abspath(filepath)), exist_ok=True)
        with open(filepath, 'w', encoding='utf-8', newline='') as f:
            writer = csv.writer(f)
            # Find all keys across all records to build standard headers
            headers = ["url", "status", "depth", "content_type", "bytes", "hash", "timestamp", "redirect_to", "body"]
            writer.writerow(headers)
            for url, data in visited.items():
                row = [
                    url,
                    data.get("status", ""),
                    data.get("depth", ""),
                    data.get("content_type", ""),
                    data.get("bytes", ""),
                    data.get("hash", ""),
                    data.get("timestamp", ""),
                    data.get("redirect_to", ""),
                    data.get("body", "")
                ]
                writer.writerow(row)
        print(f"Exported {len(visited)} records to CSV: {filepath}")
    except Exception as e:
        print(f"Error: Failed to export to CSV {filepath}: {e}", file=sys.stderr)

def print_summary(state):
    print("\n" + "="*40)
    print("           CRAWL RUN SUMMARY")
    print("="*40)
    print(f"Pages Crawled:   {state.pages_crawled}")
    print(f"Bytes Crawled:   {state.bytes_crawled} bytes")
    print(f"Queue Size:      {len(state.queue)}")
    print(f"Success Count:   {len(state.visited)}")
    print(f"Failure Count:   {len(state.failed)}")

    if state.visited:
        print("\n--- Successful Pages (Top 10) ---")
        for i, (url, data) in enumerate(list(state.visited.items())[:10], 1):
            print(f" {i}. {url} (Status: {data.get('status')}, {data.get('bytes')} bytes)")
        if len(state.visited) > 10:
            print(f" ... and {len(state.visited) - 10} more.")

    if state.failed:
        print("\n--- Failed Pages (Top 10) ---")
        for i, (url, data) in enumerate(list(state.failed.items())[:10], 1):
            print(f" {i}. {url} - Error: {data.get('error')}")
        if len(state.failed) > 10:
            print(f" ... and {len(state.failed) - 10} more.")
    print("="*40 + "\n")

def main():
    parser = argparse.ArgumentParser(
        description="Resumable and rate-limited Python crawl collector.",
        formatter_class=argparse.RawTextHelpFormatter
    )

    parser.add_argument("--origins", type=str, help="Comma-separated allowed origins (e.g. http://example.com). Required for starting fresh.")
    parser.add_argument("--paths", type=str, help="Comma-separated allowed paths (e.g. /blog,/news). Empty means any path is allowed.")
    parser.add_argument("--seeds", type=str, help="Comma-separated seed URLs to start crawling from. Required for starting fresh.")
    parser.add_argument("--state-file", type=str, default="crawl_state.json", help="Path to state file (default: crawl_state.json).")
    parser.add_argument("--resume", action="store_true", help="Resume from the existing state file.")
    parser.add_argument("--depth", type=int, default=3, help="Max depth limit (default: 3).")
    parser.add_argument("--max-pages", type=int, default=100, help="Max pages limit (default: 100).")
    parser.add_argument("--max-bytes", type=int, default=10485760, help="Max bytes crawled limit (default: 10MB).")
    parser.add_argument("--max-redirects", type=int, default=5, help="Max redirects limit (default: 5).")
    parser.add_argument("--max-retries", type=int, default=3, help="Max retries for transient errors (default: 3).")
    parser.add_argument("--concurrency", type=int, default=1, help="Max crawler concurrency/threads (default: 1).")
    parser.add_argument("--delay", type=float, default=1.0, help="Politeness crawl delay in seconds (default: 1.0).")
    parser.add_argument("--store-bodies", action="store_true", help="Opt-in to store HTML/response bodies.")
    parser.add_argument("--ignore-robots", action="store_true", help="Ignore robots.txt file constraints.")
    parser.add_argument("--export-jsonl", type=str, help="Filepath to export crawled data in JSONL format.")
    parser.add_argument("--export-csv", type=str, help="Filepath to export crawled data in CSV format.")

    args = parser.parse_args()

    # Determine allowed origins & paths
    allowed_origins = []
    if args.origins:
        allowed_origins = [o.strip().lower() for o in args.origins.split(",") if o.strip()]

    allowed_paths = []
    if args.paths:
        allowed_paths = [p.strip() for p in args.paths.split(",") if p.strip()]

    seeds = []
    if args.seeds:
        seeds = [s.strip() for s in args.seeds.split(",") if s.strip()]

    # Setup state
    state = CrawlState(
        state_file=args.state_file,
        allowed_origins=allowed_origins,
        allowed_paths=allowed_paths,
        depth_limit=args.depth,
        max_pages=args.max_pages,
        max_bytes=args.max_bytes,
        max_redirects=args.max_redirects,
        max_retries=args.max_retries,
        concurrency=args.concurrency,
        store_bodies=args.store_bodies
    )

    if args.resume:
        print(f"Attempting to resume crawl from checkpoint: {args.state_file}")
        if not state.load():
            print(f"Error: Could not load state file {args.state_file}. Cannot resume.", file=sys.stderr)
            sys.exit(1)
        print(f"Resumed state: {state.pages_crawled} pages, {state.bytes_crawled} bytes previously crawled. Queue size: {len(state.queue)}")
    else:
        # Starting fresh. Verify mandatory arguments.
        if not args.origins:
            print("Error: --origins must be specified when starting a fresh crawl.", file=sys.stderr)
            sys.exit(1)
        if not args.seeds:
            print("Error: --seeds must be specified when starting a fresh crawl.", file=sys.stderr)
            sys.exit(1)

        # Validate seeds belong to allowed origins
        for s in seeds:
            origin = get_origin(s)
            if not origin or origin not in state.allowed_origins:
                print(f"Error: Seed URL '{s}' does not match any allowed origins: {state.allowed_origins}", file=sys.stderr)
                sys.exit(1)

        state.add_seed_urls(seeds)
        state.save()
        print(f"Initialized fresh crawl. Allowed origins: {state.allowed_origins}. Seeds: {seeds}")

    # Create collector
    collector = CrawlCollector(
        state=state,
        default_delay=args.delay,
        user_agent="ResumableCrawlCollector/1.0",
        ignore_robots=args.ignore_robots
    )

    # Start crawling
    interrupted = False
    try:
        collector.start()
    except KeyboardInterrupt:
        interrupted = True
        # Gracefully handle Ctrl-C, collector.start() already saves checkpoint and stops threads
        pass

    # Save final checkpoint if not already done
    state.save()

    # Print run summary
    print_summary(state)

    # Export results if requested
    if args.export_jsonl:
        export_to_jsonl(state.visited, args.export_jsonl)
    if args.export_csv:
        export_to_csv(state.visited, args.export_csv)

    if interrupted:
        print("Crawl run paused/interrupted. You can resume later using --resume.")
        sys.exit(130)

if __name__ == "__main__":
    main()
