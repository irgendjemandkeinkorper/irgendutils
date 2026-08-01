import re
import json
import xml.etree.ElementTree as ET
from pathlib import Path
from .normalizer import normalize_url_to_path, parse_wp_suffix

# Common image/media file extensions in WordPress
MEDIA_EXTENSIONS = (
    '.jpg', '.jpeg', '.png', '.gif', '.webp', '.heic', '.pdf',
    '.mp3', '.mp4', '.mov', '.wav', '.ogg', '.zip', '.svg', '.avif'
)

# Regex to match src and href attributes pointing to media/uploads
SRC_HREF_REGEX = re.compile(r'(?:src|href)=[\'"]([^\'"]+)[\'"]', re.IGNORECASE)

# Regex to parse Gutenberg blocks/comments and extract any paths or URLs
# Matches URL-like patterns inside block comments
URL_IN_BLOCK_REGEX = re.compile(r'https?://[^\s\'"\\<>]+', re.IGNORECASE)

# Regex to extract filenames from PHP serialized metadata
# e.g., s:4:"file";s:18:"parent-150x150.jpg"
PHP_SERIALIZED_FILE_REGEX = re.compile(r'"file";s:\d+:"([^"]+)"', re.IGNORECASE)

class Reference:
    def __init__(self, raw_value: str, source: str, evidence_type: str, context: str = ""):
        self.raw_value = raw_value
        self.source = source              # e.g. "Post ID 12", "Attachment Metadata"
        self.evidence_type = evidence_type # "Exact", "Heuristic"
        self.context = context            # e.g. "src attribute", "srcset attribute"
        self.normalized_path = ""         # Will be filled after normalization

    def __repr__(self):
        return f"Reference(path={self.normalized_path}, source={self.source}, type={self.evidence_type})"


def extract_from_html(html_content: str, source_name: str, old_url: str = None, new_url: str = None) -> list[Reference]:
    """
    Extracts media references from HTML content (src, href, srcset, inline styles, block comments).
    """
    references = []
    if not html_content:
        return references

    # 1. Extract from src/href attributes
    for match in SRC_HREF_REGEX.finditer(html_content):
        url = match.group(1)
        # Check if it has a media extension
        # Remove query parameters/hash for extension checking
        clean_url = url.split('?')[0].split('#')[0]
        if clean_url.lower().endswith(MEDIA_EXTENSIONS):
            ref = Reference(url, source_name, "Exact", "src/href attribute")
            ref.normalized_path = normalize_url_to_path(url, old_url, new_url)
            references.append(ref)

    # 2. Extract from srcset attributes
    srcset_matches = re.finditer(r'srcset=[\'"]([^\'"]+)[\'"]', html_content, re.IGNORECASE)
    for match in srcset_matches:
        srcset_val = match.group(1)
        # Split srcset by comma (each entry is "url width" or "url density")
        entries = srcset_val.split(',')
        for entry in entries:
            parts = entry.strip().split()
            if parts:
                url = parts[0]
                clean_url = url.split('?')[0].split('#')[0]
                if clean_url.lower().endswith(MEDIA_EXTENSIONS):
                    ref = Reference(url, source_name, "Exact", "srcset attribute")
                    ref.normalized_path = normalize_url_to_path(url, old_url, new_url)
                    references.append(ref)

    # 3. Extract background-image: url(...)
    bg_matches = re.finditer(r'url\([\'"]?([^\'")]+)[\'"]?\)', html_content, re.IGNORECASE)
    for match in bg_matches:
        url = match.group(1)
        clean_url = url.split('?')[0].split('#')[0]
        if clean_url.lower().endswith(MEDIA_EXTENSIONS):
            ref = Reference(url, source_name, "Exact", "inline style background-image")
            ref.normalized_path = normalize_url_to_path(url, old_url, new_url)
            references.append(ref)

    # 4. Extract references from Gutenberg block comment JSON attributes
    # e.g. <!-- wp:image {"id":45,"sizeSlug":"large","linkDestination":"none"} -->
    # Sometimes they contain direct URLs or paths
    block_comments = re.finditer(r'<!--\s*wp:[^{]+(\{.*?\})\s*-->', html_content, re.DOTALL)
    for match in block_comments:
        json_str = match.group(1)
        try:
            block_data = json.loads(json_str)
            # Recursively find any string value that has media extension or URL
            def search_json(data):
                if isinstance(data, str):
                    if data.lower().endswith(MEDIA_EXTENSIONS) or data.startswith(('http://', 'https://', '/')):
                        ref = Reference(data, source_name, "Exact", "Gutenberg block metadata")
                        ref.normalized_path = normalize_url_to_path(data, old_url, new_url)
                        references.append(ref)
                elif isinstance(data, dict):
                    for k, v in data.items():
                        search_json(v)
                elif isinstance(data, list):
                    for item in data:
                        search_json(item)
            search_json(block_data)
        except json.JSONDecodeError:
            # If not valid JSON, try extracting URLs with regex
            for url_match in URL_IN_BLOCK_REGEX.finditer(json_str):
                url = url_match.group(0)
                clean_url = url.split('?')[0].split('#')[0]
                if clean_url.lower().endswith(MEDIA_EXTENSIONS):
                    ref = Reference(url, source_name, "Exact", "Gutenberg block comment fallback")
                    ref.normalized_path = normalize_url_to_path(url, old_url, new_url)
                    references.append(ref)

    return references


