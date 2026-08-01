# Narrative State Simulator Spec

Python narrative state-graph simulator and dead-end finder.

## Architecture

- **Stack**: Python 3.11+ using standard library modules only (`json`, `argparse`, `unittest`, `sys`, `os`, `typing`). No external dependencies.
- **Components**:
  - `simulator.py`: Implements `StoryState` (hashable representation of game state) and `NarrativeSimulator` (runs static structure check and bounded BFS state space traversal).
  - `cli.py`: Parses arguments and outputs beautifully structured terminal reports, exports Graphviz DOT transitions and JSON raw outputs.
- **Static Analysis**: Identifies undefined variables (referenced in choices but not in start variables), unused variables, and invalid scene targets.
- **Dynamic Analysis**: Identifies reachable/unreachable scenes, unreachable endings, reachable non-terminal dead ends, soft locks (reachable states from which no terminal scene is reachable), and impossible preconditions.

## Commands

```bash
# Run simulator CLI
python3 narrative-state-simulator/cli.py <story_path_json> [options]

# Run tests
python3 -m unittest discover -s narrative-state-simulator/tests -p "test_*.py"
```

## JSON Story Schema

Refer to `narrative-state-simulator/schema.json` for full JSON-schema validation rules.

### Structure Example
```json
{
  "start_scene": "intro",
  "variables": {
    "has_sword": false
  },
  "scenes": {
    "intro": {
      "text": "Choose your weapon.",
      "choices": [
        {
          "text": "Take sword",
          "target": "intro",
          "mutations": [{"variable": "has_sword", "operation": "set", "value": true}]
        },
        {
          "text": "Fight",
          "target": "fight",
          "condition": {"variable": "has_sword", "operator": "==", "value": true}
        }
      ]
    },
    "fight": {
      "text": "Victory!",
      "terminal": true
    }
  }
}
```
