# API Specifications & Integration Details

## REST API Endpoints

### POST /api/convert
Converts HTML to Gutenberg blocks (browser or server-side).

**Request Body**:
```json
{
  "html": "<h1>Title</h1><p>Content</p>",
  "inputType": "snippet|page|full-site",
  "templateId": "optional-template-uuid",
  "options": {
    "includeStyles": true,
    "preserveLayout": true,
    "detectMedia": true
  }
}
```

**Response**:
```json
{
  "success": true,
  "data": {
    "blocks": [
      {
        "blockName": "core/heading",
        "attrs": {
          "level": 1,
          "content": "Title"
        },
        "innerBlocks": []
      },
      {
        "blockName": "core/paragraph",
        "attrs": {
          "content": "Content"
        },
        "innerBlocks": []
      }
    ],
    "flaggedSections": [
      {
        "id": "flag-0",
        "type": "unsupported-layout",
        "description": "Complex grid layout detected",
        "htmlSnippet": "<div style=\"display: grid\">...</div>",
        "suggestedBlockOptions": [
          { "id": "group", "blockName": "core/group", "label": "Group", "preservesContent": true },
          { "id": "columns", "blockName": "core/columns", "label": "Columns", "preservesContent": true }
        ],
        "userChoice": null
      }
    ],
    "warnings": [
      "Animation detected: CSS transitions will not be preserved"
    ],
    "metadata": {
      "inputType": "snippet",
      "totalBlocks": 2,
      "conversionTime": 1234,
      "pageCount": 1
    }
  }
}
```

**Error Response**:
```json
{
  "success": false,
  "error": "Invalid HTML: unclosed tags"
}
```

---

### POST /api/crawl
Crawls a full website and converts all pages.

**Request Body**:
```json
{
  "url": "https://example.com",
  "options": {
    "followInternalLinks": true,
    "maxPages": 50,
    "timeout": 30000,
    "renderJs": false,
    "excludeSelectors": [".sidebar", ".footer"],
    "templateId": "optional-template-uuid"
  }
}
```

**Response**:
```json
{
  "success": true,
  "data": {
    "jobId": "crawl-abc123",
    "status": "processing|completed",
    "pages": [
      {
        "url": "https://example.com/",
        "title": "Home",
        "blocks": [...],
        "flaggedSections": [...],
        "warnings": [...]
      },
      {
        "url": "https://example.com/about",
        "title": "About",
        "blocks": [...],
        "flaggedSections": [...],
        "warnings": [...]
      }
    ],
    "summary": {
      "totalPages": 2,
      "totalBlocks": 47,
      "flaggedCount": 3,
      "conversionTime": 5432,
      "errors": []
    }
  }
}
```

**Long-running job response** (if maxPages > 10):
```json
{
  "success": true,
  "data": {
    "jobId": "crawl-abc123",
    "status": "processing",
    "progress": {
      "completed": 5,
      "total": 25,
      "percentComplete": 20
    },
    "pollingUrl": "/api/crawl-status/crawl-abc123"
  }
}
```

---

### POST /api/export
Generates multiple export formats.

**Request Body**:
```json
{
  "blocks": [...blocks array...],
  "formats": ["json", "html", "csv"],
  "options": {
    "includeMetadata": true,
    "prettify": true,
    "lineNumbers": false
  }
}
```

**Response**:
```json
{
  "success": true,
  "data": {
    "formats": {
      "json": "{\"blockName\":\"core/heading\",...}",
      "html": "<!-- wp:core/heading {...} -->\n<h2>...</h2>\n<!-- /wp:core/heading -->",
      "csv": "blockName,attrs,innerBlocks\ncore/heading,\"{level:2}\",0\n..."
    },
    "downloadUrls": {
      "json": "/download/export-abc123.json",
      "html": "/download/export-abc123.html",
      "csv": "/download/export-abc123.csv"
    }
  }
}
```

---

### GET /api/templates
Fetches available WordPress template references (if connected to WordPress).

**Query Parameters**:
- `search`: Filter by template name
- `limit`: Max results (default: 20)
- `type`: Filter by block type (e.g., `core/columns`, `core/cover`)

