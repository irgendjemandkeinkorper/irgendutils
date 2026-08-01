import unittest
import os
import tempfile
import json
import shutil
import sys
from unittest.mock import patch

# Add the 'migration-metadata-compare' directory to path to enable clean imports
sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))

from src.compare import (
    normalize_whitespace,
    normalize_url,
    normalize_robots,
    normalize_schema_types,
    normalize_language,
    normalize_h1,
    ComparisonRunner,
    Finding
)
from src.parser import (
    parse_crawl_file,
    parse_url_mapping
)
from src.report import TerminalReporter, JSONReporter, HTMLReporter
from src.cli import parse_args, main


class TestNormalizers(unittest.TestCase):
    def test_normalize_whitespace(self):
        self.assertEqual(normalize_whitespace("  hello   world  "), "hello world")
        self.assertEqual(normalize_whitespace("hello\n\t world"), "hello world")
        self.assertEqual(normalize_whitespace(None), "")

    def test_normalize_url(self):
        self.assertEqual(normalize_url("https://example.com/about/"), "/about")
        self.assertEqual(normalize_url("http://legacy.org/blog?utm=abc&p=1"), "/blog?p=1&utm=abc")
        self.assertEqual(normalize_url("/path/to/page/"), "/path/to/page")
        self.assertEqual(normalize_url(""), "")
        self.assertEqual(normalize_url(None), "")

    def test_normalize_robots(self):
        self.assertEqual(normalize_robots("noindex, follow"), "follow, noindex")
        self.assertEqual(normalize_robots("INDEX,  FOLLOW"), "follow, index")
        self.assertEqual(normalize_robots(""), "")

    def test_normalize_schema_types(self):
        self.assertEqual(normalize_schema_types("WebSite, Article"), "Article, WebSite")
        # JSON-LD array
        self.assertEqual(normalize_schema_types('["WebPage", "Article"]'), "Article, WebPage")
        # Complex JSON-LD object
        self.assertEqual(
            normalize_schema_types('{"@type": "NewsArticle", "publisher": {"@type": "Organization"}}'),
            "NewsArticle, Organization"
        )
        self.assertEqual(normalize_schema_types(""), "")

    def test_normalize_language(self):
        self.assertEqual(normalize_language("en_US"), "en-us")
        self.assertEqual(normalize_language("  EN-us  "), "en-us")
        self.assertEqual(normalize_language(""), "")

    def test_normalize_h1(self):
        self.assertEqual(normalize_h1("  Welcome   to the site  "), "Welcome to the site")
        self.assertEqual(normalize_h1('["H1 Part 1", "H1 Part 2"]'), "H1 Part 1 | H1 Part 2")
        self.assertEqual(normalize_h1("Part 1\nPart 2"), "Part 1 | Part 2")


