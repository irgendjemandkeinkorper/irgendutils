import unittest
from pathlib import Path
import json
import csv
import shutil

from src.normalizer import normalize_url_to_path, parse_wp_suffix
from src.parser import parse_wxr, parse_json, extract_from_html
from src.classifier import ReconciliationEngine
from src.exporter import export_reports

class TestReconciler(unittest.TestCase):
    def setUp(self):
        self.fixtures_dir = Path(__file__).parent / "fixtures"
        self.uploads_dir = self.fixtures_dir / "uploads"
        self.wxr_path = self.fixtures_dir / "export.xml"
        self.json_path = self.fixtures_dir / "attachment.json"
        self.output_dir = self.fixtures_dir / "reports"

    def tearDown(self):
        # Safe cleanup of generated reports in tests directory
        if self.output_dir.exists():
            shutil.rmtree(self.output_dir)

    def test_normalize_url_to_path(self):
        self.assertEqual(
            normalize_url_to_path("https://site.com/wp-content/uploads/2023/01/img.jpg"),
            "2023/01/img.jpg"
        )
        self.assertEqual(
            normalize_url_to_path("/wp-content/uploads/2023/01/img%20with%20spaces.jpg"),
            "2023/01/img with spaces.jpg"
        )
        self.assertEqual(
            normalize_url_to_path("2023/01/img.jpg?v=2"),
            "2023/01/img.jpg"
        )
        self.assertEqual(
            normalize_url_to_path("http://oldsite.com/wp-content/uploads/2023/01/img.jpg", old_url="http://oldsite.com/wp-content/uploads"),
            "2023/01/img.jpg"
        )

    def test_parse_wp_suffix(self):
        self.assertEqual(
            parse_wp_suffix("2023/01/image-150x150.jpg"),
            ("2023/01/image.jpg", "150x150")
        )
        self.assertEqual(
            parse_wp_suffix("2023/01/image.jpg"),
            ("2023/01/image.jpg", None)
        )
        self.assertEqual(
            parse_wp_suffix("2023/01/canvas-800x600.png.webp"),
            ("2023/01/canvas.png.webp", "800x600")
        )

    def test_extract_from_html(self):
        html = """
        <p>Hello world</p>
        <img src="http://oldsite.com/wp-content/uploads/2023/01/test.jpg" srcset="http://oldsite.com/wp-content/uploads/2023/01/test-150x150.jpg 150w" />
        <a href="http://oldsite.com/wp-content/uploads/2023/01/doc.pdf">Download</a>
        <div style="background-image: url('http://oldsite.com/wp-content/uploads/2023/01/bg.png');"></div>
        """
        refs = extract_from_html(html, "test_source")
        normalized_paths = [r.normalized_path for r in refs]
        self.assertIn("2023/01/test.jpg", normalized_paths)
        self.assertIn("2023/01/test-150x150.jpg", normalized_paths)
        self.assertIn("2023/01/doc.pdf", normalized_paths)
        self.assertIn("2023/01/bg.png", normalized_paths)

    def test_parse_wxr(self):
        refs, attachments = parse_wxr(self.wxr_path, old_url="http://oldsite.com/wp-content/uploads")
        self.assertIn(101, attachments)
        self.assertEqual(attachments[101], "2023/01/image1.jpg")

        normalized_paths = [r.normalized_path for r in refs]
        self.assertIn("2023/01/image1.jpg", normalized_paths)
        self.assertIn("2023/01/image1-150x150.jpg", normalized_paths)
        self.assertIn("2023/01/image1-300x200.jpg", normalized_paths)
        self.assertIn("2023/01/missing-parent.jpg", normalized_paths)
        # Check case mismatch
        self.assertIn("2023/02/Image2.png", normalized_paths)

    def test_parse_json(self):
        refs = parse_json(self.json_path)
        normalized_paths = [r.normalized_path for r in refs]
        self.assertIn("2023/02/collision.jpg", normalized_paths)

    def test_full_reconciliation(self):
        engine = ReconciliationEngine(
            uploads_dir=self.uploads_dir,
            old_url="http://oldsite.com/wp-content/uploads"
        )
        engine.build_disk_inventory()

        # Verify physical disk scan
        self.assertEqual(len(engine.all_files_on_disk), 8)
        self.assertIn("2023/01/image1.jpg", engine.all_files_on_disk)
        self.assertIn("2023/01/image1-150x150.jpg", engine.all_files_on_disk)
        self.assertIn("2023/01/broken-150x150.jpg", engine.all_files_on_disk)

        # Parse XML references
        refs, attachments = parse_wxr(self.wxr_path, old_url="http://oldsite.com/wp-content/uploads")

        # Parse JSON references
        json_refs = parse_json(self.json_path)
        refs.extend(json_refs)

        # Run reconciliation
        results = engine.reconcile(refs, attachments)
        summary = results["summary"]

        # Print summary for debug during test run
        print("\nTest Summary results:", summary)

        # Check Summary
        self.assertEqual(summary["total_files_on_disk"], 8)

        # 1. Referenced & Present
        # Used: image1.jpg (exact), image1-150x150.jpg (assoc/exact), image1-300x200.jpg (assoc/exact),
        # image2.png (case conflict, exact present is image2.png), and collision.jpg in 2023/02 (referenced via JSON)
        self.assertEqual(summary["total_referenced_and_present"], 5)

        # 2. Missing Files
        # Referenced in content but missing: missing-parent.jpg, and the unresolved attachment ID 102 (from JSON if any, or general)
        # Actually missing parent is "2023/01/missing-parent.jpg".
        self.assertTrue(any(item["referenced_path"] == "2023/01/missing-parent.jpg" for item in results["missing_files"]))

        # 3. Unused Candidates
        # Files on disk but not referenced:
        # - orphan.png (2024/05/orphan.png)
        # - collision.jpg in 2023/01 (the one in 2023/02 is used, but 2023/01/collision.jpg is unused)
        # - broken-150x150.jpg (present on disk but parent missing and not referenced)
        # So unused candidates should be 3
        self.assertEqual(summary["total_unused_candidates"], 3)
        unused_paths = [item["file_path"] for item in results["unused_candidates"]]
        self.assertIn("2024/05/orphan.png", unused_paths)
        self.assertIn("2023/01/collision.jpg", unused_paths)
        self.assertIn("2023/01/broken-150x150.jpg", unused_paths)

        # Core Rule Assertion: Parent referenced means derived thumbnails are NOT unused!
        # image1-150x150.jpg and image1-300x200.jpg should NOT be in unused_candidates!
        self.assertNotIn("2023/01/image1-150x150.jpg", unused_paths)
        self.assertNotIn("2023/01/image1-300x200.jpg", unused_paths)

        # 4. Broken Derivatives
        # broken-150x150.jpg on disk, but its parent broken.jpg is missing from disk!
        self.assertEqual(summary["total_broken_derivatives"], 1)
        self.assertEqual(results["broken_derivatives"][0]["file_path"], "2023/01/broken-150x150.jpg")
        self.assertEqual(results["broken_derivatives"][0]["parent_path"], "2023/01/broken.jpg")

        # 5. Filename Collisions
        # collision.jpg exists in 2023/01/collision.jpg and 2023/02/collision.jpg
        self.assertEqual(summary["total_collisions"], 1)
        self.assertEqual(results["collisions"][0]["filename"], "collision.jpg")
        self.assertIn("2023/01/collision.jpg", results["collisions"][0]["matching_paths"])
        self.assertIn("2023/02/collision.jpg", results["collisions"][0]["matching_paths"])

        # Test Export
        export_reports(results, self.output_dir)
        self.assertTrue((self.output_dir / "reconciliation_summary.json").exists())
        self.assertTrue((self.output_dir / "missing_files.csv").exists())
        self.assertTrue((self.output_dir / "unused_candidates.csv").exists())
        self.assertTrue((self.output_dir / "broken_derivatives.csv").exists())
        self.assertTrue((self.output_dir / "collisions.csv").exists())


if __name__ == "__main__":
    unittest.main()