**Response**:
```json
{
  "success": true,
  "data": [
    {
      "id": "template-123",
      "name": "Blog Post Layout",
      "description": "Standard blog post with sidebar",
      "url": "https://wordpress.local/template-123",
      "blocks": [...],
      "metadata": {
        "blockTypes": ["core/heading", "core/paragraph", "core/image", "core/columns"],
        "columnCount": 2,
        "usesCustomBlocks": false
      }
    }
  ],
  "pagination": {
    "page": 1,
    "limit": 20,
    "total": 45
  }
}
```

---

### POST /api/templates
Adds a WordPress site as a template reference.

**Request Body**:
```json
{
  "wordpressUrl": "https://example.com",
  "pageId": 123,
  "name": "My Template",
  "description": "Optional description"
}
```

**Response**:
```json
{
  "success": true,
  "data": {
    "id": "template-456",
    "name": "My Template",
    "blocks": [...],
    "metadata": {...}
  }
}
```

---

### POST /api/flags/resolve
Resolves a flagged section with user's choice.

**Request Body**:
```json
{
  "conversionId": "conv-abc123",
  "flagId": "flag-0",
  "blockChoice": {
    "id": "group",
    "blockName": "core/group",
    "label": "Group",
    "preservesContent": true
  },
  "customContent": "optional-html-for-custom-block"
}
```

**Response**:
```json
{
  "success": true,
  "data": {
    "block": {
      "blockName": "core/group",
      "attrs": {...},
      "innerBlocks": [...]
    },
    "isComplete": true
  }
}
```

---

## WordPress REST API Integration

### Fetching Template Blocks
If connecting to an existing WordPress site:

```bash
GET https://wordpress-site.com/wp-json/wp/v2/blocks?per_page=100
```

Parse the response to extract block structure and attributes.

---

## Block JSON Structure

Gutenberg blocks follow this structure:

```json
{
  "blockName": "core/heading",
  "attrs": {
    "level": 2,
    "content": "My Heading",
    "anchor": "my-heading",
    "className": "is-style-large",
    "textColor": "primary",
    "backgroundColor": "secondary"
  },
  "innerBlocks": [
    {
      "blockName": "core/paragraph",
      "attrs": {
        "content": "This is a paragraph.",
        "fontSize": "medium"
      },
      "innerBlocks": []
    }
  ],
  "innerContent": [
    "<h2 class=\"has-primary-color\">My Heading</h2>",
    null,
    "<p class=\"has-large-font-size\">This is a paragraph.</p>",
    null
  ]
}
```

### Key Block Types Supported

| Block | blockName | Key Attributes |
|-------|-----------|-----------------|
| Heading | `core/heading` | level, content, anchor, className |
| Paragraph | `core/paragraph` | content, fontSize, textColor |
| Image | `core/image` | url, alt, title, width, height, caption, sizeSlug |
| Button | `core/button` | text, url, backgroundColor, textColor |
| List | `core/list` | ordered, start, values |
| Quote | `core/quote` | value, citation, align |
| Gallery | `core/gallery` | ids (image IDs), columns, imageCrop |
| Table | `core/table` | head, body, foot, hasFixedLayout |
| Columns | `core/columns` | verticalAlignment, isStackedOnMobile |
| Group | `core/group` | tagName, templateLock, align, className |
| Cover | `core/cover` | url (background), id (attachment ID), dimRatio, overlayColor |
| Embed | `core/embed` | url, type (youtube, twitter, etc.) |
| Video | `core/video` | src, poster, controls |
| HTML | `core/html` | content (raw HTML) |

---

## HTML Element → Block Mapping Rules

### Auto-converted (High Confidence)

| HTML Element | Gutenberg Block | Notes |
|--------------|-----------------|-------|
| `<h1>...</h1>` | `core/heading` (level: 1) | Preserve text content |
| `<h2>` - `<h6>` | `core/heading` (level: 2-6) | Map heading level |
| `<p>` | `core/paragraph` | Keep inline formatting (bold, italic) |
| `<img>` | `core/image` | Extract src, alt, width, height |
| `<ul>` | `core/list` (ordered: false) | Process `<li>` children |
| `<ol>` | `core/list` (ordered: true) | Map start attribute |
| `<blockquote>` | `core/quote` | Extract text, look for cite |
| `<table>` | `core/table` | Parse thead/tbody/tfoot |
| `<video>` | `core/video` | Extract src, poster attributes |
| `<iframe>` | `core/embed` | Detect YouTube/Twitter/etc., fallback to Embed |
| `<a href="...">` (CTA-like) | `core/button` | If link looks like a button (large, standalone) |
| `<form>` | `core/group` | Wrap in Group (no native form block) |