class TestParsers(unittest.TestCase):
    def setUp(self):
        self.temp_dir = tempfile.mkdtemp()

    def tearDown(self):
        shutil.rmtree(self.temp_dir)

    def test_parse_csv_crawl(self):
        csv_path = os.path.join(self.temp_dir, "crawl.csv")
        with open(csv_path, "w", encoding="utf-8") as f:
            f.write("URL,status_code,Title,Description,canonical_url\n")
            f.write("http://site.com/,200,My Title,My Desc,http://site.com/\n")
            f.write("http://site.com/sub,404,Not Found,,\n")

        parsed = parse_crawl_file(csv_path)
        self.assertEqual(len(parsed), 2)
        self.assertEqual(parsed[0]["url"], "http://site.com/")
        self.assertEqual(parsed[0]["status"], "200")
        self.assertEqual(parsed[0]["title"], "My Title")
        self.assertEqual(parsed[0]["description"], "My Desc")
        self.assertEqual(parsed[0]["canonical"], "http://site.com/")

        self.assertEqual(parsed[1]["url"], "http://site.com/sub")
        self.assertEqual(parsed[1]["status"], "404")

    def test_parse_jsonl_crawl(self):
        jsonl_path = os.path.join(self.temp_dir, "crawl.jsonl")
        with open(jsonl_path, "w", encoding="utf-8") as f:
            f.write('{"address": "http://site.com/", "status": 200, "page_title": "JSONL Title"}\n')
            f.write('{"address": "http://site.com/about", "status": 404}\n')

        parsed = parse_crawl_file(jsonl_path)
        self.assertEqual(len(parsed), 2)
        self.assertEqual(parsed[0]["url"], "http://site.com/")
        self.assertEqual(parsed[0]["status"], "200")
        self.assertEqual(parsed[0]["title"], "JSONL Title")

    def test_parse_url_mapping_csv(self):
        map_path = os.path.join(self.temp_dir, "map.csv")
        # With headers
        with open(map_path, "w", encoding="utf-8") as f:
            f.write("from,to\n")
            f.write("http://old.com/a,https://new.com/b\n")

        pairs = parse_url_mapping(map_path)
        self.assertEqual(pairs, [("http://old.com/a", "https://new.com/b")])

        # Without headers (headerless sniffing)
        with open(map_path, "w", encoding="utf-8") as f:
            f.write("http://old.com/first,https://new.com/first\n")
            f.write("http://old.com/second,https://new.com/second\n")

        pairs = parse_url_mapping(map_path)
        self.assertEqual(pairs, [
            ("http://old.com/first", "https://new.com/first"),
            ("http://old.com/second", "https://new.com/second")
        ])

    def test_parse_url_mapping_json(self):
        # Dictionary format
        map_path = os.path.join(self.temp_dir, "map.json")
        with open(map_path, "w", encoding="utf-8") as f:
            f.write(json.dumps({"http://old.com/1": "https://new.com/1"}))

        pairs = parse_url_mapping(map_path)
        self.assertEqual(pairs, [("http://old.com/1", "https://new.com/1")])

        # Array of objects format
        with open(map_path, "w", encoding="utf-8") as f:
            f.write(json.dumps([{"source": "http://old.com/2", "destination": "https://new.com/2"}]))

        pairs = parse_url_mapping(map_path)
        self.assertEqual(pairs, [("http://old.com/2", "https://new.com/2")])


class TestComparisonRunner(unittest.TestCase):
    def test_duplicates_and_missing_mappings(self):
        before = [
            {"url": "http://old.com/a", "status": 200},
            {"url": "http://old.com/a", "status": 200},  # Duplicate
            {"url": "http://old.com/unmapped", "status": 200}
        ]
        after = [
            {"url": "https://new.com/a", "status": 200},
            {"url": "https://new.com/new-page", "status": 200}
        ]
        mapping = [("http://old.com/a", "https://new.com/a")]

        runner = ComparisonRunner(fallback_path_match=False)
        findings = runner.compare(before, after, mapping)

        duplicates = [f for f in findings if f.field == "duplicate"]
        self.assertEqual(len(duplicates), 1)
        self.assertEqual(duplicates[0].url_before, "http://old.com/a")

        mappings = [f for f in findings if f.field == "mapping"]
        # Expected mapping issues:
        # - http://old.com/unmapped is unmapped
        # - https://new.com/new-page has no legacy mapping to it
        self.assertEqual(len(mappings), 2)

        unmapped_legacy = [f for f in mappings if f.url_before == "http://old.com/unmapped"]
        self.assertEqual(len(unmapped_legacy), 1)

        unmapped_migrated = [f for f in mappings if f.url_after == "https://new.com/new-page"]
        self.assertEqual(len(unmapped_migrated), 1)

    def test_fallback_path_matching(self):
        before = [
            {"url": "http://old.com/same-path", "status": 200, "title": "Old Same"}
        ]
        after = [
            {"url": "https://new.com/same-path", "status": 200, "title": "New Same"}
        ]

        # No mapping, fallback path match enabled (default)
        runner = ComparisonRunner(fallback_path_match=True)
        findings = runner.compare(before, after, None)

        # It should successfully pair them and check the title
        title_findings = [f for f in findings if f.field == "title"]
        self.assertEqual(len(title_findings), 1)
        self.assertEqual(title_findings[0].url_before, "http://old.com/same-path")
        self.assertEqual(title_findings[0].url_after, "https://new.com/same-path")
        self.assertEqual(title_findings[0].before, "Old Same")
        self.assertEqual(title_findings[0].after, "New Same")

        # Fallback path match disabled
        runner_no_fallback = ComparisonRunner(fallback_path_match=False)
        findings_no_fallback = runner_no_fallback.compare(before, after, None)

        # Should only report mapping findings
        mapping_findings = [f for f in findings_no_fallback if f.field == "mapping"]
        self.assertEqual(len(mapping_findings), 2)
        title_findings_no_fallback = [f for f in findings_no_fallback if f.field == "title"]
        self.assertEqual(len(title_findings_no_fallback), 0)

    def test_field_comparisons_and_severity(self):
        before = [
            {"url": "http://old.com/a", "status": 200, "title": "Old Title", "robots": "index, follow", "language": "en"}
        ]
        after = [
            {"url": "https://new.com/a", "status": 404, "title": "New Title", "robots": "INDEX, FOLLOW", "language": "en-US"}
        ]
        mapping = [("http://old.com/a", "https://new.com/a")]

        runner = ComparisonRunner(policy={"title": "warning", "language": "ignore"})
        findings = runner.compare(before, after, mapping)

        # status differs: 200 vs 404 -> error (default)
        status_f = [f for f in findings if f.field == "status"]
        self.assertEqual(len(status_f), 1)
        self.assertEqual(status_f[0].severity, "error")

        # title differs: Old vs New -> warning (overridden)
        title_f = [f for f in findings if f.field == "title"]
        self.assertEqual(len(title_f), 1)
        self.assertEqual(title_f[0].severity, "warning")

        # robots: index, follow matches INDEX, FOLLOW -> no finding
        robots_f = [f for f in findings if f.field == "robots"]
        self.assertEqual(len(robots_f), 0)

        # language differs: en vs en-us -> should be ignored
        language_f = [f for f in findings if f.field == "language"]
        self.assertEqual(len(language_f), 0)


