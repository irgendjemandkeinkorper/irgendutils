import os
import io
import unittest
import tempfile
import struct
import json
from unittest.mock import patch

from tiled_map_validator.path_utils import is_case_sensitive_exact
from tiled_map_validator.image_utils import get_image_dimensions
from tiled_map_validator.validator import TiledValidator, FLIP_FLAGS
from tiled_map_validator.cli import run_cli

class TestPathUtils(unittest.TestCase):
    def test_case_sensitive_exact(self):
        with tempfile.TemporaryDirectory() as tmpdir:
            temp_file_path = os.path.join(tmpdir, "MyMixedCaseFile.txt")
            with open(temp_file_path, "w") as f:
                f.write("test")

            self.assertTrue(is_case_sensitive_exact(temp_file_path))

            bad_casing_path = os.path.join(tmpdir, "mymixedcasefile.txt")
            self.assertFalse(is_case_sensitive_exact(bad_casing_path))

class TestImageUtils(unittest.TestCase):
    def test_png_dimensions(self):
        png_data = (
            b'\x89PNG\r\n\x1a\n'
            b'\x00\x00\x00\rIHDR'
            b'\x00\x00\x00\x64' # width 100
            b'\x00\x00\x00\xc8' # height 200
            b'\x08\x02\x00\x00\x00'
            b'\x00\x00\x00\x00'
        )
        with patch("builtins.open", return_value=io.BytesIO(png_data)):
            dims = get_image_dimensions("fake.png")
            self.assertEqual(dims, (100, 200))

    def test_gif_dimensions(self):
        gif_data = b'GIF89a\x96\x00\x4b\x00\x00'
        with patch("builtins.open", return_value=io.BytesIO(gif_data)):
            dims = get_image_dimensions("fake.gif")
            self.assertEqual(dims, (150, 75))

    def test_webp_lossy_dimensions(self):
        webp_data = (
            b'RIFF\x00\x00\x00\x00WEBPVP8 \x00\x00\x00\x00'
            b'\x00\x00\x00'
            b'\x9d\x01\x2a'
            b'\x40\x01\xf0\x00' # 320, 240
        )
        with patch("builtins.open", return_value=io.BytesIO(webp_data)):
            dims = get_image_dimensions("fake.webp")
            self.assertEqual(dims, (320, 240))

    def test_webp_lossless_dimensions(self):
        webp_data = (
            b'RIFF\x00\x00\x00\x00WEBPVP8L\x00\x00\x00\x00'
            b'\x2f'
            b'\x63\x40\x0c\x00' # 100, 50
        )
        with patch("builtins.open", return_value=io.BytesIO(webp_data)):
            dims = get_image_dimensions("fake.webp")
            self.assertEqual(dims, (100, 50))

    def test_webp_extended_dimensions(self):
        webp_data = (
            b'RIFF\x00\x00\x00\x00WEBPVP8X\x00\x00\x00\x00'
            b'\x00\x00\x00\x00'
            b'\xe7\x03\x00' # width-1 = 999 -> 1000
            b'\x1f\x03\x00' # height-1 = 799 -> 800
        )
        with patch("builtins.open", return_value=io.BytesIO(webp_data)):
            dims = get_image_dimensions("fake.webp")
            self.assertEqual(dims, (1000, 800))

    def test_jpeg_dimensions(self):
        jpeg_data = (
            b'\xff\xd8'
            b'\xff\xe0\x00\x04\x00\x00'
            b'\xff\xc0\x00\x0b'
            b'\x08'
            b'\x01\x2c' # height (300)
            b'\x01\xf4' # width (500)
        )
        with patch("builtins.open", return_value=io.BytesIO(jpeg_data)):
            dims = get_image_dimensions("fake.jpg")
            self.assertEqual(dims, (500, 300))

class TestTiledValidator(unittest.TestCase):
    def setUp(self):
        self.config = {
            "required_layers": ["ground"],
            "allowed_object_types": ["spawn"],
            "required_properties": {
                "map": ["difficulty"],
                "layers": {
                    "ground": ["walkable"]
                },
                "objects": {
                    "spawn": ["team"]
                }
            }
        }
        self.validator = TiledValidator(self.config)

    def test_validate_clean_fixtures(self):
        clean_map_path = "tiled-map-validator/fixtures/clean/map_finite.tmj"
        clean_config_path = "tiled-map-validator/fixtures/clean/config.json"

        with open(clean_config_path, "r") as f:
            cfg = json.load(f)

        val = TiledValidator(cfg)
        findings = val.validate_map(clean_map_path)
        self.assertEqual(findings, [])

    def test_validate_infinite_clean_fixture(self):
        clean_map_path = "tiled-map-validator/fixtures/clean/map_infinite.tmj"
        clean_config_path = "tiled-map-validator/fixtures/clean/config.json"

        with open(clean_config_path, "r") as f:
            cfg = json.load(f)

        val = TiledValidator(cfg)
        findings = val.validate_map(clean_map_path)
        self.assertEqual(findings, [])

    def test_validate_broken_rules(self):
        broken_map_path = "tiled-map-validator/fixtures/broken/map_broken_rules.tmj"
        clean_config_path = "tiled-map-validator/fixtures/clean/config.json"

        with open(clean_config_path, "r") as f:
            cfg = json.load(f)

        val = TiledValidator(cfg)
        findings = val.validate_map(broken_map_path)

        categories = [f["category"] for f in findings]
        self.assertIn("property", categories)
        self.assertIn("gid", categories)
        self.assertIn("object_id", categories)
        self.assertIn("object_type", categories)

        errors = [f for f in findings if f["severity"] == "error"]
        self.assertEqual(len(errors), 6)

    def test_validate_broken_paths(self):
        broken_map_path = "tiled-map-validator/fixtures/broken/map_broken_paths.tmj"
        # Use simple unconfigured validator so other checks don't interfere
        simple_val = TiledValidator()
        findings = simple_val.validate_map(broken_map_path)

        self.assertEqual(len(findings), 1)
        self.assertEqual(findings[0]["category"], "path")
        self.assertIn("Tileset.tsj", findings[0]["message"])

    def test_validate_tileset_broken_dims(self):
        broken_ts_path = "tiled-map-validator/fixtures/broken/tileset_broken_dims.tsj"
        findings = self.validator.validate_tileset(broken_ts_path)

        self.assertEqual(len(findings), 2)
        categories = [f["category"] for f in findings]
        self.assertEqual(categories, ["dimension", "dimension"])

class TestCLI(unittest.TestCase):
    def test_cli_clean(self):
        exit_code = run_cli([
            "tiled-map-validator/fixtures/clean/map_finite.tmj",
            "-c", "tiled-map-validator/fixtures/clean/config.json",
            "-f", "json"
        ])
        self.assertEqual(exit_code, 0)

    def test_cli_broken(self):
        exit_code = run_cli([
            "tiled-map-validator/fixtures/broken/map_broken_rules.tmj",
            "-c", "tiled-map-validator/fixtures/clean/config.json",
            "-f", "json"
        ])
        self.assertEqual(exit_code, 1)

    def test_cli_missing_target(self):
        exit_code = run_cli([
            "nonexistent_file.tmj"
        ])
        self.assertEqual(exit_code, 2)
