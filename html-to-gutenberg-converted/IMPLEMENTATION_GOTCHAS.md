# Implementation Gotchas & Best Practices

## Common Pitfalls to Avoid

### 1. HTML Parsing Complexity

**Problem**: Cheerio is powerful but easy to misuse.

```typescript
// ❌ WRONG: This will fail on nested content
const $ = load(html)
const text = $('div').text() // Gets ALL text, including nested

// ✅ CORRECT: Target the immediate children
const $ = load(html)
$('div').each((i, elem) => {
  const $elem = $(elem)
  const immediateText = $elem.contents()
    .filter((i, node) => node.type === 'text')
    .text()
})

// ✅ BETTER: Use a recursive parser like in the guide
```

**Best Practice**: Always recursively process the DOM tree, don't flatten it. Gutenberg blocks are nested; your data model should reflect that.

---

### 2. Block Attributes vs. Inner Content

**Problem**: Confusion about where content goes.

```typescript
// ❌ WRONG: Putting HTML in attrs
{
  blockName: 'core/paragraph',
  attrs: {
    content: '<strong>Bold</strong> text' // Wrong!
  }
}

// ✅ CORRECT: Inner content as plain text, innerContent array
{
  blockName: 'core/paragraph',
  attrs: {
    // Only metadata here
  },
  innerContent: ['<strong>Bold</strong> text']
}

// ⚠️ FOR STRUCTURED BLOCKS: Some blocks store content in attrs
{
  blockName: 'core/heading',
  attrs: {
    level: 2,
    content: 'My Heading' // This is OK for heading
  },
  innerBlocks: []
}
```

**Rule**: If Gutenberg editor can edit it as a block, it goes in `innerBlocks`. Metadata like level, alignment, color goes in `attrs`.

---

### 3. Heading Level Mismatches

**Problem**: HTML often has mixed heading structures (h2, h4, h2), but Gutenberg expects hierarchy.

```typescript
// ❌ WRONG: Blindly mapping h tags
// <h2>Title</h2>
// <h4>Subtitle</h4>  → core/heading level:4 (looks weird)

// ✅ CORRECT: Normalize or flag
function normalizeHeadingLevel(htmlLevel: number, depth: number): number {
  // If we're deep in nesting, start at h2
  return Math.min(depth + 1, 6)
}

// ✅ BETTER: Flag if hierarchy is broken
if (currentLevel > previousLevel + 1) {
  flags.push({
    type: 'heading-hierarchy',
    description: `Heading jumps from h${previousLevel} to h${currentLevel}`
  })
}
```

**Best Practice**: Audit heading hierarchy during parsing. A jump from h2 to h4 is a red flag (should be h3).

---

### 4. Whitespace & Empty Elements

**Problem**: Parser includes whitespace nodes; they clutter the output.

```typescript
// ❌ WRONG: Processing whitespace text nodes
<div>
  <p>Text</p>
  <p>More</p>  <!-- Whitespace before/after gets parsed -->
</div>

// ✅ CORRECT: Trim and filter
function parseElement(elem) {
  const children = Array.from(elem.children)
    .map(child => parseElement(child))
    .filter(node => !(node.type === 'text' && !node.content.trim()))
}
```

**Best Practice**: Always `.trim()` text nodes and filter out empty ones early.

---

### 5. Image & Media Handling

**Problem**: Images with relative URLs won't load; missing alt text breaks accessibility.

```typescript
// ❌ WRONG: Relative URL
{
  blockName: 'core/image',
  attrs: {
    url: '../images/photo.jpg' // Breaks when moved
  }
}

// ✅ CORRECT: Resolve to absolute
function resolveImageUrl(src: string, baseUrl: string): string {
  try {
    return new URL(src, baseUrl).href
  } catch {
    return src // Fallback to original
  }
}

// ✅ ALWAYS include alt text
{
  blockName: 'core/image',
  attrs: {
    url: 'https://example.com/images/photo.jpg',
    alt: 'Photo of something' // Accessibility!
  }
}

// ⚠️ Flag images without alt text
if (!imgElement.getAttribute('alt')) {
  flags.push({
    type: 'accessibility-warning',
    description: 'Image missing alt text'
  })
}
```

**Best Practice**: 
- Always resolve URLs to absolute
- Check for alt text; warn if missing
- Detect image dimensions for responsive blocks
- Consider media upload strategy (host separately vs. embed)

---

### 6. List Nesting

**Problem**: Nested `<ul>` elements can represent either sub-lists or separate list blocks.

