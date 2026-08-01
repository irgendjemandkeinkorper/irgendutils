import os
import csv
import json
import unittest
import tempfile
from analyzer.reporter import DiffEngine, load_snapshot, get_ancestors, compute_cumulative_sizes

class TestReporter(unittest.TestCase):
    def setUp(self):
        self.temp_dir = tempfile.TemporaryDirectory()
        self.root_dir = self.temp_dir.name

        # Create two sample snapshot files
        self.s1_path = os.path.join(self.root_dir, "s1.jsonl")
        self.s2_path = os.path.join(self.root_dir, "s2.jsonl")

        # Snapshot 1 contents
        # Total size is 100 (file1) + 200 (subdir1/file2) = 300
        s1_entries = [
            {"__snapshot_version__": "1.0", "root_directory": "/test", "timestamp": 1000.0},
            {"path": ".", "type": "dir", "size": 4096, "mtime": 1000.0},
            {"path": "file1.txt", "type": "file", "size": 100, "mtime": 1000.0},
            {"path": "subdir1", "type": "dir", "size": 4096, "mtime": 1000.0},
            {"path": "subdir1/file2.txt", "type": "file", "size": 200, "mtime": 1000.0},
            {"path": "deleted.txt", "type": "file", "size": 50, "mtime": 1000.0},
        ]
        with open(self.s1_path, "w", encoding="utf-8") as f:
            for entry in s1_entries:
                f.write(json.dumps(entry) + "\n")

        # Snapshot 2 contents:
        # file1.txt grew (100 -> 150)
        # subdir1/file2.txt shrunk (200 -> 120)
        # deleted.txt is removed
        # new_file.txt is added (80 bytes)
        # Total size is 150 (file1) + 120 (subdir1/file2) + 80 (new_file) = 350
        s2_entries = [
            {"__snapshot_version__": "1.0", "root_directory": "/test", "timestamp": 2000.0},
            {"path": ".", "type": "dir", "size": 4096, "mtime": 2000.0},
            {"path": "file1.txt", "type": "file", "size": 150, "mtime": 2000.0},
            {"path": "subdir1", "type": "dir", "size": 4096, "mtime": 2000.0},
            {"path": "subdir1/file2.txt", "type": "file", "size": 120, "mtime": 2000.0},
            {"path": "new_file.txt", "type": "file", "size": 80, "mtime": 2000.0},
        ]
        with open(self.s2_path, "w", encoding="utf-8") as f:
            for entry in s2_entries:
                f.write(json.dumps(entry) + "\n")

    def tearDown(self):
        self.temp_dir.cleanup()

    def test_get_ancestors(self):
        self.assertEqual(get_ancestors("a/b/c.txt"), [".", "a", "a/b"])
        self.assertEqual(get_ancestors("file.txt"), ["."])
        self.assertEqual(get_ancestors(""), [])
        self.assertEqual(get_ancestors("."), [])

    def test_compute_cumulative_sizes(self):
        entries = {
            ".": {"path": ".", "type": "dir", "size": 4096},
            "file1.txt": {"path": "file1.txt", "type": "file", "size": 100},
            "subdir1": {"path": "subdir1", "type": "dir", "size": 4096},
            "subdir1/file2.txt": {"path": "subdir1/file2.txt", "type": "file", "size": 200},
        }
        cum = compute_cumulative_sizes(entries)
        # Root size should be 100 + 200 = 300
        self.assertEqual(cum["."], 300)
        # subdir1 size should be 200
        self.assertEqual(cum["subdir1"], 200)

    def test_diff_engine_categories(self):
        engine = DiffEngine(self.s1_path, self.s2_path)

        # Verify sizes computed for .
        self.assertEqual(engine.s1_cum_sizes["."], 350) # file1(100) + file2(200) + deleted(50)
        self.assertEqual(engine.s2_cum_sizes["."], 350) # file1(150) + file2(120) + new_file(80)

        # Grown files
        grown_paths = {x[0] for x in engine.grown_files}
        self.assertIn("file1.txt", grown_paths)
        file1_growth = next(x[3] for x in engine.grown_files if x[0] == "file1.txt")
        self.assertEqual(file1_growth, 50)

        # Shrunk files
        shrunk_paths = {x[0] for x in engine.shrunk_files}
        self.assertIn("subdir1/file2.txt", shrunk_paths)
        file2_shrinkage = next(x[3] for x in engine.shrunk_files if x[0] == "subdir1/file2.txt")
        self.assertEqual(file2_shrinkage, -80)

        # New files
        new_paths = {x[0] for x in engine.new_files}
        self.assertIn("new_file.txt", new_paths)
        self.assertEqual(len(new_paths), 1)

        # Deleted files
        deleted_paths = {x[0] for x in engine.deleted_files}
        self.assertIn("deleted.txt", deleted_paths)
        self.assertEqual(len(deleted_paths), 1)

        # Grown / Shrunk dirs
        # subdir1 shrunk: 200 -> 120 (diff: -80)
        shrunk_dirs_paths = {x[0] for x in engine.shrunk_dirs}
        self.assertIn("subdir1", shrunk_dirs_paths)

    def test_csv_export(self):
        csv_out = os.path.join(self.root_dir, "report.csv")
        engine = DiffEngine(self.s1_path, self.s2_path)
        engine.export_csv(csv_out)

        self.assertTrue(os.path.exists(csv_out))
        with open(csv_out, "r", newline="", encoding="utf-8") as f:
            reader = csv.DictReader(f)
            rows = list(reader)

        # Verify columns exist
        headers = reader.fieldnames
        self.assertIn("path", headers)
        self.assertIn("type", headers)
        self.assertIn("status", headers)
        self.assertIn("size_s1", headers)
        self.assertIn("size_s2", headers)
        self.assertIn("change", headers)

        # Verify specific row content
        file1_row = next(r for r in rows if r["path"] == "file1.txt")
        self.assertEqual(file1_row["type"], "file")
        self.assertEqual(file1_row["status"], "GROWN")
        self.assertEqual(int(file1_row["size_s1"]), 100)
        self.assertEqual(int(file1_row["size_s2"]), 150)
        self.assertEqual(int(file1_row["change"]), 50)

        deleted_row = next(r for r in rows if r["path"] == "deleted.txt")
        self.assertEqual(deleted_row["status"], "DELETED")
        self.assertEqual(int(deleted_row["size_s1"]), 50)
        self.assertEqual(int(deleted_row["size_s2"]), 0)
        self.assertEqual(int(deleted_row["change"]), -50)


if __name__ == "__main__":
    unittest.main()
