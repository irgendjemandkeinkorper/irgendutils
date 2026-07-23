# HTML to Gutenberg Blocks Converter - Build Guide

## Project Overview

**Goal**: Build a tool that converts HTML (full site, single page, or code snippet) into WordPress Gutenberg block format, with intelligent fallback handling for unmappable content.

**Key Features**:
1. Three input modes: Full Site, Single Page, Code Snippet
2. HTML parser with semantic element detection
3. Auto-mapping to Gutenberg blocks
4. Template reference matching (optional—point to existing Gutenberg blocks and "make it like this")
5. Flagged sections for unmappable content with limited user choice options
6. Block JSON export + WordPress-compatible HTML output

---

## Tech Stack

**Frontend**:
- React 18+ with TypeScript
- Vite (fast dev server & builds)
- TailwindCSS (styling)
- Ace Editor (code preview)
- Cheerio (HTML parsing in browser/Node)
- React Query (data fetching)

**Backend** (Node.js + Express):
- Express.js (REST API)
- Cheerio (HTML parsing server-side for full-site crawls)
- Puppeteer (optional: headless browser for JS-heavy sites)
- Body-parser + multer (file uploads)

**Database** (Optional, for MVP use localStorage first):
- SQLite or PostgreSQL (store conversion history, templates)

**Deployment**:
- Docker for backend
- Vercel/Netlify for frontend

---

## File Structure

```
html-to-gutenberg/
├── frontend/
│   ├── src/
│   │   ├── components/
│   │   │   ├── InputSelector.tsx      # Full Site / Page / Snippet radio
│   │   │   ├── SourceUpload.tsx        # URL input, file upload, paste area
│   │   │   ├── TemplateSelector.tsx    # Reference template picker (optional)
│   │   │   ├── ConversionReview.tsx    # Show flagged sections, let user resolve
│   │   │   ├── BlockPreview.tsx        # Side-by-side preview of blocks
│   │   │   └── ExportOptions.tsx       # Download JSON, copy code, etc.
│   │   ├── pages/
│   │   │   ├── Converter.tsx           # Main wizard/stepper
│   │   │   └── Home.tsx                # Landing page
│   │   ├── services/
│   │   │   ├── parser.ts               # HTML parsing logic (browser-side)
│   │   │   ├── blockMapper.ts          # Maps HTML → Gutenberg blocks
│   │   │   ├── templateMatcher.ts      # Template reference logic
│   │   │   ├── flagDetector.ts         # Detects unmappable sections
│   │   │   ├── wpExporter.ts           # Generates block JSON & HTML
│   │   │   └── api.ts                  # Backend API calls
│   │   ├── types/
│   │   │   └── index.ts                # Shared TypeScript types
│   │   ├── hooks/
│   │   │   ├── useConversion.ts        # Main state hook
│   │   │   └── useTemplate.ts          # Template selection hook
│   │   ├── App.tsx
│   │   ├── main.tsx
│   │   └── tailwind.config.js
│   ├── public/
│   ├── package.json
│   ├── vite.config.ts
│   ├── tsconfig.json
│   └── index.html
│
├── backend/
│   ├── src/
│   │   ├── routes/
│   │   │   ├── convert.ts              # POST /api/convert
│   │   │   ├── crawl.ts                # POST /api/crawl (full-site)
│   │   │   ├── templates.ts            # GET /api/templates (fetch WP templates)
│   │   │   └── export.ts               # POST /api/export
│   │   ├── services/
│   │   │   ├── parser.ts               # Server-side HTML parsing
│   │   │   ├── crawler.ts              # Full-site crawling logic
│   │   │   ├── blockMapper.ts          # Block mapping (shared logic)
│   │   │   └── wpIntegration.ts        # WordPress REST API calls
│   │   ├── types/
│   │   │   └── index.ts                # Shared TypeScript types
│   │   ├── app.ts                      # Express app setup
│   │   ├── server.ts                   # Server entry point
│   │   └── config.ts                   # Environment config
│   ├── package.json
│   ├── tsconfig.json
│   └── Dockerfile
│
├── shared/
│   ├── types.ts                        # Shared types (blocks, HTML nodes, etc.)
│   ├── constants.ts                    # Block configurations, mappings
│   └── utils.ts                        # Helper functions (both frontend & backend)
│
├── docker-compose.yml
└── README.md
```

