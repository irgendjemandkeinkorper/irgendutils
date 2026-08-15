# Tiled Map & Tileset Validator

A zero-dependency Python CLI tool that validates Tiled TMJ/TSJ JSON maps and referenced assets before a 2D game build. It is designed to be integrated into CI/CD pipelines to catch bad assets and broken configurations early.

## Features

- **Case-Sensitive Casing Verification**: Performs exact case-sensitive path validation on cross-platform systems, ensuring that assets resolved correctly on a case-insensitive OS (like macOS/Windows) don't break on a case-sensitive build server (like Linux).
- **Embedded or External Tilesets (`.tsj`)**: Supports both inline (embedded) and external tilesets, correctly tracing paths relative to parent files.
- **Header-Based Image Dimension Parsing**: Reads PNG, JPEG, GIF, and WebP image headers directly in pure Python without calling heavy external libraries like Pillow, ensuring extremely fast execution and no dependencies.
- **GID Verification**: Resolves `firstgid` ranges across multiple tilesets, strips out flip flags (diagonal, vertical, horizontal, hex), and verifies that layer tile GIDs fall strictly inside the defined tilesets' actual boundaries.
- **Duplicate Object ID Check**: Identifies if multiple objects have duplicate IDs, which can break map indexing.
- **Dimension Check**: Detects mismatching chunk sizes, layer sizes versus map sizes, and actual image sizes versus tileset claims.
- **Finite & Infinite Maps**: Full support for both classic finite maps and infinite maps (where layers are defined as chunks).
- **Custom Validation Config Rules**: Allows enforcing required layers, allowed object types, and required custom properties for maps, layers, and objects.

---

## Configuration Schema

You can provide a JSON configuration file via the `--config` / `-c` flag to enforce specific requirements:

```json
{
  "required_layers": ["ground", "entities"],
  "allowed_object_types": ["spawnpoint"],
  "required_properties": {
    "map": ["difficulty"],
    "layers": {
      "ground": ["is_walkable"]
    },
    "objects": {
      "spawnpoint": ["team"]
    }
  }
}
```

- `required_layers`: A list of layers that must exist in every validated map.
- `allowed_object_types`: If specified, any object with a type/class not in this list triggers a validation error.
- `required_properties`: Custom properties that must be configured.
  - `map`: Required properties on the map root.
  - `layers`: Supports specific layer names (e.g. `"ground"`) or a wildcard `"*"` for all layers.
  - `objects`: Supports specific object types (e.g. `"spawnpoint"`) or a wildcard `"*"` for all objects.

---

## Exit Codes

- `0`: Validation passed successfully (no errors; warnings may exist).
- `1`: Validation failed (one or more validation errors).
- `2`: System error (missing target path, bad configuration syntax, unreadable files).

---

## Usage

Run the validator by passing a map file (`.tmj`), a tileset file (`.tsj`), or a directory path to recursively scan:

### Pretty Print Mode (Default)
```bash
python3 -m tiled_map_validator.cli path/to/map.tmj -c config.json
```

### Machine-Readable JSON Mode
```bash
python3 -m tiled_map_validator.cli path/to/project_dir -c config.json --format json
```

### Example JSON Output

```json
{
  "success": false,
  "scanned_files": [
    "tiled-map-validator/fixtures/broken/map_broken_rules.tmj"
  ],
  "summary": {
    "errors": 2,
    "warnings": 0,
    "total_findings": 2
  },
  "findings": [
    {
      "file": "tiled-map-validator/fixtures/broken/map_broken_rules.tmj",
      "severity": "error",
      "category": "gid",
      "message": "Layer 'ground' has invalid GID 10 (raw: 10) at index 3 (tile coordinates: 3, 0).",
      "context": {
        "layer": "ground",
        "coordinate": [3, 0],
        "gid": 10,
        "raw_gid": 10
      }
    },
    {
      "file": "tiled-map-validator/fixtures/broken/map_broken_rules.tmj",
      "severity": "error",
      "category": "object_id",
      "message": "Duplicate Object ID 1 detected on object 'duplicate_id_obj' (ID 1) in layer 'entities'.",
      "context": {
        "object_id": 1,
        "object_name": "duplicate_id_obj",
        "layer": "entities"
      }
    }
  ]
}
```

---

## Development & Testing

To run the unit test suite:
```bash
PYTHONPATH=tiled-map-validator python3 -m unittest discover -s tiled-map-validator/tests/
```
