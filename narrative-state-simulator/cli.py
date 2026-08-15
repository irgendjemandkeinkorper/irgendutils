#!/usr/bin/env python3
import argparse
import json
import sys
from typing import Any, Dict, List

# Add relative import support
try:
    from .simulator import NarrativeSimulator
except ImportError:
    from simulator import NarrativeSimulator


def generate_dot(edges: List[Dict[str, Any]], start_scene: str) -> str:
    """
    Generates a Graphviz DOT representation of the state-transition graph.
    """
    state_to_id = {}

    def get_id(scene: str, variables: Dict[str, Any]) -> str:
        key = (scene, frozenset(sorted(variables.items())))
        if key not in state_to_id:
            state_to_id[key] = f"state_{len(state_to_id)}"
        return state_to_id[key]

    lines = [
        "digraph StoryStateGraph {",
        "  rankdir=LR;",
        "  node [shape=box, style=filled, fillcolor=lightblue, fontname=\"Courier-Oblique\"];"
    ]

    # Collect all unique states
    states_def = {}
    for edge in edges:
        f_s, f_v = edge["from_scene"], edge["from_variables"]
        t_s, t_v = edge["to_scene"], edge["to_variables"]
        states_def[(f_s, frozenset(sorted(f_v.items())))] = (f_s, f_v)
        states_def[(t_s, frozenset(sorted(t_v.items())))] = (t_s, t_v)

    for key, (scene, variables) in sorted(states_def.items(), key=lambda x: (x[1][0], sorted(list(x[1][1].items())))):
        node_id = get_id(scene, variables)
        vars_str = ", ".join(f"{k}={v}" for k, v in sorted(variables.items()))
        label = f"{scene}\\n({vars_str})" if vars_str else scene

        # Highlight start scene
        if scene == start_scene and not vars_str:
            lines.append(f"  {node_id} [label=\"{label}\", fillcolor=lightgreen, penwidth=2];")
        else:
            lines.append(f"  {node_id} [label=\"{label}\"];")

    for edge in edges:
        from_id = get_id(edge["from_scene"], edge["from_variables"])
        to_id = get_id(edge["to_scene"], edge["to_variables"])
        choice = edge["choice_text"].replace('"', '\\"')
        lines.append(f"  {from_id} -> {to_id} [label=\"{choice}\"];")

    lines.append("}")
    return "\n".join(lines)


def print_path(path: List[Dict[str, Any]], start_scene: str):
    if not path:
        print(f"          [Start] {start_scene}")
        return
    print(f"          {start_scene}")
    for step in path:
        print(f"          --[ {step['choice']} ]--> {step['target']}")