---

## Shared Types (shared/types.ts)

```typescript
// HTML to Block Mapping
export interface HtmlNode {
  type: 'element' | 'text';
  tag?: string;
  content?: string;
  attributes?: Record<string, string>;
  children?: HtmlNode[];
  styles?: Record<string, string>;
  classes?: string[];
}

export interface GutenbergBlock {
  blockName: string;
  attrs: Record<string, any>;
  innerBlocks: GutenbergBlock[];
  innerContent?: (string | null)[];
}

export interface FlaggedSection {
  id: string;
  type: 'unsupported-layout' | 'custom-element' | 'form' | 'embed' | 'animation' | 'svg' | 'other';
  description: string;
  htmlSnippet: string;
  originalNode: HtmlNode;
  suggestedBlockOptions: FallbackBlockOption[];
  userChoice?: FallbackBlockOption;
}

export interface FallbackBlockOption {
  id: string;
  blockName: string;
  label: string;
  description: string;
  preservesContent: boolean; // whether content is editable in Gutenberg
}

export interface ConversionResult {
  blocks: GutenbergBlock[];
  flaggedSections: FlaggedSection[];
  warnings: string[];
  metadata: {
    inputType: 'full-site' | 'page' | 'snippet';
    pageCount?: number;
    totalBlocks: number;
    conversionTime: number;
  };
}

export interface ExportFormat {
  format: 'json' | 'html';
  includeStyles?: boolean;
  includeCustomHtml?: boolean;
}

export interface TemplateReference {
  id: string;
  name: string;
  url?: string;
  blocks: GutenbergBlock[];
  metadata: {
    blockTypes: string[];
    columnCount?: number;
  };
}

export interface ConversionState {
  step: 'input' | 'source' | 'template' | 'review' | 'export';
  inputType?: 'full-site' | 'page' | 'snippet';
  sourceUrl?: string;
  sourceFile?: File;
  sourceHtml?: string;
  templateReference?: TemplateReference;
  result?: ConversionResult;
  loading: boolean;
  error?: string;
}
```

---

## Shared Constants (shared/constants.ts)

```typescript
// Gutenberg block types that are safe targets for fallback
export const FALLBACK_BLOCK_OPTIONS = [
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
];

// Automatic HTML → Gutenberg mappings
export const HTML_TO_BLOCK_MAP: Record<string, string> = {
  h1: 'core/heading',
  h2: 'core/heading',
  h3: 'core/heading',
  h4: 'core/heading',
  h5: 'core/heading',
  h6: 'core/heading',
  p: 'core/paragraph',
  img: 'core/image',
  ul: 'core/list',
  ol: 'core/list',
  blockquote: 'core/quote',
  table: 'core/table',
  video: 'core/video',
  iframe: 'core/embed',
  button: 'core/button',
  a: 'core/button', // if it looks like a CTA
  form: 'core/group', // default: wrap in group
};

// Elements that trigger flags
export const FLAGGABLE_SELECTORS = [
  'svg',
  'canvas',
  'form',
  '[style*="display: grid"]',
  '[style*="display: flex"]',
  '[style*="position: absolute"]',
  '[style*="position: fixed"]',
  '[onclick]',
  'script',
  '[data-custom]',
  '.hero',
  '.section-hero',
  '.custom-layout',
];

export const BLOCK_ATTRIBUTES_MAP: Record<string, Record<string, string>> = {
  'core/heading': {
    level: 'data-level',
    content: 'innerText',
    placeholder: 'data-placeholder',
  },
  'core/paragraph': {
    content: 'innerText',
    textColor: 'data-text-color',
    backgroundColor: 'data-bg-color',
  },
  'core/image': {
    url: 'src',
    alt: 'alt',
    title: 'title',
    width: 'width',
    height: 'height',
    caption: 'data-caption',
  },
  'core/list': {
    ordered: 'data-ordered',
    start: 'data-start',
  },
  'core/quote': {
    value: 'innerText',
    citation: 'data-citation',
  },
};
```

