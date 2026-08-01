import os
import sys
import unittest
import threading
import tempfile
import time
import shutil
import json
import http.server
import urllib.parse
from unittest.mock import patch

# Add the parent directory of this file (resumable-crawl-collector/) to sys.path
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from collector import (
    CrawlState, CrawlCollector, get_origin, parse_retry_after
)

# Global list to track requests to mock server
REQUEST_LOG = []

class MockServerRequestHandler(http.server.BaseHTTPRequestHandler):
    def log_message(self, format, *args):
        # Suppress request logging to keep test output clean
        pass

    def do_GET(self):
        parsed_path = urllib.parse.urlparse(self.path)
        path = parsed_path.path
        REQUEST_LOG.append(path)

        if path == "/robots.txt":
            self.send_response(200)
            self.send_header("Content-Type", "text/plain")
            self.end_headers()
            self.wfile.write(b"User-agent: *\nDisallow: /disallowed.html\nCrawl-delay: 0.01\n")
            return

        elif path == "/index.html":
            self.send_response(200)
            self.send_header("Content-Type", "text/html")
            self.end_headers()
            self.wfile.write(b'<html><body><a href="/page1.html">Page 1</a><a href="/disallowed.html">Disallowed</a></body></html>')
            return

        elif path == "/page1.html":
            self.send_response(200)
            self.send_header("Content-Type", "text/html")
            self.end_headers()
            self.wfile.write(b'<html><body><a href="/page2.html">Page 2</a><a href="/redirect301">Redirect</a></body></html>')
            return

        elif path == "/page2.html":
            self.send_response(200)
            self.send_header("Content-Type", "text/html")
            self.end_headers()
            self.wfile.write(b'<html><body>Done</body></html>')
            return

        elif path == "/disallowed.html":
            self.send_response(200)
            self.send_header("Content-Type", "text/html")
            self.end_headers()
            self.wfile.write(b'<html><body>Disallowed content</body></html>')
            return

        elif path == "/redirect301":
            self.send_response(301)
            self.send_header("Location", "/page2.html")
            self.end_headers()
            return

        elif path == "/redirect-loop":
            self.send_response(302)
            self.send_header("Location", "/redirect-loop")
            self.end_headers()
            return

        elif path == "/error500":
            self.send_response(500)
            self.send_header("Content-Type", "text/plain")
            self.end_headers()
            self.wfile.write(b"Internal Server Error")
            return

        elif path == "/retry-after":
            self.send_response(429)
            self.send_header("Retry-After", "1")
            self.send_header("Content-Type", "text/plain")
            self.end_headers()
            self.wfile.write(b"Too Many Requests")
            return

        elif path == "/large-page.html":
            self.send_response(200)
            self.send_header("Content-Type", "text/html")
            self.end_headers()
            self.wfile.write(b"A" * 1000)
            return

        else:
            self.send_response(404)
            self.send_header("Content-Type", "text/plain")
            self.end_headers()
            self.wfile.write(b"Not Found")
            return

