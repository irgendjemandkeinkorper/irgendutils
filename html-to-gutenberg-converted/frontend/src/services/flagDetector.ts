import { FlaggedSection, FlagType, HtmlNode } from '../types'
import { FALLBACK_BLOCK_OPTIONS, FLAGGABLE_CLASSES } from '../constants'
import { serializeNode } from './parser'

/**
 * Walks the HtmlNode tree and flags sections that can't be auto-converted:
 * SVG/canvas, forms, grid/flex/absolute layouts, inline event handlers,
 * hero-ish class names.
 *
 * Flagged nodes are returned for user resolution; children of a flagged
 * node are not scanned further (the whole section is handled as one unit).
 */
export class FlagDetector {
  private flagCounter = 0

  detectFlags(root: HtmlNode): FlaggedSection[] {
    const flags: FlaggedSection[] = []
    this.flagCounter = 0
    for (const child of root.children ?? []) {
      this.detectRecursive(child, flags)
    }
    return flags
  }

  /** True if this exact node is flagged (used by the converter to skip mapping). */
  isFlaggable(node: HtmlNode): boolean {
    return this.checkElement(node) !== null
  }

  private detectRecursive(node: HtmlNode, flags: FlaggedSection[]): void {
    if (node.type !== 'element') return

    const flag = this.checkElement(node)
    if (flag) {
      flags.push({
        id: `flag-${this.flagCounter++}`,
        ...flag,
        htmlSnippet: serializeNode(node),
        originalNode: node,
        suggestedBlockOptions: FALLBACK_BLOCK_OPTIONS,
      })
      return // Don't descend into flagged sections
    }

    for (const child of node.children ?? []) {
      this.detectRecursive(child, flags)
    }
  }

  private checkElement(
    node: HtmlNode,
  ): { type: FlagType; description: string } | null {
    if (node.type !== 'element') return null
    const tag = node.tag ?? ''
    const styles = node.styles ?? {}
    const attrs = node.attributes ?? {}
    const classes = node.classes ?? []

    // SVG / Canvas — vector & scripted graphics can't be converted
    if (tag === 'svg' || tag === 'canvas') {
      return {
        type: 'svg',
        description: `${tag.toUpperCase()} element detected — cannot be converted to a native block`,
      }
    }

    // Forms — no native Gutenberg form block
    if (tag === 'form') {
      return {
        type: 'form',
        description: 'Form element detected — Gutenberg has no native form block',
      }
    }

    // Complex layouts (fixed from the guide sample: position lives in
    // styles.position, not styles.display)
    const display = styles['display'] ?? ''
    const position = styles['position'] ?? ''
    if (display.includes('grid') || display.includes('flex')) {
      return {
        type: 'unsupported-layout',
        description: `Complex layout detected (display: ${display}) — may not convert cleanly`,
      }
    }
    if (position === 'absolute' || position === 'fixed') {
      return {
        type: 'unsupported-layout',
        description: `Positioned element detected (position: ${position}) — Gutenberg does not support absolute positioning`,
      }
    }

    // Interactive elements with inline handlers
    const hasHandler = Object.keys(attrs).some((k) => k.startsWith('on'))
    if (hasHandler || attrs['data-interactive'] !== undefined) {
      return {
        type: 'custom-element',
        description: 'Interactive element with event handlers — requires custom handling',
      }
    }

    // Custom data attributes suggesting special functionality
    if (attrs['data-custom'] !== undefined) {
      return {
        type: 'custom-element',
        description: 'Custom data attributes detected — may have special functionality',
      }
    }

    // Hero / custom-layout class names
    if (classes.some((c) => FLAGGABLE_CLASSES.includes(c))) {
      return {
        type: 'custom-element',
        description: `Class "${classes.find((c) => FLAGGABLE_CLASSES.includes(c))}" suggests complex custom styling`,
      }
    }

    return null
  }
}

/**
 * Warning-level checks that don't block conversion (heading hierarchy,
 * missing alt text, animations). Returned as strings for the warnings list.
 */
export function collectWarnings(root: HtmlNode): string[] {
  const warnings: string[] = []
  let previousHeading = 0

  const walk = (node: HtmlNode) => {
    if (node.type !== 'element') return
    const tag = node.tag ?? ''

    const headingMatch = /^h([1-6])$/.exec(tag)
    if (headingMatch) {
      const level = parseInt(headingMatch[1], 10)
      if (previousHeading > 0 && level > previousHeading + 1) {
        warnings.push(
          `Heading hierarchy jumps from h${previousHeading} to h${level} — consider using h${previousHeading + 1}`,
        )
      }
      previousHeading = level
    }

    if (tag === 'img' && !node.attributes?.alt) {
      warnings.push(
        `Image missing alt text (${node.attributes?.src ?? 'unknown source'})`,
      )
    }

    if (tag === 'img' && node.attributes?.src && !/^(https?:)?\/\//.test(node.attributes.src)) {
      warnings.push(
        `Image uses a relative URL (${node.attributes.src}) — it may not load in WordPress`,
      )
    }

    if (tag === 'style') {
      warnings.push('Inline <style> tag detected — CSS rules and animations will not be preserved')
    }

    const styles = node.styles ?? {}
    if (styles['animation'] || styles['transition']) {
      warnings.push('CSS animation/transition detected — will not be preserved in Gutenberg')
    }

    for (const child of node.children ?? []) walk(child)
  }

  walk(root)
  return [...new Set(warnings)]
}
