import os
import sys
import json
import unittest
import tempfile
from unittest.mock import patch
from analyzer.scanner import scan_directory, write_snapshot_atomic, ScanError
from analyzer.utils import should_exclude, format_bytes, parse_bytes

class TestUtils(unittest.TestCase):
    def test_format_bytes(self):
        self.assertEqual(format_bytes(500), "500 B")
        self.assertEqual(format_bytes(1024), "1.00 KB")
        self.assertEqual(format_bytes(1.5 * 1024 * 1024), "1.50 MB")
        self.assertEqual(format_bytes(-1024), "-1.00 KB")
        self.assertEqual(format_bytes(0), "0 B")
        self.assertEqual(format_bytes(None), "0 B")

    def test_parse_bytes(self):
        self.assertEqual(parse_bytes("500"), 500)
        self.assertEqual(parse_bytes("1K"), 1024)
        self.assertEqual(parse_bytes("1.5M"), int(1.5 * 1024 * 1024))
        self.assertEqual(parse_bytes("10 GB"), 10 * 1024**3)
        with self.assertRaises(ValueError):
            parse_bytes("abc")
        with self.assertRaises(ValueError):
            parse_bytes("10X")

    def test_should_exclude_exact_and_subdir(self):
        root = "/root"
        self.assertTrue(should_exclude("/root/cache", exclude_paths=["/root/cache"], root_dir=root))
        self.assertTrue(should_exclude("/root/cache/subfile.txt", exclude_paths=["/root/cache"], root_dir=root))
        self.assertFalse(should_exclude("/root/other", exclude_paths=["/root/cache"], root_dir=root))

    def test_should_exclude_glob(self):
        root = "/root"
        self.assertTrue(should_exclude("/root/app.log", exclude_globs=["*.log"], root_dir=root))
        self.assertTrue(should_exclude("/root/.git/config", exclude_globs=[".git"], root_dir=root))
        self.assertTrue(should_exclude("/root/subdir/temp.tmp", exclude_globs=["*.tmp"], root_dir=root))
        self.assertFalse(should_exclude("/root/app.py", exclude_globs=["*.log"], root_dir=root))