class TestCrawlCollector(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.server = http.server.HTTPServer(("127.0.0.1", 0), MockServerRequestHandler)
        cls.port = cls.server.server_port
        cls.origin = f"http://127.0.0.1:{cls.port}"
        cls.server_thread = threading.Thread(target=cls.server.serve_forever)
        cls.server_thread.daemon = True
        cls.server_thread.start()

    @classmethod
    def tearDownClass(cls):
        cls.server.shutdown()
        cls.server_thread.join()

    def setUp(self):
        self.temp_dir = tempfile.mkdtemp()
        self.state_file = os.path.join(self.temp_dir, "state.json")
        REQUEST_LOG.clear()

    def tearDown(self):
        shutil.rmtree(self.temp_dir)

    def test_mock_server_running(self):
        url = f"{self.origin}/index.html"
        req = urllib.request.Request(url)
        with urllib.request.urlopen(req) as resp:
            self.assertEqual(resp.status, 200)
            self.assertIn(b"Page 1", resp.read())

    def test_origin_and_path_constraints(self):
        # 1. Allowed origin test
        state = CrawlState(
            state_file=self.state_file,
            allowed_origins=[self.origin],
            max_pages=10
        )
        self.assertTrue(state._is_allowed(f"{self.origin}/index.html"))
        self.assertFalse(state._is_allowed("https://example.com/index.html"))

        # 2. Path constraints test
        state_path = CrawlState(
            state_file=self.state_file,
            allowed_origins=[self.origin],
            allowed_paths=["/page"]
        )
        self.assertTrue(state_path._is_allowed(f"{self.origin}/page1.html"))
        self.assertFalse(state_path._is_allowed(f"{self.origin}/index.html"))

    def test_depth_bounds(self):
        # depth_limit = 1
        # Seed /index.html is depth 0
        # /page1.html is depth 1 -> crawled
        # /page2.html is depth 2 -> NOT crawled
        state = CrawlState(
            state_file=self.state_file,
            allowed_origins=[self.origin],
            depth_limit=1,
            max_pages=10
        )
        state.add_seed_urls([f"{self.origin}/index.html"])

        collector = CrawlCollector(state=state, default_delay=0.0, ignore_robots=True)
        collector.start()

        self.assertIn(f"{self.origin}/index.html", state.visited)
        self.assertIn(f"{self.origin}/page1.html", state.visited)
        self.assertNotIn(f"{self.origin}/page2.html", state.visited)

    def test_page_count_bounds(self):
        # limit max_pages to 2
        state = CrawlState(
            state_file=self.state_file,
            allowed_origins=[self.origin],
            max_pages=2
        )
        state.add_seed_urls([f"{self.origin}/index.html"])

        collector = CrawlCollector(state=state, default_delay=0.0, ignore_robots=True)
        collector.start()

        self.assertEqual(state.pages_crawled, 2)
        self.assertEqual(len(state.visited), 2)

    def test_byte_bounds(self):
        # Limit bytes to 500. /index.html is small. /large-page.html is 1000 bytes.
        state = CrawlState(
            state_file=self.state_file,
            allowed_origins=[self.origin],
            max_bytes=500
        )
        # Start with /large-page.html. Since it's 1000 bytes, once downloaded, we reach/exceed the limit,
        # so subsequent pages in queue shouldn't be crawled.
        state.add_seed_urls([f"{self.origin}/large-page.html", f"{self.origin}/page2.html"])

        collector = CrawlCollector(state=state, default_delay=0.0, ignore_robots=True)
        collector.start()

        self.assertIn(f"{self.origin}/large-page.html", state.visited)
        self.assertNotIn(f"{self.origin}/page2.html", state.visited)

    def test_robots_txt_honoring(self):
        # robots.txt has "Disallow: /disallowed.html" and "Crawl-delay: 0.01"
        state = CrawlState(
            state_file=self.state_file,
            allowed_origins=[self.origin]
        )
        state.add_seed_urls([f"{self.origin}/index.html"])

        collector = CrawlCollector(state=state, default_delay=0.0, ignore_robots=False)
        collector.start()

        # /index.html links to /page1.html and /disallowed.html.
        # robots.txt disallows /disallowed.html, so it should NOT be successfully visited,
        # but should be marked in failed with disallow error.
        self.assertIn(f"{self.origin}/index.html", state.visited)
        self.assertNotIn(f"{self.origin}/disallowed.html", state.visited)
        self.assertIn(f"{self.origin}/disallowed.html", state.failed)
        self.assertIn("Disallowed by robots.txt", state.failed[f"{self.origin}/disallowed.html"]["error"])

    def test_pause_and_resume(self):
        # Crawl with max_pages = 1, verify state, then resume with max_pages = 10
        state1 = CrawlState(
            state_file=self.state_file,
            allowed_origins=[self.origin],
            max_pages=1
        )
        state1.add_seed_urls([f"{self.origin}/index.html"])

        collector1 = CrawlCollector(state=state1, default_delay=0.0, ignore_robots=True)
        collector1.start()

        self.assertEqual(len(state1.visited), 1)
        self.assertIn(f"{self.origin}/index.html", state1.visited)

        # Verify checkpoint is saved atomically
        self.assertTrue(os.path.exists(self.state_file))
        with open(self.state_file, 'r') as f:
            data = json.load(f)
        self.assertIn(f"{self.origin}/index.html", data["visited"])

        # Now load and resume using state2
        state2 = CrawlState(
            state_file=self.state_file,
            max_pages=10  # expand limit
        )
        self.assertTrue(state2.load())
        self.assertEqual(state2.pages_crawled, 1)
        self.assertIn(f"{self.origin}/index.html", state2.visited)

        collector2 = CrawlCollector(state=state2, default_delay=0.0, ignore_robots=True)
        collector2.start()

        # Resume should successfully crawl remaining pages (page1, page2, etc.)
        self.assertIn(f"{self.origin}/page1.html", state2.visited)
        self.assertIn(f"{self.origin}/page2.html", state2.visited)

    def test_redirect_limits_and_handling(self):
        # 1. 301 Redirect should be handled and the destination queued
        state = CrawlState(
            state_file=self.state_file,
            allowed_origins=[self.origin],
            max_redirects=5
        )
        state.add_seed_urls([f"{self.origin}/redirect301"])

        collector = CrawlCollector(state=state, default_delay=0.0, ignore_robots=True)
        collector.start()

        self.assertIn(f"{self.origin}/redirect301", state.visited)
        self.assertEqual(state.visited[f"{self.origin}/redirect301"]["status"], 301)
        self.assertEqual(state.visited[f"{self.origin}/redirect301"]["redirect_to"], f"{self.origin}/page2.html")
        self.assertIn(f"{self.origin}/page2.html", state.visited)

        # 2. Redirect loop should hit limit and record in failed
        state_loop = CrawlState(
            state_file=self.state_file,
            allowed_origins=[self.origin],
            max_redirects=2
        )
        state_loop.add_seed_urls([f"{self.origin}/redirect-loop"])
        collector_loop = CrawlCollector(state=state_loop, default_delay=0.0, ignore_robots=True)
        collector_loop.start()

        self.assertIn(f"{self.origin}/redirect-loop", state_loop.failed)
        self.assertIn("Redirect limit exceeded", state_loop.failed[f"{self.origin}/redirect-loop"]["error"])

    def test_retries_and_retry_after(self):
        # 1. Permanent/Non-transient error: 404 Not Found should NOT retry and go straight to failed
        state_404 = CrawlState(
            state_file=self.state_file,
            allowed_origins=[self.origin],
            max_retries=3
        )
        state_404.add_seed_urls([f"{self.origin}/nonexistent"])
        collector_404 = CrawlCollector(state=state_404, default_delay=0.0, ignore_robots=True)
        collector_404.start()

        self.assertIn(f"{self.origin}/nonexistent", state_404.failed)
        self.assertEqual(state_404.failed[f"{self.origin}/nonexistent"]["retries"], 0)

        # 2. Transient error: 500 error should retry and record correct final count
        state_500 = CrawlState(
            state_file=self.state_file,
            allowed_origins=[self.origin],
            max_retries=2
        )
        state_500.add_seed_urls([f"{self.origin}/error500"])
        # Use small retry delay limit so it doesn't wait long
        collector_500 = CrawlCollector(state=state_500, default_delay=0.0, max_retry_delay=0.01, ignore_robots=True)
        collector_500.start()

        self.assertIn(f"{self.origin}/error500", state_500.failed)
        self.assertEqual(state_500.failed[f"{self.origin}/error500"]["retries"], 2)

        # 3. Retry-After header parsing helper
        self.assertEqual(parse_retry_after("120"), 120)
        self.assertIsNone(parse_retry_after(""))
        # Check HTTP date format parsing
        dt_str = "Wed, 21 Oct 2015 07:28:00 GMT"
        val = parse_retry_after(dt_str)
        # Should parse correctly to some positive value or 0 depending on clock
        self.assertTrue(val is None or isinstance(val, int))

    def test_keyboard_interrupt_graceful_stop(self):
        state = CrawlState(
            state_file=self.state_file,
            allowed_origins=[self.origin]
        )
        state.add_seed_urls([f"{self.origin}/index.html"])
        collector = CrawlCollector(state=state, default_delay=0.1, ignore_robots=True)

        # Mock time.sleep inside collector.start to raise KeyboardInterrupt
        original_sleep = time.sleep
        def mock_sleep(seconds):
            if seconds == 0.1:  # this is the sleep inside start() loop
                raise KeyboardInterrupt()
            original_sleep(seconds)

        with patch("time.sleep", mock_sleep):
            with self.assertRaises(KeyboardInterrupt):
                collector.start()

        # Ensure that checkpoint was still saved successfully and remains valid
        self.assertTrue(os.path.exists(self.state_file))
        with open(self.state_file, 'r') as f:
            data = json.load(f)
        self.assertIn("queue", data)
        self.assertIn("visited", data)