def parse_wxr(wxr_path: Path, old_url: str = None, new_url: str = None) -> tuple[list[Reference], dict[int, str]]:
    """
    Parses a WordPress WXR (XML) file.
    Returns:
    - A list of Reference objects found in post content, excerpt, featured images, and attachments.
    - A dictionary mapping attachment Post ID (int) to its normalized attachment path (str).
    """
    references = []
    attachment_id_to_path = {} # Maps ID -> normalized path

    if not wxr_path or not wxr_path.exists():
        return references, attachment_id_to_path

    try:
        # Register namespace prefixes for standard XPath queries
        # WXR uses different versions, so let's handle namespace elements resiliently
        tree = ET.parse(wxr_path)
        root = tree.getroot()
    except Exception as e:
        print(f"Error parsing WXR XML file: {e}")
        return references, attachment_id_to_path

    # We need namespaces for parsing
    # Let's find namespaces from root attributes
    ns = {
        'content': 'http://purl.org/rss/1.0/modules/content/',
        'excerpt': 'http://purl.org/rss/1.0/modules/excerpt/',
        'wp': 'http://wordpress.org/export/1.2/',
    }

    # Try to scan root tags to discover the actual namespace URIs used
    for key, val in root.attrib.items():
        if key.startswith("xmlns:"):
            prefix = key.split(":")[1]
            ns[prefix] = val

    # Helper to find tag with namespace (since namespace URIs can vary)
    def find_ns_tag(element, tag_name, ns_prefix):
        uri = ns.get(ns_prefix)
        if uri:
            return element.find(f"{{{uri}}}{tag_name}")
        return None

    def find_all_ns_tag(element, tag_name, ns_prefix):
        uri = ns.get(ns_prefix)
        if uri:
            return element.findall(f"{{{uri}}}{tag_name}")
        return []

    # Iterate through each <item>
    for item in root.findall('.//item'):
        # Extract title and ID
        post_id_elem = item.find('post_id')
        if post_id_elem is None:
            post_id_elem = find_ns_tag(item, 'post_id', 'wp')

        if post_id_elem is None or not post_id_elem.text:
            continue

        try:
            post_id = int(post_id_elem.text)
        except ValueError:
            continue

        # Extract post_type
        post_type_elem = item.find('post_type')
        if post_type_elem is None:
            post_type_elem = find_ns_tag(item, 'post_type', 'wp')
        post_type = post_type_elem.text if post_type_elem is not None else ""

        source_desc = f"Post ID {post_id} ({post_type})"

        # Handle attachment item
        if post_type == 'attachment':
            # Extract attachment URL
            attachment_url_elem = find_ns_tag(item, 'attachment_url', 'wp')
            attachment_url = attachment_url_elem.text if attachment_url_elem is not None else ""

            # Extract meta: _wp_attached_file and _wp_attachment_metadata
            attached_file = ""
            attachment_metadata = ""
            for postmeta in find_all_ns_tag(item, 'postmeta', 'wp'):
                key_elem = find_ns_tag(postmeta, 'meta_key', 'wp')
                val_elem = find_ns_tag(postmeta, 'meta_value', 'wp')
                if key_elem is not None and val_elem is not None and key_elem.text:
                    if key_elem.text == '_wp_attached_file':
                        attached_file = val_elem.text
                    elif key_elem.text == '_wp_attachment_metadata':
                        attachment_metadata = val_elem.text or ""

            # Standardize path
            norm_path = ""
            if attached_file:
                norm_path = normalize_url_to_path(attached_file, old_url, new_url)
            elif attachment_url:
                norm_path = normalize_url_to_path(attachment_url, old_url, new_url)

            if norm_path:
                attachment_id_to_path[post_id] = norm_path

                # Register the attachment itself as a reference
                ref = Reference(attached_file or attachment_url, source_desc, "Exact", "Attachment Registry")
                ref.normalized_path = norm_path
                references.append(ref)

            # Extract any registered thumbnails from PHP serialized attachment metadata
            if attachment_metadata:
                for match in PHP_SERIALIZED_FILE_REGEX.finditer(attachment_metadata):
                    thumb_filename = match.group(1)
                    # The thumbnail metadata contains filename only, e.g. "parent-150x150.jpg"
                    # We should reconstruct its full path by placing it in the same directory as parent
                    if norm_path:
                        try:
                            parent_path_obj = Path(norm_path)
                            if "/" in thumb_filename or "\\" in thumb_filename:
                                thumb_path = thumb_filename.replace("\\", "/")
                            else:
                                thumb_path = str(parent_path_obj.with_name(thumb_filename)).replace("\\", "/")

                            ref = Reference(thumb_filename, source_desc, "Exact", "Attachment Serialized Metadata Thumbnail")
                            ref.normalized_path = thumb_path
                            references.append(ref)
                        except Exception:
                            # Safeguard against any unexpected errors parsing files with weird names
                            pass

        # Extract content & excerpt
        content_elem = find_ns_tag(item, 'encoded', 'content')
        content_text = content_elem.text if content_elem is not None else ""
        if content_text:
            references.extend(extract_from_html(content_text, source_desc, old_url, new_url))

        excerpt_elem = find_ns_tag(item, 'encoded', 'excerpt')
        excerpt_text = excerpt_elem.text if excerpt_elem is not None else ""
        if excerpt_text:
            references.extend(extract_from_html(excerpt_text, source_desc, old_url, new_url))

        # Extract postmeta references like featured image (_thumbnail_id)
        for postmeta in find_all_ns_tag(item, 'postmeta', 'wp'):
            key_elem = find_ns_tag(postmeta, 'meta_key', 'wp')
            val_elem = find_ns_tag(postmeta, 'meta_value', 'wp')
            if key_elem is not None and val_elem is not None and key_elem.text:
                if key_elem.text == '_thumbnail_id' and val_elem.text:
                    try:
                        feat_id = int(val_elem.text)
                        # We register this featured image relation
                        ref = Reference(val_elem.text, source_desc, "Exact", "Featured Image ID Link")
                        ref.normalized_path = f"__ID_REF__{feat_id}" # Marked for resolving later
                        references.append(ref)
                    except ValueError:
                        pass

    return references, attachment_id_to_path


