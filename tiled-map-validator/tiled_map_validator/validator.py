import os
import json
from typing import List, Dict, Any, Optional, Set, Tuple

from .path_utils import is_case_sensitive_exact
from .image_utils import get_image_dimensions

# GID flags used by Tiled for flipped tiles
FLIP_FLAGS = 0x80000000 | 0x40000000 | 0x20000000 | 0x10000000

class TiledValidator:
    def __init__(self, config: Optional[Dict[str, Any]] = None):
        """
        Initialize validator with configuration.
        Config schema structure:
        {
            "required_layers": ["layer1", "layer2"],
            "allowed_object_types": ["type1", "type2"],
            "required_properties": {
                "map": ["prop1"],
                "layers": {
                    "layer_name": ["prop2"],
                    "*": ["prop3"]
                },
                "objects": {
                    "object_type": ["prop4"],
                    "*": ["prop5"]
                }
            }
        }
        """
        self.config = config or {}
        self.required_layers = self.config.get("required_layers", [])
        self.allowed_object_types = self.config.get("allowed_object_types", None)

        req_props = self.config.get("required_properties", {})
        self.required_map_properties = req_props.get("map", [])
        self.required_layer_properties = req_props.get("layers", {})
        self.required_object_properties = req_props.get("objects", {})

    def _add_finding(self, findings: List[Dict[str, Any]], filepath: str, severity: str, category: str, message: str, context: Optional[Dict[str, Any]] = None):
        findings.append({
            "file": filepath,
            "severity": severity,
            "category": category,
            "message": message,
            "context": context or {}
        })

    def _get_properties(self, obj: Dict[str, Any]) -> Dict[str, Any]:
        """
        Extract custom properties as a dict. Handles both modern list-of-dicts and legacy dict structures.
        """
        props = {}
        raw_props = obj.get("properties")
        if not raw_props:
            return props

        if isinstance(raw_props, list):
            for p in raw_props:
                if isinstance(p, dict) and "name" in p:
                    props[p["name"]] = p.get("value")
        elif isinstance(raw_props, dict):
            props = raw_props
        return props

    def validate_case_sensitive_path(self, base_path: str, rel_path: str) -> Tuple[bool, str]:
        """
        Resolves relative path from base_path, and checks case-sensitivity.
        Returns (exists_and_exact_case, resolved_absolute_path).
        """
        dir_name = os.path.dirname(base_path)
        resolved_path = os.path.normpath(os.path.join(dir_name, rel_path))
        return is_case_sensitive_exact(resolved_path), resolved_path

    def validate_tileset(self, tileset_path: str, embedded: bool = False, parent_map_path: Optional[str] = None) -> List[Dict[str, Any]]:
        """
        Validates a tileset (.tsj or embedded dict).
        """
        findings = []
        try:
            if not embedded:
                if not is_case_sensitive_exact(tileset_path):
                    self._add_finding(
                        findings, tileset_path, "error", "path",
                        f"Tileset file path is either missing or case-mismatched on disk: {tileset_path}"
                    )
                    return findings
                with open(tileset_path, 'r', encoding='utf-8') as f:
                    ts = json.load(f)
            else:
                ts = tileset_path  # embedded tileset is passed as dict
                tileset_path = parent_map_path or "embedded_tileset"
        except Exception as e:
            self._add_finding(
                findings, tileset_path, "error", "parse",
                f"Failed to parse tileset JSON: {str(e)}"
            )
            return findings

        # Basic validations
        tilewidth = ts.get("tilewidth")
        tileheight = ts.get("tileheight")
        if not tilewidth or not tileheight or tilewidth <= 0 or tileheight <= 0:
            self._add_finding(
                findings, tileset_path, "error", "dimension",
                f"Invalid or missing tile dimensions: tilewidth={tilewidth}, tileheight={tileheight}"
            )

        # Validate image reference if single-image tileset
        image_rel = ts.get("image")
        if image_rel:
            exists_and_cased, resolved_img_path = self.validate_case_sensitive_path(tileset_path, image_rel)
            if not exists_and_cased:
                self._add_finding(
                    findings, tileset_path, "error", "path",
                    f"Referenced image path '{image_rel}' is either missing or case-mismatched on disk.",
                    {"resolved_path": resolved_img_path}
                )
            else:
                # If image exists, verify image dimensions match JSON claims
                claimed_w = ts.get("imagewidth")
                claimed_h = ts.get("imageheight")
                actual_dims = get_image_dimensions(resolved_img_path)
                if actual_dims:
                    actual_w, actual_h = actual_dims
                    if claimed_w is not None and claimed_w != actual_w:
                        self._add_finding(
                            findings, tileset_path, "error", "dimension",
                            f"Tileset image width mismatch: JSON claims {claimed_w}px, actual is {actual_w}px.",
                            {"image": image_rel, "claimed_width": claimed_w, "actual_width": actual_w}
                        )
                    if claimed_h is not None and claimed_h != actual_h:
                        self._add_finding(
                            findings, tileset_path, "error", "dimension",
                            f"Tileset image height mismatch: JSON claims {claimed_h}px, actual is {actual_h}px.",
                            {"image": image_rel, "claimed_height": claimed_h, "actual_height": actual_h}
                        )
                else:
                    self._add_finding(
                        findings, tileset_path, "warning", "dimension",
                        f"Unable to verify dimensions for image '{image_rel}'."
                    )

        # Multi-image tileset (image collection)
        tiles_list = ts.get("tiles", [])
        if isinstance(tiles_list, list):
            for t in tiles_list:
                t_id = t.get("id")
                t_img = t.get("image")
                if t_img:
                    exists_and_cased, resolved_img_path = self.validate_case_sensitive_path(tileset_path, t_img)
                    if not exists_and_cased:
                        self._add_finding(
                            findings, tileset_path, "error", "path",
                            f"Tileset tile ID {t_id} referenced image path '{t_img}' is either missing or case-mismatched.",
                            {"tile_id": t_id, "resolved_path": resolved_img_path}
                        )
                    else:
                        claimed_w = t.get("imagewidth")
                        claimed_h = t.get("imageheight")
                        actual_dims = get_image_dimensions(resolved_img_path)
                        if actual_dims:
                            actual_w, actual_h = actual_dims
                            if claimed_w is not None and claimed_w != actual_w:
                                self._add_finding(
                                    findings, tileset_path, "error", "dimension",
                                    f"Tile ID {t_id} image width mismatch: JSON claims {claimed_w}px, actual is {actual_w}px.",
                                    {"tile_id": t_id, "image": t_img, "claimed_width": claimed_w, "actual_width": actual_w}
                                )
                            if claimed_h is not None and claimed_h != actual_h:
                                self._add_finding(
                                    findings, tileset_path, "error", "dimension",
                                    f"Tile ID {t_id} image height mismatch: JSON claims {claimed_h}px, actual is {actual_h}px.",
                                    {"tile_id": t_id, "image": t_img, "claimed_height": claimed_h, "actual_height": actual_h}
                                )

        return findings

    def validate_map(self, map_path: str) -> List[Dict[str, Any]]:
        findings = []
        if not is_case_sensitive_exact(map_path):
            self._add_finding(
                findings, map_path, "error", "path",
                f"Map file path is either missing or case-mismatched on disk: {map_path}"
            )
            return findings

        try:
            with open(map_path, 'r', encoding='utf-8') as f:
                map_data = json.load(f)
        except Exception as e:
            self._add_finding(
                findings, map_path, "error", "parse",
                f"Failed to parse map JSON: {str(e)}"
            )
            return findings

        # Check required map custom properties
        map_props = self._get_properties(map_data)
        for req_p in self.required_map_properties:
            if req_p not in map_props:
                self._add_finding(
                    findings, map_path, "error", "property",
                    f"Map is missing required custom property '{req_p}'."
                )

        # Resolve firstgids across all tilesets
        # A map can have a list of tilesets. Each tileset entry has:
        # - firstgid (integer)
        # - source (relative path to external tileset .tsj)
        # OR it is embedded and contains the entire tileset definition directly.
        tileset_entries = map_data.get("tilesets", [])
        resolved_tilesets = [] # List of tuples: (firstgid, lastgid, tilecount, name/source)

        for i, ts_entry in enumerate(tileset_entries):
            firstgid = ts_entry.get("firstgid")
            if firstgid is None:
                self._add_finding(
                    findings, map_path, "error", "tileset",
                    f"Tileset entry index {i} is missing 'firstgid'.",
                    {"index": i}
                )
                continue

            source = ts_entry.get("source")
            tileset_dict = None
            ts_filepath = map_path

            if source:
                # External tileset
                exists_and_cased, resolved_ts_path = self.validate_case_sensitive_path(map_path, source)
                if not exists_and_cased:
                    self._add_finding(
                        findings, map_path, "error", "path",
                        f"External tileset path '{source}' is either missing or case-mismatched on disk.",
                        {"source": source, "resolved_path": resolved_ts_path}
                    )
                    # We can't validate the GIDs for this tileset accurately if we can't load it,
                    # but let's try to proceed.
                    continue
                else:
                    # Validate the external tileset file itself!
                    ts_findings = self.validate_tileset(resolved_ts_path)
                    findings.extend(ts_findings)

                    # Read the tileset contents to get tilecount
                    try:
                        with open(resolved_ts_path, 'r', encoding='utf-8') as f:
                            tileset_dict = json.load(f)
                        ts_filepath = resolved_ts_path
                    except Exception as e:
                        self._add_finding(
                            findings, map_path, "error", "parse",
                            f"Failed to read external tileset file '{source}': {str(e)}"
                        )
                        continue
            else:
                # Embedded tileset
                tileset_dict = ts_entry
                # Validate embedded tileset
                ts_findings = self.validate_tileset(ts_entry, embedded=True, parent_map_path=map_path)
                findings.extend(ts_findings)

            if tileset_dict:
                tilecount = tileset_dict.get("tilecount")
                # If tilecount is not specified, calculate it if possible
                if tilecount is None:
                    # For single-image tileset, tilecount can be computed as:
                    # floor((imagewidth - 2*margin + spacing) / (tilewidth + spacing)) * ...
                    # But standard Tiled JSON maps almost always have tilecount.
                    # Let's fallback or report error if we can't find it.
                    tilecount = 0
                    image_width = tileset_dict.get("imagewidth")
                    image_height = tileset_dict.get("imageheight")
                    t_width = tileset_dict.get("tilewidth")
                    t_height = tileset_dict.get("tileheight")
                    margin = tileset_dict.get("margin", 0)
                    spacing = tileset_dict.get("spacing", 0)

                    if image_width and image_height and t_width and t_height:
                        cols = (image_width - 2 * margin + spacing) // (t_width + spacing)
                        rows = (image_height - 2 * margin + spacing) // (t_height + spacing)
                        tilecount = cols * rows
                    else:
                        # Collection of images tilecount is tiles list length
                        tiles_list = tileset_dict.get("tiles", [])
                        if isinstance(tiles_list, list):
                            tilecount = len(tiles_list)

                if tilecount == 0 or tilecount is None:
                    self._add_finding(
                        findings, ts_filepath, "error", "tileset",
                        "Tileset has 0 tilecount or is missing tilecount details."
                    )
                    tilecount = 0

                lastgid = firstgid + tilecount - 1
                resolved_tilesets.append({
                    "firstgid": firstgid,
                    "lastgid": lastgid,
                    "tilecount": tilecount,
                    "source": source or "embedded",
                    "name": tileset_dict.get("name", "unnamed")
                })

        # Pre-extract tileset range tuples and initialize GID lookup cache
        # Performance optimization: avoids dictionary key lookups and repeated range linear scans per tile GID
        ts_ranges = [(r["firstgid"], r["lastgid"]) for r in resolved_tilesets]
        gid_cache: Dict[int, bool] = {}

        def check_gid_valid(clean_gid: int) -> bool:
            valid = gid_cache.get(clean_gid)
            if valid is None:
                valid = False
                for fg, lg in ts_ranges:
                    if fg <= clean_gid <= lg:
                        valid = True
                        break
                gid_cache[clean_gid] = valid
            return valid

        # Validate layers
        layers = map_data.get("layers", [])
        layer_names = []
        object_ids = set()

        def validate_layer_recursive(layer_list: List[Dict[str, Any]], parent_context: Optional[str] = None):
            for layer in layer_list:
                l_name = layer.get("name", "unnamed")
                l_type = layer.get("type")
                layer_names.append(l_name)

                layer_ctx = f"layer '{l_name}'"
                if parent_context:
                    layer_ctx = f"{parent_context} -> {layer_ctx}"

                # Validate layer custom properties
                l_props = self._get_properties(layer)
                # Check wildcard layer properties
                wildcard_reqs = self.required_layer_properties.get("*", [])
                for wp in wildcard_reqs:
                    if wp not in l_props:
                        self._add_finding(
                            findings, map_path, "error", "property",
                            f"Layer '{l_name}' is missing required custom property '{wp}' ({layer_ctx}).",
                            {"layer": l_name}
                        )
                # Check specific layer properties
                specific_reqs = self.required_layer_properties.get(l_name, [])
                for sp in specific_reqs:
                    if sp not in l_props:
                        self._add_finding(
                            findings, map_path, "error", "property",
                            f"Layer '{l_name}' is missing required custom property '{sp}' ({layer_ctx}).",
                            {"layer": l_name}
                        )

                # Validate dimensions for Tile Layer
                if l_type == "tilelayer":
                    # Check dimensions match map or chunk definitions
                    l_width = layer.get("width")
                    l_height = layer.get("height")

                    # Finite map vs Infinite map
                    is_infinite = map_data.get("infinite", False)
                    if not is_infinite:
                        # Check finite layer width/height match map width/height
                        map_w = map_data.get("width")
                        map_h = map_data.get("height")
                        if l_width != map_w or l_height != map_h:
                            self._add_finding(
                                findings, map_path, "error", "dimension",
                                f"Layer '{l_name}' dimensions ({l_width}x{l_height}) mismatch map dimensions ({map_w}x{map_h}).",
                                {"layer": l_name, "layer_width": l_width, "layer_height": l_height, "map_width": map_w, "map_height": map_h}
                            )

                        # Validate GIDs in data
                        gids = layer.get("data")
                        if not isinstance(gids, list):
                            self._add_finding(
                                findings, map_path, "error", "layer",
                                f"Layer '{l_name}' has invalid or missing 'data' field.",
                                {"layer": l_name}
                            )
                        else:
                            expected_len = (l_width or 0) * (l_height or 0)
                            if len(gids) != expected_len:
                                self._add_finding(
                                    findings, map_path, "error", "dimension",
                                    f"Layer '{l_name}' data size ({len(gids)}) mismatches expected dimension-based size ({expected_len}).",
                                    {"layer": l_name, "expected": expected_len, "actual": len(gids)}
                                )

                            for idx, raw_gid in enumerate(gids):
                                clean_gid = raw_gid & ~FLIP_FLAGS
                                if clean_gid == 0:
                                    continue
                                # Validate GID is covered by tilesets (using memoized cache)
                                if not check_gid_valid(clean_gid):
                                    x = idx % l_width if l_width else 0
                                    y = idx // l_width if l_width else 0
                                    self._add_finding(
                                        findings, map_path, "error", "gid",
                                        f"Layer '{l_name}' has invalid GID {clean_gid} (raw: {raw_gid}) at index {idx} (tile coordinates: {x}, {y}).",
                                        {"layer": l_name, "coordinate": [x, y], "gid": clean_gid, "raw_gid": raw_gid}
                                    )
                    else:
                        # Infinite map
                        chunks = layer.get("chunks", [])
                        if not isinstance(chunks, list):
                            self._add_finding(
                                findings, map_path, "error", "layer",
                                f"Infinite layer '{l_name}' has invalid or missing 'chunks' field.",
                                {"layer": l_name}
                            )
                        else:
                            for c_idx, chunk in enumerate(chunks):
                                c_x = chunk.get("x")
                                c_y = chunk.get("y")
                                c_w = chunk.get("width")
                                c_h = chunk.get("height")
                                c_data = chunk.get("data")

                                chunk_ctx = f"chunk index {c_idx} at offset ({c_x}, {c_y})"
                                if not isinstance(c_data, list):
                                    self._add_finding(
                                        findings, map_path, "error", "layer",
                                        f"Layer '{l_name}' chunk at ({c_x}, {c_y}) has invalid or missing 'data' field.",
                                        {"layer": l_name, "chunk_index": c_idx, "coordinate": [c_x, c_y]}
                                    )
                                    continue

                                expected_len = (c_w or 0) * (c_h or 0)
                                if len(c_data) != expected_len:
                                    self._add_finding(
                                        findings, map_path, "error", "dimension",
                                        f"Layer '{l_name}' chunk at ({c_x}, {c_y}) data size ({len(c_data)}) mismatches expected dimensions ({c_w}x{c_h}).",
                                        {"layer": l_name, "chunk_index": c_idx, "expected": expected_len, "actual": len(c_data)}
                                    )

                                for idx, raw_gid in enumerate(c_data):
                                    clean_gid = raw_gid & ~FLIP_FLAGS
                                    if clean_gid == 0:
                                        continue
                                    # Validate GID (using memoized cache)
                                    if not check_gid_valid(clean_gid):
                                        tile_x = (c_x or 0) + (idx % c_w if c_w else 0)
                                        tile_y = (c_y or 0) + (idx // c_w if c_w else 0)
                                        self._add_finding(
                                            findings, map_path, "error", "gid",
                                            f"Layer '{l_name}' infinite map chunk has invalid GID {clean_gid} (raw: {raw_gid}) at tile coordinate ({tile_x}, {tile_y}).",
                                            {"layer": l_name, "chunk_index": c_idx, "coordinate": [tile_x, tile_y], "gid": clean_gid, "raw_gid": raw_gid}
                                        )

                elif l_type == "objectgroup":
                    objects = layer.get("objects", [])
                    if not isinstance(objects, list):
                        self._add_finding(
                            findings, map_path, "error", "layer",
                            f"Layer '{l_name}' is an object group but has invalid or missing 'objects' field.",
                            {"layer": l_name}
                        )
                    else:
                        for obj in objects:
                            obj_id = obj.get("id")
                            obj_name = obj.get("name", "unnamed")
                            obj_type = obj.get("type") or obj.get("class")  # newer versions of Tiled use 'class' instead of 'type'

                            obj_ctx = f"object '{obj_name}' (ID {obj_id}) in layer '{l_name}'"

                            # Check duplicate Object IDs
                            if obj_id is not None:
                                if obj_id in object_ids:
                                    self._add_finding(
                                        findings, map_path, "error", "object_id",
                                        f"Duplicate Object ID {obj_id} detected on {obj_ctx}.",
                                        {"object_id": obj_id, "object_name": obj_name, "layer": l_name}
                                    )
                                else:
                                    object_ids.add(obj_id)
                            else:
                                self._add_finding(
                                    findings, map_path, "warning", "object",
                                    f"Object '{obj_name}' is missing an ID field in layer '{l_name}'.",
                                    {"object_name": obj_name, "layer": l_name}
                                )

                            # Validate GID of object if it's a tile object
                            obj_gid_raw = obj.get("gid")
                            if obj_gid_raw is not None:
                                obj_gid = obj_gid_raw & ~FLIP_FLAGS
                                if obj_gid > 0:
                                    if not check_gid_valid(obj_gid):
                                        self._add_finding(
                                            findings, map_path, "error", "gid",
                                            f"Object '{obj_name}' has invalid GID {obj_gid} (raw: {obj_gid_raw}) in layer '{l_name}'.",
                                            {"object_id": obj_id, "object_name": obj_name, "layer": l_name, "gid": obj_gid}
                                        )

                            # Validate object custom properties
                            obj_props = self._get_properties(obj)
                            # Check wildcard object properties
                            wildcard_reqs = self.required_object_properties.get("*", [])
                            for wp in wildcard_reqs:
                                if wp not in obj_props:
                                    self._add_finding(
                                        findings, map_path, "error", "property",
                                        f"Object '{obj_name}' is missing required custom property '{wp}' ({obj_ctx}).",
                                        {"object_id": obj_id, "object_name": obj_name, "layer": l_name, "property": wp}
                                    )
                            # Check specific object type properties
                            if obj_type:
                                specific_reqs = self.required_object_properties.get(obj_type, [])
                                for sp in specific_reqs:
                                    if sp not in obj_props:
                                        self._add_finding(
                                            findings, map_path, "error", "property",
                                            f"Object '{obj_name}' of type '{obj_type}' is missing required custom property '{sp}' ({obj_ctx}).",
                                            {"object_id": obj_id, "object_name": obj_name, "layer": l_name, "type": obj_type, "property": sp}
                                        )

                            # Validate allowed object types list
                            if self.allowed_object_types is not None:
                                # If obj_type is empty/none, it's considered un-typed
                                if obj_type not in self.allowed_object_types:
                                    self._add_finding(
                                        findings, map_path, "error", "object_type",
                                        f"Object '{obj_name}' has unconfigured or disallowed type '{obj_type}' in layer '{l_name}'.",
                                        {"object_id": obj_id, "object_name": obj_name, "layer": l_name, "type": obj_type}
                                    )

                elif l_type == "group":
                    group_layers = layer.get("layers", [])
                    if isinstance(group_layers, list):
                        validate_layer_recursive(group_layers, parent_context=layer_ctx)

        validate_layer_recursive(layers)

        # Check required layers exist
        for req_l in self.required_layers:
            if req_l not in layer_names:
                self._add_finding(
                    findings, map_path, "error", "layer",
                    f"Map is missing required layer '{req_l}'."
                )

        return findings
