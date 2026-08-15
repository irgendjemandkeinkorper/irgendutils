import json
import os
import subprocess
import tempfile
import unittest


class TestCLI(unittest.TestCase):
    def setUp(self):
        self.cli_path = os.path.join(
            os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "cli.py"
        )
        self.fixtures_dir = os.path.join(
            os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "fixtures"
        )

    def test_cli_help(self):
        res = subprocess.run(
            ["python3", self.cli_path, "--help"],
            capture_output=True,
            text=True
        )
        self.assertEqual(res.returncode, 0)
        self.assertIn("Explore a branching narrative graph", res.stdout)

    def test_cli_execution_with_reports(self):
        story_file = os.path.join(self.fixtures_dir, "standard_branching.json")

        with tempfile.TemporaryDirectory() as tmpdir:
            out_json = os.path.join(tmpdir, "report.json")
            out_dot = os.path.join(tmpdir, "report.dot")

            res = subprocess.run(
                [
                    "python3",
                    self.cli_path,
                    story_file,
                    "--output-json",
                    out_json,
                    "--output-dot",
                    out_dot
                ],
                capture_output=True,
                text=True
            )

            # Ensure CLI ran successfully
            self.assertEqual(res.returncode, 0, f"CLI execution failed: {res.stderr}")
            self.assertIn("NARRATIVE STATE-GRAPH SIMULATION REPORT", res.stdout)
            self.assertIn("No undefined variables detected", res.stdout)

            # Check JSON file existence and contents
            self.assertTrue(os.path.exists(out_json))
            with open(out_json, "r", encoding="utf-8") as f:
                report = json.load(f)
            self.assertEqual(report["status"], "completed")
            self.assertIn("victory", report["dynamic_analysis"]["reachable_scenes"])

            # Check DOT file existence and contents
            self.assertTrue(os.path.exists(out_dot))
            with open(out_dot, "r", encoding="utf-8") as f:
                dot_content = f.read()
            self.assertIn("digraph StoryStateGraph", dot_content)
            self.assertIn("intro", dot_content)


if __name__ == "__main__":
    unittest.main()
