import re
from urllib.parse import urlparse, unquote
from pathlib import Path

# Regular expression to match WordPress image size suffixes (e.g., -150x150.jpg, -1024x768.png.webp)
# Matches a hyphen followed by digits x digits and then one or more 2-5 character alphanumeric extension segments
SUFFIX_REGEX = re.compile(r'-(\d+x\d+)((?:\.[a-zA-Z0-9]{2,5})+)$', re.IGNORECASE)

def normalize_url_to_path(url: str, old_url: str = None, new_url: str = None) -> str:
    """
    Normalizes a URL or path to a relative path within the wp-content/uploads/ directory.
    Decodes URL encoding and strips domains/base URLs.

    Examples:
    - "https://site.com/wp-content/uploads/2023/01/img.jpg" -> "2023/01/img.jpg"
    - "/wp-content/uploads/2023/01/img.jpg" -> "2023/01/img.jpg"
    - "2023/01/img.jpg" -> "2023/01/img.jpg"
    """
    if not url:
        return ""

    # 1. URL Decode (unquote)
    decoded_url = unquote(url.strip())

    # 2. Strip specified base URLs if present
    for base in filter(None, [old_url, new_url]):
        base_unquoted = unquote(base.strip())
        if decoded_url.startswith(base_unquoted):
            decoded_url = decoded_url[len(base_unquoted):]

    # 3. Handle standard wp-content/uploads path structure
    # If the URL contains "wp-content/uploads/", extract everything after it
    uploads_marker = "/wp-content/uploads/"
    if uploads_marker in decoded_url:
        _, _, relative_part = decoded_url.partition(uploads_marker)
        decoded_url = relative_part
    elif "wp-content/uploads/" in decoded_url:
        _, _, relative_part = decoded_url.partition("wp-content/uploads/")
        decoded_url = relative_part

    # 4. Clean up any remaining leading slashes or query parameters / hashes
    parsed = urlparse(decoded_url)
    path_part = parsed.path

    # Strip leading and trailing slashes for consistency
    normalized = path_part.lstrip("/")

    return normalized

def parse_wp_suffix(path_str: str) -> tuple[str, str | None]:
    """
    Parses a path and checks if it ends with a WordPress image size suffix (e.g., -300x200).
    If it matches, returns (parent_path, suffix_dimensions).
    Otherwise, returns (original_path, None).

    Example:
    - "2023/01/image-150x150.jpg" -> ("2023/01/image.jpg", "150x150")
    - "2023/01/image.jpg" -> ("2023/01/image.jpg", None)
    """
    if not path_str:
        return "", None

    path_obj = Path(path_str)
    filename = path_obj.name

    match = SUFFIX_REGEX.search(filename)
    if match:
        suffix = match.group(1)
        ext = match.group(2)

        # Reconstruct base filename without suffix
        base_filename = SUFFIX_REGEX.sub(r"\2", filename)
        parent_path = str(path_obj.with_name(base_filename)).replace("\\", "/")
        return parent_path, suffix

    return path_str.replace("\\", "/"), None