### Flagged for User Review

| HTML Element/Pattern | Flag Type | Reason |
|----------------------|-----------|--------|
| `<svg>` | svg | Cannot convert vector graphics |
| `<canvas>` | svg | Cannot convert canvas rendering |
| `style="display: grid"` | unsupported-layout | Complex grid layouts need manual handling |
| `style="display: flex"` | unsupported-layout | Flex layouts often have custom responsive behavior |
| `style="position: absolute"` | unsupported-layout | Absolute positioning not supported in Gutenberg |
| `<div onclick="...">` | custom-element | Interactive elements with scripts |
| `[data-custom]` | custom-element | Custom data attributes suggest special functionality |
| `.hero`, `.section-hero` | custom-element | Common hero class suggests complex styling |
| `<form>` with custom inputs | form | Forms with validation, custom controls |
| Inline `<style>` tags | animation | Animations/transitions detected |

---

## Error Handling

### Common Errors

**Invalid HTML**:
```json
{
  "success": false,
  "error": "Invalid HTML: unclosed div tags at line 45",
  "code": "INVALID_HTML"
}
```

**URL Not Reachable**:
```json
{
  "success": false,
  "error": "Failed to fetch https://example.com: 404 Not Found",
  "code": "FETCH_ERROR"
}
```

**Template Not Found**:
```json
{
  "success": false,
  "error": "Template ID 'template-123' not found",
  "code": "TEMPLATE_NOT_FOUND"
}
```

**File Too Large**:
```json
{
  "success": false,
  "error": "HTML file exceeds 10MB limit",
  "code": "FILE_TOO_LARGE"
}
```

---

## Rate Limiting

- **Free tier**: 10 conversions/hour, 5 crawls/hour
- **Authenticated**: 100 conversions/hour, 20 crawls/hour
- **Pro**: Unlimited

Headers in response:
```
X-RateLimit-Limit: 100
X-RateLimit-Remaining: 87
X-RateLimit-Reset: 1234567890
```

---

## Authentication (Optional)

For template storage and WordPress integration:

**Header**:
```
Authorization: Bearer YOUR_API_KEY
```

Generate API keys in account settings.

---

## WordPress Import Flow

### Method 1: REST API
```bash
# Export blocks as JSON
curl -X GET http://localhost:3000/api/convert \
  -H "Content-Type: application/json" \
  -d '{"html":"<h1>Title</h1>"}' \
  | jq '.data.blocks' > blocks.json

# POST directly to WordPress
curl -X POST https://example.com/wp-json/wp/v2/posts \
  -H "Authorization: Bearer YOUR_WP_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "title": "My Post",
    "status": "draft",
    "blocks": @blocks.json
  }'
```

### Method 2: HTML Paste
Copy the HTML export and paste into WordPress editor:

```html
<!-- wp:core/heading {"level":1} -->
<h1>Title</h1>
<!-- /wp:core/heading -->

<!-- wp:core/paragraph -->
<p>Content</p>
<!-- /wp:core/paragraph -->
```

---

## Performance Considerations

- **Parser**: O(n) where n = HTML size
- **Crawling**: Parallel requests (max 5 concurrent)
- **Caching**: Store parsed templates in Redis (1 hour TTL)
- **Large conversions**: Process in chunks, stream results

---

## Testing Payloads

### Simple Conversion
```bash
curl -X POST http://localhost:3000/api/convert \
  -H "Content-Type: application/json" \
  -d '{
    "html": "<h1>Hello</h1><p>World</p>",
    "inputType": "snippet"
  }'
```

### With Flagged Content
```bash
curl -X POST http://localhost:3000/api/convert \
  -H "Content-Type: application/json" \
  -d '{
    "html": "<h1>Hello</h1><div style=\"display: grid\"><p>A</p><p>B</p></div>",
    "inputType": "snippet"
  }'
```

### File Upload
```bash
curl -X POST http://localhost:3000/api/convert \
  -F "file=@page.html" \
  -F "inputType=page"
```

---

## Troubleshooting

| Issue | Solution |
|-------|----------|
| "Cannot parse HTML" | Check for unclosed tags; use HTML validator |
| "Media assets not found" | Ensure relative URLs; use absolute URLs |
| "Template not applying" | Verify template ID; check block type compatibility |
| "Slow conversion" | Large file; use crawl API with streaming |
| "Flags not resolving" | Ensure chosen block is in the fallback list |