class TestScanner(unittest.TestCase):
    def setUp(self):
        self.temp_dir = tempfile.TemporaryDirectory()
        self.root_dir = self.temp_dir.name

        # Create a mock tree inside the temporary directory:
        # root/
        #   file1.txt (100 bytes)
        #   subdir1/
        #     file2.txt (200 bytes)
        #   subdir2/ (empty)
        #   symlink_file -> file1.txt (if os supports symlinks)

        self.file1_path = os.path.join(self.root_dir, "file1.txt")
        with open(self.file1_path, "wb") as f:
            f.write(b"A" * 100)

        self.subdir1 = os.path.join(self.root_dir, "subdir1")
        os.makedirs(self.subdir1, exist_ok=True)
        self.file2_path = os.path.join(self.subdir1, "file2.txt")
        with open(self.file2_path, "wb") as f:
            f.write(b"B" * 200)

        self.subdir2 = os.path.join(self.root_dir, "subdir2")
        os.makedirs(self.subdir2, exist_ok=True)

        self.symlink_path = os.path.join(self.root_dir, "symlink_file")
        try:
            os.symlink("file1.txt", self.symlink_path)
            self.supports_symlinks = True
        except (AttributeError, NotImplementedError, OSError):
            self.supports_symlinks = False

    def tearDown(self):
        self.temp_dir.cleanup()

    def test_scan_directory_basic(self):
        entries = list(scan_directory(self.root_dir))

        # We expect root (.), file1.txt, subdir1, subdir1/file2.txt, subdir2, symlink_file
        paths = {e["path"] for e in entries}
        self.assertIn(".", paths)
        self.assertIn("file1.txt", paths)
        self.assertIn("subdir1", paths)
        self.assertIn("subdir1/file2.txt", paths)
        self.assertIn("subdir2", paths)
        if self.supports_symlinks:
            self.assertIn("symlink_file", paths)

        # Check types
        for e in entries:
            if e["path"] == "file1.txt":
                self.assertEqual(e["type"], "file")
                self.assertEqual(e["size"], 100)
            elif e["path"] == "subdir1/file2.txt":
                self.assertEqual(e["type"], "file")
                self.assertEqual(e["size"], 200)
            elif e["path"] == "subdir1":
                self.assertEqual(e["type"], "dir")
            elif e["path"] == "symlink_file" and self.supports_symlinks:
                self.assertEqual(e["type"], "symlink")

    def test_scan_with_exclusions(self):
        # Exclude subdir1
        entries = list(scan_directory(self.root_dir, exclude_paths=[self.subdir1]))
        paths = {e["path"] for e in entries}
        self.assertNotIn("subdir1", paths)
        self.assertNotIn("subdir1/file2.txt", paths)
        self.assertIn("file1.txt", paths)

        # Exclude using glob
        entries2 = list(scan_directory(self.root_dir, exclude_globs=["*file2*"]))
        paths2 = {e["path"] for e in entries2}
        self.assertNotIn("subdir1/file2.txt", paths2)
        self.assertIn("subdir1", paths2)

    def test_scan_with_permission_failure(self):
        # We simulate a permission failure on scanning subdir1 by patching os.scandir
        original_scandir = os.scandir

        def mock_scandir(path):
            if os.path.basename(path) == "subdir1":
                raise PermissionError("[Errno 13] Permission denied")
            return original_scandir(path)

        errors_reported = []
        def error_cb(path, err):
            errors_reported.append((path, err))

        with patch("os.scandir", side_effect=mock_scandir):
            entries = list(scan_directory(self.root_dir, error_callback=error_cb))

        # We should still get file1.txt, subdir2, etc.
        paths = {e["path"] for e in entries}
        self.assertIn(".", paths)
        self.assertIn("file1.txt", paths)
        self.assertIn("subdir1", paths)
        self.assertNotIn("subdir1/file2.txt", paths) # Could not scan inside subdir1

        # Check that we got an entry for subdir1 with an error
        has_error = any("error" in e for e in entries if e["path"] == "subdir1")
        self.assertTrue(has_error)
        self.assertEqual(len(errors_reported), 1)

    def test_scan_one_file_system(self):
        # We construct a clean Mock Directory Entry class to control dev boundaries perfectly.
        class MockDirEntry:
            def __init__(self, name, path, is_directory=False, dev=1):
                self.name = name
                self.path = path
                self._is_dir = is_directory
                self._dev = dev

            def is_dir(self, follow_symlinks=False):
                return self._is_dir

            def is_file(self, follow_symlinks=False):
                return not self._is_dir

            def is_symlink(self):
                return False

            def stat(self, follow_symlinks=False):
                import stat
                mode = stat.S_IFDIR if self._is_dir else stat.S_IFREG
                return os.stat_result((mode, 1234, self._dev, 1, 1000, 1000, 100, 0, 0, 0))

        def mock_scandir(path):
            class MockIterator:
                def __init__(self, entries):
                    self.entries = entries
                def __enter__(self):
                    return self
                def __exit__(self, exc_type, exc_val, exc_tb):
                    pass
                def __iter__(self):
                    return iter(self.entries)

            if path == '/test_root':
                return MockIterator([
                    MockDirEntry('file1.txt', '/test_root/file1.txt', is_directory=False, dev=1),
                    MockDirEntry('subdir1', '/test_root/subdir1', is_directory=True, dev=2),
                    MockDirEntry('subdir2', '/test_root/subdir2', is_directory=True, dev=1)
                ])
            elif path == '/test_root/subdir2':
                return MockIterator([
                    MockDirEntry('file2.txt', '/test_root/subdir2/file2.txt', is_directory=False, dev=1)
                ])
            return MockIterator([])

        def mock_stat(path, *args, **kwargs):
            import stat
            mode = stat.S_IFDIR if path in ('/test_root', '/test_root/subdir1', '/test_root/subdir2') else stat.S_IFREG
            dev = 2 if 'subdir1' in path else 1
            return os.stat_result((mode, 1234, dev, 1, 1000, 1000, 4096, 0, 0, 0))

        with patch('os.path.isdir', return_value=True), \
             patch('os.stat', side_effect=mock_stat), \
             patch('os.scandir', side_effect=mock_scandir):

             entries = list(scan_directory('/test_root', one_file_system=True))

             # Since subdir1 has a different device ID, it and everything inside it must be excluded.
             paths = {e["path"] for e in entries}
             self.assertNotIn("subdir1", paths)
             self.assertNotIn("subdir1/file2.txt", paths)
             self.assertIn("file1.txt", paths)
             self.assertIn("subdir2", paths)
             self.assertIn("subdir2/file2.txt", paths)

    def test_write_snapshot_atomic(self):
        dest_file = os.path.join(self.root_dir, "snapshot.jsonl")
        entries = [
            {"path": ".", "type": "dir", "size": 4096, "mtime": 1000.0},
            {"path": "file1.txt", "type": "file", "size": 100, "mtime": 1001.0}
        ]

        count = write_snapshot_atomic(dest_file, self.root_dir, iter(entries))
        self.assertEqual(count, 2)

        # Verify file contents
        self.assertTrue(os.path.exists(dest_file))
        with open(dest_file, "r") as f:
            lines = [json.loads(line) for line in f if line.strip()]

        self.assertEqual(len(lines), 3) # Header + 2 entries
        self.assertIn("__snapshot_version__", lines[0])
        self.assertEqual(lines[1]["path"], ".")
        self.assertEqual(lines[2]["path"], "file1.txt")


if __name__ == "__main__":
    unittest.main()
