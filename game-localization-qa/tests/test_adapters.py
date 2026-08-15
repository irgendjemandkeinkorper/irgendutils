import unittest
import os
import tempfile
from game_localization_qa.adapters import JSONAdapter, CSVAdapter, POAdapter

class TestAdapters(unittest.TestCase):
    def test_json_adapter_dict(self):
        adapter = JSONAdapter()
        with tempfile.NamedTemporaryFile("w+", delete=False, suffix=".json") as f:
            f.write('{"KEY1": "Val 1", "KEY2": "Val 2"}')
            f_path = f.name

        try:
            res = adapter.parse(f_path)
            self.assertEqual(res, {"KEY1": "Val 1", "KEY2": "Val 2"})
        finally:
            os.remove(f_path)

    def test_json_adapter_list(self):
        adapter = JSONAdapter()
        with tempfile.NamedTemporaryFile("w+", delete=False, suffix=".json") as f:
            f.write('[{"id": "KEY1", "text": "Val 1"}, {"key": "KEY2", "value": "Val 2"}]')
            f_path = f.name

        try:
            res = adapter.parse(f_path)
            self.assertEqual(res, {"KEY1": "Val 1", "KEY2": "Val 2"})
        finally:
            os.remove(f_path)

    def test_csv_adapter_autodetect(self):
        adapter = CSVAdapter()
        with tempfile.NamedTemporaryFile("w+", delete=False, suffix=".csv") as f:
            f.write("string_id,translation\nKEY1,Val 1\nKEY2,\"Val 2 with \nline break\"\n")
            f_path = f.name

        try:
            res = adapter.parse(f_path)
            self.assertEqual(res["KEY1"], "Val 1")
            self.assertEqual(res["KEY2"], "Val 2 with \nline break")
        finally:
            os.remove(f_path)

    def test_csv_adapter_explicit_columns(self):
        adapter = CSVAdapter(key_col="my_key", val_col="my_val")
        with tempfile.NamedTemporaryFile("w+", delete=False, suffix=".csv") as f:
            f.write("my_key,other,my_val\nKEY1,xxx,Val 1\n")
            f_path = f.name

        try:
            res = adapter.parse(f_path)
            self.assertEqual(res, {"KEY1": "Val 1"})
        finally:
            os.remove(f_path)

    def test_po_adapter(self):
        adapter = POAdapter()
        with tempfile.NamedTemporaryFile("w+", delete=False, suffix=".po") as f:
            f.write(
                'msgid ""\n'
                'msgstr ""\n'
                '"Content-Type: text/plain; charset=UTF-8\\n"\n\n'
                '#. Comment\n'
                'msgid "KEY1"\n'
                'msgstr "Val 1"\n\n'
                'msgid "KEY2"\n'
                'msgstr ""\n'
                '"Line 1\\n"\n'
                '"Line 2"\n'
            )
            f_path = f.name

        try:
            res = adapter.parse(f_path)
            self.assertEqual(res["KEY1"], "Val 1")
            self.assertEqual(res["KEY2"], "Line 1\nLine 2")
        finally:
            os.remove(f_path)

if __name__ == "__main__":
    unittest.main()