---

## Core Services

### Frontend: services/parser.ts (Cheerio-based HTML parsing)

```typescript
import { load } from 'cheerio';
import { HtmlNode } from '../types';

export class HtmlParser {
  parse(html: string): HtmlNode {
    const $ = load(html);
    return this.parseElement($.root().children()[0]);
  }

  private parseElement(elem: any): HtmlNode {
    if (!elem) return { type: 'text', content: '' };

    if (elem.type === 'text') {
      return {
        type: 'text',
        content: elem.data?.trim() || '',
      };
    }

    const tagName = elem.name?.toLowerCase();
    const $ = require('cheerio').load(elem);
    const element = $(elem);

    return {
      type: 'element',
      tag: tagName,
      attributes: Object.fromEntries(Object.entries(elem.attribs || {})),
      classes: element.attr('class')?.split(' ') || [],
      styles: this.parseStyles(element.attr('style')),
      children: Array.from(elem.children || [])
        .map((child: any) => this.parseElement(child))
        .filter(node => node.type !== 'text' || node.content?.trim()),
    };
  }

  private parseStyles(styleStr?: string): Record<string, string> {
    if (!styleStr) return {};
    const styles: Record<string, string> = {};
    styleStr.split(';').forEach(style => {
      const [key, value] = style.split(':').map(s => s.trim());
      if (key && value) styles[key] = value;
    });
    return styles;
  }
}
```

### Frontend: services/blockMapper.ts

```typescript
import { HtmlNode, GutenbergBlock } from '../types';
import { HTML_TO_BLOCK_MAP, BLOCK_ATTRIBUTES_MAP } from '../../shared/constants';

export class BlockMapper {
  mapNodeToBlock(node: HtmlNode): GutenbergBlock | null {
    if (node.type === 'text') {
      return null;
    }

    const tag = node.tag?.toLowerCase();
    if (!tag) return null;

    const blockName = HTML_TO_BLOCK_MAP[tag];
    if (!blockName) return null;

    const attrs = this.extractAttributes(tag, node);
    const innerBlocks = this.processChildren(node);

    return {
      blockName,
      attrs,
      innerBlocks,
    };
  }

  private extractAttributes(tag: string, node: HtmlNode): Record<string, any> {
    const attrs: Record<string, any> = {};

    // Heading level
    if (tag.match(/^h[1-6]$/)) {
      attrs.level = parseInt(tag[1]);
      attrs.content = this.extractText(node);
    }

    // Image
    if (tag === 'img') {
      attrs.url = node.attributes?.src || '';
      attrs.alt = node.attributes?.alt || '';
      attrs.title = node.attributes?.title || '';
      if (node.attributes?.width) attrs.width = parseInt(node.attributes.width);
      if (node.attributes?.height) attrs.height = parseInt(node.attributes.height);
    }

    // List
    if (tag === 'ul' || tag === 'ol') {
      attrs.ordered = tag === 'ol';
    }

    // Link/Button
    if (tag === 'a') {
      attrs.url = node.attributes?.href || '';
      attrs.text = this.extractText(node);
    }

    return attrs;
  }

  private extractText(node: HtmlNode): string {
    if (node.type === 'text') return node.content || '';
    return (node.children || [])
      .map(child => this.extractText(child))
      .join('');
  }

  private processChildren(node: HtmlNode): GutenbergBlock[] {
    const blocks: GutenbergBlock[] = [];
    
    for (const child of node.children || []) {
      if (child.type === 'text' && child.content?.trim()) {
        blocks.push({
          blockName: 'core/paragraph',
          attrs: { content: child.content },
          innerBlocks: [],
        });
      } else if (child.type === 'element') {
        const block = this.mapNodeToBlock(child);
        if (block) blocks.push(block);
      }
    }

    return blocks;
  }
}
```

### Frontend: services/flagDetector.ts

