import { GutenbergBlock, HtmlNode } from '../types'
import { CONTAINER_TAGS, INLINE_TAGS } from '../constants'
import { escapeHtml, serializeNode } from './parser'

/**
 * Maps HtmlNode trees to Gutenberg blocks.
 *
 * Notable behaviors (per IMPLEMENTATION_GOTCHAS.md):
 * - Inline formatting (<strong>, <em>, <a>…) is preserved in block content.
 * - Nested lists become core/list → core/list-item → core/list (Gutenberg 17+).
 * - Container tags (div/section/…) become core/group with mapped children.
 * - <a> only becomes a button when it looks like a CTA; otherwise it stays
 *   an inline link inside a paragraph.
 */
export class BlockMapper {
  /**
   * @param intercept Optional hook consulted before mapping each node.
   *   Return a block to substitute it, null to skip the node entirely,
   *   or undefined to continue with normal mapping. Used by the converter
   *   to replace flagged sections with placeholders.
   */
  constructor(
    private intercept?: (node: HtmlNode) => GutenbergBlock | null | undefined,
  ) {}

  mapNodeToBlock(node: HtmlNode): GutenbergBlock | null {
    if (this.intercept) {
      const intercepted = this.intercept(node)
      if (intercepted !== undefined) return intercepted
    }

    if (node.type === 'text') {
      const content = node.content?.trim()
      if (!content) return null
      return this.block('core/paragraph', { content: escapeHtml(content) })
    }

    const tag = node.tag?.toLowerCase()
    if (!tag) return null

    // Skip non-content tags outright
    if (['script', 'style', 'link', 'meta', 'noscript', 'template'].includes(tag)) {
      return null
    }

    // Headings
    if (/^h[1-6]$/.test(tag)) {
      return this.block('core/heading', {
        level: parseInt(tag[1], 10),
        content: this.innerHtml(node),
      })
    }

    switch (tag) {
      case 'p':
        return this.block('core/paragraph', { content: this.innerHtml(node) })

      case 'img':
        return this.mapImage(node)

      case 'figure':
        return this.mapFigure(node)

      case 'ul':
      case 'ol':
        return this.mapList(node, tag === 'ol')

      case 'blockquote':
        return this.mapQuote(node)

      case 'table':
        return this.mapTable(node)

      case 'video':
        return this.block('core/video', {
          src: node.attributes?.src ?? this.findChildAttr(node, 'source', 'src') ?? '',
          poster: node.attributes?.poster,
        })

      case 'audio':
        return this.block('core/audio', {
          src: node.attributes?.src ?? this.findChildAttr(node, 'source', 'src') ?? '',
        })

      case 'iframe':
        return this.block('core/embed', {
          url: node.attributes?.src ?? '',
          type: this.detectEmbedType(node.attributes?.src ?? ''),
        })

      case 'button':
        return this.block('core/button', { text: this.innerHtml(node) })

      case 'a':
        if (this.looksLikeButton(node)) {
          return this.block('core/button', {
            url: node.attributes?.href ?? '',
            text: this.innerHtml(node),
          })
        }
        // Inline-looking link at block level → wrap in a paragraph
        return this.block('core/paragraph', {
          content: serializeNode(node),
        })

      case 'pre':
        return this.block('core/code', { content: this.extractText(node) })

      case 'hr':
        return this.block('core/separator', {})

      case 'form':
        // No native Gutenberg form block — wrap contents in a group.
        // (FlagDetector will normally intercept forms before we get here.)
        return this.mapContainer(node)
    }

    if (CONTAINER_TAGS.has(tag)) {
      return this.mapContainer(node)
    }

    // Inline tag appearing at block level → paragraph preserving its markup
    if (INLINE_TAGS.has(tag)) {
      const content = serializeNode(node)
      if (!this.extractText(node).trim()) return null
      return this.block('core/paragraph', { content })
    }

    // Unknown tag: preserve as raw HTML so nothing is silently dropped
    return this.block('core/html', { content: serializeNode(node) })
  }

  /** Map every child of a root/container node, flattening out nulls. */
  mapChildren(node: HtmlNode): GutenbergBlock[] {
    return (node.children ?? [])
      .map((child) => this.mapNodeToBlock(child))
      .filter((b): b is GutenbergBlock => b !== null)
  }

  // ---------------------------------------------------------------- helpers

  private block(
    blockName: string,
    attrs: Record<string, any>,
    innerBlocks: GutenbergBlock[] = [],
  ): GutenbergBlock {
    // Drop undefined attrs for clean JSON output
    const cleanAttrs = Object.fromEntries(
      Object.entries(attrs).filter(([, v]) => v !== undefined && v !== ''),
    )
    return { blockName, attrs: cleanAttrs, innerBlocks }
  }

  private mapImage(node: HtmlNode): GutenbergBlock {
    const a = node.attributes ?? {}
    return this.block('core/image', {
      url: a.src ?? '',
      alt: a.alt ?? '',
      title: a.title,
      width: a.width ? parseInt(a.width, 10) : undefined,
      height: a.height ? parseInt(a.height, 10) : undefined,
    })
  }