```typescript
// HTML:
// <ul>
//   <li>Item 1
//     <ul><li>Sub-item 1</li></ul>
//   </li>
// </ul>

// ❌ WRONG: Flattening or losing hierarchy
blocks = [
  { blockName: 'core/list', ... },
  { blockName: 'core/list', ... }  // Separate blocks, lost hierarchy
]

// ✅ CORRECT: Nested innerBlocks
{
  blockName: 'core/list',
  attrs: { ordered: false },
  innerBlocks: [
    {
      blockName: 'core/list-item',
      attrs: { content: 'Item 1' },
      innerBlocks: [
        {
          blockName: 'core/list',
          attrs: { ordered: false },
          innerBlocks: [...]
        }
      ]
    }
  ]
}

// ⚠️ Note: Gutenberg v17+ uses "core/list-item", earlier uses "core/paragraph"
```

**Best Practice**: Recursively process list items and preserve nesting in `innerBlocks`.

---

### 7. Button vs. Link vs. Paragraph

**Problem**: Hard to tell if an `<a>` should be a button block or inline link.

```typescript
// ❌ WRONG: All links become buttons
<a href="/about">About Us</a> → core/button (wrong!)

// ✅ CORRECT: Heuristic to detect CTAs
function detectButton(elem: HTMLElement): boolean {
  // Is it standalone (not in a paragraph)?
  const parent = elem.parentElement
  if (parent?.tagName !== 'P') {
    // Is it large or visually prominent?
    const styles = window.getComputedStyle(elem)
    const hasButtonClass = elem.className.includes('btn') || 
                          elem.className.includes('button')
    return hasButtonClass || 
           styles.display === 'block' ||
           elem.textContent.length > 20
  }
  return false
}

// If not a button, treat as inline link in paragraph
{
  blockName: 'core/paragraph',
  attrs: {},
  innerContent: ['<a href="/about">About Us</a>']
}
```

**Best Practice**: Only flag as button if it has button-like styling or placement. Inline links stay in paragraphs.

---

### 8. Complex Layouts (Grid/Flex)

**Problem**: Detecting when to use Columns vs. Group vs. Cover.

```typescript
// Parse grid layout detection
function detectLayout(elem: HTMLElement): 'grid' | 'flex' | 'other' {
  const styles = window.getComputedStyle(elem)
  
  if (styles.display === 'grid') {
    const cols = styles.gridTemplateColumns.split(' ').length
    return 'grid' // Return column count for heuristic
  }
  
  if (styles.display === 'flex') {
    return 'flex'
  }
  
  return 'other'
}

// Suggested block based on layout
const layoutSuggestions: Record<string, FallbackBlockOption[]> = {
  grid: [
    { id: 'columns', blockName: 'core/columns', ... },
    { id: 'group', blockName: 'core/group', ... }
  ],
  flex: [
    { id: 'group', blockName: 'core/group', ... },
    { id: 'columns', blockName: 'core/columns', ... }
  ]
}
```

**Best Practice**: 
- Detect grid/flex early
- Count columns (if multi-column, suggest Columns block)
- Flag with layout type so user can make informed choice
- Don't force Group if Columns would work

---

### 9. Inline Styles vs. CSS Classes

**Problem**: Gutenberg doesn't use class names; how to preserve styling?

```typescript
// ❌ WRONG: Copying classes
{
  blockName: 'core/paragraph',
  attrs: {
    className: 'text-large text-red' // Gutenberg ignores this
  }
}

// ✅ CORRECT: Map to Gutenberg attributes
const classToBlock = {
  'text-large': { fontSize: 'large' },
  'text-red': { textColor: 'red' },
  'bg-light': { backgroundColor: 'light' },
  'text-center': { align: 'center' }
}

function classesToAttrs(classes: string[]): Record<string, any> {
  const attrs: Record<string, any> = {}
  classes.forEach(cls => {
    const mapped = classToBlock[cls]
    if (mapped) Object.assign(attrs, mapped)
  })
  return attrs
}

// ⚠️ For complex styles with no Gutenberg equivalent, flag it
if (hasComplexStyling) {
  flags.push({
    type: 'custom-styles',
    description: 'Custom CSS that cannot be preserved in Gutenberg'
  })
}
```

**Best Practice**: 
- Map common classes to Gutenberg attributes
- Preserve color, size, alignment
- Flag custom classes that can't be mapped
- Store original HTML in custom HTML block if needed

---

### 10. State Management in React

**Problem**: Lost state when navigating steps or refreshing.

