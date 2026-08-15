import os

def is_case_sensitive_exact(path: str) -> bool:
    """
    Returns True if the absolute path exists and its casing matches the filesystem exactly.
    Returns False otherwise.
    """
    abs_path = os.path.abspath(path)
    if not os.path.exists(abs_path):
        return False

    # Split into drive and path
    drive, path_part = os.path.splitdrive(abs_path)

    # Split path_part into components
    parts = [p for p in path_part.replace('\\', '/').split('/') if p]

    # Start traversing from the root
    current = drive + '/' if drive else '/'
    if not os.path.isdir(current):
        if os.name == 'nt' and not drive:
            current = '/'

    for part in parts:
        try:
            entries = os.listdir(current)
        except OSError:
            return False

        if part not in entries:
            return False

        current = os.path.join(current, part)

    return True