  private mapFigure(node: HtmlNode): GutenbergBlock | null {
    const img = node.children?.find((c) => c.tag === 'img')
    const figcaption = node.children?.find((c) => c.tag === 'figcaption')
    if (img) {
      const block = this.mapImage(img)
      if (figcaption) block.attrs.caption = this.innerHtml(figcaption)
      return block
    }
    // figure without an image (e.g. wrapping a table/iframe) — map first child
    const first = node.children?.[0]
    return first ? this.mapNodeToBlock(first) : null
  }

  private mapList(node: HtmlNode, ordered: boolean): GutenbergBlock {
    const attrs: Record<string, any> = { ordered }
    if (ordered && node.attributes?.start) {
      attrs.start = parseInt(node.attributes.start, 10)
    }

    const items = (node.children ?? [])
      .filter((c) => c.tag === 'li')
      .map((li) => this.mapListItem(li))

    return this.block('core/list', attrs, items)
  }

  private mapListItem(li: HtmlNode): GutenbergBlock {
    // Split the <li> into inline content vs nested lists (gotcha #6)
    const nestedLists = (li.children ?? []).filter(
      (c) => c.tag === 'ul' || c.tag === 'ol',
    )
    const inlineChildren = (li.children ?? []).filter(
      (c) => c.tag !== 'ul' && c.tag !== 'ol',
    )

    const content = inlineChildren
      .map((c) => (c.type === 'text' ? escapeHtml(c.content ?? '') : serializeNode(c)))
      .join(' ')
      .trim()

    const innerBlocks = nestedLists.map((list) =>
      this.mapList(list, list.tag === 'ol'),
    )

    return this.block('core/list-item', { content }, innerBlocks)
  }

  private mapQuote(node: HtmlNode): GutenbergBlock {
    const cite = node.children?.find((c) => c.tag === 'cite' || c.tag === 'footer')
    const contentChildren = (node.children ?? []).filter((c) => c !== cite)

    const innerBlocks = contentChildren
      .map((c) => this.mapNodeToBlock(c))
      .filter((b): b is GutenbergBlock => b !== null)

    return this.block(
      'core/quote',
      { citation: cite ? this.innerHtml(cite) : undefined },
      innerBlocks,
    )
  }

  private mapTable(node: HtmlNode): GutenbergBlock {
    const rows = (section?: HtmlNode) =>
      (section?.children ?? [])
        .filter((r) => r.tag === 'tr')
        .map((tr) => ({
          cells: (tr.children ?? [])
            .filter((c) => c.tag === 'td' || c.tag === 'th')
            .map((cell) => ({
              content: this.innerHtml(cell),
              tag: cell.tag as 'td' | 'th',
            })),
        }))

    const thead = node.children?.find((c) => c.tag === 'thead')
    const tbody = node.children?.find((c) => c.tag === 'tbody')
    // Rows directly under <table> (no tbody)
    const looseRows = { ...node, children: node.children?.filter((c) => c.tag === 'tr') }

    return this.block('core/table', {
      head: rows(thead),
      body: [...rows(tbody), ...rows(looseRows)],
    })
  }

  private mapContainer(node: HtmlNode): GutenbergBlock | null {
    const innerBlocks = this.mapChildren(node)
    if (innerBlocks.length === 0) return null
    // A container with a single child adds no structure — unwrap it
    if (innerBlocks.length === 1) return innerBlocks[0]
    return this.block('core/group', {}, innerBlocks)
  }

  /** CTA heuristic (gotcha #7): class hints or short standalone label. */
  private looksLikeButton(node: HtmlNode): boolean {
    const classes = node.classes ?? []
    if (classes.some((c) => /\b(btn|button|cta)\b/i.test(c))) return true
    const styles = node.styles ?? {}
    if (styles.display === 'block' || styles.display === 'inline-block') {
      return true
    }
    const text = this.extractText(node).trim()
    return text.length > 0 && text.length <= 30 && /^[A-Z]/.test(text)
  }

  private detectEmbedType(url: string): string | undefined {
    if (/youtube\.com|youtu\.be/.test(url)) return 'youtube'
    if (/vimeo\.com/.test(url)) return 'vimeo'
    if (/twitter\.com|x\.com/.test(url)) return 'twitter'
    if (/spotify\.com/.test(url)) return 'spotify'
    return undefined
  }

  private findChildAttr(node: HtmlNode, tag: string, attr: string): string | undefined {
    return node.children?.find((c) => c.tag === tag)?.attributes?.[attr]
  }

  /** Inner content as HTML, preserving inline formatting tags only. */
  private innerHtml(node: HtmlNode): string {
    return (node.children ?? [])
      .map((child) => {
        if (child.type === 'text') return escapeHtml(child.content ?? '')
        if (child.tag && INLINE_TAGS.has(child.tag)) return serializeNode(child)
        // Block-level child inside a text context: keep its text only
        return escapeHtml(this.extractText(child))
      })
      .join(' ')
      .replace(/\s+/g, ' ')
      .trim()
  }

  private extractText(node: HtmlNode): string {
    if (node.type === 'text') return node.content ?? ''
    return (node.children ?? []).map((c) => this.extractText(c)).join(' ')
  }
}
