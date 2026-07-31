import json
import os
import unittest
from typing import Any, Dict

# Relative import support
try:
    from ..simulator import NarrativeSimulator, StoryState, evaluate_condition, apply_mutations
except ImportError:
    import sys
    sys.path.append(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
    from simulator import NarrativeSimulator, StoryState, evaluate_condition, apply_mutations


class TestStoryState(unittest.TestCase):
    def test_basic_equality_and_hashing(self):
        state1 = StoryState("scene1", {"a": 1, "b": "hello"})
        state2 = StoryState("scene1", {"b": "hello", "a": 1})
        state3 = StoryState("scene2", {"a": 1, "b": "hello"})
        state4 = StoryState("scene1", {"a": 1, "b": "world"})

        self.assertEqual(state1, state2)
        self.assertNotEqual(state1, state3)
        self.assertNotEqual(state1, state4)

        self.assertEqual(hash(state1), hash(state2))
        self.assertNotEqual(hash(state1), hash(state3))

    def test_nested_structures(self):
        # Even though JSON variables are typically flat primitive values,
        # we check nesting robustness
        state1 = StoryState("scene", {"dict_var": {"x": [1, 2]}})
        state2 = StoryState("scene", {"dict_var": {"x": [1, 2]}})
        self.assertEqual(state1, state2)
        self.assertEqual(hash(state1), hash(state2))


class TestConditionEvaluation(unittest.TestCase):
    def test_simple_operators(self):
        vars_dict = {"gold": 10, "has_key": True, "name": "Hero"}

        # Equals
        self.assertTrue(evaluate_condition({"variable": "gold", "operator": "==", "value": 10}, vars_dict))
        self.assertFalse(evaluate_condition({"variable": "gold", "operator": "==", "value": 5}, vars_dict))

        # Not equals
        self.assertTrue(evaluate_condition({"variable": "gold", "operator": "!=", "value": 5}, vars_dict))

        # Greater than / Less than
        self.assertTrue(evaluate_condition({"variable": "gold", "operator": ">", "value": 5}, vars_dict))
        self.assertTrue(evaluate_condition({"variable": "gold", "operator": ">=", "value": 10}, vars_dict))
        self.assertTrue(evaluate_condition({"variable": "gold", "operator": "<", "value": 15}, vars_dict))
        self.assertTrue(evaluate_condition({"variable": "gold", "operator": "<=", "value": 10}, vars_dict))

    def test_logical_operators(self):
        vars_dict = {"gold": 10, "has_key": True}

        # AND
        cond_and = {
            "and": [
                {"variable": "gold", "operator": ">=", "value": 10},
                {"variable": "has_key", "operator": "==", "value": True}
            ]
        }
        self.assertTrue(evaluate_condition(cond_and, vars_dict))

        cond_and_fail = {
            "and": [
                {"variable": "gold", "operator": ">", "value": 10},
                {"variable": "has_key", "operator": "==", "value": True}
            ]
        }
        self.assertFalse(evaluate_condition(cond_and_fail, vars_dict))

        # OR
        cond_or = {
            "or": [
                {"variable": "gold", "operator": ">", "value": 100},
                {"variable": "has_key", "operator": "==", "value": True}
            ]
        }
        self.assertTrue(evaluate_condition(cond_or, vars_dict))

        # NOT
        cond_not = {
            "not": {"variable": "gold", "operator": "==", "value": 5}
        }
        self.assertTrue(evaluate_condition(cond_not, vars_dict))

    def test_graceful_type_safety(self):
        vars_dict = {"gold": "lots of gold"}
        # Comparing string with int using inequality operator should not crash, but return False
        cond = {"variable": "gold", "operator": ">", "value": 5}
        self.assertFalse(evaluate_condition(cond, vars_dict))


class TestMutationLogic(unittest.TestCase):
    def test_basic_mutations(self):
        vars_dict = {"gold": 10, "has_key": False}

        # Set
        res = apply_mutations([{"variable": "has_key", "operation": "set", "value": True}], vars_dict)
        self.assertTrue(res["has_key"])

        # Add
        res = apply_mutations([{"variable": "gold", "operation": "add", "value": 5}], vars_dict)
        self.assertEqual(res["gold"], 15)

        # Sub
        res = apply_mutations([{"variable": "gold", "operation": "sub", "value": 2}], vars_dict)
        self.assertEqual(res["gold"], 8)

        # Mul
        res = apply_mutations([{"variable": "gold", "operation": "mul", "value": 3}], vars_dict)
        self.assertEqual(res["gold"], 30)

        # Div
        res = apply_mutations([{"variable": "gold", "operation": "div", "value": 2}], vars_dict)
        self.assertEqual(res["gold"], 5.0)

    def test_zero_division_safety(self):
        vars_dict = {"gold": 10}
        res = apply_mutations([{"variable": "gold", "operation": "div", "value": 0}], vars_dict)
        self.assertEqual(res["gold"], 10)


class TestStorySimulation(unittest.TestCase):
    def _load_fixture(self, name: str) -> Dict[str, Any]:
        path = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "fixtures", name)
        with open(path, "r", encoding="utf-8") as f:
            return json.load(f)

    def test_standard_branching(self):
        story = self._load_fixture("standard_branching.json")
        sim = NarrativeSimulator(story)
        res = sim.run()

        self.assertEqual(res["status"], "completed")
        self.assertFalse(res["limit_hit"])

        da = res["dynamic_analysis"]
        self.assertIn("victory", da["reachable_scenes"])
        self.assertIn("dragon_food", da["reachable_scenes"])
        self.assertEqual(len(da["unreachable_scenes"]), 0)
        self.assertEqual(len(da["unreachable_endings"]), 0)
        self.assertEqual(len(da["reachable_non_terminal_dead_ends"]), 0)
        self.assertEqual(len(da["soft_locks"]), 0)
        self.assertEqual(len(da["impossible_conditions"]), 0)

        # Check witness path to victory
        victory_path = da["witness_paths"]["victory"]
        self.assertEqual(len(victory_path), 4)
        self.assertEqual(victory_path[0]["scene"], "intro")
        self.assertEqual(victory_path[0]["choice"], "Go left to the armory")
        self.assertEqual(victory_path[1]["scene"], "armory")
        self.assertEqual(victory_path[1]["choice"], "Take the sword")
        self.assertEqual(victory_path[2]["scene"], "intro")
        self.assertEqual(victory_path[2]["choice"], "Go right to the treasure chamber")
        self.assertEqual(victory_path[3]["scene"], "treasure_room")
        self.assertEqual(victory_path[3]["choice"], "Fight the dragon with your sword")

    def test_soft_lock_detection(self):
        story = self._load_fixture("soft_lock.json")
        sim = NarrativeSimulator(story)
        res = sim.run()

        self.assertEqual(res["status"], "completed")
        da = res["dynamic_analysis"]

        # Trap room is a soft lock because no terminal state can be reached from it!
        soft_locks = da["soft_locks"]
        self.assertEqual(len(soft_locks), 1)
        self.assertEqual(soft_locks[0]["scene"], "trap_room")

        # Witness path to trap room
        self.assertEqual(len(soft_locks[0]["witness_path"]), 1)
        self.assertEqual(soft_locks[0]["witness_path"][0]["choice"], "Enter the dark trap room")

    def test_dead_end_detection(self):
        story = self._load_fixture("dead_end.json")
        sim = NarrativeSimulator(story)
        res = sim.run()

        self.assertEqual(res["status"], "completed")
        da = res["dynamic_analysis"]

        # Reachable non-terminal dead ends: empty_room and locked_room!
        dead_ends = da["reachable_non_terminal_dead_ends"]
        self.assertEqual(len(dead_ends), 2)
        de_scenes = [de["scene"] for de in dead_ends]
        self.assertIn("empty_room", de_scenes)
        self.assertIn("locked_room", de_scenes)

        # Impossible conditions: locked_room's choice index 0
        impossibles = da["impossible_conditions"]
        self.assertEqual(len(impossibles), 1)
        self.assertEqual(impossibles[0]["scene"], "locked_room")
        self.assertEqual(impossibles[0]["choice_index"], 0)

    def test_static_analysis_orphaned_variables(self):
        story = self._load_fixture("orphaned_variables.json")
        sim = NarrativeSimulator(story)
        res = sim.run()

        sa = res["static_analysis"]
        self.assertIn("undefined_var_1", sa["undefined_variables"])
        self.assertIn("undefined_var_2", sa["undefined_variables"])
        self.assertIn("unused_var", sa["unused_variables"])
        self.assertIn("ghost_scene", sa["invalid_transition_targets"])

    def test_cyclic_limits(self):
        story = self._load_fixture("cyclic.json")
        # Run with state limit of 5 to trigger limit hit (inconclusive)
        sim = NarrativeSimulator(story, max_states=5)
        res = sim.run()

        self.assertEqual(res["status"], "inconclusive")
        self.assertTrue(res["limit_hit"])
        self.assertIn("State limit", res["limit_reason"])


if __name__ == "__main__":
    unittest.main()
