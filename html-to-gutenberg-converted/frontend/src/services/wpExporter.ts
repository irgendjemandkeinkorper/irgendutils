import { GutenbergBlock } from '../types'

/**
 * Serializes Gutenberg blocks to the two export formats:
 *
 * 1. Block JSON — the parsed-block array (for REST API / programmatic use).
 * 2. WordPress HTML — `<!-- wp:name {attrs} -->…<!-- /wp:name -->` comments
 *    WITH real inner HTML, so pasting into the editor produces working,
 *    editable blocks. Note WordPress omits the `core/` prefix in comments
 *    and stores visible content in the HTML, not in the attrs JSON.
 */
export class WpExporter {
  toJSON(blocks: GutenbergBlock[]): string {
    return JSON.stringify(blocks, null, 2)
  }

  toWordPressHtml(blocks: GutenbergBlock[]): string {
    return blocks.map((b) => this.serializeBlock(b)).join('\n\n')
  }

  // ------------------------------------------------------------ serializers

  private serializeBlock(block: GutenbergBlock): string {
    const name = block.blockName.replace(/^core\//, '')
    const a = block.attrs

    switch (block.blockName) {
      case 'core/paragraph':
        return this.wrap('paragraph', {}, `<p>${a.content ?? ''}</p>`)

      case 'core/heading': {
        const level = a.level ?? 2
        const attrs = level === 2 ? {} : { level }
        return this.wrap(
          'heading',
          attrs,
          `<h${level} class="wp-block-heading">${a.content ?? ''}</h${level}>`,
        )
      }

      case 'core/image': {
        const dims: Record<string, any> = {}
        if (a.width) dims.width = a.width
        if (a.height) dims.height = a.height
        const sizeAttrs = [
          a.width ? ` width="${a.width}"` : '',
          a.height ? ` height="${a.height}"` : '',
        ].join('')
        const caption = a.caption
          ? `<figcaption class="wp-element-caption">${a.caption}</figcaption>`
          : ''
        return this.wrap(
          'image',
          dims,
          `<figure class="wp-block-image"><img src="${esc(a.url ?? '')}" alt="${esc(a.alt ?? '')}"${sizeAttrs}/>${caption}</figure>`,
        )
      }

      case 'core/list': {
        const tag = a.ordered ? 'ol' : 'ul'
        const attrs: Record<string, any> = {}
        if (a.ordered) attrs.ordered = true
        if (a.start) attrs.start = a.start
        const items = block.innerBlocks
          .map((item) => this.serializeListItem(item))
          .join('')
        const startAttr = a.start ? ` start="${a.start}"` : ''
        return this.wrap(
          'list',
          attrs,
          `<${tag}${startAttr} class="wp-block-list">${items}</${tag}>`,
        )
      }

      case 'core/quote': {
        const inner = block.innerBlocks
          .map((b) => this.serializeBlock(b))
          .join('\n')
        const cite = a.citation ? `<cite>${a.citation}</cite>` : ''
        return this.wrap(
          'quote',
          {},
          `<blockquote class="wp-block-quote">${inner}${cite}</blockquote>`,
        )
      }

      case 'core/table': {
        const section = (rows: any[] | undefined, tag: string) => {
          if (!rows?.length) return ''
          const trs = rows
            .map(
              (row) =>
                `<tr>${(row.cells ?? [])
                  .map((c: any) => `<${c.tag}>${c.content}</${c.tag}>`)
                  .join('')}</tr>`,
            )
            .join('')
          return `<${tag}>${trs}</${tag}>`
        }
        return this.wrap(
          'table',
          {},
          `<figure class="wp-block-table"><table class="has-fixed-layout">${section(a.head, 'thead')}${section(a.body, 'tbody')}</table></figure>`,
        )
      }

      case 'core/button': {
        // Buttons must live inside a wp:buttons wrapper to validate cleanly
        const href = a.url ? ` href="${esc(a.url)}"` : ''
        const button = this.wrap(
          'button',
          {},
          `<div class="wp-block-button"><a class="wp-block-button__link wp-element-button"${href}>${a.text ?? ''}</a></div>`,
        )
        return this.wrap('buttons', {}, `<div class="wp-block-buttons">${button}</div>`)
      }

      case 'core/group': {
        const inner = block.innerBlocks
          .map((b) => this.serializeBlock(b))
          .join('\n\n')
        return this.wrap(
          'group',
          { layout: { type: 'constrained' } },
          `<div class="wp-block-group">${inner}</div>`,
        )
      }

      case 'core/columns': {
        const cols = block.innerBlocks
          .map((col) => {
            const colInner = col.innerBlocks
              .map((b) => this.serializeBlock(b))
              .join('\n\n')
            return this.wrap('column', {}, `<div class="wp-block-column">${colInner}</div>`)
          })
          .join('\n\n')
        return this.wrap('columns', {}, `<div class="wp-block-columns">${cols}</div>`)
      }

      case 'core/cover': {
        const inner = block.innerBlocks
          .map((b) => this.serializeBlock(b))
          .join('\n\n')
        return this.wrap(
          'cover',
          { dimRatio: a.dimRatio ?? 50 },
          `<div class="wp-block-cover"><span aria-hidden="true" class="wp-block-cover__background has-background-dim"></span><div class="wp-block-cover__inner-container">${inner}</div></div>`,
        )
      }

      case 'core/embed': {
        const attrs: Record<string, any> = { url: a.url }
        if (a.type) {
          attrs.type = 'video'
          attrs.providerNameSlug = a.type
        }
        return this.wrap(
          'embed',
          attrs,
          `<figure class="wp-block-embed"><div class="wp-block-embed__wrapper">\n${a.url ?? ''}\n</div></figure>`,
        )
      }

      case 'core/video': {
        const poster = a.poster ? ` poster="${esc(a.poster)}"` : ''
        return this.wrap(
          'video',
          {},
          `<figure class="wp-block-video"><video controls src="${esc(a.src ?? '')}"${poster}></video></figure>`,
        )
      }

      case 'core/audio':
        return this.wrap(
          'audio',
          {},
          `<figure class="wp-block-audio"><audio controls src="${esc(a.src ?? '')}"></audio></figure>`,
        )

      case 'core/code':
        return this.wrap(
          'code',
          {},
          `<pre class="wp-block-code"><code>${escText(a.content ?? '')}</code></pre>`,
        )

      case 'core/separator':
        return this.wrap(
          'separator',
          {},
          '<hr class="wp-block-separator has-alpha-channel-opacity"/>',
        )

      case 'core/html':
        return `<!-- wp:html -->\n${a.content ?? ''}\n<!-- /wp:html -->`

      default: {
        // Unknown block type — emit generically so nothing is dropped
        const inner = block.innerBlocks
          .map((b) => this.serializeBlock(b))
          .join('\n')
        return this.wrap(name, a, inner)
      }
    }
  }

  private serializeListItem(item: GutenbergBlock): string {
    const nested = item.innerBlocks
      .map((b) => this.serializeBlock(b))
      .join('')
    return this.wrap(
      'list-item',
      {},
      `<li>${item.attrs.content ?? ''}${nested}</li>`,
    )
  }

  private wrap(name: string, attrs: Record<string, any>, html: string): string {
    const json = Object.keys(attrs).length > 0 ? ` ${JSON.stringify(attrs)}` : ''
    return `<!-- wp:${name}${json} -->\n${html}\n<!-- /wp:${name} -->`
  }

  // -------------------------------------------------------------- download

  downloadJSON(blocks: GutenbergBlock[], filename = 'blocks.json'): void {
    this.downloadFile(this.toJSON(blocks), filename, 'application/json')
  }

  downloadHTML(blocks: GutenbergBlock[], filename = 'blocks.html'): void {
    this.downloadFile(this.toWordPressHtml(blocks), filename, 'text/html')
  }

  private downloadFile(content: string, filename: string, mimeType: string): void {
    const blob = new Blob([content], { type: mimeType })
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = filename
    document.body.appendChild(link)
    link.click()
    document.body.removeChild(link)
    URL.revokeObjectURL(url)
  }

  copyToClipboard(blocks: GutenbergBlock[], format: 'json' | 'html'): Promise<void> {
    const content = format === 'json' ? this.toJSON(blocks) : this.toWordPressHtml(blocks)
    return navigator.clipboard.writeText(content)
  }
}

function esc(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;')
}

function escText(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}