def print_terminal_report(results: Dict[str, Any], start_scene: str):
    print("=" * 60)
    print(" NARRATIVE STATE-GRAPH SIMULATION REPORT")
    print("=" * 60)

    status = results["status"].upper()
    print(f"Simulation Status: {status}")
    if results["limit_hit"]:
        print(f"Reason: {results['limit_reason']}")
    print("-" * 60)

    # Static Analysis Section
    sa = results["static_analysis"]
    print("STATIC ANALYSIS:")

    if sa["undefined_variables"]:
        print("  [!] Undefined Variables (referenced but not in variables init):")
        for v in sa["undefined_variables"]:
            print(f"      - {v}")
    else:
        print("  [✓] No undefined variables detected.")

    if sa["unused_variables"]:
        print("  [!] Unused Variables (defined but never referenced):")
        for v in sa["unused_variables"]:
            print(f"      - {v}")
    else:
        print("  [✓] No unused variables detected.")

    if sa["invalid_transition_targets"]:
        print("  [✗] Invalid Transition Targets (referenced in choices but do not exist):")
        for t in sa["invalid_transition_targets"]:
            print(f"      - {t}")
    else:
        print("  [✓] All transition targets exist in story.")
    print("-" * 60)

    # Dynamic Analysis Section
    da = results["dynamic_analysis"]
    print("DYNAMIC ANALYSIS:")
    print(f"  Reachable Scenes count: {len(da['reachable_scenes'])}")

    if da["unreachable_scenes"]:
        print(f"  [✗] Unreachable Scenes ({len(da['unreachable_scenes'])}):")
        for s in da["unreachable_scenes"]:
            print(f"      - {s}")
    else:
        print("  [✓] All defined scenes are reachable.")

    if da["unreachable_endings"]:
        print(f"  [✗] Unreachable Terminal Scenes/Endings ({len(da['unreachable_endings'])}):")
        for s in da["unreachable_endings"]:
            print(f"      - {s}")
    else:
        print("  [✓] All defined terminal scenes are reachable.")

    if da["reachable_non_terminal_dead_ends"]:
        print(f"  [✗] Reachable Non-Terminal Dead Ends ({len(da['reachable_non_terminal_dead_ends'])}):")
        for de in da["reachable_non_terminal_dead_ends"]:
            print(f"      - Scene: {de['scene']}")
            print(f"        State variables: {de['variables']}")
            print("        Shortest Path:")
            print_path(de["witness_path"], start_scene)
    else:
        print("  [✓] No reachable non-terminal dead ends detected.")

    if da["soft_locks"]:
        print(f"  [✗] Soft Locks ({len(da['soft_locks'])} states):")
        by_scene = {}
        for sl in da["soft_locks"]:
            by_scene.setdefault(sl["scene"], []).append(sl)
        for scene_id, sls in sorted(by_scene.items()):
            print(f"      - Scene: {scene_id} ({len(sls)} state variant(s))")
            for idx, sl in enumerate(sls[:3]):
                print(f"        Variant {idx + 1} State: {sl['variables']}")
                print("        Shortest Path to Soft Lock:")
                print_path(sl["witness_path"], start_scene)
            if len(sls) > 3:
                print(f"        ... and {len(sls) - 3} other state variant(s)")
    else:
        print("  [✓] No soft locks detected.")

    if da["impossible_conditions"]:
        print(f"  [!] Impossible Conditions ({len(da['impossible_conditions'])}):")
        for ic in da["impossible_conditions"]:
            print(f"      - Scene: {ic['scene']}, Choice index: {ic['choice_index']}")
            print(f"        Text: '{ic['choice_text']}'")
            print(f"        Precondition: {ic['condition']}")
    else:
        print("  [✓] No impossible preconditions on reachable choices.")
    print("=" * 60)


def main():
    parser = argparse.ArgumentParser(
        description="Explore a branching narrative graph and identify unreachable scenes, soft locks, impossible conditions, and dead ends."
    )
    parser.add_argument(
        "story_path",
        help="Path to the narrative JSON file."
    )
    parser.add_argument(
        "--max-depth",
        type=int,
        default=100,
        help="Maximum traversal depth for BFS exploration (default: 100)."
    )
    parser.add_argument(
        "--max-states",
        type=int,
        default=1000,
        help="Maximum unique states visited in BFS exploration (default: 1000)."
    )
    parser.add_argument(
        "--output-json",
        help="Path to write simulation report as JSON."
    )
    parser.add_argument(
        "--output-dot",
        help="Path to write state-transition graph as Graphviz DOT."
    )

    args = parser.parse_args()

    try:
        with open(args.story_path, "r", encoding="utf-8") as f:
            story = json.load(f)
    except FileNotFoundError:
        print(f"Error: File '{args.story_path}' not found.", file=sys.stderr)
        sys.exit(1)
    except json.JSONDecodeError as e:
        print(f"Error: Invalid JSON format in '{args.story_path}': {e}", file=sys.stderr)
        sys.exit(1)

    simulator = NarrativeSimulator(
        story,
        max_depth=args.max_depth,
        max_states=args.max_states
    )

    results = simulator.run()

    # Print to stdout
    print_terminal_report(results, story.get("start_scene", ""))

    # Output JSON report if requested
    if args.output_json:
        try:
            with open(args.output_json, "w", encoding="utf-8") as f:
                json.dump(results, f, indent=2)
            print(f"JSON report exported to: {args.output_json}")
        except Exception as e:
            print(f"Error exporting JSON report: {e}", file=sys.stderr)

    # Output DOT graph if requested
    if args.output_dot:
        try:
            dot_content = generate_dot(
                results["dynamic_analysis"]["edges"],
                story.get("start_scene", "")
            )
            with open(args.output_dot, "w", encoding="utf-8") as f:
                f.write(dot_content)
            print(f"Graphviz DOT representation exported to: {args.output_dot}")
        except Exception as e:
            print(f"Error exporting DOT graph: {e}", file=sys.stderr)


if __name__ == "__main__":
    main()