```typescript
import { HtmlNode, FlaggedSection, FallbackBlockOption } from '../types';
import { FLAGGABLE_SELECTORS, FALLBACK_BLOCK_OPTIONS } from '../../shared/constants';

export class FlagDetector {
  private flagCounter = 0;

  detectFlags(node: HtmlNode): FlaggedSection[] {
    const flags: FlaggedSection[] = [];
    this.flagCounter = 0;
    this._detectRecursive(node, flags);
    return flags;
  }

  private _detectRecursive(node: HtmlNode, flags: FlaggedSection[]): void {
    if (node.type === 'element') {
      const flag = this.checkElement(node);
      if (flag) {
        flags.push(flag);
        return; // Don't process children of flagged sections
      }

      for (const child of node.children || []) {
        this._detectRecursive(child, flags);
      }
    }
  }

  private checkElement(node: HtmlNode): FlaggedSection | null {
    const tag = node.tag?.toLowerCase();
    const styles = node.styles || {};

    // SVG/Canvas
    if (['svg', 'canvas'].includes(tag || '')) {
      return this.createFlag(
        node,
        'svg',
        `${tag?.toUpperCase()} element detected — cannot be converted`
      );
    }

    // Forms
    if (tag === 'form') {
      return this.createFlag(
        node,
        'form',
        'Form element detected — no native Gutenberg form block'
      );
    }

    // Complex layouts
    if (
      styles['display']?.includes('grid') ||
      styles['display']?.includes('flex') ||
      styles['display']?.includes('absolute') ||
      styles['display']?.includes('fixed')
    ) {
      return this.createFlag(
        node,
        'unsupported-layout',
        `Complex layout detected (${styles['display']}) — may not convert cleanly`
      );
    }

    // Interactive elements with event handlers
    if (node.attributes?.onclick || node.attributes?.['data-interactive']) {
      return this.createFlag(
        node,
        'custom-element',
        'Interactive element detected — requires custom handling'
      );
    }

    return null;
  }

  private createFlag(
    node: HtmlNode,
    type: FlaggedSection['type'],
    description: string
  ): FlaggedSection {
    return {
      id: `flag-${this.flagCounter++}`,
      type,
      description,
      htmlSnippet: this.serializeNode(node),
      originalNode: node,
      suggestedBlockOptions: FALLBACK_BLOCK_OPTIONS,
    };
  }

  private serializeNode(node: HtmlNode): string {
    if (node.type === 'text') return node.content || '';
    const tag = node.tag;
    const attrs = Object.entries(node.attributes || {})
      .map(([k, v]) => `${k}="${v}"`)
      .join(' ');
    const children = (node.children || [])
      .map(c => this.serializeNode(c))
      .join('');
    return `<${tag} ${attrs}>${children}</${tag}>`;
  }
}
```

### Frontend: services/wpExporter.ts

```typescript
import { GutenbergBlock, ConversionResult, ExportFormat } from '../types';

export class WpExporter {
  toJSON(result: ConversionResult): string {
    return JSON.stringify(result.blocks, null, 2);
  }

  toWordPressHtml(result: ConversionResult): string {
    let html = '';

    for (const block of result.blocks) {
      html += this.blockToWpComment(block) + '\n';
    }

    return html;
  }

  private blockToWpComment(block: GutenbergBlock): string {
    const attrs = Object.keys(block.attrs).length > 0 ? JSON.stringify(block.attrs) : '';
    const openTag = `<!-- wp:${block.blockName}${attrs ? ` ${attrs}` : ''} -->`;

    let content = '';
    if (block.innerBlocks?.length > 0) {
      for (const innerBlock of block.innerBlocks) {
        content += this.blockToWpComment(innerBlock) + '\n';
      }
    }

    const closeTag = `<!-- /wp:${block.blockName} -->`;

    return `${openTag}\n${content}\n${closeTag}`;
  }

  downloadJSON(result: ConversionResult, filename: string = 'blocks.json'): void {
    const json = this.toJSON(result);
    this.downloadFile(json, filename, 'application/json');
  }

  downloadHTML(result: ConversionResult, filename: string = 'blocks.html'): void {
    const html = this.toWordPressHtml(result);
    this.downloadFile(html, filename, 'text/html');
  }

  private downloadFile(content: string, filename: string, mimeType: string): void {
    const blob = new Blob([content], { type: mimeType });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  }

  copyToClipboard(result: ConversionResult, format: 'json' | 'html' = 'json'): Promise<void> {
    const content = format === 'json' ? this.toJSON(result) : this.toWordPressHtml(result);
    return navigator.clipboard.writeText(content);
  }
}
```

