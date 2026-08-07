import json
from typing import Any, Dict, List, Optional, Set, Tuple, Union

class StoryState:
    """
    Immutable representation of a simulator state consisting of a scene_id
    and a frozen set of variable key-value pairs.
    """
    def __init__(self, scene_id: str, variables: Dict[str, Any]):
        self.scene_id = scene_id
        # Convert dictionary to immutable items.
        # Performance optimization: Removing redundant sorted() operations in frozenset
        # constructions since frozenset is order-independent and does not require sorted inputs.
        frozen_items = [(k, self._freeze_val(v)) for k, v in variables.items()]
        self.variables = frozenset(frozen_items)

        # Performance optimization: Cache the dictionary representation of state variables
        # during initialization to avoid repetitive dict() instantiation inside the hot BFS loop
        # (e.g., when evaluating conditions or applying mutations).
        self._dict_cache = dict(frozen_items)

    def _freeze_val(self, val: Any) -> Any:
        if isinstance(val, list):
            return tuple(self._freeze_val(x) for x in val)
        if isinstance(val, dict):
            # Performance optimization: Avoid redundant sorted() for nested dictionaries
            return frozenset((k, self._freeze_val(v)) for k, v in val.items())
        return val

    def to_dict(self) -> Dict[str, Any]:
        return self._dict_cache

    def __hash__(self) -> int:
        return hash((self.scene_id, self.variables))

    def __eq__(self, other: Any) -> bool:
        if not isinstance(other, StoryState):
            return False
        return self.scene_id == other.scene_id and self.variables == other.variables

    def __repr__(self) -> str:
        return f"StoryState(scene_id={self.scene_id}, variables={self.to_dict()})"


def evaluate_condition(condition: Optional[Dict[str, Any]], variables: Dict[str, Any]) -> bool:
    """
    Evaluates a condition or nested conditions against the provided variables.
    """
    if not condition:
        return True

    # Logical operations
    if "and" in condition:
        sub_conds = condition["and"]
        if not isinstance(sub_conds, list):
            return False
        return all(evaluate_condition(c, variables) for c in sub_conds)

    if "or" in condition:
        sub_conds = condition["or"]
        if not isinstance(sub_conds, list):
            return False
        return any(evaluate_condition(c, variables) for c in sub_conds)

    if "not" in condition:
        sub_cond = condition["not"]
        return not evaluate_condition(sub_cond, variables)

    # Base comparison condition
    var_name = condition.get("variable")
    op = condition.get("operator")
    val = condition.get("value")

    if var_name is None or op is None:
        return False

    # Retrieve current variable value, defaulting to None
    var_val = variables.get(var_name, None)

    try:
        if op == "==":
            return var_val == val
        elif op == "!=":
            return var_val != val
        elif op == "<":
            if var_val is None or val is None:
                return False
            return var_val < val
        elif op == "<=":
            if var_val is None or val is None:
                return False
            return var_val <= val
        elif op == ">":
            if var_val is None or val is None:
                return False
            return var_val > val
        elif op == ">=":
            if var_val is None or val is None:
                return False
            return var_val >= val
    except TypeError:
        return False

    return False


def apply_mutations(mutations: Optional[List[Dict[str, Any]]], variables: Dict[str, Any]) -> Dict[str, Any]:
    """
    Applies state mutations to a copy of the variables and returns the new variables dict.
    """
    new_vars = dict(variables)
    if not mutations:
        return new_vars

    for mut in mutations:
        if not isinstance(mut, dict):
            continue
        var_name = mut.get("variable")
        op = mut.get("operation")
        val = mut.get("value")

        if not var_name or not op:
            continue

        curr_val = new_vars.get(var_name, 0)

        if op == "set":
            new_vars[var_name] = val
        elif op == "add":
            try:
                new_vars[var_name] = curr_val + val
            except TypeError:
                pass
        elif op == "sub":
            try:
                new_vars[var_name] = curr_val - val
            except TypeError:
                pass
        elif op == "mul":
            try:
                new_vars[var_name] = curr_val * val
            except TypeError:
                pass
        elif op == "div":
            try:
                if val == 0:
                    pass
                else:
                    new_vars[var_name] = curr_val / val
            except TypeError:
                pass

    return new_vars


