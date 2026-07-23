// Shared types for the HTML → Gutenberg conversion pipeline.
// Mirrors shared/types.ts from the build guide so the same shapes can be
// reused by a future backend.

export interface HtmlNode {
  type: 'element' | 'text'
  tag?: string
  content?: string
  attributes?: Record<string, string>
  children?: HtmlNode[]
  styles?: Record<string, string>
  classes?: string[]
}

export interface GutenbergBlock {
  blockName: string
  attrs: Record<string, any>
  innerBlocks: GutenbergBlock[]
  innerContent?: (string | null)[]
}

export type FlagType =
  | 'unsupported-layout'
  | 'custom-element'
  | 'form'
  | 'embed'
  | 'animation'
  | 'svg'
  | 'heading-hierarchy'
  | 'accessibility-warning'
  | 'other'

export interface FlaggedSection {
  id: string
  type: FlagType
  description: string
  htmlSnippet: string
  originalNode: HtmlNode
  suggestedBlockOptions: FallbackBlockOption[]
  userChoice?: FallbackBlockOption
}

export interface FallbackBlockOption {
  id: string
  blockName: string
  label: string
  description: string
  preservesContent: boolean // whether content is editable in Gutenberg
}

export interface ConversionResult {
  blocks: GutenbergBlock[]
  flaggedSections: FlaggedSection[]
  warnings: string[]
  metadata: {
    inputType: 'full-site' | 'page' | 'snippet'
    pageCount?: number
    totalBlocks: number
    conversionTime: number
  }
}

export interface ConversionState {
  step: 'input' | 'source' | 'review' | 'export'
  inputType?: 'full-site' | 'page' | 'snippet'
  sourceHtml?: string
  result?: ConversionResult
  loading: boolean
  error?: string
}