def parse_json(json_path: Path, old_url: str = None, new_url: str = None) -> list[Reference]:
    """
    Parses a normalized attachment or post JSON export file.
    Recursively scans all keys and values to extract media references.
    """
    references = []
    if not json_path or not json_path.exists():
        return references

    try:
        with open(json_path, 'r', encoding='utf-8') as f:
            data = json.load(f)
    except Exception as e:
        print(f"Error parsing JSON reference file: {e}")
        return references

    source_desc = f"JSON File ({json_path.name})"

    def extract_recursive(obj, current_key=""):
        if isinstance(obj, str):
            # Check if value contains HTML (very common in json fields like 'content')
            if "<img" in obj or "href=" in obj or "srcset=" in obj:
                references.extend(extract_from_html(obj, f"{source_desc} field '{current_key}'", old_url, new_url))
            else:
                # Strip query parameter/hash to check extension
                clean_val = obj.split('?')[0].split('#')[0]
                if clean_val.lower().endswith(MEDIA_EXTENSIONS):
                    ref = Reference(obj, f"{source_desc} field '{current_key}'", "Exact", "JSON string path/URL")
                    ref.normalized_path = normalize_url_to_path(obj, old_url, new_url)
                    references.append(ref)
        elif isinstance(obj, dict):
            for k, v in obj.items():
                extract_recursive(v, f"{current_key}.{k}" if current_key else k)
        elif isinstance(obj, list):
            for i, item in enumerate(obj):
                extract_recursive(item, f"{current_key}[{i}]")

    extract_recursive(data)
    return references