def extract_variables_from_condition(condition: Optional[Dict[str, Any]]) -> Set[str]:
    """Helper to statically extract all variable names referenced in a condition."""
    if not condition:
        return set()
    vars_found = set()
    if "and" in condition:
        for c in condition["and"]:
            vars_found.update(extract_variables_from_condition(c))
    if "or" in condition:
        for c in condition["or"]:
            vars_found.update(extract_variables_from_condition(c))
    if "not" in condition:
        vars_found.update(extract_variables_from_condition(condition["not"]))
    var_name = condition.get("variable")
    if var_name:
        vars_found.add(var_name)
    return vars_found


def extract_variables_from_mutations(mutations: Optional[List[Dict[str, Any]]]) -> Set[str]:
    """Helper to statically extract all variable names referenced in mutations."""
    if not mutations:
        return set()
    vars_found = set()
    for mut in mutations:
        if isinstance(mut, dict):
            var_name = mut.get("variable")
            if var_name:
                vars_found.add(var_name)
    return vars_found


class NarrativeSimulator:
    def __init__(self, story: Dict[str, Any], max_depth: int = 100, max_states: int = 1000):
        self.story = story
        self.max_depth = max_depth
        self.max_states = max_states

        self.start_scene = story.get("start_scene", "")
        self.initial_variables = story.get("variables", {})
        self.scenes = story.get("scenes", {})

    def run_static_analysis(self) -> Dict[str, Any]:
        """
        Performs static analysis on the story definitions without exploring state space.
        """
        defined_variables = set(self.initial_variables.keys())
        referenced_variables = set()
        invalid_transition_targets = set()

        for scene_id, scene_def in self.scenes.items():
            if not isinstance(scene_def, dict):
                continue
            choices = scene_def.get("choices", [])
            if not isinstance(choices, list):
                continue
            for choice in choices:
                if not isinstance(choice, dict):
                    continue
                # Record referenced variables
                condition = choice.get("condition")
                referenced_variables.update(extract_variables_from_condition(condition))
                mutations = choice.get("mutations")
                referenced_variables.update(extract_variables_from_mutations(mutations))

                # Check transition targets
                target = choice.get("target")
                if target and target not in self.scenes:
                    invalid_transition_targets.add(target)

        undefined_variables = referenced_variables - defined_variables
        unused_variables = defined_variables - referenced_variables

        return {
            "undefined_variables": sorted(list(undefined_variables)),
            "unused_variables": sorted(list(unused_variables)),
            "invalid_transition_targets": sorted(list(invalid_transition_targets))
        }

    def run(self) -> Dict[str, Any]:
        """
        Executes both static analysis and bounded BFS state space exploration.
        """
        static_res = self.run_static_analysis()

        # Handle trivial start scene error
        if not self.start_scene or self.start_scene not in self.scenes:
            return {
                "status": "completed",
                "limit_hit": False,
                "static_analysis": static_res,
                "dynamic_analysis": {
                    "reachable_scenes": [],
                    "unreachable_scenes": sorted(list(self.scenes.keys())),
                    "unreachable_endings": sorted([s for s, d in self.scenes.items() if d.get("terminal")]),
                    "reachable_non_terminal_dead_ends": [],
                    "soft_locks": [],
                    "impossible_conditions": [],
                    "witness_paths": {},
                    "edges": []
                }
            }

        # Initialize BFS structures
        start_state = StoryState(self.start_scene, self.initial_variables)

        # visited_states maps StoryState -> list of transition dicts
        # e.g., [{"scene": "scene1", "choice": "Go east", "target": "scene2"}]
        visited_states: Dict[StoryState, List[Dict[str, Any]]] = {start_state: []}

        # State-transition graph edges: (from_state, to_state, choice_index, choice_text)
        stg_edges: Set[Tuple[StoryState, StoryState, int, str]] = set()

        # We keep track of choice evaluations to determine if they ever passed.
        # Maps (scene_id, choice_index) -> list of boolean evaluation outcomes
        choice_evaluations: Dict[Tuple[str, int], List[bool]] = {}
        for s_id, s_def in self.scenes.items():
            for idx, choice in enumerate(s_def.get("choices", [])):
                if "condition" in choice:
                    choice_evaluations[(s_id, idx)] = []

        # Queue contains (state, depth)
        queue: List[Tuple[StoryState, int]] = [(start_state, 0)]
        queue_idx = 0

        limit_hit = False
        limit_reason = ""

        # Run BFS
        while queue_idx < len(queue):
            # Check state limit
            if len(visited_states) > self.max_states:
                limit_hit = True
                limit_reason = f"State limit of {self.max_states} reached."
                break

            state, depth = queue[queue_idx]
            queue_idx += 1

            scene_def = self.scenes.get(state.scene_id)
            if not scene_def:
                continue

            # If this is an intended terminal scene, do not expand outgoing paths
            if scene_def.get("terminal"):
                continue

            # Check depth limit
            if depth >= self.max_depth:
                # If there are outgoing transitions we *could* explore but can't, mark limit_hit
                choices = scene_def.get("choices", [])
                if choices:
                    limit_hit = True
                    limit_reason = f"Depth limit of {self.max_depth} reached."
                continue

            choices = scene_def.get("choices", [])
            for idx, choice in enumerate(choices):
                cond = choice.get("condition")
                target = choice.get("target")
                text = choice.get("text", f"Choice {idx}")

                # If the target is invalid, we don't proceed with transition (flagged by static analysis)
                if not target or target not in self.scenes:
                    continue

                is_valid = evaluate_condition(cond, state.to_dict())
                if (state.scene_id, idx) in choice_evaluations:
                    choice_evaluations[(state.scene_id, idx)].append(is_valid)

                if is_valid:
                    next_vars = apply_mutations(choice.get("mutations"), state.to_dict())
                    next_state = StoryState(target, next_vars)

                    # Record edge
                    stg_edges.add((state, next_state, idx, text))

                    if next_state not in visited_states:
                        # Append transition to witness path
                        new_path = visited_states[state] + [{
                            "scene": state.scene_id,
                            "choice": text,
                            "target": target
                        }]
                        visited_states[next_state] = new_path
                        queue.append((next_state, depth + 1))

        # --- Dynamic Analysis Metrics ---

        # 1. Reachable & Unreachable Scenes
        reachable_scenes = sorted(list({st.scene_id for st in visited_states}))
        unreachable_scenes = sorted(list(set(self.scenes.keys()) - set(reachable_scenes)))

        # 2. Unreachable Endings
        intended_endings = {s_id for s_id, s_def in self.scenes.items() if s_def.get("terminal")}
        unreachable_endings = sorted(list(intended_endings - set(reachable_scenes)))

        # 3. Reachable Non-Terminal Dead Ends
        # A visited state is a non-terminal dead end if:
        # - Its scene is NOT terminal
        # - It has no outgoing edges in the STG (no choices defined, or all choice conditions failed)
        dead_end_states: List[StoryState] = []
        for state in visited_states:
            s_def = self.scenes.get(state.scene_id)
            if not s_def:
                continue
            if s_def.get("terminal"):
                continue

            # Check if there are any successfully navigated transitions out of this state
            has_outgoing = any(edge[0] == state for edge in stg_edges)
            if not has_outgoing:
                dead_end_states.append(state)

        # 4. Soft Locks
        # Reachable states from which NO terminal state in the STG can be reached.
        # First, find all visited terminal states (terminal scene and in visited_states)
        visited_terminal_states = {st for st in visited_states if self.scenes.get(st.scene_id, {}).get("terminal")}

        # Build reverse adjacency list
        rev_adj: Dict[StoryState, List[StoryState]] = {st: [] for st in visited_states}
        for parent, child, _, _ in stg_edges:
            if child in rev_adj:
                rev_adj[child].append(parent)

        # Reverse BFS from terminal states
        successful_states: Set[StoryState] = set(visited_terminal_states)
        rev_queue = list(visited_terminal_states)
        rev_idx = 0
        while rev_idx < len(rev_queue):
            curr = rev_queue[rev_idx]
            rev_idx += 1
            for pred in rev_adj.get(curr, []):
                if pred not in successful_states:
                    successful_states.add(pred)
                    rev_queue.append(pred)

        # Soft locks are visited states that are NOT successful and NOT themselves terminal
        # (Since if they are terminal, they successfully reached a terminal state).
        soft_lock_states = sorted(
            [st for st in visited_states if st not in successful_states],
            key=lambda x: (x.scene_id, sorted(list(x.variables)))
        )

        # 5. Impossible Conditions
        # A choice's condition is impossible if the scene is reachable, but for all visited
        # states at that scene, the condition always evaluated to False.
        # Note: If the condition is never evaluated because the scene is unreachable, it's not a reachable scene.
        # If the choice has no condition, it's not impossible.
        impossible_conditions = []
        for (s_id, idx), evals in choice_evaluations.items():
            if s_id not in reachable_scenes:
                continue
            if evals and not any(evals):
                choice_def = self.scenes[s_id]["choices"][idx]
                impossible_conditions.append({
                    "scene": s_id,
                    "choice_index": idx,
                    "choice_text": choice_def.get("text", f"Choice {idx}"),
                    "condition": choice_def.get("condition")
                })
        impossible_conditions.sort(key=lambda x: (x["scene"], x["choice_index"]))

        # 6. Shortest Witness Paths to Scenes
        scene_witness_paths = {}
        for scene_id in reachable_scenes:
            states_for_scene = [st for st in visited_states if st.scene_id == scene_id]
            best_state = min(states_for_scene, key=lambda st: len(visited_states[st]))
            scene_witness_paths[scene_id] = visited_states[best_state]

        # Format dead ends to include witness paths
        formatted_dead_ends = []
        for st in dead_end_states:
            formatted_dead_ends.append({
                "scene": st.scene_id,
                "variables": st.to_dict(),
                "witness_path": visited_states[st]
            })
        formatted_dead_ends.sort(key=lambda x: (x["scene"], sorted(list(x["variables"].items()))))

        # Format soft locks to include witness paths
        formatted_soft_locks = []
        for st in soft_lock_states:
            formatted_soft_locks.append({
                "scene": st.scene_id,
                "variables": st.to_dict(),
                "witness_path": visited_states[st]
            })

        # Format edges for DOT generation
        formatted_edges = []
        for parent, child, idx, text in sorted(stg_edges, key=lambda e: (e[0].scene_id, sorted(list(e[0].variables)), e[1].scene_id, sorted(list(e[1].variables)), e[2])):
            formatted_edges.append({
                "from_scene": parent.scene_id,
                "from_variables": parent.to_dict(),
                "to_scene": child.scene_id,
                "to_variables": child.to_dict(),
                "choice_index": idx,
                "choice_text": text
            })

        return {
            "status": "inconclusive" if limit_hit else "completed",
            "limit_hit": limit_hit,
            "limit_reason": limit_reason if limit_hit else None,
            "static_analysis": static_res,
            "dynamic_analysis": {
                "reachable_scenes": reachable_scenes,
                "unreachable_scenes": unreachable_scenes,
                "unreachable_endings": unreachable_endings,
                "reachable_non_terminal_dead_ends": formatted_dead_ends,
                "soft_locks": formatted_soft_locks,
                "impossible_conditions": impossible_conditions,
                "witness_paths": scene_witness_paths,
                "edges": formatted_edges
            }
        }
