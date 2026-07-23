import { load } from 'cheerio'
import type { AnyNode, Element, Text } from 'domhandler'
import { HtmlNode } from '../types'

/**
 * Cheerio-based HTML parser (works in browser and Node).
 *
 * Produces the shared HtmlNode tree consumed by BlockMapper and FlagDetector.
 * Unlike the build-guide sample, this walks the htmlparser2 DOM directly —
 * no re-loading cheerio per element (which breaks in browser bundles).
 */
export class HtmlParser {
  /**
   * Parse an HTML string (fragment or full document) into a single root
   * HtmlNode whose children are the top-level elements.
   */
  parse(html: string): HtmlNode {
    const $ = load(html)
    // load() always wraps content in html/body — body's children are the
    // real top-level nodes whether the input was a fragment or a full page.
    const body = $('body')[0]

    const children = (body?.children ?? [])
      .map((child) => this.parseNode(child))
      .filter((node): node is HtmlNode => node !== null)

    return {
      type: 'element',
      tag: 'root',
      attributes: {},
      classes: [],
      styles: {},
      children,
    }
  }

  private parseNode(node: AnyNode): HtmlNode | null {
    if (node.type === 'text') {
      const content = (node as Text).data
      // Drop whitespace-only text nodes early (gotcha #4)
      if (!content?.trim()) return null
      return { type: 'text', content: content.trim() }
    }

    if (node.type !== 'tag' && node.type !== 'script' && node.type !== 'style') {
      // Comments, doctypes, CDATA — skip
      return null
    }

    const elem = node as Element
    const attributes: Record<string, string> = { ...elem.attribs }

    return {
      type: 'element',
      tag: elem.name.toLowerCase(),
      attributes,
      classes: attributes.class?.split(/\s+/).filter(Boolean) ?? [],
      styles: this.parseStyles(attributes.style),
      children: (elem.children ?? [])
        .map((child) => this.parseNode(child))
        .filter((n): n is HtmlNode => n !== null),
    }
  }

  private parseStyles(styleStr?: string): Record<string, string> {
    if (!styleStr) return {}
    const styles: Record<string, string> = {}
    styleStr.split(';').forEach((style) => {
      const idx = style.indexOf(':')
      if (idx === -1) return
      const key = style.slice(0, idx).trim().toLowerCase()
      const value = style.slice(idx + 1).trim()
      if (key && value) styles[key] = value
    })
    return styles
  }
}

/** Serialize an HtmlNode back to an HTML string (used for snippets/fallbacks). */
export function serializeNode(node: HtmlNode): string {
  if (node.type === 'text') return escapeHtml(node.content ?? '')

  const tag = node.tag ?? 'div'
  const attrs = Object.entries(node.attributes ?? {})
    .map(([k, v]) => ` ${k}="${escapeAttr(v)}"`)
    .join('')

  const VOID_TAGS = new Set([
    'img', 'br', 'hr', 'input', 'meta', 'link', 'source', 'area', 'base',
    'col', 'embed', 'track', 'wbr',
  ])
  if (VOID_TAGS.has(tag)) return `<${tag}${attrs} />`

  const children = (node.children ?? []).map(serializeNode).join('')
  return `<${tag}${attrs}>${children}</${tag}>`
}

export function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
}

function escapeAttr(text: string): string {
  return escapeHtml(text).replace(/"/g, '&quot;')
}