---

## Frontend React Components

### components/InputSelector.tsx

```typescript
import React from 'react';
import { ConversionState } from '../types';

interface Props {
  state: ConversionState;
  onSelect: (type: ConversionState['inputType']) => void;
}

export const InputSelector: React.FC<Props> = ({ state, onSelect }) => {
  return (
    <div className="space-y-4">
      <h2 className="text-2xl font-bold">What are you converting?</h2>
      
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {[
          { id: 'full-site', label: 'Full Site', desc: 'Crawl and convert entire website' },
          { id: 'page', label: 'Single Page', desc: 'Convert one HTML page' },
          { id: 'snippet', label: 'Code Snippet', desc: 'Paste HTML fragment' },
        ].map(option => (
          <button
            key={option.id}
            onClick={() => onSelect(option.id as any)}
            className={`p-6 rounded-lg border-2 text-left transition ${
              state.inputType === option.id
                ? 'border-blue-500 bg-blue-50'
                : 'border-gray-200 hover:border-gray-300'
            }`}
          >
            <div className="font-semibold text-lg">{option.label}</div>
            <div className="text-sm text-gray-600 mt-2">{option.desc}</div>
          </button>
        ))}
      </div>
    </div>
  );
};
```

### components/ConversionReview.tsx

```typescript
import React, { useState } from 'react';
import { ConversionResult, FlaggedSection, FallbackBlockOption } from '../types';

interface Props {
  result: ConversionResult;
  onResolveFlag: (flagId: string, choice: FallbackBlockOption) => void;
}

export const ConversionReview: React.FC<Props> = ({ result, onResolveFlag }) => {
  const [expandedFlag, setExpandedFlag] = useState<string | null>(null);

  return (
    <div className="space-y-6">
      <div className="bg-green-50 border border-green-200 rounded p-4">
        <h3 className="font-semibold text-green-900">✓ Auto-mapped blocks</h3>
        <p className="text-sm text-green-800 mt-1">
          {result.blocks.length} blocks ready to use
        </p>
      </div>

      {result.flaggedSections.length > 0 && (
        <div className="space-y-4">
          <h3 className="font-semibold">⚠️ Sections needing your input</h3>
          {result.flaggedSections.map(flag => (
            <div
              key={flag.id}
              className="border border-amber-200 rounded-lg p-4 bg-amber-50"
            >
              <button
                onClick={() => setExpandedFlag(expandedFlag === flag.id ? null : flag.id)}
                className="w-full text-left flex justify-between items-center"
              >
                <div>
                  <div className="font-semibold text-amber-900">{flag.type}</div>
                  <div className="text-sm text-amber-800 mt-1">{flag.description}</div>
                </div>
                <span className="text-2xl">{expandedFlag === flag.id ? '−' : '+'}</span>
              </button>

              {expandedFlag === flag.id && (
                <div className="mt-4 space-y-4">
                  <div className="bg-gray-100 p-3 rounded font-mono text-xs overflow-auto max-h-40">
                    {flag.htmlSnippet}
                  </div>

                  <div className="space-y-2">
                    <p className="text-sm font-semibold">Choose how to handle this:</p>
                    {flag.suggestedBlockOptions.map(option => (
                      <button
                        key={option.id}
                        onClick={() => onResolveFlag(flag.id, option)}
                        className={`block w-full text-left p-3 rounded border-2 transition ${
                          flag.userChoice?.id === option.id
                            ? 'border-blue-500 bg-blue-50'
                            : 'border-gray-200 hover:border-gray-300'
                        }`}
                      >
                        <div className="font-semibold text-sm">{option.label}</div>
                        <div className="text-xs text-gray-600 mt-1">{option.description}</div>
                        {!option.preservesContent && (
                          <div className="text-xs text-red-600 mt-1">
                            ⚠️ Content not editable in Gutenberg
                          </div>
                        )}
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {result.warnings.length > 0 && (
        <div className="bg-yellow-50 border border-yellow-200 rounded p-4">
          <h3 className="font-semibold text-yellow-900">Warnings</h3>
          <ul className="text-sm text-yellow-800 mt-2 space-y-1">
            {result.warnings.map((w, i) => (
              <li key={i}>• {w}</li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
};
```

