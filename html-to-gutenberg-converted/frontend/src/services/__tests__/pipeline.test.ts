import { describe, expect, it } from 'vitest'
import { HtmlParser } from '../parser'
import { BlockMapper } from '../blockMapper'
import { FlagDetector, collectWarnings } from '../flagDetector'
import { WpExporter } from '../wpExporter'
import { applyResolutions, convertHtml, PENDING_FLAG } from '../converter'
import { FALLBACK_BLOCK_OPTIONS } from '../../constants'

// Test fixtures from IMPLEMENTATION_GOTCHAS.md §14
const TEST_FIXTURES = {
  simple: `<h1>Title</h1><p>Content</p>`,
  withImages: `<img src="/photo.jpg" alt="Photo" /><p>Caption</p>`,
  withForms: `<form><input type="text" placeholder="Name" /><button>Submit</button></form>`,
  complexLayout: `<div style="display: grid; grid-template-columns: 1fr 1fr;"><div><p>Left</p></div><div><p>Right</p></div></div>`,
  brokenHeadings: `<h1>Title</h1><h4>Subtitle</h4><p>Content</p>`,
  nestedLists: `<ul><li>Item 1<ul><li>Sub 1</li><li>Sub 2</li></ul></li><li>Item 2</li></ul>`,
}

describe('HtmlParser', () => {
  it('builds a tree from simple HTML', () => {
    const tree = new HtmlParser().parse(TEST_FIXTURES.simple)
    expect(tree.children).toHaveLength(2)
    expect(tree.children![0].tag).toBe('h1')
    expect(tree.children![1].tag).toBe('p')
  })

  it('filters whitespace-only text nodes', () => {
    const tree = new HtmlParser().parse('<div>\n  <p>Text</p>\n  <p>More</p>\n</div>')
    const div = tree.children![0]
    expect(div.children).toHaveLength(2)
  })

  it('parses inline styles into a map', () => {
    const tree = new HtmlParser().parse('<div style="display: grid; color: red">x</div>')
    expect(tree.children![0].styles).toEqual({ display: 'grid', color: 'red' })
  })

  it('handles empty and malformed input without throwing', () => {
    const parser = new HtmlParser()
    expect(parser.parse('').children).toHaveLength(0)
    expect(() => parser.parse('<div><p>unclosed')).not.toThrow()
  })
})

describe('BlockMapper', () => {
  const mapBlocks = (html: string) =>
    new BlockMapper().mapChildren(new HtmlParser().parse(html))

  it('maps headings with the correct level', () => {
    const blocks = mapBlocks(TEST_FIXTURES.simple)
    expect(blocks[0].blockName).toBe('core/heading')
    expect(blocks[0].attrs.level).toBe(1)
    expect(blocks[0].attrs.content).toBe('Title')
    expect(blocks[1].blockName).toBe('core/paragraph')
  })

  it('preserves inline formatting in paragraphs', () => {
    const blocks = mapBlocks('<p>Hello <strong>bold</strong> and <em>italic</em></p>')
    expect(blocks[0].attrs.content).toContain('<strong>bold</strong>')
    expect(blocks[0].attrs.content).toContain('<em>italic</em>')
  })

  it('maps images with attributes', () => {
    const blocks = mapBlocks(TEST_FIXTURES.withImages)
    expect(blocks[0].blockName).toBe('core/image')
    expect(blocks[0].attrs.url).toBe('/photo.jpg')
    expect(blocks[0].attrs.alt).toBe('Photo')
  })

  it('preserves nested list hierarchy via core/list-item (gotcha #6)', () => {
    const blocks = mapBlocks(TEST_FIXTURES.nestedLists)
    expect(blocks).toHaveLength(1)
    const list = blocks[0]
    expect(list.blockName).toBe('core/list')
    expect(list.innerBlocks).toHaveLength(2)
    const item1 = list.innerBlocks[0]
    expect(item1.blockName).toBe('core/list-item')
    expect(item1.attrs.content).toBe('Item 1')
    // Nested list lives inside the first list item
    expect(item1.innerBlocks[0].blockName).toBe('core/list')
    expect(item1.innerBlocks[0].innerBlocks).toHaveLength(2)
  })

  it('maps ordered lists with start attribute', () => {
    const blocks = mapBlocks('<ol start="3"><li>a</li></ol>')
    expect(blocks[0].attrs.ordered).toBe(true)
    expect(blocks[0].attrs.start).toBe(3)
  })

  it('maps blockquote with citation', () => {
    const blocks = mapBlocks('<blockquote><p>Quote</p><cite>Author</cite></blockquote>')
    expect(blocks[0].blockName).toBe('core/quote')
    expect(blocks[0].attrs.citation).toBe('Author')
    expect(blocks[0].innerBlocks[0].blockName).toBe('core/paragraph')
  })

  it('maps tables with head and body', () => {
    const blocks = mapBlocks(
      '<table><thead><tr><th>H</th></tr></thead><tbody><tr><td>C</td></tr></tbody></table>',
    )
    expect(blocks[0].blockName).toBe('core/table')
    expect(blocks[0].attrs.head[0].cells[0].content).toBe('H')
    expect(blocks[0].attrs.body[0].cells[0].content).toBe('C')
  })

  it('keeps CTA-like links as buttons but plain links as paragraphs (gotcha #7)', () => {
    const cta = mapBlocks('<a class="btn btn-primary" href="/signup">Sign Up</a>')
    expect(cta[0].blockName).toBe('core/button')

    const plain = mapBlocks(
      '<a href="/terms">read the full terms and conditions of our service here</a>',
    )
    expect(plain[0].blockName).toBe('core/paragraph')
  })

  it('unwraps single-child containers and groups multi-child ones', () => {
    const single = mapBlocks('<div><p>Only</p></div>')
    expect(single[0].blockName).toBe('core/paragraph')

    const multi = mapBlocks('<section><h2>A</h2><p>B</p></section>')
    expect(multi[0].blockName).toBe('core/group')
    expect(multi[0].innerBlocks).toHaveLength(2)
  })

  it('detects YouTube embeds from iframes', () => {
    const blocks = mapBlocks('<iframe src="https://www.youtube.com/embed/xyz"></iframe>')
    expect(blocks[0].blockName).toBe('core/embed')
    expect(blocks[0].attrs.type).toBe('youtube')
  })
})

