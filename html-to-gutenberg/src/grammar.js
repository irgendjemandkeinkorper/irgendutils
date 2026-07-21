// Gutenberg block grammar: serialize block objects to canonical
// `<!-- wp:name {attrs} -->` markup, and parse/validate markup back.

export function shortName(name) {
  return name.startsWith('core/') ? name.slice(5) : name;
}

export function fullName(name) {
  return name.includes('/') ? name : `core/${name}`;
}

function attrText(attrs) {
  if (!attrs || Object.keys(attrs).length === 0) return '';
  return ' ' + JSON.stringify(attrs);
}

// block: { name, attrs, content } — content may embed serialized child blocks.
export function serializeBlock(block) {
  const short = shortName(block.name);
  if (block.selfClosing) return `<!-- wp:${short}${attrText(block.attrs)} /-->`;
  return `<!-- wp:${short}${attrText(block.attrs)} -->\n${block.content}\n<!-- /wp:${short} -->`;
}

export function serializeBlocks(blocks) {
  if (blocks.length === 0) return '';
  return blocks.map((b) => b.markup ?? serializeBlock(b)).join('\n\n') + '\n';
}

const TOKEN_RE = /<!--\s+(\/)?wp:([a-z][a-z0-9_-]*(?:\/[a-z][a-z0-9_-]*)?)((?:\s+\{[\s\S]*?\})?)\s+(\/)?-->/g;

// Parse block markup into { root, warnings }. root.inner holds strings and
// block nodes ({ short, name, attrs, inner, selfClosing }) in document order.
export function parseBlockMarkup(markup) {
  const root = { short: null, inner: [] };
  const stack = [root];
  const warnings = [];
  let last = 0;
  TOKEN_RE.lastIndex = 0;
  let m;
  while ((m = TOKEN_RE.exec(markup)) !== null) {
    const text = markup.slice(last, m.index);
    if (text !== '') stack[stack.length - 1].inner.push(text);
    last = m.index + m[0].length;
    const [, closer, short, rawAttrs, selfClose] = m;
    if (closer) {
      if (stack.length === 1) {
        warnings.push(`unbalanced closer <!-- /wp:${short} -->`);
        continue;
      }
      const open = stack.pop();
      if (open.short !== short) {
        warnings.push(`mismatched closer: opened wp:${open.short}, closed wp:${short}`);
      }
      continue;
    }
    let attrs = null;
    const trimmed = rawAttrs.trim();
    if (trimmed !== '') {
      try {
        attrs = JSON.parse(trimmed);
        if (attrs === null || typeof attrs !== 'object' || Array.isArray(attrs)) {
          warnings.push(`wp:${short} attributes are not a JSON object`);
          attrs = null;
        }
      } catch (err) {
        warnings.push(`invalid attribute JSON on wp:${short}: ${err.message}`);
      }
    }
    const node = {
      short,
      name: fullName(short),
      attrs,
      inner: [],
      selfClosing: Boolean(selfClose),
    };
    stack[stack.length - 1].inner.push(node);
    if (!selfClose) stack.push(node);
  }
  const trailing = markup.slice(last);
  if (trailing !== '') stack[stack.length - 1].inner.push(trailing);
  while (stack.length > 1) {
    warnings.push(`unclosed block wp:${stack.pop().short}`);
  }
  return { root, warnings };
}

// Re-serialize a parsed tree. With deterministic attr construction this
// round-trips byte-for-byte against our own serializer output.
export function serializeParsed(root) {
  const ser = (n) => {
    if (typeof n === 'string') return n;
    const attrs = n.attrs && Object.keys(n.attrs).length > 0 ? ' ' + JSON.stringify(n.attrs) : '';
    if (n.selfClosing) return `<!-- wp:${n.short}${attrs} /-->`;
    return `<!-- wp:${n.short}${attrs} -->${n.inner.map(ser).join('')}<!-- /wp:${n.short} -->`;
  };
  return root.inner.map(ser).join('');
}

export function countBlocks(root) {
  const counts = new Map();
  const visit = (n) => {
    if (typeof n === 'string') return;
    counts.set(n.name, (counts.get(n.name) || 0) + 1);
    n.inner.forEach(visit);
  };
  root.inner.forEach(visit);
  return counts;
}
