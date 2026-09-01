import os
import sys
import json
import time
import hashlib
import urllib.request
import urllib.parse
import urllib.robotparser
import threading
from collections import deque
from datetime import datetime, timezone
from email.utils import parsedate_to_datetime
from html.parser import HTMLParser

class NoRedirectHandler(urllib.request.HTTPRedirectHandler):
    def http_error_302(self, req, fp, code, msg, headers):
        return fp
    http_error_301 = http_error_303 = http_error_307 = http_error_308 = http_error_302

def get_origin(url):
    try:
        parsed = urllib.parse.urlparse(url)
        if not parsed.scheme or not parsed.netloc:
            return None
        return f"{parsed.scheme.lower()}://{parsed.netloc.lower()}"
    except Exception:
        return None

def parse_retry_after(header_value):
    if not header_value:
        return None
    header_value = header_value.strip()
    try:
        return int(header_value)
    except ValueError:
        pass
    try:
        dt = parsedate_to_datetime(header_value)
        now = datetime.now(timezone.utc)
        delta = (dt - now).total_seconds()
        return max(0, int(delta))
    except Exception:
        pass
    return None

class LinkExtractor(HTMLParser):
    def __init__(self):
        super().__init__()
        self.links = []

    def handle_starttag(self, tag, attrs):
        if tag == "a":
            for name, value in attrs:
                if name == "href" and value:
                    self.links.append(value)