describe('FlagDetector', () => {
  const detect = (html: string) =>
    new FlagDetector().detectFlags(new HtmlParser().parse(html))

  it('flags complex grid layouts', () => {
    const flags = detect(TEST_FIXTURES.complexLayout)
    expect(flags.some((f) => f.type === 'unsupported-layout')).toBe(true)
  })

  it('flags forms', () => {
    const flags = detect(TEST_FIXTURES.withForms)
    expect(flags.some((f) => f.type === 'form')).toBe(true)
  })

  it('flags SVG and canvas', () => {
    expect(detect('<svg><circle r="5"/></svg>')[0].type).toBe('svg')
    expect(detect('<canvas></canvas>')[0].type).toBe('svg')
  })

  it('flags absolute positioning (fixed vs. guide sample bug)', () => {
    const flags = detect('<div style="position: absolute; top: 0"><p>x</p></div>')
    expect(flags.some((f) => f.type === 'unsupported-layout')).toBe(true)
  })

  it('flags inline event handlers', () => {
    const flags = detect('<div onclick="doThing()">Click</div>')
    expect(flags.some((f) => f.type === 'custom-element')).toBe(true)
  })

  it('does not descend into flagged sections', () => {
    // The grid contains a nested flex div — only the outer grid should flag
    const flags = detect(
      '<div style="display: grid"><div style="display: flex"><p>x</p></div></div>',
    )
    expect(flags).toHaveLength(1)
  })

  it('offers all five fallback options', () => {
    const flags = detect(TEST_FIXTURES.withForms)
    expect(flags[0].suggestedBlockOptions).toHaveLength(5)
  })
})

describe('collectWarnings', () => {
  it('warns on broken heading hierarchy (gotcha #3)', () => {
    const warnings = collectWarnings(new HtmlParser().parse(TEST_FIXTURES.brokenHeadings))
    expect(warnings.some((w) => w.includes('h1 to h4'))).toBe(true)
  })

  it('warns on missing alt text and relative URLs (gotcha #5)', () => {
    const warnings = collectWarnings(
      new HtmlParser().parse('<img src="../photo.jpg" />'),
    )
    expect(warnings.some((w) => w.includes('alt text'))).toBe(true)
    expect(warnings.some((w) => w.includes('relative URL'))).toBe(true)
  })
})