```typescript
// ❌ WRONG: State lost on refresh
const [result, setResult] = useState<ConversionResult | null>(null)

// ✅ CORRECT: Persist to localStorage
function useConversion() {
  const [state, setState] = useState<ConversionState>(() => {
    const saved = localStorage.getItem('conversionState')
    return saved ? JSON.parse(saved) : defaultState
  })

  useEffect(() => {
    localStorage.setItem('conversionState', JSON.stringify(state))
  }, [state])

  return { state, ... }
}

// ✅ BETTER: Use Context for cross-component state
const ConversionContext = createContext<ConversionContextType | null>(null)

export function ConversionProvider({ children }) {
  const [state, dispatch] = useReducer(conversionReducer, initialState)
  
  return (
    <ConversionContext.Provider value={{ state, dispatch }}>
      {children}
    </ConversionContext.Provider>
  )
}
```

**Best Practice**: 
- Persist conversion state to localStorage
- Use Context for global state
- Save user resolutions of flags
- Allow resuming interrupted conversions

---

### 11. Flag Resolution Flow

**Problem**: User picks a block for a flag, but it's unclear how to handle the content.

```typescript
// ❌ WRONG: Silently drop content
if (userChoice.id === 'skip') {
  // Just remove the section — user loses data
}

// ✅ CORRECT: Show preview before applying
function PreviewFlagResolution({ flag, choice }: Props) {
  if (choice.id === 'group') {
    return (
      <div>
        <p>Your content will be wrapped in a Group block:</p>
        <pre>{serializeNode(flag.originalNode)}</pre>
        <p>Content will be editable in Gutenberg ✓</p>
      </div>
    )
  }
  
  if (choice.id === 'custom') {
    return (
      <div>
        <p>Content will be added as raw HTML:</p>
        <pre>{flag.htmlSnippet}</pre>
        <p className="text-red-600">⚠️ Not editable in Gutenberg</p>
      </div>
    )
  }
}

// ✅ BEST: Apply resolution and show result
function applyFlagResolution(flag: FlaggedSection, choice: FallbackBlockOption) {
  switch (choice.id) {
    case 'group':
      return {
        blockName: 'core/group',
        attrs: {},
        innerBlocks: flag.originalNode.children
          ?.map(child => mapNodeToBlock(child))
          .filter(Boolean) || []
      }
    
    case 'custom':
      return {
        blockName: 'core/html',
        attrs: { content: flag.htmlSnippet },
        innerBlocks: []
      }
    
    case 'skip':
      return null // Don't include
    
    default:
      return null
  }
}
```

**Best Practice**: 
- Preview the result before confirming
- Warn if content won't be editable
- Show exactly what will be included
- Allow undo/change after applying

---

### 12. Performance with Large Sites

**Problem**: Crawling 100+ pages is slow; browser locks up.

```typescript
// ❌ WRONG: Parse everything at once
async function crawlSite(url: string) {
  const urls = await getAllUrls(url)
  const results = await Promise.all(urls.map(u => fetchAndParse(u)))
  // Browser hangs for large sites
}

// ✅ CORRECT: Stream results, limit concurrency
async function crawlSiteStreaming(url: string, onProgress: (result) => void) {
  const urls = await getAllUrls(url)
  
  for (let i = 0; i < urls.length; i += 5) {
    const batch = urls.slice(i, i + 5)
    const results = await Promise.all(batch.map(u => fetchAndParse(u)))
    results.forEach(result => {
      onProgress(result) // Emit as we go
      localStorage.setItem(`crawl_result_${result.url}`, JSON.stringify(result))
    })
  }
}

// ✅ Backend: Process in background job
app.post('/api/crawl', async (req, res) => {
  const jobId = uuid()
  
  // Return immediately with job ID
  res.json({ success: true, data: { jobId, status: 'processing' } })
  
  // Process in background
  crawlSiteAsync(req.body.url, jobId)
    .catch(err => saveJobError(jobId, err))
})

// Frontend polls for progress
async function checkCrawlProgress(jobId: string) {
  const res = await fetch(`/api/crawl-status/${jobId}`)
  return res.json()
}
```

**Best Practice**: 
- Limit concurrent requests (5-10 max)
- Stream results instead of waiting
- Use backend job queue for large crawls
- Store intermediate results
- Show progress to user

---

### 13. WordPress REST API Integration

**Problem**: WordPress might be on different domain; CORS issues.

