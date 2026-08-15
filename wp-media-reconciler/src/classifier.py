import os
from pathlib import Path
from collections import defaultdict
from .normalizer import parse_wp_suffix, normalize_url_to_path
from .parser import Reference, MEDIA_EXTENSIONS

class MediaFamily:
    def __init__(self, parent_path: str):
        self.parent_path = parent_path         # Relative path (e.g., "2023/01/image.jpg")
        self.parent_exists_on_disk = False
        self.parent_size = 0
        self.derivatives = {}                  # suffix (e.g. "150x150") -> (relative_path, size)
        self.references = []                   # List of Reference objects directly matching this family
        self.associated_references = []        # References to siblings/parent within the same family

    @property
    def is_referenced(self) -> bool:
        return len(self.references) > 0 or len(self.associated_references) > 0

    def add_reference(self, ref: Reference, is_direct: bool = True):
        if is_direct:
            self.references.append(ref)
        else:
            self.associated_references.append(ref)


class ReconciliationEngine:
    def __init__(self, uploads_dir: Path, old_url: str = None, new_url: str = None):
        self.uploads_dir = Path(uploads_dir).resolve()
        self.old_url = old_url
        self.new_url = new_url

        # Disk inventory
        self.all_files_on_disk = set()         # Set of relative paths (forward slashes)
        self.file_sizes = {}                   # relative_path -> size in bytes
        self.families = {}                     # parent_path -> MediaFamily

        # File indexes for heuristics & collisions
        self.filename_to_paths = defaultdict(list)    # filename (lowercase) -> list of relative paths
        self.path_lowercase_map = {}                 # relative_path_lowercase -> exact_relative_path

    def build_disk_inventory(self):
        """
        Scans the uploads directory recursively and builds physical media families.
        """
        if not self.uploads_dir.exists():
            print(f"Warning: Uploads directory {self.uploads_dir} does not exist.")
            return

        # 1. Walk directory and collect all files
        for root, _, files in os.walk(self.uploads_dir):
            for file in files:
                # Filter out system files or hidden files
                if file.startswith('.') or file.lower() == 'web.config' or file.lower() == 'index.php':
                    continue

                file_path = Path(root) / file
                try:
                    rel_path = file_path.relative_to(self.uploads_dir).as_posix()
                except ValueError:
                    continue

                self.all_files_on_disk.add(rel_path)
                try:
                    self.file_sizes[rel_path] = file_path.stat().st_size
                except OSError:
                    self.file_sizes[rel_path] = 0

                # Indexes for collisions and case checks
                filename_lower = file.lower()
                self.filename_to_paths[filename_lower].append(rel_path)
                self.path_lowercase_map[rel_path.lower()] = rel_path

        # 2. Group into Media Families
        for rel_path in sorted(self.all_files_on_disk):
            parent_path, suffix = parse_wp_suffix(rel_path)

            if suffix:
                # Check if parent is actually on disk
                if parent_path in self.all_files_on_disk:
                    # Valid derivative. Ensure parent family exists and register
                    if parent_path not in self.families:
                        self.families[parent_path] = MediaFamily(parent_path)

                    self.families[parent_path].derivatives[suffix] = (rel_path, self.file_sizes[rel_path])
                else:
                    # Parent is missing from disk!
                    # Ensure a family exists for this missing parent so we can track references or flag as broken
                    if parent_path not in self.families:
                        self.families[parent_path] = MediaFamily(parent_path)
                        self.families[parent_path].parent_exists_on_disk = False

                    self.families[parent_path].derivatives[suffix] = (rel_path, self.file_sizes[rel_path])
            else:
                # This is a parent file
                if rel_path not in self.families:
                    self.families[rel_path] = MediaFamily(rel_path)

                self.families[rel_path].parent_exists_on_disk = True
                self.families[rel_path].parent_size = self.file_sizes[rel_path]

    def reconcile(self, references: list[Reference], attachment_id_to_path: dict[int, str]) -> dict:
        """
        Performs the reconciliation matching references against the disk inventory.
        """
        # Resolve any featured image or attachment ID references first
        resolved_references = []
        for ref in references:
            if ref.normalized_path.startswith("__ID_REF__"):
                try:
                    feat_id = int(ref.normalized_path.split("__ID_REF__")[1])
                    if feat_id in attachment_id_to_path:
                        ref.normalized_path = attachment_id_to_path[feat_id]
                        resolved_references.append(ref)
                    else:
                        # ID reference could not be resolved
                        ref.evidence_type = "Exact"
                        ref.context = "Unresolved Attachment ID Reference"
                        resolved_references.append(ref)
                except ValueError:
                    resolved_references.append(ref)
            else:
                resolved_references.append(ref)

        # We will track references matched to families, missing files, and heuristic matches
        missing_files = defaultdict(list)   # target_path -> list of Reference
        exact_present_files = set()          # Set of relative paths that are explicitly referenced & present
        heuristic_matches = defaultdict(list) # target_path -> list of Reference (matched heuristically)

        for ref in resolved_references:
            if not ref.normalized_path or ref.normalized_path.startswith("__ID_REF__"):
                # Skip empty or unresolved ID references from matching files on disk
                if ref.normalized_path.startswith("__ID_REF__"):
                    missing_files[ref.normalized_path].append(ref)
                continue

            ref_path = ref.normalized_path
            ref_parent, ref_suffix = parse_wp_suffix(ref_path)

            # 1. Check for Exact Case-Sensitive Match on Disk
            if ref_path in self.all_files_on_disk:
                exact_present_files.add(ref_path)

                # Match to the family
                if ref_parent not in self.families:
                    # Self-contained family if parent is missing or not registered
                    self.families[ref_parent] = MediaFamily(ref_parent)
                self.families[ref_parent].add_reference(ref, is_direct=True)

            # 2. Check Case-Insensitive Match (Case Conflict)
            elif ref_path.lower() in self.path_lowercase_map:
                actual_path = self.path_lowercase_map[ref_path.lower()]
                exact_present_files.add(actual_path)

                # Treat as Heuristic due to case differences (it works on case-insensitive filesystems, but can fail on production)
                ref.evidence_type = "Heuristic"
                ref.context = f"Case-insensitive match (Casing on disk: '{actual_path}')"

                actual_parent, _ = parse_wp_suffix(actual_path)
                if actual_parent not in self.families:
                    self.families[actual_parent] = MediaFamily(actual_parent)
                self.families[actual_parent].add_reference(ref, is_direct=True)

                heuristic_matches[actual_path].append(ref)

            # 3. Check Heuristic Filename Match (Filename exists, but path/directory is different)
            else:
                ref_filename = Path(ref_path).name.lower()
                matched_paths = self.filename_to_paths.get(ref_filename, [])

                if matched_paths:
                    # Found the file elsewhere on disk!
                    for matched_path in matched_paths:
                        exact_present_files.add(matched_path)

                        # Clone reference to mark as heuristic match
                        heuristic_ref = Reference(ref.raw_value, ref.source, "Heuristic", f"Filename match at different path: '{matched_path}'")
                        heuristic_ref.normalized_path = matched_path

                        m_parent, _ = parse_wp_suffix(matched_path)
                        if m_parent not in self.families:
                            self.families[m_parent] = MediaFamily(m_parent)
                        self.families[m_parent].add_reference(heuristic_ref, is_direct=True)
                        heuristic_matches[matched_path].append(heuristic_ref)
                else:
                    # No exact path, no case-insensitive, no filename match -> Definitely Missing!
                    missing_files[ref_path].append(ref)

        # Ensure all other files in a referenced family are flagged as "used by association"
        # If parent or any derivative is referenced, the entire family is considered referenced
        referenced_families = [fam for fam in self.families.values() if fam.is_referenced]
        for fam in referenced_families:
            # Gather all references for this family to share with association list
            all_fam_refs = fam.references + fam.associated_references

            # If any family member is referenced, mark all physically present members as present in exact_present_files
            if fam.parent_exists_on_disk:
                exact_present_files.add(fam.parent_path)

            for deriv_suffix, (deriv_path, _) in fam.derivatives.items():
                exact_present_files.add(deriv_path)

                # Back-propagate referenced-by-association references to individual family members
                if not any(r.normalized_path == deriv_path for r in fam.references):
                    # Register an associated reference
                    association_ref = Reference(
                        raw_value=fam.parent_path,
                        source=f"Family association via parent '{fam.parent_path}'",
                        evidence_type="Heuristic",
                        context=f"Derivative '{deriv_suffix}' used by family association"
                    )
                    association_ref.normalized_path = deriv_path
                    fam.add_reference(association_ref, is_direct=False)

        # Now group the findings into final classifications:

        # 1. Referenced & Present
        referenced_and_present = []
        for path in sorted(exact_present_files):
            # Find references associated with this path
            path_parent, path_suffix = parse_wp_suffix(path)
            fam = self.families.get(path_parent)
            refs = []
            if fam:
                refs = [r for r in fam.references + fam.associated_references if r.normalized_path == path]

            referenced_and_present.append({
                "file_path": path,
                "file_size": self.file_sizes.get(path, 0),
                "is_derivative": path_suffix is not None,
                "parent_path": path_parent if path_suffix else None,
                "references": [
                    {
                        "source": r.source,
                        "raw_value": r.raw_value,
                        "evidence_type": r.evidence_type,
                        "context": r.context
                    } for r in refs
                ]
            })

        # 2. Missing Files
        missing_report = []
        for path, refs in sorted(missing_files.items()):
            path_parent, path_suffix = parse_wp_suffix(path)

            # Check for name-only heuristic matches anywhere on disk
            ref_filename = Path(path).name.lower()
            heuristics_on_disk = self.filename_to_paths.get(ref_filename, [])

            missing_report.append({
                "referenced_path": path,
                "is_derivative": path_suffix is not None,
                "parent_path": path_parent if path_suffix else None,
                "type": "Missing Derivative" if path_suffix else "Missing Original",
                "heuristic_candidates": heuristics_on_disk,
                "references": [
                    {
                        "source": r.source,
                        "raw_value": r.raw_value,
                        "evidence_type": r.evidence_type,
                        "context": r.context
                    } for r in refs
                ]
            })

        # 3. Unused Candidates
        unused_candidates = []
        for path in sorted(self.all_files_on_disk):
            if path not in exact_present_files:
                # Double-check that parent is not referenced
                path_parent, path_suffix = parse_wp_suffix(path)
                fam = self.families.get(path_parent)

                # If there's a family and it is referenced, then this file is NOT unused!
                if fam and fam.is_referenced:
                    continue

                unused_candidates.append({
                    "file_path": path,
                    "file_size": self.file_sizes.get(path, 0),
                    "is_derivative": path_suffix is not None,
                    "parent_path": path_parent if path_suffix else None
                })

        # 4. Broken Derivatives
        broken_derivatives = []
        for path in sorted(self.all_files_on_disk):
            path_parent, path_suffix = parse_wp_suffix(path)
            if path_suffix:
                # A derivative is broken if its parent is NOT on disk
                if path_parent not in self.all_files_on_disk:
                    fam = self.families.get(path_parent)
                    is_used = fam.is_referenced if fam else False

                    broken_derivatives.append({
                        "file_path": path,
                        "file_size": self.file_sizes.get(path, 0),
                        "parent_path": path_parent,
                        "is_used": is_used
                    })

        # 5. Filename Collisions
        collisions = []
        # Find cases where identical filenames exist in different folders (ignoring case)
        # or case-mismatched files in same folder (e.g., Image.jpg and image.jpg)
        for filename_lower, paths in sorted(self.filename_to_paths.items()):
            if len(paths) > 1:
                collisions.append({
                    "filename": filename_lower,
                    "matching_paths": paths,
                    "type": "Case Conflict" if len(set(p.lower() for p in paths)) == 1 else "Path Divergence"
                })

        return {
            "summary": {
                "total_files_on_disk": len(self.all_files_on_disk),
                "total_referenced_and_present": len(referenced_and_present),
                "total_missing_files": len(missing_report),
                "total_unused_candidates": len(unused_candidates),
                "total_broken_derivatives": len(broken_derivatives),
                "total_collisions": len(collisions),
            },
            "referenced_and_present": referenced_and_present,
            "missing_files": missing_report,
            "unused_candidates": unused_candidates,
            "broken_derivatives": broken_derivatives,
            "collisions": collisions
        }