describe('convertHtml pipeline', () => {
  it('replaces flagged sections with placeholders in document order', () => {
    const result = convertHtml(
      `<h1>Before</h1>${TEST_FIXTURES.complexLayout}<p>After</p>`,
      'snippet',
    )
    expect(result.blocks.map((b) => b.blockName)).toEqual([
      'core/heading',
      PENDING_FLAG,
      'core/paragraph',
    ])
    expect(result.flaggedSections).toHaveLength(1)
  })

  it('does not double-convert flagged content', () => {
    const result = convertHtml(TEST_FIXTURES.complexLayout, 'snippet')
    // Content of the grid must not appear as regular blocks
    expect(result.metadata.totalBlocks).toBe(0)
    expect(result.blocks).toHaveLength(1)
  })
})

describe('applyResolutions', () => {
  const flagged = () =>
    convertHtml(`<h1>Title</h1>${TEST_FIXTURES.complexLayout}`, 'snippet')

  const choose = (id: string) =>
    FALLBACK_BLOCK_OPTIONS.find((o) => o.id === id)!

  it('resolves to group with mapped children', () => {
    const result = flagged()
    result.flaggedSections[0].userChoice = choose('group')
    const blocks = applyResolutions(result)
    expect(blocks[1].blockName).toBe('core/group')
    expect(blocks[1].innerBlocks.length).toBeGreaterThan(0)
  })

  it('resolves to columns with one column per child', () => {
    const result = flagged()
    result.flaggedSections[0].userChoice = choose('columns')
    const blocks = applyResolutions(result)
    expect(blocks[1].blockName).toBe('core/columns')
    expect(blocks[1].innerBlocks).toHaveLength(2)
    expect(blocks[1].innerBlocks[0].blockName).toBe('core/column')
  })

  it('resolves skip by removing the section', () => {
    const result = flagged()
    result.flaggedSections[0].userChoice = choose('skip')
    const blocks = applyResolutions(result)
    expect(blocks).toHaveLength(1)
  })

  it('defaults unresolved flags to custom HTML (nothing silently lost)', () => {
    const blocks = applyResolutions(flagged())
    expect(blocks[1].blockName).toBe('core/html')
    expect(blocks[1].attrs.content).toContain('display: grid')
  })
})

describe('WpExporter', () => {
  const exporter = new WpExporter()

  const exportHtml = (html: string) => {
    const result = convertHtml(html, 'snippet')
    return exporter.toWordPressHtml(applyResolutions(result))
  }

  it('serializes WP comments without the core/ prefix and WITH inner HTML', () => {
    const out = exportHtml(TEST_FIXTURES.simple)
    expect(out).toContain('<!-- wp:heading {"level":1} -->')
    expect(out).toContain('<h1 class="wp-block-heading">Title</h1>')
    expect(out).toContain('<!-- wp:paragraph -->')
    expect(out).toContain('<p>Content</p>')
    expect(out).not.toContain('wp:core/')
  })

  it('omits the level attr for default h2', () => {
    const out = exportHtml('<h2>Sub</h2>')
    expect(out).toContain('<!-- wp:heading -->')
    expect(out).not.toContain('"level":2')
  })

  it('serializes images inside a figure', () => {
    const out = exportHtml('<img src="https://x.com/a.jpg" alt="A" />')
    expect(out).toContain('<figure class="wp-block-image">')
    expect(out).toContain('src="https://x.com/a.jpg"')
  })

  it('serializes nested lists with list-item blocks', () => {
    const out = exportHtml(TEST_FIXTURES.nestedLists)
    expect(out).toContain('<!-- wp:list -->')
    expect(out).toContain('<!-- wp:list-item -->')
    expect(out).toContain('<ul class="wp-block-list">')
    // Nested <ul> serialized inside the parent <li>
    expect(out.indexOf('Sub 1')).toBeGreaterThan(out.indexOf('Item 1'))
  })

  it('wraps buttons in wp:buttons', () => {
    const out = exportHtml('<a class="btn" href="/go">Go</a>')
    expect(out).toContain('<!-- wp:buttons -->')
    expect(out).toContain('wp-block-button__link')
  })

  it('produces valid JSON export', () => {
    const result = convertHtml(TEST_FIXTURES.simple, 'snippet')
    const json = exporter.toJSON(applyResolutions(result))
    const parsed = JSON.parse(json)
    expect(parsed).toHaveLength(2)
    expect(parsed[0].blockName).toBe('core/heading')
  })
})