class TestReporters(unittest.TestCase):
    def test_terminal_reporter(self):
        findings = [
            Finding("http://old.com", "https://new.com", "title", "Old", "New", "error")
        ]
        summary = {
            "total_pages_before": 1,
            "total_pages_after": 1,
            "total_findings": 1,
            "severity_counts": {"error": 1}
        }
        reporter = TerminalReporter(use_color=False)
        output = reporter.generate(findings, "before.csv", "after.jsonl", summary)
        self.assertIn("Pages in Before Crawl: 1", output)
        self.assertIn("[ERROR] title:", output)
        self.assertIn("Before: Old", output)
        self.assertIn("After:  New", output)

    def test_json_reporter(self):
        findings = [
            Finding("http://old.com", "https://new.com", "title", "Old", "New", "error")
        ]
        summary = {
            "total_pages_before": 1,
            "total_pages_after": 1,
            "total_findings": 1,
            "severity_counts": {"error": 1}
        }
        output = JSONReporter.generate(findings, "before.csv", "after.jsonl", "map.csv", summary)
        data = json.loads(output)
        self.assertEqual(data["summary"]["total_findings"], 1)
        self.assertEqual(data["findings"][0]["field"], "title")
        self.assertEqual(data["findings"][0]["severity"], "error")

    def test_html_reporter(self):
        findings = [
            Finding("http://old.com", "https://new.com", "title", "Old", "New", "error")
        ]
        summary = {
            "total_pages_before": 1,
            "total_pages_after": 1,
            "total_findings": 1,
            "severity_counts": {"error": 1}
        }
        output = HTMLReporter.generate(findings, "before.csv", "after.jsonl", "map.csv", summary)
        self.assertIn("<!DOCTYPE html>", output)
        self.assertIn("Migration Metadata Comparison Report", output)
        # Ensure findings are embedded
        self.assertIn('"url_before": "http://old.com"', output)


class TestCLI(unittest.TestCase):
    def test_parse_args(self):
        args = parse_args(["-b", "b.csv", "-a", "a.jsonl", "-m", "m.csv", "--fail-on-severity", "warning"])
        self.assertEqual(args.before, "b.csv")
        self.assertEqual(args.after, "a.jsonl")
        self.assertEqual(args.mapping, "m.csv")
        self.assertEqual(args.fail_on_severity, "warning")

    @patch("sys.exit")
    def test_main_missing_files(self, mock_exit):
        # Patch sys.argv
        with patch("sys.argv", ["cli.py", "-b", "nonexistent.csv", "-a", "nonexistent.jsonl"]):
            main()
            mock_exit.assert_called_with(2)