class CrawlState:
    def __init__(self, state_file, allowed_origins=None, allowed_paths=None,
                 depth_limit=3, max_pages=100, max_bytes=10 * 1024 * 1024,
                 max_redirects=5, max_retries=3, concurrency=1, store_bodies=False):
        self.state_file = state_file
        # Use RLock (Reentrant Lock) to prevent self-deadlocks on nested acquisitions
        self.lock = threading.RLock()
        self.cond = threading.Condition(self.lock)

        self.allowed_origins = allowed_origins or []
        self.allowed_paths = allowed_paths or []
        self.depth_limit = depth_limit
        self.max_pages = max_pages
        self.max_bytes = max_bytes
        self.max_redirects = max_redirects
        self.max_retries = max_retries
        self.concurrency = concurrency
        self.store_bodies = store_bodies

        # Use deque for O(1) pops/prepends and a set for O(1) duplicate URL lookups
        self.queue = deque()  # deque of {"url": url, "depth": depth, "redirect_count": r_count}
        self.queued_urls = set()  # set of URLs currently in queue
        self.visited = {}  # url -> info dict
        self.failed = {}   # url -> info dict
        self.robots_cache = {}  # host_origin -> robots_txt_content (str) or None
        self.bytes_crawled = 0
        self.pages_crawled = 0
        self.active_count = 0

    def load(self):
        with self.lock:
            if not os.path.exists(self.state_file):
                return False
            try:
                with open(self.state_file, 'r', encoding='utf-8') as f:
                    data = json.load(f)
                self.allowed_origins = data.get("allowed_origins", self.allowed_origins)
                self.allowed_paths = data.get("allowed_paths", self.allowed_paths)
                raw_queue = data.get("queue", list(self.queue))
                self.queue = deque(raw_queue)
                self.queued_urls = {
                    item["url"] for item in self.queue if isinstance(item, dict) and "url" in item
                }
                self.visited = data.get("visited", self.visited)
                self.failed = data.get("failed", self.failed)
                self.robots_cache = data.get("robots_cache", self.robots_cache)
                self.bytes_crawled = data.get("bytes_crawled", self.bytes_crawled)
                self.pages_crawled = data.get("pages_crawled", self.pages_crawled)
                return True
            except Exception as e:
                print(f"Warning: Failed to load state file: {e}")
                return False

    def save(self):
        with self.lock:
            temp_file = f"{self.state_file}.tmp"
            try:
                data = {
                    "allowed_origins": self.allowed_origins,
                    "allowed_paths": self.allowed_paths,
                    "depth_limit": self.depth_limit,
                    "max_pages": self.max_pages,
                    "max_bytes": self.max_bytes,
                    "max_redirects": self.max_redirects,
                    "max_retries": self.max_retries,
                    "concurrency": self.concurrency,
                    "store_bodies": self.store_bodies,
                    "queue": list(self.queue),
                    "visited": self.visited,
                    "failed": self.failed,
                    "robots_cache": self.robots_cache,
                    "bytes_crawled": self.bytes_crawled,
                    "pages_crawled": self.pages_crawled
                }
                os.makedirs(os.path.dirname(os.path.abspath(self.state_file)), exist_ok=True)
                with open(temp_file, 'w', encoding='utf-8') as f:
                    json.dump(data, f, indent=2, ensure_ascii=False)
                os.replace(temp_file, self.state_file)
            except Exception as e:
                print(f"Error: Failed to save state checkpoint: {e}")
                if os.path.exists(temp_file):
                    try:
                        os.remove(temp_file)
                    except Exception:
                        pass

    def get_next_url(self, stop_event):
        with self.lock:
            while True:
                if stop_event.is_set():
                    return None

                if self.pages_crawled >= self.max_pages:
                    return None
                if self.bytes_crawled >= self.max_bytes:
                    return None

                if self.queue:
                    item = self.queue.popleft()
                    self.queued_urls.discard(item["url"])
                    self.active_count += 1
                    return item

                if self.active_count == 0:
                    return None

                self.cond.wait(timeout=0.2)

    def complete_url(self):
        with self.lock:
            self.active_count -= 1
            self.cond.notify_all()

    def add_urls(self, urls, current_depth):
        with self.lock:
            added = False
            for url in urls:
                url = self._normalize_url(url)
                if not url:
                    continue
                if not self._is_allowed(url):
                    continue
                if url in self.visited or url in self.failed:
                    continue
                # O(1) set lookup instead of O(K) linear scan over self.queue
                if url in self.queued_urls:
                    continue
                if current_depth + 1 > self.depth_limit:
                    continue

                self.queue.append({
                    "url": url,
                    "depth": current_depth + 1,
                    "redirect_count": 0
                })
                self.queued_urls.add(url)
                added = True
            if added:
                self.cond.notify_all()

    def add_seed_urls(self, urls):
        with self.lock:
            added = False
            for url in urls:
                url = self._normalize_url(url)
                if not url:
                    continue
                if not self._is_allowed(url):
                    continue
                if url in self.visited or url in self.failed:
                    continue
                # O(1) set lookup instead of O(K) linear scan over self.queue
                if url in self.queued_urls:
                    continue
                self.queue.append({
                    "url": url,
                    "depth": 0,
                    "redirect_count": 0
                })
                self.queued_urls.add(url)
                added = True
            if added:
                self.cond.notify_all()

    def _normalize_url(self, url):
        try:
            parsed = urllib.parse.urlparse(url)
            parsed = parsed._replace(fragment="")
            if parsed.netloc:
                parsed = parsed._replace(netloc=parsed.netloc.lower())
            return parsed.geturl()
        except Exception:
            return None

    def _is_allowed(self, url):
        origin = get_origin(url)
        if origin not in self.allowed_origins:
            return False
        if self.allowed_paths:
            parsed = urllib.parse.urlparse(url)
            path = parsed.path or "/"
            if not any(path.startswith(ap) for ap in self.allowed_paths):
                return False
        return True

class PolitenessManager:
    def __init__(self, default_delay=1.0):
        self.default_delay = default_delay
        self.last_request_times = {}
        self.lock = threading.Lock()

    def wait_if_needed(self, url, custom_delay=None):
        parsed = urllib.parse.urlparse(url)
        host = parsed.netloc.lower()
        if not host:
            return

        delay = custom_delay if custom_delay is not None else self.default_delay
        if delay <= 0:
            return

        with self.lock:
            now = time.time()
            last_time = self.last_request_times.get(host, 0)
            elapsed = now - last_time
            if elapsed < delay:
                sleep_time = delay - elapsed
                time.sleep(sleep_time)
            self.last_request_times[host] = time.time()

