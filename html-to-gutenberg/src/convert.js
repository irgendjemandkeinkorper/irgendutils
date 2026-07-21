// HTML tree -> Gutenberg blocks, per the mapping table in CLAUDE.md.

import { elementChildren, serializeNodeRaw, HEADINGS } from './htmlparser.js';
import { serializeBlock, serializeBlocks } from './grammar.js';

const CONTAINERS = new Set([
  'div', 'section', 'article', 'main', 'header', 'footer', 'aside', 'nav', 'html', 'body',
]);

const INLINE_TAGS = new Set([
  'a', 'abbr', 'b', 'bdi', 'br', 'cite', 'code', 'data', 'del', 'em', 'i', 'ins',
  'kbd', 'mark', 'q', 's', 'samp', 'small', 'strong', 'sub', 'sup', 'time', 'u', 'var', 'wbr',
]);
const INLINE_UNWRAP = new Set(['span', 'font', 'label']);
const INLINE_KEEP_ATTRS = { a: ['href', 'target', 'rel', 'title'] };

const BUTTON_CLASS_RE = /(^|\s)(button|btn|btn-[\w-]+|wp-block-button__link)(\s|$)/;
const COLUMNS_PARENT_RE = /(^|\s)(row|columns|grid|cols|flex-row)(\s|$)/;
const COLUMN_CHILD_RE = /(^|\s)col(umn)?(-[\w-]+)?(\s|$)/;

// --- text helpers ---------------------------------------------------------

