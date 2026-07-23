import { ConversionResult, FlaggedSection, GutenbergBlock, HtmlNode } from '../types'
import { HtmlParser } from './parser'
import { BlockMapper } from './blockMapper'
import { collectWarnings, FlagDetector } from './flagDetector'

/**
 * Placeholder blockName used where a flagged section sits in the block tree.
 * Replaced by the user's chosen fallback at export time, preserving order.
 */
export const PENDING_FLAG = '__pending-flag__'

/** Full pipeline: parse → detect flags → map (flag-aware) → warnings. */
export function convertHtml(
  html: string,
  inputType: 'full-site' | 'page' | 'snippet',
): ConversionResult {
  const start = performance.now()

  const parser = new HtmlParser()
  const tree = parser.parse(html)

  const detector = new FlagDetector()
  const flaggedSections = detector.detectFlags(tree)
  const flagByNode = new Map<HtmlNode, FlaggedSection>(
    flaggedSections.map((f) => [f.originalNode, f]),
  )

  // Flagged nodes become placeholders instead of being mapped — this keeps
  // their position in the document and prevents double-conversion.
  const mapper = new BlockMapper((node) => {
    const flag = flagByNode.get(node)
    if (flag) {
      return { blockName: PENDING_FLAG, attrs: { flagId: flag.id }, innerBlocks: [] }
    }
    return undefined
  })

  const blocks = mapper.mapChildren(tree)
  const warnings = collectWarnings(tree)

  return {
    blocks,
    flaggedSections,
    warnings,
    metadata: {
      inputType,
      totalBlocks: countBlocks(blocks),
      conversionTime: Math.round(performance.now() - start),
    },
  }
}

/**
 * Replace flag placeholders with the user's chosen fallback blocks.
 * Unresolved flags default to Custom HTML so no content is silently lost.
 */
export function applyResolutions(result: ConversionResult): GutenbergBlock[] {
  const flagById = new Map(result.flaggedSections.map((f) => [f.id, f]))
  const plainMapper = new BlockMapper()

  const resolve = (blocks: GutenbergBlock[]): GutenbergBlock[] =>
    blocks.flatMap((block) => {
      if (block.blockName !== PENDING_FLAG) {
        return [{ ...block, innerBlocks: resolve(block.innerBlocks) }]
      }

      const flag = flagById.get(block.attrs.flagId)
      if (!flag) return []
      const choice = flag.userChoice?.id ?? 'custom'

      switch (choice) {
        case 'skip':
          return []

        case 'group': {
          const inner = plainMapper.mapChildren(flag.originalNode)
          return [{ blockName: 'core/group', attrs: {}, innerBlocks: inner }]
        }

        case 'columns': {
          const columns = (flag.originalNode.children ?? [])
            .filter((c) => c.type === 'element')
            .map((child) => ({
              blockName: 'core/column',
              attrs: {},
              innerBlocks: [plainMapper.mapNodeToBlock(child)].filter(
                (b): b is GutenbergBlock => b !== null,
              ),
            }))
          return [{ blockName: 'core/columns', attrs: {}, innerBlocks: columns }]
        }

        case 'cover': {
          const inner = plainMapper.mapChildren(flag.originalNode)
          return [
            { blockName: 'core/cover', attrs: { dimRatio: 50 }, innerBlocks: inner },
          ]
        }

        case 'custom':
        default:
          return [
            {
              blockName: 'core/html',
              attrs: { content: flag.htmlSnippet },
              innerBlocks: [],
            },
          ]
      }
    })

  return resolve(result.blocks)
}

function countBlocks(blocks: GutenbergBlock[]): number {
  return blocks.reduce(
    (sum, b) =>
      sum + (b.blockName === PENDING_FLAG ? 0 : 1) + countBlocks(b.innerBlocks),
    0,
  )
}
