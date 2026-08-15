import os
import sys
import json
import unittest
import tempfile
from analyzer.cli import main

class TestCLI(unittest.TestCase):
    def setUp(self):
        self.temp_dir = tempfile.TemporaryDirectory()
        self.root_dir = self.temp_dir.name

        # Create small test directories
        self.scan_target_dir = os.path.join(self.root_dir, "target")
        os.makedirs(self.scan_target_dir, exist_ok=True)

        self.test_file = os.path.join(self.scan_target_dir, "doc.txt")
        with open(self.test_file, "w") as f:
            f.write("hello world")

        self.snap1_path = os.path.join(self.root_dir, "snap1.jsonl")
        self.snap2_path = os.path.join(self.root_dir, "snap2.jsonl")

    def tearDown(self):
        self.temp_dir.cleanup()

    def test_cli_scan_and_diff(self):
        # 1. Test CLI SCAN (should exit with 0)
        ret_scan = main(["scan", self.scan_target_dir, self.snap1_path])
        self.assertEqual(ret_scan, 0)

        self.assertTrue(os.path.exists(self.snap1_path))
        with open(self.snap1_path, "r") as f:
            lines = f.readlines()
        self.assertGreaterEqual(len(lines), 2) # At least header + root + doc.txt

        # Modify the file and take a second snapshot
        with open(self.test_file, "a") as f:
            f.write(" additional content")

        ret_scan2 = main(["scan", self.scan_target_dir, self.snap2_path])
        self.assertEqual(ret_scan2, 0)

        # 2. Test CLI DIFF (should exit with 0 and display tables)
        # We can also test CSV output
        csv_out = os.path.join(self.root_dir, "comparison.csv")
        ret_diff = main(["diff", self.snap1_path, self.snap2_path, "--csv", csv_out, "--limit", "5"])
        self.assertEqual(ret_diff, 0)

        # Verify CSV output
        self.assertTrue(os.path.exists(csv_out))
        with open(csv_out, "r") as f:
            csv_lines = f.readlines()
        self.assertGreater(len(csv_lines), 1) # Header + at least some rows

    def test_cli_scan_invalid_dir(self):
        # Scan of non-existent directory should return non-zero exit code
        invalid_path = os.path.join(self.root_dir, "does_not_exist")
        ret = main(["scan", invalid_path, self.snap1_path])
        self.assertNotEqual(ret, 0)


if __name__ == "__main__":
    unittest.main()
