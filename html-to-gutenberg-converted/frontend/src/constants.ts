import { FallbackBlockOption } from './types'

// Gutenberg block types that are safe targets for fallback
export const FALLBACK_BLOCK_OPTIONS: FallbackBlockOption[] = [
  {
    id: 'group',
    blockName: 'core/group',
    label: 'Group',
    description: 'Wrapper for related content; content remains fully editable',
    preservesContent: true,
  },
  {
    id: 'columns',
    blockName: 'core/columns',
    label: 'Columns',
    description: 'Multi-column layout; best for side-by-side sections',
    preservesContent: true,
  },
  {
    id: 'cover',
    blockName: 'core/cover',
    label: 'Cover',
    description: 'Hero/banner with background; best for full-width visuals',
    preservesContent: true,
  },
  {
    id: 'custom',
    blockName: 'core/html',
    label: 'Custom HTML',
    description: 'Raw HTML fallback; content not editable in Gutenberg',
    preservesContent: false,
  },
  {
    id: 'skip',
    blockName: 'skip',
    label: 'Skip Section',
    description: 'Do not include this section',
    preservesContent: false,
  },
]

// Automatic HTML → Gutenberg mappings (single-element, high confidence)
export const HTML_TO_BLOCK_MAP: Record<string, string> = {
  h1: 'core/heading',
  h2: 'core/heading',
  h3: 'core/heading',
  h4: 'core/heading',
  h5: 'core/heading',
  h6: 'core/heading',
  p: 'core/paragraph',
  img: 'core/image',
  figure: 'core/image',
  ul: 'core/list',
  ol: 'core/list',
  blockquote: 'core/quote',
  table: 'core/table',
  video: 'core/video',
  audio: 'core/audio',
  iframe: 'core/embed',
  button: 'core/button',
  pre: 'core/code',
  hr: 'core/separator',
}

// Container tags that map to core/group and have their children processed
export const CONTAINER_TAGS = new Set([
  'div',
  'section',
  'article',
  'main',
  'header',
  'footer',
  'aside',
  'nav',
  'body',
])

// Inline tags whose markup we preserve inside block content
export const INLINE_TAGS = new Set([
  'a',
  'strong',
  'b',
  'em',
  'i',
  'u',
  's',
  'code',
  'span',
  'br',
  'sub',
  'sup',
  'mark',
  'small',
  'abbr',
  'kbd',
])

// Class names that suggest a hero / custom layout worth flagging
export const FLAGGABLE_CLASSES = ['hero', 'section-hero', 'custom-layout']
