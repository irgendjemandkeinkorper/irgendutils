# Narrative State Simulator

Python 3.11+ utility that explores a story’s state graph and reports unreachable scenes, dead ends, soft locks, impossible conditions, and unreachable endings. It uses only the Python standard library.

## Install

No third-party dependencies are required. Run it from the repository root:

```sh
python3 narrative-state-simulator/cli.py path/to/story.json
```

Run the test suite with:

```sh
python3 -m unittest discover -s narrative-state-simulator/tests -p 'test_*.py'
```

## Story format

Stories contain a `start_scene`, initial `variables`, and a `scenes` map. Choices point to target scenes and may include conditions and mutations:

```json
{
  "start_scene": "intro",
  "variables": {"has_sword": false},
  "scenes": {
    "intro": {
      "choices": [{
        "text": "Take sword",
        "target": "intro",
        "mutations": [{"variable": "has_sword", "operation": "set", "value": true}]
      }]
    }
  }
}
```

See [`schema.json`](schema.json) for the complete schema and `fixtures/` for examples. Use `--help` for CLI options, including JSON and Graphviz DOT output.