class CrawlCollector:
    def __init__(self, state: CrawlState, default_delay=1.0, max_retry_delay=60,
                 user_agent="ResumableCrawlCollector/1.0", ignore_robots=False):
        self.state = state
        self.default_delay = default_delay
        self.max_retry_delay = max_retry_delay
        self.user_agent = user_agent
        self.ignore_robots = ignore_robots
        self.politeness_manager = PolitenessManager(default_delay)
        self.stop_event = threading.Event()
        self.opener = urllib.request.build_opener(NoRedirectHandler)

    def get_robots_parser(self, url):
        if self.ignore_robots:
            return None
        origin = get_origin(url)
        if not origin:
            return None

        with self.state.lock:
            if origin in self.state.robots_cache:
                content = self.state.robots_cache[origin]
                if content is None:
                    return None
                parser = urllib.robotparser.RobotFileParser()
                parser.parse(content.splitlines())
                return parser

        robots_url = f"{origin}/robots.txt"
        self.politeness_manager.wait_if_needed(robots_url)

        content = None
        try:
            req = urllib.request.Request(
                robots_url,
                headers={"User-Agent": self.user_agent}
            )
            with urllib.request.urlopen(req, timeout=10) as response:
                if response.status == 200:
                    content = response.read().decode("utf-8", errors="ignore")
        except urllib.error.HTTPError as e:
            if e.code == 404:
                content = ""
            else:
                content = ""
        except Exception:
            content = ""

        with self.state.lock:
            self.state.robots_cache[origin] = content
            self.state.save()

        if content:
            parser = urllib.robotparser.RobotFileParser()
            parser.parse(content.splitlines())
            return parser
        return None

    def interruptible_sleep(self, seconds):
        start = time.time()
        while time.time() - start < seconds:
            if self.stop_event.is_set():
                return True
            time.sleep(min(0.1, seconds - (time.time() - start)))
        return self.stop_event.is_set()

    def fetch_url(self, url, depth, redirect_count):
        parser = self.get_robots_parser(url)
        if parser and not parser.can_fetch(self.user_agent, url):
            with self.state.lock:
                self.state.failed[url] = {
                    "error": "Disallowed by robots.txt",
                    "timestamp": datetime.now(timezone.utc).isoformat()
                }
                self.state.save()
            return

        robots_delay = parser.crawl_delay(self.user_agent) if parser else None
        delay = max(self.default_delay, robots_delay or 0)

        attempt = 0
        max_retries = self.state.max_retries

        while attempt <= max_retries and not self.stop_event.is_set():
            self.politeness_manager.wait_if_needed(url, custom_delay=delay)
            try:
                req = urllib.request.Request(
                    url,
                    headers={"User-Agent": self.user_agent}
                )
                with self.opener.open(req, timeout=15) as response:
                    status_code = getattr(response, "status", getattr(response, "code", 200))
                    headers = response.headers
                    content_type = headers.get("Content-Type", "")

                    # Read body in chunks with byte limits
                    chunks = []
                    bytes_read = 0
                    while True:
                        with self.state.lock:
                            if self.state.bytes_crawled + bytes_read >= self.state.max_bytes:
                                break
                        chunk = response.read(65536)
                        if not chunk:
                            break
                        chunks.append(chunk)
                        bytes_read += len(chunk)

                    body_bytes = b"".join(chunks)
                    body_hash = hashlib.sha256(body_bytes).hexdigest()

                    # Handle Redirects
                    if status_code in (301, 302, 303, 307, 308):
                        location = headers.get("Location")
                        if location:
                            redirect_url = urllib.parse.urljoin(url, location)
                            with self.state.lock:
                                self.state.visited[url] = {
                                    "status": status_code,
                                    "depth": depth,
                                    "content_type": content_type,
                                    "bytes": len(body_bytes),
                                    "hash": body_hash,
                                    "redirect_to": redirect_url,
                                    "timestamp": datetime.now(timezone.utc).isoformat()
                                }
                                if redirect_count + 1 > self.state.max_redirects:
                                    self.state.failed[redirect_url] = {
                                        "error": f"Redirect limit exceeded ({self.state.max_redirects})",
                                        "timestamp": datetime.now(timezone.utc).isoformat()
                                    }
                                else:
                                    self.state.queue.appendleft({
                                        "url": redirect_url,
                                        "depth": depth,
                                        "redirect_count": redirect_count + 1
                                    })
                                    self.state.queued_urls.add(redirect_url)
                                    self.state.cond.notify_all()
                                self.state.save()
                            return

                    # Normal successful response (or redirect without Location)
                    with self.state.lock:
                        # Check bytes limit before recording
                        if self.state.bytes_crawled >= self.state.max_bytes:
                            return
                        self.state.bytes_crawled += len(body_bytes)
                        self.state.pages_crawled += 1

                        visited_info = {
                            "status": status_code,
                            "depth": depth,
                            "content_type": content_type,
                            "bytes": len(body_bytes),
                            "hash": body_hash,
                            "timestamp": datetime.now(timezone.utc).isoformat()
                        }
                        if self.state.store_bodies:
                            visited_info["body"] = body_bytes.decode("utf-8", errors="replace")

                        self.state.visited[url] = visited_info

                    # Extract links if HTML
                    if "text/html" in content_type:
                        body_str = body_bytes.decode("utf-8", errors="replace")
                        extractor = LinkExtractor()
                        try:
                            extractor.feed(body_str)
                            resolved_links = [
                                urllib.parse.urljoin(url, link) for link in extractor.links
                            ]
                            self.state.add_urls(resolved_links, depth)
                        except Exception as e:
                            print(f"Warning: Failed to parse HTML links from {url}: {e}", file=sys.stderr)

                    with self.state.lock:
                        self.state.save()
                    return

            except urllib.error.HTTPError as e:
                status_code = e.code
                is_transient = (status_code >= 500 or status_code == 429)
                retry_delay = 1.0 * (2 ** attempt)

                retry_after_val = parse_retry_after(e.headers.get("Retry-After"))
                if retry_after_val is not None:
                    retry_delay = retry_after_val

                if not is_transient:
                    with self.state.lock:
                        self.state.failed[url] = {
                            "error": f"HTTP Error {status_code}: {e.reason}",
                            "timestamp": datetime.now(timezone.utc).isoformat(),
                            "retries": attempt
                        }
                        self.state.save()
                    return

                retry_delay = min(retry_delay, self.max_retry_delay)
                attempt += 1
                if attempt > max_retries:
                    with self.state.lock:
                        self.state.failed[url] = {
                            "error": f"Max retries exceeded. Last HTTP Error {status_code}: {e.reason}",
                            "timestamp": datetime.now(timezone.utc).isoformat(),
                            "retries": attempt - 1
                        }
                        self.state.save()
                    return

                print(f"Transient HTTP Error {status_code} fetching {url}. Retrying in {retry_delay:.1f}s (attempt {attempt}/{max_retries})...", file=sys.stderr)
                if self.interruptible_sleep(retry_delay):
                    return

            except Exception as e:
                # Other errors (DNS, connection timeout, etc.) are transient
                retry_delay = 1.0 * (2 ** attempt)
                retry_delay = min(retry_delay, self.max_retry_delay)
                attempt += 1

                if attempt > max_retries:
                    with self.state.lock:
                        self.state.failed[url] = {
                            "error": f"Max retries exceeded. Last connection error: {e}",
                            "timestamp": datetime.now(timezone.utc).isoformat(),
                            "retries": attempt - 1
                        }
                        self.state.save()
                    return

                print(f"Connection error fetching {url}: {e}. Retrying in {retry_delay:.1f}s (attempt {attempt}/{max_retries})...", file=sys.stderr)
                if self.interruptible_sleep(retry_delay):
                    return

    def worker(self):
        while not self.stop_event.is_set():
            item = self.state.get_next_url(self.stop_event)
            if item is None:
                break

            try:
                self.fetch_url(item["url"], item["depth"], item["redirect_count"])
            finally:
                self.state.complete_url()

    def start(self):
        threads = []
        concurrency = max(1, self.state.concurrency)
        for _ in range(concurrency):
            t = threading.Thread(target=self.worker)
            t.daemon = True
            t.start()
            threads.append(t)

        try:
            while any(t.is_alive() for t in threads):
                time.sleep(0.1)
        except KeyboardInterrupt:
            print("\nCtrl-C detected. Stopping crawl gracefully...", file=sys.stderr)
            self.stop_event.set()
            with self.state.lock:
                self.state.cond.notify_all()
            for t in threads:
                t.join(timeout=1.0)
            self.state.save()
            print("Checkpoint saved.", file=sys.stderr)
            # Re-raise to let caller/cli handles it if needed, or simply exit
            raise
        finally:
            self.stop_event.set()
            with self.state.lock:
                self.state.cond.notify_all()
            for t in threads:
                t.join()
            self.state.save()