### components/ExportOptions.tsx

```typescript
import React, { useState } from 'react';
import { ConversionResult } from '../types';
import { WpExporter } from '../services/wpExporter';

interface Props {
  result: ConversionResult;
}

export const ExportOptions: React.FC<Props> = ({ result }) => {
  const [copied, setCopied] = useState<string | null>(null);
  const exporter = new WpExporter();

  const handleCopy = async (format: 'json' | 'html') => {
    await exporter.copyToClipboard(result, format);
    setCopied(format);
    setTimeout(() => setCopied(null), 2000);
  };

  return (
    <div className="space-y-4">
      <h2 className="text-2xl font-bold">Export your blocks</h2>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {/* JSON Export */}
        <div className="border rounded-lg p-6">
          <h3 className="font-semibold mb-4">Block JSON</h3>
          <p className="text-sm text-gray-600 mb-4">
            Copy and paste into WordPress REST API or block plugins
          </p>
          <div className="space-y-2">
            <button
              onClick={() => exporter.downloadJSON(result)}
              className="w-full bg-blue-500 hover:bg-blue-600 text-white py-2 px-4 rounded"
            >
              ⬇️ Download JSON
            </button>
            <button
              onClick={() => handleCopy('json')}
              className="w-full bg-gray-500 hover:bg-gray-600 text-white py-2 px-4 rounded"
            >
              {copied === 'json' ? '✓ Copied!' : '📋 Copy to Clipboard'}
            </button>
          </div>
        </div>

        {/* HTML Export */}
        <div className="border rounded-lg p-6">
          <h3 className="font-semibold mb-4">WordPress HTML</h3>
          <p className="text-sm text-gray-600 mb-4">
            Paste directly into WordPress editor
          </p>
          <div className="space-y-2">
            <button
              onClick={() => exporter.downloadHTML(result)}
              className="w-full bg-blue-500 hover:bg-blue-600 text-white py-2 px-4 rounded"
            >
              ⬇️ Download HTML
            </button>
            <button
              onClick={() => handleCopy('html')}
              className="w-full bg-gray-500 hover:bg-gray-600 text-white py-2 px-4 rounded"
            >
              {copied === 'html' ? '✓ Copied!' : '📋 Copy to Clipboard'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
```

---

## Main Converter Hook (hooks/useConversion.ts)

```typescript
import { useState, useCallback } from 'react';
import { ConversionState, ConversionResult, FallbackBlockOption } from '../types';
import { HtmlParser } from '../services/parser';
import { BlockMapper } from '../services/blockMapper';
import { FlagDetector } from '../services/flagDetector';

export const useConversion = () => {
  const [state, setState] = useState<ConversionState>({
    step: 'input',
    loading: false,
  });

  const selectInputType = useCallback((type: ConversionState['inputType']) => {
    setState(prev => ({ ...prev, inputType: type, step: 'source' }));
  }, []);

  const handleHtmlSubmit = useCallback(async (html: string) => {
    setState(prev => ({ ...prev, loading: true, error: undefined }));

    try {
      const parser = new HtmlParser();
      const tree = parser.parse(html);

      const mapper = new BlockMapper();
      const blocks = tree.children
        ?.map(child => mapper.mapNodeToBlock(child))
        .filter(Boolean) || [];

      const flagDetector = new FlagDetector();
      const flags = flagDetector.detectFlags(tree);

      const result: ConversionResult = {
        blocks,
        flaggedSections: flags,
        warnings: [],
        metadata: {
          inputType: state.inputType || 'snippet',
          totalBlocks: blocks.length,
          conversionTime: Date.now(),
        },
      };

      setState(prev => ({
        ...prev,
        result,
        step: flags.length > 0 ? 'review' : 'export',
        sourceHtml: html,
        loading: false,
      }));
    } catch (error) {
      setState(prev => ({
        ...prev,
        error: error instanceof Error ? error.message : 'Conversion failed',
        loading: false,
      }));
    }
  }, [state.inputType]);

  const resolveFlag = useCallback(
    (flagId: string, choice: FallbackBlockOption) => {
      setState(prev => {
        if (!prev.result) return prev;

        return {
          ...prev,
          result: {
            ...prev.result,
            flaggedSections: prev.result.flaggedSections.map(flag =>
              flag.id === flagId ? { ...flag, userChoice: choice } : flag
            ),
          },
        };
      });
    },
    []
  );

  const proceedToExport = useCallback(() => {
    setState(prev => ({ ...prev, step: 'export' }));
  }, []);

  return {
    state,
    selectInputType,
    handleHtmlSubmit,
    resolveFlag,
    proceedToExport,
  };
};
```