export function escapeText(text) {
  return text
    .replace(/&(?!(?:[a-zA-Z][a-zA-Z0-9]*|#\d+|#x[0-9a-fA-F]+);)/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function escapeAttr(value) {
  return escapeText(String(value)).replace(/"/g, '&quot;');
}

function collapse(html) {
  return html.replace(/[ \t\r\n]+/g, ' ').trim();
}

function renderInline(nodes) {
  let out = '';
  for (const n of nodes) {
    if (n.type === 'text') {
      out += escapeText(n.text);
      continue;
    }
    if (n.type !== 'element') continue;
    if (n.tag === 'br') { out += '<br>'; continue; }
    if (INLINE_UNWRAP.has(n.tag) || !INLINE_TAGS.has(n.tag)) {
      out += renderInline(n.children);
      continue;
    }
    const keep = INLINE_KEEP_ATTRS[n.tag] || [];
    let attrs = '';
    for (const k of keep) {
      if (n.attrs[k] != null && n.attrs[k] !== '') attrs += ` ${k}="${escapeAttr(n.attrs[k])}"`;
    }
    out += `<${n.tag}${attrs}>${renderInline(n.children)}</${n.tag}>`;
  }
  return out;
}

function rawText(nodes) {
  return nodes.map((n) => serializeNodeRaw(n)).join('');
}

function isInlineNode(n) {
  if (n.type === 'text') return true;
  if (n.type !== 'element') return false;
  return INLINE_TAGS.has(n.tag) || INLINE_UNWRAP.has(n.tag);
}

function isButtonAnchor(n) {
  return n.type === 'element' && n.tag === 'a' && BUTTON_CLASS_RE.test(n.attrs.class || '');
}

// --- conversion context ---------------------------------------------------

function mk(ctx, name, attrs, content, extra = {}) {
  ctx.counts.set(name, (ctx.counts.get(name) || 0) + 1);
  const block = { name, attrs, content, ...extra };
  block.markup = serializeBlock(block);
  return block;
}

function joinInner(blocks) {
  return blocks.map((b) => b.markup).join('\n\n');
}

// --- block builders -------------------------------------------------------

function headingBlock(ctx, n) {
  const level = Number(n.tag[1]);
  const attrs = level === 2 ? {} : { level };
  return mk(ctx, 'core/heading', attrs,
    `<${n.tag} class="wp-block-heading">${collapse(renderInline(n.children))}</${n.tag}>`);
}

function paragraphBlockFromHtml(ctx, html) {
  return mk(ctx, 'core/paragraph', {}, `<p>${html}</p>`);
}

function listBlock(ctx, n) {
  const ordered = n.tag === 'ol';
  const items = elementChildren(n)
    .filter((k) => k.tag === 'li')
    .map((li) => {
      const nested = [];
      const inline = [];
      for (const c of li.children) {
        if (c.type === 'element' && (c.tag === 'ul' || c.tag === 'ol')) nested.push(c);
        else inline.push(c);
      }
      let content = `<li>${collapse(renderInline(inline))}`;
      for (const nl of nested) content += listBlock(ctx, nl).markup;
      content += '</li>';
      return mk(ctx, 'core/list-item', {}, content);
    });
  const tag = ordered ? 'ol' : 'ul';
  const attrs = ordered ? { ordered: true } : {};
  return mk(ctx, 'core/list', attrs,
    `<${tag} class="wp-block-list">${items.map((b) => b.markup).join('\n')}</${tag}>`);
}

function imageBlock(ctx, img, figure = null) {
  const src = img.attrs.src || '';
  const media = ctx.mediaMap.get(src);
  const url = media?.url || src;
  const alt = img.attrs.alt ?? '';
  const attrs = {};
  let imgClass = '';
  let figClass = 'wp-block-image';
  if (media?.id) {
    attrs.id = media.id;
    attrs.sizeSlug = 'full';
    attrs.linkDestination = 'none';
    imgClass = ` class="wp-image-${media.id}"`;
    figClass += ' size-full';
  }
  let caption = '';
  if (figure) {
    const fc = elementChildren(figure).find((k) => k.tag === 'figcaption');
    if (fc) {
      caption = `<figcaption class="wp-element-caption">${collapse(renderInline(fc.children))}</figcaption>`;
    }
  }
  return mk(ctx, 'core/image', attrs,
    `<figure class="${figClass}"><img src="${escapeAttr(url)}" alt="${escapeAttr(alt)}"${imgClass}/>${caption}</figure>`);
}

function buttonsBlock(ctx, anchors) {
  const buttons = anchors.map((a) => {
    const href = a.attrs.href || '';
    const label = collapse(renderInline(a.children));
    return mk(ctx, 'core/button', {},
      `<div class="wp-block-button"><a class="wp-block-button__link wp-element-button" href="${escapeAttr(href)}">${label}</a></div>`);
  });
  return mk(ctx, 'core/buttons', {},
    `<div class="wp-block-buttons">${joinInner(buttons)}</div>`);
}

function quoteBlock(ctx, n) {
  const citeNodes = [];
  const rest = [];
  for (const c of n.children) {
    if (c.type === 'element' && (c.tag === 'cite' || c.tag === 'footer')) citeNodes.push(c);
    else rest.push(c);
  }
  const inner = convertNodes(rest, ctx);
  let content = `<blockquote class="wp-block-quote">${joinInner(inner)}`;
  if (citeNodes.length > 0) {
    content += `<cite>${collapse(renderInline(citeNodes.flatMap((c) => c.children)))}</cite>`;
  }
  content += '</blockquote>';
  return mk(ctx, 'core/quote', {}, content);
}

function codeBlock(ctx, n) {
  const codeEl = elementChildren(n).find((k) => k.tag === 'code');
  const source = codeEl ? codeEl.children : n.children;
  const text = rawText(source).replace(/^\n+/, '').replace(/\s+$/, '');
  return mk(ctx, 'core/code', {},
    `<pre class="wp-block-code"><code>${escapeText(text)}</code></pre>`);
}

function separatorBlock(ctx) {
  return mk(ctx, 'core/separator', {},
    '<hr class="wp-block-separator has-alpha-channel-opacity"/>');
}

function tableBlock(ctx, n) {
  const sections = { thead: [], tbody: [], tfoot: [] };
  const renderRow = (tr) => {
    const cells = elementChildren(tr)
      .filter((c) => c.tag === 'td' || c.tag === 'th')
      .map((c) => `<${c.tag}>${collapse(renderInline(c.children))}</${c.tag}>`)
      .join('');
    return `<tr>${cells}</tr>`;
  };
  for (const child of elementChildren(n)) {
    if (child.tag === 'tr') sections.tbody.push(renderRow(child));
    else if (sections[child.tag]) {
      for (const tr of elementChildren(child).filter((c) => c.tag === 'tr')) {
        sections[child.tag].push(renderRow(tr));
      }
    }
  }
  let table = '<table>';
  if (sections.thead.length) table += `<thead>${sections.thead.join('')}</thead>`;
  table += `<tbody>${sections.tbody.join('')}</tbody>`;
  if (sections.tfoot.length) table += `<tfoot>${sections.tfoot.join('')}</tfoot>`;
  table += '</table>';
  return mk(ctx, 'core/table', {}, `<figure class="wp-block-table">${table}</figure>`);
}

function canonicalEmbedUrl(src) {
  let m = /youtube\.com\/embed\/([\w-]+)/.exec(src);
  if (m) return { url: `https://www.youtube.com/watch?v=${m[1]}`, provider: 'youtube', type: 'video' };
  if (/youtube\.com|youtu\.be/.test(src)) return { url: src, provider: 'youtube', type: 'video' };
  m = /player\.vimeo\.com\/video\/(\d+)/.exec(src);
  if (m) return { url: `https://vimeo.com/${m[1]}`, provider: 'vimeo', type: 'video' };
  if (/vimeo\.com/.test(src)) return { url: src, provider: 'vimeo', type: 'video' };
  return { url: src, provider: null, type: null };
}

function embedBlock(ctx, n) {
  const { url, provider, type } = canonicalEmbedUrl(n.attrs.src || '');
  const attrs = { url };
  if (type) attrs.type = type;
  if (provider) attrs.providerNameSlug = provider;
  attrs.responsive = true;
  let cls = 'wp-block-embed';
  if (type) cls += ` is-type-${type}`;
  if (provider) cls += ` is-provider-${provider} wp-block-embed-${provider}`;
  return mk(ctx, 'core/embed', attrs,
    `<figure class="${cls}"><div class="wp-block-embed__wrapper">\n${escapeText(url)}\n</div></figure>`);
}

function videoBlock(ctx, n) {
  let src = n.attrs.src || '';
  if (!src) {
    const source = elementChildren(n).find((k) => k.tag === 'source' && k.attrs.src);
    if (source) src = source.attrs.src;
  }
  return mk(ctx, 'core/video', {},
    `<figure class="wp-block-video"><video controls src="${escapeAttr(src)}"></video></figure>`);
}

function columnsBlock(ctx, n) {
  const columns = elementChildren(n).map((col) => {
    const inner = convertNodes(col.children, ctx);
    return mk(ctx, 'core/column', {},
      `<div class="wp-block-column">${joinInner(inner)}</div>`);
  });
  return mk(ctx, 'core/columns', {},
    `<div class="wp-block-columns">${joinInner(columns)}</div>`);
}

function fallbackBlock(ctx, n, reason) {
  const raw = serializeNodeRaw(n).trim();
  ctx.fallbacks.push({
    node: `<${n.tag}>`,
    reason,
    excerpt: raw.length > 120 ? raw.slice(0, 117) + '...' : raw,
  });
  return mk(ctx, 'core/html', {}, raw);
}

// --- structure detection --------------------------------------------------

function isColumns(n) {
  if (n.type !== 'element' || !CONTAINERS.has(n.tag)) return false;
  const kids = n.children.filter((c) => !(c.type === 'text' && c.text.trim() === '') && c.type !== 'comment');
  if (kids.length < 2 || kids.length > 6) return false;
  if (!kids.every((k) => k.type === 'element' && CONTAINERS.has(k.tag))) return false;
  const parentHint = COLUMNS_PARENT_RE.test(n.attrs.class || '');
  const childHint = kids.every((k) => COLUMN_CHILD_RE.test(k.attrs.class || ''));
  return parentHint || childHint;
}

function isButtonsContainer(n) {
  if (n.type !== 'element' || !CONTAINERS.has(n.tag)) return false;
  if (!/(^|\s)(buttons|btn-group|actions|cta)(\s|$)/.test(n.attrs.class || '')) return false;
  const kids = elementChildren(n);
  return kids.length > 0 && kids.every(isButtonAnchor);
}

function hasOnlyInlineContent(n) {
  return n.children.every((c) => isInlineNode(c) || c.type === 'comment');
}

// --- main walk ------------------------------------------------------------

function convertElement(n, ctx) {
  const tag = n.tag;
  if (HEADINGS.has(tag)) return [headingBlock(ctx, n)];
  if (tag === 'p') {
    const els = elementChildren(n);
    if (els.length === 1 && els[0].tag === 'img' && hasNoText(n)) {
      return [imageBlock(ctx, els[0])];
    }
    if (els.length === 1 && isButtonAnchor(els[0]) && hasNoText(n)) {
      return [buttonsBlock(ctx, [els[0]])];
    }
    const html = collapse(renderInline(n.children));
    return html === '' ? [] : [paragraphBlockFromHtml(ctx, html)];
  }
  if (tag === 'ul' || tag === 'ol') return [listBlock(ctx, n)];
  if (tag === 'img') return [imageBlock(ctx, n)];
  if (tag === 'figure') {
    const els = elementChildren(n);
    const img = els.find((k) => k.tag === 'img');
    if (img) return [imageBlock(ctx, img, n)];
    const iframe = els.find((k) => k.tag === 'iframe');
    if (iframe) return [embedBlock(ctx, iframe)];
    const video = els.find((k) => k.tag === 'video');
    if (video) return [videoBlock(ctx, video)];
    const table = els.find((k) => k.tag === 'table');
    if (table) return [tableBlock(ctx, table)];
    const quote = els.find((k) => k.tag === 'blockquote');
    if (quote) return [quoteBlock(ctx, quote)];
    const pre = els.find((k) => k.tag === 'pre');
    if (pre) return [codeBlock(ctx, pre)];
    return [fallbackBlock(ctx, n, 'figure without a mappable child')];
  }
  if (tag === 'blockquote') return [quoteBlock(ctx, n)];
  if (tag === 'pre') return [codeBlock(ctx, n)];
  if (tag === 'hr') return [separatorBlock(ctx)];
  if (tag === 'table') return [tableBlock(ctx, n)];
  if (tag === 'iframe') return [embedBlock(ctx, n)];
  if (tag === 'video') return [videoBlock(ctx, n)];
  if (CONTAINERS.has(tag)) {
    if (isButtonsContainer(n)) return [buttonsBlock(ctx, elementChildren(n))];
    if (isColumns(n)) return [columnsBlock(ctx, n)];
    if ((n.attrs.style || '') !== '' && hasOnlyInlineContent(n)) {
      return [fallbackBlock(ctx, n, `inline-styled <${tag}> with no semantic mapping`)];
    }
    return convertNodes(n.children, ctx); // transparent wrapper — unwrap
  }
  return [fallbackBlock(ctx, n, `no core block mapping for <${tag}>`)];
}

function hasNoText(n) {
  return n.children.every((c) => c.type !== 'text' || c.text.trim() === '');
}

export function convertNodes(nodes, ctx) {
  const out = [];
  let inlineBuf = [];
  const flush = () => {
    if (inlineBuf.length === 0) return;
    const html = collapse(renderInline(inlineBuf));
    inlineBuf = [];
    if (html !== '') out.push(paragraphBlockFromHtml(ctx, html));
  };

  for (let i = 0; i < nodes.length; i++) {
    const n = nodes[i];
    if (n.type === 'comment') continue;
    if (n.type === 'text') {
      if (n.text.trim() !== '' || inlineBuf.length > 0) inlineBuf.push(n);
      continue;
    }
    if (isButtonAnchor(n)) {
      flush();
      const run = [n];
      while (i + 1 < nodes.length) {
        const next = nodes[i + 1];
        if (next.type === 'text' && next.text.trim() === '') { i++; continue; }
        if (isButtonAnchor(next)) { i++; run.push(next); continue; }
        break;
      }
      out.push(buttonsBlock(ctx, run));
      continue;
    }
    if (isInlineNode(n)) {
      inlineBuf.push(n);
      continue;
    }
    flush();
    out.push(...convertElement(n, ctx));
  }
  flush();
  return out;
}

// --- entry point ----------------------------------------------------------

export function convertDocument(root, opts = {}) {
  const ctx = {
    counts: new Map(),
    fallbacks: [],
    mediaMap: opts.mediaMap || new Map(),
  };
  const blocks = convertNodes(root.children, ctx);
  const markup = serializeBlocks(blocks);
  return {
    markup,
    blocks,
    counts: ctx.counts,
    fallbacks: ctx.fallbacks,
  };
}