```typescript
// ❌ WRONG: Direct fetch from frontend
const res = await fetch('https://wordpress.com/wp-json/wp/v2/posts', {
  headers: { 'Authorization': 'Bearer token' } // Token exposed!
})

// ✅ CORRECT: Route through backend
// Frontend
const res = await fetch('/api/templates', {
  headers: { 'X-Template-Url': 'https://wordpress.com' }
})

// Backend
app.get('/api/templates', async (req, res) => {
  const wpUrl = req.headers['x-template-url'] as string
  
  // Validate URL (prevent SSRF)
  if (!validateWordPressUrl(wpUrl)) {
    return res.status(400).json({ error: 'Invalid URL' })
  }
  
  // Fetch from WordPress
  const templates = await fetch(`${wpUrl}/wp-json/wp/v2/blocks`)
    .then(r => r.json())
  
  res.json({ success: true, data: templates })
})
```

**Best Practice**: 
- Never expose WordPress credentials in frontend
- Route WordPress API calls through backend
- Validate & sanitize URLs
- Cache template blocks (1 hour TTL)
- Handle CORS via backend proxy

---

### 14. Testing Without Real HTML

**Problem**: Need test cases for all scenarios.

```typescript
// Create a test fixture library
export const TEST_FIXTURES = {
  simple: `<h1>Title</h1><p>Content</p>`,
  
  withImages: `
    <img src="/photo.jpg" alt="Photo" />
    <p>Caption</p>
  `,
  
  withForms: `
    <form>
      <input type="text" placeholder="Name" />
      <button>Submit</button>
    </form>
  `,
  
  complexLayout: `
    <div style="display: grid; grid-template-columns: 1fr 1fr;">
      <div><p>Left</p></div>
      <div><p>Right</p></div>
    </div>
  `,
  
  brokenHeadings: `
    <h1>Title</h1>
    <h4>Subtitle</h4>
    <p>Content</p>
  `,
  
  nestedLists: `
    <ul>
      <li>Item 1
        <ul>
          <li>Sub 1</li>
          <li>Sub 2</li>
        </ul>
      </li>
      <li>Item 2</li>
    </ul>
  `
}

// Unit tests
describe('BlockMapper', () => {
  it('should map heading correctly', () => {
    const parser = new HtmlParser()
    const tree = parser.parse(TEST_FIXTURES.simple)
    const mapper = new BlockMapper()
    const blocks = tree.children!.map(c => mapper.mapNodeToBlock(c)).filter(Boolean)
    
    expect(blocks[0].blockName).toBe('core/heading')
    expect(blocks[0].attrs.level).toBe(1)
  })
  
  it('should flag complex layouts', () => {
    const parser = new HtmlParser()
    const tree = parser.parse(TEST_FIXTURES.complexLayout)
    const detector = new FlagDetector()
    const flags = detector.detectFlags(tree)
    
    expect(flags.some(f => f.type === 'unsupported-layout')).toBe(true)
  })
})
```

**Best Practice**: 
- Build a fixture library
- Test each block type separately
- Test error cases (malformed HTML, missing attrs)
- Test flag detection for all types

---

## Debug Checklist

When something isn't working:

```typescript
// 1. Check HTML parsing
console.log('Parsed tree:', tree)

// 2. Check block mapping
console.log('Mapped blocks:', blocks)

// 3. Check flag detection
console.log('Flags:', flags)

// 4. Check exported JSON
console.log('Exported:', JSON.stringify(blocks, null, 2))

// 5. Check WordPress compatibility
console.log('WordPress HTML:', wpExporter.toWordPressHtml(result))

// 6. Validate against Gutenberg schema
// https://developer.wordpress.org/block-editor/reference-guides/block-api/block-attributes/
console.log('Valid attributes:', validateBlockAttributes(block))
```

---

## Performance Checklist

- [ ] Parsing is O(n) (linear time)
- [ ] No recursive loops (max 10 levels deep)
- [ ] Large files (>1MB) handled with streaming
- [ ] API calls batched (max 5 concurrent)
- [ ] Results cached in localStorage/Redis
- [ ] Heavy lifting on backend, not frontend
- [ ] Memory released after conversion
- [ ] No global state leaks

---

## Accessibility Checklist

- [ ] All images have alt text or flagged
- [ ] Heading hierarchy is valid
- [ ] Color not sole indicator of meaning
- [ ] Links have descriptive text (not "click here")
- [ ] Forms have labels
- [ ] Contrast ratios meet WCAG AA

---

## Launch Checklist

- [ ] Handles all HTML5 semantic elements
- [ ] Detects and flags 10+ edge cases
- [ ] Exports working Gutenberg blocks
- [ ] User can resolve all flags
- [ ] Results paste into WordPress
- [ ] No console errors
- [ ] Mobile responsive
- [ ] API documented
- [ ] Error messages helpful