---

## Backend Setup (backend/src/app.ts)

```typescript
import express from 'express';
import cors from 'cors';
import multer from 'multer';
import { convertRoute } from './routes/convert';
import { crawlRoute } from './routes/crawl';
import { exportRoute } from './routes/export';

const app = express();
const upload = multer({ storage: multer.memoryStorage() });

// Middleware
app.use(cors());
app.use(express.json({ limit: '10mb' }));
app.use(express.text({ limit: '10mb' }));

// Routes
app.post('/api/convert', upload.single('file'), convertRoute);
app.post('/api/crawl', crawlRoute);
app.post('/api/export', exportRoute);

// Health check
app.get('/health', (req, res) => {
  res.json({ status: 'ok' });
});

export default app;
```

---

## Implementation Steps

### Phase 1: Core MVP (Week 1)
1. **Setup**
   - Initialize Vite + React frontend
   - Setup Express backend with TypeScript
   - Define shared types

2. **Parsing**
   - Implement `HtmlParser` (Cheerio-based)
   - Test with basic HTML samples

3. **Block Mapping**
   - Implement `BlockMapper` for auto-conversions
   - Cover: headings, paragraphs, images, lists

4. **Flag Detection**
   - Implement `FlagDetector`
   - Catch: forms, complex layouts, SVG, canvas

5. **Frontend**
   - Build `InputSelector` component
   - Build `SourceUpload` component (paste/file)
   - Build `ConversionReview` component
   - Wire together with `useConversion` hook

6. **Export**
   - Implement `WpExporter` (JSON + HTML)
   - Build `ExportOptions` component

### Phase 2: Enhancement (Week 2)
1. **Full-site crawling**
   - Implement `Crawler` service (Cheerio for simple HTML, Puppeteer for JS-heavy)
   - Handle pagination, multi-page aggregation

2. **Template Matching**
   - Implement `TemplateSelector` UI
   - Connect to WordPress REST API (fetch template blocks)
   - Implement template-aware block suggestions

3. **Advanced flagging**
   - Better detection for animations, custom embeds
   - Media asset detection + bundling

4. **Testing**
   - Unit tests for parser, mapper, flag detector
   - E2E tests for conversion workflows

### Phase 3: Polish (Week 3)
1. **Styling & UX**
   - Responsive design
   - Loading states, error handling
   - Side-by-side preview (original HTML vs. blocks)

2. **Documentation**
   - README with usage examples
   - API docs

3. **Deployment**
   - Docker setup
   - CI/CD pipeline
   - Vercel + backend hosting

---

## Running Locally

### Prerequisites
- Node.js 18+
- npm or yarn

### Frontend Setup
```bash
cd frontend
npm install
npm run dev
# Opens on http://localhost:5173
```

### Backend Setup
```bash
cd backend
npm install
npm run dev
# Runs on http://localhost:3000
```

### Full Stack (Docker)
```bash
docker-compose up
# Frontend: http://localhost:3000
# Backend API: http://localhost:3001
```

---

## Next Steps

1. **Clone/create the repo** with the file structure above
2. **Install dependencies** (React, Express, Cheerio, etc.)
3. **Run Claude Code** with this guide and start building component by component
4. **Test each phase** before moving to the next
5. **Iterate on UX** based on manual testing

Start with Phase 1 for a working MVP, then expand features as needed!
