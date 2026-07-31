import os
import tempfile
import unittest
import json
import csv
from typing import List, Dict, Any
import sys
# Add the module's directory to the sys.path so we can import 'extractor' directly
sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))

from extractor import (
    clean_json_ld_text,
    is_node,
    check_old_domains,
    parse_html_file,
    write_outputs,
    load_manifest
)


class TestStructuredDataExtractor(unittest.TestCase):

    def test_clean_json_ld_text(self):
        # HTML comment wrapping
        html_comment = "<!-- {\"@context\": \"https://schema.org\"} -->"
        self.assertEqual(clean_json_ld_text(html_comment), "{\"@context\": \"https://schema.org\"}")

        # CDATA wrapper with double-slashes
        cdata_slash = """//<![CDATA[
        {"@type": "WebPage"}
        //]]>"""
        self.assertEqual(clean_json_ld_text(cdata_slash), "{\"@type\": \"WebPage\"}")

        # CDATA wrapper with block comments
        cdata_block = """/* <![CDATA[ */
        {"@type": "NewsArticle"}
        /* ]]> */"""
        self.assertEqual(clean_json_ld_text(cdata_block), "{\"@type\": \"NewsArticle\"}")

    def test_is_node(self):
        # standard node
        self.assertTrue(is_node({"@type": "WebPage", "name": "Test"}))
        # empty dict
        self.assertFalse(is_node({}))
        # pure reference
        self.assertFalse(is_node({"@id": "https://example.com/#ref"}))
        # implicit node (has other keys and is not empty)
        self.assertTrue(is_node({"name": "Implied Node"}))

    def test_check_old_domains(self):
        old_domains = ["old-site.com", "former-brand.org"]

        # Match in simple string
        self.assertTrue(check_old_domains("https://old-site.com/about", old_domains))
        # No match
        self.assertFalse(check_old_domains("https://new-site.com/about", old_domains))
        # Match in list
        self.assertTrue(check_old_domains(["https://new-site.com", "https://former-brand.org/logo.png"], old_domains))
        # Match in nested dict value
        self.assertTrue(check_old_domains({"parent": {"url": "https://old-site.com"}}, old_domains))
        # Match in dict key
        self.assertTrue(check_old_domains({"https://old-site.com": "value"}, old_domains))

    def test_parse_valid_html(self):
        # Locate the fixture relative to this test file
        fixture_dir = os.path.join(os.path.dirname(__file__), "fixtures")
        valid_html_path = os.path.join(fixture_dir, "valid.html")

        results = parse_html_file(valid_html_path, url="https://example.com/valid")

        self.assertEqual(results["provenance_url"], "https://example.com/valid")
        self.assertEqual(results["provenance_file"], valid_html_path)
        self.assertEqual(len(results["errors"]), 0)

        nodes = results["nodes"]
        # Expected:
        # 1. WebPage (block 0, node 0)
        # 2. BreadcrumbList (block 1, node 1)
        # 3. ListItem 1 (block 1, node 2, parent BreadcrumbList)
        # 4. ListItem 2 (block 1, node 3, parent BreadcrumbList)
        # 5. Organization (block 1, node 4)
        self.assertEqual(len(nodes), 5)

        # Test WebPage
        webpage = nodes[0]
        self.assertEqual(webpage["type"], "WebPage")
        self.assertEqual(webpage["id"], "https://example.com/valid")
        self.assertEqual(webpage["parent_id"], None)
        self.assertEqual(webpage["block_index"], 0)

        # Test BreadcrumbList and nested blank nodes
        breadcrumbs = nodes[1]
        self.assertEqual(breadcrumbs["type"], "BreadcrumbList")

        li1 = nodes[2]
        self.assertEqual(li1["type"], "ListItem")
        self.assertEqual(li1["parent_id"], breadcrumbs["id"])
        self.assertTrue(li1["id"].startswith("_:b_"))

        li2 = nodes[3]
        self.assertEqual(li2["type"], "ListItem")
        self.assertEqual(li2["parent_id"], breadcrumbs["id"])
        self.assertTrue(li2["id"].startswith("_:b_"))

    def test_parse_graph_html(self):
        fixture_dir = os.path.join(os.path.dirname(__file__), "fixtures")
        graph_html_path = os.path.join(fixture_dir, "graph.html")

        results = parse_html_file(graph_html_path, url="https://example.com/graph-page")

        self.assertEqual(len(results["errors"]), 0)
        nodes = results["nodes"]
        # Expected flattened entities:
        # 1. WebSite
        # 2. Organization
        # 3. ImageObject (nested inside logo in Organization, parent Organization)
        # 4. WebPage
        self.assertEqual(len(nodes), 4)

        website = next(n for n in nodes if n["type"] == "WebSite")
        org = next(n for n in nodes if n["type"] == "Organization")
        logo = next(n for n in nodes if n["type"] == "ImageObject")
        webpage = next(n for n in nodes if n["type"] == "WebPage")

        self.assertEqual(website["id"], "https://example.com/#website")
        self.assertEqual(org["id"], "https://example.com/#organization")
        self.assertEqual(logo["id"], "https://example.com/#logo")
        self.assertEqual(logo["parent_id"], org["id"])
        self.assertEqual(webpage["id"], "https://example.com/graph-page")

    def test_parse_malformed_html(self):
        fixture_dir = os.path.join(os.path.dirname(__file__), "fixtures")
        malformed_html_path = os.path.join(fixture_dir, "malformed.html")

        results = parse_html_file(
            malformed_html_path,
            url="https://example.com/malformed",
            old_domains=["old-domain.com"]
        )

        # We expect exactly 2 JSON parse errors (blocks 1 and 2 are broken)
        self.assertEqual(len(results["errors"]), 2)
        errors = results["errors"]
        self.assertEqual(errors[0]["block_index"], 1)
        self.assertEqual(errors[1]["block_index"], 2)

        nodes = results["nodes"]
        # Expected successfully extracted nodes:
        # 0. WebPage
        # 1. Object with no type (missing_type finding)
        # 2. WebPage with duplicate id (duplicate_id finding)
        # 3. Product on old-domain.com (old_domain_reference finding)
        self.assertEqual(len(nodes), 4)

        # Node with missing type
        missing_type_node = nodes[1]
        self.assertIn("missing_type", missing_type_node["findings"])
        self.assertIsNone(missing_type_node["type"])

        # Node with duplicate ID
        dup_node = nodes[2]
        self.assertIn("duplicate_id", dup_node["findings"])
        self.assertEqual(dup_node["id"], "https://example.com/malformed")

        # Node with old domain
        old_node = nodes[3]
        self.assertIn("old_domain_reference", old_node["findings"])
        self.assertEqual(old_node["id"], "https://old-domain.com/product-1")

    def test_load_manifest_and_output_generation(self):
        fixture_dir = os.path.join(os.path.dirname(__file__), "fixtures")
        manifest_path = os.path.join(fixture_dir, "manifest.json")

        entries = load_manifest(manifest_path)
        self.assertEqual(len(entries), 3)
        self.assertEqual(entries[0]["url"], "https://example.com/valid")
        self.assertTrue(os.path.isabs(entries[0]["file"]))

        # Parse files from manifest
        results = []
        for entry in entries:
            results.append(parse_html_file(entry["file"], entry["url"], ["old-domain.com"]))

        with tempfile.TemporaryDirectory() as tmp_dir:
            json_file, csv_file = write_outputs(results, tmp_dir)

            # Verify JSON output
            self.assertTrue(os.path.exists(json_file))
            with open(json_file, "r", encoding="utf-8") as f:
                data = json.load(f)

            self.assertEqual(data["summary"]["total_pages"], 3)
            self.assertEqual(data["summary"]["total_nodes"], 13)
            self.assertEqual(data["summary"]["total_errors"], 2)
            self.assertEqual(data["summary"]["total_findings"], 3)

            # Verify CSV output
            self.assertTrue(os.path.exists(csv_file))
            with open(csv_file, "r", encoding="utf-8") as f:
                reader = csv.DictReader(f)
                rows = list(reader)

            self.assertEqual(len(rows), 13)
            # Ensure headers are accurate and robust
            expected_headers = [
                "provenance_url",
                "provenance_file",
                "block_index",
                "node_index",
                "id",
                "type",
                "parent_id",
                "findings",
                "properties_json"
            ]
            self.assertEqual(reader.fieldnames, expected_headers)

            # Spot check duplicate_id finding in CSV rows
            dup_rows = [r for r in rows if "duplicate_id" in r["findings"]]
            self.assertEqual(len(dup_rows), 1)
            self.assertEqual(dup_rows[0]["id"], "https://example.com/malformed")


if __name__ == "__main__":
    unittest.main()
